import unittest
import decimal
from decimal import Decimal
from datetime import date, datetime
import os
import uuid
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from urllib.parse import urlparse
from dotenv import load_dotenv

# Load environment variables from .env_test
load_dotenv("backend/tests/.env_test")

os.environ["FLASK_ENV"] = "testing"

from backend.app import app, db
from backend.models import (
    NannyContract,
    User,
    CustomerBill,
    EmployeePayroll,
    FinancialAdjustment,
    AdjustmentType,
    BaseContract
)
from backend.services.billing_engine import BillingEngine

D = decimal.Decimal

def get_test_db_url():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL environment variable not set.")
    parsed_url = urlparse(db_url)
    test_db_name = f"{parsed_url.path[1:]}_test_termination"
    return parsed_url._replace(path=f"/{test_db_name}").geturl(), test_db_name, parsed_url

class TestContractTerminationFlow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test_db_url, test_db_name, orig_url = get_test_db_url()

        conn = psycopg2.connect(dbname='postgres', user=orig_url.username, password=orig_url.password, host=orig_url.hostname, port=orig_url.port)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        cursor.execute(f"DROP DATABASE IF EXISTS {test_db_name}")
        cursor.execute(f"CREATE DATABASE {test_db_name}")
        cursor.close()
        conn.close()

        app.config["SQLALCHEMY_DATABASE_URI"] = test_db_url
        app.config["TESTING"] = True
        app.config["WTF_CSRF_ENABLED"] = False
        app.config["JWT_SECRET_KEY"] = "test-secret-key"

        cls.app_context = app.app_context()
        cls.app_context.push()

        with cls.app_context:
            from flask_migrate import upgrade
            upgrade()

    @classmethod
    def tearDownClass(cls):
        db.session.remove()
        cls.app_context.pop()

        _, test_db_name, orig_url = get_test_db_url()
        conn = psycopg2.connect(dbname='postgres', user=orig_url.username, password=orig_url.password, host=orig_url.hostname, port=orig_url.port)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        cursor.execute(f"DROP DATABASE IF EXISTS {test_db_name}")
        cursor.close()
        conn.close()

    def setUp(self):
        self.session = db.session
        self.session.begin_nested()
        self.client = app.test_client()

        self.admin_user = User.query.filter_by(username="test_admin").first()
        if not self.admin_user:
            self.admin_user = User(id=str(uuid.uuid4()), username="test_admin", password="admin", role="admin", phone_number=f"123-{uuid.uuid4().hex[:10]}")
            self.session.add(self.admin_user)
            self.session.flush()

        from flask_jwt_extended import create_access_token
        self.access_token = create_access_token(identity=self.admin_user.id)
        self.headers = {
            'Authorization': f'Bearer {self.access_token}',
            'Content-Type': 'application/json'
        }

    def tearDown(self):
        self.session.rollback()

    def _create_contract_and_bill(self, customer_name="测试客户", employee_name="测试员工", level=6000, start_date=date(2025, 10, 1), end_date=date(2025, 10, 31)):
        employee = User(username=employee_name, phone_number=f"555-{uuid.uuid4().hex[:10]}", password="test")
        self.session.add(employee)
        self.session.flush()
        
        contract = NannyContract(
            customer_name=customer_name,
            user_id=employee.id,
            employee_level=Decimal(level),
            start_date=start_date,
            end_date=end_date,
            status='active'
        )
        self.session.add(contract)
        self.session.flush()

        bill = CustomerBill(contract_id=contract.id, year=start_date.year, month=start_date.month, cycle_start_date=start_date, cycle_end_date=end_date, total_due=Decimal("1000"), customer_name=customer_name)
        payroll = EmployeePayroll(contract_id=contract.id, year=start_date.year, month=start_date.month, cycle_start_date=start_date, cycle_end_date=end_date, total_due=Decimal("5000"), employee_id=employee.id)
        self.session.add_all([bill, payroll])
        self.session.commit()

        return contract, bill, payroll

    def test_terminate_contract_creates_salary_adjustment(self):
        """
        测试: 调用 terminate_contract 是否正确创建“公司代付工资”项
        """
        contract, bill, payroll = self._create_contract_and_bill()

        termination_date = date(2025, 10, 15)
        response = self.client.post(
            f"/api/billing/contracts/{contract.id}/terminate",
            json={"termination_date": termination_date.isoformat()},
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)

        # 验证“公司代付工资”调整项被创建且金额正确
        salary_adjustment = self.session.query(FinancialAdjustment).filter_by(
            customer_bill_id=bill.id,
            description="[系统] 公司代付员工工资"
        ).first()

        self.assertIsNotNone(salary_adjustment)
        self.assertEqual(salary_adjustment.adjustment_type, AdjustmentType.COMPANY_PAID_SALARY)
        self.assertEqual(salary_adjustment.amount, payroll.total_due)


    def test_transfer_balance_endpoint(self):
        """
        测试: 新的 /transfer-balance 接口是否能正确创建结转项并转移
        V2: 验证新的、正确的财务结转逻辑
        """
        # 准备：创建一个已终止的合同，其账单有1500的待付余额
        contract, bill, payroll = self._create_contract_and_bill(start_date=date(2025, 11, 1), end_date=date(2025, 11, 30))
        contract.status = 'terminated'
        self.session.add(contract)

        adjustment = FinancialAdjustment(
            customer_bill_id=bill.id,
            amount=Decimal("500.00"), # 初始账单是1000, 再加500
            adjustment_type=AdjustmentType.CUSTOMER_INCREASE,
            description="测试用增款",
            date=date(2025, 11, 1)
        )
        self.session.add(adjustment)
        
        engine = BillingEngine()
        engine.calculate_for_month(year=bill.year, month=bill.month, contract_id=bill.contract_id, force_recalculate=True)
        self.session.commit()
        self.session.refresh(bill)
        self.assertEqual(bill.total_due, Decimal("7100.00")) # 验证初始余额

        # 准备：创建目标合同和账单
        dest_contract, dest_bill, _ = self._create_contract_and_bill(customer_name="测试客户", employee_name="新员工", start_date=date(2025, 12, 1), end_date=date(2025, 12, 31))
        
        # V3修正：在转账前，先计算一次目标账单的基准金额
        engine.calculate_for_month(year=dest_bill.year, month=dest_bill.month, contract_id=dest_bill.contract_id, force_recalculate=True)
        self.session.commit()
        self.session.refresh(dest_bill)
        baseline_dest_bill_due = dest_bill.total_due

        # 操作：调用余额结转接口
        response = self.client.post(
            f"/api/billing/bills/{bill.id}/transfer-balance",
            json={"destination_contract_id": str(dest_contract.id)},
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)

        # 验证1: 源账单应收款归零
        self.session.refresh(bill)
        self.assertEqual(bill.total_due, Decimal("0.00"))

        source_transfer_adj = self.session.query(FinancialAdjustment).filter(
            FinancialAdjustment.customer_bill_id == bill.id,
            FinancialAdjustment.description.like('%余额转出%')
        ).first()
        self.assertIsNotNone(source_transfer_adj)

        # 验证2: 目标账单收到了正确的转入项，且总额正确增加
        self.session.refresh(dest_bill)
        self.assertEqual(dest_bill.total_due, baseline_dest_bill_due + Decimal("7100.00"))

        dest_transfer_adj = self.session.query(FinancialAdjustment).filter(
            FinancialAdjustment.customer_bill_id == dest_bill.id,
            FinancialAdjustment.description.like('%余额从%转入%')
        ).first()
        self.assertIsNotNone(dest_transfer_adj)
        self.assertEqual(dest_transfer_adj.amount, Decimal("7100.00"))