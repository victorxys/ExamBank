#!/usr/bin/env python3
"""
Repair historical attendance data for issues 1, 2, 3 and 6.

The command is read-only by default:

    python scripts/repair_attendance_issues_1236.py --dry-run --year 2026 --month 8

Apply a scoped repair only after reviewing the dry-run output:

    python scripts/repair_attendance_issues_1236.py --apply --year 2026 --month 8

The repair does the following:

1. Rounds parseable historical times to the supported half-hour grid.
2. Re-syncs signed attendance forms so employee/customer/backend use the same
   merged contract window.
3. Recomputes separate rest and leave statistics from the form records.
6. Normalizes missing/legacy automatic overtime and re-syncs its persisted stats.

For production use, pass --form-id, --employee-id, --year/--month, or --all
when using --apply. A database backup is required before applying changes.
"""

import argparse
import copy
import sys
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))
load_dotenv(REPO_ROOT / "backend/.env")

from sqlalchemy.orm.attributes import flag_modified

from backend.app import app
from backend.models import AttendanceForm, db
from backend.services.attendance_sync_service import (
    normalize_auto_overtime_form_data,
    sync_attendance_to_record,
)


SIGNED_STATUSES = {"customer_signed", "synced"}
CONFIRMED_STATUSES = {"employee_confirmed", "customer_signed", "synced"}
ATTENDANCE_RECORD_KEYS = (
    "rest_records",
    "leave_records",
    "overtime_records",
    "out_of_beijing_records",
    "out_of_country_records",
    "paid_leave_records",
    "onboarding_records",
    "offboarding_records",
)


def _parse_time(value):
    if value is None or str(value).strip() == "":
        return None
    parts = str(value).strip().split(":")
    if len(parts) != 2 or not all(part.isdigit() for part in parts):
        return None
    hour, minute = (int(part) for part in parts)
    total = hour * 60 + minute
    if hour < 0 or hour > 24 or minute < 0 or minute >= 60 or total > 24 * 60:
        return None
    return total


def round_to_half_hour(value):
    """Return nearest half-hour text, or None when the value is not repairable."""
    total = _parse_time(value)
    if total is None:
        return None
    rounded = min(24 * 60, ((total + 15) // 30) * 30)
    if rounded == 24 * 60:
        return "24:00"
    return f"{rounded // 60:02d}:{rounded % 60:02d}"


def _duration_minutes(record):
    start = _parse_time(record.get("startTime"))
    end = _parse_time(record.get("endTime"))
    if start is None or end is None:
        return None

    days_offset = max(0, int(record.get("daysOffset") or 0))
    total = days_offset * 24 * 60 + end - start
    if days_offset == 0 and total <= 0:
        total += 24 * 60
    return max(0, total)


def _set_duration_fields(record, total_minutes):
    hours, minutes = divmod(int(total_minutes), 60)
    changed = record.get("hours") != hours or record.get("minutes") != minutes
    record["hours"] = hours
    record["minutes"] = minutes
    return changed


def normalize_form_time_precision(form_data):
    """Round valid-but-unsupported times and return change/error details."""
    data = copy.deepcopy(form_data or {})
    changes = []
    unrepairable = []

    for key in ATTENDANCE_RECORD_KEYS:
        records = data.get(key)
        if not isinstance(records, list):
            continue
        for index, record in enumerate(records):
            if not isinstance(record, dict):
                continue
            for field in ("startTime", "endTime"):
                value = record.get(field)
                if not value:
                    continue
                normalized = round_to_half_hour(value)
                if normalized is None:
                    unrepairable.append(f"{key}[{index}].{field}={value}")
                    continue
                if str(value) != normalized:
                    changes.append({
                        "path": f"{key}[{index}].{field}",
                        "before": value,
                        "after": normalized,
                    })
                    record[field] = normalized

            # Time fields are the source of truth for ordinary duration records.
            # Onboarding/offboarding records have separate business semantics and
            # historically keep hours/minutes at zero, so leave those fields alone.
            if record.get("type") not in ("onboarding", "offboarding"):
                total_minutes = _duration_minutes(record)
                if total_minutes is not None and _set_duration_fields(record, total_minutes):
                    changes.append({
                        "path": f"{key}[{index}].hours/minutes",
                        "before": "stored duration",
                        "after": f"{total_minutes // 60}h{total_minutes % 60}m",
                    })

    return data, changes, unrepairable


def _normalization_input(form, form_data):
    return SimpleNamespace(
        id=form.id,
        employee_id=form.employee_id,
        contract_id=form.contract_id,
        contract=form.contract,
        cycle_start_date=form.cycle_start_date,
        cycle_end_date=form.cycle_end_date,
        form_data=form_data,
    )


def build_repair_plan(form, issues):
    before = copy.deepcopy(form.form_data or {})
    candidate = before
    time_changes = []
    unrepairable = []

    if "1" in issues:
        candidate, time_changes, unrepairable = normalize_form_time_precision(candidate)

    auto_changed = False
    if "6" in issues and form.status in CONFIRMED_STATUSES:
        normalized, auto_changed = normalize_auto_overtime_form_data(
            _normalization_input(form, candidate),
            allow_create_missing_auto=True,
        )
        if auto_changed:
            candidate = normalized

    data_changed = candidate != before
    should_resync = form.status in SIGNED_STATUSES and (
        bool({"2", "3"} & issues)
        or "6" in issues
        or bool(time_changes)
    )

    return {
        "before": before,
        "after": candidate,
        "time_changes": time_changes,
        "unrepairable": unrepairable,
        "data_changed": data_changed,
        "auto_changed": auto_changed,
        "should_resync": should_resync,
    }


def _month_bounds(year, month):
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)
    return start, end


def _query_forms(args):
    query = AttendanceForm.query.order_by(
        AttendanceForm.cycle_start_date.asc(),
        AttendanceForm.id.asc(),
    )
    if args.form_id:
        query = query.filter(AttendanceForm.id == args.form_id)
    if args.employee_id:
        query = query.filter(AttendanceForm.employee_id == args.employee_id)
    if args.year and args.month:
        start, end = _month_bounds(args.year, args.month)
        query = query.filter(
            AttendanceForm.cycle_start_date >= start,
            AttendanceForm.cycle_start_date < end,
        )
    if args.limit:
        query = query.limit(args.limit)
    return query.all()


def _print_plan(form, plan):
    cycle_start = form.cycle_start_date.date() if isinstance(form.cycle_start_date, datetime) else form.cycle_start_date
    cycle_end = form.cycle_end_date.date() if isinstance(form.cycle_end_date, datetime) else form.cycle_end_date
    print(
        f"form={form.id} employee={form.employee_id} contract={form.contract_id} "
        f"cycle={cycle_start}~{cycle_end} status={form.status} "
        f"data_changed={plan['data_changed']} resync={plan['should_resync']}"
    )
    for change in plan["time_changes"]:
        print(f"  time {change['path']}: {change['before']} -> {change['after']}")
    if plan["auto_changed"]:
        print("  automatic overtime: normalize legacy/missing records")
    for item in plan["unrepairable"]:
        print(f"  UNREPAIRABLE TIME: {item}")


def _apply_form(form, plan):
    if plan["unrepairable"]:
        raise ValueError("存在无法自动修正的时间值: " + ", ".join(plan["unrepairable"]))

    if plan["data_changed"]:
        form.form_data = plan["after"]
        flag_modified(form, "form_data")

    if plan["should_resync"]:
        # sync_attendance_to_record is the canonical path that updates the
        # AttendanceRecord and recalculates the related bill/payroll.
        sync_attendance_to_record(form.id)
    elif plan["data_changed"]:
        db.session.commit()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Repair attendance issues 1, 2, 3 and 6.")
    parser.add_argument("--issues", default="1,2,3,6", help="Comma-separated issue numbers.")
    parser.add_argument("--form-id")
    parser.add_argument("--employee-id")
    parser.add_argument("--year", type=int)
    parser.add_argument("--month", type=int)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--all", action="store_true", help="Allow unscoped apply; dry-run does not need this.")
    parser.add_argument("--dry-run", action="store_true", help="Report changes without writing (default).")
    parser.add_argument("--apply", action="store_true", help="Write the approved repair.")
    args = parser.parse_args(argv)

    if args.apply and args.dry_run:
        parser.error("--apply and --dry-run cannot be used together")
    if args.month is not None and (args.month < 1 or args.month > 12):
        parser.error("--month must be between 1 and 12")
    if args.year is not None and args.month is None:
        parser.error("--year must be used together with --month")
    if args.month is not None and args.year is None:
        parser.error("--month must be used together with --year")

    issues = {item.strip() for item in args.issues.split(",") if item.strip()}
    unknown = issues - {"1", "2", "3", "6"}
    if unknown:
        parser.error(f"unsupported issue number(s): {', '.join(sorted(unknown))}")

    has_scope = bool(args.form_id or args.employee_id or (args.year and args.month))
    if args.apply and not has_scope and not args.all:
        parser.error("--apply requires --form-id, --employee-id, --year/--month, or --all")

    with app.app_context():
        forms = _query_forms(args)
        print(f"Mode: {'APPLY' if args.apply else 'DRY-RUN'}")
        print(f"Issues: {','.join(sorted(issues, key=lambda item: int(item)))}")
        print(f"Forms scanned: {len(forms)}")

        changed = 0
        resync_planned = 0
        resync_applied = 0
        failed = 0
        for form in forms:
            try:
                plan = build_repair_plan(form, issues)
                if plan["data_changed"] or plan["should_resync"] or plan["unrepairable"]:
                    changed += 1
                    _print_plan(form, plan)
                if plan["should_resync"]:
                    resync_planned += 1
                if args.apply and not plan["unrepairable"]:
                    _apply_form(form, plan)
                    if plan["should_resync"]:
                        resync_applied += 1
            except Exception as exc:
                failed += 1
                db.session.rollback()
                print(f"  FAILED form={form.id}: {exc}")

        if not args.apply:
            db.session.rollback()

        print(f"Forms needing repair: {changed}")
        print(f"Forms planned for re-sync: {resync_planned}")
        if args.apply:
            print(f"Forms re-synced: {resync_applied}")
        print(f"Forms failed: {failed}")
        if failed:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
