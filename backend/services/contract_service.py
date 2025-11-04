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

def _find_predecessor_contract_internal(contract_id: str) -> BaseContract | None:
    """
    内部函数：查找并返回给定合同的前序合同对象。
    """
    current_app.logger.info(f"[PredecessorCheckInternal] 开始为合同 {contract_id} 查找前序合同...")
    try:
        current_contract = BaseContract.query.get(contract_id)
        if not current_contract:
            current_app.logger.warning(f"[PredecessorCheckInternal] 合同 {contract_id} 未找到")
            return None

        start_date = current_contract.start_date
        if not start_date:
            current_app.logger.info(f"[PredecessorCheckInternal] 合同 {contract_id} 没有有效的开始日期，无法查找前序合同。")
            return None

        # 查找同一客户下，在当前合同开始前已经结束的合同
        predecessor = BaseContract.query.filter(
            BaseContract.customer_name == current_contract.customer_name,
            BaseContract.id != current_contract.id,
            BaseContract.end_date <= start_date,
            # BaseContract.status.in_(['terminated', 'finished'])
        ).order_by(BaseContract.end_date.desc()).first()

        if predecessor:
            current_app.logger.info(f"[PredecessorCheckInternal] 找到了前序合同 {predecessor.id} ，结束日期: {predecessor.end_date}")
            return predecessor
        else:
            current_app.logger.info(f"[PredecessorCheckInternal] 未找到 {contract_id} 的前序合同。")
            return None

    except Exception as e:
        current_app.logger.error(f"查找前序合同失败 {contract_id}: {e}", exc_info=True)
        return None

def _find_successor_contract_internal(contract_id: str) -> BaseContract | None:
    """
    内部函数：查找并返回给定合同的续约合同对象。
    此函数不处理HTTP响应，只返回 SQLAlchemy 对象或 None。
    """
    current_app.logger.info(f"[SuccessorCheckInternal] 开始为合同 {contract_id} 查找续约合同...")
    try:
        current_contract = BaseContract.query.get(contract_id)
        if not current_contract:
            current_app.logger.warning(f"[SuccessorCheckInternal] 合同 {contract_id} 未找到")
            return None

        # 确定合同的实际结束日期，优先使用终止日期
        effective_end_date = current_contract.termination_date or current_contract.end_date
        current_app.logger.info(f"[SuccessorCheckInternal] 合同 {contract_id} 的类型为 {current_contract.type}, 状态为 {current_contract.status}")
        current_app.logger.info(f"[SuccessorCheckInternal] 原始 end_date: {current_contract.end_date}, 原始 termination_date: {current_contract.termination_date}")
        current_app.logger.info(f"[SuccessorCheckInternal] 计算出的实际结束日期 (effective_end_date): {effective_end_date}")

        if not effective_end_date:
            current_app.logger.info(f"[SuccessorCheckInternal] 合同 {contract_id} 没有有效的结束日期，无法查找续约合同。")
            return None

        # 查找续约合同
        successor = BaseContract.query.filter(
            BaseContract.customer_name == current_contract.customer_name,
            BaseContract.type == current_contract.type,
            BaseContract.service_personnel_id == current_contract.service_personnel_id,
            BaseContract.user_id == current_contract.user_id,
            BaseContract.id != current_contract.id,
            BaseContract.start_date >= effective_end_date, # 新合同在当前合同实际结束后开始
            BaseContract.status != 'terminated'  # <-- 新增的过滤条件
        ).order_by(BaseContract.start_date.asc()).first()

        if successor:
            current_app.logger.info(f"[SuccessorCheckInternal] 找到了续约合同 {successor.id} ，开始日期: {successor.start_date}")
            return successor
        else:
            current_app.logger.info(f"[SuccessorCheckInternal] 未找到 {contract_id} 的续约合同。" )
            return None

    except Exception as e:
        current_app.logger.error(f"查找续约合同失败 {contract_id}: {e}", exc_info=True)
        return None