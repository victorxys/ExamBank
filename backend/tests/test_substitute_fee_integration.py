#!/usr/bin/env python
# -*- coding: utf-8 -*-

import unittest
import decimal
from datetime import date, datetime
import os
import uuid
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from urllib.parse import urlparse
from unittest.mock import patch
from dotenv import load_dotenv

# Load environment variables from .env_test
load_dotenv("backend/tests/.env_test")

os.environ["FLASK_ENV"] = "testing"

from backend.app import app, db
from backend.models import (
    NannyContract,
    MaternityNurseContract, # 新增
    ServicePersonnel,
    User,
    SubstituteRecord,
    FinancialAdjustment,
    AdjustmentType,
    CustomerBill,
)
from backend.services.billing_engine import BillingEngine

D = decimal.Decimal

def get_test_db_url():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL environment variable not set.")
    parsed_url = urlparse(db_url)
    test_db_name = f"{parsed_url.path[1:]}_test_integration"
    return parsed_url._replace(path=f"/{test_db_name}").geturl(), test_db_name, parsed_url


class TestSubstituteFeeIntegration(unittest.TestCase):
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
        cursor.execute(f"DROP DATABASE {test_db_name}")
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
            'Authorization': f'Bearer {self.access_token}'
        }

    def tearDown(self):
        self.session.rollback()

    def test_create_substitute_for_terminated_contract_fully_after_end_date(self):
        """【更新】Test Case 001: 为终止合同添加期外替班，并传入费率。"""
        main_employee = ServicePersonnel(name="主育儿嫂-合同已终止")
        sub_user = User(id=str(uuid.uuid4()), username="替班用户-追加", phone_number=f"987-{uuid.uuid4().hex[:10]}", password="test")
        self.session.add_all([main_employee, sub_user])
        self.session.flush()

        terminated_contract = NannyContract(
            customer_name="已终止合同客户",
            service_personnel_id=main_employee.id,
            status="terminated",
            employee_level="5200",
            start_date=date(2025, 9, 1),
            end_date=date(2025, 9, 30),
            termination_date=date(2025, 9, 30),
        )
        self.session.add(terminated_contract)
        self.session.flush()

        substitute_data = {
            "substitute_user_id": str(sub_user.id),
            "start_date": "2025-10-05T00:00:00",
            "end_date": "2025-10-15T00:00:00", # 10天
            "employee_level": "5200",
            "substitute_type": "nanny",
            "substitute_management_fee_rate": 0.1 # 10% 费率
        }

        response = self.client.post(
            f"/api/contracts/{terminated_contract.id}/substitutes",
            json=substitute_data,
            headers=self.headers
        )
        self.assertEqual(response.status_code, 201)

        sub_record = self.session.query(SubstituteRecord).filter_by(main_contract_id=terminated_contract.id).first()
        self.assertIsNotNone(sub_record)
        # 期望费用: 5200 / 30 * 0.1 * 10 = 173.33
        self.assertEqual(sub_record.substitute_management_fee, D("173.33"))

    def test_create_substitute_for_finished_contract_partially_overlapping(self):
        """【更新】Test Case 002: 为结束合同添加部分重叠的替班，并传入费率。"""
        main_employee = ServicePersonnel(name="主育儿嫂-合同已结束-部分重叠")
        sub_user = User(id=str(uuid.uuid4()), username="替班用户-部分重叠", phone_number=f"986-{uuid.uuid4().hex[:10]}", password="test")
        self.session.add_all([main_employee, sub_user])
        self.session.flush()

        finished_contract = NannyContract(
            customer_name="已结束合同客户-部分重叠",
            service_personnel_id=main_employee.id,
            status="finished",
            employee_level="6000",
            start_date=date(2025, 9, 1),
            end_date=date(2025, 10, 10),
        )
        self.session.add(finished_contract)
        self.session.flush()

        substitute_data = {
            "substitute_user_id": str(sub_user.id),
            "start_date": "2025-10-08T00:00:00",
            "end_date": "2025-10-15T00:00:00",
            "employee_level": "6000",
            "substitute_type": "nanny",
            "substitute_management_fee_rate": 0.1 # 10% 费率
        }

        response = self.client.post(
            f"/api/contracts/{finished_contract.id}/substitutes",
            json=substitute_data,
            headers=self.headers
        )
        self.assertEqual(response.status_code, 201)

        sub_record = self.session.query(SubstituteRecord).filter_by(main_contract_id=finished_contract.id).first()
        self.assertIsNotNone(sub_record)
        # 合同结束于 10-10，所以只有 10-11 到 10-15 (5天) 计费
        # 期望费用: 6000 / 30 * 0.1 * 5 = 100.00
        self.assertEqual(sub_record.substitute_management_fee, D("100.00"))

    @patch('backend.api.contract_api.calculate_monthly_billing_task')
    def test_terminate_contract_with_future_substitute_generates_fee(self, mock_task):
        """【更新】Test Case 003: 终止合同时，为已存在的未来替班记录计算费用。"""
        main_employee = ServicePersonnel(name="主育儿嫂-将被终止")
        sub_employee = ServicePersonnel(name="替班员工-将被悬空")
        self.session.add_all([main_employee, sub_employee])
        self.session.flush()

        active_contract = NannyContract(
            customer_name="将被终止的合同客户",
            service_personnel_id=main_employee.id,
            status="active",
            employee_level="5200",
            start_date=date(2025, 9, 1),
            end_date=date(2025, 11, 30),
        )
        self.session.add(active_contract)
        self.session.flush()

        sub_record = SubstituteRecord(
            main_contract_id=active_contract.id,
            substitute_personnel_id=sub_employee.id,
            start_date=datetime(2025, 10, 20),
            end_date=datetime(2025, 11, 5),
            substitute_salary="5200",
            substitute_type="nanny",
            substitute_management_fee_rate=D("0.1") # 设置费率
        )
        self.session.add(sub_record)
        self.session.flush()

        termination_data = {"termination_date": "2025-10-31"}

        response = self.client.post(
            f"/api/billing/contracts/{active_contract.id}/terminate", 
            json=termination_data,
            headers=self.headers
        )
        self.assertEqual(response.status_code, 200)

        self.session.refresh(sub_record)
        self.assertIsNotNone(sub_record.substitute_management_fee)
        # 合同终止于 10-31，所以只有 11-01 到 11-05 (5天) 计费
        # 期望费用: 5200 / 30 * 0.1 * 5 = 86.67
        self.assertEqual(sub_record.substitute_management_fee, D("86.67"))

    def test_create_substitute_for_active_contract_no_fee(self):
        """【不变】Test Case 004: 为有效合同添加期内替班，不产生费用。"""
        main_employee = ServicePersonnel(name="主育儿嫂-正常合同")
        sub_user = User(id=str(uuid.uuid4()), username="替班用户-正常", phone_number=f"988-{uuid.uuid4().hex[:10]}", password="test")
        self.session.add_all([main_employee, sub_user])
        self.session.flush()

        active_contract = NannyContract(
            customer_name="正常合同客户",
            service_personnel_id=main_employee.id,
            status="active",
            employee_level="5200",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 12, 31),
        )
        self.session.add(active_contract)
        self.session.flush()

        substitute_data = {
            "substitute_user_id": str(sub_user.id),
            "start_date": "2025-06-10T00:00:00",
            "end_date": "2025-06-20T00:00:00",
            "employee_level": "5200",
            "substitute_type": "nanny",
            "substitute_management_fee_rate": 0.1 # 即使传入费率，也不应计费
        }

        response = self.client.post(
            f"/api/contracts/{active_contract.id}/substitutes",
            json=substitute_data,
            headers=self.headers
        )
        self.assertEqual(response.status_code, 201)

        sub_record = self.session.query(SubstituteRecord).filter_by(main_contract_id=active_contract.id).first()
        self.assertIsNotNone(sub_record)
        self.assertEqual(sub_record.substitute_management_fee, D("0"))

    def test_create_substitute_for_active_auto_renew_contract_no_fee(self):
        """【不变】Test Case 005: 为自动续签合同添加期外替班，不产生费用。"""
        main_employee = ServicePersonnel(name="主育儿嫂-自动续签")
        sub_user = User(id=str(uuid.uuid4()), username="替班用户-自动续签-豁免", phone_number=f"985-{uuid.uuid4().hex[:10]}", password="test")
        self.session.add_all([main_employee, sub_user])
        self.session.flush()

        active_auto_renew_contract = NannyContract(
            customer_name="自动续签客户-豁免",
            service_personnel_id=main_employee.id,
            status="active",
            is_monthly_auto_renew=True,
            employee_level="5200",
            start_date=date(2025, 9, 1),
            end_date=date(2025, 9, 30),
        )
        self.session.add(active_auto_renew_contract)
        self.session.flush()

        substitute_data = {
            "substitute_user_id": str(sub_user.id),
            "start_date": "2025-10-05T00:00:00",
            "end_date": "2025-10-15T00:00:00",
            "employee_level": "5200",
            "substitute_type": "nanny",
            "substitute_management_fee_rate": 0.15 # 传入一个非零费率
        }

        response = self.client.post(
            f"/api/contracts/{active_auto_renew_contract.id}/substitutes",
            json=substitute_data,
            headers=self.headers
        )
        self.assertEqual(response.status_code, 201)

        sub_record = self.session.query(SubstituteRecord).filter_by(main_contract_id=active_auto_renew_contract.id).first()
        self.assertIsNotNone(sub_record)
        # 核心断言：即使传入费率，对于未终止的自动续签合同，预计算的管理费也应为0
        self.assertEqual(sub_record.substitute_management_fee, D("0"))

        # 验证最终账单中的管理费也为0
        bill = self.session.query(CustomerBill).filter_by(source_substitute_record_id=sub_record.id).first()
        self.assertIsNotNone(bill)
        self.assertEqual(D(bill.calculation_details.get('management_fee', -1)), D("0"))

    def test_maternity_nurse_substitute_with_custom_rate(self):
        """【新】Test Case 008: 为月嫂合同创建替班，并使用自定义费率计算管理费。"""
        main_employee = ServicePersonnel(name="主月嫂")
        sub_user = User(id=str(uuid.uuid4()), username="替班月嫂", phone_number=f"982-{uuid.uuid4().hex[:10]}", password="test")
        self.session.add_all([main_employee, sub_user])
        self.session.flush()

        mn_contract = MaternityNurseContract(
            customer_name="月嫂客户",
            service_personnel_id=main_employee.id,
            status="active",
            employee_level="15000",
            start_date=date(2025, 10, 1),
            end_date=date(2025, 10, 27),
        )
        self.session.add(mn_contract)
        self.session.flush()

        substitute_data = {
            "substitute_user_id": str(sub_user.id),
            "start_date": "2025-10-05T00:00:00",
            "end_date": "2025-10-15T00:00:00", # 10天
            "employee_level": "12000",
            "substitute_type": "maternity_nurse",
            "substitute_management_fee_rate": 0.20 # 20% 费率
        }

        response = self.client.post(
            f"/api/contracts/{mn_contract.id}/substitutes",
            json=substitute_data,
            headers=self.headers
        )
        self.assertEqual(response.status_code, 201)

        sub_record = self.session.query(SubstituteRecord).filter_by(main_contract_id=mn_contract.id).first()
        self.assertIsNotNone(sub_record)
        
        # API层对于月嫂，金额会由后续的计费引擎计算并回填，因此这里不再断言为0
        self.assertEqual(sub_record.substitute_management_fee_rate, D("0.20"))

        # 验证最终账单中的管理费是否由计费引擎正确计算
        bill = self.session.query(CustomerBill).filter_by(source_substitute_record_id=sub_record.id).first()
        self.assertIsNotNone(bill)
        # 期望费用: 12000 * 0.20 / 26 * 10 = 923.08
        self.assertEqual(D(bill.calculation_details.get('management_fee')), D("923.08"))
