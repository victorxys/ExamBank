#!/usr/bin/env python3
"""
Audit and optionally resync June attendance forms whose holiday overtime can
affect billing.

Dry run:
    python scripts/fix_june_holiday_overtime_billing.py --host https://hr.mengyimengsao.com

Apply:
    python scripts/fix_june_holiday_overtime_billing.py --host https://hr.mengyimengsao.com --apply
"""

import argparse
import logging
import sys
from copy import deepcopy
from decimal import Decimal
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy.orm.attributes import flag_modified

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

load_dotenv(REPO_ROOT / "backend/.env")
logging.getLogger().setLevel(logging.ERROR)
logging.disable(logging.WARNING)

from backend.app import app
from backend.models import AttendanceForm, AttendanceRecord, CustomerBill, EmployeePayroll, db
from backend.services.attendance_sync_service import (
    _parse_date,
    _record_covers_day,
    _split_overtime_days_by_holiday,
    _valid_days_for_cycle,
    normalize_auto_overtime_form_data,
    sync_attendance_to_record,
)


def D(value):
    return Decimal(str(value or 0))


def fmt_decimal(value):
    value = D(value).quantize(Decimal("0.001"))
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def build_urls(host, form):
    base = host.rstrip("/")
    contract_id = str(form.contract_id)
    employee_id = str(form.employee_id)
    return (
        f"{base}/contract/detail/{contract_id}",
        f"{base}/attendance-admin/{employee_id}?year={form.cycle_start_date.year}"
        f"&month={form.cycle_start_date.month}&contractId={contract_id}",
    )


def total_record_overtime(attendance):
    if not attendance:
        return Decimal("0")
    return D(attendance.overtime_days) + D(attendance.statutory_holiday_days)


def bill_overtime_days(bill):
    if not bill:
        return Decimal("0")
    details = bill.calculation_details or {}
    return D(details.get("overtime_days"))


def employee_name(form):
    contract = form.contract
    personnel = contract.service_personnel if contract else None
    return getattr(personnel, "name", None) or getattr(personnel, "username", None) or str(form.employee_id)


def customer_name(form):
    contract = form.contract
    return getattr(contract, "customer_name", None) or str(form.contract_id)


def has_june_statutory_overtime(form_data):
    try:
        cycle_start = _parse_date("2026-06-01")
        cycle_end = _parse_date("2026-06-30")
        _, holiday_days = _split_overtime_days_by_holiday(form_data or {}, cycle_start, cycle_end)
        return holiday_days
    except Exception:
        return Decimal("0")


def needs_manual_holiday_review(form):
    holiday_date = _parse_date("2026-06-19")
    try:
        valid_days = set(_valid_days_for_cycle(
            form,
            _parse_date(form.cycle_start_date),
            _parse_date(form.cycle_end_date),
        ))
    except Exception:
        valid_days = set()
    if holiday_date not in valid_days:
        return False

    form_data = form.form_data or {}
    if any(_record_covers_day(record, holiday_date) for record in form_data.get("overtime_records") or []):
        return False
    for key in ("rest_records", "leave_records", "paid_leave_records"):
        if any(_record_covers_day(record, holiday_date) for record in form_data.get(key) or []):
            return False
    return True


def analyze_form(form):
    cycle_start = _parse_date(form.cycle_start_date)
    cycle_end = _parse_date(form.cycle_end_date)
    original_data = deepcopy(form.form_data or {})
    normalized_data, normalized_changed = normalize_auto_overtime_form_data(
        form,
        allow_create_missing_auto=True,
    )
    normal_days, holiday_days = _split_overtime_days_by_holiday(normalized_data, cycle_start, cycle_end)
    expected_overtime_days = normal_days + holiday_days

    attendance = AttendanceRecord.query.filter_by(
        contract_id=form.contract_id,
        cycle_start_date=form.cycle_start_date,
    ).first()
    bill = CustomerBill.query.filter_by(
        contract_id=form.contract_id,
        year=2026,
        month=6,
        is_substitute_bill=False,
    ).first()
    payroll = EmployeePayroll.query.filter_by(
        contract_id=form.contract_id,
        year=2026,
        month=6,
        is_substitute_payroll=False,
    ).first()

    record_overtime = total_record_overtime(attendance)
    current_bill_overtime = bill_overtime_days(bill)
    record_has_legacy_holiday = bool(attendance and D(attendance.statutory_holiday_days) > 0)
    needs_resync = (
        normalized_changed
        or record_has_legacy_holiday
        or expected_overtime_days.quantize(Decimal("0.001")) != record_overtime.quantize(Decimal("0.001"))
        or expected_overtime_days.quantize(Decimal("0.001")) != current_bill_overtime.quantize(Decimal("0.001"))
    )

    return {
        "form": form,
        "original_data": original_data,
        "normalized_data": normalized_data,
        "normalized_changed": normalized_changed,
        "holiday_days": holiday_days,
        "normal_days": normal_days,
        "expected_overtime_days": expected_overtime_days,
        "attendance": attendance,
        "bill": bill,
        "payroll": payroll,
        "record_overtime": record_overtime,
        "bill_overtime_days": current_bill_overtime,
        "needs_resync": needs_resync,
    }


def print_case(case, host, index):
    form = case["form"]
    contract_url, attendance_url = build_urls(host, form)
    status = "需处理" if case["needs_resync"] else "无需处理"
    print(f"\n[{index}] {status} | {customer_name(form)} | {employee_name(form)}")
    print(f"合同: {contract_url}")
    print(f"考勤: {attendance_url}")
    print(
        "加班: "
        f"表单总计 {fmt_decimal(case['expected_overtime_days'])} 天 "
        f"(法定/休假类 {fmt_decimal(case['holiday_days'])} 天, 普通/自动 {fmt_decimal(case['normal_days'])} 天), "
        f"AttendanceRecord 当前 {fmt_decimal(case['record_overtime'])} 天, "
        f"账单当前 {fmt_decimal(case['bill_overtime_days'])} 天"
    )
    if case["normalized_changed"]:
        original_count = len((case["original_data"] or {}).get("overtime_records") or [])
        new_count = len((case["normalized_data"] or {}).get("overtime_records") or [])
        print(f"自动补齐: 将更新 overtime_records 数量 {original_count} -> {new_count}")
    if not case["bill"]:
        print("提示: 未找到 2026-06 主账单，apply 只会同步考勤，无法重算对应账单")


def restore_form_data(form, original_data):
    form.form_data = original_data
    flag_modified(form, "form_data")
    db.session.add(form)
    db.session.commit()


def main():
    parser = argparse.ArgumentParser(description="Fix June statutory holiday overtime billing.")
    parser.add_argument("--host", default="http://localhost:5175", help="Frontend host used in clickable report links.")
    parser.add_argument("--apply", action="store_true", help="Apply resync and billing recalculation.")
    parser.add_argument("--contract-id", help="Only inspect one contract.")
    parser.add_argument(
        "--include-employee-confirmed",
        action="store_true",
        help="Also include employee_confirmed forms. Default only includes customer_signed/synced.",
    )
    args = parser.parse_args()

    statuses = ["customer_signed", "synced"]
    if args.include_employee_confirmed:
        statuses.append("employee_confirmed")

    with app.app_context():
        query = AttendanceForm.query.filter(
            AttendanceForm.cycle_start_date >= "2026-06-01",
            AttendanceForm.cycle_start_date < "2026-07-01",
            AttendanceForm.status.in_(statuses),
        ).order_by(AttendanceForm.cycle_start_date.asc(), AttendanceForm.updated_at.desc())
        if args.contract_id:
            query = query.filter(AttendanceForm.contract_id == args.contract_id)

        forms = query.all()
        cases = [analyze_form(form) for form in forms]
        actionable = [case for case in cases if case["needs_resync"]]
        already_ok_holiday = [
            case for case in cases
            if not case["needs_resync"] and case["holiday_days"] > 0
        ]
        manual_review = [form for form in forms if needs_manual_holiday_review(form)]

        print(f"模式: {'APPLY' if args.apply else 'DRY-RUN'}")
        print(f"扫描状态: {', '.join(statuses)}")
        print(f"扫描考勤表: {len(forms)}")
        print(f"需要处理: {len(actionable)}")
        print(f"已有法定加班且账单一致: {len(already_ok_holiday)}")
        print(f"需要人工确认是否漏填法定加班: {len(manual_review)}")

        for index, case in enumerate(actionable, 1):
            print_case(case, args.host, index)

        if already_ok_holiday:
            print("\n已有法定节假日加班且账单已一致的考勤单:")
            for index, case in enumerate(already_ok_holiday, 1):
                print_case(case, args.host, index)

        if manual_review:
            print("\n需要人工确认的考勤单（6月19日在服务期内，但没有对应加班/休假记录）:")
            for index, form in enumerate(manual_review, 1):
                contract_url, attendance_url = build_urls(args.host, form)
                print(f"[{index}] {customer_name(form)} | {employee_name(form)}")
                print(f"合同: {contract_url}")
                print(f"考勤: {attendance_url}")

        if not args.apply:
            print("\nDRY-RUN 完成，未修改数据。确认后加 --apply 执行。")
            return

        applied = 0
        for case in actionable:
            form = case["form"]
            if form.status in ("customer_signed", "synced"):
                sync_attendance_to_record(form.id)
                applied += 1
            else:
                form.form_data = case["normalized_data"]
                flag_modified(form, "form_data")
                db.session.add(form)
                db.session.commit()
                applied += 1

        print(f"\nAPPLY 完成，已处理 {applied} 张考勤表。")


if __name__ == "__main__":
    main()
