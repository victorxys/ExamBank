from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
import calendar
import uuid

from flask import current_app
from sqlalchemy.orm.attributes import flag_modified

from backend.extensions import db
from backend.models import (
    AdjustmentType,
    AttendanceForm,
    BaseContract,
    CustomerBill,
    EmployeePayroll,
    FinancialAdjustment,
)


D = Decimal
MONEY = D("0.01")
ATTENDANCE_RECORD_KEYS = [
    "rest_records",
    "leave_records",
    "overtime_records",
    "out_of_beijing_records",
    "out_of_country_records",
    "paid_leave_records",
    "onboarding_records",
    "offboarding_records",
]


def _to_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value:
        return datetime.fromisoformat(str(value)).date()
    return None


def _month_bounds(cycle_start):
    cycle_start = _to_date(cycle_start)
    _, last_day = calendar.monthrange(cycle_start.year, cycle_start.month)
    return date(cycle_start.year, cycle_start.month, 1), date(cycle_start.year, cycle_start.month, last_day)


def _contract_start(contract):
    return _to_date(getattr(contract, "actual_onboarding_date", None) or contract.start_date)


def _contract_end(contract):
    if not contract:
        return None
    if getattr(contract, "termination_date", None):
        return _to_date(contract.termination_date)
    is_monthly = bool(getattr(contract, "is_monthly_auto_renew", False))
    if is_monthly and contract.status in ("active", "pending"):
        return None
    return _to_date(contract.end_date)


def _contract_cycle_in_month(contract, month_start, month_end):
    bill = CustomerBill.query.filter(
        CustomerBill.contract_id == contract.id,
        CustomerBill.is_substitute_bill == False,
        CustomerBill.cycle_start_date <= month_end,
        CustomerBill.cycle_end_date >= month_start,
    ).order_by(CustomerBill.cycle_start_date.asc()).first()
    if bill:
        bill_start = _to_date(bill.cycle_start_date)
        bill_end = _to_date(bill.cycle_end_date)
        return max(month_start, bill_start), min(month_end, bill_end)

    start = _contract_start(contract)
    if not start or start > month_end:
        return None, None

    end = _contract_end(contract) or month_end
    if end < month_start:
        return None, None

    return max(month_start, start), min(month_end, end)


def _same_family_or_customer(left, right):
    if not left or not right:
        return False
    if left.family_id and right.family_id:
        return left.family_id == right.family_id
    if left.customer_id and right.customer_id:
        return str(left.customer_id) == str(right.customer_id)
    return bool(left.customer_name and left.customer_name == right.customer_name)


def _related_contracts_for_month(form):
    month_start, month_end = _month_bounds(form.cycle_start_date)
    source_contract = form.contract
    if not source_contract:
        return []

    candidates = BaseContract.query.filter(
        BaseContract.service_personnel_id == form.employee_id,
        BaseContract.status.in_(["active", "pending", "terminated", "finished", "completed"]),
        BaseContract.start_date <= month_end,
    ).order_by(BaseContract.start_date.asc()).all()

    related = []
    for contract in candidates:
        if not _same_family_or_customer(source_contract, contract):
            continue
        cycle_start, cycle_end = _contract_cycle_in_month(contract, month_start, month_end)
        if cycle_start and cycle_end:
            related.append(contract)
    return related


def _record_minutes(record):
    hours = record.get("hours", 0) or 0
    minutes = record.get("minutes", 0) or 0
    total_hours = D(str(hours))
    if not (isinstance(hours, float) and hours % 1 != 0):
        total_hours += D(str(minutes)) / D(60)
    return total_hours * D(60)


def _set_duration(record, minutes):
    minutes = int(D(minutes).to_integral_value(rounding=ROUND_HALF_UP))
    record["hours"] = minutes // 60
    record["minutes"] = minutes % 60


def _clip_record_to_range(record, range_start, range_end):
    record_date = record.get("date")
    if not record_date:
        return None

    record_start = _to_date(record_date)
    if not record_start:
        return None

    days_offset = max(0, int(record.get("daysOffset") or 0))
    record_end = record_start + timedelta(days=days_offset)
    overlap_start = max(record_start, range_start)
    overlap_end = min(record_end, range_end)
    if overlap_start > overlap_end:
        return None

    clipped = deepcopy(record)
    clipped["date"] = overlap_start.isoformat()
    clipped["daysOffset"] = (overlap_end - overlap_start).days

    record_type = record.get("type")
    if record_type in ("onboarding", "offboarding"):
        return clipped

    if overlap_start > record_start:
        clipped["startTime"] = "00:00"
    if overlap_end < record_end:
        clipped["endTime"] = "24:00"

    span_days = D(days_offset + 1)
    overlap_days = D((overlap_end - overlap_start).days + 1)
    total_minutes = _record_minutes(record)
    if total_minutes <= 0 and span_days > 0:
        total_minutes = span_days * D(24 * 60)
    if span_days > 0:
        _set_duration(clipped, total_minutes * overlap_days / span_days)
    return clipped


def _clip_form_data_to_range(form_data, range_start, range_end):
    source = deepcopy(form_data or {})
    clipped = {}
    for key in ATTENDANCE_RECORD_KEYS:
        clipped[key] = []
        for record in source.get(key) or []:
            clipped_record = _clip_record_to_range(record, range_start, range_end)
            if clipped_record:
                clipped[key].append(clipped_record)

    for key, value in source.items():
        if key not in clipped:
            clipped[key] = value
    return clipped


def sync_related_renewal_attendance_forms(attendance_form_id):
    """
    Copy the signed full-month renewal attendance form back to related contract forms.

    The renewal contract keeps the full month for review. Earlier/later contract forms
    receive only records overlapping their own service window so their detail pages show
    the correct overtime/rest/leave markers.
    """
    form = AttendanceForm.query.get(attendance_form_id)
    if not form or not form.contract or not form.form_data:
        return []

    related_contracts = _related_contracts_for_month(form)
    if len(related_contracts) <= 1:
        return []

    month_start, month_end = _month_bounds(form.cycle_start_date)
    source_start = _contract_start(form.contract)
    target_contract_ids = []

    for contract in related_contracts:
        if source_start and _contract_start(contract) and _contract_start(contract) > source_start:
            continue

        cycle_start, cycle_end = _contract_cycle_in_month(contract, month_start, month_end)
        if not cycle_start or not cycle_end:
            continue

        target_form = AttendanceForm.query.filter_by(
            employee_id=form.employee_id,
            contract_id=contract.id,
            cycle_start_date=month_start,
        ).first()

        if not target_form:
            target_form = AttendanceForm(
                contract_id=contract.id,
                employee_id=form.employee_id,
                cycle_start_date=month_start,
                cycle_end_date=month_end,
                form_data={},
                employee_access_token=str(form.employee_id),
                customer_signature_token=str(uuid.uuid4()),
                status="employee_confirmed",
            )
            db.session.add(target_form)
            db.session.flush()

        if str(target_form.id) == str(form.id):
            continue

        target_contract_ids.append(str(contract.id))
        clipped_data = _clip_form_data_to_range(form.form_data, cycle_start, cycle_end)
        if target_form.form_data != clipped_data:
            target_form.form_data = clipped_data
            flag_modified(target_form, "form_data")
            db.session.add(target_form)
            current_app.logger.info(
                "[RenewalAttendanceSync] 已将考勤表 %s 按 %s~%s 回填到合同 %s 的考勤表 %s",
                form.id,
                cycle_start,
                cycle_end,
                contract.id,
                target_form.id,
            )

    return target_contract_ids


def _find_successor_contract(contract):
    successor = BaseContract.query.filter_by(previous_contract_id=contract.id).first()
    if successor:
        return successor

    effective_end = _contract_end(contract) or _to_date(contract.end_date)
    if not effective_end:
        return None

    return BaseContract.query.filter(
        BaseContract.service_personnel_id == contract.service_personnel_id,
        BaseContract.id != contract.id,
        BaseContract.start_date >= effective_end,
        BaseContract.status != "terminated",
    ).order_by(BaseContract.start_date.asc()).first()


BASE_TRANSFER_SOURCE_DESCRIPTION = "[冲抵]员工待付工资转移至续约合同"
BASE_TRANSFER_TARGET_DESCRIPTION = "[转入]前合同合并转入员工待付工资"
OVERTIME_TRANSFER_SOURCE_DESCRIPTION = "[冲抵]续签后补转员工加班费"
OVERTIME_TRANSFER_TARGET_DESCRIPTION = "[转入]前合同补转员工加班费"


def _commission_offset_amount(payroll):
    return sum(
        D(str(adj.amount or 0))
        for adj in FinancialAdjustment.query.filter_by(
            employee_payroll_id=payroll.id,
            adjustment_type=AdjustmentType.EMPLOYEE_COMMISSION_OFFSET,
        ).all()
    )


def _has_payroll_formula_details(details):
    return any(
        key in details
        for key in ("employee_base_payout", "employee_overtime_payout", "employee_increase", "employee_decrease")
    )


def calculate_base_payroll_transfer_amount(payroll):
    """Return the non-overtime employee payroll amount that moves during renewal."""
    details = payroll.calculation_details or {}
    if not _has_payroll_formula_details(details):
        amount = D(str(payroll.total_due or 0)) - D(str(payroll.total_paid_out or 0))
        if amount <= 0:
            return D("0.00")
        return amount.quantize(MONEY, rounding=ROUND_HALF_UP)

    amount = (
        D(str(details.get("employee_base_payout") or 0))
        + D(str(details.get("extension_fee") or 0))
        + D(str(details.get("employee_increase") or 0))
        - _commission_offset_amount(payroll)
        - D(str(details.get("employee_decrease") or 0))
        - D(str(payroll.total_paid_out or 0))
    )
    if amount <= 0:
        return D("0.00")
    return amount.quantize(MONEY, rounding=ROUND_HALF_UP)


def calculate_overtime_payroll_transfer_amount(payroll):
    """Return the overtime amount that should be added after attendance confirmation."""
    details = payroll.calculation_details or {}
    if not _has_payroll_formula_details(details):
        return D("0.00")

    amount = D(str(details.get("employee_overtime_payout") or 0))
    if amount <= 0:
        return D("0.00")
    return amount.quantize(MONEY, rounding=ROUND_HALF_UP)


def calculate_exact_payroll_transfer_amount(payroll):
    """Return the full unrounded employee payroll amount for final company-paid salary."""
    details = payroll.calculation_details or {}
    if not _has_payroll_formula_details(details):
        amount = D(str(payroll.total_due or 0)) - D(str(payroll.total_paid_out or 0))
        if amount <= 0:
            return D("0.00")
        return amount.quantize(MONEY, rounding=ROUND_HALF_UP)

    amount = (
        D(str(details.get("employee_base_payout") or 0))
        + D(str(details.get("employee_overtime_payout") or 0))
        + D(str(details.get("extension_fee") or 0))
        + D(str(details.get("employee_increase") or 0))
        - _commission_offset_amount(payroll)
        - D(str(details.get("employee_decrease") or 0))
        - D(str(payroll.total_paid_out or 0))
    )
    if amount <= 0:
        return D("0.00")
    return amount.quantize(MONEY, rounding=ROUND_HALF_UP)


def _first_bill_and_payroll(contract):
    bill = CustomerBill.query.filter_by(
        contract_id=contract.id,
        is_substitute_bill=False,
    ).order_by(CustomerBill.cycle_start_date.asc()).first()
    payroll = None
    if bill:
        payroll = EmployeePayroll.query.filter_by(
            contract_id=contract.id,
            cycle_start_date=bill.cycle_start_date,
            is_substitute_payroll=False,
        ).first()

    if bill and payroll:
        return bill, payroll

    from backend.services.billing_engine import BillingEngine

    start_date = contract.start_date
    cycle_start = _to_date(start_date)
    _, last_day = calendar.monthrange(cycle_start.year, cycle_start.month)
    cycle_end = date(cycle_start.year, cycle_start.month, last_day)
    return BillingEngine()._get_or_create_bill_and_payroll(
        contract,
        cycle_start.year,
        cycle_start.month,
        start_date,
        cycle_end,
    )


def _find_transfer_adjustment(payroll_id, adjustment_type, description, linked_bill_id):
    query = FinancialAdjustment.query.filter(
        FinancialAdjustment.employee_payroll_id == payroll_id,
        FinancialAdjustment.adjustment_type == adjustment_type,
        FinancialAdjustment.description == description,
    )
    if linked_bill_id:
        matched = query.filter(FinancialAdjustment.details["linked_bill_id"].astext == str(linked_bill_id)).first()
        if matched:
            return matched
    return query.order_by(FinancialAdjustment.created_at.asc()).first()


def _upsert_payroll_transfer_adjustment(
    payroll,
    adjustment_type,
    amount,
    description,
    linked_bill_id,
    linked_contract_id,
    date_,
    extra_details=None,
):
    adjustment = _find_transfer_adjustment(payroll.id, adjustment_type, description, linked_bill_id)
    details = dict(adjustment.details or {}) if adjustment else {}
    details["linked_bill_id"] = str(linked_bill_id)
    details["linked_contract_id"] = str(linked_contract_id)
    if extra_details:
        details.update(extra_details)
    if adjustment:
        adjustment.amount = amount
        adjustment.date = date_
        adjustment.details = details
        db.session.add(adjustment)
        return adjustment

    adjustment = FinancialAdjustment(
        employee_payroll_id=payroll.id,
        contract_id=payroll.contract_id,
        adjustment_type=adjustment_type,
        amount=amount,
        description=description,
        date=date_,
        status="BILLED",
        is_settled=False,
        details=details,
    )
    db.session.add(adjustment)
    return adjustment


def sync_renewal_payroll_transfer(source_contract_id, year, month, recalculate=True):
    """
    Ensure the original renewal payroll transfer uses the exact non-overtime amount.

    This is the historical transfer created during renewal. Later attendance-confirmed
    overtime is synchronized by sync_renewal_overtime_transfer as a separate item.
    """
    source_contract = BaseContract.query.get(source_contract_id)
    if not source_contract or not source_contract.service_personnel_id:
        return False

    successor = _find_successor_contract(source_contract)
    if not successor or str(successor.service_personnel_id) != str(source_contract.service_personnel_id):
        return False

    successor_start = _to_date(successor.start_date)
    if successor_start:
        renewal_month_anchor = successor_start - timedelta(days=1)
        if (year, month) != (renewal_month_anchor.year, renewal_month_anchor.month):
            return False

    source_bill = CustomerBill.query.filter_by(
        contract_id=source_contract.id,
        year=year,
        month=month,
        is_substitute_bill=False,
    ).order_by(CustomerBill.cycle_end_date.desc()).first()
    if not source_bill:
        return False

    source_payroll = EmployeePayroll.query.filter_by(
        contract_id=source_contract.id,
        cycle_start_date=source_bill.cycle_start_date,
        is_substitute_payroll=False,
    ).first()
    if not source_payroll:
        return False

    target_bill, target_payroll = _first_bill_and_payroll(successor)
    if not target_bill or not target_payroll:
        return False

    amount = calculate_base_payroll_transfer_amount(source_payroll)
    transfer_date = _to_date(source_bill.cycle_end_date) or date.today()
    target_date = _to_date(target_bill.cycle_start_date) or transfer_date

    _upsert_payroll_transfer_adjustment(
        source_payroll,
        AdjustmentType.EMPLOYEE_BALANCE_TRANSFER,
        amount,
        BASE_TRANSFER_SOURCE_DESCRIPTION,
        target_bill.id,
        successor.id,
        transfer_date,
        {"renewal_base_transfer": True},
    )
    _upsert_payroll_transfer_adjustment(
        target_payroll,
        AdjustmentType.EMPLOYEE_INCREASE,
        amount,
        BASE_TRANSFER_TARGET_DESCRIPTION,
        source_bill.id,
        source_contract.id,
        target_date,
        {"renewal_base_transfer": True},
    )
    db.session.flush()

    current_app.logger.info(
        "[RenewalPayrollTransfer] 合同 %s -> %s 基础工资转移金额同步为 %s",
        source_contract.id,
        successor.id,
        amount,
    )

    if recalculate:
        from backend.services.billing_engine import BillingEngine

        engine = BillingEngine()
        engine.calculate_for_month(
            source_bill.year,
            source_bill.month,
            contract_id=str(source_contract.id),
            force_recalculate=True,
            cycle_start_date_override=source_bill.cycle_start_date,
            end_date_override=source_bill.cycle_end_date,
        )
        engine.calculate_for_month(
            target_bill.year,
            target_bill.month,
            contract_id=str(successor.id),
            force_recalculate=True,
            cycle_start_date_override=target_bill.cycle_start_date,
            end_date_override=target_bill.cycle_end_date,
        )

    return True


def sync_renewal_overtime_transfer(source_contract_id, year, month, recalculate=True):
    """Create or update the separate overtime transfer created after attendance confirmation."""
    source_contract = BaseContract.query.get(source_contract_id)
    if not source_contract or not source_contract.service_personnel_id:
        return False

    successor = _find_successor_contract(source_contract)
    if not successor or str(successor.service_personnel_id) != str(source_contract.service_personnel_id):
        return False

    successor_start = _to_date(successor.start_date)
    if successor_start:
        renewal_month_anchor = successor_start - timedelta(days=1)
        if (year, month) != (renewal_month_anchor.year, renewal_month_anchor.month):
            return False

    source_bill = CustomerBill.query.filter_by(
        contract_id=source_contract.id,
        year=year,
        month=month,
        is_substitute_bill=False,
    ).order_by(CustomerBill.cycle_end_date.desc()).first()
    if not source_bill:
        return False

    source_payroll = EmployeePayroll.query.filter_by(
        contract_id=source_contract.id,
        cycle_start_date=source_bill.cycle_start_date,
        is_substitute_payroll=False,
    ).first()
    if not source_payroll:
        return False

    target_bill, target_payroll = _first_bill_and_payroll(successor)
    if not target_bill or not target_payroll:
        return False

    amount = calculate_overtime_payroll_transfer_amount(source_payroll)
    if amount <= 0:
        return False

    transfer_date = _to_date(source_bill.cycle_end_date) or date.today()
    target_date = _to_date(target_bill.cycle_start_date) or transfer_date
    marker_details = {"renewal_overtime_transfer": True}

    _upsert_payroll_transfer_adjustment(
        source_payroll,
        AdjustmentType.EMPLOYEE_BALANCE_TRANSFER,
        amount,
        OVERTIME_TRANSFER_SOURCE_DESCRIPTION,
        target_bill.id,
        successor.id,
        transfer_date,
        marker_details,
    )
    _upsert_payroll_transfer_adjustment(
        target_payroll,
        AdjustmentType.EMPLOYEE_INCREASE,
        amount,
        OVERTIME_TRANSFER_TARGET_DESCRIPTION,
        source_bill.id,
        source_contract.id,
        target_date,
        marker_details,
    )
    db.session.flush()

    current_app.logger.info(
        "[RenewalOvertimeTransfer] 合同 %s -> %s 加班费补转金额同步为 %s",
        source_contract.id,
        successor.id,
        amount,
    )

    if recalculate:
        from backend.services.billing_engine import BillingEngine

        engine = BillingEngine()
        engine.calculate_for_month(
            source_bill.year,
            source_bill.month,
            contract_id=str(source_contract.id),
            force_recalculate=True,
            cycle_start_date_override=source_bill.cycle_start_date,
            end_date_override=source_bill.cycle_end_date,
        )
        engine.calculate_for_month(
            target_bill.year,
            target_bill.month,
            contract_id=str(successor.id),
            force_recalculate=True,
            cycle_start_date_override=target_bill.cycle_start_date,
            end_date_override=target_bill.cycle_end_date,
        )

    return True


def sync_renewal_after_attendance_confirmation(attendance_form_id):
    """Run all renewal follow-up work after an attendance form is confirmed."""
    form = AttendanceForm.query.get(attendance_form_id)
    if not form:
        return

    changed_contract_ids = sync_related_renewal_attendance_forms(attendance_form_id)
    if not changed_contract_ids:
        return

    year = form.cycle_start_date.year
    month = form.cycle_start_date.month

    from backend.services.billing_engine import BillingEngine

    engine = BillingEngine()
    for contract_id in changed_contract_ids:
        bill = CustomerBill.query.filter_by(
            contract_id=contract_id,
            year=year,
            month=month,
            is_substitute_bill=False,
        ).order_by(CustomerBill.cycle_end_date.desc()).first()
        if not bill:
            continue
        engine.calculate_for_month(
            bill.year,
            bill.month,
            contract_id=str(contract_id),
            force_recalculate=True,
            cycle_start_date_override=bill.cycle_start_date,
            end_date_override=bill.cycle_end_date,
        )
        sync_renewal_overtime_transfer(contract_id, year, month, recalculate=False)

        refreshed_bill = CustomerBill.query.filter_by(
            contract_id=contract_id,
            year=year,
            month=month,
            is_substitute_bill=False,
        ).order_by(CustomerBill.cycle_end_date.desc()).first()
        if refreshed_bill:
            engine.calculate_for_month(
                refreshed_bill.year,
                refreshed_bill.month,
                contract_id=str(contract_id),
                force_recalculate=True,
                cycle_start_date_override=refreshed_bill.cycle_start_date,
                end_date_override=refreshed_bill.cycle_end_date,
            )

        source_contract = BaseContract.query.get(contract_id)
        successor = _find_successor_contract(source_contract) if source_contract else None
        if successor:
            target_bill = CustomerBill.query.filter_by(
                contract_id=successor.id,
                is_substitute_bill=False,
            ).order_by(CustomerBill.cycle_start_date.asc()).first()
            if target_bill:
                engine.calculate_for_month(
                    target_bill.year,
                    target_bill.month,
                    contract_id=str(successor.id),
                    force_recalculate=True,
                    cycle_start_date_override=target_bill.cycle_start_date,
                    end_date_override=target_bill.cycle_end_date,
                )
