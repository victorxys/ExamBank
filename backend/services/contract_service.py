# backend/services/contract_service.py
from flask import current_app
from backend.extensions import db
from backend.models import (
    BaseContract,
    NannyContract,
    MaternityNurseContract,
    FinancialAdjustment,
    AdjustmentType,
    SubstituteRecord,
    User,
    CustomerBill,
    EmployeePayroll,
    ContractTemplate,
    SigningStatus,
    EmployeeSalaryHistory,
    ServicePersonnel,
)
from datetime import date,datetime
from decimal import Decimal
import uuid

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
    (V2: 优先使用 previous_contract_id 链接进行精确查找)
    """
    current_app.logger.info(f"[SuccessorCheckInternal-V2] 开始为合同 {contract_id} 查找续约合同...")
    try:
        # 优先通过直接链接查找
        successor = BaseContract.query.filter_by(previous_contract_id=contract_id).first()

        if successor:
            current_app.logger.info(f"[SuccessorCheckInternal-V2] 通过 previous_contract_id 找到了精确的续约合同 {successor.id}")
            return successor

        # --- 如果直接链接找不到，回退到旧的、基于属性匹配的模糊查找逻辑 ---
        current_app.logger.warning(f"[SuccessorCheckInternal-V2] 未找到基于 previous_contract_id 的直接续约合同，将尝试旧的模糊匹配方法。")
        current_contract = BaseContract.query.get(contract_id)
        if not current_contract:
            current_app.logger.warning(f"[SuccessorCheckInternal-V2] 合同 {contract_id} 未找到")
            return None

        effective_end_date = current_contract.termination_date or current_contract.end_date
        if not effective_end_date:
            current_app.logger.info(f"[SuccessorCheckInternal-V2] 合同 {contract_id} 没有有效的结束日期，无法进行模糊查找。")
            return None

        fallback_successor = BaseContract.query.filter(
            BaseContract.customer_name == current_contract.customer_name,
            BaseContract.type == current_contract.type,
            BaseContract.service_personnel_id == current_contract.service_personnel_id,
            BaseContract.id != current_contract.id,
            BaseContract.start_date >= effective_end_date,
            BaseContract.status != 'terminated'
        ).order_by(BaseContract.start_date.asc()).first()

        if fallback_successor:
            current_app.logger.info(f"[SuccessorCheckInternal-V2] 通过模糊匹配找到了可能的续约合同 {fallback_successor.id}")
            return fallback_successor
        else:
            current_app.logger.info(f"[SuccessorCheckInternal-V2] 所有方法均未找到 {contract_id} 的续约合同。")
            return None

    except Exception as e:
        current_app.logger.error(f"查找续约合同失败 {contract_id}: {e}", exc_info=True)
        return None

def update_salary_history_on_contract_activation(contract: BaseContract):
    """
    当合同激活时，为服务人员创建或更新薪资历史记录。
    (V2: 处理同一天激活多个合同的情况)
    """
    if not contract.service_personnel_id or not contract.employee_level or Decimal(contract.employee_level) <= 0:
        current_app.logger.info(f"合同 {contract.id} 没有关联服务人员或有效薪资，跳过薪资历史记录更新。")
        return

    if contract.type in ['nanny_trial', 'external_substitution']:
        current_app.logger.info(f"合同 {contract.id} 是 {contract.type} 类型，跳过薪酬历史记录创建。")
        return

    # 确保我们只使用日期部分进行比较
    effective_date = contract.start_date.date() if isinstance(contract.start_date, datetime) else contract.start_date

    # --- 核心修复：基于 (employee_id, effective_date) 查找记录 ---
    existing_record_for_date = EmployeeSalaryHistory.query.filter_by(
        employee_id=contract.service_personnel_id,
        effective_date=effective_date
    ).first()

    if existing_record_for_date:
        # 如果当天已存在记录，则更新它
        current_app.logger.warning(
            f"员工 {contract.service_personnel_id} 在 {effective_date} 已有薪资记录。"
            f"将使用后激活的合同 {contract.id} 的信息进行更新。"
        )
        existing_record_for_date.base_salary = contract.employee_level
        existing_record_for_date.contract_id = contract.id # 将记录关联到最新的合同
        existing_record_for_date.notes = (
            f"更新：由合同 {contract.type} ({contract.id}) 激活/更新"
        )
        db.session.add(existing_record_for_date)
    else:
        # 如果当天不存在记录，则创建新记录
        new_salary_record = EmployeeSalaryHistory(
            employee_id=contract.service_personnel_id,
            contract_id=contract.id,
            base_salary=contract.employee_level,
            effective_date=effective_date,
            notes=f"由合同 {contract.type} ({contract.id}) 激活"
        )
        db.session.add(new_salary_record)
        current_app.logger.info(
            f"为员工 {contract.service_personnel_id} 创建了新的薪资历史记录，"
            f"生效日期: {effective_date}, 新薪资为 {contract.employee_level}。"
        )

class ContractService:
    def __init__(self):
        pass

    # Placeholder for future methods
    def create_contract_from_template(self, template_id: str, contract_data: dict) -> BaseContract:
        template = ContractTemplate.query.get(template_id)
        if not template:
            raise ValueError(f"合同模板 {template_id} 未找到。")

        # Extract common fields from contract_data (assuming they match BaseContract fields)
        # Note: 'id', 'created_at', 'updated_at' will be generated automatically
        common_contract_fields = {
            "customer_id": contract_data.get("customer_id"),
            "service_personnel_id": contract_data.get("service_personnel_id"),
            "user_id": contract_data.get("user_id"), # 操作人ID
            "contract_type": contract_data.get("contract_type"), # Should probably come from template as well
            "start_date": contract_data.get("start_date"),
            "end_date": contract_data.get("end_date"),
            "total_amount": contract_data.get("total_amount"),
            "status": contract_data.get("status", "pending"), # Default status
            "customer_name": contract_data.get("customer_name"),
            "service_personnel_name": contract_data.get("service_personnel_name"),
            "type": "formal", # This contract is a formal contract
        }

        # Extract BaseContract specific fields
        formal_contract_fields = {
            "template_id": template.id,
            "service_content": contract_data.get("service_content"),
            "service_type": contract_data.get("service_type"),
            "is_auto_renew": contract_data.get("is_auto_renew", False),
            "attachment_content": contract_data.get("attachment_content"),
             # signing_status, customer_signature, employee_signature are handled by defaults or later
        }

        # Merge all fields, prioritizing contract_data for general fields
        all_fields = {**common_contract_fields, **formal_contract_fields}

        new_contract = BaseContract(**all_fields)
        db.session.add(new_contract)
        # db.session.flush() # Flush to get ID if needed for immediate use, but not strictly necessary here

        current_app.logger.info(f"成功从模板 {template_id} 创建正式合同 {new_contract.id}。")
        return new_contract

    def renew_contract(self, old_contract_id: str, new_contract_data: dict) -> BaseContract:
        with db.session.begin_nested():
            old_contract = BaseContract.query.get(old_contract_id)
            if not old_contract:
                raise ValueError(f"原合同 {old_contract_id} 未找到。")

            # 1. 创建新合同
            start_date = datetime.fromisoformat(new_contract_data["start_date"])
            end_date = datetime.fromisoformat(new_contract_data["end_date"])
            new_employee_level = Decimal(new_contract_data.get("employee_level", old_contract.employee_level))
            
            # Determine management_fee_rate: prioritize frontend input, then old contract
            final_management_fee_rate = Decimal(new_contract_data.get("management_fee_rate", old_contract.management_fee_rate or 0))
            
            # Determine management_fee_amount: prioritize frontend input, then calculate based on rate, then old contract
            final_management_fee_amount = Decimal(new_contract_data.get("management_fee_amount", old_contract.management_fee_amount or 0))

            if final_management_fee_rate > 0:
                final_management_fee_amount = (new_employee_level * final_management_fee_rate).quantize(Decimal('0.01'))

            new_contract_fields = {
                "customer_id": old_contract.customer_id,
                "service_personnel_id": old_contract.service_personnel_id,
                "start_date": start_date,
                "end_date": end_date,
                "employee_level": new_employee_level,
                "management_fee_amount": final_management_fee_amount,
                "management_fee_rate": final_management_fee_rate,
                "status": "pending",
                "customer_name": old_contract.customer_name,
                "customer_name_pinyin": old_contract.customer_name_pinyin,
                "previous_contract_id": old_contract.id,
                "source": "renewal",
                "signing_status": SigningStatus.UNSIGNED,
                "customer_signing_token": str(uuid.uuid4()),
                "employee_signing_token": str(uuid.uuid4()),
                "notes": old_contract.notes,
                "security_deposit_paid": old_contract.security_deposit_paid,
            }
            
            # Copy subclass-specific attributes
            if isinstance(old_contract, NannyContract):
                new_contract_fields['is_monthly_auto_renew'] = new_contract_data.get('is_monthly_auto_renew', old_contract.is_monthly_auto_renew)
                # 育儿嫂合同的保证金默认等于员工级别
                new_contract_fields['security_deposit_paid'] = new_employee_level
            elif isinstance(old_contract, MaternityNurseContract):
                new_contract_fields['deposit_amount'] = new_contract_data.get('deposit_amount', old_contract.deposit_amount)
                new_contract_fields['discount_amount'] = new_contract_data.get('discount_amount', old_contract.discount_amount)

            NewContractModel = type(old_contract)
            renewed_contract = NewContractModel(**new_contract_fields)
            db.session.add(renewed_contract)
            db.session.flush()

            # 2. 转移保证金
            if old_contract.security_deposit_paid and old_contract.security_deposit_paid > 0:
                # 在旧合同的最后一个账单上创建退款调整
                last_bill_old_contract = CustomerBill.query.filter_by(contract_id=old_contract.id).order_by(CustomerBill.cycle_end_date.desc()).first()
                if last_bill_old_contract:
                    refund_adj = FinancialAdjustment(
                        customer_bill_id=last_bill_old_contract.id,
                        adjustment_type=AdjustmentType.CUSTOMER_INCREASE,
                        amount=old_contract.security_deposit_paid,
                        description="保证金转出至续约合同",
                        date=old_contract.end_date.date(),
                        details={'transferred_to_contract_id': str(renewed_contract.id)}
                    )
                    db.session.add(refund_adj)

                # 在新合同的第一个账单上创建收款调整
                # (V2 修正) 创建一个 PENDING 状态的调整，由账单引擎自动应用到第一期账单
                deposit_adj = FinancialAdjustment(
                    contract_id=renewed_contract.id,
                    adjustment_type=AdjustmentType.CUSTOMER_DECREASE, # 应为客户减款，冲抵账单
                    amount=old_contract.security_deposit_paid,
                    description="保证金从原合同转入",
                    date=start_date.date(),
                    status='PENDING', # 必须是 PENDING 才能被账单引擎捕获
                    details={'transferred_from_contract_id': str(old_contract.id)}
                )
                db.session.add(deposit_adj)

            # 3. 更新旧合同状态
            old_contract.status = 'finished'
            db.session.add(old_contract)

        current_app.logger.info(f"成功续约合同 {old_contract_id}，创建新合同 {renewed_contract.id}。")
        return renewed_contract

    def transfer_management_fees(self, old_contract_id: str, new_contract_id: str, amount: Decimal):
        pass


    def update_employee_salary_history(self, employee_id: str, contract_id: str, salary_data: dict):
        employee = ServicePersonnel.query.get(employee_id)
        if not employee:
            raise ValueError(f"员工 {employee_id} 未找到。")

        contract = BaseContract.query.get(contract_id)
        if not contract:
            raise ValueError(f"合同 {contract_id} 未找到。")

        # --- FIX STARTS HERE ---
        # 验证合同的服务人员是否与传入的员工ID匹配
        if not contract.service_personnel_id or str(contract.service_personnel_id) != employee_id:
            raise ValueError(
                f"合同 {contract.id} (客户: {contract.customer_name}) 的服务人员 "
                f"({contract.service_personnel_id}) 与目标员工 ({employee_id}) 不匹配，无法创建薪酬历史。"
            )
        # --- FIX ENDS HERE ---

        if contract.type == 'nanny_trial':
            current_app.logger.info(f"合同 {contract.id} 是试工合同(nanny_trial)，跳过薪酬历史记录创建。")
            return None

        effective_date = salary_data.get("effective_date", contract.start_date.date())
        new_salary = salary_data.get("base_salary")

        if not new_salary:
            raise ValueError("新薪资(base_salary)未提供。")

        # 检查此生效日期是否已存在记录
        existing_record_for_date = EmployeeSalaryHistory.query.filter_by(
            employee_id=employee.id,
            effective_date=effective_date
        ).first()

        if existing_record_for_date:
            current_app.logger.info(f"员工 {employee_id} 在日期 {effective_date} 已存在薪酬记录，跳过创建。")
            return existing_record_for_date

        # --- 核心优化：查找旧工资并生成详细备注 ---
        previous_salary_record = EmployeeSalaryHistory.query.filter(
            EmployeeSalaryHistory.employee_id == employee.id,
            EmployeeSalaryHistory.effective_date < effective_date
        ).order_by(EmployeeSalaryHistory.effective_date.desc()).first()

        old_salary = previous_salary_record.base_salary if previous_salary_record else Decimal( '0')

        notes = f"客户 {contract.customer_name} 合同于 {effective_date.strftime('%Y-%m-%d')} "
        if old_salary == Decimal('0'):
            notes += f"初始建档薪资为 {new_salary}。"
        elif new_salary > old_salary:
            notes += f"涨薪，从 {old_salary} 调整为 {new_salary}。"
        elif new_salary < old_salary:
            notes += f"降薪，从 {old_salary} 调整为 {new_salary}。"
        else:
            notes += f"薪资平调，仍为 {new_salary}。"
        # --- 优化结束 ---

        # 创建新的薪资历史记录
        new_salary_record = EmployeeSalaryHistory(
            employee_id=employee.id,
            contract_id=contract.id,
            base_salary=new_salary,
            effective_date=effective_date,
            notes=notes,
        )
        db.session.add(new_salary_record)

        current_app.logger.info(f"成功为员工 {employee_id} 在合同 {contract.id} 下创建薪酬历史记录。")
        return new_salary_record
    
    def sign_contract(self, contract_id: str, signer_type: str, signature_data: str) -> BaseContract:
        contract = BaseContract.query.get(contract_id)
        if not contract:
            raise ValueError(f"合同 {contract_id} 未找到。")

        if signer_type == "customer":
            contract.customer_signature = signature_data
            contract.signing_status = SigningStatus.CUSTOMER_SIGNED
            current_app.logger.info(f"合同 {contract_id} 客户已签署。")
        elif signer_type == "employee":
            contract.employee_signature = signature_data
            contract.signing_status = SigningStatus.EMPLOYEE_SIGNED
            current_app.logger.info(f"合同 {contract_id} 员工已签署。")
        else:
            raise ValueError(f"无效的签署者类型: {signer_type}。")

        # If both have signed, mark as fully signed
        if contract.customer_signature and contract.employee_signature:
            contract.signing_status = SigningStatus.FULLY_SIGNED
            current_app.logger.info(f"合同 {contract_id} 已完全签署。")

        # Generate separate signing tokens if they don't exist
        if not contract.customer_signing_token:
            contract.customer_signing_token = str(uuid.uuid4())
            current_app.logger.info(f"为合同 {contract_id} 生成了新的客户签署令牌。")

        if not contract.employee_signing_token:
            contract.employee_signing_token = str(uuid.uuid4())
            current_app.logger.info(f"为合同 {contract_id} 生成了新的员工签署令牌。")

        db.session.add(contract)
        return contract