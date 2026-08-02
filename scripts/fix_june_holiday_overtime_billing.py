#!/usr/bin/env python3
"""
Audit historical bills against signed attendance forms and optionally resync
inconsistent attendance, customer bill, and employee payroll snapshots.

Production guide:
    docs/attendance_billing_audit.md

Dry run:
    python scripts/audit_attendance_billing_consistency.py --dry-run --host https://hr.mengyimengsao.com

Apply:
    python scripts/audit_attendance_billing_consistency.py --host https://hr.mengyimengsao.com --apply
"""

import argparse
import logging
import sys
from copy import deepcopy
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from dotenv import load_dotenv
from sqlalchemy import and_, or_
from sqlalchemy.orm.attributes import flag_modified

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

load_dotenv(REPO_ROOT / "backend/.env")
logging.getLogger().setLevel(logging.ERROR)
logging.disable(logging.WARNING)

from backend.app import app
from backend.models import AttendanceForm, AttendanceRecord, BaseContract, CustomerBill, EmployeePayroll, db
from backend.api.attendance_form_api import ensure_attendance_form_onboarding_record
from backend.services.maternity_attendance_service import is_maternity_contract
from backend.services.attendance_sync_service import (
    _parse_date,
    _record_covers_day,
    _is_statutory_holiday,
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
    signature_token = form.customer_signature_token
    attendance_url = (
        f"{base}/attendance-sign/{signature_token}?contractId={contract_id}"
        if signature_token
        else f"{base}/attendance-admin/{employee_id}?year={form.cycle_start_date.year}"
        f"&month={form.cycle_start_date.month}&contractId={contract_id}"
    )
    return (
        f"{base}/contract/detail/{contract_id}",
        attendance_url,
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


def payroll_overtime_days(payroll):
    if not payroll:
        return Decimal("0")
    details = payroll.calculation_details or {}
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


def missing_holiday_records(form):
    try:
        valid_days = set(_valid_days_for_cycle(
            form,
            _parse_date(form.cycle_start_date),
            _parse_date(form.cycle_end_date),
        ))
    except Exception:
        valid_days = set()

    form_data = form.form_data or {}
    missing_dates = []
    for holiday_date in sorted(day for day in valid_days if _is_statutory_holiday(day)):
        if any(_record_covers_day(record, holiday_date) for record in form_data.get("overtime_records") or []):
            continue
        if any(
            _record_covers_day(record, holiday_date)
            for key in ("rest_records", "leave_records", "paid_leave_records")
            for record in form_data.get(key) or []
        ):
            continue
        missing_dates.append(holiday_date)
    return missing_dates


def find_form_for_bill(bill, statuses):
    bill_cycle_start = _parse_date(bill.cycle_start_date)
    exact_start = datetime.combine(bill_cycle_start, time.min)
    exact_end = exact_start + timedelta(days=1)
    base_query = AttendanceForm.query.filter(
        AttendanceForm.contract_id == bill.contract_id,
        AttendanceForm.status.in_(statuses),
    )
    form = (
        base_query.filter(
            AttendanceForm.cycle_start_date >= exact_start,
            AttendanceForm.cycle_start_date < exact_end,
        )
        .order_by(AttendanceForm.updated_at.desc().nullslast())
        .first()
    )
    if form:
        return form
    if is_maternity_contract(bill.contract):
        return None

    month_start = datetime(bill.year, bill.month, 1)
    month_end = datetime(bill.year + (1 if bill.month == 12 else 0), 1 if bill.month == 12 else bill.month + 1, 1)
    return (
        base_query.filter(
            AttendanceForm.cycle_start_date >= month_start,
            AttendanceForm.cycle_start_date < month_end,
        )
        .order_by(AttendanceForm.updated_at.desc().nullslast())
        .first()
    )


def find_attendance_record(form, bill=None):
    target_start = _parse_date(bill.cycle_start_date if bill else form.cycle_start_date)
    records = AttendanceRecord.query.filter_by(contract_id=form.contract_id).all()
    return next(
        (record for record in records if _parse_date(record.cycle_start_date) == target_start),
        None,
    )


def analyze_form(form, bill=None):
    cycle_start = _parse_date(bill.cycle_start_date if bill else form.cycle_start_date)
    cycle_end = _parse_date(bill.cycle_end_date if bill else form.cycle_end_date)
    original_data = deepcopy(form.form_data or {})
    onboarding_changed, onboarding_data = preview_onboarding_reconcile(form)
    normalized_form = form_snapshot(form, onboarding_data)
    normalized_data, normalized_changed = normalize_auto_overtime_form_data(
        normalized_form,
        allow_create_missing_auto=True,
    )
    normal_days, holiday_days = _split_overtime_days_by_holiday(normalized_data, cycle_start, cycle_end)
    expected_overtime_days = normal_days + holiday_days

    attendance = find_attendance_record(form, bill)
    if bill is None:
        bill = CustomerBill.query.filter_by(
            contract_id=form.contract_id,
            cycle_start_date=form.cycle_start_date,
            is_substitute_bill=False,
        ).first()
    payroll = None
    if bill:
        payroll = EmployeePayroll.query.filter_by(
            contract_id=bill.contract_id,
            cycle_start_date=bill.cycle_start_date,
            is_substitute_payroll=False,
        ).first()

    record_overtime = total_record_overtime(attendance)
    record_field_total = record_field_overtime(attendance)
    current_bill_overtime = bill_overtime_days(bill)
    current_payroll_overtime = payroll_overtime_days(payroll)
    record_has_legacy_holiday = bool(attendance and D(attendance.statutory_holiday_days) > 0)
    bill_mismatch = not same_days(expected_overtime_days, current_bill_overtime)
    payroll_mismatch = not same_days(expected_overtime_days, current_payroll_overtime)
    record_mismatch = not same_days(expected_overtime_days, record_overtime)
    record_needs_normalize = record_has_legacy_holiday and not same_days(record_field_total, record_overtime)
    needs_resync = (
        onboarding_changed
        or normalized_changed
        or record_mismatch
        or bill_mismatch
        or payroll_mismatch
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
        "payroll_overtime_days": current_payroll_overtime,
        "needs_resync": needs_resync,
    }


def print_case(case, host, index):
    form = case["form"]
    bill = case["bill"]
    contract_url, attendance_url = build_urls(host, form)
    status = "需处理" if case["needs_resync"] else "无需处理"
    print(f"\n[{index}] {status} | {customer_name(form)} | {employee_name(form)}")
    print(f"账单: {contract_url}")
    if bill:
        print(
            f"账单ID/周期: {bill.id} | {bill.year}-{bill.month:02d} | "
            f"{_parse_date(bill.cycle_start_date).isoformat()} ~ {_parse_date(bill.cycle_end_date).isoformat()}"
        )
    print(f"考勤: {attendance_url}")
    print(
        "加班: "
        f"表单在账单周期内总计 {fmt_decimal(case['expected_overtime_days'])} 天 "
        f"(法定/休假类 {fmt_decimal(case['holiday_days'])} 天, 普通/自动 {fmt_decimal(case['normal_days'])} 天), "
        f"AttendanceRecord 当前 {fmt_decimal(case['record_overtime'])} 天, "
        f"客户账单当前 {fmt_decimal(case['bill_overtime_days'])} 天, "
        f"员工工资单当前 {fmt_decimal(case['payroll_overtime_days'])} 天"
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


def print_missing_form_bill(bill, host, index):
    contract_url = f"{host.rstrip('/')}/contract/detail/{bill.contract_id}"
    print(f"\n[{index}] 缺少对应已签考勤表 | {bill.customer_name or bill.contract_id}")
    print(f"账单: {contract_url}")
    print(
        f"账单ID/周期: {bill.id} | {bill.year}-{bill.month:02d} | "
        f"{_parse_date(bill.cycle_start_date).isoformat()} ~ {_parse_date(bill.cycle_end_date).isoformat()}"
    )
    print(f"客户账单当前加班: {fmt_decimal(bill_overtime_days(bill))} 天")


def restore_form_data(form, original_data):
    form.form_data = original_data
    flag_modified(form, "form_data")
    db.session.add(form)
    db.session.commit()


def main():
    today = date.today()
    parser = argparse.ArgumentParser(description="Audit historical attendance and billing consistency.")
    parser.add_argument("--host", default="http://localhost:5175", help="Frontend host used in clickable report links.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Only report differences; do not modify data (default).")
    mode.add_argument("--apply", action="store_true", help="Apply resync and billing recalculation.")
    parser.add_argument("--contract-id", help="Only inspect one contract.")
    parser.add_argument(
        "--from-date",
        default=date(today.year, 1, 1).isoformat(),
        help="Start of bill cycle range, inclusive (default: January 1 of current year).",
    )
    parser.add_argument(
        "--to-date",
        default=today.isoformat(),
        help="End of bill cycle range, inclusive (default: today).",
    )
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
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Also print missing forms, consistent holiday overtime, and manual-review details.",
    )
    args = parser.parse_args()

    try:
        from_date = date.fromisoformat(args.from_date)
        to_date = date.fromisoformat(args.to_date)
    except ValueError as error:
        parser.error(f"日期格式必须为 YYYY-MM-DD: {error}")
    if from_date > to_date:
        parser.error("--from-date 不能晚于 --to-date")

    statuses = ["customer_signed", "synced"]
    if args.include_employee_confirmed:
        statuses.append("employee_confirmed")

    with app.app_context():
        query = CustomerBill.query.filter(
            or_(
                CustomerBill.year > from_date.year,
                and_(CustomerBill.year == from_date.year, CustomerBill.month >= from_date.month),
            ),
            or_(
                CustomerBill.year < to_date.year,
                and_(CustomerBill.year == to_date.year, CustomerBill.month <= to_date.month),
            ),
            CustomerBill.is_substitute_bill.is_(False),
            CustomerBill.is_merged.is_(False),
        ).order_by(CustomerBill.cycle_start_date.asc(), CustomerBill.created_at.asc())
        if args.contract_id:
            query = query.filter(CustomerBill.contract_id == args.contract_id)

        bills = query.all()
        matched = []
        missing_form_bills = []
        for bill in bills:
            form = find_form_for_bill(bill, statuses)
            if form:
                matched.append((form, bill))
            else:
                missing_form_bills.append(bill)
        cases = [analyze_form(form, bill) for form, bill in matched]
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
        manual_review = []
        for case in active_cases:
            missing_dates = missing_holiday_records(case["form"])
            if missing_dates:
                manual_review.append((case["form"], missing_dates))

        print(f"模式: {'APPLY' if args.apply else 'DRY-RUN'}")
        print(f"账单周期范围: {from_date.isoformat()} ~ {to_date.isoformat()}")
        print(f"扫描状态: {', '.join(statuses)}")
        print(f"扫描历史账单: {len(bills)}")
        print(f"匹配已签考勤表: {len(matched)}")
        print(f"缺少对应已签考勤表: {len(missing_form_bills)}")
        print(f"跳过续签相关: {len(skipped_renewals)}")
        print(f"需要处理: {len(actionable)}")
        print(f"已有法定加班且账单一致: {len(already_ok_holiday)}")
        print(f"需要人工确认是否漏填法定加班: {len(manual_review)}")

        for index, case in enumerate(actionable, 1):
            print_case(case, args.host, index)

        if args.verbose and missing_form_bills:
            print("\n缺少对应已签考勤表的历史账单:")
            for index, bill in enumerate(missing_form_bills, 1):
                print_missing_form_bill(bill, args.host, index)

        if args.verbose and already_ok_holiday:
            print("\n已有法定节假日加班且账单已一致的考勤单:")
            for index, case in enumerate(already_ok_holiday, 1):
                print_case(case, args.host, index)

        if skipped_renewals:
            print("\n已跳过的续签相关考勤单（由续签专项逻辑处理）:")
            for index, case in enumerate(skipped_renewals, 1):
                print_case(case, args.host, index)

        if args.verbose and manual_review:
            print("\n需要人工确认的考勤单（法定节假日在服务期内，但没有对应加班/休假记录）:")
            for index, (form, holiday_dates) in enumerate(manual_review, 1):
                print_form_links(form, args.host, index)
                print(f"待确认法定节假日: {', '.join(item.isoformat() for item in holiday_dates)}")

        if not args.apply:
            print("\nDRY-RUN 完成，未修改数据。确认后加 --apply 执行。")
            return

        applied = 0
        failed = 0
        for case in actionable:
            form = case["form"]
            before_record = case["record_overtime"]
            before_bill = case["bill_overtime_days"]
            before_payroll = case["payroll_overtime_days"]
            form.form_data = case["normalized_data"]
            flag_modified(form, "form_data")
            db.session.add(form)
            db.session.flush()
            if form.status in ("customer_signed", "synced"):
                sync_attendance_to_record(form.id)
            else:
                db.session.commit()

            db.session.expire_all()
            refreshed_form = db.session.get(AttendanceForm, form.id)
            refreshed = analyze_form(refreshed_form, case["bill"])
            contract_url, attendance_url = build_urls(args.host, refreshed_form)
            resolved = not refreshed["needs_resync"]
            if resolved:
                applied += 1
            else:
                failed += 1
            print(
                f"\n{'已处理' if resolved else '处理后仍不一致'}: "
                f"{customer_name(refreshed_form)} | {employee_name(refreshed_form)}"
            )
            print(f"账单: {contract_url}")
            bill = refreshed["bill"]
            if bill:
                print(
                    f"账单ID/周期: {bill.id} | {bill.year}-{bill.month:02d} | "
                    f"{_parse_date(bill.cycle_start_date).isoformat()} ~ "
                    f"{_parse_date(bill.cycle_end_date).isoformat()}"
                )
            print(f"考勤: {attendance_url}")
            print(
                "加班修复: "
                f"AttendanceRecord {fmt_decimal(before_record)} -> {fmt_decimal(refreshed['record_overtime'])} 天, "
                f"客户账单 {fmt_decimal(before_bill)} -> {fmt_decimal(refreshed['bill_overtime_days'])} 天, "
                f"员工工资单 {fmt_decimal(before_payroll)} -> {fmt_decimal(refreshed['payroll_overtime_days'])} 天"
            )

        print(f"\nAPPLY 完成，成功 {applied} 张，仍不一致 {failed} 张。")
        if failed:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
