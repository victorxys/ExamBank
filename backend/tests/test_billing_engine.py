import pytest
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

from backend.app import create_app
from backend.extensions import db
from backend.services.billing_engine import BillingEngine
from backend.models import BaseContract, NannyContract # Assuming these are the relevant models

@pytest.fixture(scope="module")
def app():
    app = create_app('testing')
    with app.app_context():
        db.create_all()
        yield app
        db.drop_all()

@pytest.fixture(scope="function")
def session(app):
    with app.app_context():
        connection = db.engine.connect()
        transaction = connection.begin()
        options = dict(bind=connection, binds={})
        session = db.create_scoped_session(options=options)
        db.session = session
        yield session
        session.remove()
        transaction.rollback()
        connection.close()

class TestBillingEngineNannyCycle:

    def setup_method(self):
        # Common setup for tests
        self.engine = BillingEngine()

    @patch('backend.extensions.db.session.get')
    def test_nanny_cycle_no_overlap(self, mock_db_session_get, session):
        """
        测试非重叠合同的账单周期计算。
        原合同: 2025-11-01 ~ 2025-11-30
        新合同: 2025-12-01 ~ 2026-01-31 (无 previous_contract_id)
        期望: 新合同第一个账单周期从 2025-12-01 开始。
        """
        # Mock contract
        contract = NannyContract(
            id=2,
            start_date=date(2025, 12, 1),
            end_date=date(2026, 1, 31),
            previous_contract_id=None # No previous contract
        )
        session.add(contract)
        session.commit()

        # Call the method
        cycle_start, cycle_end = self.engine._get_nanny_cycle_for_month(contract, 2025, 12)

        # Assertions
        assert cycle_start == date(2025, 12, 1)
        assert cycle_end == date(2025, 12, 31) # Assuming it calculates for the full month

    @patch('backend.extensions.db.session.get')
    def test_nanny_cycle_with_overlap(self, mock_db_session_get, session):
        """
        测试重叠合同的账单周期计算。
        前任合同: 2025-11-01 ~ 2025-11-16
        当前合同: 2025-11-16 ~ 2025-12-31 (previous_contract_id 指向前任合同)
        期望: 当前合同第一个账单周期从 2025-11-17 开始。
        """
        # Mock previous contract
        previous_contract = BaseContract(
            id=1,
            start_date=date(2025, 11, 1),
            end_date=date(2025, 11, 16)
        )
        session.add(previous_contract)
        session.commit()

        # Mock current contract
        contract = NannyContract(
            id=2,
            start_date=date(2025, 11, 16),
            end_date=date(2025, 12, 31),
            previous_contract_id=1 # Link to previous contract
        )
        session.add(contract)
        session.commit()

        # Mock db.session.get to return the previous contract when queried
        mock_db_session_get.return_value = previous_contract

        # Call the method for the first month of the current contract
        cycle_start, cycle_end = self.engine._get_nanny_cycle_for_month(contract, 2025, 11)

        # Assertions
        assert cycle_start == date(2025, 11, 17) # Should be adjusted
        assert cycle_end == date(2025, 11, 30) # Should be end of month

    @patch('backend.extensions.db.session.get')
    def test_nanny_cycle_overlap_but_no_previous_contract_id(self, mock_db_session_get, session):
        """
        测试合同开始日期重叠，但没有 previous_contract_id 的情况。
        期望: 不进行日期调整。
        """
        # Mock current contract
        contract = NannyContract(
            id=2,
            start_date=date(2025, 11, 16),
            end_date=date(2025, 12, 31),
            previous_contract_id=None # No previous contract
        )
        session.add(contract)
        session.commit()

        # Call the method
        cycle_start, cycle_end = self.engine._get_nanny_cycle_for_month(contract, 2025, 11)

        # Assertions
        assert cycle_start == date(2025, 11, 16) # Should NOT be adjusted
        assert cycle_end == date(2025, 11, 30)

    @patch('backend.extensions.db.session.get')
    def test_nanny_cycle_overlap_but_previous_contract_not_found(self, mock_db_session_get, session):
        """
        测试合同开始日期重叠，有 previous_contract_id 但前任合同不存在的情况。
        期望: 不进行日期调整。
        """
        # Mock current contract
        contract = NannyContract(
            id=2,
            start_date=date(2025, 11, 16),
            end_date=date(2025, 12, 31),
            previous_contract_id=999 # Non-existent previous contract
        )
        session.add(contract)
        session.commit()

        # Mock db.session.get to return None for the previous contract
        mock_db_session_get.return_value = None

        # Call the method
        cycle_start, cycle_end = self.engine._get_nanny_cycle_for_month(contract, 2025, 11)

        # Assertions
        assert cycle_start == date(2025, 11, 16) # Should NOT be adjusted
        assert cycle_end == date(2025, 11, 30)

    @patch('backend.extensions.db.session.get')
    def test_nanny_cycle_overlap_but_dates_dont_match(self, mock_db_session_get, session):
        """
        测试合同开始日期与前任合同结束日期不重叠的情况。
        前任合同: 2025-11-01 ~ 2025-11-15
        当前合同: 2025-11-16 ~ 2025-12-31 (previous_contract_id 指向前任合同)
        期望: 不进行日期调整。
        """
        # Mock previous contract
        previous_contract = BaseContract(
            id=1,
            start_date=date(2025, 11, 1),
            end_date=date(2025, 11, 15) # Ends before current contract starts
        )
        session.add(previous_contract)
        session.commit()

        # Mock current contract
        contract = NannyContract(
            id=2,
            start_date=date(2025, 11, 16),
            end_date=date(2025, 12, 31),
            previous_contract_id=1 # Link to previous contract
        )
        session.add(contract)
        session.commit()

        # Mock db.session.get to return the previous contract when queried
        mock_db_session_get.return_value = previous_contract

        # Call the method
        cycle_start, cycle_end = self.engine._get_nanny_cycle_for_month(contract, 2025, 11)

        # Assertions
        assert cycle_start == date(2025, 11, 16) # Should NOT be adjusted
        assert cycle_end == date(2025, 11, 30)

    @patch('backend.extensions.db.session.get')
    def test_nanny_cycle_adjusted_start_beyond_month_end(self, mock_db_session_get, session):
        """
        测试调整后的开始日期超出目标月份的最后一天。
        前任合同: 2025-11-29 ~ 2025-11-30
        当前合同: 2025-11-30 ~ 2025-12-31 (previous_contract_id 指向前任合同)
        期望: 2025年11月不生成账单 (返回 None, None)。
        """
        # Mock previous contract
        previous_contract = BaseContract(
            id=1,
            start_date=date(2025, 11, 29),
            end_date=date(2025, 11, 30)
        )
        session.add(previous_contract)
        session.commit()

        # Mock current contract
        contract = NannyContract(
            id=2,
            start_date=date(2025, 11, 30),
            end_date=date(2025, 12, 31),
            previous_contract_id=1 # Link to previous contract
        )
        session.add(contract)
        session.commit()

        # Mock db.session.get to return the previous contract when queried
        mock_db_session_get.return_value = previous_contract

        # Call the method for the first month of the current contract
        cycle_start, cycle_end = self.engine._get_nanny_cycle_for_month(contract, 2025, 11)

        # Assertions
        assert cycle_start is None
        assert cycle_end is None

    @patch('backend.extensions.db.session.get')
    def test_nanny_cycle_second_month_of_adjusted_contract(self, mock_db_session_get, session):
        """
        测试调整后的合同的第二个月账单周期计算。
        前任合同: 2025-11-01 ~ 2025-11-16
        当前合同: 2025-11-16 ~ 2025-12-31 (previous_contract_id 指向前任合同)
        期望: 2025年12月账单周期从 2025-12-01 开始。
        """
        # Mock previous contract (not directly used in this specific call, but for context)
        previous_contract = BaseContract(
            id=1,
            start_date=date(2025, 11, 1),
            end_date=date(2025, 11, 16)
        )
        session.add(previous_contract)
        session.commit()

        # Mock current contract
        contract = NannyContract(
            id=2,
            start_date=date(2025, 11, 16),
            end_date=date(2025, 12, 31),
            previous_contract_id=1 # Link to previous contract
        )
        session.add(contract)
        session.commit()

        # Mock db.session.get to return the previous contract when queried
        mock_db_session_get.return_value = previous_contract

        # Call the method for the second month of the current contract (December)
        cycle_start, cycle_end = self.engine._get_nanny_cycle_for_month(contract, 2025, 12)

        # Assertions
        assert cycle_start == date(2025, 12, 1) # Should NOT be adjusted, as it's not the first month
        assert cycle_end == date(2025, 12, 31)
