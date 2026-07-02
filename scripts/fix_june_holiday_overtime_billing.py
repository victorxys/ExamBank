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
from types import SimpleNamespace

from dotenv import load_dotenv
from sqlalchemy.orm.attributes import flag_modified

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

load_dotenv(REPO_ROOT / "backend/.env")
logging.getLogger().setLevel(logging.ERROR)
logging.disable(logging.WARNING)

from backend.app import app
from backend.models import AttendanceForm, AttendanceRecord, BaseContract, CustomerBill, EmployeePayroll, db
from backend.api.attendance_form_api import ensure_attendance_form_onboarding_record
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
    details = attendance.attendance_details or {}
    if details.get("overtime_days") is not None:
        return D(details.get("overtime_days") or 0)
    return D(attendance.overtime_days) + D(attendance.statutory_holiday_days)


def record_field_overtime(attendance):
    if not attendance:
        return Decimal("0")
    return D(attendance.overtime_days) + D(attendance.statutory_holiday_days)


def bill_overtime_days(bill):
    if not bill:
        return Decimal("0")
    details = bill.calculation_details or {}
    return D(details.get("overtime_days"))


def same_days(left, right):
    return D(left).quantize(Decimal("0.001")) == D(right).quantize(Decimal("0.001"))


def employee_name(form):
    contract = form.contract
    personnel = contract.service_personnel if contract else None
    return getattr(personnel, "name", None) or getattr(personnel, "username", None) or str(form.employee_id)


def customer_name(form):
    contract = form.contract
    return getattr(contract, "customer_name", None) or str(form.contract_id)


def has_successor(contract):
    if not contract:
        return False
    return db.session.query(BaseContract.id).filter_by(previous_contract_id=contract.id).first() is not None


def is_renewal_related(form):
    contract = form.contract
    if not contract:
        return False
    return bool(contract.previous_contract_id or has_successor(contract))


def has_june_statutory_overtime(form_data):
    try:
        cycle_start = _parse_date("2026-06-01")
        cycle_end = _parse_date("2026-06-30")
        _, holiday_days = _split_overtime_days_by_holiday(form_data or {}, cycle_start, cycle_end)
        return holiday_days
    except Exception:
        return Decimal("0")


def form_snapshot(form, form_data):
    return SimpleNamespace(
        id=form.id,
        contract=form.contract,
        contract_id=form.contract_id,
        employee_id=form.employee_id,
        cycle_start_date=form.cycle_start_date,
        cycle_end_date=form.cycle_end_date,
        form_data=deepcopy(form_data or {}),
    )


def preview_onboarding_reconcile(form):
    snapshot = form_snapshot(form, form.form_data or {})
    changed = ensure_attendance_form_onboarding_record(
        snapshot,
        form.contract,
        mark_modified=False,
    )
    return changed, snapshot.form_data


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
    onboarding_changed, onboarding_data = preview_onboarding_reconcile(form)
    normalized_form = form_snapshot(form, onboarding_data)
    normalized_data, normalized_changed = normalize_auto_overtime_form_data(
        normalized_form,
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
    record_field_total = record_field_overtime(attendance)
    current_bill_overtime = bill_overtime_days(bill)
    record_has_legacy_holiday = bool(attendance and D(attendance.statutory_holiday_days) > 0)
    bill_mismatch = not same_days(expected_overtime_days, current_bill_overtime)
    record_mismatch = not same_days(expected_overtime_days, record_overtime)
    record_needs_normalize = record_has_legacy_holiday and not same_days(record_field_total, record_overtime)
    needs_resync = (
        onboarding_changed
        or normalized_changed
        or record_mismatch
        or bill_mismatch
        or record_needs_normalize
    )

    return {
        "form": form,
        "is_renewal_related": is_renewal_related(form),
        "original_data": original_data,
        "normalized_data": normalized_data,
        "normalized_changed": normalized_changed,
        "onboarding_changed": onboarding_changed,
        "holiday_days": holiday_days,
        "normal_days": normal_days,
        "expected_overtime_days": expected_overtime_days,
        "attendance": attendance,
        "bill": bill,
        "payroll": payroll,
        "record_overtime": record_overtime,
        "record_field_total": record_field_total,
        "record_needs_normalize": record_needs_normalize,
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
    if case["record_needs_normalize"]:
        print(
            "字段归一化: "
            f"AttendanceRecord 字段合计 {fmt_decimal(case['record_field_total'])} 天，"
            f"将按明细总加班 {fmt_decimal(case['record_overtime'])} 天重写"
        )
    if case["normalized_changed"]:
        original_count = len((case["original_data"] or {}).get("overtime_records") or [])
        new_count = len((case["normalized_data"] or {}).get("overtime_records") or [])
        print(f"自动补齐: 将更新 overtime_records 数量 {original_count} -> {new_count}")
    if case["onboarding_changed"]:
        onboarding_records = (case["normalized_data"] or {}).get("onboarding_records") or []
        trial_labels = [
            f"{item.get('date')} {item.get('label') or '上户'}"
            for item in onboarding_records
            if item.get("source_contract_type") == "nanny_trial" or item.get("label") == "试工上户"
        ]
        print(f"试工上户: 将补充/更新 {', '.join(trial_labels) if trial_labels else '上户记录'}")
    if not case["bill"]:
        print("提示: 未找到 2026-06 主账单，apply 只会同步考勤，无法重算对应账单")


def print_form_links(form, host, index):
    contract_url, attendance_url = build_urls(host, form)
    print(f"[{index}] {customer_name(form)} | {employee_name(form)}")
    print(f"合同: {contract_url}")
    print(f"考勤: {attendance_url}")


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
        "--include-renewals",
        action="store_true",
        help="Include renewal-related contracts. Default skips them because renewal backfill has its own flow.",
    )
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
        skipped_renewals = [
            case for case in cases
            if case["is_renewal_related"] and not args.include_renewals
        ]
        active_cases = [
            case for case in cases
            if args.include_renewals or not case["is_renewal_related"]
        ]
        actionable = [case for case in active_cases if case["needs_resync"]]
        already_ok_holiday = [
            case for case in active_cases
            if not case["needs_resync"] and case["holiday_days"] > 0
        ]
        manual_review = [
            case["form"] for case in active_cases
            if needs_manual_holiday_review(case["form"])
        ]

        print(f"模式: {'APPLY' if args.apply else 'DRY-RUN'}")
        print(f"扫描状态: {', '.join(statuses)}")
        print(f"扫描考勤表: {len(forms)}")
        print(f"跳过续签相关: {len(skipped_renewals)}")
        print(f"需要处理: {len(actionable)}")
        print(f"已有法定加班且账单一致: {len(already_ok_holiday)}")
        print(f"需要人工确认是否漏填法定加班: {len(manual_review)}")

        for index, case in enumerate(actionable, 1):
            print_case(case, args.host, index)

        if already_ok_holiday:
            print("\n已有法定节假日加班且账单已一致的考勤单:")
            for index, case in enumerate(already_ok_holiday, 1):
                print_case(case, args.host, index)

        if skipped_renewals:
            print("\n已跳过的续签相关考勤单（由续签专项逻辑处理）:")
            for index, case in enumerate(skipped_renewals, 1):
                print_form_links(case["form"], args.host, index)

        if manual_review:
            print("\n需要人工确认的考勤单（6月19日在服务期内，但没有对应加班/休假记录）:")
            for index, form in enumerate(manual_review, 1):
                print_form_links(form, args.host, index)

        if not args.apply:
            print("\nDRY-RUN 完成，未修改数据。确认后加 --apply 执行。")
            return

        applied = 0
        for case in actionable:
            form = case["form"]
            form.form_data = case["normalized_data"]
            flag_modified(form, "form_data")
            db.session.add(form)
            db.session.flush()
            if form.status in ("customer_signed", "synced"):
                sync_attendance_to_record(form.id)
                applied += 1
            else:
                db.session.commit()
                applied += 1

        print(f"\nAPPLY 完成，已处理 {applied} 张考勤表。")


if __name__ == "__main__":
    main()
