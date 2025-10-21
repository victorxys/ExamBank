# backend/services/contract_service.py
from flask import current_app
from backend.extensions import db
from backend.models import (
    BaseContract,
    MaternityNurseContract,
    FinancialAdjustment,
    AdjustmentType,
    SubstituteRecord,
    User,
    CustomerBill,
    EmployeePayroll,
)
from datetime import date
from decimal import Decimal

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

def cancel_substitute_bill_due_to_transfer(db_session, old_contract: BaseContract, new_contract: BaseContract, substitute_user: User, termination_date: date):
    """
    (V4 - 最终版) 作废旧合同中的替班账单，因为费用已被新合同覆盖。
    """
    substitute_records = db_session.query(SubstituteRecord).filter(
        SubstituteRecord.main_contract_id == old_contract.id,
        SubstituteRecord.substitute_user_id == substitute_user.id
    ).all()

    if not substitute_records:
        current_app.logger.info(f"未找到员工 {substitute_user.username} 在合同 {old_contract.id} 下的替班记录，跳过作废替班账单步骤。")
        return

    for record in substitute_records:
        if record.generated_bill_id:
            bill = db_session.get(CustomerBill, record.generated_bill_id)
            if bill and bill.total_due > 0:
                db_session.add(FinancialAdjustment(
                    customer_bill_id=bill.id, 
                    adjustment_type=AdjustmentType.CUSTOMER_DECREASE, 
                    amount=bill.total_due, 
                    description="[系统] 转签作废: 费用已由新合同覆盖", 
                    date=termination_date, 
                    status='BILLED', 
                    is_settled=True, 
                    settlement_date=termination_date,
                    details={'destination_contract_id': str(new_contract.id)}
                ))
                current_app.logger.info(f"已作废替班账单 {bill.id}，金额 {bill.total_due}")

        if record.generated_payroll_id:
            payroll = db_session.get(EmployeePayroll, record.generated_payroll_id)
            if payroll and payroll.total_due > 0:
                db_session.add(FinancialAdjustment(
                    employee_payroll_id=payroll.id, 
                    adjustment_type=AdjustmentType.EMPLOYEE_DECREASE, 
                    amount=payroll.total_due, 
                    description="[系统] 转签作废: 薪酬已由新合同覆盖", 
                    date=termination_date, 
                    status='BILLED', 
                    is_settled=True, 
                    settlement_date=termination_date,
                    details={'destination_contract_id': str(new_contract.id)}
                ))
                current_app.logger.info(f"已作废替班工资单 {payroll.id}，金额 {payroll.total_due}")

def apply_transfer_credits_to_new_contract(db_session, new_contract: BaseContract, credits: dict, old_contract_id: str, termination_date: date):
    """
    (V1 - 新增) 将结算出的信用额度（退款）应用为新合同的负向调整项。
    """
    first_bill_of_new_contract = db_session.query(CustomerBill).filter_by(
        contract_id=new_contract.id,
        is_substitute_bill=False
    ).order_by(CustomerBill.cycle_start_date.asc()).first()
    if not first_bill_of_new_contract:
        raise ValueError(f"新合同 {new_contract.id} 尚未生成账单，无法应用冲抵额度。")

    deposit_refund = credits.get('deposit_refund', Decimal('0'))
    management_fee_refund = credits.get('management_fee_refund', Decimal('0'))

    if deposit_refund > 0:
        db_session.add(FinancialAdjustment(
            customer_bill_id=first_bill_of_new_contract.id,
            adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
            amount=deposit_refund,
            description="[从前合同转入] 保证金冲抵",
            date=termination_date,
            status='PENDING',
            details={'source_contract_id': old_contract_id}
        ))
        current_app.logger.info(f"已将 {deposit_refund} 的保证金冲抵额度应用到新合同 {new_contract.id}")

    if management_fee_refund > 0:
        db_session.add(FinancialAdjustment(
            customer_bill_id=first_bill_of_new_contract.id,
            adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
            amount=management_fee_refund,
            description="[从前合同转入] 管理费冲抵",
            date=termination_date,
            status='PENDING',
            details={'source_contract_id': old_contract_id}
        ))
        current_app.logger.info(f"已将 {management_fee_refund} 的管理费冲抵额度应用到新合同 {new_contract.id}")