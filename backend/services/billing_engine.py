# backend/services/billing_engine.py

from flask import current_app
from datetime import date, timedelta
import decimal
import calendar
from dateutil.relativedelta import relativedelta

from backend.extensions import db
from backend.models import (
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
)

from sqlalchemy import func
from sqlalchemy.orm import attributes
from sqlalchemy.exc import IntegrityError

D = decimal.Decimal
CTX = decimal.Context(prec=10)


class BillingEngine:
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

    def calculate_for_month(
        self, year: int, month: int, contract_id=None, force_recalculate=False, actual_work_days_override=None, cycle_start_date_override=None
    ):
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
                    contract, year, month, force_recalculate, actual_work_days_override
                )
            elif contract.type == "nanny_trial":
                self._calculate_nanny_trial_bill(
                    contract, year, month, force_recalculate
                )

    def generate_all_bills_for_contract(self, contract_id, force_recalculate=True):
        """
        Generates or recalculates all bills for the entire lifecycle of a single contract.
        """
        contract = db.session.get(BaseContract, contract_id)
        if not contract:
            current_app.logger.error(
                f"[FullLifecycle] Contract {contract_id} not found."
            )
            return

        current_app.logger.info(
            f"[FullLifecycle] Starting bill generation for contract {contract.id} ({contract.type})."
        )

            # --- Gemini-generated code: Start (v4 - Final) ---
        # 核心修改：简化育儿嫂试工合同的初始账单逻辑
        if isinstance(contract, NannyTrialContract):
            current_app.logger.info(f"[FullLifecycle] 合同 {contract.id} 是试工合同，跳过初始账单生成。")
            return
        # --- Gemini-generated code: End (v4 - Final) ---

        # Determine the date range to iterate over
        if contract.type == "maternity_nurse":
            start_date = contract.actual_onboarding_date
            end_date = contract.expected_offboarding_date or contract.end_date
        else:  # nanny 
            start_date = contract.start_date
            end_date = contract.end_date

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
        actual_trial_days = (bill.cycle_end_date - bill.cycle_start_date).days + 1

        current_app.logger.info(f"[TrialRECALC] 从账单 {bill.id} 推算出实际试工天数: {actual_trial_days}")

        # 调用包含最终正确业务逻辑的主函数，进行重算
        self.process_trial_termination(contract, actual_trial_days)

        current_app.logger.info(f"[TrialRECALC] 合同 {contract.id} 的重新计算已完成。")

    def _calculate_nanny_trial_details(self, contract, bill, payroll):
        """计算育儿嫂试工合同的所有财务细节。"""
        QUANTIZER = D("0.01")
        level = D(contract.employee_level or 0)
        cycle_start = bill.cycle_start_date
        cycle_end = bill.cycle_end_date

        attendance = self._get_or_create_attendance(contract, cycle_start, cycle_end)
        overtime_days = D(attendance.overtime_days)
        cust_increase, cust_decrease, emp_increase, emp_decrease = (
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
            "management_fee": "0.00",
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

    def _calculate_nanny_bill_for_month(
        self, contract: NannyContract, year: int, month: int, force_recalculate=False, actual_work_days_override=None, end_date_override=None
    ):
        """育儿嫂计费逻辑的主入口。"""
        current_app.logger.info(
            f"  [NannyCALC] 开始处理育儿嫂合同 {contract.id} for {year}-{month}"
        )
        bill_to_recalculate = None
        if force_recalculate:
            # 尝试找到与当前年月匹配的现有账单
            bill_to_recalculate = CustomerBill.query.filter_by(
                contract_id=contract.id,
                year=year,
                month=month,
                is_substitute_bill=False
            ).first()

        if bill_to_recalculate:
            # 如果找到了要重算的账单，就用它的周期
            cycle_start = bill_to_recalculate.cycle_start_date
            cycle_end = bill_to_recalculate.cycle_end_date
            current_app.logger.info(f"    [NannyCALC] 强制重算，使用现有账单 {bill_to_recalculate.id} 的周期: {cycle_start} to {cycle_end}")
        else:
            # 否则（非重算或重算但未找到账单），按常规逻辑推导周期
            cycle_start, cycle_end = self._get_nanny_cycle_for_month(contract, year, month, end_date_override)
        current_app.logger.info(f" cycle_start: {cycle_start}")
        if not cycle_start:
            current_app.logger.info(
                f"    [NannyCALC] 合同 {contract.id} {contract.customer_name} {contract.jinshuju_entry_id} {contract.start_date} {contract.end_date} 在 {year}-{month} 无需创建账单，跳过。"
            )
            return

        bill, payroll = self._get_or_create_bill_and_payroll(
            contract, year, month, cycle_start, cycle_end
        )

        if (
            not force_recalculate
            and bill.calculation_details
            and "calculation_log" in bill.calculation_details
        ):
            current_app.logger.info(
                f"    [NannyCALC] 合同 {contract.id} 的账单已存在且无需重算，跳过。"
            )
            return

        current_app.logger.info(
            f"    [NannyCALC] 为合同 {contract.id} 执行计算 (周期: {cycle_start} to {cycle_end})"
        )

        details = self._calculate_nanny_details(contract, bill, payroll, actual_work_days_override)
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)
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
        if not contract.actual_onboarding_date or not contract.end_date:
            return None, None

        cycle_start = contract.actual_onboarding_date
        contract_end = contract.expected_offboarding_date or contract.end_date

        while cycle_start < contract_end:
            cycle_end = cycle_start + timedelta(days=26)
            if cycle_end > contract_end:
                cycle_end = contract_end

            # 检查周期的任何部分是否与目标月份重叠
            if (
                (cycle_start.year == year and cycle_start.month == month)
                or (cycle_end.year == year and cycle_end.month == month)
                or (
                    cycle_start < date(year, month, 1)
                    and cycle_end
                    > date(year, month, calendar.monthrange(year, month)[1])
                )
            ):
                return cycle_start, cycle_end

            if cycle_end >= contract_end:
                break

            cycle_start = cycle_end

        return None, None

    def _calculate_nanny_details(
        self, contract: NannyContract, bill: CustomerBill, payroll: EmployeePayroll, actual_work_days_override=None
    ):
        """计算育儿嫂合同的所有财务细节。"""
        log_extras = {}
        QUANTIZER = D("0.01")
        level = D(contract.employee_level or 0)
        cycle_start = bill.cycle_start_date
        cycle_end = bill.cycle_end_date
        # 月管理费从合同获取 xxxx.xx元/月
        management_fee_amount = D(contract.management_fee_amount or 0)

        attendance = self._get_or_create_attendance(contract, cycle_start, cycle_end)
        overtime_days = D(attendance.overtime_days)

        # 在这里处理保证金，然后再获取调整项
        self._handle_security_deposit(contract, bill)
        db.session.flush()
        cust_increase, cust_decrease, emp_increase, emp_decrease, deferred_fee = (
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

        is_last_bill = contract.end_date and cycle_end == contract.end_date

        cycle_actual_days = (cycle_end - cycle_start).days
        if is_last_bill:  # 育儿嫂最后一个月账单天数 +1
            cycle_actual_days += 1
        is_first_bill = cycle_start == contract.start_date
        if is_first_bill:  # 育儿嫂最后一个月账单天数 +1
            cycle_actual_days = (cycle_end - cycle_start).days
        
        # --- NEW LOGIC for actual_work_days ---
        # 优先使用从API传入的覆盖值
        if actual_work_days_override is not None:
            base_work_days = D(actual_work_days_override)
            log_extras["base_work_days_reason"] = f"使用用户传入的实际劳务天数 ({actual_work_days_override:.1f})"
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
        extension_fee = D(0)
        

        # --- 新增逻辑：优先处理末期不足月的账单 ---
        # 1. 判断是否为最后一个账单
        is_last_bill = contract.end_date and cycle_end == contract.end_date

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
        is_last_bill_period = contract.end_date and bill.cycle_end_date >= contract.end_date

        
        if contract.is_monthly_auto_renew:
            # ... (旧的月签合同逻辑保持不变)
            if is_first_bill and cycle_start.day != 1:
                current_month_contract_days = (cycle_end - cycle_start).days
                management_days = D(min(current_month_contract_days + 1, 30))
                management_fee = (management_fee_daily_rate * management_days).quantize(
                    QUANTIZER
                )
                if management_fee_amount:
                    management_fee_reason =  f"月签合同首月不足月，按天收取: 管理费{management_fee_amount} / 30 * 劳务天数 ({current_month_contract_days} + 1) = {management_fee:.2f}"
                    
                else:
                    management_fee_reason =  f"月签合同首月不足月，按天收取: 级别{level} * 10% / 30 * 劳务天数 ({current_month_contract_days} + 1) = {management_fee:.2f}"
                log_extras["management_fee_reason"] = management_fee_reason
            elif is_last_bill and cycle_end.day != last_day_of_month:
                # 使用您指定的新逻辑
                # 注意：天数计算包含首尾两天，所以需要+1
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
            # ... (旧的固定期限合同逻辑保持不变)
            if is_first_bill:
                delta = relativedelta(contract.end_date, contract.start_date)
                total_months = delta.years * 12 + delta.months
                if delta.days > 0 or (total_months == 0 and cycle_actual_days > 0):
                    total_months += 1
                if management_fee_amount:
                    management_fee = management_fee_amount * total_months
                    management_fee_reason = f"非月签合同首月，一次性收取管理费: {management_fee_amount} * {total_months} 个月"
                else:
                    management_fee = (level * D("0.1") * total_months).quantize(QUANTIZER)
                    management_fee_reason = f"非月签合同首月，一次性收取: {level} * 10% * {total_months} 个月"
            else:
                management_fee_reason = "非月签合同非首月，不收取管理费"
            log_extras["management_fee_reason"] = management_fee_reason

            if is_last_bill_period and bill.cycle_end_date > contract.end_date:
                # 场景：这是被延长的最后一期账单

                # 1. 计算延长天数
                extension_days = (bill.cycle_end_date - contract.end_date).days
                daily_rate = level / D(26)
                extension_fee = (daily_rate * D(extension_days)).quantize(QUANTIZER)
                log_extras["extension_days_reason"] = f"原合同于 {contract.end_date.strftime('%m月%d日')} 结束，延长至 {bill.cycle_end_date.strftime('%m月%d日')}，共 {extension_days} 天。"
                log_extras["extension_fee_reason"] = f"级别({level:.2f})/26 * 延长天数({extension_days}) = {extension_fee:.2f}"

                # 2. 修正总劳务天数，并记录日志
                original_total_days = total_days_worked
                total_days_worked += D(extension_days)
                log_extras["total_days_worked_reason"] = f"原总劳务天数({original_total_days:.1f}) + 延长服务天数({extension_days}) = {total_days_worked:.1f}"

                # 3. 计算并记录管理费
                if management_fee_amount:
                    daily_rate_formula = f"管理费{management_fee_amount}/30天)"
                else:
                    daily_rate_formula = f"级别{level:.2f}/30天"
                extension_management_fee = (management_fee_daily_rate * D(extension_days)).quantize(QUANTIZER) + management_fee
                extension_log = f"延长期管理费: {daily_rate_formula} * 延长服务({extension_days}天) = {extension_management_fee:.2f}"

                log_extras["management_fee_reason"] = f"{management_fee_reason} + {extension_log}"

                management_fee = extension_management_fee
            
        # 首月服务费
        first_month_deduction = D(0)
        if is_first_bill:
            potential_income = (
                employee_base_payout
                + employee_overtime_payout
                + emp_increase
                - emp_decrease
            )
            service_fee_due = (level * D("0.1")).quantize(QUANTIZER)
            first_month_deduction = min(potential_income, service_fee_due)
            log_extras["first_month_deduction_reason"] = (
                f"员工首月服务费, min(当期总收入({potential_income:.2f}), 级别*10%({service_fee_due:.2f}))"
            )

        return {
            "type": "nanny",
            "level": str(level),
            "cycle_period": f"{cycle_start.isoformat()} to {cycle_end.isoformat()}",
            "base_work_days": str(base_work_days),
            "overtime_days":  f"{overtime_days:.2f}",
            "total_days_worked": str(total_days_worked),
            "substitute_days": str(total_substitute_days),
            "substitute_deduction": str(
                substitute_deduction_from_sub_records.quantize(QUANTIZER)
            ),
            "extension_fee": f"{extension_fee:.2f}",
            "customer_base_fee": str(customer_base_fee),
            "customer_overtime_fee": str(customer_overtime_fee),
            "management_fee": str(management_fee),
            "customer_increase": str(cust_increase),
            "customer_decrease": str(cust_decrease),
            "discount": str(cust_discount),
            "employee_base_payout": str(employee_base_payout),
            "employee_overtime_payout": str(employee_overtime_payout),
            "first_month_deduction": str(first_month_deduction),
            "employee_increase": str(emp_increase),
            "employee_decrease": str(emp_decrease),
            "customer_daily_rate": str(customer_daily_rate.quantize(QUANTIZER)),
            "employee_daily_rate": str(employee_daily_rate.quantize(QUANTIZER)),
            "deferred_fee": str(deferred_fee),
            "log_extras": log_extras,
            "substitute_deduction_logs": substitute_deduction_logs,  # <--- 在这里新增这一行
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
    
        log = self._create_calculation_log(details)
        self._update_bill_with_log(bill, payroll, details, log)

        current_app.logger.info(
            f"      [CYCLE PROC] 周期 {actual_cycle_start_date} 计算完成。"
        )

    def _calculate_maternity_nurse_details(
        self,
        contract: MaternityNurseContract,
        bill: CustomerBill,
        payroll: EmployeePayroll,
    ):

       

        """计算月嫂合同的所有财务细节（已二次修正）。"""
        QUANTIZER = D("0.01")
        level = D(contract.employee_level or 0)
        # 此处直接使用客交保证金
        customer_deposit = D(contract.security_deposit_paid or 0)
        discount = D(contract.discount_amount or 0)
        security_deposit = D(contract.security_deposit_paid or 0)
        log_extras = {}

        cycle_start = bill.cycle_start_date
        cycle_end = bill.cycle_end_date
        attendance = self._get_or_create_attendance(contract, cycle_start, cycle_end)
        # 打印从考勤记录中获取的原始数据
        overtime_days = D(attendance.overtime_days)
        actual_cycle_days = (cycle_end - cycle_start).days
        base_work_days = D(min(actual_cycle_days, 26))
        total_days_worked = base_work_days + overtime_days
        

        # 1. 管理费和管理费率计算
        management_fee = ((customer_deposit - level)/26 * (base_work_days+1)).quantize(QUANTIZER)
        management_fee_rate = (
            (management_fee / customer_deposit).quantize(D("0.0001"))
            if customer_deposit > 0
            else D(0)
        )
        log_extras["management_fee_reason"] = (
            f"客交保证金({customer_deposit:.2f}) - 级别({level:.2f}) / 26 * 劳务天数({base_work_days}) = {management_fee:.2f}"
        )
        log_extras["management_fee_rate_reason"] = (
            f"管理费({management_fee:.2f}) / 客交保证金({customer_deposit:.2f}) = {management_fee_rate * 100:.2f}%"
        )


        # 在这里处理保证金，然后再获取调整项
        self._handle_security_deposit(contract, bill)
        cust_increase, cust_decrease, emp_increase, emp_decrease, deferred_fee = (
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

        is_last_bill = (
            contract.expected_offboarding_date
            and cycle_end >= contract.expected_offboarding_date
        )

        # --- 【新增】月嫂合同延长服务逻辑 ---
        extension_fee = D(0)

        # 1. 确定月嫂合同的权威结束日期
        authoritative_end_date = getattr(contract, 'expected_offboarding_date', None) or contract.end_date

        # 2. 只有当账单结束日 > 权威结束日时，才计算延长费
        if authoritative_end_date and bill.cycle_end_date > authoritative_end_date:
            extension_days = (bill.cycle_end_date - authoritative_end_date).days
            if extension_days > 0:
                # 计算延长期服务费 (公式通用)
                daily_rate = level / D(26)
                extension_fee = (daily_rate * D(extension_days)).quantize(QUANTIZER)

                # 准备日志信息
                log_extras["extension_days_reason"] = f"原合同于 {authoritative_end_date.strftime('%m月%d日')} 结束，手动延长至 {bill.cycle_end_date.strftime('%m月%d日')}，共 {extension_days} 天。"
                log_extras["extension_fee_reason"] = f"级别({level:.2f})/26 * 延长天数({extension_days}) = {extension_fee:.2f}"
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
        """处理所有合同类型的首末月保证金收退逻辑。"""
        current_app.logger.debug(
            f"Handling security deposit for contract {contract.id}, type: {contract.type}"
        )
        current_app.logger.debug(
            f"  Contract id = {contract.id}, type = {contract.type} attributes: end_date={contract.end_date}, expected_offboarding_date={contract.expected_offboarding_date}"
        )
        # 1. 清理旧的系统生成的保证金调整项，确保幂等性
        FinancialAdjustment.query.filter(
            FinancialAdjustment.customer_bill_id == bill.id,
            FinancialAdjustment.description.like("[系统添加] 保证金%"),
        ).delete(synchronize_session=False)

        if not contract.security_deposit_paid or contract.security_deposit_paid <= 0:
            current_app.logger.debug(
                f"  Contract {contract.id} has no security deposit or it's zero. Skipping."
            )
            return

        # 2. 判断是否为首期账单
        # 对于月嫂，使用 actual_onboarding_date；对于育儿嫂，使用 start_date
        contract_start_date = getattr(
            contract, "actual_onboarding_date", contract.start_date
        )
        current_app.logger.debug(
            f"  Calculated contract_start_date: {contract_start_date}"
        )
        if bill.cycle_start_date == contract_start_date:
            db.session.add(
                FinancialAdjustment(
                    customer_bill_id=bill.id,
                    adjustment_type=AdjustmentType.CUSTOMER_INCREASE,
                    amount=contract.security_deposit_paid,
                    description="[系统添加] 保证金",
                    date=bill.cycle_start_date,
                )
            )
            current_app.logger.info(
                f"为合同 {contract.id} 的首期账单 {bill.id} 添加保证金 {contract.security_deposit_paid}"
            )

        # 3. 判断是否为末期账单
        # 根据合同类型确定正确的合同结束日期
        if contract.type == "maternity_nurse":
            contract_end_date = contract.expected_offboarding_date or contract.end_date
        else:  # nanny and nanny_trial
            contract_end_date = contract.end_date

        current_app.logger.debug(
            f"  Calculated contract_end_date: {contract_end_date} (based on contract type: {contract.type})"
        )
        current_app.logger.debug(
            f"  Checking for last bill: contract_end_date={contract_end_date}, bill.cycle_end_date={bill.cycle_end_date}"
        )

        # 获取合同是否为自动续约类型
        is_auto_renew = getattr(contract, 'is_monthly_auto_renew', False)

        # 判断是否为最后一期账单的条件
        is_last_bill_period = (contract_end_date and bill.cycle_end_date >= contract_end_date)

        # 只有在满足以下条件之一时，才退还保证金：
        # 1. 这是一份普通的、非自动续约的合同，并且到达了最后一期。
        # 2. 这是一份自动续约的合同，但它的状态已经不是 'active'（意味着已被终止），并且到达了最后一期。
        if is_last_bill_period and (not is_auto_renew or contract.status != 'active'):
            db.session.add(
                FinancialAdjustment(
                    customer_bill_id=bill.id,
                    adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
                    amount=contract.security_deposit_paid,
                    description="[系统添加] 保证金退款",
                    date=bill.cycle_end_date,
                )
            )
            current_app.logger.info(
                f"为合同 {contract.id} 的末期账单 {bill.id} 退还保证金 {contract.security_deposit_paid}"
            )
            current_app.logger.debug(
                f"  Processing 保证金退款 for contract {contract.id}, amount: {contract.security_deposit_paid}"
            )

    def calculate_for_substitute(self, substitute_record_id, commit=True):
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
                total_payable=D(0),
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
                final_payout=D(0),
                source_substitute_record_id=sub_record.id,
            )
            db.session.add(payroll)

        db.session.flush()
        sub_record.generated_bill_id = bill.id
        sub_record.generated_payroll_id = payroll.id

        details = self._calculate_substitute_details(sub_record, main_contract)
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)
        log = self._create_calculation_log(details)
        self._update_bill_with_log(bill, payroll, details, log)

        if commit:
            db.session.commit()
        current_app.logger.info(
            f"[SubCALC] 替班记录 {sub_record.id} 的账单已成功生成。"
        )

    def _calculate_substitute_details(self, sub_record, main_contract):
        """计算替班记录的财务细节。"""
        QUANTIZER = D("0.01")
        time_difference = sub_record.end_date - sub_record.start_date
        precise_substitute_days = D(time_difference.total_seconds()) / D(86400)  # 86400秒/天
        substitute_days = precise_substitute_days.quantize(D('0.1'))
        substitute_level = D(sub_record.substitute_salary)  # This is B-auntie's level
        overtime_days = D(sub_record.overtime_days or 0)
        substitute_type = sub_record.substitute_type

        # Common details
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
            "customer_increase": "0.00",
            "customer_decrease": "0.00",
            "employee_increase": "0.00",
            "employee_decrease": "0.00",
            "discount": "0.00",
            "first_month_deduction": "0.00",
            "log_extras": {},
            "level": str(substitute_level),
        }

        # Overtime fee is the same for both types
        # B阿姨级别 / 26 * 加班天数
        overtime_daily_rate = substitute_level / D(26)
        overtime_fee = (overtime_daily_rate * overtime_days).quantize(QUANTIZER)
        details["customer_overtime_fee"] = str(overtime_fee)
        details["employee_overtime_payout"] = str(overtime_fee)
        details["log_extras"]["overtime_reason"] = (
            f"替班加班费: 替班级别({substitute_level})/26 * 加班天数({overtime_days})"
        )

        if substitute_type == "maternity_nurse":
            management_fee_rate = D(sub_record.substitute_management_fee)

            # 客户应付：B阿姨的级别 / 26 * 替班天数
            customer_daily_rate = (
                substitute_level * (D(1) - management_fee_rate) / D(26)
            )
            customer_base_fee = (customer_daily_rate * substitute_days).quantize(
                QUANTIZER
            )

            # 员工工资：B阿姨的级别 * (1 - 管理费率) / 26 * 替班天数
            employee_daily_rate = (
                substitute_level * (D(1) - management_fee_rate) / D(26)
            )
            employee_base_payout = (employee_daily_rate * substitute_days).quantize(
                QUANTIZER
            )

            # management_fee = (customer_base_fee - employee_base_payout).quantize(QUANTIZER)
            management_fee = (
                substitute_level * management_fee_rate / D(26) * substitute_days
            ).quantize(QUANTIZER)
            details["log_extras"]["management_fee_reason"] = (
                f"替班管理费: 替班级别({substitute_level:.2f}) * 管理费率({management_fee_rate*100}%) / 26 * 替班天数({substitute_days:.1f}) = {management_fee:.2f}"
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
                f"月嫂替班客户费用: 替班级别({substitute_level:.2f})*(1-{management_fee_rate*100}%)/26 * 替班天数({substitute_days:.1f})= {customer_base_fee:.2f}"
            )
            details["log_extras"]["employee_payout_reason"] = (
                f"月嫂替班员工工资: 替班级别({substitute_level:.2f})*(1-{management_fee_rate*100}%)/26 * 替班天数({substitute_days:.1f})= {employee_base_payout:.2f}"
            )

        elif substitute_type == "nanny":
            # 育儿嫂替班不收取管理费
            management_fee_rate = D(0)
            management_fee = D(0)

            # 客户应付款 = B阿姨的级别 / 26 * 替班天数
            # 育儿嫂工资 = B阿姨的级别 / 26 * 替班天数
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
                f"育儿嫂替班客户费用: 替班级别({substitute_level:.2f})/26 * 替班天数({substitute_days:.1f}) = {customer_base_fee:.2f}"
            )
            details["log_extras"]["employee_payout_reason"] = (
                f"育儿嫂替班员工工资: 替班级别({substitute_level:.2f})/26 * 替班天数({substitute_days:.1f}) = {employee_base_payout:.2f}"
            )

        return details

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
                total_payable=D(0),  # 明确提供默认值
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
                final_payout=D(0),  # 明确提供默认值
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
            if adj.adjustment_type == AdjustmentType.CUSTOMER_INCREASE
        )
        cust_decrease = sum(
            adj.amount
            for adj in customer_adjustments
            if adj.adjustment_type == AdjustmentType.CUSTOMER_DECREASE
        )
        # --- 在此下方新增对 DEFERRED_FEE 的处理 ---
        deferred_fee = sum(
            adj.amount
            for adj in customer_adjustments
            if adj.adjustment_type == AdjustmentType.DEFERRED_FEE
        )
        # --- 新增结束 ---

        emp_increase = sum(
            adj.amount
            for adj in employee_adjustments
            if adj.adjustment_type == AdjustmentType.EMPLOYEE_INCREASE
        )
        emp_decrease = sum(
            adj.amount
            for adj in employee_adjustments
            if adj.adjustment_type == AdjustmentType.EMPLOYEE_DECREASE
        )

        # --- 修改返回值，增加 deferred_fee ---
        return cust_increase, cust_decrease, emp_increase, emp_decrease, deferred_fee

    def _calculate_final_amounts(self, bill, payroll, details):
        total_payable = (
            D(details.get("customer_base_fee", 0))
            + D(details.get("customer_overtime_fee", 0))
            + D(details.get("management_fee", 0))
            + D(details.get("customer_increase", 0))
            + D(details.get("extension_fee", "0.00"))
            + D(details.get("deferred_fee", "0.00"))
            - D(details.get("customer_decrease", 0))
            - D(details.get("discount", 0))
            - D(details.get("substitute_deduction", 0))
        )
        final_payout = (
            D(details["employee_base_payout"])
            + D(details["employee_overtime_payout"])
            + D(details["employee_increase"])
            + D(details.get("extension_fee", "0.00"))
            - D(details["employee_decrease"])
            - D(details.get("first_month_deduction", 0))
            - D(details.get("substitute_deduction", 0))  # 扣除替班费用
        )

        bill.total_payable = total_payable.quantize(D("0.01"))
        payroll.final_payout = final_payout.quantize(D("0.01"))

        details["total_payable"] = str(bill.total_payable)
        details["final_payout"] = str(payroll.final_payout)

        return bill, payroll

    def _create_calculation_log(self, details):
        """根据计算详情字典，生成人类可读的计算过程日志。"""
        log = {}
        d = {
            k: D(v)
            for k, v in details.items()
            if isinstance(v, str) and v.replace(".", "", 1).isdigit()
        }
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
                    f"{employee_daily_rate_formula} * 基本劳务天数({base_work_days:.1f}) = {d.get('employee_base_payout', 0):.2f}"
                )
                log["加班费"] = (
                    f"{employee_daily_rate_formula} * 加班天数({overtime_days:.1f}) = {d.get('employee_overtime_payout', 0):.2f}"
                )
                log["客户侧加班费"] = (
                    f"{customer_daily_rate_formula} * 加班天数({overtime_days:.1f}) = {d.get('customer_overtime_fee', 0):.2f}"
                )
                log["本次交管理费"] = log_extras.get("management_fee_reason", "N/A")
                if "refund_amount" in log_extras:
                    log["本次交管理费"] += f" | 末月退还: {log_extras['refund_amount']}"
                if d.get("first_month_deduction", 0) > 0:
                    log["首月员工10%费用"] = log_extras.get(
                        "first_month_deduction_reason", "N/A"
                    )
            else:  # maternity_nurse & nanny_trial
                employee_daily_rate_formula = customer_daily_rate_formula
                log["基础劳务费"] = (
                    f"{customer_daily_rate_formula} * 基本劳务天数({base_work_days:.1f}) = {d.get('customer_base_fee', 0):.2f}"
                )
                if overtime_days > 0:
                    log["加班费"] = (
                        f"({log_extras.get('customer_overtime_daily_rate_reason', '客户加班日薪')}) * 加班天数({overtime_days:.1f}) = {d.get('customer_overtime_fee', 0):.2f}"
                    )
                if calc_type == "maternity_nurse":
                    log["管理费"] = log_extras.get("management_fee_reason", "N/A")
                    log["管理费率"] = log_extras.get(
                        "management_fee_rate_reason", "N/A"
                    )
                    log["基础劳务费"] = (
                        f"({log_extras.get('employee_daily_rate_reason', '员工日薪')}) * 基本劳务天数({base_work_days:.1f}) = {d.get('customer_base_fee', 0):.2f}"
                    )
                    log["加班费"] = (
                        f"({log_extras.get('customer_overtime_daily_rate_reason', '客户加班日薪')}) * 加班天数({overtime_days:.1f}) = {d.get('customer_overtime_fee', 0):.2f}"
                    )
                    log["萌嫂保证金(工资)"] = (
                        f"({log_extras.get('employee_daily_rate_reason', '员工日薪')}) * 基本劳务天数({base_work_days:.1f}) = {d.get('employee_base_payout', 0):.2f}"
                    )
                if calc_type == "nanny_trial_termination":
                    log["基础劳务费"] = (
                        f"员工日薪({level:.2f}) * 基本劳务天数({base_work_days:.1f}) = {d.get('customer_base_fee', 0):.2f}"
                    )
                    log["管理费"] = log_extras.get("management_fee_reason", "N/A")
                if calc_type == "nanny_trial" and d.get("first_month_deduction", 0) > 0:
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

        # log["客应付款"] = (
        #     f"基础劳务费({d.get('customer_base_fee', 0):.2f}) + 延长期服务费({d.get('extension_fee', 0):.2f}) + 加班费({d.get('customer_overtime_fee', 0):.2f}) + 管理费({d.get('management_fee', 0):.2f}) - 优惠({d.get('discount', 0):.2f}) - 被替班扣款({d.get('substitute_deduction', 0):.2f}) + 增款({d.get('customer_increase', 0):.2f}) - 减款({d.get('customer_decrease', 0):.2f}) = {d.get('total_payable', 0):.2f}"
        # )
        # log["萌嫂应领款"] = (
        #     f"基础工资({d.get('employee_base_payout', 0):.2f}) + 延长期服务费({d.get('extension_fee', 0):.2f}) + 加班工资({d.get('employee_overtime_payout', 0):.2f}) + 奖励/增款({d.get('employee_increase', 0):.2f}) - 服务费/减款({d.get('first_month_deduction',0) + d.get('employee_decrease', 0):.2f}) - 被替班扣款({d.get('substitute_deduction', 0):.2f}) = {d.get('final_payout', 0):.2f}"
        # )
        # 简化日志，只显示非零内容
        # --- 客户应付款日志 ---
        customer_parts = []
        if d.get("customer_base_fee"):
            customer_parts.append(f"基础劳务费({d['customer_base_fee']:.2f})")
        if d.get("extension_fee"):
            customer_parts.append(f"延长期服务费({d['extension_fee']:.2f})")
        if d.get("customer_overtime_fee"):
            customer_parts.append(f"加班费({d['customer_overtime_fee']:.2f})")
        if d.get("management_fee"):
            customer_parts.append(f"管理费({d['management_fee']:.2f})")
        if d.get("customer_increase"):
            customer_parts.append(f"增款({d['customer_increase']:.2f})")
        if d.get("deferred_fee"):
            customer_parts.append(f"上期顺延({d['deferred_fee']:.2f})")

        # 处理减项
        if d.get("discount"):
            customer_parts.append(f"- 优惠({d['discount']:.2f})")
        if d.get("substitute_deduction"):
            customer_parts.append(f"- 被替班扣款({d['substitute_deduction']:.2f})")
        if d.get("customer_decrease"):
            customer_parts.append(f"- 减款({d['customer_decrease']:.2f})")

        log["客应付款"] = " + ".join(customer_parts).replace("+ -", "-") + f" = {d.get('total_payable', 0):.2f}"

        # --- 员工应领款日志 ---
        employee_parts = []
        if d.get("employee_base_payout"):
            employee_parts.append(f"基础工资({d['employee_base_payout']:.2f})")
        if d.get("extension_fee"):
            employee_parts.append(f"延长期服务费({d['extension_fee']:.2f})")
        if d.get("employee_overtime_payout"):
            employee_parts.append(f"加班工资({d['employee_overtime_payout']:.2f})")
        if d.get("employee_increase"):
            employee_parts.append(f"增款({d['employee_increase']:.2f})")

        # 处理减项
        total_deduction = d.get("first_month_deduction", 0) + d.get("employee_decrease", 0)
        if total_deduction:
            employee_parts.append(f"- 服务费/减款({total_deduction:.2f})")
        if d.get("substitute_deduction"):
            employee_parts.append(f"- 被替班扣款({d['substitute_deduction']:.2f})")

        log["萌嫂应领款"] = " + ".join(employee_parts).replace("+ -", "-") + f" = {d.get('final_payout', 0):.2f}"

        return log

    def _update_bill_with_log(self, bill, payroll, details, log):
        details["calculation_log"] = log
        bill.calculation_details = details
        payroll.calculation_details = details.copy()

        attributes.flag_modified(bill, "calculation_details")
        attributes.flag_modified(payroll, "calculation_details")

        db.session.add(bill)
        db.session.add(payroll)

        return bill, payroll

    def _calculate_nanny_trial_termination_details(self, contract, actual_trial_days):
        """为试工失败结算生成详细的计算字典 (v16 - FINAL with Overtime)。"""
        QUANTIZER = D("0.01")
        level = D(contract.employee_level or 0)
        days = D(actual_trial_days)
        
        # 核心修正：试工合同的 level 即为日薪，无需除以26
        daily_rate = level.quantize(QUANTIZER)

        # 试工合同月薪,用来准确算出日管理费
        monthly_rate = daily_rate * 26

        # 获取考勤，计算加班
        attendance = self._get_or_create_attendance(contract, contract.start_date, contract.end_date)
        overtime_days = D(attendance.overtime_days)
        overtime_fee = (daily_rate * overtime_days).quantize(QUANTIZER)

        # 统一计算基础劳务费和管理费
        base_fee = (daily_rate * days).quantize(QUANTIZER)
        management_fee = (monthly_rate* D('0.2') / 30 * (days + 1)).quantize(QUANTIZER)

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

            "customer_increase": "0.00",
            "customer_decrease": "0.00",
            "employee_increase": "0.00",
            "employee_decrease": "0.00",
            "first_month_deduction": "0.00",
            "discount": "0.00",
            "substitute_deduction": "0.00",

            "log_extras": {
                "management_fee_reason": f"月薪({level*26})/30天 * 20% * 试工天数({days}+1) = {management_fee:.2f}",
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
            # 1. 获取包含所有基础组件的 details 字典
            details = self._calculate_nanny_trial_termination_details(contract, actual_trial_days)

            # 2. 创建或获取账单/薪酬单
            term_date = contract.start_date + timedelta(days=actual_trial_days)
            bill, payroll = self._get_or_create_bill_and_payroll(
                contract, term_date.year, term_date.month, contract.start_date, term_date
            )

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
            total_invoiceable_amount = (current_management_fee + total_carried_forward).quantize(D("0.01"))
        else:
            total_invoiceable_amount = D(0)

        remaining_un_invoiced = (total_invoiceable_amount - invoiced_this_period).quantize(D("0.01"))
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