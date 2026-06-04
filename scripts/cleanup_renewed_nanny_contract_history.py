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

from sqlalchemy import and_, func, or_
from sqlalchemy.orm.attributes import flag_modified

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
    AttendanceRecord,
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
    has_bill_merge_transfer: bool
    has_payroll_transfer_out: bool
    has_payroll_transfer_in: bool
    has_final_salary_adjustments: bool
    stale_adjustment_ids: list[str]
    needs_bill_total_recalc: bool
    needs_successor_work_days_recalc: bool
    needs_attendance_allocation_recalc: bool
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
            or (self.has_payroll_transfer_out and not self.has_payroll_transfer_in)
            or self.has_final_salary_adjustments
            or bool(self.stale_adjustment_ids)
            or self.needs_bill_total_recalc
            or self.needs_successor_work_days_recalc
            or self.needs_attendance_allocation_recalc
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


def _upsert_bill_adjustment(
    bill: CustomerBill,
    adjustment_type: AdjustmentType,
    amount: Decimal,
    description: str,
    adjustment_date: date,
    details: dict | None = None,
) -> FinancialAdjustment:
    query = FinancialAdjustment.query.filter(
        FinancialAdjustment.customer_bill_id == bill.id,
        FinancialAdjustment.adjustment_type == adjustment_type,
        FinancialAdjustment.description == description,
    )
    if details:
        for key, value in details.items():
            query = query.filter(FinancialAdjustment.details[key].astext == str(value))

    adjustment = query.first()
    if adjustment:
        adjustment.amount = amount
        adjustment.date = adjustment_date
        adjustment.details = details or adjustment.details
    else:
        adjustment = FinancialAdjustment(
            customer_bill_id=bill.id,
            adjustment_type=adjustment_type,
            amount=amount,
            description=description,
            date=adjustment_date,
            details=details,
        )
        db.session.add(adjustment)
    return adjustment


def _recalculate_bill_total_from_adjustments(bill: CustomerBill) -> None:
    details = bill.calculation_details or {}
    total_paid_salary_adjustments = Decimal("0")
    for adjustment in FinancialAdjustment.query.filter(
        FinancialAdjustment.customer_bill_id == bill.id,
        FinancialAdjustment.adjustment_type.in_(
            [AdjustmentType.COMPANY_PAID_SALARY, AdjustmentType.DEPOSIT_PAID_SALARY]
        ),
    ).all():
        total_paid_salary_adjustments += Decimal(adjustment.amount or 0)

    customer_increase = Decimal("0")
    customer_decrease = Decimal("0")
    for adjustment in FinancialAdjustment.query.filter_by(customer_bill_id=bill.id).all():
        if adjustment.adjustment_type in [
            AdjustmentType.CUSTOMER_INCREASE,
            AdjustmentType.INTRODUCTION_FEE,
            AdjustmentType.DEPOSIT,
            AdjustmentType.DEFERRED_FEE,
        ]:
            customer_increase += Decimal(adjustment.amount or 0)
        elif adjustment.adjustment_type in [
            AdjustmentType.CUSTOMER_DECREASE,
            AdjustmentType.CUSTOMER_DISCOUNT,
        ]:
            customer_decrease += Decimal(adjustment.amount or 0)

    total_due = (
        Decimal(details.get("management_fee", 0))
        + Decimal(details.get("introduction_fee", 0))
        + customer_increase
        + Decimal(details.get("deferred_fee", "0.00"))
        + Decimal(details.get("extension_fee_reason", "0.00"))
        + total_paid_salary_adjustments
        - customer_decrease
        - Decimal(details.get("discount", 0))
    ).quantize(Decimal("1"))

    details["customer_increase"] = str(customer_increase)
    details["customer_decrease"] = str(customer_decrease)
    details["total_paid_salary_adjustments"] = str(total_paid_salary_adjustments)
    details["total_due"] = str(total_due)
    bill.calculation_details = details
    flag_modified(bill, "calculation_details")
    bill.total_due = total_due
    db.session.add(bill)


def _calculate_bill_total_from_adjustments(bill: CustomerBill) -> tuple[Decimal, Decimal, Decimal]:
    details = bill.calculation_details or {}
    customer_increase = Decimal("0")
    customer_decrease = Decimal("0")
    total_paid_salary_adjustments = Decimal("0")

    for adjustment in FinancialAdjustment.query.filter_by(customer_bill_id=bill.id).all():
        if adjustment.adjustment_type in [
            AdjustmentType.CUSTOMER_INCREASE,
            AdjustmentType.INTRODUCTION_FEE,
            AdjustmentType.DEPOSIT,
            AdjustmentType.DEFERRED_FEE,
        ]:
            customer_increase += Decimal(adjustment.amount or 0)
        elif adjustment.adjustment_type in [
            AdjustmentType.CUSTOMER_DECREASE,
            AdjustmentType.CUSTOMER_DISCOUNT,
        ]:
            customer_decrease += Decimal(adjustment.amount or 0)

        if adjustment.adjustment_type in [
            AdjustmentType.COMPANY_PAID_SALARY,
            AdjustmentType.DEPOSIT_PAID_SALARY,
        ]:
            total_paid_salary_adjustments += Decimal(adjustment.amount or 0)

    total_due = (
        Decimal(details.get("management_fee", 0))
        + Decimal(details.get("introduction_fee", 0))
        + customer_increase
        + Decimal(details.get("deferred_fee", "0.00"))
        + Decimal(details.get("extension_fee_reason", "0.00"))
        + total_paid_salary_adjustments
        - customer_decrease
        - Decimal(details.get("discount", 0))
    ).quantize(Decimal("1"))

    return total_due, customer_increase, customer_decrease


def _needs_bill_total_recalc(bill: CustomerBill | None) -> bool:
    if not bill:
        return False
    total_due, customer_increase, customer_decrease = _calculate_bill_total_from_adjustments(bill)
    details = bill.calculation_details or {}
    try:
        details_total_due = Decimal(details.get("total_due", bill.total_due or 0)).quantize(Decimal("1"))
        details_customer_increase = Decimal(details.get("customer_increase", 0))
        details_customer_decrease = Decimal(details.get("customer_decrease", 0))
    except Exception:
        return True

    return (
        Decimal(bill.total_due or 0).quantize(Decimal("1")) != total_due
        or details_total_due != total_due
        or details_customer_increase != customer_increase
        or details_customer_decrease != customer_decrease
    )


def _needs_rate_backfill(contract: BaseContract) -> bool:
    try:
        rate = Decimal(contract.management_fee_rate or 0)
        amount = Decimal(contract.management_fee_amount or 0)
        level = Decimal(contract.employee_level or 0)
    except Exception:
        return False
    return rate <= 0 and amount > 0 and level > 0


def _find_first_bill(contract_id) -> CustomerBill | None:
    return CustomerBill.query.filter_by(
        contract_id=contract_id,
        is_substitute_bill=False,
    ).order_by(CustomerBill.cycle_start_date.asc()).first()


def _find_first_payroll(contract_id) -> EmployeePayroll | None:
    return EmployeePayroll.query.filter_by(
        contract_id=contract_id,
        is_substitute_payroll=False,
    ).order_by(EmployeePayroll.cycle_start_date.asc()).first()


def _find_payroll_for_bill(bill: CustomerBill | None) -> EmployeePayroll | None:
    if not bill:
        return None
    return EmployeePayroll.query.filter_by(
        contract_id=bill.contract_id,
        year=bill.year,
        month=bill.month,
        cycle_start_date=bill.cycle_start_date,
        is_substitute_payroll=bill.is_substitute_bill,
    ).first()


def _has_payroll_transfer_out(
    source_payroll: EmployeePayroll | None,
    target_bill: CustomerBill | None,
) -> bool:
    if not source_payroll or not target_bill:
        return False
    return _has_financial_adjustment(
        FinancialAdjustment.query.filter(
            FinancialAdjustment.employee_payroll_id == source_payroll.id,
            FinancialAdjustment.adjustment_type == AdjustmentType.EMPLOYEE_BALANCE_TRANSFER,
            FinancialAdjustment.description == "[冲抵]员工待付工资转移至续约合同",
            FinancialAdjustment.details["linked_bill_id"].astext == str(target_bill.id),
        )
    )


def _has_payroll_transfer_in(
    target_payroll: EmployeePayroll | None,
    source_bill: CustomerBill | None,
) -> bool:
    if not target_payroll or not source_bill:
        return False
    return _has_financial_adjustment(
        FinancialAdjustment.query.filter(
            FinancialAdjustment.employee_payroll_id == target_payroll.id,
            FinancialAdjustment.adjustment_type == AdjustmentType.EMPLOYEE_INCREASE,
            FinancialAdjustment.description == "[转入]前合同合并转入员工待付工资",
            FinancialAdjustment.details["linked_bill_id"].astext == str(source_bill.id),
        )
    )


def _get_payroll_transfer_out_amount(
    source_payroll: EmployeePayroll | None,
    target_bill: CustomerBill | None,
) -> Decimal:
    if not source_payroll or not target_bill:
        return Decimal("0")
    amount = db.session.query(func.coalesce(func.sum(FinancialAdjustment.amount), 0)).filter(
        FinancialAdjustment.employee_payroll_id == source_payroll.id,
        FinancialAdjustment.adjustment_type == AdjustmentType.EMPLOYEE_BALANCE_TRANSFER,
        FinancialAdjustment.description == "[冲抵]员工待付工资转移至续约合同",
        FinancialAdjustment.details["linked_bill_id"].astext == str(target_bill.id),
    ).scalar()
    return Decimal(amount or 0)


def _allowed_nanny_work_days(bill: CustomerBill | None) -> Decimal | None:
    if not bill:
        return None

    cycle_start = _to_date(bill.cycle_start_date)
    cycle_end = _to_date(bill.cycle_end_date)
    if not cycle_start or not cycle_end:
        return None

    return Decimal(min((cycle_end - cycle_start).days + 1, 26))


def _needs_successor_work_days_recalc(
    bill: CustomerBill | None,
    payroll: EmployeePayroll | None,
) -> bool:
    allowed_days = _allowed_nanny_work_days(bill)
    if allowed_days is None:
        return False

    for value in [getattr(bill, "actual_work_days", None), getattr(payroll, "actual_work_days", None)]:
        if value is not None and Decimal(value) > allowed_days:
            return True
    return False


def _needs_attendance_allocation_recalc(
    old_contract: NannyContract,
    successor: BaseContract,
    last_bill: CustomerBill | None,
    first_successor_bill: CustomerBill | None,
) -> bool:
    if not last_bill or not first_successor_bill:
        return False
    if _to_date(successor.start_date) and _to_date(successor.start_date).day == 1:
        return False
    return bool(
        AttendanceRecord.query.filter(
            AttendanceRecord.employee_id == successor.service_personnel_id,
            AttendanceRecord.attendance_form_id.isnot(None),
            AttendanceRecord.cycle_start_date >= date(first_successor_bill.year, first_successor_bill.month, 1),
            AttendanceRecord.cycle_start_date < (
                date(first_successor_bill.year + 1, 1, 1)
                if first_successor_bill.month == 12
                else date(first_successor_bill.year, first_successor_bill.month + 1, 1)
            ),
        ).first()
    )


def _has_final_salary_adjustments_after_payroll_transfer(
    last_bill: CustomerBill | None,
    last_payroll: EmployeePayroll | None,
    has_payroll_transfer_out: bool,
) -> bool:
    if not last_bill or not has_payroll_transfer_out:
        return False
    has_company_paid_salary = _has_financial_adjustment(
        FinancialAdjustment.query.filter(
            FinancialAdjustment.customer_bill_id == last_bill.id,
            FinancialAdjustment.adjustment_type == AdjustmentType.COMPANY_PAID_SALARY,
        )
    )
    has_deposit_paid_salary = False
    if last_payroll:
        has_deposit_paid_salary = _has_financial_adjustment(
            FinancialAdjustment.query.filter(
                FinancialAdjustment.employee_payroll_id == last_payroll.id,
                FinancialAdjustment.adjustment_type == AdjustmentType.DEPOSIT_PAID_SALARY,
            )
        )
    return has_company_paid_salary or has_deposit_paid_salary


def _has_linked_bill_merge_transfer(
    source_bill: CustomerBill | None,
    target_bill: CustomerBill | None,
) -> bool:
    """
    月中续约走 BillMergeService 的账单合并逻辑，不会生成月初续约那套固定保证金转移项。
    只要源账单和目标账单之间存在互相关联的合并调整项，就视为费用转移链路已完成。
    """
    if not source_bill or not target_bill:
        return False

    source_to_target = _has_financial_adjustment(
        FinancialAdjustment.query.filter(
            FinancialAdjustment.customer_bill_id == source_bill.id,
            FinancialAdjustment.details["linked_bill_id"].astext == str(target_bill.id),
            FinancialAdjustment.description.contains("客户待付/待退费用转移至续约合同"),
        )
    )
    target_from_source = _has_financial_adjustment(
        FinancialAdjustment.query.filter(
            FinancialAdjustment.customer_bill_id == target_bill.id,
            FinancialAdjustment.details["linked_bill_id"].astext == str(source_bill.id),
            FinancialAdjustment.description.contains("前合同合并转入"),
        )
    )

    return source_to_target and target_from_source


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

        first_successor_bill = _find_first_bill(successor.id)
        first_successor_payroll = _find_first_payroll(successor.id)
        last_payroll = _find_payroll_for_bill(last_bill)
        has_bill_merge_transfer = (
            successor_start_date.day != 1
            and _has_linked_bill_merge_transfer(last_bill, first_successor_bill)
        )
        has_payroll_transfer_out = _has_payroll_transfer_out(last_payroll, first_successor_bill)
        has_payroll_transfer_in = _has_payroll_transfer_in(first_successor_payroll, last_bill)
        has_final_salary_adjustments = _has_final_salary_adjustments_after_payroll_transfer(
            last_bill,
            last_payroll,
            has_payroll_transfer_out,
        )

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

        if has_bill_merge_transfer:
            has_deposit_transfer_out = True

        has_deposit_transfer_in = _has_financial_adjustment(
            FinancialAdjustment.query.filter(
                FinancialAdjustment.contract_id == successor.id,
                FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DECREASE,
                FinancialAdjustment.description == "[从续约前合同转入] 保证金冲抵",
                FinancialAdjustment.details["transferred_from_contract_id"].astext == str(old_contract.id),
            )
        )
        if has_bill_merge_transfer:
            has_deposit_transfer_in = True

        stale_adjustment_ids = _find_stale_renewal_deposit_adjustment_ids(
            old_contract=old_contract,
            successor=successor,
            last_bill=last_bill,
        )
        needs_bill_total_recalc = _needs_bill_total_recalc(last_bill)
        if has_bill_merge_transfer:
            needs_bill_total_recalc = False

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
            has_bill_merge_transfer=has_bill_merge_transfer,
            has_payroll_transfer_out=has_payroll_transfer_out,
            has_payroll_transfer_in=has_payroll_transfer_in,
            has_final_salary_adjustments=has_final_salary_adjustments,
            stale_adjustment_ids=stale_adjustment_ids,
            needs_bill_total_recalc=needs_bill_total_recalc,
            needs_successor_work_days_recalc=_needs_successor_work_days_recalc(
                first_successor_bill,
                first_successor_payroll,
            ),
            needs_attendance_allocation_recalc=_needs_attendance_allocation_recalc(
                old_contract,
                successor,
                last_bill,
                first_successor_bill,
            ),
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
        f"bill_merge_transfer={candidate.has_bill_merge_transfer} | "
        f"payroll_transfer_out={candidate.has_payroll_transfer_out} | "
        f"payroll_transfer_in={candidate.has_payroll_transfer_in} | "
        f"has_final_salary_adjustments={candidate.has_final_salary_adjustments} | "
        f"stale_adjustments={len(candidate.stale_adjustment_ids)} | "
        f"needs_bill_total_recalc={candidate.needs_bill_total_recalc} | "
        f"needs_successor_work_days_recalc={candidate.needs_successor_work_days_recalc} | "
        f"needs_attendance_allocation_recalc={candidate.needs_attendance_allocation_recalc} | "
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
        if candidate.has_payroll_transfer_out and not candidate.has_payroll_transfer_in:
            print("  将补齐新合同首期工资单 [转入]前合同合并转入员工待付工资")
        if candidate.has_final_salary_adjustments:
            print("  将删除续签月不应保留的 [系统] 公司代付工资 / [系统] 保证金支付工资")
        if candidate.needs_bill_total_recalc:
            print("  将按当前调整项重算旧合同最后一期账单总额和计算明细")
        if candidate.needs_successor_work_days_recalc:
            print("  将按续约新合同首期账单周期重算实际劳务天数、账单和工资单")
        if candidate.needs_attendance_allocation_recalc:
            print("  将按整月签署考勤表重新分配旧合同最后一期与新合同首期考勤，并重算账单/工资单")
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

    if candidate.has_final_salary_adjustments:
        last_bill = _find_last_bill_for_cutoff(old_contract.id, candidate.cutoff_date)
        last_payroll = _find_payroll_for_bill(last_bill)
        if last_bill:
            FinancialAdjustment.query.filter(
                FinancialAdjustment.customer_bill_id == last_bill.id,
                FinancialAdjustment.adjustment_type == AdjustmentType.COMPANY_PAID_SALARY,
            ).delete(synchronize_session=False)
        if last_payroll:
            FinancialAdjustment.query.filter(
                FinancialAdjustment.employee_payroll_id == last_payroll.id,
                FinancialAdjustment.adjustment_type == AdjustmentType.DEPOSIT_PAID_SALARY,
            ).delete(synchronize_session=False)

    service._finalize_old_contract_after_renewal(old_contract, candidate.cutoff_date)
    if (
        old_contract.security_deposit_paid
        and old_contract.security_deposit_paid > 0
        and not candidate.has_bill_merge_transfer
    ):
        service._ensure_renewal_deposit_transfer(
            old_contract,
            successor,
            candidate.cutoff_date,
        )
        last_bill = _find_last_bill_for_cutoff(old_contract.id, candidate.cutoff_date)
        if not last_bill:
            raise ValueError(f"旧合同 {old_contract.id} 未找到截止日前最后一期账单，无法补齐保证金调整项。")

        _upsert_bill_adjustment(
            bill=last_bill,
            adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
            amount=old_contract.security_deposit_paid,
            description="[系统添加] 保证金退款",
            adjustment_date=candidate.cutoff_date,
        )
        _upsert_bill_adjustment(
            bill=last_bill,
            adjustment_type=AdjustmentType.CUSTOMER_INCREASE,
            amount=old_contract.security_deposit_paid,
            description="[保证金转出]至续约合同",
            adjustment_date=candidate.cutoff_date,
            details={"transferred_to_contract_id": str(successor.id)},
        )
        _recalculate_bill_total_from_adjustments(last_bill)
    elif candidate.needs_bill_total_recalc:
        last_bill = _find_last_bill_for_cutoff(old_contract.id, candidate.cutoff_date)
        if last_bill:
            _recalculate_bill_total_from_adjustments(last_bill)

    if candidate.needs_successor_work_days_recalc or candidate.needs_attendance_allocation_recalc:
        last_bill = _find_last_bill_for_cutoff(old_contract.id, candidate.cutoff_date)
        first_successor_bill = _find_first_bill(successor.id)
        first_successor_payroll = _find_first_payroll(successor.id)
        if last_bill:
            last_bill.actual_work_days = None
            db.session.add(last_bill)
            last_payroll = _find_payroll_for_bill(last_bill)
            if last_payroll:
                last_payroll.actual_work_days = None
                db.session.add(last_payroll)
            AttendanceRecord.query.filter_by(
                contract_id=old_contract.id,
                cycle_start_date=last_bill.cycle_start_date,
            ).delete(synchronize_session=False)
        if first_successor_bill:
            first_successor_bill.actual_work_days = None
            db.session.add(first_successor_bill)
        if first_successor_payroll:
            first_successor_payroll.actual_work_days = None
            db.session.add(first_successor_payroll)
        if first_successor_bill:
            AttendanceRecord.query.filter_by(
                contract_id=successor.id,
                cycle_start_date=first_successor_bill.cycle_start_date,
            ).delete(synchronize_session=False)
        db.session.flush()

        from backend.services.billing_engine import BillingEngine

        engine = BillingEngine()
        if last_bill:
            engine.calculate_for_month(
                year=last_bill.year,
                month=last_bill.month,
                contract_id=old_contract.id,
                force_recalculate=True,
                cycle_start_date_override=last_bill.cycle_start_date,
                end_date_override=last_bill.cycle_end_date,
            )
        engine.calculate_for_month(
            year=successor.start_date.year,
            month=successor.start_date.month,
            contract_id=successor.id,
            force_recalculate=True,
            cycle_start_date_override=first_successor_bill.cycle_start_date if first_successor_bill else None,
            end_date_override=first_successor_bill.cycle_end_date if first_successor_bill else None,
        )

    if candidate.has_payroll_transfer_out and not candidate.has_payroll_transfer_in:
        last_bill = _find_last_bill_for_cutoff(old_contract.id, candidate.cutoff_date)
        source_payroll = _find_payroll_for_bill(last_bill)
        target_bill = _find_first_bill(successor.id)
        target_payroll = _find_first_payroll(successor.id)
        amount = _get_payroll_transfer_out_amount(source_payroll, target_bill)
        if not last_bill or not target_payroll or amount <= 0:
            raise ValueError(f"合同 {successor.id} 无法补齐员工工资转入：缺少源账单、目标工资单或转出金额。")

        existing = FinancialAdjustment.query.filter(
            FinancialAdjustment.employee_payroll_id == target_payroll.id,
            FinancialAdjustment.adjustment_type == AdjustmentType.EMPLOYEE_INCREASE,
            FinancialAdjustment.description == "[转入]前合同合并转入员工待付工资",
            FinancialAdjustment.details["linked_bill_id"].astext == str(last_bill.id),
        ).first()
        if existing:
            existing.amount = amount
            db.session.add(existing)
        else:
            db.session.add(
                FinancialAdjustment(
                    employee_payroll_id=target_payroll.id,
                    contract_id=successor.id,
                    adjustment_type=AdjustmentType.EMPLOYEE_INCREASE,
                    amount=amount,
                    description="[转入]前合同合并转入员工待付工资",
                    date=target_payroll.cycle_start_date,
                    status="BILLED",
                    is_settled=False,
                    details={"linked_bill_id": str(last_bill.id)},
                )
            )
        db.session.flush()

        from backend.services.billing_engine import BillingEngine

        BillingEngine().calculate_for_month(
            year=target_payroll.year,
            month=target_payroll.month,
            contract_id=successor.id,
            force_recalculate=True,
            cycle_start_date_override=target_payroll.cycle_start_date,
            end_date_override=target_payroll.cycle_end_date,
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
