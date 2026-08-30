from unittest.mock import MagicMock, call, patch
from datetime import datetime
from decimal import Decimal as D
from types import SimpleNamespace

from flask import Flask

from backend.api import utils as billing_utils
import backend.services.billing_engine as billing_engine_module
import backend.services.contract_service as contract_service_module
from backend.tasks import auto_check_and_extend_renewal_bills_task
from backend.services.billing_engine import BillingEngine


def _contract(contract_id):
    contract = MagicMock()
    contract.id = contract_id
    return contract


@patch("backend.tasks.get_task_logger")
@patch("backend.tasks.BillingEngine")
@patch("backend.tasks.NannyContract")
@patch("backend.tasks.create_flask_app_for_task")
@patch("backend.tasks.db")
def test_auto_renew_task_commits_each_contract(
    mock_db,
    mock_create_app,
    mock_contract_model,
    mock_engine_class,
    _mock_task_logger,
):
    mock_create_app.return_value = Flask(__name__)
    mock_contract_model.query.filter.return_value.all.return_value = [
        _contract("contract-1"),
        _contract("contract-2"),
    ]

    result = auto_check_and_extend_renewal_bills_task.run()

    mock_engine_class.return_value.extend_auto_renew_bills.assert_has_calls(
        [call("contract-1"), call("contract-2")]
    )
    assert mock_db.session.commit.call_count == 2
    mock_db.session.rollback.assert_not_called()
    assert result == {
        "status": "Success",
        "message": "每周自动续约检查任务完成。成功 2 个，失败 0 个。",
        "processed": 2,
        "failed": 0,
        "failed_contract_ids": [],
    }


@patch("backend.tasks.get_task_logger")
@patch("backend.tasks.BillingEngine")
@patch("backend.tasks.NannyContract")
@patch("backend.tasks.create_flask_app_for_task")
@patch("backend.tasks.db")
def test_auto_renew_task_rolls_back_failure_and_continues(
    mock_db,
    mock_create_app,
    mock_contract_model,
    mock_engine_class,
    mock_task_logger,
):
    mock_create_app.return_value = Flask(__name__)
    mock_contract_model.query.filter.return_value.all.return_value = [
        _contract("contract-1"),
        _contract("contract-2"),
        _contract("contract-3"),
    ]
    mock_engine_class.return_value.extend_auto_renew_bills.side_effect = [
        None,
        RuntimeError("generation failed"),
        None,
    ]

    result = auto_check_and_extend_renewal_bills_task.run()

    mock_engine_class.return_value.extend_auto_renew_bills.assert_has_calls(
        [call("contract-1"), call("contract-2"), call("contract-3")]
    )
    assert mock_db.session.commit.call_count == 2
    mock_db.session.rollback.assert_called_once_with()
    assert result["status"] == "PartialSuccess"
    assert result["processed"] == 2
    assert result["failed"] == 1
    assert result["failed_contract_ids"] == ["contract-2"]
    mock_task_logger.return_value.warning.assert_called_once()


def test_substitute_details_accepts_all_adjustments():
    """回归：_get_adjustments 返回 7 项时，替班账单计算应继续执行。"""
    app = Flask(__name__)
    with app.app_context():
        engine = BillingEngine()
        sub_record = SimpleNamespace(
            id="substitute-record",
            substitute_user_id="substitute-user",
            substitute_personnel_id=None,
            start_date=datetime(2026, 8, 1),
            end_date=datetime(2026, 8, 2),
            overtime_days=D("0"),
            substitute_salary=D("9000"),
            substitute_type="nanny",
            substitute_management_fee_rate=D("0"),
            substitute_management_fee=D("0"),
        )
        main_contract = SimpleNamespace(id="contract", type="nanny")
        bill = SimpleNamespace(id="bill", is_substitute_bill=True, actual_work_days=None)
        payroll = SimpleNamespace(id="payroll")

        with patch.object(
            engine,
            "_get_adjustments",
            return_value=(D("0"), D("0"), D("0"), D("0"), D("0"), D("0"), D("0")),
        ), patch("backend.services.billing_engine.db.session.add"):
            details = engine._calculate_substitute_details(
                sub_record,
                main_contract,
                bill,
                payroll,
            )

        assert details["base_work_days"] == "1.000"
        assert details["total_days_worked"] == "1.000"


def test_substitute_bill_details_without_attendance_record(monkeypatch):
    """回归：替班账单没有考勤记录时，详情接口仍应正常返回。"""

    class _Column:
        def __eq__(self, _other):
            return self

        def __lt__(self, _other):
            return self

        def __gt__(self, _other):
            return self

        def asc(self):
            return self

        def desc(self):
            return self

    class _Query:
        def filter(self, *_args):
            return self

        def filter_by(self, **_kwargs):
            return self

        def order_by(self, *_args):
            return self

        def first(self):
            return None

        def all(self):
            return []

        def exists(self):
            return self

    class _Model:
        query = _Query()
        contract_id = _Column()
        cycle_start_date = _Column()
        cycle_end_date = _Column()
        is_substitute_bill = _Column()

    substitute_employee = SimpleNamespace(id="substitute-employee", username="替班阿姨", name="替班阿姨")
    substitute_record = SimpleNamespace(
        substitute_salary=D("9000"),
        overtime_days=D("1"),
        substitute_user=substitute_employee,
        substitute_personnel=None,
    )
    contract = SimpleNamespace(
        id="contract",
        type="nanny",
        customer_name="测试客户",
        status="active",
        actual_onboarding_date=None,
        start_date=datetime(2026, 8, 1),
        end_date=datetime(2026, 8, 31),
        expected_offboarding_date=None,
        notes=None,
        family_id=None,
        service_personnel=None,
        next_contracts=[],
        is_monthly_auto_renew=False,
    )
    bill = SimpleNamespace(
        id="bill",
        contract=contract,
        cycle_start_date=datetime(2026, 8, 1),
        cycle_end_date=datetime(2026, 8, 2),
        year=2026,
        month=8,
        is_substitute_bill=True,
        source_substitute_record=substitute_record,
        is_merged=False,
        calculation_details={},
        total_due=D("100"),
        total_paid=D("0"),
        payment_status=SimpleNamespace(value="pending"),
        payment_details={},
        payment_records=[],
    )

    fake_session = SimpleNamespace(
        get=lambda _model, _bill_id: bill,
        query=lambda *_args: SimpleNamespace(scalar=lambda: False),
    )
    monkeypatch.setattr(billing_utils, "CustomerBill", _Model)
    monkeypatch.setattr(billing_utils, "EmployeePayroll", _Model)
    monkeypatch.setattr(billing_utils, "FinancialAdjustment", _Model)
    monkeypatch.setattr(billing_utils, "db", SimpleNamespace(session=fake_session))
    monkeypatch.setattr(
        billing_utils,
        "_get_details_template",
        lambda *_args: (
            {
                "groups": [
                    {"name": "级别与保证金", "fields": {}},
                    {"name": "劳务周期", "fields": {}},
                    {"name": "费用明细", "fields": {}},
                ]
            },
            {"groups": [{"name": "薪酬明细", "fields": {}}]},
        ),
    )
    monkeypatch.setattr(billing_utils, "_find_successor_contract_internal", lambda _id: None)
    monkeypatch.setattr(billing_utils, "_find_predecessor_contract_internal", lambda _id: None)

    details = billing_utils.get_billing_details_internal(bill_id="bill")

    assert details["is_substitute_bill"] is True
    assert details["attendance"]["record_id"] is None
    assert details["attendance"]["overtime_days"] == 1.0


def test_substitute_payroll_skips_deposit_salary_mirror():
    """回归：替班工资单不能创建“保证金支付工资”镜像。"""
    app = Flask(__name__)
    with app.app_context():
        engine = BillingEngine()
        company_adjustment = SimpleNamespace(id="company-adjustment")
        payroll = SimpleNamespace(id="substitute-payroll", is_substitute_payroll=True)

        with patch.object(billing_engine_module.db.session, "add") as add_mock:
            engine._mirror_company_paid_salary_adjustment(company_adjustment, payroll)

        add_mock.assert_not_called()


def test_substitute_deposit_salary_adjustments_are_cleaned(monkeypatch):
    """回归：替班重算会清理账单和工资单上的历史保证金支付工资项。"""

    class _Query:
        def __init__(self, rows):
            self.rows = rows

        def filter(self, *_args):
            return self

        def all(self):
            return self.rows

    class _Session:
        def __init__(self):
            self.deleted = []
            self.added = []
            self.flush_count = 0

        def delete(self, value):
            self.deleted.append(value)

        def add(self, value):
            self.added.append(value)

        def flush(self):
            self.flush_count += 1

    owner = SimpleNamespace(mirrored_adjustment_id="old-deposit")
    deposit_adjustment = SimpleNamespace(mirror_of=owner)
    session = _Session()

    bill = SimpleNamespace(
        id="substitute-bill",
        contract_id="contract",
        cycle_start_date=datetime(2026, 8, 1),
        is_substitute_bill=True,
    )
    payroll = SimpleNamespace(id="substitute-payroll")

    app = Flask(__name__)
    with app.app_context():
        monkeypatch.setattr(
            billing_engine_module,
            "db",
            SimpleNamespace(session=session),
        )
        monkeypatch.setattr(
            billing_engine_module.FinancialAdjustment,
            "query",
            _Query([deposit_adjustment]),
            raising=False,
        )
        removed = BillingEngine()._remove_substitute_deposit_paid_salary_adjustments(
            bill, payroll
        )

    assert removed == 1
    assert session.deleted == [deposit_adjustment]
    assert owner.mirrored_adjustment_id is None
    assert session.flush_count == 1


def test_substitute_bill_amount_ignores_deposit_paid_salary(monkeypatch):
    """回归：替班账单只统计公司代付工资，普通合同仍统计保证金代付工资。"""

    company_adjustment = SimpleNamespace(
        adjustment_type=billing_engine_module.AdjustmentType.COMPANY_PAID_SALARY,
        amount=D("100"),
    )
    deposit_adjustment = SimpleNamespace(
        adjustment_type=billing_engine_module.AdjustmentType.DEPOSIT_PAID_SALARY,
        amount=D("50"),
    )

    class _Query:
        def __init__(self, rows):
            self.rows = rows

        def filter(self, *_args):
            return self

        def all(self):
            return self.rows

    class _Session:
        def __init__(self, rows):
            self.rows = rows

        def query(self, *_args):
            return _Query(self.rows)

    for is_substitute_bill, expected_total in ((True, D("100")), (False, D("150"))):
        bill = SimpleNamespace(
            id="bill",
            is_substitute_bill=is_substitute_bill,
            total_due=D("0"),
        )
        payroll = SimpleNamespace(total_due=D("0"))
        details = {
            "management_fee": "0",
            "introduction_fee": "0",
            "customer_increase": "0",
            "deferred_fee": "0",
            "extension_fee_reason": "0",
            "customer_decrease": "0",
            "discount": "0",
            "employee_base_payout": "0",
            "employee_overtime_payout": "0",
            "extension_fee": "0",
            "employee_increase": "0",
            "employee_decrease": "0",
            "employee_balance_transfer": "0",
            "employee_commission": "0",
        }

        rows = [company_adjustment]
        if not is_substitute_bill:
            rows.append(deposit_adjustment)
        monkeypatch.setattr(
            billing_engine_module,
            "db",
            SimpleNamespace(session=_Session(rows)),
        )

        with Flask(__name__).app_context():
            BillingEngine()._calculate_final_amounts(bill, payroll, details)

        assert bill.total_due == expected_total


def test_batch_update_filters_substitute_deposit_salary_adjustments():
    """回归：旧前端回传的替班保证金支付工资项不会再次写回。"""
    from backend.api.billing_api import _filter_substitute_deposit_paid_salary_adjustments

    app = Flask(__name__)
    bill = SimpleNamespace(id="substitute-bill", is_substitute_bill=True)
    with app.app_context():
        filtered = _filter_substitute_deposit_paid_salary_adjustments(
            [
                {"id": "deposit", "adjustment_type": "deposit_paid_salary"},
                {"id": "increase", "adjustment_type": "employee_increase"},
            ],
            bill,
        )

    assert filtered == [{"id": "increase", "adjustment_type": "employee_increase"}]


def test_renewal_deposit_transfer_recalculates_after_transfer_adjustments(monkeypatch):
    """回归：续约保证金转移创建调整项后，会再次重算旧账单。"""

    class _Column:
        def desc(self):
            return self

    class _Query:
        def filter_by(self, **_kwargs):
            return self

        def order_by(self, *_args):
            return self

        def first(self):
            return last_bill

        def all(self):
            return []

    class _Adjustment:
        query = _Query()

        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class _CustomerBill:
        query = _Query()
        cycle_end_date = _Column()

    class _Session:
        def __init__(self):
            self.added = []

        def add(self, value):
            self.added.append(value)

    last_bill = SimpleNamespace(
        id="old-bill",
        year=2026,
        month=8,
        contract_id="old-contract",
        cycle_start_date=datetime(2026, 8, 1),
        financial_adjustments=_Query(),
    )
    old_contract = SimpleNamespace(
        id="old-contract",
        security_deposit_paid=D("8800"),
    )
    renewed_contract = SimpleNamespace(
        id="renewed-contract",
        start_date=datetime(2026, 8, 8),
    )
    session = _Session()
    engine_mock = MagicMock()

    monkeypatch.setattr(contract_service_module, "CustomerBill", _CustomerBill)
    monkeypatch.setattr(contract_service_module, "FinancialAdjustment", _Adjustment)
    monkeypatch.setattr(
        contract_service_module,
        "db",
        SimpleNamespace(session=session),
    )
    monkeypatch.setattr(contract_service_module, "BillingEngine", lambda: engine_mock)

    service = contract_service_module.ContractService()
    monkeypatch.setattr(service, "_prepare_old_contract_for_renewal", MagicMock())
    monkeypatch.setattr(service, "_delete_non_transferable_adjustments", MagicMock())

    service._ensure_renewal_deposit_transfer(
        old_contract,
        renewed_contract,
        datetime(2026, 8, 7).date(),
    )

    engine_mock.calculate_for_month.assert_called_once_with(
        year=2026,
        month=8,
        contract_id="old-contract",
        force_recalculate=True,
        cycle_start_date_override=datetime(2026, 8, 1),
        end_date_override=datetime(2026, 8, 7).date(),
    )
    assert len(session.added) == 2
