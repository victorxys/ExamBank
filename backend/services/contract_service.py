# backend/services/contract_service.py

from backend.extensions import db
from backend.models import (
    BaseContract,
    MaternityNurseContract,
    FinancialAdjustment,
    AdjustmentType,
)

def upsert_introduction_fee_adjustment(contract: BaseContract):
    """
    根据合同的 introduction_fee 字段，创建或更新对应的财务调整项。
    此函数是幂等的，可以安全地多次调用。

    Args:
        contract: 一个 BaseContract 实例。
    """
    new_amount = contract.introduction_fee

    # 1. 查找该合同是否已存在“介绍费”调整项
    adjustment = FinancialAdjustment.query.filter_by(
        contract_id=contract.id,
        adjustment_type=AdjustmentType.INTRODUCTION_FEE
    ).first()

    # 2. 如果调整项已存在，且状态为 "BILLED"（已入账）
    if adjustment and adjustment.status == 'BILLED':
        # 如果已入账的金额和新金额不同，必须抛出异常阻止操作。
        if adjustment.amount != new_amount:
            raise ValueError(f"致命错误：合同 {contract.id} 的介绍费已入账，禁止修改金额！")
        # 如果金额没变，就什么都不用做，直接返回。
        return

    # 3. 如果调整项已存在（但未入账）
    if adjustment:
        # 如果新金额为0或空，则删除这个待处理的调整项
        if not new_amount or new_amount <= 0:
            db.session.delete(adjustment)
        else:
            # 否则，更新金额
            adjustment.amount = new_amount
            db.session.add(adjustment)

    # 4. 如果调整项不存在，并且新金额大于0
    elif new_amount and new_amount > 0:
        new_adjustment = FinancialAdjustment(
            contract_id=contract.id,
            adjustment_type=AdjustmentType.INTRODUCTION_FEE,
            amount=new_amount,
            description="介绍费",
            date=contract.start_date.date() if contract.start_date else db.func.current_date(),
            status='PENDING'  # 初始状态永远是 PENDING
        )
        db.session.add(new_adjustment)

def create_maternity_nurse_contract_adjustments(contract: MaternityNurseContract):
    """
    为新创建的月嫂合同生成所有必要的一次性财务调整项。
    包括：定金和介绍费。

    Args:
        contract: 一个 MaternityNurseContract 实例。
    """
    # 1. 创建或更新介绍费调整项
    # 复用上面的函数来处理介绍费
    upsert_introduction_fee_adjustment(contract)

    # 2. 创建定金调整项 (只在首次创建时执行)
    # 我们通过检查是否已存在来确保不重复创建
    existing_deposit = FinancialAdjustment.query.filter_by(
        contract_id=contract.id,
        adjustment_type=AdjustmentType.DEPOSIT
    ).first()

    if not existing_deposit and contract.deposit_amount and contract.deposit_amount >0:
        deposit_adjustment = FinancialAdjustment(
            contract_id=contract.id,
            adjustment_type=AdjustmentType.DEPOSIT,
            amount=contract.deposit_amount,
            description="定金",
            date=contract.start_date.date() if contract.start_date else db.func.current_date(),
            status='PENDING'
        )
        db.session.add(deposit_adjustment)