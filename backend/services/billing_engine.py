# backend/services/billing_engine.py

from flask import current_app
from datetime import date, timedelta, datetime

import decimal
import calendar
from dateutil.relativedelta import relativedelta

from backend.extensions import db
from backend.models import (
    User,
    BaseContract,
    NannyContract,
    MaternityNurseContract,
    NannyTrialContract,
    AttendanceRecord,
    CustomerBill,
    EmployeePayroll,
    FinancialAdjustment,
    AdjustmentType,
    SubstituteRecord,
    InvoiceRecord,
    PaymentRecord,
    PaymentStatus,
    PayoutStatus,
    TrialOutcome,
    PayoutRecord,
)

from sqlalchemy import func, or_
from sqlalchemy.orm import attributes
from sqlalchemy.exc import IntegrityError

D = decimal.Decimal
CTX = decimal.Context(prec=10)



def _update_bill_payment_status(bill: CustomerBill):
    """
    根据一个账单的所有支付记录，更新其 total_paid 和 payment_status.
    """
    if not bill:
        return

    # 计算已支付总额
    total_paid = db.session.query(func.sum(PaymentRecord.amount)).filter(
        PaymentRecord.customer_bill_id == bill.id
    ).scalar() or D(0)

    bill.total_paid = total_paid.quantize(D("0.01"))

    # 更新支付状态
    if bill.total_paid <= 0:
        bill.payment_status = PaymentStatus.UNPAID
    elif bill.total_paid < bill.total_due:
        bill.payment_status = PaymentStatus.PARTIALLY_PAID
    elif bill.total_paid == bill.total_due:
        bill.payment_status = PaymentStatus.PAID
    else: # total_paid > bill.total_due
        bill.payment_status = PaymentStatus.OVERPAID

    db.session.add(bill)
    current_app.logger.info(f"Updated bill {bill.id} status to {bill.payment_status.value} with total_paid {bill.total_paid}")

def _update_payroll_payout_status(payroll: EmployeePayroll):
    """
    根据一个薪酬单的所有支付记录，更新其 total_paid_out 和 payout_status.
    """
    if not payroll:
        return

    total_paid_out = db.session.query(func.sum(PayoutRecord.amount)).filter(
        PayoutRecord.employee_payroll_id == payroll.id
    ).scalar() or D(0)

    payroll.total_paid_out = total_paid_out.quantize(D("0.01"))

    if payroll.total_paid_out <= 0:
        payroll.payout_status = PayoutStatus.UNPAID
    elif payroll.total_paid_out < payroll.total_due:
        payroll.payout_status = PayoutStatus.PARTIALLY_PAID
    else: # total_paid_out >= payroll.total_due
        payroll.payout_status = PayoutStatus.PAID

    db.session.add(payroll)
    current_app.logger.info(f"Updated payroll {payroll.id} status to {payroll.payout_status.value} with total_paid_out {payroll.total_paid_out}")

class BillingEngine:
    def _to_date(self, dt_obj):
        """健壮的辅助函数，将 datetime 或 date 对象统一转换为纯 date 对象。"""
        # 因为我们已从 datetime 导入了 datetime 类，所以这里的 `datetime` 是正确的类型
        if isinstance(dt_obj, datetime):
            return dt_obj.date()
        # 这里的 `date` 也是正确的类型
        if isinstance(dt_obj, date):
            return dt_obj
        return None
    def get_or_create_bill_for_nanny_contract(self, contract_id, year, month, end_date_override=None):
        """
        获取或创建指定育儿嫂合同在特定年月的账单。
        这是实现自动续约功能的核心函数，可被多处复用。
        如果账单已存在，则直接返回。

        Args:
            contract_id (int): 育儿嫂合同的ID。
            year (int): 目标账单的年份。
            month (int): 目标账单的月份。

        Returns:
            (CustomerBill, bool): 返回账单对象和是否为新创建的布尔值元组。
        """
        contract = db.session.get(NannyContract, contract_id)
        if not contract:
            current_app.logger.warning(
                f"[AutoRenew] 合同ID {contract_id} 不是一个有效的育儿嫂合同。"
            )
            return None, False
        db.session.refresh(contract)
        # 1. 计算周期
        cycle_start, cycle_end = self._get_nanny_cycle_for_month(contract, year, month, end_date_override)
        if not cycle_start:
            return None, False

        # 2. 检查账单是否已存在
        bill = CustomerBill.query.filter_by(
            contract_id=contract.id,
            cycle_start_date=cycle_start,
            is_substitute_bill=False,
        ).first()

        # 3. 如果已存在且已计算，直接返回
        if (
            bill
            and bill.calculation_details
            and "calculation_log" in bill.calculation_details
        ):
            current_app.logger.info(
                f"[AutoRenew] 合同 {contract.id} 在 {year}-{month} 的账单已存在且已计算，直接返回。"
            )
            return bill, False

        # 4. 否则，调用核心计算函数（它会处理创建和计算）
        current_app.logger.info(
            f"[AutoRenew] 为合同 {contract.id} 获取或创建 {year}-{month} 的账单。"
        )
        self._calculate_nanny_bill_for_month(
            contract, year, month, force_recalculate=True, end_date_override=end_date_override
        )

        # 5. 再次查询以获取创建/更新的账单
        final_bill = CustomerBill.query.filter_by(
            contract_id=contract.id,
            cycle_start_date=cycle_start,
            is_substitute_bill=False,
        ).first()

        was_newly_created = not bool(bill)  # 如果之前 bill is None，说明是新创建的
        return final_bill, was_newly_created

    def extend_auto_renew_bills(self, contract_id):
        """
        检查并为自动续约合同创建未来的账单，直到最后一个账单月距离当前月11个月。
        """
        contract = db.session.get(NannyContract, contract_id)
        if not contract or not contract.is_monthly_auto_renew:
            current_app.logger.info(
                f"[AutoRenewExtend] 合同 {contract_id} 不是有效的自动续约育儿嫂合同，跳过。"
            )
            return

        current_app.logger.info(
            f"[AutoRenewExtend] 开始为合同 {contract.id} 检查并续签账单。"
        )

        # 计算目标月份
        today = date.today()
        # 目标是创建到11个月后的那个月份的账单
        target_date = today + relativedelta(months=+11)

        # 循环检查和创建
        while True:
            # 在循环内部找到最后一个账单，因为每次创建后最后一个账单都会变
            last_bill = (
                CustomerBill.query.filter_by(
                    contract_id=contract.id, is_substitute_bill=False
                )
                .order_by(CustomerBill.year.desc(), CustomerBill.month.desc())
                .first()
            )

            if not last_bill:
                current_app.logger.warning(
                    f"[AutoRenewExtend] 合同 {contract.id} 没有任何账单，无法确定续签起点。"
                )
                return

            last_bill_date = date(last_bill.year, last_bill.month, 1)

            # 如果最后一个账单的月份已经达到或超过目标，则停止
            if last_bill_date.year > target_date.year or (
                last_bill_date.year == target_date.year
                and last_bill_date.month >= target_date.month
            ):
                current_app.logger.info(
                    f"[AutoRenewExtend] 合同 {contract.id} 的最后一个账单 ({last_bill.year}-{last_bill.month}) 已满足续签条件。"
                )
                break

            # 计算下一个要创建的账单的月份
            next_bill_date = last_bill_date + relativedelta(months=+1)
            year_to_create = next_bill_date.year
            month_to_create = next_bill_date.month

            # 在创建新账单之前，必须先延长合同的 end_date，否则 _get_nanny_cycle_for_month 会失败
            next_month_last_day = (
                next_bill_date + relativedelta(months=1) - relativedelta(days=1)
            )
           

            current_app.logger.info(
                f"[AutoRenewExtend]   -> 正在为合同 {contract.id} 创建 {year_to_create}-{month_to_create} 的账单..."
            )

            # 复用现有逻辑来创建账单
            new_bill, was_created = self.get_or_create_bill_for_nanny_contract(
                contract.id, year_to_create, month_to_create, end_date_override=next_month_last_day
            )

            if not was_created and not new_bill:
                current_app.logger.error(
                    f"[AutoRenewExtend] 无法为合同 {contract.id} 创建 {year_to_create}-{month_to_create} 的账单，续签中止。"
                )
                break

           
        # 循环结束后，统一由调用方提交所有更改
        current_app.logger.info(
            f"[AutoRenewExtend] 合同 {contract.id} 的账单续签检查完成。"
        )

    def _attach_pending_adjustments(self, contract, bill):
        """
        查找并关联所有待处理的财务调整项到当前账单。
        如果发现已支付的定金，则自动为其创建收款记录。
        """
        if not contract or not bill:
            return

        pending_adjustments = FinancialAdjustment.query.filter(
            FinancialAdjustment.contract_id == contract.id,
            FinancialAdjustment.status.in_(['PENDING', 'PAID'])
        ).all()

        if not pending_adjustments:
            return

        current_app.logger.info(f"为账单 {bill.id} 找到了 {len(pending_adjustments)} 个待处理的财务调整项。")

        for adj in pending_adjustments:
            adj.customer_bill_id = bill.id
            adj.status = 'BILLED'

            if adj.adjustment_type == AdjustmentType.DEPOSIT and adj.paid_amount and adj.paid_amount > 0:
                existing_record = PaymentRecord.query.filter_by(
                    customer_bill_id=bill.id,
                    notes=f"[系统] 定金转入 (Ref: {adj.id})" # 旧的备注格式，用于查找
                ).first()

                # --- 核心修改：按新格式生成收款记录 ---
                if not existing_record:
                    if not adj.paid_by_user_id:
                        raise ValueError(f"定金调整项 {adj.id} 已支付但缺少操作员ID (paid_by_user_id)。")

                    # 根据ID查找操作员姓名
                    operator = db.session.get(User, adj.paid_by_user_id)
                    operator_name = operator.username if operator else"未知用户"

                    # 获取操作日期
                    operation_date_str = adj.paid_at.strftime('%Y-%m-%d') if adj.paid_at else ""

                    deposit_payment = PaymentRecord(
                        customer_bill_id=bill.id,
                        amount=adj.paid_amount,
                        payment_date=adj.paid_at or bill.cycle_start_date.date(),
                        method='定金',  # <-- 修改收款方式
                        notes=f"{operator_name} 确认定金转入，转入日期:{operation_date_str}",# <-- 修改备注格式
                        created_by_user_id=adj.paid_by_user_id
                    )
                    db.session.add(deposit_payment)
                    current_app.logger.info(f"为定金调整项 {adj.id} 自动创建了格式化的收款记录。")
                # --- 修改结束 ---

            db.session.add(adj)

        db.session.flush()
        # _update_bill_payment_status(bill) # <-- 直接调用模块内的函数，不加 self

    def calculate_for_month(
        self, year: int, month: int, contract_id=None, force_recalculate=False, actual_work_days_override=None, cycle_start_date_override=None , end_date_override = None
    ):
                # <--- 在这里增加下面这行 --->
        current_app.logger.debug(f"[DEBUG-ENGINE] calculate_for_month called with: year={year}, month={month}, contract_id={contract_id}, force_recalculate={force_recalculate}, actual_work_days_override={actual_work_days_override}, end_date_override={end_date_override}")
        current_app.logger.info(
            f"开始计算contract:{contract_id}  {year}-{month} 的账单 force_recalculate:{force_recalculate}"
        )
        if contract_id:
            # --- 核心修复：在处理单个合同时，添加行级锁来防止并发 ---
            # with_for_update() 会生成 "SELECT ... FOR UPDATE" SQL语句，
            # 这会锁定该合同记录，直到当前数据库事务结束（commit或rollback）。
            contract = db.session.query(BaseContract).filter_by(id=contract_id).with_for_update().first()
            if not contract:
                current_app.logger.warning(f"Contract {contract_id} not found, skipping calculation.")
                contracts_to_process = []
            else:
                contracts_to_process = [contract]
            # --- 修复结束 ---
        else:
            contracts_to_process = BaseContract.query.filter(BaseContract.status.in_(["active", "terminated"])).all()

        for contract in contracts_to_process:
            if not contract:
                continue

            if contract.type == "maternity_nurse":
                self._calculate_maternity_nurse_bill_for_month(
                    contract, year, month, force_recalculate, cycle_start_date_override
                )
            elif contract.type == "nanny":
                self._calculate_nanny_bill_for_month(
                    contract, year, month, force_recalculate, actual_work_days_override , end_date_override=end_date_override
                )
            elif contract.type == "nanny_trial":
                self._calculate_nanny_trial_bill(
                    contract, year, month, force_recalculate
                )
            # 【新增分支】
            elif contract.type == "external_substitution":
                # --- 核心修复：建立权威结束日期的统一规则 ---
                # 1. 规则：优先使用 expected_offboarding_date，其次才是 end_date
                authoritative_end_date = getattr(contract, 'expected_offboarding_date', None) or contract.end_date

                # 2. 本次计算的最终结束日期，应该优先使用API传来的覆盖日期，其次才是我们上面认定的权威日期
                final_end_date = end_date_override or authoritative_end_date

                # 3. 使用这个绝对正确的日期去获取或创建账单
                bill, payroll = self._get_or_create_bill_and_payroll(
                    contract, contract.start_date.year, contract.start_date.month, contract.start_date, final_end_date
                )

                # 4. 后续计算会从 bill 对象读取正确的周期，一切都会恢复正常
                details = self._calculate_external_substitution_details(contract, bill, payroll)
                bill, payroll = self._calculate_final_amounts(bill, payroll, details)
                log = self._create_calculation_log(details)
                self._update_bill_with_log(bill, payroll, details, log)

    def generate_all_bills_for_contract(self, contract_id, force_recalculate=True):
        """
        Generates or recalculates all bills for the entire lifecycle of a single contract.
        """
        # 【调试代码 2】
        # current_app.logger.info(f"[ENGINE-DEBUG] Engine received contract ID: {contract_id}, Type: {type(contract_id)}")
        # 关键修复 1: 使用 query().filter_by() 代替 get()，以在事务中可靠地找到对象
        contract = db.session.query(BaseContract).filter_by(id=contract_id).first()
        if not contract:
            current_app.logger.error(f"[FullLifecycle] Contract {contract_id} not found.")
            return

        # 强制刷新对象状态，确保关联数据（如子类字段）是最新的
        db.session.refresh(contract)

        current_app.logger.info(
            f"[FullLifecycle] Starting bill generation for contract {contract.id} ({contract.type})."
        )

        # --- Gemini-generated code: Start (v4 - Final) ---
        # 核心修改：简化育儿嫂试工合同的初始账单逻辑
        if isinstance(contract, NannyTrialContract):
            current_app.logger.info(f"[FullLifecycle] 合同 {contract.id} 是试工合同，跳过初始账单生成。")
            return
        # --- Gemini-generated code: End (v4 - Final) ---

        # --- 【关键修复】统一处理日期和时间对象 ---
        start_date_obj = contract.actual_onboarding_date if contract.type =="maternity_nurse" else contract.start_date
        end_date_obj = (contract.expected_offboarding_date or contract.end_date) if contract.type == "maternity_nurse" else contract.end_date

        if not start_date_obj or not end_date_obj:
            current_app.logger.warning(f"[FullLifecycle] Contract {contract.id} is missing start or end dates. Skipping.")
            return

        start_date, end_date = None, None

        if isinstance(start_date_obj, datetime):
            start_date = start_date_obj.date()
        elif isinstance(start_date_obj, date):
            start_date = start_date_obj

        if isinstance(end_date_obj, datetime):
            end_date = end_date_obj.date()
        elif isinstance(end_date_obj, date):
            end_date = end_date_obj

        if not start_date or not end_date:
            raise TypeError(f"无法从 {start_date_obj} 或 {end_date_obj} 中正确解析出日期。")


        if not start_date or not end_date:
            current_app.logger.warning(
                f"[FullLifecycle] Contract {contract.id} is missing start or end dates. Skipping."
            )
            return

        current_app.logger.info(
            f"[FullLifecycle] Contract {contract.id} date range: {start_date} to {end_date}."
        )

        # Iterate through each month in the contract's lifecycle
        current_month_start = date(start_date.year, start_date.month, 1)
        while current_month_start <= end_date:
            year = current_month_start.year
            month = current_month_start.month

            current_app.logger.info(
                f"  [FullLifecycle] Calculating for {year}-{month} for contract {contract.id}"
            )
            self.calculate_for_month(year, month, contract_id, force_recalculate)

            # Move to the next month
            current_month_start += relativedelta(months=1)

        current_app.logger.info(
            f"[FullLifecycle] Finished bill generation for contract {contract.id}."
        )

    def process_substitution(self, record_id):
        """
        处理单个替班记录的完整流程，这是一个原子操作。
        1. 查找或创建原始账单。
        2. 关联替班记录。
        3. 如果是月嫂合同，则顺延周期。
        4. 创建替班账单。
        5. 重新计算原始账单。
        """
        sub_record = db.session.get(SubstituteRecord, record_id)
        if not sub_record:
            current_app.logger.error(f"[SubProcessing] 替班记录 {record_id} 未找到。")
            return

        main_contract = sub_record.main_contract
        if not main_contract:
            current_app.logger.error(
                f"[SubProcessing] 替班记录 {record_id} 缺少主合同关联。"
            )
            return

        try:
            # 1. 查找或创建受影响的原始账单
            original_bill = CustomerBill.query.filter(
                CustomerBill.contract_id == main_contract.id,
                CustomerBill.is_substitute_bill.is_not(True),
                CustomerBill.cycle_start_date <= sub_record.end_date,
                CustomerBill.cycle_end_date >= sub_record.start_date,
            ).first()

            if not original_bill:
                current_app.logger.info(
                    f"[SubProcessing] 未找到替班期间 {sub_record.start_date}-{sub_record.end_date} 的原始账单，将尝试生成它。"
                )
                # 确定应该为哪个月份生成账单（以替班结束日为准）
                target_year, target_month = (
                    sub_record.end_date.year,
                    sub_record.end_date.month,
                )
                self.calculate_for_month(
                    target_year, target_month, main_contract.id, force_recalculate=True
                )

                # 再次查找
                original_bill = CustomerBill.query.filter(
                    CustomerBill.contract_id == main_contract.id,
                    CustomerBill.is_substitute_bill.is_not(True),
                    CustomerBill.cycle_start_date <= sub_record.end_date,
                    CustomerBill.cycle_end_date >= sub_record.start_date,
                ).first()

            if not original_bill:
                raise Exception(
                    f"无法为替班记录 {record_id} 找到或创建对应的原始账单。"
                )

            # 2. 关联替班记录到原始账单
            sub_record.original_customer_bill_id = original_bill.id
            db.session.add(sub_record)
            current_app.logger.info(
                f"[SubProcessing] 替班记录 {sub_record.id} 已关联到原始账单 {original_bill.id}"
            )

            # 3. 如果是月嫂合同，处理周期顺延
            if main_contract.type == "maternity_nurse":
                substitute_days = (sub_record.end_date - sub_record.start_date).days
                postponement_delta = timedelta(days=substitute_days)

                current_app.logger.info(
                    f"[SubProcessing] 月嫂合同 {main_contract.id} 替班 {substitute_days} 天,postponement_delta {postponement_delta}，开始顺延周期。"
                )

                # 顺延主合同的预计下户日期
                if main_contract.expected_offboarding_date:
                    main_contract.expected_offboarding_date += postponement_delta
                    current_app.logger.info(
                        f"  -> 主合同预计下户日期顺延至: {main_contract.expected_offboarding_date}"
                    )

                # 延长当前账单周期
                original_bill.cycle_end_date += postponement_delta
                current_app.logger.info(
                    f"  -> 当前账单 {original_bill.id} 周期延长至: {original_bill.cycle_end_date}"
                )

                # 顺延所有未来的账单和薪酬单
                future_bills = (
                    CustomerBill.query.filter(
                        CustomerBill.contract_id == main_contract.id,
                        CustomerBill.is_substitute_bill.is_not(True),
                        CustomerBill.cycle_start_date > original_bill.cycle_start_date,
                    )
                    .order_by(CustomerBill.cycle_start_date)
                    .all()
                )

                future_payrolls = (
                    EmployeePayroll.query.filter(
                        EmployeePayroll.contract_id == main_contract.id,
                        EmployeePayroll.is_substitute_payroll.is_not(True),
                        EmployeePayroll.cycle_start_date
                        > original_bill.cycle_start_date,
                    )
                    .order_by(EmployeePayroll.cycle_start_date)
                    .all()
                )

                for bill in future_bills:
                    bill.cycle_start_date += postponement_delta
                    bill.cycle_end_date += postponement_delta
                for payroll in future_payrolls:
                    payroll.cycle_start_date += postponement_delta
                    payroll.cycle_end_date += postponement_delta

                current_app.logger.info(
                    f"  -> {len(future_bills)} 个未来账单和 {len(future_payrolls)} 个未来薪酬单已顺延。"
                )
                db.session.flush()  # 确保顺延的日期在当前事务中可

            # 4. 为替班记录生成新的独立账单
            self.calculate_for_substitute(record_id, commit=False)  # 传入 commit=False

            # 5. 强制重算原始账单
            current_app.logger.info(
                f"[SubProcessing] 准备重算原始账单 {original_bill.id}。"
            )
            self.calculate_for_month(
                original_bill.year,
                original_bill.month,
                original_bill.contract_id,
                force_recalculate=True,
            )

            db.session.commit()
            current_app.logger.info(
                "[SubProcessing] 替班流程处理完毕，所有更改已提交。"
            )
            return original_bill.id

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(
                f"[SubProcessing] 处理替班记录 {record_id} 时发生错误: {e}",
                exc_info=True,
            )
            raise e

    def _calculate_nanny_trial_bill(self, contract, year, month, force_recalculate=False):
        """
        处理育儿嫂试工合同的重新计算请求 (v15 - UNIFIED LOGIC)。

        此函数是试工合同重新计算的唯一入口，作为一个“桥梁”将调用统一的结算函数。
        初始账单生成也由 `process_trial_termination` 处理。
        """
        # 仅在强制重算时执行（即由用户编辑后触发）
        if not force_recalculate:
            return

        current_app.logger.info(f"[TrialRECALC] 开始为试工合同 {contract.id} 执行强制重算。")

        # 试工合同只有一个账单，找到它
        bill = CustomerBill.query.filter_by(contract_id=contract.id, is_substitute_bill=False).first()

        if not bill:
            current_app.logger.error(f"[TrialRECALC] 无法找到合同 {contract.id} 对应的试工账单进行重算。")
            return

        # 从现有账单的周期中反向推算出实际试工天数
        # 注意：天数计算包含首尾，所以需要+1
        actual_trial_days = (bill.cycle_end_date - bill.cycle_start_date).days

        current_app.logger.info(f"[TrialRECALC] 从账单 {bill.id} 推算出实际试工天数: {actual_trial_days}")

        # 调用包含最终正确业务逻辑的主函数，进行重算
        self.process_trial_termination(contract, actual_trial_days)

        current_app.logger.info(f"[TrialRECALC] 合同 {contract.id} 的重新计算已完成。")

    # 此函数没有被使用
    def _calculate_nanny_trial_details(self, contract, bill, payroll):
        """计算育儿嫂试工合同的所有财务细节。"""
        QUANTIZER = D("0.01")
        level = D(contract.employee_level or 0)
        cycle_start = bill.cycle_start_date
        cycle_end = bill.cycle_end_date

        attendance = self._get_or_create_attendance(contract, cycle_start, cycle_end)
        overtime_days = D(attendance.overtime_days)
        cust_increase, cust_decrease, emp_increase, emp_decrease, deferred_fee,emp_commission = (
            self._get_adjustments(bill.id, payroll.id)
        )

        base_work_days = D((cycle_end - cycle_start).days)
        total_days_worked = base_work_days + overtime_days
        # 试工合同 daily_rate  =  level
        daily_rate = (level).quantize(QUANTIZER)
        base_fee = (daily_rate * base_work_days).quantize(QUANTIZER)
        overtime_fee = (daily_rate * overtime_days).quantize(QUANTIZER)

        potential_income = base_fee + overtime_fee + emp_increase - emp_decrease
        service_fee_due = (level * D("0.1")).quantize(QUANTIZER)
        first_month_deduction = min(potential_income, service_fee_due)

        return {
            "type": "nanny_trial",
            "level": str(level),
            "cycle_period": f"{cycle_start.isoformat()} to {cycle_end.isoformat()}",
            "base_work_days": str(base_work_days),
            "overtime_days": str(overtime_days),
            "total_days_worked": str(total_days_worked),
            "daily_rate": str(daily_rate),
            "customer_base_fee": str(base_fee),
            "customer_overtime_fee": str(overtime_fee),
            "本次交管理费": "0.00",
            "customer_increase": str(cust_increase),
            "customer_decrease": str(cust_decrease),
            "employee_base_payout": str(base_fee),
            "employee_overtime_payout": str(overtime_fee),
            "first_month_deduction": str(first_month_deduction),
            "employee_increase": str(emp_increase),
            "employee_decrease": str(emp_decrease),
            "log_extras": {
                "first_month_deduction_reason": f"min(当期总收入({potential_income:.2f}), 级别*10%({service_fee_due:.2f}))"
            },
        }

    def calculate_termination_refunds(self, contract: BaseContract, termination_date: date) -> dict:
        """
        (V1-新增) 计算合同终止时的应退款项（保证金、管理费）。
        这是一个纯计算函数，不修改数据库。
        """
        if not contract:
            return {'deposit_refund': D('0'), 'management_fee_refund': D('0')}

        QUANTIZER = D("0.01")
        refunds = {
            'deposit_refund': D(getattr(contract, 'security_deposit_paid', 0) or 0).quantize(QUANTIZER),
            'management_fee_refund': D('0')
        }

        # --- 计算管理费退款 --- 
        is_monthly_renew = getattr(contract, 'is_monthly_auto_renew', False)
        
        if is_monthly_renew:
            # 月签合同：退还当月剩余天数的管理费
            term_month = termination_date.month
            term_year = termination_date.year
            _, days_in_month = calendar.monthrange(term_year, term_month)
            
            # 找到当月的账单，以获取当月管理费总额
            current_bill = CustomerBill.query.filter(
                CustomerBill.contract_id == contract.id,
                CustomerBill.year == term_year,
                CustomerBill.month == term_month,
                CustomerBill.is_substitute_bill == False
            ).first()

            if current_bill and current_bill.calculation_details:
                monthly_management_fee = D(current_bill.calculation_details.get('management_fee', '0'))
                if monthly_management_fee > 0:
                    daily_fee = monthly_management_fee / days_in_month
                    remaining_days = days_in_month - termination_date.day
                    refund_amount = (daily_fee * remaining_days).quantize(QUANTIZER)
                    refunds['management_fee_refund'] = refund_amount
        else:
            # 非月签合同：退还已付但未消耗的总管理费
            # 1. 找到首期账单，因为非月签的管理费是在首期一次性收取的
            first_bill = CustomerBill.query.filter(
                CustomerBill.contract_id == contract.id,
                CustomerBill.is_substitute_bill == False
            ).order_by(CustomerBill.cycle_start_date.asc()).first()

            if first_bill and first_bill.calculation_details:
                total_paid_management_fee = D(first_bill.calculation_details.get('management_fee', '0'))
                
                if total_paid_management_fee > 0:
                    # 2. 计算已消耗的管理费
                    contract_start_date = self._to_date(contract.start_date)
                    days_served = (termination_date - contract_start_date).days
                    
                    # 假设总管理费是基于整个合同周期的，计算日均管理费
                    total_contract_days = (self._to_date(contract.end_date) - contract_start_date).days
                    if total_contract_days > 0:
                        daily_fee = total_paid_management_fee / total_contract_days
                        consumed_fee = (daily_fee * days_served).quantize(QUANTIZER)
                        refund_amount = (total_paid_management_fee - consumed_fee).quantize(QUANTIZER)
                        refunds['management_fee_refund'] = refund_amount

        current_app.logger.info(f"为合同 {contract.id} 计算出的退款为: {refunds}")
        return refunds

    def _calculate_nanny_bill_for_month(
        self, contract: NannyContract, year: int, month: int, force_recalculate=False, actual_work_days_override=None, end_date_override=None
    ):
        """育儿嫂计费逻辑的主入口。"""
        # 调试日志 1: 检查传入的参数
        current_app.logger.debug(f"[DEBUG-ENGINE] _calculate_nanny_bill_for_month called with: end_date_override={end_date_override}, actual_work_days_override={actual_work_days_override}")

        current_app.logger.info(
            f"  [NannyCALC] 开始处理育儿嫂合同 {contract.id} for {year}-{month}"
        )

        bill_to_recalculate = None
        if force_recalculate:
            bill_to_recalculate = CustomerBill.query.filter_by(
                contract_id=contract.id, year=year, month=month, is_substitute_bill=False
            ).first()

        # --- 修正逻辑开始 ---
        if bill_to_recalculate:
            cycle_start = bill_to_recalculate.cycle_start_date
            # 调试日志 2: 检查从数据库读取的原始周期结束日
            current_app.logger.debug(f"[DEBUG-ENGINE] Found existing bill. Initial cycle_end from DB: {bill_to_recalculate.cycle_end_date}")

            # 关键修正：如果 end_date_override 存在，它必须覆盖从数据库读出的旧日期
            if end_date_override:
                cycle_end = end_date_override
                current_app.logger.debug(f"[DEBUG-ENGINE] end_date_override is present. Overriding cycle_end to: {cycle_end}")
            else:
                cycle_end = bill_to_recalculate.cycle_end_date

            current_app.logger.info(f"    [NannyCALC] 强制重算，使用现有账单 {bill_to_recalculate.id} 的周期: {cycle_start} to {cycle_end}")
        else:
            cycle_start, cycle_end = self._get_nanny_cycle_for_month(contract, year, month, end_date_override)
        # --- 修正逻辑结束 ---

        current_app.logger.info(f" cycle_start: {cycle_start}")
        if not cycle_start:
            current_app.logger.info(
                f"    [NannyCALC] 合同 {contract.id} 在 {year}-{month} 无需创建账单，跳过。"
            )
            return

        # --- 新增逻辑：根据最终的周期，计算工作日覆盖值 ---
        local_actual_work_days_override = actual_work_days_override
        if end_date_override and local_actual_work_days_override is None:
            start_date_obj, end_date_obj = self._to_date(cycle_start), self._to_date(cycle_end)
            if start_date_obj and end_date_obj:
                days = (end_date_obj - start_date_obj).days + 1
                local_actual_work_days_override = days
                # 调试日志 3: 检查新计算出的工作日
                current_app.logger.debug(f"[DEBUG-ENGINE] Calculated actual_work_days_override: {local_actual_work_days_override} days")
        # --- 新增逻辑结束 ---

        bill, payroll = self._get_or_create_bill_and_payroll(
            contract, year, month, cycle_start, cycle_end
        )

        if (not force_recalculate and bill.calculation_details and "calculation_log" in bill.calculation_details):
            current_app.logger.info(f"    [NannyCALC] 合同 {contract.id} 的账单已存在且无需重算，跳过。")
            return

        current_app.logger.info(f"    [NannyCALC] 为合同 {contract.id} 执行计算 (周期: {cycle_start} to {cycle_end})")
        # 调试日志 4: 检查最终传入计算函数的参数
        current_app.logger.debug(f"[DEBUG-ENGINE] Before details calculation: cycle_start={cycle_start}, cycle_end={cycle_end}, actual_work_days_override={local_actual_work_days_override}")

        # 使用我们新计算的 local_actual_work_days_override
        details = self._calculate_nanny_details(contract, bill, payroll, local_actual_work_days_override)
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)

        current_app.logger.info(f"    [NannyCALC] 计算育儿嫂合同应收金额 {contract.id} 的账单总应收金额: {bill.total_due}")
        log = self._create_calculation_log(details)
        self._update_bill_with_log(bill, payroll, details, log)
        current_app.logger.info(f"    [NannyCALC] 计算完成 for contract {contract.id}")

    def _get_nanny_cycle_for_month(self, contract, year, month, end_date_override=None):
        """计算指定育儿嫂合同在目标年月的服务周期。"""
        contract_end_date = end_date_override or contract.end_date
        if not contract.start_date or not contract_end_date:
            current_app.logger.info(f"没有 开始 {contract.start_date} 或 结束 {contract_end_date} 日期") 
            return None, None

        first_day_of_target_month = date(year, month, 1)
        _, num_days_in_target_month = calendar.monthrange(year, month)
        last_day_of_target_month = date(year, month, num_days_in_target_month)

        start_year, start_month = contract.start_date.year, contract.start_date.month
        end_year, end_month = contract_end_date.year, contract_end_date.month
        

        if year == start_year and month == start_month:
            if start_year == end_year and start_month == end_month:
                # current_app.logger.info(f"====111====contract.start_date.{contract.start_date},contract_end_date{contract_end_date}")
                return contract.start_date, contract_end_date
            else:
                _, num_days_in_start_month = calendar.monthrange(
                    start_year, start_month
                )
                last_day_of_start_month = date(
                    start_year, start_month, num_days_in_start_month
                )
                # current_app.logger.info(f"====222====contract.start_date.{contract.start_date},last_day_of_start_month{last_day_of_start_month}")
                return contract.start_date, last_day_of_start_month

        if year == end_year and month == end_month:
            if not (start_year == end_year and start_month == end_month):
                first_day_of_end_month = date(end_year, end_month, 1)
                # current_app.logger.info(f"====333====contract.first_day_of_end_month.{first_day_of_end_month},contract_end_date{contract_end_date}")
                return first_day_of_end_month, contract_end_date

        target_month_date = date(year, month, 1)
        start_month_date = date(start_year, start_month, 1)
        end_month_date = date(end_year, end_month, 1)
        # current_app.logger.debug(f"终极调试算出乎：year = {year} , start_year:{start_year},month:{month}, start_month:{start_month}, end_year : {end_year} , end_month: {end_month}, target_month_date:{target_month_date},start_month_date:{start_month_date}, end_month_date:{end_month_date} ")
        if start_month_date < target_month_date <= end_month_date:
            return first_day_of_target_month, last_day_of_target_month
                # 条件2：【新增】如果是自动续约合同，并且目标月份在当前记录的结束日期之后
        elif contract.is_monthly_auto_renew and target_month_date > end_month_date:
            # current_app.logger.info(f"====AUTORENEW==== 合同 {contract.id} 是自动续约合同，为未来的月份 {year}-{month} 创建新周期。")
            return first_day_of_target_month, last_day_of_target_month
        return None, None

    def _get_first_maternity_nurse_cycle_in_month(self, contract, year, month):
        """获取月嫂合同在指定月份的第一个服务周期。"""
        # 使用 _to_date 辅助函数，确保我们处理的是纯 date 对象
        start_date = self._to_date(contract.actual_onboarding_date)
        contract_end_date = self._to_date(contract.expected_offboarding_date or contract.end_date)

        if not start_date or not contract_end_date:
            return None, None

        cycle_start = start_date
        while cycle_start < contract_end_date:
            cycle_end = cycle_start + timedelta(days=26)
            if cycle_end > contract_end_date:
                cycle_end = contract_end_date

            # 现在所有变量都是 date 对象，可以安全比较
            target_month_first_day = date(year, month, 1)
            target_month_last_day = date(year, month, calendar.monthrange(year, month)[1])

            # 检查周期是否与目标月份重叠
            # (周期开始 <= 月份结束) AND (周期结束 >= 月份开始)
            if cycle_start <= target_month_last_day and cycle_end >= target_month_first_day:
                return cycle_start, cycle_end

            if cycle_end >= contract_end_date:
                break

            cycle_start = cycle_end + timedelta(days=1) # 月嫂合同周期是连续的，所以要+1

        return None, None

    def _calculate_nanny_details(
        self, contract: NannyContract, bill: CustomerBill, payroll: EmployeePayroll, actual_work_days_override=None
    ):
        """计算育儿嫂合同的所有财务细节。"""
        current_app.logger.info(f"    [NannyDETAILS] 计算育儿嫂合同 {contract.id} 的详细信息。")
        log_extras = {}
        QUANTIZER = D("0.001")
        self._attach_pending_adjustments(contract, bill)
        extension_fee = D(0)
        level = D(contract.employee_level or 0)
         # 【关键修复】在函数开头，将所有日期统一为 date 对象
        cycle_start = self._to_date(bill.cycle_start_date)
        cycle_end = self._to_date(bill.cycle_end_date)
        contract_start_date = self._to_date(contract.start_date)
        contract_end_date = self._to_date(contract.end_date)
        authoritative_end_date = self._to_date(contract.expected_offboarding_date or contract.end_date)
         # 月管理费从合同获取 xxxx.xx元/月
        management_fee_amount = D(contract.management_fee_amount or 0)

        attendance = self._get_or_create_attendance(contract, cycle_start, cycle_end)
        overtime_days = D(attendance.overtime_days)

        # 在这里处理保证金，然后再获取调整项
        self._handle_security_deposit(contract, bill)
        self._handle_introduction_fee(contract, bill)
        db.session.flush()
        cust_increase, cust_decrease, emp_increase, emp_decrease, deferred_fee,emp_commission = (
            self._get_adjustments(bill.id, payroll.id)
        )
        cust_discount = D(
            db.session.query(func.sum(FinancialAdjustment.amount))
            .filter(
                FinancialAdjustment.customer_bill_id == bill.id,
                FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DISCOUNT,
            )
            .scalar()
            or 0
        )

        total_substitute_days = 0
        substitute_deduction_from_sub_records = D(0)
               # 用于收集替班详情，以便生成聚合日志
        substitution_details_for_log = []
        # --- Gemini-generated code (Optimization): End ---

        # 获取主合同员工的级别和日薪
        main_contract_level = D(contract.employee_level or 0)
        main_contract_daily_rate = (main_contract_level / D(26)).quantize(QUANTIZER)

        for record in bill.substitute_records_affecting_bill:
            # --- 关键修复：在比较前，将 record 的 datetime 对象转换为 date 对象 ---
            record_start_date = record.start_date.date()
            record_end_date = record.end_date.date()

            

            overlap_start = max(cycle_start, record_start_date)
            overlap_end = min(cycle_end, record_end_date)
            if overlap_start <= overlap_end:
                days_in_cycle = (overlap_end - overlap_start).days
                total_substitute_days += days_in_cycle

                # --- Gemini-generated code (Optimization): Start ---
                # 在循环中收集信息，而不是直接生成日志
                sub_employee_name = (
                    record.substitute_user.username
                    if record.substitute_user
                    else record.substitute_personnel.name
                )
                substitution_details_for_log.append(f"由({sub_employee_name})替班{days_in_cycle}天")
                # --- Gemini-generated code (Optimization): End ---

        # --- Gemini-generated code (Optimization): Start ---
        # 在循环结束后，根据收集到的信息生成最终的、聚合后的日志
        substitute_deduction_from_sub_records = (main_contract_daily_rate * D(total_substitute_days)).quantize(QUANTIZER)

        substitute_deduction_logs = []
        if substitution_details_for_log:
            events_str = "、".join(substitution_details_for_log)
            calculation_str = f"扣除: 当前级别({main_contract_level:.2f})/26 * 总替班天数({total_substitute_days}) = {substitute_deduction_from_sub_records:.2f}"
            log_str = f"{events_str}。{calculation_str}"
            substitute_deduction_logs.append(log_str)

        is_last_bill = contract_end_date and cycle_end == contract_end_date

        cycle_actual_days = (cycle_end - cycle_start).days
        if is_last_bill:  # 育儿嫂最后一个月账单天数 +1
            cycle_actual_days += 1
        is_first_bill = cycle_start == contract_start_date
        if is_first_bill:  # 育儿嫂最后一个月账单天数 +1
            cycle_actual_days = (cycle_end - cycle_start).days
        
        # --- NEW LOGIC for actual_work_days ---
        # 优先使用从API传入的覆盖值
        if actual_work_days_override is not None:
            base_work_days = D(actual_work_days_override)
            log_extras["base_work_days_reason"] = f"使用用户传入的实际劳务天数 ({actual_work_days_override:.3f})"
            # 同步更新数据库中的字段，确保前端刷新后能看到正确的值
            bill.actual_work_days = actual_work_days_override
            payroll.actual_work_days = actual_work_days_override
        elif bill.actual_work_days and bill.actual_work_days > 0:
            base_work_days = D(bill.actual_work_days)
            log_extras["base_work_days_reason"] = f"使用数据库中已存的实际劳务天数 ({bill.actual_work_days})"
        else:
            # 回退到旧的计算逻辑
            base_work_days = D(min(cycle_actual_days, 26))
            log_extras["base_work_days_reason"] = f"默认逻辑: min(周期天数({cycle_actual_days}), 26)"
        # --- END NEW LOGIC ---
        
        total_days_worked = base_work_days + overtime_days - D(total_substitute_days)

        # 育儿嫂普通合同日薪定义
        customer_daily_rate = level / D(26)
        employee_daily_rate = level / D(26)

        # 基础费用计算
        customer_base_fee = (employee_daily_rate * base_work_days).quantize(QUANTIZER)
        employee_base_payout = (employee_daily_rate * base_work_days).quantize(
            QUANTIZER
        )

        # 加班费计算
        customer_overtime_fee = (customer_daily_rate * overtime_days).quantize(
            QUANTIZER
        )
        employee_overtime_payout = (employee_daily_rate * overtime_days).quantize(
            QUANTIZER
        )

        # 管理费计算
        if management_fee_amount:
            current_app.logger.info(f"management_fee_amount:{management_fee_amount}")
            management_fee_daily_rate = management_fee_amount/30
        else:
            # 合同中没有管理费，按10%收取
            current_app.logger.info(f"level:{level}")
            management_fee_daily_rate = level * D("0.1") / D(30) 
        
        management_fee = D(0)
        
        

        # --- 新增逻辑：优先处理末期不足月的账单 ---
        # 1. 判断是否为最后一个账单
        is_last_bill = contract_end_date and cycle_end == contract_end_date

        # 2. 获取当前账单周期的月份和年份
        current_year = cycle_end.year
        current_month = cycle_end.month

        # 3. 获取该月的实际最后一天
        _, num_days_in_month = calendar.monthrange(current_year, current_month)
        last_day_of_month = num_days_in_month

        # # 4. 如果是最后一个账单，并且其结束日不是该月的最后一天
        # if is_last_bill and cycle_end.day != last_day_of_month:
        #     # 使用您指定的新逻辑
        #     # 注意：天数计算包含首尾两天，所以需要+1
        #     cycle_duration_days = (cycle_end - cycle_start).days + 1
        #     management_days = D(min(cycle_duration_days, 30))
        #     management_fee = (level * D("0.1") / D(30) * management_days).quantize(QUANTIZER)
        #     log_extras["management_fee_reason"] = (
        #         f"末期账单不足月，按天收取: 级别({level})*10%/30 * min(周期天数({cycle_duration_days}), 30) = {management_fee:.2f}"
        #     )
        # # --- 结束新增逻辑，注意下面的 if 变成了 elif ---
        is_last_bill_period = contract_end_date and cycle_end >= contract_end_date

        
        if contract.is_monthly_auto_renew:
            # 月签合同逻辑 (保持不变)
            if is_first_bill and cycle_start.day != 1:
                current_month_contract_days = (cycle_end - cycle_start).days
                management_days = D(min(current_month_contract_days + 1, 30))
                management_fee = (management_fee_daily_rate * management_days).quantize(
                    QUANTIZER
                )
                if management_fee_amount:
                    management_fee_reason =  f"月签合同首月不足月，按天收取: 管理费{management_fee_amount}/30 * 劳务天数 ({current_month_contract_days} + 1) = {management_fee:.2f}"

                else:
                    management_fee_reason =  f"月签合同首月不足月，按天收取: 级别{level} * 10%/30 * 劳务天数 ({current_month_contract_days} + 1) = {management_fee:.2f}"
                log_extras["management_fee_reason"] = management_fee_reason
            elif is_last_bill and cycle_end.day != last_day_of_month:
                cycle_duration_days = (cycle_end - cycle_start).days + 1
                management_days = D(min(cycle_duration_days, 30))
                management_fee = (management_fee_daily_rate * management_days).quantize(QUANTIZER)
                if management_fee_amount:
                    management_fee_reason = f"末期账单不足月，按天收取: 管理费{management_fee_amount}/30 * min(周期天数({cycle_duration_days}), 30) = {management_fee:.2f}"
                else:
                    management_fee_reason = f"末期账单不足月，按天收取: 级别({level})*10%/30 * min(周期天数({cycle_duration_days}), 30) = {management_fee:.2f}"
                log_extras["management_fee_reason"] = management_fee_reason
            else:
                management_fee = (level * D("0.1")).quantize(QUANTIZER)
                if management_fee_amount:
                    management_fee_reason = f"月签合同整月，按月收取: {management_fee_amount} "
                else:
                    management_fee_reason = f"月签合同整月，按月收取: {level} * 10%"
                log_extras["management_fee_reason"] = management_fee_reason
        else:
            # --- 非月签合同逻辑 ---
            current_app.logger.info("进入非月签合同逻辑")
            if is_first_bill:
                monthly_management_fee = management_fee_amount if management_fee_amount > 0 else(level * D("0.1"))
                current_app.logger.info(f"contract_start_date.day:{contract_start_date.day},contract_end_date.day:{contract_end_date.day}")
                # --- 核心修改：在这里加入新规则判断 ---
                if contract_start_date.day == contract_end_date.day:
                    # --- 特殊规则：起止日号数相同，按整月计算 ---
                    current_app.logger.info(f"合同 {contract.id} 触发了整月管理费计算模式。")
                    rdelta = relativedelta(contract_end_date, contract_start_date)
                    # 当天数相同时，月数+1才是我们想要的合同月数，例如3.21到8.21是5个月
                    total_months = rdelta.years * 12 + rdelta.months
                    # if contract_end_date.day >= contract_start_date.day:
                    #     total_months+=1

                    management_fee = (monthly_management_fee *D(total_months)).quantize(QUANTIZER)
                    management_fee_reason = f"非月签合同(起止日相同)首月一次性收取: {total_months}个整月 * {monthly_management_fee:.2f}/月 = {management_fee:.2f}元"

                else:
                    # --- 默认规则：起止日号数不同，按三段式天数计算 ---
                    current_app.logger.info(f"合同 {contract.id} 使用按天三段式管理费计算模式。")
                    daily_management_fee = (monthly_management_fee / D(30)).quantize(D("0.0001"))
                    start = contract_start_date
                    end = contract_end_date

                    if start.year == end.year and start.month == end.month:
                        total_days = min(30, (end - start).days + 1)
                        management_fee = (daily_management_fee *D(total_days)).quantize(QUANTIZER)
                        management_fee_reason = f"非月签合同(不足一月)按天收取: {total_days}天 = {management_fee:.2f}元"
                    else:
                        days_in_start_month = calendar.monthrange(start.year, start.month)[1]
                        first_month_days = min(30, days_in_start_month - start.day + 1)
                        first_month_fee = (daily_management_fee *D(first_month_days)).quantize(QUANTIZER)

                        last_month_days = min(30, end.day)
                        last_month_fee = (daily_management_fee *D(last_month_days)).quantize(QUANTIZER)

                        full_months_count = (end.year - start.year) * 12 + (end.month -start.month) - 1
                        full_months_fee = D(0)
                        if full_months_count > 0:
                            full_months_fee = monthly_management_fee * D(full_months_count)

                        management_fee = first_month_fee + full_months_fee + last_month_fee
                        reason_parts = [f"首月({first_month_days}天):{first_month_fee:.2f}"]
                        if full_months_fee > 0:
                            reason_parts.append(f"中间{full_months_count}整月:{full_months_fee:.2f}")
                        reason_parts.append(f"末月({last_month_days}天):{last_month_fee:.2f}")
                        management_fee_reason = f"非月签合同首月一次性收取 ({' + '.join(reason_parts)}) = {management_fee:.2f}元"
            else:
                # 非首月，非月签合同不收管理费
                management_fee = D(0)
                management_fee_reason = "非月签合同非首月，不收取管理费"

            log_extras["management_fee_reason"] = management_fee_reason

            current_app.logger.info(f"检查是否进入“延长服务期逻辑”:is_last_bill_period:{is_last_bill_period},cycle_end:{cycle_end},contract_end_date:{contract_end_date},authoritative_end_date:{authoritative_end_date}")
            if is_last_bill_period and cycle_end > contract_end_date:
                current_app.logger.info(f"合同 {contract.id} 进入末期延长计费逻辑。")
                # 场景：这是被延长的最后一期账单

                # 1. 计算延长天数和费用
                extension_fee = D(0)
                # 使用 authoritative_end_date 进行比较
                current_app.logger.info(f"检查是否进入延长服务期逻辑 authoritative_end_date and cycle_end > authoritative_end_date :{authoritative_end_date} -- {cycle_end} --  {authoritative_end_date}")
                if authoritative_end_date and contract_end_date < authoritative_end_date:
                    extension_days = (authoritative_end_date - contract_end_date).days
                    current_app.logger.info(f"延长周期的extension_days======:{extension_days}")
                    if extension_days > 0:
                        daily_rate = level / D(26)
                        extension_fee = (daily_rate *D(extension_days)).quantize(QUANTIZER)
                        log_extras["extension_days_reason"] = f"原合同于 {authoritative_end_date.strftime('%m月%d日')} 结束，延长至 {cycle_end.strftime('%m月%d日')}，共 {extension_days} 天。"
                        log_extras["extension_fee_reason"] = f"延期劳务费: 日薪({daily_rate:.2f}) * 延长天数({extension_days}) = {extension_fee:.2f}"

                        management_fee_daily_rate = (management_fee_amount or (level *D("0.1"))) / D(30)
                        extension_management_fee = (management_fee_daily_rate *D(extension_days)).quantize(QUANTIZER)
                        if extension_management_fee > 0:
                            # 【关键修复】确保日志被正确记录
                            log_extras["management_fee_reason"] = log_extras.get("management_fee_reason", "") + f" + 延期管理费: 日管理费({management_fee_daily_rate:.2f}) * {extension_days}天 ={extension_management_fee:.2f}"
                            management_fee += extension_management_fee
            
        # --- 【新逻辑】员工首月10%服务费 ---
        first_month_deduction = D(0)
        is_first_bill_of_contract = cycle_start == contract_start_date
        current_app.logger.info("开始检查首月10%返佣逻辑")

        if is_first_bill_of_contract:
            current_app.logger.info(f"合同 {contract.id} 进入首月佣金检查逻辑。")
            customer_name = contract.customer_name
            employee_id = contract.user_id or contract.service_personnel_id

            # 检查是否存在该客户与该员工的更早的合同
            previous_contract_exists = db.session.query(BaseContract.id).filter(
                BaseContract.id != contract.id,
                BaseContract.customer_name == customer_name,
                BaseContract.type != 'nanny_trial',  # 排除试工合同
                or_(
                    BaseContract.user_id == employee_id,
                    BaseContract.service_personnel_id == employee_id
                ),
                BaseContract.start_date < contract_start_date
            ).first()

            if not previous_contract_exists:
                current_app.logger.info(f"[CommissionCheck] No previous contract found for customer {customer_name} and employee {employee_id}. Proceeding with first month commission deduction check.")
                # 只有在不存在更早的合同的情况下，才计算并创建服务费调整项
                potential_income = (employee_base_payout + employee_overtime_payout + emp_increase - emp_decrease)
                current_app.logger.info(f"[CommissionCheck] Calculated employee_base_payout: {employee_base_payout}, employee_overtime_payout: {employee_overtime_payout}, emp_increase: {emp_increase}, emp_decrease: {emp_decrease}, potential_income : {potential_income}")
                service_fee_due = (level * D("0.1")).quantize(QUANTIZER)
                current_app.logger.info(f"[CommissionCheck] Calculated potential income: {potential_income}, service fee due (level*10%): {service_fee_due}")
                # first_month_deduction = min(potential_income, service_fee_due)
                first_month_deduction = service_fee_due
                current_app.logger.info(f"[CommissionCheck first_month_deduction ] Final first month deduction to be applied: {first_month_deduction}")

                if first_month_deduction > 0:
                    # ------------------- 以下是核心修改 (V2) -------------------

                    # 增强检查：只要存在任何以“员工首月佣金”开头的描述，就认为已经处理过
                    commission_already_handled = FinancialAdjustment.query.filter(
                        FinancialAdjustment.employee_payroll_id == payroll.id,
                        FinancialAdjustment.description.like('[系统添加] 员工首月佣金%')
                    ).first()

                    if not commission_already_handled:
                        db.session.add(
                            FinancialAdjustment(
                                employee_payroll_id=payroll.id,
                                adjustment_type=AdjustmentType.EMPLOYEE_COMMISSION,
                                amount=first_month_deduction,
                                description="[系统添加] 员工首月佣金",
                                date=bill.cycle_start_date,
                            )
                        )
                        # log_extras["first_month_deduction_reason"] =f"首次合作，创建员工佣金调整项: min(当期总收入({potential_income:.2f}),级别*10%({service_fee_due:.2f})) = {first_month_deduction:.2f}"
                        log_extras["first_month_deduction_reason"] =f"首次合作，创建员工佣金调整项: 级别*10%({service_fee_due:.2f})) = {first_month_deduction:.2f}"
                    else:
                        
                        log_extras["first_month_deduction_reason"] ="员工首月佣金调整项已被处理过（可能已创建或转移），不再重复创建。"
                else:
                    current_app.logger.info(f"[CommissionCheck] Calculated first month deduction is {first_month_deduction}, no adjustment needed.")
                    log_extras["first_month_deduction_reason"] ="首次合作，但计算出的首月佣金为0，无需创建调整项。"
                    # ------------------- 以上是核心修改 (V2) -------------------
            else:
                previous_contract_id = previous_contract_exists[0]
                current_app.logger.info(f"[CommissionCheck] Found previous contract for customer {customer_name} and employee {employee_id}. Previouscontract ID: {previous_contract_id}")
                log_extras["first_month_deduction_reason"] =f"员工与客户已有过合作历史（合同ID: {previous_contract_id}），不收取首月佣金。"

        current_app.logger.debug(f"NannyDETAILS:log_extras:{log_extras}")
        # 返回的 details 中不再包含 first_month_deduction，因为它已经变成了调整项
        return {
            "type": "nanny",
            "level": str(level),
            "cycle_period": f"{cycle_start.isoformat()} to {cycle_end.isoformat()}",
            "base_work_days": str(base_work_days),
            "overtime_days":  f"{overtime_days:.3f}",
            "total_days_worked": str(total_days_worked),
            "substitute_days": str(total_substitute_days),
            "substitute_deduction": str(substitute_deduction_from_sub_records.quantize(QUANTIZER)),
            "extension_fee": f"{extension_fee:.2f}",
            "customer_base_fee": str(customer_base_fee),
            "customer_overtime_fee": str(customer_overtime_fee),
            "management_fee": str(management_fee),
            "customer_increase": str(cust_increase),
            "customer_decrease": str(cust_decrease),
            "discount": str(cust_discount),
            "employee_base_payout": str(employee_base_payout),
            "employee_overtime_payout": str(employee_overtime_payout),
            "employee_increase": str(emp_increase),
            "employee_decrease": str(emp_decrease),
            "employee_commission": str(emp_commission),
            "customer_daily_rate": str(customer_daily_rate.quantize(QUANTIZER)),
            "employee_daily_rate": str(employee_daily_rate.quantize(QUANTIZER)),
            "deferred_fee": str(deferred_fee),
            "log_extras": log_extras,
            "substitute_deduction_logs": substitute_deduction_logs,
        }

    def _calculate_maternity_nurse_bill_for_month(
        self,
        contract: MaternityNurseContract,
        year: int,
        month: int,
        force_recalculate=False,
        cycle_start_date_override=None
    ):
        current_app.logger.info(
            f"=====[MN CALC] 开始处理月嫂合同 {contract.id} for {year}-{month}"
        )
        if not contract.actual_onboarding_date:
            current_app.logger.info(
                f"    [MN CALC] 合同 {contract.id} 缺少实际上户日期，跳过。"
            )
            return

        contract_end = contract.expected_offboarding_date or contract.end_date
        if not contract_end:
            current_app.logger.warning(
                f"    [MN CALC] 合同 {contract.id} 缺少结束日期，无法计算。"
            )
            return

        # --- 新增逻辑：当强制重算时，优先使用现有账单的周期日期 ---
        if force_recalculate:
            bill_to_recalculate = None
            # 优先使用从API层传递过来的精确周期开始日期来查找
            if cycle_start_date_override:
                bill_to_recalculate = CustomerBill.query.filter_by(
                    contract_id=contract.id,
                    cycle_start_date=cycle_start_date_override,
                    is_substitute_bill=False,
                ).first()
                if bill_to_recalculate:
                     current_app.logger.info(f"[MN CALC] 强制重算，通过cycle_start_date_override找到了精确账单 {bill_to_recalculate.id}。")

            # 如果没有精确日期，则回退到旧的、可能不准确的按月查找
            if not bill_to_recalculate:
                bill_to_recalculate = CustomerBill.query.filter_by(
                    contract_id=contract.id,
                    year=year,
                    month=month,
                    is_substitute_bill=False,
                ).first()
                if bill_to_recalculate:
                    current_app.logger.warning(f"[MN CALC] 强制重算，回退到按月份查找，找到账单 {bill_to_recalculate.id}。")

            if bill_to_recalculate:
                current_app.logger.info(
                    f"[MN CALC] 使用账单 {bill_to_recalculate.id} 的周期 {bill_to_recalculate.cycle_start_date} to {bill_to_recalculate.cycle_end_date} 进行重算。"
                )
                self._process_one_billing_cycle(
                    contract,
                    bill_to_recalculate.cycle_start_date,
                    bill_to_recalculate.cycle_end_date,
                    year,
                    month,
                    force_recalculate=True,
                )
                return
            else:
                current_app.logger.warning(
                    f"    [MN CALC] 强制重算，但未找到月嫂合同 {contract.id} 在 {year}-{month} 的任何现有账单。将按常规流程计算。"
                )
        # --- 结束新增逻辑 ---

        # 原有逻辑：如果不是强制重算，或者强制重算但未找到现有账单，则按常规方式推导周期
        cycle_start = contract.actual_onboarding_date
        while cycle_start < contract_end:
            cycle_end = cycle_start + timedelta(days=26)
            if cycle_end >= contract_end:
                cycle_end = contract_end

            settlement_year, settlement_month = cycle_end.year, cycle_end.month

            if settlement_year == year and settlement_month == month:
                current_app.logger.info(
                    f"    [MN CALC] 找到一个归属于 {year}-{month} 的结算周期: {cycle_start} to {cycle_end}"
                )
                self._process_one_billing_cycle(
                    contract, cycle_start, cycle_end, year, month, force_recalculate
                )

            if cycle_end >= contract_end:
                break

            # 下个账单开始日，就是当前账单结束日
            # cycle_start = cycle_end + timedelta(days=1)
            cycle_start = cycle_end

    def _process_one_billing_cycle(
        self,
        contract: MaternityNurseContract,
        cycle_start_date,
        cycle_end_date,
        year: int,
        month: int,
        force_recalculate=False,
    ):
        current_app.logger.info(
            f"      [CYCLE PROC] 开始处理周期 {cycle_start_date} to {cycle_end_date} for settlement month {year}-{month}"
        )

        # First, try to find an existing non-substitute bill for this contract and month
        # This is crucial for handling postponed bills
        existing_bill = CustomerBill.query.filter_by(
            contract_id=contract.id,
            cycle_start_date=cycle_start_date,
            year=year,
            month=month,
            is_substitute_bill=False,
        ).first()

        # If an existing bill is found and we are not forcing recalculation, skip
        if existing_bill and not force_recalculate:
            current_app.logger.info(
                f"      [CYCLE PROC] 周期 {cycle_start_date} 的账单已存在且无需强制重算，跳过。"
            )
            current_app.logger.info(
                f"      [CYCLE PROC] 周期 {existing_bill.cycle_start_date} 的账单已存在且无需强制重算，跳过。"
            )
            return

        bill, payroll = self._get_or_create_bill_and_payroll(
            contract, year, month, cycle_start_date, cycle_end_date
        )
        # If an existing bill is found and we ARE forcing recalculation,
        # use its dates for the calculation to preserve postponement
        if existing_bill and force_recalculate:
            actual_cycle_start_date = existing_bill.cycle_start_date
            actual_cycle_end_date = existing_bill.cycle_end_date
            current_app.logger.info(
                f"      [CYCLE PROC] Found existing bill {existing_bill.id} for recalculation.Using its dates: {actual_cycle_start_date} to {actual_cycle_end_date}"
            )
        else:
            # If no existing bill, or not forcing recalculation, use the derived dates
            actual_cycle_start_date = cycle_start_date
            actual_cycle_end_date = cycle_end_date
            current_app.logger.info(
                f"      [CYCLE PROC] No existing bill found or not forcing recalculation. Using derived dates: {actual_cycle_start_date} to {actual_cycle_end_date}"
            )
        details = self._calculate_maternity_nurse_details(contract, bill, payroll)
        
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)
        current_app.logger.info(
            f"      [CYCLE PROC] 计算月嫂合同bill.total_due  {bill.total_due } 的财务细节完成。"
        )
    
        log = self._create_calculation_log(details)
        self._update_bill_with_log(bill, payroll, details, log)
        _update_bill_payment_status(bill)
        current_app.logger.info(
            f"      [CYCLE PROC] 周期 {actual_cycle_start_date} 计算完成。"
        )

    def _calculate_maternity_nurse_details(
        self,
        contract: MaternityNurseContract,
        bill: CustomerBill,
        payroll: EmployeePayroll,
    ):

       
        self._attach_pending_adjustments(contract, bill)
        """计算月嫂合同的所有财务细节（已二次修正）。"""
        QUANTIZER = D("0.01")
        level = D(contract.employee_level or 0)
        # 此处直接使用客交保证金
        customer_deposit = D(contract.security_deposit_paid or 0)
        discount = D(contract.discount_amount or 0)
        security_deposit = D(contract.security_deposit_paid or 0)
        log_extras = {}

         # 【关键修复】统一使用纯 date 对象
        cycle_start = self._to_date(bill.cycle_start_date)
        cycle_end = self._to_date(bill.cycle_end_date)
        authoritative_end_date = self._to_date(contract.expected_offboarding_date or contract.end_date)
        
        attendance = self._get_or_create_attendance(contract, cycle_start, cycle_end)
        # 打印从考勤记录中获取的原始数据
        overtime_days = D(attendance.overtime_days)
        actual_cycle_days = (cycle_end - cycle_start).days
        base_work_days = D(min(actual_cycle_days, 26))
        total_days_worked = base_work_days + overtime_days
        

        # 1. 管理费和管理费率计算
        management_fee = ((customer_deposit - level)/26 * (base_work_days)).quantize(QUANTIZER)
        # --- 【健壮性修复】优先使用合同上存储的费率 ---
        if contract.management_fee_rate is not None:
            management_fee_rate = D(contract.management_fee_rate)
        elif customer_deposit > 0:
            management_fee_rate = (management_fee / customer_deposit).quantize(D("0.0001"))
        else:
            management_fee_rate = D(0)
        log_extras["management_fee_reason"] = (
            f"客交保证金({customer_deposit:.2f}) - 级别({level:.2f}) / 26 * 劳务天数({base_work_days}) = {management_fee:.2f}"
        )
        log_extras["management_fee_rate_reason"] = (
            f"管理费({management_fee:.2f}) / 客交保证金({customer_deposit:.2f}) = {management_fee_rate * 100:.2f}%"
        )


        # 在这里处理保证金，然后再获取调整项
        self._handle_security_deposit(contract, bill)
        cust_increase, cust_decrease, emp_increase, emp_decrease, deferred_fee, emp_commission = (
            self._get_adjustments(bill.id, payroll.id)
        )

        # 2. 日薪区分 (保持完整精度)
        customer_overtime_daily_rate = customer_deposit / D(26)
        employee_daily_rate = level / D(26)
        log_extras["customer_overtime_daily_rate_reason"] = (
            f"客交保证金({customer_deposit:.2f}) / 26"
        )
        log_extras["employee_daily_rate_reason"] = f"级别({level:.2f}) / 26"



        # 3. 费用计算 (修正 #1)
        customer_base_fee = (employee_daily_rate * base_work_days).quantize(QUANTIZER)
        customer_overtime_fee = (customer_overtime_daily_rate * overtime_days).quantize(
            QUANTIZER
        )
        employee_base_payout = (employee_daily_rate * base_work_days).quantize(
            QUANTIZER
        )
        employee_overtime_payout = customer_overtime_fee

        # 4. 5%奖励逻辑 (修正 #2)
        # bonus_5_percent = D(0)
        # is_first_bill = not db.session.query(CustomerBill.id).filter(
        #     CustomerBill.contract_id == contract.id,
        #     CustomerBill.is_substitute_bill == False,
        #     CustomerBill.cycle_start_date < bill.cycle_start_date
        # ).first()

        # if is_first_bill and management_fee_rate == D('0.15'):
        #     bonus_5_percent = (level * D('0.05')).quantize(QUANTIZER)
        #     log_extras['bonus_5_percent_reason'] = f"首月且管理费率为15%，奖励: 级别({level:.2f}) * 5% = {bonus_5_percent:.2f}"
        # elif is_first_bill:
        #     log_extras['bonus_5_percent_reason'] = f"首月但管理费率({management_fee_rate*100:.2f}%)不为15%，无奖励"
        # else:
        #     log_extras['bonus_5_percent_reason'] = "非首月，无奖励"

        # 替班逻辑
        total_substitute_days = 0
        substitute_deduction_logs = []
        for record in bill.substitute_records_affecting_bill:
            log_str = "月嫂被替班，账单顺延仍是26天，因此不扣除被替班费用"
            substitute_deduction_logs.append(log_str)

        is_last_bill = authoritative_end_date and cycle_end >=authoritative_end_date

        # --- 【新增】月嫂合同延长服务逻辑 ---
        extension_fee = D(0)
        # 【关键修改】使用 authoritative_end_date
        # authoritative_end_date = self._to_date(contract.expected_offboarding_date or contract.end_date)

        if authoritative_end_date and cycle_end > authoritative_end_date:
            extension_days = (self._to_date(bill.cycle_end_date) -authoritative_end_date).days
            if extension_days > 0:
                daily_rate = level / D(26)
                extension_fee = (daily_rate *D(extension_days)).quantize(QUANTIZER)
                log_extras["extension_days_reason"] = f"原合同于 {authoritative_end_date.strftime('%m月%d日')} 结束，手动延长至{bill.cycle_end_date.strftime('%m月%d日')}，共 {extension_days} 天。"
                log_extras["extension_fee_reason"] = f"延期劳务费: 级别({level:.2f})/26 * 延长天数({extension_days}) = {extension_fee:.2f}"
        # --- 新增结束 ---

        return {
            "type": "maternity_nurse",
            "level": str(level),
            "customer_deposit": str(customer_deposit),
            "cycle_period": f"{cycle_start.isoformat()} to {cycle_end.isoformat()}",
            "base_work_days": str(base_work_days),
            "overtime_days": str(overtime_days),
            "total_days_worked": str(total_days_worked),
            "substitute_days": str(total_substitute_days),
            "substitute_deduction": "0.00",
            "customer_daily_rate": str(customer_overtime_daily_rate),
            "employee_daily_rate": str(employee_daily_rate),
            "management_fee_rate": str(management_fee_rate),
            "management_fee": str(management_fee),
            "customer_base_fee": str(customer_base_fee),
            "customer_overtime_fee": str(customer_overtime_fee),
            "discount": str(discount),
            "security_deposit_return": str(security_deposit)
            if is_last_bill
            else "0.00",
            "customer_increase": str(cust_increase),
            "customer_decrease": str(cust_decrease),
            "employee_base_payout": str(employee_base_payout),
            "employee_overtime_payout": str(employee_overtime_payout),
            # 'bonus_5_percent': str(bonus_5_percent),
            "employee_increase": str(emp_increase),
            "employee_decrease": str(emp_decrease),
            "extension_fee": str(extension_fee),
            "deferred_fee": str(deferred_fee),
            "log_extras": {
                **log_extras,
                "substitute_deduction_logs": substitute_deduction_logs,
            },
        }

    def _handle_security_deposit(self, contract, bill):
        """(最终版) 处理保证金的收退逻辑，采用“更新或创建”模式。"""
        current_app.logger.info(f"--- [DEPOSIT-HANDLER-V2] START for Bill ID: {bill.id} ---")

        if not contract.security_deposit_paid or contract.security_deposit_paid<= 0:
            current_app.logger.info(f"[DEPOSIT-HANDLER-V2] SKIPPING: Contract has no security_deposit_paid.")
            return

        # 【关键修复】统一使用纯 date 对象进行比较
        contract_start_date = self._to_date(contract.actual_onboarding_date or contract.start_date)
        bill_cycle_start_date = self._to_date(bill.cycle_start_date)
        is_first_bill = bill_cycle_start_date == contract_start_date

        if is_first_bill:
            # --- 这是首期账单，应该有“保证金”收款项 ---
            deposit_amount_due = contract.security_deposit_paid
            existing_deposit = FinancialAdjustment.query.filter(
                FinancialAdjustment.customer_bill_id == bill.id,
                FinancialAdjustment.description.like('[系统添加] 保证金%')
            ).first()

            if existing_deposit:
                if existing_deposit.amount != deposit_amount_due:
                    existing_deposit.amount = deposit_amount_due
            else:
                db.session.add(
                    FinancialAdjustment(
                        customer_bill_id=bill.id,
                        adjustment_type=AdjustmentType.CUSTOMER_INCREASE,
                        amount=deposit_amount_due,
                        description="[系统添加] 保证金",
                        date=bill.cycle_start_date,
                    )
                )
        else:
            # --- 这不是首期账单，不应该有“保证金”收款项 ---
            FinancialAdjustment.query.filter_by(
                customer_bill_id=bill.id,
                description='[系统添加] 保证金'
            ).delete(synchronize_session=False)

        # --- 处理末期账单退款的逻辑 ---
        # 【关键修复】统一使用纯 date 对象进行比较
        contract_end_date = self._to_date(contract.expected_offboarding_date or contract.end_date)
        bill_cycle_end_date = self._to_date(bill.cycle_end_date)
        is_auto_renew = getattr(contract, 'is_monthly_auto_renew', False)

        is_last_bill_period = False
        if contract_end_date and bill_cycle_end_date:
             is_last_bill_period = bill_cycle_end_date >= contract_end_date

        if is_last_bill_period and (not is_auto_renew or contract.status !='active'):
            exists = db.session.query(FinancialAdjustment.id).filter(
                FinancialAdjustment.customer_bill_id == bill.id,
                FinancialAdjustment.description.like('%保证金退款%')
            ).first()
            if not exists:
                db.session.add(
                    FinancialAdjustment(
                        customer_bill_id=bill.id,
                        adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
                        amount=contract.security_deposit_paid,
                        description="[系统添加] 保证金退款",
                        date=bill.cycle_end_date,
                    )
                )
        current_app.logger.info(f"--- [DEPOSIT-HANDLER-V2] END for Bill ID: {bill.id} ---")
    def _handle_introduction_fee(self, contract, bill):
        """处理介绍费的逻辑，采用“更新或创建”模式，确保幂等性。"""
        if not contract.introduction_fee or contract.introduction_fee <= 0:
            return

        # 介绍费只在第一个账单周期收取
        contract_start_date = self._to_date(contract.actual_onboarding_date or contract.start_date)
        bill_cycle_start_date = self._to_date(bill.cycle_start_date)
        is_first_bill = bill_cycle_start_date == contract_start_date

        if is_first_bill:
            # --- 核心修复：使用 like 查询，避免在转移后重复创建 ---
            # 检查是否存在任何以“[系统添加] 介绍费”开头的调整项
            existing_adj = FinancialAdjustment.query.filter(
                FinancialAdjustment.customer_bill_id == bill.id,
                FinancialAdjustment.description.like('[系统添加] 介绍费%')
            ).first()

            if not existing_adj:
                # 如果完全不存在，则创建新的
                db.session.add(
                    FinancialAdjustment(
                        customer_bill_id=bill.id,
                        adjustment_type=AdjustmentType.INTRODUCTION_FEE,
                        amount=contract.introduction_fee,
                        description="[系统添加] 介绍费",
                        date=bill.cycle_start_date,
                    )
                )
            # 如果已存在（即使是被转移过的），则什么也不做，保留其现有状态
    def calculate_for_substitute(self, substitute_record_id, commit=True, overrides=None):
        """为单条替班记录生成专属的客户账单和员工薪酬单。"""
        sub_record = db.session.get(SubstituteRecord, substitute_record_id)
        if not sub_record:
            current_app.logger.error(
                f"[SubCALC] 替班记录 {substitute_record_id} 未找到。"
            )
            return

        current_app.logger.info(f"[SubCALC] 开始为替班记录 {sub_record.id} 生成账单。")

        main_contract = sub_record.main_contract
        if not main_contract:
            current_app.logger.error(
                f"[SubCALC] 替班记录 {sub_record.id} 关联的主合同未找到。"
            )
            return

        year, month = sub_record.end_date.year, sub_record.end_date.month
        cycle_start, cycle_end = sub_record.start_date, sub_record.end_date

        bill = CustomerBill.query.filter_by(
            source_substitute_record_id=sub_record.id
        ).first()
        if not bill:
            bill = CustomerBill(
                contract_id=main_contract.id,
                year=year,
                month=month,
                cycle_start_date=cycle_start,
                cycle_end_date=cycle_end,
                customer_name=f"{main_contract.customer_name} (替班)",
                is_substitute_bill=True,
                total_due=D(0),
                source_substitute_record_id=sub_record.id,
            )
            db.session.add(bill)

        substitute_employee_id = (
            sub_record.substitute_user_id or sub_record.substitute_personnel_id
        )
        if not substitute_employee_id:
            raise ValueError(
                f"Substitute record {sub_record.id} has no associated employee."
            )

        payroll = EmployeePayroll.query.filter_by(
            source_substitute_record_id=sub_record.id
        ).first()
        if not payroll:
            payroll = EmployeePayroll(
                contract_id=main_contract.id,
                employee_id=substitute_employee_id,
                year=year,
                month=month,
                cycle_start_date=cycle_start,
                cycle_end_date=cycle_end,
                is_substitute_payroll=True,
                total_due=D(0),
                source_substitute_record_id=sub_record.id,
            )
            db.session.add(payroll)

        db.session.flush()
        sub_record.generated_bill_id = bill.id
        sub_record.generated_payroll_id = payroll.id

        details = self._calculate_substitute_details(sub_record, main_contract, bill, payroll, overrides)
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)
        current_app.logger.info(
            f"[SubCALC] 替班记录total_payable {bill.total_due} 的账单已成功生成。"
        )
        log = self._create_calculation_log(details)
        self._update_bill_with_log(bill, payroll, details, log)

        if commit:
            db.session.commit()
        current_app.logger.info(
            f"[SubCALC] 替班记录 {sub_record.id} 的账单已成功生成。"
        )

    def _calculate_substitute_details(self, sub_record, main_contract, bill, payroll, overrides=None):
        """计算替班记录的财务细节。"""
        if overrides is None:
            overrides = {}

        QUANTIZER = D("0.01")
        cust_increase, cust_decrease, emp_increase, emp_decrease, deferred_fee, emp_commission= (
            self._get_adjustments(bill.id, payroll.id)
        )
        # --- 核心修复：优先使用传入的覆盖值 ---
        if overrides.get('actual_work_days') is not None:
            substitute_days = D(overrides['actual_work_days'])
            bill.actual_work_days = substitute_days # 持久化这个手动输入的值
        else:
            time_difference = sub_record.end_date - sub_record.start_date
            precise_substitute_days = D(time_difference.total_seconds()) / D(86400)
            substitute_days = precise_substitute_days.quantize(D('0.01'))

        if overrides.get('overtime_days') is not None:
            overtime_days = D(overrides['overtime_days'])
            # 替班记录本身没有考勤表，所以直接更新替班记录上的加班天数
            sub_record.overtime_days = overtime_days
        else:
            overtime_days = D(sub_record.overtime_days or 0)
        # --- 修复结束 ---

        substitute_level = D(sub_record.substitute_salary)
        substitute_type = sub_record.substitute_type

        details = {
            "type": "substitute",
            "substitute_type": substitute_type,
            "main_contract_id": str(main_contract.id),
            "main_contract_type": main_contract.type,
            "substitute_record_id": str(sub_record.id),
            "substitute_user_id": str(
                sub_record.substitute_user_id or sub_record.substitute_personnel_id
            ),
            "cycle_period": f"{sub_record.start_date.isoformat()} to {sub_record.end_date.isoformat()}",
            "base_work_days": str(substitute_days),
            "overtime_days": str(overtime_days),
            "total_days_worked": str(substitute_days + overtime_days),
            "customer_increase": str(cust_increase),
            "customer_decrease": str(cust_decrease),
            "employee_increase": str(emp_increase),
            "employee_decrease": str(emp_decrease),
            "discount": "0.00",
            "first_month_deduction": "0.00",
            "log_extras": {},
            "level": str(substitute_level),
        }

        overtime_daily_rate = substitute_level / D(26)
        overtime_fee = (overtime_daily_rate * overtime_days).quantize(QUANTIZER)
        details["customer_overtime_fee"] = str(overtime_fee)
        details["employee_overtime_payout"] = str(overtime_fee)
        details["log_extras"]["overtime_reason"] = (
            f"替班加班费: 替班级别({substitute_level:.2f})/26 * 加班天数({overtime_days:.2f})"
        )

        if substitute_type == "maternity_nurse":
            management_fee_rate = D(sub_record.substitute_management_fee)
            customer_daily_rate = (
                substitute_level * (D(1) - management_fee_rate) / D(26)
            )
            customer_base_fee = (customer_daily_rate * substitute_days).quantize(
                QUANTIZER
            )
            employee_daily_rate = (
                substitute_level * (D(1) - management_fee_rate) / D(26)
            )
            employee_base_payout = (employee_daily_rate * substitute_days).quantize(
                QUANTIZER
            )
            management_fee = (
                substitute_level * management_fee_rate / D(26) * substitute_days
            ).quantize(QUANTIZER)
            details["log_extras"]["management_fee_reason"] = (
                f"替班管理费: 替班级别({substitute_level:.2f}) * 管理费率({management_fee_rate*100}%) / 26 * 替班天数({substitute_days:.2f}) = {management_fee:.2f}"
            )
            details.update(
                {
                    "daily_rate": str(customer_daily_rate.quantize(QUANTIZER)),
                    "employee_daily_rate": str(employee_daily_rate.quantize(QUANTIZER)),
                    "management_fee_rate": str(management_fee_rate),
                    "customer_base_fee": str(customer_base_fee),
                    "management_fee": str(management_fee),
                    "employee_base_payout": str(employee_base_payout),
                }
            )
            details["log_extras"]["customer_fee_reason"] = (
                f"月嫂替班客户费用: 替班级别({substitute_level:.2f})*(1-{management_fee_rate*100}%)/26 * 替班天数({substitute_days:.2f})= {customer_base_fee:.2f}"
            )
            details["log_extras"]["employee_payout_reason"] = (
                f"月嫂替班员工工资: 替班级别({substitute_level:.2f})*(1-{management_fee_rate*100}%)/26 * 替班天数({substitute_days:.2f})= {employee_base_payout:.2f}"
            )

        elif substitute_type == "nanny":
            management_fee_rate = D(0)
            management_fee = D(0)
            daily_rate = substitute_level / D(26)
            base_fee = (daily_rate * substitute_days).quantize(QUANTIZER)
            customer_base_fee = base_fee
            employee_base_payout = base_fee

            details.update(
                {
                    "daily_rate": str(daily_rate.quantize(QUANTIZER)),
                    "employee_daily_rate": str(daily_rate.quantize(QUANTIZER)),
                    "management_fee_rate": str(management_fee_rate),
                    "customer_base_fee": str(customer_base_fee),
                    "management_fee": str(management_fee),
                    "employee_base_payout": str(employee_base_payout),
                }
            )
            details["log_extras"]["customer_fee_reason"] = (
                f"育儿嫂替班客户费用: 替班级别({substitute_level:.2f})/26 * 替班天数({substitute_days:.2f}) = {customer_base_fee:.2f}"
            )
            details["log_extras"]["employee_payout_reason"] = (
                f"育儿嫂替班员工工资: 替班级别({substitute_level:.2f})/26 * 替班天数({substitute_days:.2f}) = {employee_base_payout:.2f}"
            )

        return details
    
    
    def _calculate_external_substitution_details(self, contract, bill, payroll):
        """计算外部替班合同的所有财务细节(最终修正版)。"""
        current_app.logger.info(f"[DEBUG] Entering _calculate_external_substitution_details for bill {bill.id}")

        self._handle_security_deposit(contract, bill)
        
        QUANTIZER = D("0.01")
        level = D(contract.employee_level or 0)
        management_fee_rate = D(contract.management_fee_rate or 0.20)

        # --- 关键修复：在这里定义清晰的日期变量 ---
        # 1. bill_end_date 是当前账单的结束日期，这应该是最新的、可能已延长过的日期
        bill_end_date = self._to_date(bill.cycle_end_date)

        # 2. original_contract_end_date 是合同上最初的、不变的结束日期。这是我们比较的基准。
        original_contract_end_date = self._to_date(contract.end_date)

        # 3. start_date 保持不变
        start_date = self._to_date(bill.cycle_start_date)
        # --- 修复结束 ---

        if not start_date or not bill_end_date or not original_contract_end_date:
            raise ValueError("外部替班合同的起止日期不完整，无法计算。")

        time_difference = bill_end_date - start_date
        # time_difference = bill.cycle_end_date - bill.cycle_start_date
        service_days = D(time_difference.total_seconds()) / D(86400)
        # service_days = self._calculate_service_duration_days(bill.cycle_start_date, bill.cycle_end_date) # 使用我们之前创建的辅助函数

        daily_rate = (level / D(26)).quantize(QUANTIZER)
        customer_payable = (daily_rate * service_days).quantize(QUANTIZER)
        employee_payout = customer_payable
        
        # --- 核心修正：统一按天计算管理费 ---
        log_extras = {} # 先初始化
        if contract.management_fee_amount is not None and contract.management_fee_amount > 0:
            # 如果合同有固定的月管理费，则按天折算
            monthly_fee = D(contract.management_fee_amount)
            daily_fee = (monthly_fee / D(30)).quantize(D("0.0001")) # 保留多位小数以提高精度
            management_fee = (daily_fee * service_days).quantize(QUANTIZER)
            log_extras["management_fee_reason"] = f"按天折算: 月管理费({monthly_fee:.2f}) / 30天 *服务天数({service_days:.2f}) = {management_fee:.2f}"
        else:
            # 否则，按费率计算
            management_fee = (daily_rate * service_days * management_fee_rate).quantize(QUANTIZER)
            log_extras["management_fee_reason"] = f"按费率计算: 日薪({daily_rate:.2f}) * 服务天数({service_days:.2f}) * 费率({management_fee_rate:.2%}) = {management_fee:.2f}"

        # 其他日志信息
        log_extras["service_days_reason"] = f"服务总时长 {time_difference} = {service_days:.2f} 天"
        log_extras["customer_payable_reason"] = f"客户应付: 日薪({daily_rate:.2f}) * 服务天数({service_days:.2f}) = {customer_payable:.2f}"
        log_extras["employee_payout_reason"] = f"员工工资: 等同于客户应付金额 = {employee_payout:.2f}"
        # --- 修正结束 ---
        
        extension_fee = D(0)
        # --- 关键修复：使用正确的日期进行比较 ---
        if bill_end_date > original_contract_end_date:
            # 延长天数 = 新的账单结束日 - 旧的合同结束日
            extension_days = (bill_end_date - original_contract_end_date).days
            current_app.logger.info(f"[DEBUG] Extension detected: {extension_days} days")
            if extension_days > 0:
                extension_fee = (daily_rate * D(extension_days)).quantize(D('0.01'))
                extension_management_fee = (daily_rate * D(extension_days) * management_fee_rate).quantize(D('0.01'))

                # --- 关键修改：不要在原字典上修改，而是创建一个新的 ---
                new_log_extras = log_extras.copy()

                # 1. 添加延期劳务费的日志
                new_log_extras["extension_fee_reason"] = f"延期劳务费: 日薪({daily_rate:.2f}) * 延长天数({extension_days}) = {extension_fee:.2f}"

                # 2. 构建全新的管理费日志
                base_management_reason = log_extras.get("management_fee_reason", "") # 从旧字典里安全地读出基础日志
                extension_management_reason = f" + 延期管理费: 日薪({daily_rate:.2f}) * {extension_days}天 * 费率({management_fee_rate:.2%}) = {extension_management_fee:.2f}"
                new_log_extras["management_fee_reason"] = base_management_reason + extension_management_reason

                # 3. 把原来的 log_extras 整个换掉
                log_extras = new_log_extras
                # --- 修改结束 ---

                
                
                

                # 更新总的管理费
                management_fee +=extension_management_fee
                # employee_payout += extension_fee
                current_app.logger.info(f"[DEBUG] Calculated extension fee: {extension_fee}, new total payable: {customer_payable}")

        return {
            "type": "external_substitution", "level": str(level),
            "cycle_period": f"{start_date.isoformat()} to {bill_end_date.isoformat()}",
            "base_work_days": f"{service_days:.2f}", "management_fee_rate": str(management_fee_rate),
            "customer_base_fee": str(customer_payable), "management_fee": str(management_fee),
            "employee_base_payout": str(employee_payout), "overtime_days":"0.00",
            "total_days_worked": f"{service_days:.2f}", "substitute_days":"0.00",
            "substitute_deduction": "0.00", "extension_fee": str(extension_fee),"customer_overtime_fee": "0.00",
            "customer_increase": "0.00", "customer_decrease": "0.00", "discount": "0.00",
            "employee_overtime_payout": "0.00", "employee_increase": "0.00","employee_decrease": "0.00",
            "deferred_fee": "0.00", "log_extras": log_extras,
        }

    def _get_or_create_bill_and_payroll(
        self, contract, year, month, cycle_start_date, cycle_end_date
    ):
        # 1. 首先尝试查询，这是最高效且最常见的路径
        bill = CustomerBill.query.filter_by(
            contract_id=contract.id,
            cycle_start_date=cycle_start_date,
            is_substitute_bill=False,
        ).first()
        payroll = EmployeePayroll.query.filter_by(
            contract_id=contract.id,
            cycle_start_date=cycle_start_date,
            is_substitute_payroll=False,
        ).first()

        # 2. 如果成功找到，则更新并返回
        if bill and payroll:
            bill.year = year
            bill.month = month
            bill.cycle_end_date = cycle_end_date
            payroll.year = year
            payroll.month = month
            payroll.cycle_end_date = cycle_end_date
            return bill, payroll

        # 3. 如果没找到，则进入创建流程，并用 try/except 块来处理并发竞争
        current_app.logger.info(
            f"    [BILL CREATE] No existing bill/payroll found for cycle {cycle_start_date}. Attempting to create."
        )
        try:
            employee_id = contract.user_id or contract.service_personnel_id
            if not employee_id:
                raise ValueError(f"Contract {contract.id} has no associated employee.")

            bill = CustomerBill(
                contract_id=contract.id,
                year=year,
                month=month,
                cycle_start_date=cycle_start_date,
                cycle_end_date=cycle_end_date,
                customer_name=contract.customer_name,
                total_due=D(0),  # 明确提供默认值
                is_substitute_bill=False,
            )
            db.session.add(bill)

            payroll = EmployeePayroll(
                contract_id=contract.id,
                year=year,
                month=month,
                cycle_start_date=cycle_start_date,
                cycle_end_date=cycle_end_date,
                employee_id=employee_id,
                total_due=D(0),  # 明确提供默认值
                is_substitute_payroll=False,
            )
            db.session.add(payroll)

            # 立即 flush 以便在当前事务中捕获错误，但不 commit
            db.session.flush()
            current_app.logger.info(
                f"    [BILL CREATE] Successfully created new bill and payroll for cycle {cycle_start_date}."
            )
            return bill, payroll

        except IntegrityError:
            # 4. 如果在创建时发生唯一性冲突，则回滚并重新查询
            db.session.rollback()
            current_app.logger.warning(
                f"    [BILL CREATE] Race condition detected for cycle {cycle_start_date}. Re-querying."
            )

            bill = CustomerBill.query.filter_by(
                contract_id=contract.id,
                cycle_start_date=cycle_start_date,
                is_substitute_bill=False,
            ).first()  # 使用 .first() 避免 NoResultFound 异常
            payroll = EmployeePayroll.query.filter_by(
                contract_id=contract.id,
                cycle_start_date=cycle_start_date,
                is_substitute_payroll=False,
            ).first()

            # 如果在重新查询后仍然找不到，说明发生了更复杂的事务问题，此时应抛出异常
            if not bill or not payroll:
                current_app.logger.error(
                    f"    [BILL CREATE] CRITICAL: Race condition for {cycle_start_date} led to missing record after rollback. "
                    f"This may indicate a deadlock or a larger transactional issue."
                )
                raise Exception(
                    f"Failed to get or create bill for cycle {cycle_start_date} after race condition."
                )

            # 更新刚刚获取到的记录
            bill.year = year
            bill.month = month
            bill.cycle_end_date = cycle_end_date
            payroll.year = year
            payroll.month = month
            payroll.cycle_end_date = cycle_end_date

            return bill, payroll

    def _get_or_create_attendance(self, contract, cycle_start_date, cycle_end_date):
        attendance = AttendanceRecord.query.filter_by(
            contract_id=contract.id, cycle_start_date=cycle_start_date
        ).first()
        if not attendance:
            employee_id = contract.user_id or contract.service_personnel_id
            if not employee_id:
                raise ValueError(f"Contract {contract.id} has no associated employee.")

            default_work_days = 0
            if contract.type == "maternity_nurse":
                default_work_days = 26
            elif contract.type == "nanny":
                default_work_days = min((cycle_end_date - cycle_start_date).days, 26)

            attendance = AttendanceRecord(
                employee_id=employee_id,
                contract_id=contract.id,
                cycle_start_date=cycle_start_date,
                cycle_end_date=cycle_end_date,
                total_days_worked=default_work_days,
                overtime_days=0,
                statutory_holiday_days=0,
            )
            db.session.add(attendance)
            db.session.flush()
        return attendance

    def _get_adjustments(self, bill_id, payroll_id):
        customer_adjustments = FinancialAdjustment.query.filter_by(
            customer_bill_id=bill_id
        ).all()
        employee_adjustments = FinancialAdjustment.query.filter_by(
            employee_payroll_id=payroll_id
        ).all()

        cust_increase = sum(
            adj.amount
            for adj in customer_adjustments
            if adj.adjustment_type in [
                AdjustmentType.CUSTOMER_INCREASE,
                AdjustmentType.INTRODUCTION_FEE,
                AdjustmentType.COMPANY_PAID_SALARY,
            ]
        )
        cust_decrease = sum(
            adj.amount
            for adj in customer_adjustments
            if adj.adjustment_type == AdjustmentType.CUSTOMER_DECREASE
        )
        deferred_fee = sum(
            adj.amount
            for adj in customer_adjustments
            if adj.adjustment_type == AdjustmentType.DEFERRED_FEE
        )

        emp_increase = sum(
            adj.amount
            for adj in employee_adjustments
            if adj.adjustment_type in [
                AdjustmentType.EMPLOYEE_INCREASE,
                AdjustmentType.EMPLOYEE_CLIENT_PAYMENT, # <-- 把“客户支付给员工的费用”也算作增款,一般是从试工合同中转过来的试工劳务费
                AdjustmentType.EMPLOYEE_COMMISSION_OFFSET # <-- 把“佣金冲账”也算作增款
            ]
        )
        # --- 这是修改点：分别计算 DECREASE 和 COMMISSION ---
        emp_decrease = sum(
            adj.amount
            for adj in employee_adjustments
            if adj.adjustment_type == AdjustmentType.EMPLOYEE_DECREASE
        )
        emp_commission = sum(
            adj.amount
            for adj in employee_adjustments
            if adj.adjustment_type == AdjustmentType.EMPLOYEE_COMMISSION
        )
        # --- 修改结束 ---

        # --- 修改返回值，增加 emp_commission ---
        return cust_increase, cust_decrease, emp_increase, emp_decrease,deferred_fee, emp_commission

    def _calculate_final_amounts(self, bill, payroll, details):
        current_app.logger.info("开始进行final calculation of amounts.")
        # ---客户应付总额计算("仅包含客户付给公司的费用，不含客户付给员工的费用。")
        total_due = (
            D(details.get("management_fee", 0))
            # + D(details.get("customer_overtime_fee", 0))
            # + D(details.get("customer_base_fee", 0))
            + D(details.get("introduction_fee", 0))
            + D(details.get("customer_increase", 0))
            # + D(details.get("extension_fee", "0.00"))
            + D(details.get("deferred_fee", "0.00"))
            + D(details.get("extension_fee_reason", "0.00"))
            - D(details.get("customer_decrease", 0))
            - D(details.get("discount", 0))
            # - D(details.get("substitute_deduction", 0))
        )
        # --- 员工应付总额计算 (核心修改点) ---
        # Gross Pay = Base + Overtime + Increase
        employee_gross_payout = (
            D(details.get("employee_base_payout", 0))
            + D(details.get("employee_overtime_payout", 0))
            + D(details.get("extension_fee", 0))
            + D(details.get("employee_increase", 0))
            - D(details.get("substitute_deduction", 0))
            - D(details.get("employee_decrease", 0))
        )

        # Net Pay = Gross Pay - Deductions
        # 注意：这里的 employee_decrease 仍然是需要扣除的，比如住宿费等
        employee_net_payout = (
            employee_gross_payout
            - D(details.get("employee_commission", 0)) # 佣金在计算实发金额时扣除
        )
        # 我们在 details 中同时记录 gross 和 net，方便日志和未来扩展
        # 1. 先用新计算出的正确金额更新账单和薪酬单对象
        bill.total_due = total_due.quantize(D("1"))
        payroll.total_due = employee_gross_payout.quantize(D("1"))

        # 2. 然后，再用刚刚更新过的、正确的值去填充用于日志的 details 字典
        details["total_due"] = str(bill.total_due)
        details["final_payout"] = str(payroll.total_due)
        details["final_payout_gross"] = str(payroll.total_due)
        details["final_payout_net"] = str(employee_net_payout.quantize(D("0.01")))
       
        return bill, payroll

    def _create_calculation_log(self, details):
        """根据计算详情字典，生成人类可读的计算过程日志。"""
        log = {}
        d = {}
        # 【关键修正】使用 try-except 来正确处理包括负数在内的所有数字字符串
        for k, v in details.items():
            if isinstance(v, str):
                try:
                    d[k] = D(v)
                except (decimal.InvalidOperation, TypeError):
                    continue
        log_extras = details.get("log_extras", {})
        calc_type = details.get("type")

        if calc_type == "substitute":
            log["账单类型"] = "替班账单"

        base_work_days = d.get("base_work_days", 0)
        overtime_days = d.get("overtime_days", 0)
        level = d.get("level", 0)

        if calc_type == "substitute":
            log["基础劳务费"] = log_extras.get("customer_fee_reason", "N/A")
            log["员工工资"] = log_extras.get("employee_payout_reason", "N/A")
            if overtime_days > 0:
                log["加班费"] = log_extras.get("overtime_reason", "N/A")
            if details.get("substitute_type") == "maternity_nurse":
                log["管理费"] = log_extras.get("management_fee_reason", "N/A")
            else:
                log["管理费"] = "0.00 (育儿嫂替班不收取管理费)"
        else:
            # Main contract types
            customer_daily_rate_formula = f"级别({level:.2f})/26"
            if calc_type == "nanny":
                employee_daily_rate_formula = f"级别({level:.2f}) / 26"
                log["基础劳务费"] = (
                    f"{employee_daily_rate_formula} * 基本劳务天数({base_work_days:.2f}) = {d.get('employee_base_payout', 0):.2f}"
                )
                log["加班费"] = (
                    f"{employee_daily_rate_formula} * 加班天数({overtime_days:.2f}) = {d.get('employee_overtime_payout', 0):.2f}"
                )
                log["客户侧加班费"] = (
                    f"{customer_daily_rate_formula} * 加班天数({overtime_days:.2f}) = {d.get('customer_overtime_fee', 0):.2f}"
                )
                log["本次交管理费"] = log_extras.get("management_fee_reason", "N/A")
                if "refund_amount" in log_extras:
                    log["本次交管理费"] += f" | 末月退还: {log_extras['refund_amount']}"
                # if d.get("first_month_deduction", 0) > 0:
                #     log["首月员工10%费用"] = log_extras.get(
                #         "first_month_deduction_reason", "N/A"
                #     )
                # 不论是否有首月返佣的费用，都要记录日志
                log["首月员工10%费用"] = log_extras.get(
                        "first_month_deduction_reason", "N/A"
                    )
            else:  # maternity_nurse & nanny_trial
                employee_daily_rate_formula = customer_daily_rate_formula
                log["基础劳务费"] = (
                    f"{customer_daily_rate_formula} * 基本劳务天数({base_work_days:.2f}) = {d.get('customer_base_fee', 0):.2f}"
                )
                if overtime_days > 0:
                    log["加班费"] = (
                        f"({log_extras.get('customer_overtime_daily_rate_reason', '客户加班日薪')}) * 加班天数({overtime_days:.2f}) = {d.get('customer_overtime_fee', 0):.2f}"
                    )
                if calc_type == "maternity_nurse":
                    log["管理费"] = log_extras.get("management_fee_reason", "N/A")
                    log["管理费率"] = log_extras.get(
                        "management_fee_rate_reason", "N/A"
                    )
                    log["基础劳务费"] = (
                        f"({log_extras.get('employee_daily_rate_reason', '员工日薪')}) * 基本劳务天数({base_work_days:.2f}) = {d.get('customer_base_fee', 0):.2f}"
                    )
                    log["加班费"] = (
                        f"({log_extras.get('customer_overtime_daily_rate_reason', '客户加班日薪')}) * 加班天数({overtime_days:.2f}) = {d.get('customer_overtime_fee', 0):.2f}"
                    )
                    log["萌嫂保证金(工资)"] = (
                        f"({log_extras.get('employee_daily_rate_reason', '员工日薪')}) * 基本劳务天数({base_work_days:.2f}) = {d.get('employee_base_payout', 0):.2f}"
                    )
                if calc_type == "nanny_trial_termination":
                    log["基础劳务费"] = (
                        f"员工日薪({level:.2f}) * 基本劳务天数({base_work_days:.2f}) = {d.get('customer_base_fee', 0):.2f}"
                    )
                    log["管理费"] = log_extras.get("management_fee_reason", "N/A")
                if calc_type == "nanny_trial" > 0:
                    log["首月员工10%费用"] = log_extras.get(
                        "first_month_deduction_reason", "N/A"
                    )

            if d.get("substitute_deduction", 0) > 0 and calc_type != "maternity_nurse":
                log_details_list = details.get("substitute_deduction_logs", [])
                if log_details_list:
                    log["被替班扣款"] = " + ".join(log_details_list)
                else:
                    log["被替班扣款"] = (
                        f"从替班账单的基础劳务费中扣除 = {d.get('substitute_deduction', 0):.2f}"
                    )
        # 简化日志，只显示非零内容
        # --- 客户应付款日志 ---
        customer_parts = []
       
        if d.get("management_fee"):
            customer_parts.append(f"管理费({d['management_fee']:.2f})")
        if d.get("customer_increase"):
            customer_parts.append(f"增款({d['customer_increase']:.2f})")
        if d.get("deferred_fee"):
            customer_parts.append(f"上期顺延({d['deferred_fee']:.2f})")

        # 处理减项
        if d.get("discount"):
            customer_parts.append(f"- 优惠({d['discount']:.2f})")
        # if d.get("substitute_deduction"):
        #     customer_parts.append(f"- 被替班扣款({d['substitute_deduction']:.2f})")
        if d.get("customer_decrease"):
            customer_parts.append(f"- 减款({d['customer_decrease']:.2f})")

        log["客应付款"] = " + ".join(customer_parts).replace("+ -", "-") + f" = {d.get('total_due', 0):.2f}"

        # ------------------- 以下是核心修改 -------------------
        # --- 员工应领款日志 (V2 - Gross & Net) ---

        # 1. 应发总额 (Gross Pay)
        gross_parts = []
        if d.get("employee_base_payout"):
            gross_parts.append(f"基础工资({d['employee_base_payout']:.2f})")
        if d.get("extension_fee"):
            gross_parts.append(f"+ 延长期服务费({d['extension_fee']:.2f})")
        if d.get("employee_overtime_payout"):
            gross_parts.append(f"+ 加班工资({d['employee_overtime_payout']:.2f})")
        if d.get("employee_increase"):
            gross_parts.append(f"+ 增款({d['employee_increase']:.2f})")
        if d.get("substitute_deduction"):
            gross_parts.append(f"- 被替班扣款({d['substitute_deduction']:.2f})")
        if d.get("employee_decrease"):
            gross_parts.append(f"- 其他减款({d['employee_decrease']:.2f})")

        # 使用来自 _calculate_final_amounts 的新 key
        log["萌嫂应领款"] = "".join(gross_parts) + f" = {d.get('final_payout_gross', 0):.2f}"

        # 2. 实发总额 (Net Pay)
        net_parts = [f"应发总额({d.get('final_payout_gross', 0):.2f})"]

        # 使用来自 _calculate_nanny_details 的新 key
        if d.get("employee_commission"):
            net_parts.append(f"- 佣金({d['employee_commission']:.2f})")

        # 使用来自 _calculate_final_amounts 的新 key
        log["员工实发总额(Net)"] = " ".join(net_parts).replace("  -", " -") +f" = {d.get('final_payout_net', 0):.2f}"

        # 删除旧的日志条目
        # if "萌嫂应领款" in log:
        #     del log["萌嫂应领款"]
        # ------------------- 修改结束 -------------------

        return log

    def _update_bill_with_log(self, bill, payroll, details, log):
        details["calculation_log"] = log
        current_app.logger.info(f"[SAVE-CHECK] Bill ID {bill.id}: log_extras to be saved: {details.get('log_extras')}")
        bill.calculation_details = details
        payroll.calculation_details = details.copy()

        attributes.flag_modified(bill, "calculation_details")
        attributes.flag_modified(payroll, "calculation_details")

        db.session.add(bill)
        db.session.add(payroll)

        return bill, payroll

    def _calculate_nanny_trial_termination_details(self, contract,actual_trial_days, bill, payroll):
        """为试工失败结算生成详细的计算字典 (v16 - FINAL with Overtime)。"""
        QUANTIZER = D("0.01")
        level = D(contract.employee_level or 0)
        days = D(actual_trial_days)

        # 核心修正：试工合同的 level 即为日薪，无需除以26
        daily_rate = level.quantize(QUANTIZER)

        # 试工合同月薪,用来准确算出日管理费
        monthly_rate = daily_rate * 26

        # 获取考勤，计算加班
        attendance = self._get_or_create_attendance(contract,contract.start_date, contract.end_date)
        overtime_days = D(attendance.overtime_days)
        overtime_fee = (daily_rate * overtime_days).quantize(QUANTIZER)

        # 统一计算基础劳务费和管理费
        base_fee = (daily_rate * days).quantize(QUANTIZER)
        management_fee = (monthly_rate* D('0.2') / 30 *(days)).quantize(QUANTIZER)

        current_app.logger.info(f"[TrialTerm-v14] 计算试工合同 {contract.id} 结算细节: 级别 {level}, 日薪 {daily_rate}, 试工天数 {days}, 加班天数 {overtime_days}, 基础费 {base_fee}, 加班费 {overtime_fee}, 管理费 {management_fee}")
        # --- 【核心修复】调用 _get_adjustments 来加载实际的财务调整项 ---
        cust_increase, cust_decrease, emp_increase, emp_decrease, deferred_fee, emp_commission = (
            self._get_adjustments(bill.id, payroll.id)
        )
        # --- 修复结束 ---
        details = {
            "type": "nanny_trial_termination",
            "level": str(level),
            "cycle_period": f"{contract.start_date.isoformat()} to {contract.end_date.isoformat()}",
            "base_work_days": str(days),
            "overtime_days": str(overtime_days),
            "total_days_worked": str(days + overtime_days),
            "daily_rate": str(daily_rate),

            "customer_base_fee": str(base_fee),
            "employee_base_payout": str(base_fee),
            "customer_overtime_fee": str(overtime_fee),
            "employee_overtime_payout": str(overtime_fee),

            "management_fee": str(management_fee),

            "introduction_fee": str(contract.introduction_fee or "0.00"),
            "notes": contract.notes or "",

            # --- 【核心修复】使用加载到的真实数据，而不是硬编码的0 ---
            "customer_increase": str(cust_increase),
            "customer_decrease": str(cust_decrease),
            "employee_increase": str(emp_increase),
            "employee_decrease": str(emp_decrease),
            "employee_commission": str(emp_commission),
            # --- 修复结束 ---
            
            "first_month_deduction": "0.00",
            "discount": "0.00",
            "substitute_deduction": "0.00",

            "log_extras": {
                "management_fee_reason": f"月薪({level*26})/30天 * 20% * 试工天数({days}) = {management_fee:.2f}",
                "employee_payout_reason": f"日薪({daily_rate}) * 试工天数({days}) = {base_fee:.2f}",
                "overtime_fee_reason": f"日薪({daily_rate}) * 加班天数({overtime_days}) = {overtime_fee:.2f}"
            },
        }
        return details
    
    def process_trial_termination(self, contract, actual_trial_days):
        """
        处理育儿嫂试工失败的最终结算 (v14 - Simplified Logic)。
        """
        current_app.logger.info(f"[TrialTerm-v14] 开始处理试工合同 {contract.id}，实际天数: {actual_trial_days}")

        with db.session.begin_nested(): 
            # 1. 创建或获取账单/薪酬单
            term_date = contract.start_date + timedelta(days=actual_trial_days)
            bill, payroll = self._get_or_create_bill_and_payroll(
                contract, term_date.year, term_date.month, contract.start_date, term_date
            )
            # 2. 获取包含所有基础组件的 details 字典
            details = self._calculate_nanny_trial_termination_details(contract, actual_trial_days, bill, payroll)

            # 3. 根据业务场景，动态修改 details 字典
            has_intro_fee = D(details['introduction_fee']) > 0

            if has_intro_fee:
                # 情况一: 有介绍费 -> 不收管理费
                details['management_fee'] = "0.00"
                details['log_extras']['management_fee_reason'] = "已有介绍费,试工不收取管理费"
            else:
                # 情况二: 没有介绍费 -> 正常收取管理费 (details中已包含)
                pass

            # 4. 将 details 传递给标准流程进行最终计算和保存
            bill, payroll = self._calculate_final_amounts(bill, payroll, details)
            log = self._create_calculation_log(details)
            self._update_bill_with_log(bill, payroll, details, log)

        current_app.logger.info(f"[TrialTerm-v14] 合同 {contract.id} 结算处理完成。")

    # v5.5 设计方案的核心实现
    def calculate_invoice_balance(self, target_bill_id: str):
        """
        计算指定账单的发票余额详情 (v5.10 - 隔离替班账单的欠票逻辑)。

        Args:
            target_bill_id: 目标客户账单的ID。

        Returns:
            一个包含详细发票余额信息的字典。
        """
        target_bill = db.session.get(CustomerBill, target_bill_id)
        if not target_bill:
            return { "error": "Target bill not found", "invoice_records": [], "carried_forward_breakdown": [] }

        # --- 【核心修正】: 如果是替班账单，则独立计算，不继承历史欠票 ---
        if target_bill.is_substitute_bill:
            # 替班账单的管理费就是它的应开票总额
            current_management_fee = D((target_bill.calculation_details or {}).get('management_fee', '0'))
            invoiced_this_period = sum((D(invoice.amount) for invoice in target_bill.invoices), D(0)).quantize(D("0.01"))

            total_invoiceable_amount = current_management_fee if target_bill.invoice_needed else D(0)
            remaining_un_invoiced = (total_invoiceable_amount - invoiced_this_period).quantize(D("0.01"))

            return {
                "current_period_charges": str(current_management_fee),
                "total_carried_forward": "0.00",  # 替班账单永远没有历史欠票
                "total_invoiceable_amount": str(total_invoiceable_amount),
                "invoiced_this_period": str(invoiced_this_period),
                "remaining_un_invoiced": str(remaining_un_invoiced),
                "invoice_records": [inv.to_dict() for inv in target_bill.invoices],
                "carried_forward_breakdown": [], # 历史欠票明细为空
                "auto_invoice_needed": target_bill.invoice_needed, # 只取决于它自己
            }
        # --- 修正结束 ---

        # --- 以下是主账单的正常逻辑 ---
        current_management_fee = D((target_bill.calculation_details or {}).get('management_fee', '0'))
        current_management_fee = current_management_fee.quantize(D("1"))

        historical_bills = (
            CustomerBill.query.filter(
                CustomerBill.contract_id == target_bill.contract_id,
                CustomerBill.cycle_start_date < target_bill.cycle_start_date,
                CustomerBill.is_substitute_bill.is_(False),
            )
            .options(db.selectinload(CustomerBill.invoices))
            .order_by(CustomerBill.cycle_start_date)
            .all()
        )

        total_historical_fees_due = D(0)
        total_historical_invoiced = D(0)
        for bill in historical_bills:
            if bill.invoice_needed:
                total_historical_fees_due += D((bill.calculation_details or {}).get('management_fee', '0'))
                total_historical_invoiced += sum((D(invoice.amount) for invoice in bill.invoices), D(0))

        total_carried_forward = total_historical_fees_due - total_historical_invoiced
        if total_carried_forward < 0:
            total_carried_forward = D(0)
        total_carried_forward = total_carried_forward.quantize(D("0.01"))

        carried_forward_breakdown = []
        if total_carried_forward > 0:
            for bill in historical_bills:
                if bill.invoice_needed:
                    historical_management_fee = D((bill.calculation_details or {}).get('management_fee', '0'))
                    invoiced_amount_for_bill = sum((D(invoice.amount) for invoice in bill.invoices), D(0))
                    unpaid_balance = historical_management_fee - invoiced_amount_for_bill
                    if unpaid_balance > 0:
                        carried_forward_breakdown.append({
                            "month": f"{bill.year}-{str(bill.month).zfill(2)}",
                            "unpaid_amount": str(unpaid_balance.quantize(D("0.01"))),
                        })

        invoiced_this_period = sum((D(invoice.amount) for invoice in target_bill.invoices), D(0)).quantize(D("0.01"))
        should_be_needed = target_bill.invoice_needed or (total_carried_forward > 0)

        if should_be_needed:
            # 本月应开票（含历史欠票）
            # total_invoiceable_amount = (current_management_fee + total_carried_forward).quantize(D("0.01"))
            # 不含历史欠票
            total_invoiceable_amount = current_management_fee.quantize(D("1"))
        else:
            total_invoiceable_amount = D(0)

        remaining_un_invoiced = (total_carried_forward + total_invoiceable_amount).quantize(D("0.01"))
        invoice_records_data = [inv.to_dict() for inv in target_bill.invoices]

        return {
            "current_period_charges": str(current_management_fee),
            "total_carried_forward": str(total_carried_forward),
            "total_invoiceable_amount": str(total_invoiceable_amount),
            "invoiced_this_period": str(invoiced_this_period),
            "remaining_un_invoiced": str(remaining_un_invoiced),
            "invoice_records": invoice_records_data,
            "carried_forward_breakdown": carried_forward_breakdown,
            "auto_invoice_needed": should_be_needed,
        }
    
    def propagate_invoice_needed_status(self, bill_id: str):
        """
        检查指定账单是否有未结清的发票欠款，
        如果有，则自动将下一个月账单的 invoice_needed 状态设为 True。
        """
        current_bill = db.session.get(CustomerBill, bill_id)
        if not current_bill:
            return

        # 1. 重新计算当前账单的余额
        balance_info = self.calculate_invoice_balance(bill_id)
        remaining_amount = balance_info.get("remaining_un_invoiced", D(0))

        # 2. 检查是否需要传递状态
        # 条件：当前账单需要开票，且有剩余未开金额
        if (current_bill.payment_details or {}).get("invoice_needed") and remaining_amount > 0:

            # 3. 找到下一个月的账单
            next_bill = CustomerBill.query.filter(
                CustomerBill.contract_id == current_bill.contract_id,
                CustomerBill.cycle_start_date > current_bill.cycle_start_date,
                CustomerBill.is_substitute_bill.is_(False)
            ).order_by(CustomerBill.cycle_start_date.asc()).first()

            if next_bill:
                # 4. 如果找到了，并且它当前是“无需开票”状态，则自动打开它的开关
                if not (next_bill.payment_details or {}).get("invoice_needed"):
                    if next_bill.payment_details is None:
                        next_bill.payment_details = {}

                    next_bill.payment_details["invoice_needed"] = True
                    # 标记 payment_details 字段为已修改，以便 SQLAlchemy 能检测到变化
                    attributes.flag_modified(next_bill, "payment_details")

                    db.session.add(next_bill)
                    current_app.logger.info(
                        f"账单 {current_bill.id} 存在未结清发票，已自动将下一张账单 {next_bill.id} 的开票需求设为 True。"
                    )

    def recalculate_all_bills_for_contract(self, contract_id):
        """
        通过 flask app 命令调用 上下文来重新计算指定合同下的所有账单。
        查找给定合同ID下的所有现有账单，并强制重新计算它们。
        这个函数不关心合同日期，只处理已存在的账单。
        """
        contract = db.session.get(BaseContract, contract_id)
        if not contract:
            current_app.logger.error(
                f"[RecalcByBill] 合同 {contract_id} 未找到。"
            )
            return

        current_app.logger.info(
            f"[RecalcByBill] 开始为合同 {contract.id} 重新计算所有现有账单。"
        )

        all_bills_for_contract = CustomerBill.query.filter_by(
            contract_id=contract.id
        ).order_by(CustomerBill.cycle_start_date).all()

        if not all_bills_for_contract:
            current_app.logger.warning(
                f"[RecalcByBill] 合同 {contract.id} 没有任何已存在的账单，跳过。"
            )
            return

        current_app.logger.info(
            f"[RecalcByBill] 找到 {len(all_bills_for_contract)} 个账单需要重算。"
        )

        for bill in all_bills_for_contract:
            current_app.logger.info(
                f"  -> 正在重算账单 ID: {bill.id} (周期: {bill.cycle_start_date})"
            )
            self.calculate_for_month(
                year=bill.year,
                month=bill.month,
                contract_id=contract.id,
                force_recalculate=True,
                cycle_start_date_override=bill.cycle_start_date
            )

        current_app.logger.info(
            f"[RecalcByBill] 合同 {contract.id} 的所有账单已重算完毕。"
        )
    
    def process_trial_conversion(self, trial_contract_id: str,formal_contract_id: str,operator_id: str):
        """
        V9 (最终版): 将计算过程直接、可靠地写入 description 字段。
        """
        trial_contract = db.session.get(NannyTrialContract, trial_contract_id)
        if not trial_contract:
            raise ValueError(f"试工合同 {trial_contract_id} 未找到。")

        formal_contract = db.session.get(NannyContract, formal_contract_id)
        if not formal_contract:
            raise ValueError(f"正式合同 {formal_contract_id} 未找到。")

        if trial_contract.trial_outcome != TrialOutcome.PENDING:
            raise ValueError("该试工合同已被处理，无法再次转换。")

        trial_contract.trial_outcome = TrialOutcome.SUCCESS
        trial_contract.status = 'finished'
        formal_contract.source_trial_contract_id = trial_contract.id

        costs = self._calculate_trial_conversion_costs(trial_contract)

        first_bill = CustomerBill.query.filter_by(contract_id=formal_contract.id,is_substitute_bill=False).order_by(CustomerBill.cycle_start_date.asc()).first()
        first_payroll = EmployeePayroll.query.filter_by(contract_id=formal_contract.id,is_substitute_payroll=False).order_by(EmployeePayroll.cycle_start_date.asc()).first()

        if not first_bill or not first_payroll:
            self.generate_all_bills_for_contract(formal_contract.id)
            first_bill = CustomerBill.query.filter_by(contract_id=formal_contract.id,is_substitute_bill=False).order_by(CustomerBill.cycle_start_date.asc()).first()
            first_payroll = EmployeePayroll.query.filter_by(contract_id=formal_contract.id,is_substitute_payroll=False).order_by(EmployeePayroll.cycle_start_date.asc()).first()
            if not first_bill or not first_payroll:
                raise Exception(f"无法为正式合同 {formal_contract.id} 找到或创建第一个账单/薪酬单。")

        source_details = {"source_trial_contract_id": str(trial_contract.id)}

        if "trial_service_fee" in costs:
            fee_info = costs["trial_service_fee"]
            amount = fee_info["amount"]
            calculation_desc = fee_info["description"]

            # 1. 在客户账单上创建“客户增款”项
            # bill_adj = FinancialAdjustment(
            #     customer_bill_id=first_bill.id,
            #     adjustment_type=AdjustmentType.CUSTOMER_INCREASE,
            #     amount=amount,
            #     description=f"[系统] 转入试工服务费 ({calculation_desc})",
            #     date=first_bill.cycle_start_date,
            #     details=source_details
            # )
            # db.session.add(bill_adj)

            # 2. 在员工薪酬单上创建“客户直付”项
            payroll_adj = FinancialAdjustment(
                employee_payroll_id=first_payroll.id,
                adjustment_type=AdjustmentType.EMPLOYEE_CLIENT_PAYMENT,
                amount=amount,
                description=f"[客户直付] 试工劳务费 ({calculation_desc})",
                date=first_payroll.cycle_start_date,
                details=source_details
            )
            db.session.add(payroll_adj)

        if "introduction_fee" in costs:
            fee_info = costs["introduction_fee"]
            intro_fee_adj = FinancialAdjustment(customer_bill_id=first_bill.id,adjustment_type=AdjustmentType.INTRODUCTION_FEE, amount=fee_info["amount"], description=f"[系统] 来自试工合同的介绍费 (已结清)", date=first_bill.cycle_start_date, is_settled=True,settlement_date=trial_contract.start_date, details=source_details)
            db.session.add(intro_fee_adj)
            payment_for_intro_fee = PaymentRecord(customer_bill_id=first_bill.id,amount=fee_info["amount"], payment_date=trial_contract.start_date, method='TRIAL_FEE_TRANSFER',notes=f"[系统] 试工合同 介绍费转入", created_by_user_id=operator_id)
            db.session.add(payment_for_intro_fee)

        if "management_fee" in costs:
            fee_info = costs["management_fee"]
            management_fee_adj = FinancialAdjustment(customer_bill_id=first_bill.id,adjustment_type=AdjustmentType.CUSTOMER_INCREASE, amount=fee_info["amount"], description=f"[系统] 从试工合同 转入试工管理费", date=first_bill.cycle_start_date,details=source_details)
            db.session.add(management_fee_adj)

        db.session.commit()
        self.calculate_for_month(year=first_bill.year,month=first_bill.month,contract_id=formal_contract.id, force_recalculate=True,cycle_start_date_override=first_bill.cycle_start_date)
        db.session.refresh(first_bill)
        _update_bill_payment_status(first_bill)
        db.session.commit()



    def _calculate_trial_conversion_costs(self, trial_contract):
        """
        计算试工合同成功转换时产生的各项费用。
        V2: 返回包含计算过程的详细字典。
        """
        if not isinstance(trial_contract, NannyTrialContract):
            return {}

        costs = {}

        # 试工天数计算
        trial_duration_days = (self._to_date(trial_contract.end_date) - self._to_date(trial_contract.start_date)).days
        if trial_duration_days < 0:
            trial_duration_days = 0

        # 1. 计算试工服务费
        trial_level = D(trial_contract.employee_level or '0')
        daily_rate = (trial_level).quantize(D("0.01"))
        trial_service_fee = (daily_rate * D(trial_duration_days)).quantize(D('0.01'))

        if trial_service_fee > 0:
            costs["trial_service_fee"] = {
                "amount": trial_service_fee,
                "description": f"试工日薪({daily_rate}) * 试工天数({trial_duration_days})",
            }

        # 2. 获取介绍费
        introduction_fee = D(trial_contract.introduction_fee or '0')
        if introduction_fee > 0:
            costs["introduction_fee"] = {
                "amount": introduction_fee,
                "description": "合同约定的介绍费",
            }

        # 3. 获取管理费
        management_fee_rate = D(trial_contract.management_fee_rate or '0')
        management_fee = D(0)
        if management_fee_rate > 0:
            # 根据费率计算管理费
            management_fee = (trial_service_fee * management_fee_rate).quantize(D('0.01'))
            if management_fee > 0:
                costs["management_fee"] = {
                    "amount": management_fee,
                    "description": f"试工服务费({trial_service_fee}) * 管理费率({management_fee_rate:.0%})",
                }

        return costs