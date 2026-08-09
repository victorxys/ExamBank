#!/usr/bin/env python3
"""Audit and repair payroll transfers incorrectly created at month-end renewal."""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
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


def find_candidates(contract_id=None):
    query = BaseContract.query.filter(
        BaseContract.previous_contract_id.isnot(None),
        BaseContract.source == "renewal",
    )
    if contract_id:
        value = UUID(str(contract_id))
        query = query.filter(
            (BaseContract.id == value) | (BaseContract.previous_contract_id == value)
        )

    candidates = []
    for successor in query.order_by(BaseContract.start_date.asc()).all():
        source_contract = db.session.get(BaseContract, successor.previous_contract_id)
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
        payroll_ids = [
            payroll.id
            for payroll in (_payroll_for_bill(source_bill), _payroll_for_bill(target_bill))
            if payroll
        ]
        transfer_count = 0
        if payroll_ids:
            transfer_count = FinancialAdjustment.query.filter(
                FinancialAdjustment.employee_payroll_id.in_(payroll_ids),
                FinancialAdjustment.description.in_(PAYROLL_TRANSFER_DESCRIPTIONS),
            ).count()
        if transfer_count:
            candidates.append(
                Candidate(
                    source_contract=source_contract,
                    successor=successor,
                    source_bill=source_bill,
                    target_bill=target_bill,
                    transfer_count=transfer_count,
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


def main():
    from backend.app import app

    parser = argparse.ArgumentParser(
        description="清理自然月末续签时错误转移到下月的员工工资"
    )
    parser.add_argument(
        "--contract-id",
        help="只检查指定旧合同或续签合同 ID",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="实际清理并重算；默认只读审计",
    )
    args = parser.parse_args()

    with app.app_context():
        candidates = find_candidates(args.contract_id)
        print(f"找到 {len(candidates)} 个自然月末工资转移错误。")
        for candidate in candidates:
            describe(candidate)

        if not args.apply or not candidates:
            if candidates:
                print("当前为只读审计；确认后增加 --apply 执行修复。")
            return 0

        try:
            cleaned = 0
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

        print(f"已清理 {cleaned} 条错误工资转移，并重算相关月份账单。")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
