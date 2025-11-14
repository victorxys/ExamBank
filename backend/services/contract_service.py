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
    NannyTrialContract,
    TrialOutcome,
    FinancialActivityLog
)
from datetime import date,datetime,timedelta
from decimal import Decimal
import uuid
from backend.services.billing_engine import BillingEngine
from backend.services.bill_merge_service import BillMergeService
import calendar


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
        transfer_deposit = new_contract_data.get('transfer_deposit', True)
        current_app.logger.info(f"开始续约合同===及保证金转移检查 {old_contract_id}，transfer_deposit={transfer_deposit}")
        with db.session.begin_nested():
            old_contract = BaseContract.query.get(old_contract_id)
            if not old_contract:
                raise ValueError(f"原合同 {old_contract_id} 未找到。")

            # 1. 创建新合同
            start_date = datetime.fromisoformat(new_contract_data["start_date"])
            end_date = datetime.fromisoformat(new_contract_data["end_date"])
            new_employee_level = Decimal(new_contract_data.get("employee_level", old_contract.employee_level))
            
            final_management_fee_rate = Decimal(new_contract_data.get("management_fee_rate", old_contract.management_fee_rate or 0))
            final_management_fee_amount = Decimal(new_contract_data.get("management_fee_amount", old_contract.management_fee_amount or 0))

            if final_management_fee_rate > 0:
                final_management_fee_amount = (new_employee_level * final_management_fee_rate).quantize(Decimal('0.01'))
            # --- 核心修复：获取模板内容 ---
            template_content = None
            if old_contract.template_id:
                template = ContractTemplate.query.get(old_contract.template_id)
                if template:
                    template_content = template.content
            # --- 修复结束 ---
            new_contract_fields = {
                "customer_id": old_contract.customer_id,
                "service_personnel_id": old_contract.service_personnel_id,
                "start_date": start_date,
                "end_date": end_date,
                "employee_level": new_employee_level,
                "management_fee_amount": final_management_fee_amount,
                "management_fee_rate": final_management_fee_rate,
                "status": "active",
                "customer_name": old_contract.customer_name,
                "customer_name_pinyin": old_contract.customer_name_pinyin,
                "previous_contract_id": old_contract.id,
                "source": "renewal",
                "signing_status": SigningStatus.UNSIGNED,
                "customer_signing_token": str(uuid.uuid4()),
                "employee_signing_token": str(uuid.uuid4()),
                "notes": old_contract.notes,
                "security_deposit_paid": old_contract.security_deposit_paid,
                "template_id": old_contract.template_id,
                "service_content": old_contract.service_content,
                "service_type": old_contract.service_type,
                "template_content": template_content,
            }
            
            if isinstance(old_contract, NannyContract):
                # 确保 is_monthly_auto_renew 属性从旧合同继承
                new_contract_fields['is_monthly_auto_renew'] = old_contract.is_monthly_auto_renew
                # 如果 new_contract_data 中提供了该字段，则覆盖
                if 'is_monthly_auto_renew' in new_contract_data:
                    new_contract_fields['is_monthly_auto_renew'] = new_contract_data['is_monthly_auto_renew']
                new_contract_fields['security_deposit_paid'] = new_employee_level
            elif isinstance(old_contract, MaternityNurseContract):
                new_contract_fields['deposit_amount'] = new_contract_data.get('deposit_amount', old_contract.deposit_amount)
                new_contract_fields['discount_amount'] = new_contract_data.get('discount_amount', old_contract.discount_amount)

            NewContractModel = type(old_contract)
            renewed_contract = NewContractModel(**new_contract_fields)
            db.session.add(renewed_contract)
            db.session.flush()
            if not transfer_deposit:
                current_app.logger.info(f"不转移保证金续签更流程完成。旧合同 {old_contract.id} 的保证金将按标准终止流程处理。")
                return renewed_contract            

            # 2. 根据旧合同结束日期判断费用处理策略
            old_end_date = old_contract.end_date.date() if isinstance(old_contract.end_date, datetime) else old_contract.end_date
            _, last_day_of_month = calendar.monthrange(old_end_date.year, old_end_date.month)
            is_end_of_month = old_end_date.day == last_day_of_month

            if not is_end_of_month:
                # 场景1: 合同结束日不是月末，合并整个账单
                current_app.logger.info(f"合同 {old_contract.id} 结束日不是月末，执行账单合并逻辑。")
                last_bill = CustomerBill.query.filter_by(contract_id=old_contract.id ).order_by(CustomerBill.cycle_end_date.desc()).first()
                if last_bill:
                    self._delete_non_transferable_adjustments(old_contract, last_bill)
                    engine = BillingEngine()
                    engine.generate_all_bills_for_contract(renewed_contract.id, force_recalculate=True)
                    db.session.flush() # 确保新账单已写入会话

                    merge_service = BillMergeService()
                    merge_service.execute_merge(str(last_bill.id), str(renewed_contract.id), commit=False)
                    current_app.logger.info(f"已将账单 {last_bill.id} 的费用合并到新合同 {renewed_contract.id}。")
                else:
                    current_app.logger.warning(f"未找到合同 {old_contract.id} 的最后一个账单，无法执行合并。")
            else:
                # 场景2: 合同结束日是月末，只转移保证金
                current_app.logger.info(f"合同 {old_contract.id} 结束日是月末，仅转移保证金。")
                if old_contract.security_deposit_paid and old_contract.security_deposit_paid > 0:
                    # 步骤1: 在旧合同的最后一个账单上创建“转出”调整项
                    last_bill_old_contract = CustomerBill.query.filter_by(contract_id=old_contract.id ).order_by(CustomerBill.cycle_end_date.desc()).first()
                        
                    if last_bill_old_contract:
                        self._delete_non_transferable_adjustments(old_contract, last_bill_old_contract)
                        refund_adj = FinancialAdjustment(
                            customer_bill_id=last_bill_old_contract.id,
                            adjustment_type=AdjustmentType.CUSTOMER_INCREASE,
                            amount=old_contract.security_deposit_paid,
                            description="[保证金转出]至续约合同",
                            date=old_contract.end_date.date(),
                            details={'transferred_to_contract_id': str(renewed_contract.id)}
                        )
                        db.session.add(refund_adj)

                        engine = BillingEngine()
                        engine.calculate_for_month(
                            year=last_bill_old_contract.year,
                            month=last_bill_old_contract.month,
                            contract_id=last_bill_old_contract.contract_id,
                            force_recalculate=True,
                            cycle_start_date_override=last_bill_old_contract.cycle_start_date
                        )

                    # 步骤2: 在新合同上创建“转入”的待处理调整项
                    deposit_adj = FinancialAdjustment(
                        contract_id=renewed_contract.id,
                        adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
                        amount=old_contract.security_deposit_paid,
                        description="[从续约前合同转入] 保证金冲抵",
                        date=start_date.date(),
                        status='PENDING',
                        details={'transferred_from_contract_id': str(old_contract.id)}
                    )
                    db.session.add(deposit_adj)

            # 3. 更新旧合同状态
            old_contract.status = 'finished'
            db.session.add(old_contract)

        current_app.logger.info(f"成功续约合同 {old_contract_id}，创建新合同 {renewed_contract.id}。")
        return renewed_contract
    def _terminate_and_settle_contract(self, contract_id: str, termination_date: date, charge_on_termination_date: bool):
        """
        一个私有辅助方法，封装了终止合同和最终结算的核心逻辑。
        这段代码是从 billing_api.py 中迁移过来的。
        """
        contract = db.session.get(BaseContract, contract_id)
        if not contract:
            raise ValueError(f"合同 {contract_id} 未找到")

        contract.termination_date = termination_date
        
        if isinstance(contract, NannyTrialContract):
            contract.trial_outcome = TrialOutcome.FAILURE
            current_app.logger.info(f"试工合同 {contract.id} 终止，结果设置为“失败”。")
            contract_start_date = self._to_date(contract.start_date)
            if termination_date < contract_start_date:
                raise ValueError("终止日期不能早于合同开始日期")
            
            actual_trial_days = (termination_date - contract_start_date).days
            engine = BillingEngine()
            engine.process_trial_termination(contract, actual_trial_days)
            contract.status = "terminated"
            contract.end_date = termination_date
            # 对于试工合同，结算逻辑在 process_trial_termination 中完成，直接返回
            return {}

        # --- 非试工合同的终止逻辑 ---
        termination_year = termination_date.year
        termination_month = termination_date.month

        # 1. 清理未来账单
        bills_to_delete_query = CustomerBill.query.with_entities(CustomerBill.id).filter(
            CustomerBill.contract_id == str(contract.id),
            ((CustomerBill.year == termination_year) & (CustomerBill.month > termination_month)) |
            (CustomerBill.year > termination_year)
        )
        bill_ids_to_delete = [item[0] for item in bills_to_delete_query.all()]
        if bill_ids_to_delete:
            FinancialActivityLog.query.filter (FinancialActivityLog.customer_bill_id.in_(bill_ids_to_delete)).delete(synchronize_session=False)
            CustomerBill.query.filter(CustomerBill.id .in_(bill_ids_to_delete)).delete(synchronize_session=False)

        payrolls_to_delete_query = EmployeePayroll.query.with_entities(EmployeePayroll.id).filter (
            EmployeePayroll.contract_id == str(contract_id),
            ((EmployeePayroll.year == termination_year) & (EmployeePayroll.month > termination_month)) |
            (EmployeePayroll.year > termination_year)
        )
        payroll_ids_to_delete = [item[0] for item in payrolls_to_delete_query.all()]
        if payroll_ids_to_delete:
            FinancialActivityLog.query.filter (FinancialActivityLog.employee_payroll_id.in_(payroll_ids_to_delete)).delete(synchronize_session= False)
            EmployeePayroll.query.filter(EmployeePayroll.id .in_(payroll_ids_to_delete)).delete(synchronize_session=False)

        # 2. 更新合同状态
        contract.status = "terminated"
        if hasattr(contract, 'expected_offboarding_date'):
            contract.expected_offboarding_date = termination_date

        # 3. 重算最后一期账单
        engine = BillingEngine()
        engine.calculate_for_month(
            year=termination_year,
            month=termination_month,
            contract_id=str(contract.id),
            force_recalculate=True,
            end_date_override=termination_date
        )
        db.session.flush() # 确保更改被写入会话

        # 4. 创建最终薪资调整
        final_bill = CustomerBill.query.filter(CustomerBill.contract_id == str(contract.id )).order_by(CustomerBill.cycle_end_date.desc()).first()
        if final_bill:
            engine.create_final_salary_adjustments(final_bill.id)
        else:
            raise ValueError("无法找到用于处理最终调整项的账单。")

        # 5. 计算并返回最终结算信息 (例如退款)
        final_settlement = engine.calculate_termination_refunds(
            contract, termination_date, charge_on_termination_date
        )
        
        return final_settlement

    def change_contract(self, old_contract_id: str, change_data: dict) -> BaseContract:
        """
        变更合同：在一个原子事务中终止旧合同，并创建一个继承部分信息的新合同。
        V3: 严格按照“先终止源合同，再创建新合同，最后再转移账单”的逻辑顺序。
        """
        transfer_deposit = change_data.get('transfer_deposit', True)
        with db.session.begin_nested():
            old_contract = BaseContract.query.get(old_contract_id)
            if not old_contract:
                raise ValueError(f"原合同 {old_contract_id} 未找到。")
            if old_contract.status != 'active':
                raise ValueError(f"只有'生效中'的合同才能进行变更，当前状态: {old_contract.status}")

            # 1. 终止源合同 (这会重算最后一个账单，并计算出退款/应收款)
            termination_date = datetime.fromisoformat(change_data["start_date"]).date() - timedelta(days=1)
            current_app.logger.info(f"开始终止源合同 {old_contract.id}，终止日期: {termination_date}")
            final_settlement = self._terminate_and_settle_contract(
                contract_id=old_contract_id,
                termination_date=termination_date,
                charge_on_termination_date=False # 变更通常不收取终止日费用
            )
            current_app.logger.info(f"源合同 {old_contract.id} 已终止，结算结果: {final_settlement}")

            # 2. 创建新合同
            start_date = datetime.fromisoformat(change_data["start_date"])
            end_date = datetime.fromisoformat(change_data["end_date"])
            new_employee_level = Decimal(change_data.get("employee_level", old_contract.employee_level))
            
            final_management_fee_rate = Decimal(change_data.get("management_fee_rate", old_contract.management_fee_rate or 0))
            final_management_fee_amount = Decimal(change_data.get("management_fee_amount", old_contract.management_fee_amount or 0))

            if final_management_fee_rate > 0:
                final_management_fee_amount = (new_employee_level * final_management_fee_rate).quantize(Decimal('0.01'))

            new_service_personnel_id = change_data.get("service_personnel_id")

            # --- 核心修复：获取模板内容 ---
            template_content = None
            if old_contract.template_id:
                template = ContractTemplate.query.get(old_contract.template_id)
                if template:
                    template_content = template.content
            # --- 修复结束 ---

            new_contract_fields = {
                "customer_id": old_contract.customer_id,
                "service_personnel_id": new_service_personnel_id,
                "start_date": start_date,
                "end_date": end_date,
                "employee_level": new_employee_level,
                "management_fee_amount": final_management_fee_amount,
                "management_fee_rate": final_management_fee_rate,
                "status": "pending", # 新合同初始为待定状态，签署后激活
                "customer_name": old_contract.customer_name,
                "customer_name_pinyin": old_contract.customer_name_pinyin,
                "previous_contract_id": old_contract.id,
                "source": "change", # 来源标记为“变更”
                "signing_status": SigningStatus.UNSIGNED,
                "customer_signing_token": str(uuid.uuid4()),
                "employee_signing_token": str(uuid.uuid4()),
                "notes": old_contract.notes,
                "security_deposit_paid": new_employee_level, # 变更合同的保证金默认等于员工级别
                "template_id": old_contract.template_id,
                "service_content": old_contract.service_content,
                "service_type": old_contract.service_type,
                "template_content": template_content, 
            }

            NewContractModel = type(old_contract)
            changed_contract = NewContractModel(**new_contract_fields)
            db.session.add(changed_contract)
            db.session.flush() # 刷新以获取 changed_contract.id
            if not transfer_deposit:
                current_app.logger.info(f"不转移保证金，变更流程完成。旧合同 {old_contract.id} 的保证金将按标准终止流程处理。")
                return changed_contract

            # 3. 转移账单/费用
            personnel_changed = str(old_contract.service_personnel_id) != str (new_service_personnel_id)
            old_end_date = termination_date # 旧合同的实际结束日期就是新合同的开始日期
            _, last_day_of_month = calendar.monthrange(old_end_date.year, old_end_date.month)
            is_end_of_month = old_end_date.day == last_day_of_month

            # 获取旧合同的最后一个账单 (它已经被 _terminate_and_settle_contract 重算过了)
            last_bill_old_contract = CustomerBill.query.filter_by(contract_id=old_contract.id ).order_by(CustomerBill.cycle_end_date.desc()).first()
            if not last_bill_old_contract:
                current_app.logger.warning(f"源合同 {old_contract.id} 终止后未找到最后一个账单，无法转移费用。")
                # 即使没有账单，也继续创建新合同
                return changed_contract

            if not personnel_changed and not is_end_of_month:
                # 场景1: 服务人员未变 & 旧合同不是月末结束 -> 合并整个账单
                current_app.logger.info(f"变更合同 {old_contract.id} ，服务人员未变且非月末结束，执行账单合并逻辑。")
                
                # 步骤1: 删除源账单/工资单上不应转移的特殊调整项
                self._delete_non_transferable_adjustments(old_contract, last_bill_old_contract)

                # 步骤2: 为新合同生成第一个账单（确保目标账单存在）
                # 计算第一个账单周期的正确结束日期（当月最后一天）
                start_date = changed_contract.start_date
                _, last_day_of_month = calendar.monthrange(start_date.year, start_date.month)
                first_cycle_end_date = date(start_date.year, start_date.month, last_day_of_month)

                engine = BillingEngine()
                engine._get_or_create_bill_and_payroll(
                    changed_contract,
                    start_date.year,
                    start_date.month,
                    start_date,
                    first_cycle_end_date # 使用正确的周期结束日期
                )
                db.session.flush()

                # 步骤3: 执行合并
                merge_service = BillMergeService()
                merge_service.execute_merge(str(last_bill_old_contract.id), str (changed_contract.id), commit=False)
                current_app.logger.info(f"已将账单 {last_bill_old_contract.id} 的费用合并到变更后的新合同 {changed_contract.id}。")

            else:
                self._delete_non_transferable_adjustments(old_contract, last_bill_old_contract)
                # 场景2: 服务人员已变 OR 服务人员未变但旧合同月末结束 -> 仅转移保证金
                current_app.logger.info(f"变更合同 {old_contract.id}，执行仅转移保证金逻辑。")
                deposit_refund = final_settlement.get('deposit_refund', Decimal('0'))
                if deposit_refund > 0:
                    # 步骤1: 在旧合同的最后一个账单上创建“转出”调整项
                    refund_adj = FinancialAdjustment(
                        customer_bill_id=last_bill_old_contract.id,
                        adjustment_type=AdjustmentType.CUSTOMER_INCREASE,
                        amount=deposit_refund,
                        description="[保证金转出]至变更后合同",
                        date=termination_date,
                        details={'transferred_to_contract_id': str(changed_contract.id)}
                    )
                    db.session.add(refund_adj)

                    # 步骤2: 在新合同上创建“转入”的待处理调整项
                    # 确保新合同的第一个账单存在，以便附加调整项
                    changed_contract_start_date = changed_contract.start_date
                    _, changed_contract_last_day_of_month = calendar.monthrange(changed_contract_start_date.year, changed_contract_start_date.month)
                    changed_contract_first_cycle_end_date = date(changed_contract_start_date.year, changed_contract_start_date.month, changed_contract_last_day_of_month)        
                    engine = BillingEngine()
                    engine._get_or_create_bill_and_payroll(
                        changed_contract, 
                        changed_contract.start_date.year, 
                        changed_contract.start_date.month, 
                        changed_contract.start_date, 
                        changed_contract_first_cycle_end_date
                    )
                    db.session.flush()

                    deposit_adj = FinancialAdjustment(
                        contract_id=changed_contract.id,
                        adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
                        amount=deposit_refund,
                        description="[从变更前合同转入] 保证金冲抵",
                        date=termination_date,
                        status='PENDING',
                        details={'source_contract_id': str(old_contract.id)}
                    )
                    db.session.add(deposit_adj)
                    current_app.logger.info(f"已将 {deposit_refund} 的保证金从旧合同 {old_contract.id} 转移到新合同 {changed_contract.id}")

                # 确保旧合同的最后一个账单被重算，以反映保证金转出
                engine = BillingEngine()
                engine.calculate_for_month(
                    year=last_bill_old_contract.year,
                    month=last_bill_old_contract.month,
                    contract_id=last_bill_old_contract.contract_id,
                    force_recalculate=True,
                    cycle_start_date_override=last_bill_old_contract.cycle_start_date
                )
                db.session.flush() # 确保重算结果写入会话

            current_app.logger.info(f"成功从合同 {old_contract.id} 创建变更合同 {changed_contract.id}，并处理了费用转移。")
            return changed_contract
        
    def _delete_non_transferable_adjustments(self, old_contract: BaseContract, last_bill: CustomerBill):
        """
        在合并前，删除源账单/工资单上不应被转移的特殊调整项。
        V2: 修正了参数传递错误。
        """
        if not last_bill:
            current_app.logger.warning(f"合同 {old_contract.id} 没有找到最后一个账单，无法删除特殊调整项。")
            return

        # 查找与源账单关联的工资单
        source_payroll = EmployeePayroll.query.filter_by(
            contract_id=old_contract.id,  # <-- 核心修正：使用 old_contract.id
            cycle_start_date=last_bill.cycle_start_date
        ).first()

        # 1. 删除源工资单中的“保证金支付工资”
        if source_payroll:
            deleted_deposit_paid = FinancialAdjustment.query.filter(
                FinancialAdjustment.employee_payroll_id == source_payroll.id,
                FinancialAdjustment.adjustment_type == AdjustmentType.DEPOSIT_PAID_SALARY
            ).delete(synchronize_session=False)
            if deleted_deposit_paid > 0:
                current_app.logger.info(f"从源工资单 {source_payroll.id} 删除了 {deleted_deposit_paid} 个'保证金支付工资'调整项。")

        # 2. 删除源客户账单中的“公司代付工资”
        deleted_company_paid = FinancialAdjustment.query.filter(
            FinancialAdjustment.customer_bill_id == last_bill.id,
            FinancialAdjustment.adjustment_type == AdjustmentType.COMPANY_PAID_SALARY
        ).delete(synchronize_session=False)
        if deleted_company_paid > 0:
            current_app.logger.info(f"从源账单 {last_bill.id} 删除了 {deleted_company_paid} 个'公司代付工资'调整项。")
        
        if deleted_deposit_paid > 0 or deleted_company_paid > 0:
            db.session.flush()

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
    