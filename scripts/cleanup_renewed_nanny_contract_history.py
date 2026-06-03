#!/usr/bin/env python3
"""
清理历史上因“月签育儿嫂合同续约后，旧合同未正确结清”而产生的问题。

仅处理以下保守场景：
1. 新合同 `source = renewal`
2. 新合同通过 `previous_contract_id` 指向旧合同
3. 旧合同是月签育儿嫂合同 (`NannyContract.is_monthly_auto_renew = True` 或曾经是该类合同)
4. 新合同开始日为每月 1 号

会处理：
1. 删除旧合同在新合同开始月及之后预生成的未来账单/工资单
2. 将旧合同状态修正为 `finished`，但保留 `is_monthly_auto_renew` 历史元数据
3. 补齐旧合同最后一期“保证金退款”和“保证金转出”
4. 补齐新合同“从续约前合同转入”保证金冲抵
5. 新合同费率为 0 但管理费金额存在时，反推管理费率

使用方式：
    python scripts/cleanup_renewed_nanny_contract_history.py --dry-run
    python scripts/cleanup_renewed_nanny_contract_history.py
    python scripts/cleanup_renewed_nanny_contract_history.py --dry-run --contract-id <合同ID>
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, or_

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

os.environ.setdefault("FLASK_APP", "backend.app")

from backend.extensions import db
from backend.models import (
    AdjustmentType,
    BaseContract,
    CustomerBill,
    EmployeePayroll,
    FinancialActivityLog,
    FinancialAdjustment,
    MaternityNurseContract,
    NannyContract,
)
from backend.services.contract_service import ContractService


@dataclass
class RenewalCleanupCandidate:
    old_contract_id: str
    new_contract_id: str
    customer_name: str
    successor_start_date: date
    cutoff_date: date
    old_status: str
    old_termination_date: date | None
    old_end_date: date | None
    old_is_monthly_auto_renew: bool | None
    future_bill_ids: list[str]
    future_payroll_ids: list[str]
    has_deposit_refund: bool
    has_deposit_transfer_out: bool
    has_deposit_transfer_in: bool
    stale_adjustment_ids: list[str]
    needs_rate_backfill: bool

    @property
    def needs_contract_update(self) -> bool:
        return (
            self.old_status != "finished"
            or self.old_termination_date != self.cutoff_date
            or self.old_end_date != self.cutoff_date
        )

    @property
    def needs_cleanup(self) -> bool:
        return (
            self.needs_contract_update
            or bool(self.future_bill_ids or self.future_payroll_ids)
            or not self.has_deposit_refund
            or not self.has_deposit_transfer_out
            or not self.has_deposit_transfer_in
            or bool(self.stale_adjustment_ids)
            or self.needs_rate_backfill
        )


def _to_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def _month_threshold_clauses(start_date: date):
    return or_(
        CustomerBill.year > start_date.year,
        and_(CustomerBill.year == start_date.year, CustomerBill.month >= start_date.month),
    )


def _payroll_month_threshold_clauses(start_date: date):
    return or_(
        EmployeePayroll.year > start_date.year,
        and_(EmployeePayroll.year == start_date.year, EmployeePayroll.month >= start_date.month),
    )


def _has_financial_adjustment(query) -> bool:
    return db.session.query(query.exists()).scalar()


def _find_last_bill_for_cutoff(contract_id, cutoff_date: date) -> CustomerBill | None:
    cutoff_datetime = datetime.combine(cutoff_date, datetime.max.time())
    return CustomerBill.query.filter(
        CustomerBill.contract_id == contract_id,
        CustomerBill.is_substitute_bill.is_(False),
        CustomerBill.cycle_start_date <= cutoff_datetime,
    ).order_by(CustomerBill.cycle_end_date.desc()).first()


def _needs_rate_backfill(contract: BaseContract) -> bool:
    try:
        rate = Decimal(contract.management_fee_rate or 0)
        amount = Decimal(contract.management_fee_amount or 0)
        level = Decimal(contract.employee_level or 0)
    except Exception:
        return False
    return rate <= 0 and amount > 0 and level > 0


def find_cleanup_candidates(
    contract_id: str | None = None,
    include_mid_month: bool = False,
) -> list[RenewalCleanupCandidate]:
    successor_query = BaseContract.query.filter(
        BaseContract.source == "renewal",
        BaseContract.previous_contract_id.isnot(None),
    ).order_by(BaseContract.start_date.asc())

    if contract_id:
        contract_uuid = UUID(str(contract_id))
        successor_query = successor_query.filter(
            or_(
                BaseContract.id == contract_uuid,
                BaseContract.previous_contract_id == contract_uuid,
            )
        )

    candidates: list[RenewalCleanupCandidate] = []

    for successor in successor_query.all():
        old_contract = db.session.get(NannyContract, successor.previous_contract_id)
        if not old_contract:
            continue

        successor_start_date = _to_date(successor.start_date)
        if not successor_start_date:
            continue
        if successor_start_date.day != 1 and not include_mid_month:
            continue

        cutoff_date = successor_start_date - timedelta(days=1)

        if successor_start_date.day == 1:
            future_bill_ids = [
                str(row[0])
                for row in CustomerBill.query.with_entities(CustomerBill.id).filter(
                    CustomerBill.contract_id == old_contract.id,
                    CustomerBill.is_substitute_bill.is_(False),
                    _month_threshold_clauses(successor_start_date),
                ).all()
            ]
            future_payroll_ids = [
                str(row[0])
                for row in EmployeePayroll.query.with_entities(EmployeePayroll.id).filter(
                    EmployeePayroll.contract_id == old_contract.id,
                    EmployeePayroll.is_substitute_payroll.is_(False),
                    _payroll_month_threshold_clauses(successor_start_date),
                ).all()
            ]
        else:
            future_bill_ids = [
                str(row[0])
                for row in CustomerBill.query.with_entities(CustomerBill.id).filter(
                    CustomerBill.contract_id == old_contract.id,
                    CustomerBill.is_substitute_bill.is_(False),
                    CustomerBill.cycle_start_date > datetime.combine(cutoff_date, datetime.max.time()),
                ).all()
            ]
            future_payroll_ids = [
                str(row[0])
                for row in EmployeePayroll.query.with_entities(EmployeePayroll.id).filter(
                    EmployeePayroll.contract_id == old_contract.id,
                    EmployeePayroll.is_substitute_payroll.is_(False),
                    EmployeePayroll.cycle_start_date > datetime.combine(cutoff_date, datetime.max.time()),
                ).all()
            ]

        last_bill = _find_last_bill_for_cutoff(old_contract.id, cutoff_date)

        has_deposit_refund = False
        has_deposit_transfer_out = False
        if last_bill:
            has_deposit_refund = _has_financial_adjustment(
                FinancialAdjustment.query.filter(
                    FinancialAdjustment.customer_bill_id == last_bill.id,
                    FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DECREASE,
                    FinancialAdjustment.description == "[系统添加] 保证金退款",
                )
            )
            has_deposit_transfer_out = _has_financial_adjustment(
                FinancialAdjustment.query.filter(
                    FinancialAdjustment.customer_bill_id == last_bill.id,
                    FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_INCREASE,
                    FinancialAdjustment.description == "[保证金转出]至续约合同",
                    FinancialAdjustment.details["transferred_to_contract_id"].astext == str(successor.id),
                )
            )

        has_deposit_transfer_in = _has_financial_adjustment(
            FinancialAdjustment.query.filter(
                FinancialAdjustment.contract_id == successor.id,
                FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DECREASE,
                FinancialAdjustment.description == "[从续约前合同转入] 保证金冲抵",
                FinancialAdjustment.details["transferred_from_contract_id"].astext == str(old_contract.id),
            )
        )

        stale_adjustment_ids = _find_stale_renewal_deposit_adjustment_ids(
            old_contract=old_contract,
            successor=successor,
            last_bill=last_bill,
        )

        candidate = RenewalCleanupCandidate(
            old_contract_id=str(old_contract.id),
            new_contract_id=str(successor.id),
            customer_name=old_contract.customer_name,
            successor_start_date=successor_start_date,
            cutoff_date=cutoff_date,
            old_status=old_contract.status,
            old_termination_date=_to_date(old_contract.termination_date),
            old_end_date=_to_date(old_contract.end_date),
            old_is_monthly_auto_renew=getattr(old_contract, "is_monthly_auto_renew", None),
            future_bill_ids=future_bill_ids,
            future_payroll_ids=future_payroll_ids,
            has_deposit_refund=has_deposit_refund,
            has_deposit_transfer_out=has_deposit_transfer_out,
            has_deposit_transfer_in=has_deposit_transfer_in,
            stale_adjustment_ids=stale_adjustment_ids,
            needs_rate_backfill=_needs_rate_backfill(successor),
        )

        if candidate.needs_cleanup:
            candidates.append(candidate)

    return candidates


def describe_candidate(candidate: RenewalCleanupCandidate) -> str:
    return (
        f"旧合同 {candidate.old_contract_id} -> 新合同 {candidate.new_contract_id} | "
        f"客户: {candidate.customer_name} | 新合同开始: {candidate.successor_start_date} | "
        f"{'月中续约' if candidate.successor_start_date.day != 1 else '月初续约'} | "
        f"旧合同应截止: {candidate.cutoff_date} | "
        f"future_bills={len(candidate.future_bill_ids)} | "
        f"future_payrolls={len(candidate.future_payroll_ids)} | "
        f"needs_contract_update={candidate.needs_contract_update} | "
        f"has_refund={candidate.has_deposit_refund} | "
        f"has_transfer_out={candidate.has_deposit_transfer_out} | "
        f"has_transfer_in={candidate.has_deposit_transfer_in} | "
        f"stale_adjustments={len(candidate.stale_adjustment_ids)} | "
        f"needs_rate_backfill={candidate.needs_rate_backfill}"
    )


def _find_stale_renewal_deposit_adjustment_ids(
    old_contract: NannyContract,
    successor: BaseContract,
    last_bill: CustomerBill | None,
) -> list[str]:
    if not last_bill:
        return []

    first_successor_bill = CustomerBill.query.filter_by(
        contract_id=successor.id,
        is_substitute_bill=False,
    ).order_by(CustomerBill.cycle_start_date.asc()).first()
    if not first_successor_bill:
        return []

    stale_ids: list[str] = []

    stale_new_bill_adjustments = FinancialAdjustment.query.filter(
        FinancialAdjustment.customer_bill_id == first_successor_bill.id,
        FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_INCREASE,
        FinancialAdjustment.description == "[转入] 客户增款",
        FinancialAdjustment.details["status"].astext == "transferred_in",
        FinancialAdjustment.details["transferred_from_bill_id"].astext == str(last_bill.id),
    ).all()
    stale_ids.extend(str(adjustment.id) for adjustment in stale_new_bill_adjustments)

    stale_old_bill_transfer_adjustments = FinancialAdjustment.query.filter(
        FinancialAdjustment.customer_bill_id == last_bill.id,
        FinancialAdjustment.details["transferred_to_bill_id"].astext == str(first_successor_bill.id),
        FinancialAdjustment.details["status"].astext.in_(["transferred_out", "offsetting_transfer"]),
    ).all()
    stale_ids.extend(str(adjustment.id) for adjustment in stale_old_bill_transfer_adjustments)

    return sorted(set(stale_ids))


def apply_cleanup_candidate(candidate: RenewalCleanupCandidate, dry_run: bool = True) -> None:
    print(f"{'[DRY-RUN]' if dry_run else '[APPLY]'} {describe_candidate(candidate)}")

    if dry_run:
        if candidate.future_bill_ids:
            print(f"  将删除未来客户账单: {', '.join(candidate.future_bill_ids)}")
        if candidate.future_payroll_ids:
            print(f"  将删除未来员工工资单: {', '.join(candidate.future_payroll_ids)}")
        if not candidate.has_deposit_refund:
            print("  将补齐旧合同最后一期 [系统添加] 保证金退款")
        if not candidate.has_deposit_transfer_out:
            print("  将补齐旧合同最后一期 [保证金转出]至续约合同")
        if not candidate.has_deposit_transfer_in:
            print("  将补齐新合同 [从续约前合同转入] 保证金冲抵")
        if candidate.stale_adjustment_ids:
            print(f"  将删除重复/旧式保证金转移调整项: {', '.join(candidate.stale_adjustment_ids)}")
        if candidate.needs_rate_backfill:
            print("  将按管理费金额和员工级别反推新合同管理费率")
        return

    old_contract = db.session.get(NannyContract, candidate.old_contract_id)
    if not old_contract:
        raise ValueError(f"旧合同不存在: {candidate.old_contract_id}")

    successor = db.session.get(BaseContract, candidate.new_contract_id)
    if not successor:
        raise ValueError(f"续约合同不存在: {candidate.new_contract_id}")

    if candidate.future_bill_ids:
        FinancialActivityLog.query.filter(
            FinancialActivityLog.customer_bill_id.in_(candidate.future_bill_ids)
        ).delete(synchronize_session=False)
        CustomerBill.query.filter(CustomerBill.id.in_(candidate.future_bill_ids)).delete(
            synchronize_session=False
        )

    if candidate.future_payroll_ids:
        FinancialActivityLog.query.filter(
            FinancialActivityLog.employee_payroll_id.in_(candidate.future_payroll_ids)
        ).delete(synchronize_session=False)
        EmployeePayroll.query.filter(
            EmployeePayroll.id.in_(candidate.future_payroll_ids)
        ).delete(synchronize_session=False)

    if candidate.needs_rate_backfill:
        amount = Decimal(successor.management_fee_amount or 0)
        level = Decimal(successor.employee_level or 0)
        if amount > 0 and level > 0:
            if isinstance(successor, MaternityNurseContract):
                total_amount = level + amount
                if total_amount > 0:
                    successor.management_fee_rate = amount / total_amount
            else:
                successor.management_fee_rate = amount / level
            db.session.add(successor)

    service = ContractService()
    if candidate.stale_adjustment_ids:
        FinancialAdjustment.query.filter(
            FinancialAdjustment.id.in_(candidate.stale_adjustment_ids)
        ).delete(synchronize_session=False)

    service._finalize_old_contract_after_renewal(old_contract, candidate.cutoff_date)
    if old_contract.security_deposit_paid and old_contract.security_deposit_paid > 0:
        service._ensure_renewal_deposit_transfer(
            old_contract,
            successor,
            candidate.cutoff_date,
        )


def main() -> int:
    from backend.app import app

    parser = argparse.ArgumentParser(
        description="清理历史上续约后未停用旧月签育儿嫂合同造成的重复账单"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="演习模式，只打印命中的合同和将执行的操作，不实际修改数据库",
    )
    parser.add_argument(
        "--contract-id",
        help="只检查指定合同。可传旧合同ID或续约后的新合同ID。",
    )
    parser.add_argument(
        "--include-mid-month",
        action="store_true",
        help="同时处理月中开始的续约合同。默认只处理新合同每月1号开始的保守场景。",
    )
    args = parser.parse_args()

    with app.app_context():
        candidates = find_cleanup_candidates(
            contract_id=args.contract_id,
            include_mid_month=args.include_mid_month,
        )

        print(f"找到 {len(candidates)} 个待处理合同。")
        if not candidates:
            return 0

        if args.dry_run:
            for candidate in candidates:
                apply_cleanup_candidate(candidate, dry_run=True)
            print("演习模式结束。移除 --dry-run 即可执行实际清理。")
            return 0

        cleaned = 0
        for candidate in candidates:
            try:
                with db.session.begin_nested():
                    apply_cleanup_candidate(candidate, dry_run=False)
                db.session.commit()
                cleaned += 1
            except Exception as exc:
                db.session.rollback()
                print(f"[ERROR] 处理合同失败 {candidate.old_contract_id}: {exc}")

        print(f"实际完成清理 {cleaned}/{len(candidates)} 个合同。")
        return 0 if cleaned == len(candidates) else 1


if __name__ == "__main__":
    raise SystemExit(main())
