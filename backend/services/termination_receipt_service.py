"""首月终止时，按线下预收业务约定补记漏录的管理费和保证金。"""

from datetime import datetime
from decimal import Decimal

from backend.models import (
    db, AdjustmentType, CustomerBill, FinancialAdjustment, NannyContract,
    PaymentRecord,
)
from backend.services.billing_engine import _update_bill_payment_status


def record_first_month_offline_receipt(contract, bill, termination_date, user_id):
    """仅处理首月且完全没有收款记录的育儿嫂合同，不提交事务。"""
    zero = Decimal("0.00")
    if not isinstance(contract, NannyContract):
        return zero
    start = contract.actual_onboarding_date or contract.start_date
    if isinstance(start, datetime):
        start = start.date()
    if not start or termination_date < start:
        return zero
    if (start.year, start.month) != (termination_date.year, termination_date.month):
        return zero

    first_bill = CustomerBill.query.filter_by(
        contract_id=contract.id, is_substitute_bill=False,
    ).order_by(CustomerBill.cycle_start_date.asc()).first()
    if not first_bill or first_bill.id != bill.id:
        return zero
    if bill.total_paid or PaymentRecord.query.join(CustomerBill).filter(
        CustomerBill.contract_id == contract.id,
    ).first():
        return zero

    management_fee = max(zero, Decimal(str(
        (bill.calculation_details or {}).get("management_fee") or 0
    )))
    deposit = max(zero, Decimal(str(contract.security_deposit_paid or 0)))
    # 前合同转入的冲抵额度不属于本合同新收到的款项。
    credits = FinancialAdjustment.query.filter(
        FinancialAdjustment.customer_bill_id == bill.id,
        FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DECREASE,
        FinancialAdjustment.description.contains("转入"),
    ).all()
    for credit in credits:
        amount = max(zero, Decimal(str(credit.amount or 0)))
        if "保证金" in (credit.description or ""):
            deposit = max(zero, deposit - amount)
        elif "管理费" in (credit.description or ""):
            management_fee = max(zero, management_fee - amount)
    discount = max(zero, Decimal(str(
        (bill.calculation_details or {}).get("discount") or 0
    )))
    amount = (management_fee + deposit - discount).quantize(Decimal("0.01"))
    if amount <= 0:
        return zero

    db.session.add(PaymentRecord(
        customer_bill_id=bill.id,
        amount=amount,
        payment_date=termination_date,
        method="offline",
        notes=(
            "[系统补记] 首月终止，按业务约定管理费及保证金已在线下收齐。"
            f"管理费{management_fee:.2f}元，保证金{deposit:.2f}元。"
            f"扣除优惠{discount:.2f}元。"
            "支付日期使用终止日作为补记日期，实际线下收款日期未登记。"
        ),
        created_by_user_id=user_id,
    ))
    db.session.flush()
    _update_bill_payment_status(bill)
    return amount
