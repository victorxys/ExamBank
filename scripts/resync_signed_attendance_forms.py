#!/usr/bin/env python3
"""
Re-sync signed attendance forms into AttendanceRecord and billing/payroll.

Dry run:
    python scripts/resync_signed_attendance_forms.py --year 2026 --month 5 --dry-run

Apply:
    python scripts/resync_signed_attendance_forms.py --year 2026 --month 5 --apply

Apply for one contract:
    python scripts/resync_signed_attendance_forms.py --year 2026 --month 5 --contract-id <uuid> --apply
"""

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

load_dotenv(REPO_ROOT / "backend/.env")

from backend.app import app
from backend.models import AttendanceForm, AttendanceRecord, CustomerBill, EmployeePayroll
from backend.services.attendance_sync_service import sync_attendance_to_record


def main():
    parser = argparse.ArgumentParser(
        description="Re-sync signed attendance forms to AttendanceRecord and billing/payroll."
    )
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--month", type=int, required=True)
    parser.add_argument("--contract-id", help="Only sync this contract ID.")
    parser.add_argument("--dry-run", action="store_true", help="Only report target forms.")
    parser.add_argument("--apply", action="store_true", help="Run sync_attendance_to_record.")
    args = parser.parse_args()

    if args.apply and args.dry_run:
        raise SystemExit("Use either --dry-run or --apply, not both.")
    if not args.apply and not args.dry_run:
        args.dry_run = True

    with app.app_context():
        query = AttendanceForm.query.filter(
            AttendanceForm.cycle_start_date >= f"{args.year}-{args.month:02d}-01",
            AttendanceForm.cycle_start_date < (
                f"{args.year + 1}-01-01" if args.month == 12 else f"{args.year}-{args.month + 1:02d}-01"
            ),
            AttendanceForm.status.in_(["customer_signed", "synced"]),
        ).order_by(AttendanceForm.cycle_start_date.asc(), AttendanceForm.updated_at.desc())

        if args.contract_id:
            query = query.filter(AttendanceForm.contract_id == args.contract_id)

        forms = query.all()
        print(f"Mode: {'APPLY' if args.apply else 'DRY-RUN'}")
        print(f"Target signed forms: {len(forms)}")

        synced = 0
        for form in forms:
            attendance = AttendanceRecord.query.filter_by(
                contract_id=form.contract_id,
                cycle_start_date=form.cycle_start_date,
            ).first()
            bill = CustomerBill.query.filter_by(
                contract_id=form.contract_id,
                year=args.year,
                month=args.month,
                is_substitute_bill=False,
            ).first()
            payroll = EmployeePayroll.query.filter_by(
                contract_id=form.contract_id,
                year=args.year,
                month=args.month,
            ).first()

            print(
                f"form={form.id} contract={form.contract_id} employee={form.employee_id} "
                f"status={form.status} signed={bool(form.customer_signed_at)} "
                f"attendance_record={attendance.id if attendance else None} "
                f"record_form={attendance.attendance_form_id if attendance else None} "
                f"bill={bill.id if bill else None} payroll={payroll.id if payroll else None}"
            )

            if args.apply:
                sync_attendance_to_record(form.id)
                synced += 1

        print(f"Synced forms: {synced}")


if __name__ == "__main__":
    main()
