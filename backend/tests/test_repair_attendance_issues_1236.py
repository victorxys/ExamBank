from datetime import datetime
from types import SimpleNamespace

from scripts.repair_attendance_issues_1236 import (
    _apply_form,
    build_repair_plan,
    normalize_form_time_precision,
    round_to_half_hour,
)
from backend.services.attendance_sync_service import normalize_auto_overtime_form_data


def test_round_to_half_hour_uses_nearest_half_hour_and_24_boundary():
    assert round_to_half_hour("17:14") == "17:00"
    assert round_to_half_hour("17:15") == "17:30"
    assert round_to_half_hour("23:46") == "24:00"
    assert round_to_half_hour("24:30") is None


def test_normalize_form_time_precision_updates_duration_from_normalized_times():
    normalized, changes, unrepairable = normalize_form_time_precision(
        {
            "leave_records": [
                {
                    "date": "2026-08-10",
                    "type": "leave",
                    "startTime": "17:15",
                    "endTime": "19:14",
                    "daysOffset": 0,
                    "hours": 1,
                    "minutes": 59,
                }
            ],
        }
    )

    record = normalized["leave_records"][0]
    assert record["startTime"] == "17:30"
    assert record["endTime"] == "19:00"
    assert (record["hours"], record["minutes"]) == (1, 30)
    assert len(changes) == 3
    assert unrepairable == []


def test_repair_plan_keeps_existing_115_hour_auto_overtime_data(monkeypatch):
    form = SimpleNamespace(
        id="form-1",
        employee_id="employee-1",
        contract_id="contract-1",
        contract=SimpleNamespace(type="nanny"),
        cycle_start_date=datetime(2026, 8, 1),
        cycle_end_date=datetime(2026, 8, 31),
        status="customer_signed",
        form_data={
            "overtime_records": [
                {
                    "date": "2026-08-27",
                    "type": "overtime",
                    "startTime": "00:00",
                    "endTime": "24:00",
                    "hours": 96,
                    "minutes": 0,
                    "daysOffset": 3,
                    "is_auto": True,
                },
                {
                    "date": "2026-08-31",
                    "type": "overtime",
                    "startTime": "05:00",
                    "endTime": "24:00",
                    "hours": 19,
                    "minutes": 0,
                    "daysOffset": 0,
                    "is_auto": True,
                },
            ]
        },
    )

    monkeypatch.setattr(
        "scripts.repair_attendance_issues_1236.normalize_auto_overtime_form_data",
        lambda form, allow_create_missing_auto: (form.form_data, False),
    )
    plan = build_repair_plan(form, {"6"})

    assert plan["data_changed"] is False
    assert plan["auto_changed"] is False
    assert plan["should_resync"] is True


def test_apply_form_writes_candidate_then_calls_canonical_sync(monkeypatch):
    form = SimpleNamespace(
        id="form-apply",
        form_data={"rest_records": []},
    )
    synced = []
    candidate = {"rest_records": [{"date": "2026-08-10", "hours": 24, "minutes": 0}]}

    monkeypatch.setattr(
        "scripts.repair_attendance_issues_1236.flag_modified",
        lambda *args: None,
    )
    monkeypatch.setattr(
        "scripts.repair_attendance_issues_1236.sync_attendance_to_record",
        lambda form_id: synced.append(form_id),
    )

    _apply_form(
        form,
        {
            "after": candidate,
            "data_changed": True,
            "unrepairable": [],
            "should_resync": True,
        },
    )

    assert form.form_data == candidate
    assert synced == ["form-apply"]


def test_existing_auto_overtime_total_is_not_recalculated(monkeypatch):
    from datetime import date

    form = SimpleNamespace(
        employee_id="employee-1",
        contract_id="contract-1",
        contract=SimpleNamespace(type="nanny"),
        cycle_start_date=datetime(2026, 8, 1),
        cycle_end_date=datetime(2026, 8, 31),
        form_data={
            "overtime_records": [
                {
                    "date": "2026-08-27",
                    "startTime": "00:00",
                    "endTime": "24:00",
                    "hours": 96,
                    "minutes": 0,
                    "daysOffset": 3,
                    "is_auto": True,
                },
                {
                    "date": "2026-08-31",
                    "startTime": "05:00",
                    "endTime": "24:00",
                    "hours": 19,
                    "minutes": 0,
                    "daysOffset": 0,
                    "is_auto": True,
                },
            ]
        },
    )

    monkeypatch.setattr(
        "backend.services.attendance_sync_service._valid_days_for_cycle",
        lambda *args: [date(2026, 8, day) for day in range(1, 32)],
    )

    normalized, changed = normalize_auto_overtime_form_data(
        form,
        allow_create_missing_auto=True,
    )

    assert changed is False
    assert normalized == form.form_data
