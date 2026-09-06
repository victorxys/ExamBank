from datetime import datetime
from types import SimpleNamespace
import pytest

from scripts import cleanup_month_end_renewal_payroll_transfers as cleanup_script

from backend.services import renewal_sync_service
from backend.services.renewal_sync_service import (
    cleanup_month_end_renewal_payroll_transfers,
    is_month_end_renewal,
)


def _contract(start_date, end_date=None):
    contract = SimpleNamespace(start_date=datetime.fromisoformat(start_date))
    if end_date is not None:
        contract.end_date = datetime.fromisoformat(end_date)
    return contract


def test_month_end_renewal_does_not_require_payroll_transfer():
    source = _contract("2026-07-01")
    successor = _contract("2026-08-01")

    assert is_month_end_renewal(source, successor) is True


def test_mid_month_renewal_still_requires_payroll_transfer():
    source = _contract("2026-07-01")
    successor = _contract("2026-07-16")

    assert is_month_end_renewal(source, successor) is False


def test_first_day_successor_is_not_month_end_when_source_ends_early():
    source = _contract("2026-07-01", "2026-07-15")
    successor = _contract("2026-08-01")

    assert is_month_end_renewal(source, successor) is False


def test_year_end_renewal_is_treated_as_month_end():
    source = _contract("2026-01-01")
    successor = _contract("2027-01-01")

    assert is_month_end_renewal(source, successor) is True


class _MappedQuery:
    def __init__(self, records):
        self.records = records
        self.criteria = {}

    def filter_by(self, **criteria):
        self.criteria = criteria
        return self

    def filter(self, *_criteria):
        return self

    def order_by(self, *_columns):
        return self

    def first(self):
        return self.records.get(self.criteria.get("contract_id"))

    def all(self):
        return list(self.records.values())


class _FakeSession:
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


class _FakeColumn:
    def asc(self):
        return self

    def desc(self):
        return self

    def in_(self, _values):
        return self


def _fake_model(query, *column_names):
    attributes = {"query": query}
    attributes.update({name: _FakeColumn() for name in column_names})
    return type("FakeModel", (), attributes)


def test_month_end_cleanup_removes_both_transfer_pairs(monkeypatch):
    source = SimpleNamespace(id="old", start_date=datetime(2026, 7, 1))
    successor = SimpleNamespace(id="new", start_date=datetime(2026, 8, 1))
    source_bill = SimpleNamespace(
        id="source-bill",
        contract_id="old",
        cycle_start_date=datetime(2026, 7, 1),
        cycle_end_date=datetime(2026, 7, 31),
        is_merged=True,
    )
    target_bill = SimpleNamespace(
        id="target-bill",
        contract_id="new",
        cycle_start_date=datetime(2026, 8, 1),
        cycle_end_date=datetime(2026, 8, 31),
    )
    source_payroll = SimpleNamespace(id="source-payroll")
    target_payroll = SimpleNamespace(id="target-payroll")
    transfers = {
        "source-base": SimpleNamespace(
            id="source-base",
            employee_payroll_id="source-payroll",
            description=renewal_sync_service.BASE_TRANSFER_SOURCE_DESCRIPTION,
            details={"linked_bill_id": "target-bill"},
        ),
        "source-overtime": SimpleNamespace(
            id="source-overtime",
            employee_payroll_id="source-payroll",
            description=renewal_sync_service.OVERTIME_TRANSFER_SOURCE_DESCRIPTION,
            details={"linked_bill_id": "target-bill"},
        ),
        "target-base": SimpleNamespace(
            id="target-base",
            employee_payroll_id="target-payroll",
            description=renewal_sync_service.BASE_TRANSFER_TARGET_DESCRIPTION,
            details={"linked_bill_id": "source-bill"},
        ),
        "target-overtime": SimpleNamespace(
            id="target-overtime",
            employee_payroll_id="target-payroll",
            description=renewal_sync_service.OVERTIME_TRANSFER_TARGET_DESCRIPTION,
            details={"linked_bill_id": "source-bill"},
        ),
    }
    fake_session = _FakeSession()

    monkeypatch.setattr(
        renewal_sync_service,
        "CustomerBill",
        _fake_model(
            _MappedQuery({"old": source_bill, "new": target_bill}),
            "cycle_end_date",
            "cycle_start_date",
        ),
    )
    monkeypatch.setattr(
        renewal_sync_service,
        "EmployeePayroll",
        _fake_model(
            _MappedQuery({"old": source_payroll, "new": target_payroll}),
            "cycle_start_date",
        ),
    )
    monkeypatch.setattr(
        renewal_sync_service,
        "FinancialAdjustment",
        _fake_model(
            _MappedQuery(transfers),
            "employee_payroll_id",
            "description",
        ),
    )
    monkeypatch.setattr(
        renewal_sync_service,
        "db",
        SimpleNamespace(session=fake_session),
    )
    monkeypatch.setattr(
        renewal_sync_service,
        "current_app",
        SimpleNamespace(logger=SimpleNamespace(info=lambda *_args: None)),
    )

    cleaned = cleanup_month_end_renewal_payroll_transfers(
        source,
        successor,
        2026,
        7,
        recalculate=False,
    )

    assert cleaned == 4
    assert fake_session.deleted == list(transfers.values())
    assert source_bill.is_merged is False
    assert fake_session.added == [source_bill]
    assert fake_session.flush_count == 1


def test_cleanup_script_rolls_back_when_recalculation_fails(monkeypatch):
    source_bill = SimpleNamespace(cycle_end_date=datetime(2026, 7, 31), is_merged=True)
    adjustment = SimpleNamespace(id="transfer")

    class RollbackSession:
        def __init__(self):
            self.deleted = []
            self.committed = 0
            self.rolled_back = 0

        def commit(self):
            self.committed += 1

        def rollback(self):
            self.rolled_back += 1
            source_bill.is_merged = True
            self.deleted.clear()

    session = RollbackSession()
    monkeypatch.setattr(
        cleanup_script,
        "db",
        SimpleNamespace(session=session),
    )

    def fail_after_mutation(*_args, **_kwargs):
        source_bill.is_merged = False
        session.deleted.append(adjustment)
        raise RuntimeError("模拟重算失败")

    monkeypatch.setattr(
        cleanup_script,
        "cleanup_month_end_renewal_payroll_transfers",
        fail_after_mutation,
    )

    candidate = cleanup_script.Candidate(
        source_contract=SimpleNamespace(id="old"),
        successor=SimpleNamespace(id="new"),
        source_bill=source_bill,
        target_bill=SimpleNamespace(id="target"),
        transfer_count=1,
    )

    with pytest.raises(RuntimeError, match="模拟重算失败"):
        cleanup_script.apply_candidates([candidate])

    assert source_bill.is_merged is True
    assert session.deleted == []
    assert session.committed == 0
    assert session.rolled_back == 1
