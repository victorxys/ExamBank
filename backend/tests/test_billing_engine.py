# backend/tests/test_billing_engine.py
import unittest
import decimal
from datetime import date
import os
import tempfile  # 1. 导入 tempfile 用于创建临时数据库文件


os.environ["FLASK_ENV"] = "testing"

from backend.app import app, db
from backend.models import (
    NannyContract,
    ServicePersonnel,
    CustomerBill,
    EmployeePayroll,
    AttendanceRecord,
    FinancialAdjustment,
    AdjustmentType,
    SubstituteRecord,
    LlmApiKey,
)
from backend.services.billing_engine import BillingEngine
from backend.services.data_sync_service import DataSyncService
from backend.security_utils import encrypt_data

D = decimal.Decimal


class TestNannyBillingEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        """Set up the database and app context once for all tests."""
        """Set up the database and app context once for all tests."""

        # 3. **核心修正**: 创建一个临时的数据库文件，并覆盖 app 的配置
        cls.db_fd, cls.db_path = tempfile.mkstemp()
        app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{cls.db_path}"
        app.config["TESTING"] = True
        app.config["WTF_CSRF_ENABLED"] = False  # 禁用CSRF，如果使用了Flask-WTF

        cls.app_context = app.app_context()
        cls.app_context.push()

        with cls.app_context:
            db.create_all()
            # "Upsert" a dummy API key to ensure it exists and is unique
            api_key = (
                db.session.query(LlmApiKey)
                .filter_by(key_name="Jinshuju-Main-API")
                .first()
            )
            if api_key:
                db.session.delete(api_key)
                db.session.commit()

            new_api_key = LlmApiKey(
                key_name="Jinshuju-Main-API",
                api_key_encrypted=encrypt_data("test_key"),
                notes="test_secret",
                provider="jinshuju",
                status="active",
            )
            db.session.add(new_api_key)
            db.session.commit()

    @classmethod
    def tearDownClass(cls):
        """Tear down the database once after all tests."""
        db.session.remove()
        db.drop_all()  # 销毁测试数据库的所有表
        cls.app_context.pop()

        # 4. **核心修正**: 关闭并删除临时数据库文件
        os.close(cls.db_fd)
        os.unlink(cls.db_path)

    def setUp(self):
        """Start a nested transaction before each test."""
        self.session = db.session
        self.session.begin_nested()
        self.engine = BillingEngine()
        self.sync_service = DataSyncService()

    def tearDown(self):
        """Roll back the transaction after each test."""
        self.session.rollback()

    def test_calculate_nanny_bill_normal_month(self):
        employee = ServicePersonnel(name="测试育儿嫂")
        self.session.add(employee)
        self.session.flush()
        contract = NannyContract(
            customer_name="测试客户",
            service_personnel_id=employee.id,
            status="active",
            employee_level="5200",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 12, 31),
            is_monthly_auto_renew=True,
            jinshuju_entry_id="test-nanny-1",
        )
        self.session.add(contract)
        self.session.commit()
        self.sync_service._pre_create_bills_for_active_contract(contract)
        self.engine.calculate_for_month(
            year=2025, month=3, contract_id=contract.id, force_recalculate=True
        )
        bill = CustomerBill.query.filter_by(
            contract_id=contract.id, year=2025, month=3
        ).first()
        payroll = EmployeePayroll.query.filter_by(
            contract_id=contract.id, year=2025, month=3
        ).first()
        self.assertEqual(bill.total_due, D("5720.00"))
        self.assertEqual(payroll.final_payout, D("5200.00"))

    def test_calculate_nanny_bill_with_overtime(self):
        employee = ServicePersonnel(name="加班育儿嫂")
        self.session.add(employee)
        self.session.flush()
        contract = NannyContract(
            customer_name="加班客户",
            service_personnel_id=employee.id,
            status="active",
            employee_level="5200",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 12, 31),
            is_monthly_auto_renew=True,
            jinshuju_entry_id="test-nanny-2",
        )
        self.session.add(contract)
        self.session.commit()
        self.sync_service._pre_create_bills_for_active_contract(contract)
        attendance = AttendanceRecord(
            contract_id=contract.id,
            employee_id=employee.id,
            cycle_start_date=date(2025, 4, 1),
            cycle_end_date=date(2025, 4, 30),
            total_days_worked=28,
            overtime_days=2,
            statutory_holiday_days=1,
        )
        self.session.add(attendance)
        self.session.commit()
        self.engine.calculate_for_month(
            year=2025, month=4, contract_id=contract.id, force_recalculate=True
        )
        bill = CustomerBill.query.filter_by(
            contract_id=contract.id, year=2025, month=4
        ).first()
        payroll = EmployeePayroll.query.filter_by(
            contract_id=contract.id, year=2025, month=4
        ).first()
        self.assertEqual(bill.total_due, D("6520.00"))
        self.assertEqual(payroll.final_payout, D("6400.00"))

    def test_calculate_nanny_bill_first_month_fee(self):
        employee = ServicePersonnel(name="首月育儿嫂")
        self.session.add(employee)
        self.session.flush()
        contract = NannyContract(
            customer_name="首月客户",
            service_personnel_id=employee.id,
            status="active",
            employee_level="6000",
            start_date=date(2025, 5, 1),
            end_date=date(2025, 12, 31),
            is_monthly_auto_renew=True,
            jinshuju_entry_id="test-nanny-3",
        )
        self.session.add(contract)
        self.session.commit()
        self.sync_service._pre_create_bills_for_active_contract(contract)
        self.engine.calculate_for_month(
            year=2025, month=5, contract_id=contract.id, force_recalculate=True
        )
        bill = CustomerBill.query.filter_by(
            contract_id=contract.id, year=2025, month=5
        ).first()
        payroll = EmployeePayroll.query.filter_by(
            contract_id=contract.id, year=2025, month=5
        ).first()
        self.assertEqual(bill.total_due, D("6600.00"))
        self.assertEqual(payroll.final_payout, D("5400.00"))

    def test_calculate_nanny_bill_with_adjustments(self):
        employee = ServicePersonnel(name="财务调整育儿嫂")
        self.session.add(employee)
        self.session.flush()
        contract = NannyContract(
            customer_name="财务调整客户",
            service_personnel_id=employee.id,
            status="active",
            employee_level="5200",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 12, 31),
            is_monthly_auto_renew=True,
            jinshuju_entry_id="test-nanny-4",
        )
        self.session.add(contract)
        self.session.commit()
        self.sync_service._pre_create_bills_for_active_contract(contract)
        bill = CustomerBill.query.filter_by(
            contract_id=contract.id, year=2025, month=6
        ).first()
        payroll = EmployeePayroll.query.filter_by(
            contract_id=contract.id, year=2025, month=6
        ).first()
        customer_increase = FinancialAdjustment(
            adjustment_type=AdjustmentType.CUSTOMER_INCREASE,
            amount=D("100.50"),
            description="材料费",
            date=date(2025, 6, 10),
            customer_bill_id=bill.id,
        )
        employee_decrease = FinancialAdjustment(
            adjustment_type=AdjustmentType.EMPLOYEE_DECREASE,
            amount=D("50.25"),
            description="社保",
            date=date(2025, 6, 15),
            employee_payroll_id=payroll.id,
        )
        self.session.add_all([customer_increase, employee_decrease])
        self.session.commit()
        self.engine.calculate_for_month(
            year=2025, month=6, contract_id=contract.id, force_recalculate=True
        )
        self.assertEqual(bill.total_due, D("5820.50"))
        self.assertEqual(payroll.final_payout, D("5149.75"))

    def test_calculate_nanny_bill_with_substitute(self):
        main_employee = ServicePersonnel(name="主育儿嫂")
        sub_employee = ServicePersonnel(name="替班育儿嫂")
        self.session.add_all([main_employee, sub_employee])
        self.session.flush()
        contract = NannyContract(
            customer_name="替班客户",
            service_personnel_id=main_employee.id,
            status="active",
            employee_level="5200",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 12, 31),
            is_monthly_auto_renew=True,
            jinshuju_entry_id="test-nanny-5",
        )
        self.session.add(contract)
        self.session.commit()
        self.sync_service._pre_create_bills_for_active_contract(contract)
        sub_record = SubstituteRecord(
            main_contract_id=contract.id,
            substitute_personnel_id=sub_employee.id,
            start_date=date(2025, 7, 11),
            end_date=date(2025, 7, 20),
            substitute_salary="6500",
            substitute_management_fee="200",
        )
        self.session.add(sub_record)
        self.session.commit()
        self.engine.calculate_for_month(
            year=2025, month=7, contract_id=contract.id, force_recalculate=True
        )
        bill = CustomerBill.query.filter_by(
            contract_id=contract.id, year=2025, month=7
        ).first()
        payroll = EmployeePayroll.query.filter_by(
            contract_id=contract.id, year=2025, month=7
        ).first()
        self.assertEqual(bill.total_due, D("8420.00"))
        self.assertEqual(payroll.final_payout, D("3200.00"))

    def test_calculate_nanny_bill_non_monthly_management_fee(self):
        employee = ServicePersonnel(name="年签育儿嫂")
        self.session.add(employee)
        self.session.flush()
        contract = NannyContract(
            customer_name="年签客户",
            service_personnel_id=employee.id,
            status="active",
            employee_level="6000",
            start_date=date(2025, 1, 15),
            end_date=date(2025, 4, 24),
            is_monthly_auto_renew=False,
            jinshuju_entry_id="test-nanny-6",
        )
        self.session.add(contract)
        self.session.commit()
        self.sync_service._pre_create_bills_for_active_contract(contract)
        self.engine.calculate_for_month(
            year=2025, month=2, contract_id=contract.id, force_recalculate=True
        )
        bill1 = CustomerBill.query.filter_by(
            contract_id=contract.id, year=2025, month=2
        ).first()
        self.assertEqual(bill1.total_due, D("8400.00"))
        contract.management_fee_status = "paid"
        self.session.commit()
        self.engine.calculate_for_month(
            year=2025, month=5, contract_id=contract.id, force_recalculate=True
        )
        bill3 = CustomerBill.query.filter_by(
            contract_id=contract.id, year=2025, month=5
        ).first()
        self.assertEqual(bill3.total_due, D("5600.00"))

    def test_maternity_nurse_substitution_and_postponement(self):
        # 1. Setup: Create a maternity nurse contract and a substitute user
        main_employee = ServicePersonnel(name="主月嫂")
        sub_user = User(
            username="替班月嫂", phone_number="12345678901", password_hash="test"
        )
        self.session.add_all([main_employee, sub_user])
        self.session.flush()

        contract = MaternityNurseContract(
            customer_name="月嫂替班客户",
            service_personnel_id=main_employee.id,
            status="active",
            employee_level="10000",
            management_fee_rate=D("0.15"),
            actual_onboarding_date=date(2025, 1, 1),
            expected_offboarding_date=date(2025, 1, 27),  # 26-day cycle
            jinshuju_entry_id="test-mn-sub-1",
        )
        self.session.add(contract)
        self.session.commit()

        # Manually create the initial bill
        self.engine.calculate_for_month(2025, 1, contract.id, force_recalculate=True)

        # 2. Action: Use the API client to create a substitute record
        substitute_data = {
            "substitute_user_id": sub_user.id,
            "start_date": "2025-01-10",
            "end_date": "2025-01-15",  # 5-day substitution
            "employee_level": "8000",
            "substitute_type": "maternity_nurse",
            "management_fee_rate": "0.25",
        }

        with app.test_client() as client:
            # Simulate a logged-in user if your endpoint requires it
            # For this example, assuming jwt_required is handled or mocked
            response = client.post(
                f"/api/contracts/{contract.id}/substitutes", json=substitute_data
            )
            self.assertEqual(response.status_code, 201)

        # 3. Assertions
        self.session.refresh(contract)

        # Assert that the contract's offboarding date was postponed
        self.assertEqual(
            contract.expected_offboarding_date, date(2025, 2, 1)
        )  # Jan 27 + 5 days

        # Assert that the original bill was updated
        original_bill = CustomerBill.query.filter_by(
            contract_id=contract.id, is_substitute_bill=False
        ).first()
        self.assertIsNotNone(original_bill)

        # The cycle end date should be extended
        self.assertEqual(
            original_bill.cycle_end_date, date(2025, 2, 1)
        )  # Jan 27 + 5 days

        # Check the calculation details for substitute deduction
        calc_details = original_bill.calculation_details
        self.assertEqual(D(calc_details["substitute_days"]), D(5))

        # Substitute bill should exist
        sub_bill = CustomerBill.query.filter_by(
            contract_id=contract.id, is_substitute_bill=True
        ).first()
        self.assertIsNotNone(sub_bill)

        # The deduction on the main bill should equal the total payable of the sub bill
        self.assertEqual(
            D(calc_details["substitute_deduction"]), sub_bill.total_due
        )


if __name__ == "__main__":
    unittest.main()
