#!/usr/bin/env python3
"""
Normalize legacy auto-filled overtime records in attendance forms.

Dry run:
    python scripts/normalize_attendance_auto_overtime.py --dry-run

Apply form_data fixes:
    python scripts/normalize_attendance_auto_overtime.py --apply

Apply and re-sync signed/synced forms into AttendanceRecord/billing:
    python scripts/normalize_attendance_auto_overtime.py --apply --sync-signed
"""

import argparse
import sys
from decimal import Decimal
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

load_dotenv(REPO_ROOT / "backend/.env")

from backend.app import app
from backend.models import db, AttendanceForm
from backend.services.attendance_sync_service import (
    normalize_auto_overtime_form_data,
    sync_attendance_to_record,
)


def overtime_days(form_data):
    total_hours = Decimal("0")
    for record in (form_data or {}).get("overtime_records", []):
        hours = Decimal(str(record.get("hours", 0) or 0))
        minutes = Decimal(str(record.get("minutes", 0) or 0))
        total_hours += hours + minutes / Decimal("60")
    return total_hours / Decimal("24")


def main():
    parser = argparse.ArgumentParser(
        description="Normalize legacy attendance auto-overtime records."
    )
    parser.add_argument("--dry-run", action="store_true", help="Only report changes.")
    parser.add_argument("--apply", action="store_true", help="Write normalized form_data.")
    parser.add_argument(
        "--sync-signed",
        action="store_true",
        help="After applying, re-sync customer_signed/synced forms to AttendanceRecord and billing.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Limit forms scanned.")
    args = parser.parse_args()

    if args.apply and args.dry_run:
        raise SystemExit("Use either --dry-run or --apply, not both.")
    if not args.apply and not args.dry_run:
        args.dry_run = True

    with app.app_context():
        query = AttendanceForm.query.filter(AttendanceForm.form_data.isnot(None)).order_by(
            AttendanceForm.cycle_start_date.asc()
        )
        if args.limit:
            query = query.limit(args.limit)

        scanned = 0
        changed = 0
        synced = 0
        examples = []

        for form in query.yield_per(100):
            scanned += 1
            before_data = form.form_data or {}
            before_days = overtime_days(before_data)
            normalized_data, is_changed = normalize_auto_overtime_form_data(form)

            if not is_changed:
                continue

            changed += 1
            after_days = overtime_days(normalized_data)
            examples.append(
                {
                    "form_id": str(form.id),
                    "employee_id": str(form.employee_id),
                    "contract_id": str(form.contract_id),
                    "cycle": f"{form.cycle_start_date.date()}~{form.cycle_end_date.date()}",
                    "status": form.status,
                    "before": str(before_days.quantize(Decimal("0.001"))),
                    "after": str(after_days.quantize(Decimal("0.001"))),
                }
            )

            if args.apply:
                form.form_data = normalized_data
                db.session.add(form)
                db.session.flush()

                if args.sync_signed and form.status in ("customer_signed", "synced"):
                    sync_attendance_to_record(form.id)
                    synced += 1

        if args.apply:
            db.session.commit()
        else:
            db.session.rollback()

        mode = "APPLY" if args.apply else "DRY-RUN"
        print(f"Mode: {mode}")
        print(f"Scanned forms: {scanned}")
        print(f"Forms needing normalization: {changed}")
        if args.apply:
            print(f"Forms re-synced: {synced}")
        print("Examples:")
        for item in examples[:20]:
            print(
                f"  {item['cycle']} form={item['form_id']} status={item['status']} "
                f"overtime {item['before']} -> {item['after']} "
                f"employee={item['employee_id']} contract={item['contract_id']}"
            )


if __name__ == "__main__":
    main()
