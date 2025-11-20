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
    PaymentRecord,
    PaymentStatus,
    PayoutStatus,
    TrialOutcome,
    PayoutRecord,
    BankTransactionStatus,
)

from sqlalchemy import func, or_,and_
from sqlalchemy.orm import attributes
from sqlalchemy.exc import IntegrityError

D = decimal.Decimal
CTX = decimal.Context(prec=10)


def _update_bill_payment_status(bill: CustomerBill):
    """
    根据账单的总应付、总实付，更新其支付状态。
    """
    # 核心修正：不再依赖可能缓存的 bill.payment_records 集合，
    # 而是直接从数据库会话中查询最新的支付总额。
    session = db.object_session(bill)
    if not session:
        # 如果对象不是 session 的一部分，则无法查询。这是一种保护。
        current_app.logger.warning(f"无法从账单 {bill.id} 获取数据库会话，跳过状态更新。")
        # 尝试使用 bill.payment_records 作为后备，尽管它可能是旧的
        bill.total_paid = D(sum(p.amount for p in bill.payment_records) or 0)
    else:
        # 这是首选的、最可靠的方法
        total_paid_query = session.query(func.sum(PaymentRecord.amount)).filter(PaymentRecord.customer_bill_id == bill.id)
        total_paid = total_paid_query.scalar() or 0
        bill.total_paid = D(total_paid)

    # 更新支付状态，增加对超付的处理
    if bill.total_due is not None and bill.total_paid >= bill.total_due:
        bill.payment_status = PaymentStatus.PAID
    elif bill.total_paid > 0 and (bill.total_due is None or bill.total_paid < bill.total_due):
        bill.payment_status = PaymentStatus.PARTIALLY_PAID
    elif bill.total_due is not None and bill.total_paid > bill.total_due:
        bill.payment_status = PaymentStatus.OVERPAID
    else:
        # 涵盖 total_paid <= 0 的情况
        bill.payment_status = PaymentStatus.UNPAID

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
        self, year: int, month: int, contract_id=None, force_recalculate=False, actual_work_days_override=None, cycle_start_date_override=None , end_date_override = None, _internal_call=False
    ):
        # <--- 在这里增加下面这行 --->
        current_app.logger.debug(f"[DEBUG-ENGINE] ==> calculate_for_month called with: contract_id={contract_id}, year={year}, month={month}, force_recalculate={force_recalculate}")
        current_app.logger.info(
            f"开始计算contract:{contract_id}  {year}-{month} 的账单 force_recalculate: {force_recalculate}"
        )
        
        contract_poly = db.with_polymorphic(BaseContract, "*")

        if contract_id:
            contract = db.session.query(contract_poly).filter_by(id=contract_id).with_for_update(of=BaseContract).first()
            if not contract:
                current_app.logger.warning(f"Contract {contract_id} not found, skipping calculation.")
                contracts_to_process = []
            else:
                contracts_to_process = [contract]
        else:
            contracts_to_process = db.session.query(contract_poly).filter(BaseContract.status.in_(["active", "terminated"])).all()

        for contract in contracts_to_process:
            if not contract:
                continue

            if contract.type == "maternity_nurse":
                self._calculate_maternity_nurse_bill_for_month(
                    contract, year, month, force_recalculate, cycle_start_date_override, actual_work_days_override=actual_work_days_override
                )
            elif contract.type == "nanny":
                self._calculate_nanny_bill_for_month(
                    contract, year, month, force_recalculate, actual_work_days_override , end_date_override=end_date_override
                )
            elif contract.type == "nanny_trial":
                self._calculate_nanny_trial_bill(
                    contract, year, month, force_recalculate, actual_work_days_override=actual_work_days_override
                )
            elif contract.type == "formal":
                self._calculate_formal_contract_bill_for_month(
                    contract, year, month, force_recalculate
                )
            elif contract.type == "external_substitution":
                # For external substitution, the bill cycle is determined by overrides or the contract itself.
                
                # Find the existing bill first, as it's a one-off bill per contract.
                bill = CustomerBill.query.filter_by(contract_id=contract.id, is_substitute_bill=False).first()

                # Determine start and end dates
                start_date = cycle_start_date_override or (bill.cycle_start_date if bill else contract.start_date)
                end_date = end_date_override or (bill.cycle_end_date if bill else (getattr (contract, 'expected_offboarding_date', None) or contract.end_date))

                # Get or create the bill and payroll with the correct dates
                bill, payroll = self._get_or_create_bill_and_payroll(
                    contract, start_date.year, start_date.month, start_date, end_date
                )

                # The details calculation function reads dates from the bill object, which is now updated.
                details = self._calculate_external_substitution_details(contract, bill, payroll, actual_work_days_override=actual_work_days_override)
                bill, payroll = self._calculate_final_amounts(bill, payroll, details)
                log = self._create_calculation_log(details)
                self._update_bill_with_log(bill, payroll, details, log)

    def _calculate_formal_contract_bill_for_month(
        self, contract: BaseContract, year: int, month: int, force_recalculate=False
    ):
        current_app.logger.info(
            f"=====[FORMAL CALC] 开始处理正式合同 {contract.id} for {year}-{month}"
        )
        # Placeholder for actual formal contract billing logic
        # For now, we just log that it's being processed.
        current_app.logger.info(
            f"      [FORMAL CALC] 正式合同 {contract.id} 的账单计算逻辑待实现。"
        )

    def generate_all_bills_for_contract(self, contract_id, force_recalculate=True):
        """
        Generates or recalculates all bills for the entire lifecycle of a single contract.
        For auto-renewing contracts, it finds the last existing bill to define the loop's end point.
        """
        contract_poly = db.with_polymorphic(BaseContract, "*")
        contract = db.session.query(contract_poly).filter(BaseContract.id == contract_id).first()
        if not contract:
            current_app.logger.error(f"[FullLifecycle] Contract {contract_id} not found.")
            return

        db.session.refresh(contract)
        current_app.logger.info(
            f"[FullLifecycle] Starting bill generation for contract {contract.id} ({contract.type})."
        )

        if isinstance(contract, NannyTrialContract):
            current_app.logger.info(f"[FullLifecycle] 合同 {contract.id} 是试工合同，跳过全周期账单生成。")
            return

        start_date_obj = contract.actual_onboarding_date if contract.type == "maternity_nurse" else contract.start_date
        end_date_obj = (contract.expected_offboarding_date or contract.end_date) if contract.type == "maternity_nurse" else contract.end_date

        # --- 核心修复：确保 end_date_obj 在比较前统一为 date 对象 ---
        if end_date_obj:
            end_date_obj = self._to_date(end_date_obj)
        # --- 修复结束 ---

        if getattr(contract, 'is_monthly_auto_renew', False):
            last_bill = CustomerBill.query.filter_by(
                contract_id=contract.id,
                is_substitute_bill=False
            ).order_by(CustomerBill.year.desc(), CustomerBill.month.desc()).first()

            if last_bill:
                # --- 核心修复：确保 last_bill_end_date 也是 date 对象 ---
                last_bill_end_date = self._to_date(last_bill.cycle_end_date)
                
                if end_date_obj:
                    end_date_obj = max(end_date_obj, last_bill_end_date)
                else:
                    end_date_obj = last_bill_end_date
                current_app.logger.info(f"[FullLifecycle] Auto-renew contract. Effective end date for recalculation set to {end_date_obj}.")
        # --- 修复结束 ---

        if not start_date_obj or not end_date_obj:
            current_app.logger.warning(f"[FullLifecycle] Contract {contract.id} is missing start or end dates. Skipping.")
            return

        start_date = self._to_date(start_date_obj)
        end_date = self._to_date(end_date_obj)

        if not start_date or not end_date:
            raise TypeError(f"无法从 {start_date_obj} 或 {end_date_obj} 中正确解析出日期。")

        current_app.logger.info(
            f"[FullLifecycle] Contract {contract.id} date range for calculation: {start_date} to {end_date}."
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



    def _calculate_nanny_trial_bill(self, contract, year, month, force_recalculate=False, actual_work_days_override=None):
        """为育儿嫂试工合同计算账单和薪酬 (V2 - 纯计算)"""
        current_app.logger.info(f"  [TrialCALC_V2] 开始处理试工合同 {contract.id} for {year}-{month}")

        # 1. 验证合同是否应在本月结算
        if not (contract.end_date and contract.end_date.year == year and contract.end_date.month== month):
            current_app.logger.info(f"    [TrialCALC_V2] 试工合同 {contract.id} 不在本月结算，跳过。")
            return

        cycle_start, cycle_end = contract.start_date, contract.end_date

        bill, payroll = self._get_or_create_bill_and_payroll(contract, year, month, cycle_start,cycle_end)

        if not force_recalculate and bill.calculation_details and 'calculation_log' in bill.calculation_details:
            current_app.logger.info(f"    [TrialCALC_V2] 合同 {contract.id} 的账单已存在且无需重算，跳过。")
            return

        # 2. 核心计算逻辑
        trial_days = (self._to_date(cycle_end) - self._to_date(cycle_start)).days
        details = self._calculate_nanny_trial_termination_details(contract, trial_days, bill,payroll, actual_work_days_override=actual_work_days_override)

        # 3. 更新最终金额
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)

        # 4. 创建并保存日志
        log = self._create_calculation_log(details)
        self._update_bill_with_log(bill, payroll, details, log)

        current_app.logger.info(f"    [TrialCALC_V2] 计算完成 for contract {contract.id}")

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

    def calculate_termination_refunds(self, contract: BaseContract, termination_date: date, charge_on_termination_date: bool = True) -> dict:
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
            
            current_bill = CustomerBill.query.filter(
                CustomerBill.contract_id == contract.id,
                CustomerBill.year == term_year,
                CustomerBill.month == term_month,
                CustomerBill.is_substitute_bill == False
            ).first()

            if current_bill and current_bill.calculation_details:
                monthly_management_fee = D(current_bill.calculation_details.get('management_fee', '0'))
                if monthly_management_fee > 0:
                    cycle_start = self._to_date(current_bill.cycle_start_date)
                    cycle_end = self._to_date(current_bill.cycle_end_date)
                    
                    days_in_cycle = (cycle_end - cycle_start).days + 1
                    
                    if days_in_cycle > 0:
                        daily_fee = (monthly_management_fee / D(days_in_cycle)).quantize(D("0.0001"))
                        
                        if charge_on_termination_date:
                            remaining_days = (cycle_end - termination_date).days
                        else:
                            remaining_days = (cycle_end - termination_date).days + 1
                        
                        if remaining_days > 0:
                            refund_amount = (daily_fee * D(remaining_days)).quantize(QUANTIZER)
                            refunds['management_fee_refund'] = refund_amount
        else:
            # 非月签合同：退还已付但未消耗的总管理费
            first_bill = CustomerBill.query.filter(
                CustomerBill.contract_id == contract.id,
                CustomerBill.is_substitute_bill == False
            ).order_by(CustomerBill.cycle_start_date.asc()).first()

            if first_bill and first_bill.calculation_details:
                total_paid_management_fee = D(first_bill.calculation_details.get('management_fee', '0'))
                
                if total_paid_management_fee > 0:
                    contract_start_date = self._to_date(contract.start_date)
                    
                    if charge_on_termination_date:
                        days_served = (termination_date - contract_start_date).days + 1
                    else:
                        days_served = (termination_date - contract_start_date).days
                    
                    total_contract_days = (self._to_date(contract.end_date) - contract_start_date).days + 1
                    
                    if total_contract_days > 0:
                        daily_fee = total_paid_management_fee / total_contract_days
                        consumed_fee = (daily_fee * days_served).quantize(QUANTIZER)
                        refund_amount = (total_paid_management_fee - consumed_fee).quantize(QUANTIZER)
                        if refund_amount > 0:
                            refunds['management_fee_refund'] = refund_amount

        current_app.logger.info(f"为合同 {contract.id} 计算出的退款为: {refunds}")
        return refunds

    def _calculate_nanny_bill_for_month(
        self, contract: NannyContract, year: int, month: int, force_recalculate=False ,actual_work_days_override=None, end_date_override=None
    ):
        # <--- 在这里增加下面的代码块 --->
        current_app.logger.debug(f"[DEBUG-ENGINE] -> Entering _calculate_nanny_bill_for_month for contract: {contract.id}, status: {contract.status}")
        if contract.previous_contract_id:
            # 使用 with_polymorphic 确保能正确加载所有子类属性
            contract_poly = db.with_polymorphic(BaseContract, "*")
            previous_contract = db.session.query(contract_poly).filter_by(id =contract.previous_contract_id).first()
            if previous_contract:
                current_app.logger.debug(f"[DEBUG-ENGINE]    This contract has a previous_contract: {previous_contract.id}, status: {previous_contract.status}, termination_date: {previous_contract.termination_date}")
        # <--- 增加结束 --->
        """育儿嫂计费逻辑的主入口 (V20 - 简化为单次计算)。"""
        current_app.logger.debug(f"[DEBUG-ENGINE] _calculate_nanny_bill_for_month called with: end_date_override={end_date_override}, actual_work_days_override={actual_work_days_override}")

        bill_to_recalculate = None
        if force_recalculate:
            bill_to_recalculate = CustomerBill.query.filter_by(
                contract_id=contract.id, year=year, month=month, is_substitute_bill=False
            ).first()

        if bill_to_recalculate:
            cycle_start = bill_to_recalculate.cycle_start_date
            cycle_end = end_date_override or bill_to_recalculate.cycle_end_date
        else:
            cycle_start, cycle_end = self._get_nanny_cycle_for_month(contract, year, month,end_date_override)

        if not cycle_start:
            current_app.logger.info(f"[NannyCALC] 合同 {contract.id} 在 {year}-{month} 无需创建账单，跳过。")
            return

        local_actual_work_days_override = actual_work_days_override
        if end_date_override and local_actual_work_days_override is None:
            days = (self._to_date(cycle_end) - self._to_date(cycle_start)).days + 1
            local_actual_work_days_override = days
        
        bill, payroll = self._get_or_create_bill_and_payroll(contract, year, month, cycle_start, cycle_end)
        if not bill or not payroll:
            current_app.logger.info(f"[NannyCALC] 周期 {cycle_start} 的账单无法获取或创建（可能已被合并），计算中止。")
            return

        if not force_recalculate and bill.calculation_details and "calculation_log" in bill.calculation_details:
            current_app.logger.info(f"[NannyCALC] 合同 {contract.id} 的账单已存在且无需重算，跳过。")
            return

        # --- 简化为单次计算 ---
        details = self._calculate_nanny_details(contract, bill, payroll, local_actual_work_days_override)
        final_bill, final_payroll = self._calculate_final_amounts(bill, payroll, details)
        log = self._create_calculation_log(details)
        self._update_bill_with_log(final_bill, final_payroll, details, log)
        current_app.logger.info(f"[NannyCALC] 计算完成 for contract {contract.id}")

        # --- Linus-style Change: Unify final billing logic ---
        # Check if this is the final bill for a naturally expiring contract and trigger final adjustments.
        contract_end_date = self._to_date(contract.end_date)
        cycle_end_date = self._to_date(cycle_end)
        is_auto_renew = getattr(contract, 'is_monthly_auto_renew', False)

        if contract_end_date and cycle_end_date and cycle_end_date >= contract_end_date and not is_auto_renew and contract.status in ['active', 'finished','pending']:
            # <--- 在这里增加上面的代码块 --->
            current_app.logger.debug(f"[DEBUG-ENGINE] -> Checking final salary adjustments for contract {contract.id} on bill {bill.id}:")
            current_app.logger.debug(f"[DEBUG-ENGINE]    Condition check: (cycle_end: {cycle_end_date} >= contract_end: {contract_end_date}) AND (not is_auto_renew: {not is_auto_renew}) AND (status in ['active', 'finished', 'pending']: {contract.status in ['active', 'finished', 'pending']})")
            # <--- 增加结束 --->
            # [Recursion Fix] Check if final adjustments already exist to prevent infinite loop.
            final_adj_exists = db.session.query(FinancialAdjustment.id).filter_by(
                customer_bill_id=bill.id,
                adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
                description="[系统] 公司代付工资"
            ).first()

            if not final_adj_exists:
                current_app.logger.info(f"[NannyCALC] 合同 {contract.id} 为自然到期，触发最终结算调整。")
                self.create_final_salary_adjustments(bill.id)

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

        # --- NEW LOGIC START ---
        # 默认的账单开始日期是合同的开始日期
        calculated_cycle_start = self._to_date(contract.start_date)

        # 只有在处理合同的第一个月时才需要检查重叠
        if year == start_year and month == start_month:
            if contract.previous_contract_id:
                # 尝试从数据库获取前任合同。使用 BaseContract 以确保兼容所有合同类型。
                previous_contract = db.session.get(BaseContract, contract.previous_contract_id)
                # 检查前任合同是否存在，并且其结束日期与当前合同的开始日期重叠
                if previous_contract and self._to_date(previous_contract.end_date) == self._to_date(contract.start_date):
                    # 发现重叠场景，将第一个账单的开始日期调整为合同开始日期的后一天
                    calculated_cycle_start = self._to_date(contract.start_date) + timedelta(days=1)
                    current_app.logger.info(f"[BILLING_OVERLAP_FIX] 合同 {contract.id} (开始: {contract.start_date}) 是前任合同 {previous_contract.id} (结束: {previous_contract.end_date}) 的后继。已将第一个账单周期开始日期调整为 {calculated_cycle_start}。")
            
            # 如果调整后的开始日期超出了目标月份的最后一天，则本月不生成账单
            if calculated_cycle_start > last_day_of_target_month:
                current_app.logger.info(f"[BILLING_OVERLAP_FIX] 调整后的账单开始日期 {calculated_cycle_start} 超出目标月份 {year}-{month}，跳过本月账单生成。")
                return None, None
        # --- NEW LOGIC END ---

        if year == start_year and month == start_month:
            if start_year == end_year and start_month == end_month:
                # 使用可能已调整的 calculated_cycle_start
                return calculated_cycle_start, contract_end_date
            else:
                _, num_days_in_start_month = calendar.monthrange(
                    start_year, start_month
                )
                last_day_of_start_month = date(
                    start_year, start_month, num_days_in_start_month
                )
                # 使用可能已调整的 calculated_cycle_start
                return calculated_cycle_start, last_day_of_start_month

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

        # 从数据库里重新加载这个账单对象，不相信任何缓存
        current_app.logger.info(f"--- [PARANOID_CHECK]...")
        fresh_bill_from_db = db.session.get(CustomerBill, bill.id)
        if fresh_bill_from_db:
            current_app.logger.info(f"--- [PARANOID_CHECK] Freshly fetched bill has is_substitute_bill = {fresh_bill_from_db.is_substitute_bill} ---")
            if fresh_bill_from_db.is_substitute_bill:
                current_app.logger.error(f"--- [PARANOID_CHECK] CRITICAL ERROR: The bill with ID {bill.id} is indeed a substitute bill in the DB. Aborting calculation.")
                return {}
        else:
            current_app.logger.error(f"--- [PARANOID_CHECK] CRITICAL ERROR: Could not re-fetch bill with ID: {bill.id} from DB. ---")
        current_app.logger.info(f"    [NannyDETAILS] 计算育儿嫂合同 {contract.id} 的详细信息。")
        log_extras = {}
        QUANTIZER = D("0.001")
        self._attach_pending_adjustments(contract, bill)
        extension_fee = D(0)

        extension_management_fee = D(0)

        level = D(contract.employee_level or 0)
        original_cycle_start_datetime = bill.cycle_start_date
        original_cycle_end_datetime = bill.cycle_end_date
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
                substitution_details_for_log.append(f"由({sub_employee_name})替班 {days_in_cycle}天")
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
        # 【核心修复】更健壮地判断是否为合同的首月账单
        is_first_bill_of_contract = not db.session.query(CustomerBill.id).filter(
            CustomerBill.contract_id == contract.id,
            CustomerBill.cycle_start_date < bill.cycle_start_date,
            CustomerBill.is_substitute_bill == False
        ).first()
        if is_first_bill_of_contract:  # 育儿嫂第一个月账单天数 +1
            cycle_actual_days = (cycle_end - cycle_start).days
        
        # --- NEW LOGIC for actual_work_days ---
        # 优先使用从API传入的覆盖值
        if actual_work_days_override is not None:
            base_work_days = D(actual_work_days_override)
            log_extras["base_work_days_reason"] = f"使用用户传入的实际劳务天数 ( {actual_work_days_override:.3f})"
            # 同步更新数据库中的字段，确保前端刷新后能看到正确的值
            bill.actual_work_days = actual_work_days_override
            payroll.actual_work_days = actual_work_days_override
        elif bill.actual_work_days and bill.actual_work_days > 0:
            base_work_days = D(bill.actual_work_days)
            log_extras["base_work_days_reason"] = f"使用数据库中已存的实际劳务天数 ( {bill.actual_work_days})"
        else:
            # 回退到旧的计算逻辑
            base_work_days = D(min(cycle_actual_days, 26))
            log_extras["base_work_days_reason"] = f"默认逻辑: min(周期天数( {cycle_actual_days}), 26)"
        # --- END NEW LOGIC ---
        
        # total_days_worked = base_work_days + overtime_days - D(total_substitute_days)
        # 移除替班天数
        total_days_worked = base_work_days + overtime_days

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
            if is_first_bill_of_contract and cycle_start.day != 1:
                current_month_contract_days = (cycle_end - cycle_start).days
                management_days = D(min(current_month_contract_days + 1, 30))
                management_fee = (management_fee_daily_rate * management_days).quantize(
                    QUANTIZER
                )
                if management_fee_amount:
                    management_fee_reason =  f"月签合同首月不足月，按天收取: 管理费 {management_fee_amount}/30 * 劳务天数 ({current_month_contract_days} + 1) = {management_fee:.2f}"

                else:
                    management_fee_reason =  f"月签合同首月不足月，按天收取: 级别{level} * 10%/30 * 劳务天数 ({current_month_contract_days} + 1) = {management_fee:.2f}"
                log_extras["management_fee_reason"] = management_fee_reason
            elif is_last_bill and cycle_end.day != last_day_of_month:
                cycle_duration_days = (cycle_end - cycle_start).days + 1
                management_days = D(min(cycle_duration_days, 30))
                management_fee = (management_fee_daily_rate * management_days).quantize(QUANTIZER)
                if management_fee_amount:
                    management_fee_reason = f"末期账单不足月，按天收取: 管理费 {management_fee_amount}/30 * min(周期天数({cycle_duration_days}), 30) = {management_fee: .2f}"
                else:
                    management_fee_reason = f"末期账单不足月，按天收取: 级别({level} )*10%/30 * min(周期天数({cycle_duration_days}), 30) = {management_fee:.2f}"
                log_extras["management_fee_reason"] = management_fee_reason
            else:
                if management_fee_amount:
                    management_fee = management_fee_amount.quantize(QUANTIZER)
                    management_fee_reason = f"月签合同整月，按月收取: {management_fee_amount} "
                else:
                    management_fee = (level * D("0.1")).quantize(QUANTIZER)
                    management_fee_reason = f"月签合同整月，按月收取: {level} * 10%"
                log_extras["management_fee_reason"] = management_fee_reason
        else:
            # --- 非月签合同逻辑 ---
            current_app.logger.info("进入非月签合同逻辑")
            if is_first_bill_of_contract:
                monthly_management_fee = management_fee_amount if management_fee_amount > 0 else(level * D("0.1"))
                current_app.logger.info(f"contract_start_date.day: {contract_start_date.day},contract_end_date.day:{contract_end_date.day}")
                # --- V2 优化：定义更通用的“整月”规则 ---
                is_full_calendar_months = (
                    contract_start_date.day == 1 and
                    (contract_end_date + timedelta(days=1)).day == 1
                )

                if is_full_calendar_months or contract_start_date.day == contract_end_date.day:
                    # --- 规则1：起止于日历月的边界 (如 11.01 ~ 1.31) ---
                    # --- 规则2：起止日号数相同 (如 11.21 ~ 1.21) ---
                    if is_full_calendar_months:
                        current_app.logger.info(f"合同 {contract.id} 触发了【日历整月】管理费计算模式。")
                        # 对于日历整月，月数就是 end.month - start.month + 1
                        total_months = (contract_end_date.year - contract_start_date.year) * 12 + (contract_end_date.month - contract_start_date.month) + 1
                        reason_text = "日历整月"
                    else: # contract_start_date.day == contract_end_date.day
                        current_app.logger.info(f"合同 {contract.id} 触发了【起止日相同】管理费计算模式。")
                        rdelta = relativedelta(contract_end_date, contract_start_date)
                        total_months = rdelta.years * 12 + rdelta.months
                        reason_text = "起止日相同"

                    management_fee = (monthly_management_fee * D(total_months)).quantize(QUANTIZER)
                    management_fee_reason = f"非月签合同({reason_text})首月一次性收取: {total_months}个月 * {monthly_management_fee:.2f}/月 = {management_fee:.2f}元"
                
                else:
                    # --- 默认规则：不满足任何整月模式，按三段式天数计算 ---
                    current_app.logger.info(f"合同 {contract.id} 使用按天三段式管理费计算模式。")
                    # 日单价按30天计算，这是固定业务规则
                    daily_management_fee = (monthly_management_fee / D(30)).quantize(D( "0.0001"))
                    start = contract_start_date
                    end = contract_end_date

                    if start.year == end.year and start.month == end.month:
                        # --- 单月合同逻辑 ---
                        days_in_month = calendar.monthrange(start.year, start.month)[1]
                        is_full_calendar_month = (start.day == 1 and end.day == days_in_month)
                        
                        actual_days = (end - start).days + 1
                        # 如果是完整日历月，则按30天收费，否则按实际天数
                        chargeable_days = 30 if is_full_calendar_month else actual_days
                        
                        management_fee = (daily_management_fee * D(chargeable_days)).quantize(QUANTIZER)
                        management_fee_reason = f"非月签合同(不足一月)按天收取: {actual_days}天 = {management_fee:.2f}元"
                    else:
                        # --- 跨月合同三段式逻辑 ---

                        # 首月计算
                        is_full_first_month = (start.day == 1)
                        first_month_log_days = calendar.monthrange(start.year, start.month)[1] - start.day + 1
                        # 如果首月是1号开始，则视为整月，按30天计算费用
                        first_month_chargeable_days = 30 if is_full_first_month else first_month_log_days
                        first_month_fee = (daily_management_fee * D(first_month_chargeable_days)).quantize(QUANTIZER)

                        # 末月计算
                        days_in_end_month = calendar.monthrange(end.year, end.month)[1]
                        is_full_last_month = (end.day == days_in_end_month)
                        last_month_log_days = end.day
                        # 如果末月是最后一天结束，则视为整月，按30天计算费用
                        last_month_chargeable_days = 30 if is_full_last_month else last_month_log_days
                        last_month_fee = (daily_management_fee * D(last_month_chargeable_days)).quantize(QUANTIZER)

                        # 中间整月计算 (逻辑保持不变)
                        full_months_count = (end.year - start.year) * 12 + (end.month - start.month) - 1
                        
                        full_months_fee = D(0)
                        if full_months_count > 0:
                            full_months_fee = monthly_management_fee * D(full_months_count)

                        management_fee = first_month_fee + full_months_fee + last_month_fee
                        
                        # 使用日志天数生成日志，但使用计费天数进行计算
                        reason_parts = [f"首月({first_month_log_days}天): {first_month_fee:.2f}"]
                        if full_months_fee > 0:
                            reason_parts.append(f"中间{full_months_count}整月: {full_months_fee:.2f}")
                        reason_parts.append(f"末月({last_month_log_days}天): {last_month_fee:.2f}")
                        management_fee_reason = f"非月签合同首月一次性收取 ({' + ' .join(reason_parts)}) = {management_fee:.2f}元"
            else:
                # 非首月，非月签合同不收管理费
                management_fee = D(0)
                management_fee_reason = "非月签合同非首月，不收取管理费"

            log_extras["management_fee_reason"] = management_fee_reason

            current_app.logger.info(f"检查是否进入“延长服务期逻辑”:is_last_bill_period: {is_last_bill_period},cycle_end:{cycle_end},contract_end_date:{contract_end_date} ,authoritative_end_date:{authoritative_end_date}")
            if not bill.is_substitute_bill:
                if is_last_bill_period and cycle_end > contract_end_date:
                    current_app.logger.info(f"合同 {contract.id} 进入末期延长计费逻辑。")
                    # 场景：这是被延长的最后一期账单

                    # 1. 计算延长天数和费用
                    extension_fee = D(0)
                    # 使用 authoritative_end_date 进行比较
                    current_app.logger.info(f"检查是否进入延长服务期逻辑 authoritative_end_date and cycle_end > authoritative_end_date :{authoritative_end_date} -- {cycle_end} --  {authoritative_end_date}")
                    if authoritative_end_date and contract_end_date < authoritative_end_date:
                        extension_days = (authoritative_end_date - contract_end_date).days
                        current_app.logger.info(f"延长周期的extension_days======: {extension_days}")
                        if extension_days > 0:
                            daily_rate = level / D(26)
                            extension_fee = (daily_rate *D(extension_days)).quantize(QUANTIZER)
                            log_extras["extension_days_reason"] = f"原合同于 {authoritative_end_date.strftime('%m月%d日')} 结束，延长至 {cycle_end.strftime('%m月%d日' )}，共 {extension_days} 天。"
                            log_extras["extension_fee_reason"] = f"延期劳务费: 日薪( {daily_rate:.2f}) * 延长天数({extension_days}) = {extension_fee:.2f}"

                            management_fee_daily_rate = (management_fee_amount or (level *D("0.1"))) / D(30)
                            extension_management_fee = (management_fee_daily_rate *D(extension_days)).quantize(QUANTIZER)
                            current_app.logger.info(f"--- [DEBUG-EXT] Calculated extension_management_fee: {extension_management_fee} ---")
                            if extension_management_fee > 0:
                                # 【关键修复】确保日志被正确记录
                                log_extras["management_fee_reason"] = log_extras.get( "management_fee_reason", "") + f" + 延期管理费: 日管理费({management_fee_daily_rate:.2f}) * {extension_days}天 ={extension_management_fee:.2f}"
                                management_fee += extension_management_fee
            
        # --- 【新逻辑】员工首月10%服务费 ---
        first_month_deduction = D(0)
        # is_first_bill_of_contract = cycle_start == contract_start_date
        is_first_bill_of_contract = not db.session.query(CustomerBill.id).filter(
            CustomerBill.contract_id == contract.id,
            CustomerBill.cycle_start_date < bill.cycle_start_date,
            CustomerBill.is_substitute_bill == False
        ).first()
        current_app.logger.info("开始检查首月10%返佣逻辑")

        if is_first_bill_of_contract and not (isinstance(contract, NannyTrialContract) and contract.trial_outcome == TrialOutcome.SUCCESS):
            current_app.logger.info(f"合同 {contract.id} 进入首月佣金检查逻辑。")
            customer_name = contract.customer_name
            employee_sp_id = contract.service_personnel_id

            # 检查是否存在该客户与该员工的更早的合同
            previous_contract_exists = None
            if employee_sp_id:
                previous_contract_exists = db.session.query(BaseContract.id).filter(
                    BaseContract.id != contract.id,
                    BaseContract.customer_name == customer_name,
                    BaseContract.type != 'nanny_trial',  # 排除试工合同
                    BaseContract.service_personnel_id == employee_sp_id,
                    BaseContract.start_date < contract_start_date
                ).first()

            if not previous_contract_exists:
                current_app.logger.info(f"[CommissionCheck] No previous contract found for customer {customer_name} and employee {employee_sp_id}. Proceeding with first month commission deduction check.")
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
                        log_extras["first_month_deduction_reason"] = f"首次合作，创建员工佣金调整项: 级别*10%({service_fee_due:.2f})) = {first_month_deduction:.2f}"
                    else:
                        
                        log_extras["first_month_deduction_reason"] = "员工首月佣金调整项已被处理过（可能已创建或转移），不再重复创建。"
                else:
                    current_app.logger.info(f"[CommissionCheck] Calculated first month deduction is {first_month_deduction}, no adjustment needed.")
                    log_extras["first_month_deduction_reason"] = "首次合作，但计算出的首月佣金为0，无需创建调整项。"
                    # ------------------- 以上是核心修改 (V2) -------------------
            else:
                previous_contract_id = previous_contract_exists[0]
                current_app.logger.info(f"[CommissionCheck] Found previous contract for customer {customer_name} and employee {employee_sp_id}. Previouscontract ID: {previous_contract_id}")
                log_extras["first_month_deduction_reason"] = f"员工与客户已有过合作历史（合同ID: {previous_contract_id}），不收取首月佣金。"

        current_app.logger.debug(f"NannyDETAILS:log_extras:{log_extras}")
        # 返回的 details 中不再包含 first_month_deduction，因为它已经变成了调整项
        details_to_return = {
            "type": "nanny",
            "is_last_bill": is_last_bill,
            "level": str(level),
            "cycle_period": f"{cycle_start.isoformat()} to {cycle_end.isoformat()}",
            "cycle_start_datetime": original_cycle_start_datetime.isoformat(), # New field for precise datetime
            "cycle_end_datetime": original_cycle_end_datetime.isoformat(),     # New field for precise datetime
            "base_work_days": f"{base_work_days:.3f}",
            "overtime_days":  f"{overtime_days:.3f}",
            "total_days_worked": str(total_days_worked),
            # "substitute_days": str(total_substitute_days),
            "substitute_days": "0",
            # "substitute_deduction": str(substitute_deduction_from_sub_records.quantize(QUANTIZER)),
            "substitute_deduction": "0.00",
            "extension_fee": f"{extension_fee:.2f}",
            "extension_management_fee": f"{extension_management_fee:.2f}",
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
            # "substitute_deduction_logs": substitute_deduction_logs,
        }
        current_app.logger.info(f"--- [DEBUG-EXT] Keys in details dict before returning: {list(details_to_return.keys())} ---")
        return details_to_return

    def _calculate_maternity_nurse_bill_for_month(
        self,
        contract: MaternityNurseContract,
        year: int,
        month: int,
        force_recalculate=False,
        cycle_start_date_override=None,
        actual_work_days_override=None
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
                    actual_work_days_override=actual_work_days_override
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
                    contract, cycle_start, cycle_end, year, month, force_recalculate, actual_work_days_override=actual_work_days_override
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
        actual_work_days_override=None
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
        details = self._calculate_maternity_nurse_details(contract, bill, payroll, actual_work_days_override=actual_work_days_override)
        
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
        actual_work_days_override=None
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
        
        # --- NEW LOGIC for actual_work_days ---
        if actual_work_days_override is not None:
            base_work_days = D(actual_work_days_override)
            log_extras["base_work_days_reason"] = f"使用用户传入的实际劳务天数 ( {actual_work_days_override:.3f})"
            bill.actual_work_days = actual_work_days_override
            payroll.actual_work_days = actual_work_days_override
        elif bill.actual_work_days and bill.actual_work_days > 0:
            base_work_days = D(bill.actual_work_days)
            log_extras["base_work_days_reason"] = f"使用数据库中已存的实际劳务天数 ( {bill.actual_work_days})"
        else:
            base_work_days = D(min(actual_cycle_days, 26))
            log_extras["base_work_days_reason"] = f"默认逻辑: min(周期天数( {actual_cycle_days}), 26)"
        # --- END NEW LOGIC ---

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
            f"客交保证金({customer_deposit:.2f}) - 级别({level:.2f}) / 26 * 劳务天数( {base_work_days}) = {management_fee:.2f}"
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
                log_extras["extension_days_reason"] = f"原合同于 {authoritative_end_date.strftime('%m月%d日')} 结束，手动延长至 {bill.cycle_end_date.strftime('%m月%d日')}，共 {extension_days} 天。"
                log_extras["extension_fee_reason"] = f"延期劳务费: 级别({level:.2f})/26 * 延长天数({extension_days}) = {extension_fee:.2f}"
        # --- 新增结束 ---

        return {
            "type": "maternity_nurse",
            "level": str(level),
            "customer_deposit": str(customer_deposit),
            "cycle_period": f"{cycle_start.isoformat()} to {cycle_end.isoformat()}",
            "base_work_days": f"{base_work_days:.3f}",
            "overtime_days": f"{overtime_days:.3f}",
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
        # 规则：试工合同没有任何保证金逻辑
        if isinstance(contract, NannyTrialContract):
            return
        current_app.logger.info(f"--- [DEPOSIT-HANDLER-V2] START for Bill ID: {bill.id} ---")

        if not contract.security_deposit_paid or contract.security_deposit_paid<= 0:
            current_app.logger.info("[DEPOSIT-HANDLER-V2] SKIPPING: Contract has no security_deposit_paid.")
            return

        # 【关键修复】统一使用纯 date 对象进行比较
        contract_start_date = self._to_date(contract.actual_onboarding_date or contract.start_date)
        bill_cycle_start_date = self._to_date(bill.cycle_start_date)
        is_first_bill_of_contract = not db.session.query(CustomerBill.id).filter(
            CustomerBill.contract_id == contract.id,
            CustomerBill.cycle_start_date < bill.cycle_start_date,
            CustomerBill.is_substitute_bill == False
        ).first()
        # is_first_bill = bill_cycle_start_date == contract_start_date
        current_app.logger.info(f"[DEPOSIT-HANDLER-V2] is_first_bill_of_contract: {is_first_bill_of_contract} (bill_cycle_start: {bill_cycle_start_date}, contract_start: {contract_start_date})")

        if is_first_bill_of_contract:
            # --- 这是首期账单，应该有“保证金”收款项 ---
            deposit_amount_due = contract.security_deposit_paid
            existing_deposit = FinancialAdjustment.query.filter(
                FinancialAdjustment.customer_bill_id == bill.id,
                FinancialAdjustment.description.like('[系统添加] 保证金%')
            ).first()
            current_app.logger.info(f"[DEPOSIT-HANDLER-V2] existing_deposit found: {bool(existing_deposit)}")

            if existing_deposit:
                current_app.logger.info(f"[DEPOSIT-HANDLER-V2] Existing deposit amount: {existing_deposit.amount}, Expected amount: {deposit_amount_due}")
                if existing_deposit.amount != deposit_amount_due:
                    current_app.logger.info(f"[DEPOSIT-HANDLER-V2] Updating existing deposit amount from {existing_deposit.amount} to {deposit_amount_due}")
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
                current_app.logger.info(f"[DEPOSIT-HANDLER-V2] Created new deposit adjustment for amount: {deposit_amount_due}")
        else:
            current_app.logger.info("[DEPOSIT-HANDLER-V2] Not first bill, removing any existing deposit adjustments if present.")
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

        if is_last_bill_period and (not is_auto_renew or contract.status in ['terminated', 'finished']):
            # <--- 在这里增加上面的代码块 --->
            current_app.logger.debug(f"[DEBUG-ENGINE] -> Checking deposit refund for contract {contract.id} on bill {bill.id}:")
            current_app.logger.debug(f"[DEBUG-ENGINE]    is_last_bill_period: {is_last_bill_period} (cycle_end: {bill_cycle_end_date} >= contract_end: {contract_end_date})")
            current_app.logger.debug(f"[DEBUG-ENGINE]    is_auto_renew: {is_auto_renew}")
            current_app.logger.debug(f"[DEBUG-ENGINE]    contract.status: {contract.status}")
            # <--- 增加结束 --->
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
        # is_first_bill = bill_cycle_start_date == contract_start_date
        is_first_bill_of_contract = not db.session.query(CustomerBill.id).filter(
            CustomerBill.contract_id == contract.id,
            CustomerBill.cycle_start_date < bill.cycle_start_date,
            CustomerBill.is_substitute_bill == False
        ).first()

        if is_first_bill_of_contract:
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
        db.session.refresh(sub_record)

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

        # ---> 在这里加上下面的代码 <---
        db.session.flush() # 确保 bill 对象有 ID
        current_app.logger.info(f"--- [CALC_SUB_CHECK] Found or created substitute bill with ID: {bill.id} ---")
        # ---> 修改结束 <---    

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

        # First calculation to get the correct payroll total
        details = self._calculate_substitute_details(sub_record, main_contract, bill, payroll, overrides)
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)
        if sub_record.substitute_type == "nanny":
            # Create or get the adjustment with a placeholder amount
            adjustment = FinancialAdjustment.query.filter_by(
                customer_bill_id=bill.id,
                description="[系统] 替班服务费"
            ).first()
            if not adjustment:
                adjustment = FinancialAdjustment(
                    customer_bill_id=bill.id,
                    adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
                    amount=0, # Placeholder
                    description="[系统] 替班服务费",
                    date=sub_record.start_date,
                )
                db.session.add(adjustment)
                db.session.flush()
                # Update the adjustment with the payroll total
                adjustment.amount = payroll.total_due
                db.session.flush()
                # (V18) 同步镜像调整项
                self._mirror_company_paid_salary_adjustment(adjustment, payroll)

        # Recalculate with the correct adjustment amount
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
        current_app.logger.info(f"--- [SUB_DETAILS_CHECK] Entered for bill ID: {bill.id}, is_substitute_bill: {bill.is_substitute_bill} ---")
        current_app.logger.info(f"--- [SUB_DETAILS_CHECK] Substitute record ID: {sub_record.id}, Fee RATE from record: {sub_record.substitute_management_fee_rate}, Type: {sub_record.substitute_type} ---")
        """计算替班记录的财务细节。"""
        if overrides is None:
            overrides = {}

        QUANTIZER = D("0.01")
        cust_increase, cust_decrease, emp_increase, emp_decrease, deferred_fee, emp_commission= (
            self._get_adjustments(bill.id, payroll.id)
        )

        if overrides.get('actual_work_days') is not None:
            substitute_days = D(overrides['actual_work_days'])
            bill.actual_work_days = substitute_days
        else:
            time_difference = sub_record.end_date - sub_record.start_date
            precise_substitute_days = D(time_difference.total_seconds()) / D(86400)
            substitute_days = precise_substitute_days.quantize(D('0.001'))

        if overrides.get('overtime_days') is not None:
            overtime_days = D(overrides['overtime_days'])
            sub_record.overtime_days = overtime_days
        else:
            overtime_days = D(sub_record.overtime_days or 0)

        substitute_level = D(sub_record.substitute_salary)
        substitute_type = sub_record.substitute_type
        management_fee_rate = D(sub_record.substitute_management_fee_rate or 0)

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
            "cycle_start_datetime": sub_record.start_date.isoformat(),
            "cycle_end_datetime": sub_record.end_date.isoformat(),
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
            "management_fee_rate": str(management_fee_rate),
        }

        overtime_daily_rate = substitute_level / D(26)
        overtime_fee = (overtime_daily_rate * overtime_days).quantize(QUANTIZER)
        details["customer_overtime_fee"] = str(overtime_fee)
        details["employee_overtime_payout"] = str(overtime_fee)
        details["log_extras"]["overtime_reason"] = (
            f"替班加班费: 替班级别({substitute_level:.2f})/26 * 加班天数({overtime_days:.2f})"
        )

        management_fee = D(0)

        if substitute_type == "maternity_nurse":
            customer_daily_rate = (substitute_level * (D(1) - management_fee_rate) / D(26))
            customer_base_fee = (customer_daily_rate * substitute_days).quantize(QUANTIZER)
            employee_daily_rate = customer_daily_rate # 月嫂替班，客户和员工日薪相同
            employee_base_payout = customer_base_fee

            if management_fee_rate > 0:
                management_fee = (substitute_level * management_fee_rate / D(26) *substitute_days).quantize(QUANTIZER)
                details["log_extras"]["management_fee_reason"] = (
                    f"月嫂替班管理费: 级别({substitute_level:.2f}) * 费率({management_fee_rate:.2%}) /26 * 天数({substitute_days:.3f}) = {management_fee:.2f}"
                )
            else:
                 details["log_extras"]["management_fee_reason"] = "管理费率为0，不收取管理费。"

            details.update({
                "daily_rate": str(customer_daily_rate.quantize(QUANTIZER)),
                "employee_daily_rate": str(employee_daily_rate.quantize(QUANTIZER)),
                "customer_base_fee": str(customer_base_fee),
                "employee_base_payout": str(employee_base_payout),
            })
            details["log_extras"]["customer_fee_reason"] = (
                f"月嫂替班客户费用: 级别({substitute_level:.2f})*(1-{management_fee_rate:.2%})/26 * 天数({substitute_days:.3f})= {customer_base_fee:.2f}"
            )
            details["log_extras"]["employee_payout_reason"] = (
                f"月嫂替班员工工资: 级别({substitute_level:.2f})*(1-{management_fee_rate:.2%})/26 * 天数({substitute_days:.3f})= {employee_base_payout:.2f}"
            )

        elif substitute_type == "nanny":
            daily_rate = substitute_level / D(26)
            base_fee = (daily_rate * substitute_days).quantize(QUANTIZER)
            customer_base_fee = base_fee
            employee_base_payout = base_fee

            # 对于育儿嫂，直接读取在API层预先计算好的管理费金额
            management_fee = D(sub_record.substitute_management_fee or 0)
            if management_fee > 0:
                details["log_extras"]["management_fee_reason"] = f"育儿嫂合同外替班管理费: {management_fee:.2f}元 (按 {management_fee_rate:.2%} 的费率计算)"
            else:
                details["log_extras"]["management_fee_reason"] = "不收取管理费 (费率为0或未超出合同期)。"

            details.update({
                "daily_rate": str(daily_rate.quantize(QUANTIZER)),
                "employee_daily_rate": str(daily_rate.quantize(QUANTIZER)),
                "customer_base_fee": str(customer_base_fee),
                "employee_base_payout": str(employee_base_payout),
            })
            details["log_extras"]["customer_fee_reason"] = (
                f"育儿嫂替班客户费用: 级别({substitute_level:.2f})/26 * 天数({substitute_days:.3f}) = {customer_base_fee:.2f}"
            )
            details["log_extras"]["employee_payout_reason"] = (
                f"育儿嫂替班员工工资: 级别({substitute_level:.2f})/26 * 天数({substitute_days:.3f}) = {employee_base_payout:.2f}"
            )

        # 将最终计算出的管理费金额存入 details 和数据库记录
        details["management_fee"] = str(management_fee)
        sub_record.substitute_management_fee = management_fee
        db.session.add(sub_record)

        return details
    
    
    def _calculate_external_substitution_details(self, contract, bill, payroll, actual_work_days_override=None):
        """计算外部替班合同的所有财务细节(最终修正版)。"""
        current_app.logger.info(f"[DEBUG] Entering _calculate_external_substitution_details for bill {bill.id}")

        self._handle_security_deposit(contract, bill)
        
        QUANTIZER = D("0.01")
        level = D(contract.employee_level or 0)
        management_fee_rate = D(contract.management_fee_rate or 0.20)
        log_extras = {} # 先初始化

        # --- 关键修复：在这里定义清晰的日期变量 ---
        bill_end_date = self._to_date(bill.cycle_end_date)
        original_contract_end_date = self._to_date(contract.end_date)
        start_date = self._to_date(bill.cycle_start_date)
        # --- 修复结束 ---

        if not start_date or not bill_end_date or not original_contract_end_date:
            raise ValueError("外部替班合同的起止日期不完整，无法计算。")

        if actual_work_days_override is not None:
            service_days = D(actual_work_days_override)
            log_extras["base_work_days_reason"] = f"使用用户传入的实际劳务天数 ( {actual_work_days_override:.3f})"
            bill.actual_work_days = actual_work_days_override
            if payroll:
                payroll.actual_work_days = actual_work_days_override
        else:
            time_difference = bill.cycle_end_date - bill.cycle_start_date
            service_days = D(time_difference.total_seconds()) / D(86400)
            log_extras["service_days_reason"] = f"服务总时长 {time_difference} = {service_days:.3f} 天"


        daily_rate = (level / D(26)).quantize(QUANTIZER)
        
        # 基础费用
        customer_base_fee = (daily_rate * service_days).quantize(QUANTIZER)
        employee_base_payout = customer_base_fee

        # 加班费用
        attendance = self._get_or_create_attendance(contract, bill.cycle_start_date, bill.cycle_end_date)
        overtime_days = D(attendance.overtime_days or 0)
        overtime_fee = (daily_rate * overtime_days).quantize(QUANTIZER)
        if overtime_fee > 0:
            log_extras["overtime_reason"] = f"加班费: 日薪({daily_rate:.2f}) * 加班天数( {overtime_days:.2f}) = {overtime_fee:.2f}"
        
        # --- 核心修正：统一按天计算管理费 ---
        if contract.management_fee_amount is not None and contract.management_fee_amount > 0:
            # 如果合同有固定的月管理费，则按天折算
            monthly_fee = D(contract.management_fee_amount)
            daily_fee = (monthly_fee / D(30)).quantize(D("0.0001")) # 保留多位小数以提高精度
            management_fee = (daily_fee * service_days).quantize(QUANTIZER)
            log_extras["management_fee_reason"] = f"按天折算: 月管理费({monthly_fee:.2f}) / 30天 *服务天数({service_days:.3f}) = {management_fee:.2f}"
        else:
            # 否则，按费率计算
            management_fee = (daily_rate * service_days * management_fee_rate).quantize(QUANTIZER)
            log_extras["management_fee_reason"] = f"按费率计算: 日薪({daily_rate:.2f}) * 服务天数({service_days:.3f}) * 费率({management_fee_rate:.2%}) = {management_fee:.2f}"

        # 其他日志信息
        log_extras["customer_payable_reason"] = f"客户应付: 日薪({daily_rate:.2f}) * 服务天数({service_days:.3f}) = {customer_base_fee:.2f}"
        log_extras["employee_payout_reason"] = f"员工工资: 等同于客户应付金额 = {employee_base_payout:.2f}"
        # --- 修正结束 ---

        cust_increase, cust_decrease, emp_increase, emp_decrease, deferred_fee, emp_commission = (
            self._get_adjustments(bill.id, payroll.id)
        )
        
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
                new_log_extras["extension_fee_reason"] = f"延期劳务费: 日薪({daily_rate: .2f}) * 延长天数({extension_days}) = {extension_fee:.2f}"

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
                current_app.logger.info(f"[DEBUG] Calculated extension fee: {extension_fee}, new total payable: {customer_base_fee}")

        return {
            "type": "external_substitution", "level": str(level),
            "cycle_period": f"{start_date.isoformat()} to {bill_end_date.isoformat()}",
            "base_work_days": f"{service_days:.3f}", "management_fee_rate": str (management_fee_rate),
            "customer_base_fee": str(customer_base_fee), "management_fee": str (management_fee),
            "employee_base_payout": str(employee_base_payout), 
            "overtime_days": f"{overtime_days:.3f}",
            "total_days_worked": f"{service_days + overtime_days:.3f}", 
            "substitute_days":"0.00",
            "substitute_deduction": "0.00", "extension_fee": str(extension_fee),
            "customer_overtime_fee": str(overtime_fee),
            "customer_increase": str(cust_increase), "customer_decrease": str (cust_decrease), "discount": "0.00",
            "employee_overtime_payout": str(overtime_fee),
            "employee_increase": str(emp_increase),"employee_decrease": str (emp_decrease),
            "deferred_fee": str(deferred_fee), "log_extras": log_extras,
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
            employee_id = contract.service_personnel_id
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
            employee_id = contract.service_personnel_id
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

        # 计算增款项（不再包含公司代付工资和保证金代付工资）
        cust_increase = sum(
            adj.amount
            for adj in customer_adjustments
            if adj.adjustment_type in [
                AdjustmentType.CUSTOMER_INCREASE,
                AdjustmentType.INTRODUCTION_FEE,
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
                AdjustmentType.EMPLOYEE_CLIENT_PAYMENT,
                AdjustmentType.EMPLOYEE_COMMISSION_OFFSET,
            ]
        )
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

        return cust_increase, cust_decrease, emp_increase, emp_decrease, deferred_fee,emp_commission

    def _calculate_final_amounts(self, bill, payroll, details):
        current_app.logger.info("开始进行final calculation of amounts.")
        # ---客户应付总额计算("仅包含客户付给公司的费用，不含客户付给员工的费用。")
        
        # --- [核心修改] 在计算客户应付之前，先统计代付工资总额 ---
        total_paid_salary_adjustments = D(0)
        if bill: # 移除 not bill.is_substitute_bill，确保替班账单也能统计代付工资调整项
            # 统计账单上的公司代付工资和保证金代付工资调整项总额
            for adj in db.session.query(FinancialAdjustment).filter(
                FinancialAdjustment.customer_bill_id == bill.id,
                FinancialAdjustment.adjustment_type.in_([AdjustmentType.COMPANY_PAID_SALARY, AdjustmentType.DEPOSIT_PAID_SALARY])
            ).all():
                total_paid_salary_adjustments += adj.amount

        # 客户仅需支付管理费等费用，不包括已经由公司或保证金代付的工资
        total_due = (
            D(details.get("management_fee", 0))
            + D(details.get("introduction_fee", 0))
            + D(details.get("customer_increase", 0))
            + D(details.get("deferred_fee", "0.00"))
            + D(details.get("extension_fee_reason", "0.00"))
            + total_paid_salary_adjustments  # 减去所有代付的工资
            - D(details.get("customer_decrease", 0))
            - D(details.get("discount", 0))
        )
        # --- 员工应付总额计算 (核心修改点) ---
        # Gross Pay = Base + Overtime + Increase
        employee_gross_payout = (
            D(details.get("employee_base_payout", 0))
            + D(details.get("employee_overtime_payout", 0))
            + D(details.get("extension_fee", 0))
            + D(details.get("employee_increase", 0))
            # - D(details.get("substitute_deduction", 0))
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
            # Always use management_fee_reason from log_extras for substitute bills
            log["管理费"] = log_extras.get("management_fee_reason", "0.00 (不收取管理费)")
        else:
            # Main contract types
            customer_daily_rate_formula = f"级别({level:.2f})/26"
            if calc_type == "nanny":
                employee_daily_rate_formula = f"级别({level:.2f}) / 26"
                log["基础劳务费"] = (
                    f"{employee_daily_rate_formula} * 基本劳务天数({base_work_days:.3f}) = {d.get('employee_base_payout', 0):.2f}"
                )
                log["加班费"] = (
                    f"{employee_daily_rate_formula} * 加班天数({overtime_days:.3f}) = {d.get('employee_overtime_payout', 0):.2f}"
                )
                log["客户侧加班费"] = (
                    f"{customer_daily_rate_formula} * 加班天数({overtime_days:.3f}) = {d.get('customer_overtime_fee', 0):.2f}"
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
                    f"{customer_daily_rate_formula} * 基本劳务天数({base_work_days:.3f}) = {d.get('customer_base_fee', 0):.2f}"
                )
                if overtime_days > 0:
                    log["加班费"] = (
                        f"({log_extras.get('customer_overtime_daily_rate_reason', '客户加班日薪')}) * 加班天数({overtime_days:.3f}) = {d.get('customer_overtime_fee', 0):.2f}"
                    )
                if calc_type == "maternity_nurse":
                    log["管理费"] = log_extras.get("management_fee_reason", "N/A")
                    log["管理费率"] = log_extras.get(
                        "management_fee_rate_reason", "N/A"
                    )
                    log["基础劳务费"] = (
                        f"({log_extras.get('employee_daily_rate_reason', '员工日薪')}) * 基本劳务天数({base_work_days:.3f}) = {d.get('customer_base_fee', 0):.2f}"
                    )
                    log["加班费"] = (
                        f"({log_extras.get('customer_overtime_daily_rate_reason', '客户加班日薪')}) * 加班天数({overtime_days:.3f}) = {d.get('customer_overtime_fee', 0):.2f}"
                    )
                    log["萌嫂保证金(工资)"] = (
                        f"({log_extras.get('employee_daily_rate_reason', '员工日薪')}) * 基本劳务天数({base_work_days:.3f}) = {d.get('employee_base_payout', 0):.2f}"
                    )
                if calc_type == "nanny_trial_termination":
                    log["基础劳务费"] = (
                        f"员工日薪({level:.2f}) * 基本劳务天数({base_work_days:.3f}) = {d.get('customer_base_fee', 0):.2f}"
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
        current_app.logger.info(f"--- [DEBUG] Entered _update_bill_with_log for bill ID: {bill.id} ---")
        if details:
            current_app.logger.info(f"--- [DEBUG] Keys in details dict: {list(details.keys())} ---")
            if details.get("log_extras"):
                current_app.logger.info(f"--- [DEBUG] Keys in log_extras: {list(details['log_extras'].keys())} ---")
        else:
            current_app.logger.warning(f"--- [DEBUG] details dictionary is empty or None for bill ID: {bill.id} ---")
        details["calculation_log"] = log
        current_app.logger.info(f"[SAVE-CHECK] Bill ID {bill.id}: log_extras to be saved: {details.get('log_extras')}")
        bill.calculation_details = details
        payroll.calculation_details = details.copy()

        attributes.flag_modified(bill, "calculation_details")
        attributes.flag_modified(payroll, "calculation_details")

        db.session.add(bill)
        db.session.add(payroll)

        return bill, payroll

    def _calculate_nanny_trial_termination_details(self, contract,actual_trial_days, bill, payroll, actual_work_days_override=None):
        """为试工失败结算生成详细的计算字典 (v17 - 月薪取整逻辑)。"""
        QUANTIZER = D("0.01")
        level = D(contract.employee_level or 0) # level 在试工合同中代表日薪
        
        log_extras = {}
        if actual_work_days_override is not None:
            days = D(actual_work_days_override)
            log_extras["base_work_days_reason"] = f"使用用户传入的实际劳务天数 ({actual_work_days_override:.3f})"
            bill.actual_work_days = actual_work_days_override
            payroll.actual_work_days = actual_work_days_override
        else:
            days = D(actual_trial_days)
            log_extras["base_work_days_reason"] = f"默认逻辑: 合同周期天数({actual_trial_days})"


        # 核心修正：应用新的月薪取整规则
        original_daily_rate = level.quantize(QUANTIZER)
        provisional_monthly_salary = original_daily_rate * 26
        # 四舍五入到百位
        rounded_monthly_salary = D(round(provisional_monthly_salary, -2))
        # 基于取整后的月薪，反算出一个用于后续计算的、更精确的日薪
        final_daily_rate = (rounded_monthly_salary / D(26))

        # 获取考勤，计算加班
        attendance = self._get_or_create_attendance(contract,contract.start_date, contract.end_date)
        overtime_days = D(attendance.overtime_days)
        # 使用修正后的日薪计算加班费
        overtime_fee = (final_daily_rate * overtime_days).quantize(QUANTIZER)

        # 使用修正后的日薪和月薪计算基础劳务费和管理费
        base_fee = (final_daily_rate * days).quantize(QUANTIZER)
        # 获取管理费率，如果合同上没有，则默认为10%
        management_fee_rate = D(contract.management_fee_rate if contract.management_fee_rate is not None else '0.1')
        management_fee = (rounded_monthly_salary * management_fee_rate / 30 * days).quantize(QUANTIZER)

        current_app.logger.info(f"[TrialTerm-v17] 计算试工合同 {contract.id} 结算细节: 级别 {level}, 取整后日薪 {final_daily_rate}, 试工天数 {days}, 加班天数 {overtime_days}, 基础费 {base_fee}, 加班费 {overtime_fee},管理费率{management_fee_rate}, 管理费 {management_fee}")
        
        cust_increase, cust_decrease, emp_increase, emp_decrease, deferred_fee, emp_commission = (
            self._get_adjustments(bill.id, payroll.id)
        )
        
        # 合并日志
        log_extras.update({
            "salary_rounding_reason": f"临时月薪({original_daily_rate:.2f}*26 = {provisional_monthly_salary:.2f}) 取整为 {rounded_monthly_salary:.2f}。所有费用基于此计算。",
            "management_fee_reason": f"取整后月薪({rounded_monthly_salary:.2f})/30天 * {management_fee_rate:.0%} * 试工天数({days:.3f}) = {management_fee:.2f}",
            "employee_payout_reason": f"取整后日薪({final_daily_rate:.4f}) * 试工天数({days:.3f}) = {base_fee:.2f}",
            "overtime_fee_reason": f"取整后日薪({final_daily_rate:.4f}) * 加班天数({overtime_days:.3f}) = {overtime_fee:.2f}"
        })
        total_days_worked = days + overtime_days
        details = {
            "type": "nanny_trial_termination",
            "level": str(level),
            "cycle_period": f"{contract.start_date.isoformat()} to {contract.end_date.isoformat()}",
            "base_work_days": f"{days:.3f}",
            "overtime_days": f"{overtime_days:.3f}",
            "total_days_worked": f"{total_days_worked:.3f}",
            "daily_rate": str(final_daily_rate.quantize(QUANTIZER)),
            "customer_base_fee": str(base_fee),
            "employee_base_payout": str(base_fee),
            "customer_overtime_fee": str(overtime_fee),
            "employee_overtime_payout": str(overtime_fee),
            "management_fee": str(management_fee),
            "introduction_fee": str(contract.introduction_fee or "0.00"),
            "notes": contract.notes or "",
            "customer_increase": str(cust_increase),
            "customer_decrease": str(cust_decrease),
            "employee_increase": str(emp_increase),
            "employee_decrease": str(emp_decrease),
            "employee_commission": str(emp_commission),
            "first_month_deduction": "0.00",
            "discount": "0.00",
            "substitute_deduction": "0.00",
            "log_extras": log_extras,
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

            # 新增：为试工失败合同添加“公司代付工资”
            # [V6] 为试工合同更新或创建“公司代付工资”项
            # 1. 根据新需求计算金额: min(应发总额, 月薪)
            total_payout = payroll.total_due
            # 重新计算取整后的月薪
            original_daily_rate = D(contract.employee_level or '0')
            provisional_monthly_salary = original_daily_rate * 26
            rounded_monthly_salary = D(round(provisional_monthly_salary, -2))
            
            amount_to_set = min(total_payout, rounded_monthly_salary).quantize(D("1"))
            current_app.logger.info(f"[UPSERT_DEBUG-TRIAL] 应发总额: {total_payout}, 月薪: {rounded_monthly_salary}, 计算出的代付金额: {amount_to_set}")

            # 2. 只查找并更新由本系统创建的特定调整项
            existing_system_adj = FinancialAdjustment.query.filter_by(
                customer_bill_id=bill.id,
                adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
                description="[系统] 公司代付工资"
            ).first()

            should_recalculate = False
            if existing_system_adj:
                # 如果系统创建的项已存在，且金额不匹配，则更新它
                if existing_system_adj.amount != amount_to_set:
                    current_app.logger.info(f"[UPSERT_DEBUG-TRIAL] 系统项已存在，更新金额: {existing_system_adj.amount} -> {amount_to_set}")
                    existing_system_adj.amount = amount_to_set
                    db.session.add(existing_system_adj)
                    # (V18) 同步镜像调整项
                    # _mirror_company_paid_salary_adjustment(existing_system_adj, payroll)
                    should_recalculate = True
            else:
                # 如果系统创建的项不存在，检查是否已有任何手动的“公司代付工资”项
                any_other_salary_adj = FinancialAdjustment.query.filter(
                    FinancialAdjustment.customer_bill_id == bill.id,
                    FinancialAdjustment.adjustment_type == AdjustmentType.COMPANY_PAID_SALARY
                ).first()

                if not any_other_salary_adj and amount_to_set > 0:
                    # 仅当任何同类型调整项都不存在时，才创建系统项
                    current_app.logger.info(f"[UPSERT_DEBUG-TRIAL] 系统项和手动项均不存在，创建新的系统项，金额: {amount_to_set}")
                    new_adj = FinancialAdjustment(
                        customer_bill_id=bill.id,
                        adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
                        amount=amount_to_set,
                        description="[系统] 公司代付工资", # <--- 使用正确描述
                        date=bill.cycle_end_date.date()
                    )
                    db.session.add(new_adj)
                    # (V18) 同步镜像调整项
                    # _mirror_company_paid_salary_adjustment(new_adj, payroll)
                    should_recalculate = True
                else:
                    current_app.logger.info("[UPSERT_DEBUG-TRIAL] 已存在手动代付工资项，系统不进行任何操作。")

            # 3. 如果金额发生了更新或创建，则重新计算账单
            if should_recalculate:
                current_app.logger.info(f"[UPSERT_DEBUG-TRIAL] 因“公司代付工资”项变动，重新计算账单 {bill.id}")
                details = self._calculate_nanny_trial_termination_details(contract, actual_trial_days, bill, payroll)
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

    def create_final_salary_adjustments(self, bill_id: str, allow_creation: bool = True):
        current_app.logger.info(f"!!! ENGINE CALL !!! create_final_salary_adjustments called for bill {bill_id} with allow_creation={allow_creation}")
        """
        为给定的最后一个月账单创建“公司代付工资”及其镜像调整项。
        此函数是幂等的：如果调整项已存在，它会检查并更新金额；如果不存在，则创建。
        """
        from backend.services.contract_service import _find_successor_contract_internal
        bill = db.session.get(CustomerBill, bill_id)
        if _find_successor_contract_internal(bill.contract_id):
            current_app.logger.info(
                f"合同 {bill.contract_id} 存在后续合同，跳过最终薪资结算调整项的创建。"
            )
            return
        if not bill:
            current_app.logger.error(f"[FinalAdj] 找不到账单ID: {bill_id}")
            return

        contract = bill.contract
        payroll = EmployeePayroll.query.filter_by(
            contract_id=contract.id,
            cycle_start_date=bill.cycle_start_date,
            is_substitute_payroll=bill.is_substitute_bill
        ).first()

        if not payroll:
            current_app.logger.error(f"[FinalAdj] 找不到与账单 {bill_id} 关联的薪酬单。")
            return

        gross_pay = payroll.total_due
        amount_to_set = D('0')

        if contract.type == 'nanny_trial':
            amount_to_set = gross_pay.quantize(D("1"))
        else:
            employee_level = D(contract.employee_level or '0')
            amount_to_set = min(gross_pay, employee_level).quantize(D("1"))

        existing_adj = FinancialAdjustment.query.filter_by(
            customer_bill_id=bill.id,
            adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
            description="[系统] 公司代付工资"
        ).first()

        adjustment_was_changed = False

        if amount_to_set <= 0:
            current_app.logger.info(f"[FinalAdj] 计算出的代付金额为0或更少，为账单 {bill_id} 清理可能存在的旧调整项。")
            if existing_adj:
                if existing_adj.mirrored_adjustment:
                    db.session.delete(existing_adj.mirrored_adjustment)
                db.session.delete(existing_adj)
                adjustment_was_changed = True
        else:
            if existing_adj:
                if existing_adj.amount != amount_to_set:
                    current_app.logger.info(f"[FinalAdj] 更新公司代付工资 for bill {bill.id}: {existing_adj.amount} -> {amount_to_set}")
                    existing_adj.amount = amount_to_set
                    db.session.add(existing_adj)
                    self._mirror_company_paid_salary_adjustment(existing_adj, payroll)
                    adjustment_was_changed = True
            elif allow_creation:
                current_app.logger.info(f"[FinalAdj] 创建新的公司代付工资 for bill {bill.id}: {amount_to_set}")
                new_adj = FinancialAdjustment(
                    customer_bill_id=bill.id,
                    adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
                    amount=amount_to_set,
                    description="[系统] 公司代付工资",
                    date=bill.cycle_end_date
                )
                db.session.add(new_adj)
                self._mirror_company_paid_salary_adjustment(new_adj, payroll)
                adjustment_was_changed = True

        if adjustment_was_changed:
            current_app.logger.info(f"[FinalAdj] 公司代付工资调整项已变更，为账单 {bill.id } 触发重算。")
            db.session.flush()

            details = {}
            if contract.type == 'nanny_trial':
                trial_days = (self._to_date(contract.end_date) - self ._to_date(contract.start_date)).days
                details = self._calculate_nanny_trial_termination_details(contract, trial_days, bill, payroll, bill.actual_work_days)
            elif contract.type == 'nanny':
                details = self._calculate_nanny_details(contract, bill, payroll, bill.actual_work_days)
            else:
                current_app.logger.error(f"[FinalAdj] Recalculation for contract type ' {contract.type}' is not implemented.")

            if details:
                final_bill, final_payroll = self._calculate_final_amounts(bill, payroll, details)
                log = self._create_calculation_log(details)
                self._update_bill_with_log(final_bill, final_payroll, details, log)
                current_app.logger.info(f"[FinalAdj] 账单 {bill.id} 重算完成。")
            else:
                 current_app.logger.warning(f"[FinalAdj] Details for bill {bill.id} could not be calculated, skipping finalization.")

    def _mirror_company_paid_salary_adjustment(self, company_adj: FinancialAdjustment, payroll:EmployeePayroll):
        """
        (V18) 创建或更新'公司代付工资'的镜像调整项'保证金支付工资'。
        确保两条记录互相关联，且金额相反。
        """
        if not company_adj or not payroll:
            return

        if isinstance(payroll.contract, NannyTrialContract):
            current_app.logger.info(f"[MIRROR_ADJ] 合同 {payroll.contract.id} 是试工合同，跳过创建镜像调整项。")
            return

        mirrored_adj = company_adj.mirrored_adjustment
        new_amount = company_adj.amount

        if mirrored_adj:
            if mirrored_adj.amount != new_amount:
                current_app.logger.info(f"[MIRROR_ADJ] Updating mirrored adjustment {mirrored_adj.id} amount from {mirrored_adj.amount} to {new_amount}")
                mirrored_adj.amount = new_amount
                db.session.add(mirrored_adj)
        else:
            current_app.logger.info(f"[MIRROR_ADJ] Creating new mirrored adjustment for company adjustment {company_adj.id}")
            new_adj = FinancialAdjustment(
                employee_payroll_id=payroll.id,
                adjustment_type=AdjustmentType.DEPOSIT_PAID_SALARY,
                amount=new_amount,
                description="[系统] 保证金支付工资",
                date=company_adj.date,
                mirrored_adjustment_id=company_adj.id
            )
            db.session.add(new_adj)
            db.session.flush()
            company_adj.mirrored_adjustment_id = new_adj.id
            db.session.add(company_adj)
    
    def process_trial_conversion(self, trial_contract_id: str, formal_contract_id: str,operator_id: str, conversion_costs: dict = None):
        """
        V22 (最终修复版): 处理试工转正。
        1. 为成功的试工合同创建并结算其自身的账单。
        2. 在试工账单上冲销与正式合同重叠的费用。
        3. 将非重叠费用结转至正式合同，并将试工账单清零。
        """
        current_app.logger.info(f"--- [TRIAL_CONVERT_START] 试工合同 {trial_contract_id} -> 正式合同 {formal_contract_id} ---")
        trial_contract = db.session.get(NannyTrialContract, trial_contract_id)
        if not trial_contract:
            raise ValueError(f"试工合同 {trial_contract_id} 未找到。")

        formal_contract = db.session.get(NannyContract, formal_contract_id)
        if not formal_contract:
            raise ValueError(f"正式合同 {formal_contract_id} 未找到。")

        if trial_contract.trial_outcome != TrialOutcome.PENDING:
            raise ValueError("该试工合同已被处理，无法再次转换。")

        # 步骤 1: 更新合同状态
        trial_contract.trial_outcome = TrialOutcome.SUCCESS
        trial_contract.status = 'finished'
        formal_contract.source_trial_contract_id = trial_contract.id
        current_app.logger.info(f"[TRIAL_CONVERT_LOG] 1. 合同状态已更新。")

        # 步骤 2: 为成功的试工合同创建并结算其自身的账单
        trial_days = (self._to_date(trial_contract.end_date) - self._to_date(trial_contract.start_date)).days + 1
        term_date = self._to_date(trial_contract.end_date)

        trial_bill, trial_payroll = self._get_or_create_bill_and_payroll(
            trial_contract, term_date.year, term_date.month, trial_contract.start_date,term_date
        )

        details = self._calculate_nanny_trial_termination_details(trial_contract, trial_days,trial_bill, trial_payroll)
        self._calculate_final_amounts(trial_bill, trial_payroll, details)
        log = self._create_calculation_log(details)
        self._update_bill_with_log(trial_bill, trial_payroll, details, log)
        db.session.commit()
        current_app.logger.info(f"[TRIAL_CONVERT_LOG] 2. 试工账单创建并初次结算完成。")
        current_app.logger.info(f"   -> 初始客户应付 (trial_bill.total_due): {trial_bill.total_due}")
        current_app.logger.info(f"   -> 初始员工应发 (trial_payroll.total_due): {trial_payroll.total_due}")

        # 步骤 3: 准备正式合同的账单
        first_bill = CustomerBill.query.filter_by(contract_id=formal_contract.id,is_substitute_bill=False).order_by(CustomerBill.cycle_start_date.asc()).first()
        first_payroll = EmployeePayroll.query.filter_by(contract_id=formal_contract.id,is_substitute_payroll=False).order_by(EmployeePayroll.cycle_start_date.asc()).first()

        if not first_bill or not first_payroll:
            self.generate_all_bills_for_contract(formal_contract.id)
            first_bill = CustomerBill.query.filter_by(contract_id=formal_contract.id,is_substitute_bill=False).order_by(CustomerBill.cycle_start_date.asc()).first()
            first_payroll = EmployeePayroll.query.filter_by(contract_id=formal_contract.id,is_substitute_payroll=False).order_by(EmployeePayroll.cycle_start_date.asc()).first()
            if not first_bill or not first_payroll:
                raise Exception(f"无法为正式合同 {formal_contract.id} 找到或创建第一个账单/薪酬单。")

        # 步骤 4: 计算重叠与非重叠天数
        trial_start = self._to_date(trial_contract.start_date)
        trial_end = self._to_date(trial_contract.end_date)
        formal_start = self._to_date(formal_contract.start_date)

        non_overlap_days = 0
        if formal_start > trial_start:
            non_overlap_end = min(trial_end, formal_start - timedelta(days=1))
            if non_overlap_end >= trial_start:
                non_overlap_days = (non_overlap_end - trial_start).days + 1

        overlap_days = 0
        if formal_start <= trial_end:
            overlap_start = max(trial_start, formal_start)
            overlap_end = trial_end
            if overlap_end >= overlap_start:
                overlap_days = (overlap_end - overlap_start).days

        non_overlap_days = max(0, non_overlap_days)
        overlap_days = max(0, overlap_days)
        current_app.logger.info(f"[TRIAL_CONVERT_LOG] 4. 重叠天数: {overlap_days}, 非重叠天数: {non_overlap_days}")

        # 步骤 5: 在【试工账单】上冲销【重叠期】的费用
        if overlap_days > 0:
            trial_daily_rate = D(trial_contract.employee_level or '0')
            overlap_salary = (trial_daily_rate * D(overlap_days)).quantize(D("0.01"))

            trial_monthly_rate = trial_daily_rate * 26
            # 获取管理费率，如果合同上没有，则默认为10%
            management_fee_rate = D(trial_contract.management_fee_rate if trial_contract.management_fee_rate is not None else '0.1')
            overlap_mgmt_fee = (trial_monthly_rate * management_fee_rate / 30*D(overlap_days)).quantize(D("0.01"))
            current_app.logger.info(f"[TRIAL_CONVERT_LOG] 5. 计算出重叠期冲抵金额: 工资={overlap_salary}, 管理费={overlap_mgmt_fee}")

            if overlap_salary > 0:
                db.session.add(FinancialAdjustment(
                    employee_payroll_id=trial_payroll.id,
                    adjustment_type=AdjustmentType.EMPLOYEE_DECREASE,
                    amount=overlap_salary,
                    description=f"[系统] 转正冲抵重叠期工资 ({overlap_days}天)",
                    date=trial_bill.cycle_end_date
                ))
            if overlap_mgmt_fee > 0:
                db.session.add(FinancialAdjustment(
                    customer_bill_id=trial_bill.id,
                    adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
                    amount=overlap_mgmt_fee,
                    description=f"[系统] 转正冲抵重叠期管理费 ({overlap_days}天)",
                    date=trial_bill.cycle_end_date
                ))

        # 步骤 6: 重新计算试工账单，以确定非重叠部分的准确余额
        current_app.logger.info(f"[TRIAL_CONVERT_LOG] 6. 准备对试工账单进行中期重算...")
        self.calculate_for_month(year=trial_bill.year, month=trial_bill.month,contract_id=trial_contract.id, force_recalculate=True)
        db.session.commit()
        db.session.refresh(trial_bill)
        db.session.refresh(trial_payroll)
        current_app.logger.info(f"   -> 中期重算后客户应付 (trial_bill.total_due): {trial_bill.total_due}")
        current_app.logger.info(f"   -> 中期重算后员工应发 (trial_payroll.total_due): {trial_payroll.total_due}")

        # 步骤 7: 将【非重叠期】的费用（即试工账单的当前余额）转移到【正式合同】
        non_overlap_salary = trial_payroll.total_due
        non_overlap_mgmt_fee = trial_bill.total_due
        current_app.logger.info(f"[TRIAL_CONVERT_LOG] 7. 计算出非重叠期余额并准备转移: 工资={non_overlap_salary}, 管理费={non_overlap_mgmt_fee}")

        if non_overlap_salary > 0:
            db.session.add(FinancialAdjustment(
                employee_payroll_id=first_payroll.id,
                adjustment_type=AdjustmentType.EMPLOYEE_CLIENT_PAYMENT,
                amount=non_overlap_salary,
                description=f"[客户直付] 试工劳务费 (非重叠期 {non_overlap_days} 天)",
                date=first_payroll.cycle_start_date,
                details={"source_trial_contract_id": str(trial_contract.id)}
            ))
            db.session.add(FinancialAdjustment(
                employee_payroll_id=trial_payroll.id,
                adjustment_type=AdjustmentType.EMPLOYEE_DECREASE,
                amount=non_overlap_salary,
                description=f"[系统] 试工成功,非重叠{non_overlap_days}天工资转至正式合同",
                date=trial_bill.cycle_end_date
            ))

        if non_overlap_mgmt_fee > 0:
            db.session.add(FinancialAdjustment(
                customer_bill_id=first_bill.id,
                adjustment_type=AdjustmentType.CUSTOMER_INCREASE,
                amount=non_overlap_mgmt_fee,
                description=f"[系统] 从试工合同转入非重叠期管理费 ({non_overlap_days}天)",
                date=first_bill.cycle_start_date,
                details={"source_trial_contract_id": str(trial_contract.id)}
            ))
            db.session.add(FinancialAdjustment(
                customer_bill_id=trial_bill.id,
                adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
                amount=non_overlap_mgmt_fee,
                description=f"[系统] 试工成功,非重叠{non_overlap_days}天管理费转至正式合同",
                date=trial_bill.cycle_end_date
            ))

        # 步骤 8: 处理【介绍费】
        introduction_fee = D(trial_contract.introduction_fee or '0')
        if introduction_fee > 0:
            current_app.logger.info(f"[TRIAL_CONVERT_LOG] 8. 处理介绍费: {introduction_fee}")
            # 转移介绍费 不显示为已支付
            # intro_fee_adj = FinancialAdjustment(customer_bill_id=first_bill.id,adjustment_type=AdjustmentType.INTRODUCTION_FEE, amount=introduction_fee, description=f"[系统]来自试工合同的介绍费", date=first_bill.cycle_start_date, is_settled=True,settlement_date=trial_contract.start_date, details={"source_trial_contract_id": str(trial_contract.id)})
            intro_fee_adj = FinancialAdjustment(customer_bill_id=first_bill.id,adjustment_type=AdjustmentType.INTRODUCTION_FEE, amount=introduction_fee, description=f"[系统]来自试工合同的介绍费", date=first_bill.cycle_start_date, is_settled=False, details={"source_trial_contract_id": str(trial_contract.id)})
            db.session.add(intro_fee_adj)

            # 转移介绍费 不显示为已支付
            # payment_for_intro_fee = PaymentRecord(customer_bill_id=first_bill.id,amount=introduction_fee, payment_date=trial_contract.start_date, method='TRIAL_FEE_TRANSFER',notes=f"[系统] 试工合同 介绍费转入", created_by_user_id=operator_id)
            # db.session.add(payment_for_intro_fee)

        # 步骤 9: 最终重算，并提交
        current_app.logger.info(f"[TRIAL_CONVERT_LOG] 9. 准备对两个关联合同的账单进行最终重算。")
        db.session.commit()
        self.calculate_for_month(year=trial_bill.year, month=trial_bill.month,contract_id=trial_contract.id, force_recalculate=True)
        self.calculate_for_month(year=first_bill.year, month=first_bill.month,contract_id=formal_contract.id, force_recalculate=True)
        db.session.commit()
        current_app.logger.info(f"--- [TRIAL_CONVERT_END] 流程结束。 ---")

    def delete_payment_record_and_reverse_allocation(payment_id):
        """
        (Service Function) Deletes a payment record and reverses its financial impact.
        DOES NOT COMMIT the transaction. The caller is responsible for the session commit.
        Returns the objects that were modified for logging purposes.
        """
        payment = db.session.get(PaymentRecord, payment_id)
        if not payment:
            raise ValueError(f"Payment record with ID {payment_id} not found.")

        bill = payment.customer_bill
        transaction = payment.bank_transaction

        # Reverse impact on CustomerBill
        if bill:
            bill.total_paid = (bill.total_paid or D(0)) - payment.amount
            _update_bill_payment_status(bill)

        # Reverse impact on BankTransaction
        if transaction:
            transaction.allocated_amount = (transaction.allocated_amount or D(0)) - payment.amount
            # 核心修正：使用导入的 Enum 成员，而不是字符串
            if transaction.allocated_amount <= 0:
                transaction.status = BankTransactionStatus.UNMATCHED
                transaction.allocated_amount = D('0')
            else:
                transaction.status = BankTransactionStatus.PARTIALLY_ALLOCATED
            db.session.add(transaction)

        current_app.logger.info(f"Payment record {payment_id} and its effects will be deleted from session upon commit.")
        db.session.delete(payment)

        return bill, transaction





def calculate_substitute_management_fee(sub_record, main_contract, contract_termination_date=None):
    """
    计算替班记录的管理费。
    管理费只在替班超出主合同服务期时产生。
    """
    # 如果是未终止的自动续签合同，则无论如何都不产生合同外的管理费
    if getattr(main_contract, 'is_monthly_auto_renew', False) and not main_contract.termination_date:
        return D("0")

    QUANTIZER = D("0.01")
    # 从记录中动态获取费率，如果不存在则默认为0
    management_fee_rate = D(sub_record.substitute_management_fee_rate or 0)

    # 如果费率为0，则无需计算，直接返回0
    if management_fee_rate <= 0:
        return D("0")

    current_app.logger.debug(f"[CalcSubFee] sub_record ID: {sub_record.id}") # 添加此日志
    current_app.logger.debug(f"[CalcSubFee] sub_start: {sub_record.start_date}, sub_end: {sub_record.end_date}") # 添加此日志

    # 替班的开始和结束日期 (保持为 datetime 对象)
    sub_start = sub_record.start_date
    sub_end = sub_record.end_date

    # 主合同的有效结束日期
    # 如果有传入合同终止日期，则以终止日期为准，否则以合同的结束日期或预期下户日期为准
    if contract_termination_date:
        contract_end = contract_termination_date
        current_app.logger.debug(f"[CalcSubFee] Using contract_termination_date: {contract_end}")# 添加此日志
    else:
        contract_end = main_contract.termination_date or main_contract.end_date
        current_app.logger.debug(f"[CalcSubFee] Using main_contract end_date/termination_date: {contract_end}") # 添加此日志

    # 确保 contract_end 是 datetime 对象，如果它是 date 对象，则转换为午夜的 datetime
    if isinstance(contract_end, date) and not isinstance(contract_end, datetime):
        contract_end = datetime(contract_end.year, contract_end.month, contract_end.day, 0, 0, 0,tzinfo=sub_start.tzinfo)
        current_app.logger.debug(f"[CalcSubFee] Converted contract_end to datetime: {contract_end}") # 添加此日志
    elif isinstance(contract_end, date): # 如果它已经是 datetime，但来自日期字段，请确保 tzinfo
        contract_end = contract_end.replace(tzinfo=sub_start.tzinfo)
        current_app.logger.debug(f"[CalcSubFee] Ensured tzinfo for contract_end: {contract_end}")# 添加此日志


    # 计算管理费的起始日期：替班开始日期和主合同结束日期中的较晚者
    # 只有替班超出主合同的部分才计算管理费
    billing_start_date = max(contract_end, sub_start)
    current_app.logger.debug(f"[CalcSubFee] billing_start_date: {billing_start_date}") # 添加此日志

    # 如果替班的结束日期早于或等于管理费计算的起始日期，则不产生管理费
    if sub_end <= billing_start_date:
        current_app.logger.debug(f"[CalcSubFee] sub_end ({sub_end}) <= billing_start_date ({billing_start_date}), returning 0 fee.") # 添加此日志
        return D("0")

    # 计算需要收取管理费的天数
    # 这里需要精确到小时分钟
    time_difference = sub_end - billing_start_date
    billable_days = D(time_difference.total_seconds()) / D(86400)
    current_app.logger.debug(f"[CalcSubFee] time_difference: {time_difference}, billable_days: {billable_days}") # 添加此日志

    # 替班员工的月薪
    substitute_level = D(sub_record.substitute_salary)

    # 计算管理费
    # 月薪 / 30天 * 费率 * 天数
    management_fee = (substitute_level / D(30) * management_fee_rate *billable_days).quantize(QUANTIZER)
    current_app.logger.debug(f"[CalcSubFee] Calculated management_fee: {management_fee}") # 添加此日志

    return management_fee