#!/usr/bin/env python3
"""Audit and repair payroll transfers incorrectly created at month-end renewal."""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

os.environ.setdefault("FLASK_APP", "backend.app")

from backend.extensions import db  # noqa: E402
from backend.models import (  # noqa: E402
    BaseContract,
    CustomerBill,
    EmployeePayroll,
    FinancialAdjustment,
    PayoutRecord,
)
from backend.services.renewal_sync_service import (  # noqa: E402
    PAYROLL_TRANSFER_DESCRIPTIONS,
    cleanup_month_end_renewal_payroll_transfers,
    is_month_end_renewal,
)


@dataclass
class Candidate:
    source_contract: BaseContract
    successor: BaseContract
    source_bill: CustomerBill
    target_bill: CustomerBill | None
    transfer_count: int
    unsafe_reason: str | None = None


def _to_date(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    return value


def _payroll_for_bill(bill):
    if not bill:
        return None
    return EmployeePayroll.query.filter_by(
        contract_id=bill.contract_id,
        cycle_start_date=bill.cycle_start_date,
        is_substitute_payroll=False,
    ).first()


def _transfer_adjustments(source_bill, target_bill):
    source_payroll = _payroll_for_bill(source_bill)
    target_payroll = _payroll_for_bill(target_bill)
    payroll_ids = [
        payroll.id
        for payroll in (source_payroll, target_payroll)
        if payroll is not None
    ]
    if not payroll_ids or not source_bill or not target_bill:
        return []

    candidates = FinancialAdjustment.query.filter(
        FinancialAdjustment.employee_payroll_id.in_(payroll_ids),
        FinancialAdjustment.description.in_(PAYROLL_TRANSFER_DESCRIPTIONS),
    ).all()
    source_descriptions = set(PAYROLL_TRANSFER_DESCRIPTIONS[::2])
    target_descriptions = set(PAYROLL_TRANSFER_DESCRIPTIONS[1::2])
    transfers = []
    for adjustment in candidates:
        linked_bill_id = (adjustment.details or {}).get("linked_bill_id")
        if (
            source_payroll
            and adjustment.employee_payroll_id == source_payroll.id
            and adjustment.description in source_descriptions
            and str(linked_bill_id) == str(target_bill.id)
        ):
            transfers.append(adjustment)
        elif (
            target_payroll
            and adjustment.employee_payroll_id == target_payroll.id
            and adjustment.description in target_descriptions
            and str(linked_bill_id) == str(source_bill.id)
        ):
            transfers.append(adjustment)
    return transfers


def _unsafe_reason(source_bill, target_bill, transfers):
    source_payroll = _payroll_for_bill(source_bill)
    target_payroll = _payroll_for_bill(target_bill)
    if not target_bill or not source_payroll or not target_payroll:
        return "缺少旧合同或续签合同首期工资单/账单"
    if not transfers:
        return "未找到与对端账单精确关联的工资转移调整项"
    if Decimal(str(source_bill.total_paid or 0)) != 0 or Decimal(str(target_bill.total_paid or 0)) != 0:
        return "客户账单已有实际收款记录"
    if (
        Decimal(str(source_payroll.total_paid_out or 0)) != 0
        or Decimal(str(target_payroll.total_paid_out or 0)) != 0
        or PayoutRecord.query.filter(
            PayoutRecord.employee_payroll_id.in_([source_payroll.id, target_payroll.id])
        ).count()
    ):
        return "工资单已有实际发放记录"
    if any(
        adjustment.is_settled
        or Decimal(str(adjustment.paid_amount or 0)) != 0
        for adjustment in transfers
    ):
        return "工资转移调整项已有结算记录"
    return None


def find_candidates(contract_ids=None, employee_names=None):
    query = BaseContract.query.filter(
        BaseContract.previous_contract_id.isnot(None),
        BaseContract.source == "renewal",
    )
    if contract_ids:
        values = [UUID(str(contract_id)) for contract_id in contract_ids]
        query = query.filter(
            (BaseContract.id.in_(values))
            | (BaseContract.previous_contract_id.in_(values))
        )

    candidates = []
    for successor in query.order_by(BaseContract.start_date.asc()).all():
        source_contract = db.session.get(BaseContract, successor.previous_contract_id)
        if employee_names:
            employee = source_contract.service_personnel if source_contract else None
            if not employee or employee.name not in set(employee_names):
                continue
        if not is_month_end_renewal(source_contract, successor):
            continue

        successor_start = _to_date(successor.start_date)
        source_month = successor_start - timedelta(days=1)
        source_bill = CustomerBill.query.filter_by(
            contract_id=source_contract.id,
            year=source_month.year,
            month=source_month.month,
            is_substitute_bill=False,
        ).order_by(CustomerBill.cycle_end_date.desc()).first()
        if not source_bill:
            continue

        target_bill = CustomerBill.query.filter_by(
            contract_id=successor.id,
            is_substitute_bill=False,
        ).order_by(CustomerBill.cycle_start_date.asc()).first()
        transfers = _transfer_adjustments(source_bill, target_bill)
        if transfers:
            candidates.append(
                Candidate(
                    source_contract=source_contract,
                    successor=successor,
                    source_bill=source_bill,
                    target_bill=target_bill,
                    transfer_count=len(transfers),
                    unsafe_reason=_unsafe_reason(source_bill, target_bill, transfers),
                )
            )
    return candidates


def describe(candidate):
    employee = candidate.source_contract.service_personnel
    employee_name = employee.name if employee else "未知员工"
    source_period = (
        f"{_to_date(candidate.source_bill.cycle_start_date)}"
        f"~{_to_date(candidate.source_bill.cycle_end_date)}"
    )
    target_period = "无目标账单"
    if candidate.target_bill:
        target_period = (
            f"{_to_date(candidate.target_bill.cycle_start_date)}"
            f"~{_to_date(candidate.target_bill.cycle_end_date)}"
        )
    print(
        f"{employee_name} | 客户 {candidate.source_contract.customer_name} | "
        f"{source_period} -> {target_period} | "
        f"错误工资转移 {candidate.transfer_count} 条 | "
        f"旧合同 {candidate.source_contract.id} | 新合同 {candidate.successor.id}"
    )
    if candidate.unsafe_reason:
        print(f"  拒绝执行: {candidate.unsafe_reason}")


def apply_candidates(candidates):
    """Apply all candidates in one transaction and roll back on any failure."""
    cleaned = 0
    try:
        for candidate in candidates:
            source_end = _to_date(candidate.source_bill.cycle_end_date)
            cleaned += cleanup_month_end_renewal_payroll_transfers(
                candidate.source_contract,
                candidate.successor,
                source_end.year,
                source_end.month,
                recalculate=True,
            )
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return cleaned


def main():
    from backend.app import app

    parser = argparse.ArgumentParser(
        description="清理自然月末续签时错误转移到下月的员工工资"
    )
    parser.add_argument(
        "--contract-id",
        dest="contract_ids",
        action="append",
        help="只检查指定旧合同或续签合同 ID",
    )
    parser.add_argument(
        "--employee-name",
        dest="employee_names",
        action="append",
        help="只检查指定员工，可重复传入多个姓名",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="实际清理并重算；默认只读审计",
    )
    parser.add_argument(
        "--all-candidates",
        action="store_true",
        help="允许 --apply 处理全部审计候选，必须显式指定",
    )
    args = parser.parse_args()

    if args.apply and not (args.contract_ids or args.employee_names or args.all_candidates):
        parser.error("--apply 必须同时指定 --contract-id、--employee-name 或 --all-candidates")
    if args.all_candidates and (args.contract_ids or args.employee_names):
        parser.error("--all-candidates 不能与 --contract-id 或 --employee-name 同时使用")

    with app.app_context():
        candidates = find_candidates(
            None if args.all_candidates else args.contract_ids,
            None if args.all_candidates else args.employee_names,
        )
        print(f"找到 {len(candidates)} 个自然月末工资转移错误。")
        for candidate in candidates:
            describe(candidate)

        if not args.apply or not candidates:
            if candidates:
                print("当前为只读审计；确认后增加 --apply 执行修复。")
            return 0

        unsafe_candidates = [candidate for candidate in candidates if candidate.unsafe_reason]
        if unsafe_candidates:
            print("存在不满足自动修正安全条件的候选，未执行任何修改。")
            return 2

        cleaned = apply_candidates(candidates)

        print(f"已清理 {cleaned} 条错误工资转移，并重算相关月份账单。")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
