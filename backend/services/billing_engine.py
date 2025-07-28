# backend/services/billing_engine.py

from flask import current_app
from datetime import date, timedelta
import decimal
import calendar
from dateutil.relativedelta import relativedelta

from backend.extensions import db
from backend.models import (
    BaseContract, NannyContract, MaternityNurseContract, AttendanceRecord, 
    CustomerBill, EmployeePayroll, FinancialAdjustment, AdjustmentType, SubstituteRecord
)

from sqlalchemy import func
from sqlalchemy.orm import attributes
from sqlalchemy.exc import IntegrityError

D = decimal.Decimal
CTX = decimal.Context(prec=10)

class BillingEngine:
    def calculate_for_month(self, year: int, month: int, contract_id=None, force_recalculate=False):
        current_app.logger.info(f"开始计算contract:{contract_id}  {year}-{month} 的账单 force_recalculate:{force_recalculate}" )
        if contract_id:
            contracts_to_process = [db.session.get(BaseContract, contract_id)]
        else:
            contracts_to_process = BaseContract.query.filter(
                BaseContract.status.in_(['active', 'terminated'])
            ).all()

        for contract in contracts_to_process:
            if not contract: continue

            try:
                if contract.type == 'maternity_nurse':
                    self._calculate_maternity_nurse_bill_for_month(contract, year, month, force_recalculate)
                elif contract.type == 'nanny':
                    self._calculate_nanny_bill_for_month(contract, year, month, force_recalculate)
                elif contract.type == 'nanny_trial':
                    self._calculate_nanny_trial_bill(contract, year, month, force_recalculate)

                # 将 commit 放在 try 块的末尾
                db.session.commit()

            except IntegrityError as e:
                db.session.rollback()
                current_app.logger.warning(f"为合同 {contract.id} 计算账单时发生数据库唯一性冲突，这可能是由并发任务引起的，此任务将安全退出。错误: {e}")

            except Exception as e:
                current_app.logger.error(f"为合同 {contract.id} 计算账单时发生未知错误: {e}", exc_info=True)
                db.session.rollback()

    def generate_all_bills_for_contract(self, contract_id, force_recalculate=True):
        """
        Generates or recalculates all bills for the entire lifecycle of a single contract.
        """
        contract = db.session.get(BaseContract, contract_id)
        if not contract:
            current_app.logger.error(f"[FullLifecycle] Contract {contract_id} not found.")
            return

        current_app.logger.info(f"[FullLifecycle] Starting bill generation for contract {contract.id} ({contract.type}).")

        # Determine the date range to iterate over
        if contract.type == 'maternity_nurse':
            start_date = contract.actual_onboarding_date
            end_date = contract.expected_offboarding_date or contract.end_date
        else: # nanny and nanny_trial
            start_date = contract.start_date
            end_date = contract.end_date

        if not start_date or not end_date:
            current_app.logger.warning(f"[FullLifecycle] Contract {contract.id} is missing start or end dates. Skipping.")
            return
        
        current_app.logger.info(f"[FullLifecycle] Contract {contract.id} date range: {start_date} to {end_date}.")

        # Iterate through each month in the contract's lifecycle
        current_month_start = date(start_date.year, start_date.month, 1)
        while current_month_start <= end_date:
            year = current_month_start.year
            month = current_month_start.month
            
            current_app.logger.info(f"  [FullLifecycle] Calculating for {year}-{month} for contract {contract.id}")
            self.calculate_for_month(year, month, contract_id, force_recalculate)
            
            # Move to the next month
            current_month_start += relativedelta(months=1)

        current_app.logger.info(f"[FullLifecycle] Finished bill generation for contract {contract.id}.")

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
            current_app.logger.error(f"[SubProcessing] 替班记录 {record_id} 缺少主合同关联。")
            return

        try:
            # 1. 查找或创建受影响的原始账单
            original_bill = CustomerBill.query.filter(
                CustomerBill.contract_id == main_contract.id,
                CustomerBill.is_substitute_bill == False,
                CustomerBill.cycle_start_date <= sub_record.end_date,
                CustomerBill.cycle_end_date >= sub_record.start_date
            ).first()

            if not original_bill:
                current_app.logger.info(f"[SubProcessing] 未找到替班期间 {sub_record.start_date}-{sub_record.end_date} 的原始账单，将尝试生成它。")
                # 确定应该为哪个月份生成账单（以替班结束日为准）
                target_year, target_month = sub_record.end_date.year, sub_record.end_date.month
                self.calculate_for_month(target_year, target_month, main_contract.id, force_recalculate=True)
                
                # 再次查找
                original_bill = CustomerBill.query.filter(
                    CustomerBill.contract_id == main_contract.id,
                    CustomerBill.is_substitute_bill == False,
                    CustomerBill.cycle_start_date <= sub_record.end_date,
                    CustomerBill.cycle_end_date >= sub_record.start_date
                ).first()

            if not original_bill:
                raise Exception(f"无法为替班记录 {record_id} 找到或创建对应的原始账单。")

            # 2. 关联替班记录到原始账单
            sub_record.original_customer_bill_id = original_bill.id
            db.session.add(sub_record)
            current_app.logger.info(f"[SubProcessing] 替班记录 {sub_record.id} 已关联到原始账单 {original_bill.id}")

            # 3. 如果是月嫂合同，处理周期顺延
            if main_contract.type == 'maternity_nurse':
                substitute_days = (sub_record.end_date - sub_record.start_date).days
                postponement_delta = timedelta(days=substitute_days)
                
                current_app.logger.info(f"[SubProcessing] 月嫂合同 {main_contract.id} 替班 {substitute_days} 天,postponement_delta {postponement_delta}，开始顺延周期。")

                # 顺延主合同的预计下户日期
                if main_contract.expected_offboarding_date:
                    main_contract.expected_offboarding_date += postponement_delta
                    current_app.logger.info(f"  -> 主合同预计下户日期顺延至: {main_contract.expected_offboarding_date}")

                # 延长当前账单周期
                original_bill.cycle_end_date += postponement_delta
                current_app.logger.info(f"  -> 当前账单 {original_bill.id} 周期延长至: {original_bill.cycle_end_date}")

                # 顺延所有未来的账单和薪酬单
                future_bills = CustomerBill.query.filter(
                    CustomerBill.contract_id == main_contract.id,
                    CustomerBill.is_substitute_bill == False,
                    CustomerBill.cycle_start_date > original_bill.cycle_start_date
                ).order_by(CustomerBill.cycle_start_date).all()

                future_payrolls = EmployeePayroll.query.filter(
                    EmployeePayroll.contract_id == main_contract.id,
                    EmployeePayroll.is_substitute_payroll == False,
                    EmployeePayroll.cycle_start_date > original_bill.cycle_start_date
                ).order_by(EmployeePayroll.cycle_start_date).all()

                for bill in future_bills:
                    bill.cycle_start_date += postponement_delta
                    bill.cycle_end_date += postponement_delta
                for payroll in future_payrolls:
                    payroll.cycle_start_date += postponement_delta
                    payroll.cycle_end_date += postponement_delta
                
                current_app.logger.info(f"  -> {len(future_bills)} 个未来账单和 {len(future_payrolls)} 个未来薪酬单已顺延。")
                db.session.flush() # 确保顺延的日期在当前事务中可

            # 4. 为替班记录生成新的独立账单
            self.calculate_for_substitute(record_id, commit=False) # 传入 commit=False

            # 5. 强制重算原始账单
            current_app.logger.info(f"[SubProcessing] 准备重算原始账单 {original_bill.id}。")
            self.calculate_for_month(original_bill.year, original_bill.month, original_bill.contract_id, force_recalculate=True)

            db.session.commit()
            current_app.logger.info(f"[SubProcessing] 替班流程处理完毕，所有更改已提交。")

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"[SubProcessing] 处理替班记录 {record_id} 时发生错误: {e}", exc_info=True)
            raise e

    

    def _calculate_nanny_trial_bill(self, contract, year, month, force_recalculate=False):
        """为育儿嫂试工合同计算账单和薪酬。"""
        current_app.logger.info(f"  [TrialCALC] 开始处理试工合同 {contract.id} for {year}-{month}")

        if not (contract.end_date and contract.end_date.year == year and contract.end_date.month == month):
            current_app.logger.info(f"    [TrialCALC] 试工合同 {contract.id} 不在本月结算，跳过。")
            return

        cycle_start, cycle_end = contract.start_date, contract.end_date
        
        bill, payroll = self._get_or_create_bill_and_payroll(contract, year, month, cycle_start, cycle_end)

        if not force_recalculate and bill.calculation_details and 'calculation_log' in bill.calculation_details:
            current_app.logger.info(f"    [TrialCALC] 合同 {contract.id} 的账单已存在且无需重算，跳过。")
            return

        current_app.logger.info(f"    [TrialCALC] 为合同 {contract.id} 执行计算 (周期: {cycle_start} to {cycle_end})")

        details = self._calculate_nanny_trial_details(contract, bill, payroll)
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)
        log = self._create_calculation_log(details)
        self._update_bill_with_log(bill, payroll, details, log)
        
        current_app.logger.info(f"    [TrialCALC] 计算完成 for contract {contract.id}: {bill.calculation_details}")

    def _calculate_nanny_trial_details(self, contract, bill, payroll):
        """计算育儿嫂试工合同的所有财务细节。"""
        QUANTIZER = D('0.01')
        level = D(contract.employee_level or 0)
        cycle_start = bill.cycle_start_date
        cycle_end = bill.cycle_end_date

        attendance = self._get_or_create_attendance(contract, cycle_start, cycle_end)
        overtime_days = D(attendance.overtime_days)
        cust_increase, cust_decrease, emp_increase, emp_decrease = self._get_adjustments(bill.id, payroll.id)

        base_work_days = D((cycle_end - cycle_start).days)
        total_days_worked = base_work_days + overtime_days
        daily_rate = (level / D(26)).quantize(QUANTIZER)
        base_fee = (daily_rate * base_work_days).quantize(QUANTIZER)
        overtime_fee = (daily_rate * overtime_days).quantize(QUANTIZER)

        potential_income = base_fee + overtime_fee + emp_increase - emp_decrease
        service_fee_due = (level * D('0.1')).quantize(QUANTIZER)
        first_month_deduction = min(potential_income, service_fee_due)

        return {
            'type': 'nanny_trial', 'level': str(level), 'cycle_period': f"{cycle_start.isoformat()} to {cycle_end.isoformat()}",
            'base_work_days': str(base_work_days), 'overtime_days': str(overtime_days), 'total_days_worked': str(total_days_worked),
            'daily_rate': str(daily_rate),
            'customer_base_fee': str(base_fee), 'customer_overtime_fee': str(overtime_fee),
            'management_fee': '0.00', 'customer_increase': str(cust_increase), 'customer_decrease': str(cust_decrease),
            'employee_base_payout': str(base_fee), 'employee_overtime_payout': str(overtime_fee),
            'first_month_deduction': str(first_month_deduction), 
            'employee_increase': str(emp_increase), 'employee_decrease': str(emp_decrease),
            'log_extras': {
                'first_month_deduction_reason': f"min(当期总收入({potential_income:.2f}), 级别*10%({service_fee_due:.2f}))"
            }
        }

    def _calculate_nanny_bill_for_month(self, contract: NannyContract, year: int, month: int, force_recalculate=False):
        """育儿嫂计费逻辑的主入口。"""
        current_app.logger.info(f"  [NannyCALC] 开始处理育儿嫂合同 {contract.id} for {year}-{month}")
        
        cycle_start, cycle_end = self._get_nanny_cycle_for_month(contract, year, month)
        if not cycle_start:
            current_app.logger.info(f"    [NannyCALC] 合同 {contract.id} 在 {year}-{month} 无需创建账单，跳过。")
            return

        bill, payroll = self._get_or_create_bill_and_payroll(contract, year, month, cycle_start, cycle_end)
        
        if not force_recalculate and bill.calculation_details and 'calculation_log' in bill.calculation_details:
            current_app.logger.info(f"    [NannyCALC] 合同 {contract.id} 的账单已存在且无需重算，跳过。")
            return

        current_app.logger.info(f"    [NannyCALC] 为合同 {contract.id} 执行计算 (周期: {cycle_start} to {cycle_end})")
        
        details = self._calculate_nanny_details(contract, bill, payroll)
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)
        log = self._create_calculation_log(details)
        self._update_bill_with_log(bill, payroll, details, log)
        
        current_app.logger.info(f"    [NannyCALC] 计算完成 for contract {contract.id}")

    def _get_nanny_cycle_for_month(self, contract, year, month):
        """计算指定育儿嫂合同在目标年月的服务周期。"""
        if not contract.start_date or not contract.end_date:
            return None, None

        first_day_of_target_month = date(year, month, 1)
        _, num_days_in_target_month = calendar.monthrange(year, month)
        last_day_of_target_month = date(year, month, num_days_in_target_month)

        start_year, start_month = contract.start_date.year, contract.start_date.month
        end_year, end_month = contract.end_date.year, contract.end_date.month

        if year == start_year and month == start_month:
            if start_year == end_year and start_month == end_month:
                return contract.start_date, contract.end_date
            else:
                _, num_days_in_start_month = calendar.monthrange(start_year, start_month)
                last_day_of_start_month = date(start_year, start_month, num_days_in_start_month)
                return contract.start_date, last_day_of_start_month
        
        if year == end_year and month == end_month:
            if not (start_year == end_year and start_month == end_month):
                first_day_of_end_month = date(end_year, end_month, 1)
                return first_day_of_end_month, contract.end_date

        target_month_date = date(year, month, 1)
        start_month_date = date(start_year, start_month, 1)
        end_month_date = date(end_year, end_month, 1)

        if start_month_date < target_month_date < end_month_date:
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
            if (cycle_start.year == year and cycle_start.month == month) or \
               (cycle_end.year == year and cycle_end.month == month) or \
               (cycle_start < date(year, month, 1) and cycle_end > date(year, month, calendar.monthrange(year, month)[1])):
                return cycle_start, cycle_end

            if cycle_end >= contract_end:
                break
            
            cycle_start = cycle_end
        
        return None, None

    def _calculate_nanny_details(self, contract: NannyContract, bill: CustomerBill, payroll: EmployeePayroll):
        """计算育儿嫂合同的所有财务细节。"""
        QUANTIZER = D('0.01')
        level = D(contract.employee_level or 0)
        cycle_start = bill.cycle_start_date
        cycle_end = bill.cycle_end_date

        attendance = self._get_or_create_attendance(contract, cycle_start, cycle_end)
        overtime_days = D(attendance.overtime_days)
        
        # 在这里处理保证金，然后再获取调整项
        self._handle_security_deposit(contract, bill)
        db.session.flush()
        cust_increase, cust_decrease, emp_increase, emp_decrease = self._get_adjustments(bill.id, payroll.id)
        cust_discount = D(db.session.query(func.sum(FinancialAdjustment.amount)).filter(
            FinancialAdjustment.customer_bill_id == bill.id,
            FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DISCOUNT
        ).scalar() or 0)

        total_substitute_days = 0
        substitute_deduction_from_sub_records = D(0)
        substitute_deduction_logs = []

        # 获取主合同员工的级别和日薪
        main_contract_level = D(contract.employee_level or 0)
        main_contract_daily_rate = (main_contract_level / D(26)).quantize(QUANTIZER)

        for record in bill.substitute_records_affecting_bill:
            overlap_start = max(cycle_start, record.start_date)
            overlap_end = min(cycle_end, record.end_date)
            if overlap_start <= overlap_end:
                days_in_cycle = (overlap_end - overlap_start).days
                total_substitute_days += days_in_cycle

                # 关键修复：根据被替班阿姨的级别计算扣款
                deduction_for_this_period = (main_contract_daily_rate * D(days_in_cycle)).quantize(QUANTIZER)
                substitute_deduction_from_sub_records += deduction_for_this_period

                # 准备日志字符串，反映新的计算逻辑
                sub_employee_name = record.substitute_user.username if record.substitute_user else record.substitute_personnel.name
                log_str = f"由({sub_employee_name})替班{days_in_cycle}天，扣除: 当前级别({main_contract_level:.2f})/26 * 替班天数({days_in_cycle})= {deduction_for_this_period:.2f}"
                substitute_deduction_logs.append(log_str)

        is_last_bill = (contract.end_date and cycle_end == contract.end_date)

        cycle_actual_days = (cycle_end - cycle_start).days
        if is_last_bill: # 育儿嫂最后一个月账单天数 +1
            cycle_actual_days += 1
        base_work_days = D(min(cycle_actual_days, 26)) - D(total_substitute_days)
        total_days_worked = base_work_days + overtime_days 

        # 育儿嫂普通合同日薪定义
        customer_daily_rate = (level / D(26))
        employee_daily_rate = (level / D(26))

        # 基础费用计算
        customer_base_fee = (employee_daily_rate * base_work_days).quantize(QUANTIZER)
        employee_base_payout = (employee_daily_rate * base_work_days).quantize(QUANTIZER)
        
        # 加班费计算
        customer_overtime_fee = (customer_daily_rate * overtime_days).quantize(QUANTIZER)
        employee_overtime_payout = (employee_daily_rate * overtime_days).quantize(QUANTIZER)

        # 管理费计算
        management_fee = D(0)
        is_first_bill = (cycle_start == contract.start_date)
        
        log_extras = {}

        if contract.is_monthly_auto_renew:
            management_fee = (level * D('0.1')).quantize(QUANTIZER)
            log_extras['management_fee_reason'] = f"月签合同，按月收取: {level} * 10%"
        else:
            if is_first_bill:
                delta = relativedelta(contract.end_date, contract.start_date)
                total_months = delta.years * 12 + delta.months
                if delta.days > 0 or (total_months == 0 and cycle_actual_days > 0):
                    total_months += 1
                management_fee = (level * D('0.1') * total_months).quantize(QUANTIZER)
                log_extras['management_fee_reason'] = f"非月签合同首月，一次性收取: {level} * 10% * {total_months} 个月"
            else:
                log_extras['management_fee_reason'] = "非月签合同非首月，不收取管理费"

        # 首月服务费
        first_month_deduction = D(0)
        if is_first_bill:
            potential_income = employee_base_payout + employee_overtime_payout + emp_increase - emp_decrease
            service_fee_due = (level * D('0.1')).quantize(QUANTIZER)
            first_month_deduction = min(potential_income, service_fee_due)
            log_extras['first_month_deduction_reason'] = f"员工首月服务费, min(当期总收入({potential_income:.2f}), 级别*10%({service_fee_due:.2f}))"

        return {
            'type': 'nanny', 'level': str(level), 'cycle_period': f"{cycle_start.isoformat()} to {cycle_end.isoformat()}",
            'base_work_days': str(base_work_days), 'overtime_days': str(overtime_days), 'total_days_worked': str(total_days_worked),
            'substitute_days': str(total_substitute_days),
            'substitute_deduction': str(substitute_deduction_from_sub_records.quantize(QUANTIZER)),
            'customer_base_fee': str(customer_base_fee),
            'customer_overtime_fee': str(customer_overtime_fee),
            'management_fee': str(management_fee),
            'customer_increase': str(cust_increase), 'customer_decrease': str(cust_decrease),
            'discount': str(cust_discount),
            'employee_base_payout': str(employee_base_payout),
            'employee_overtime_payout': str(employee_overtime_payout),
            'first_month_deduction': str(first_month_deduction),
            'employee_increase': str(emp_increase), 'employee_decrease': str(emp_decrease),
            'customer_daily_rate': str(customer_daily_rate.quantize(QUANTIZER)),
            'employee_daily_rate': str(employee_daily_rate.quantize(QUANTIZER)),
            'log_extras': log_extras,
            'substitute_deduction_logs': substitute_deduction_logs, # <--- 在这里新增这一行
        }

    def _calculate_maternity_nurse_bill_for_month(self, contract: MaternityNurseContract, year: int, month: int, force_recalculate=False):
        current_app.logger.info(f"  [MN CALC] 开始处理月嫂合同 {contract.id} for {year}-{month}")
        if not contract.actual_onboarding_date:
            current_app.logger.info(f"    [MN CALC] 合同 {contract.id} 缺少实际上户日期，跳过。")
            return

        contract_end = contract.expected_offboarding_date or contract.end_date
        if not contract_end:
            current_app.logger.warning(f"    [MN CALC] 合同 {contract.id} 缺少结束日期，无法计算。")
            return

        # --- 新增逻辑：当强制重算时，优先使用现有账单的周期日期 ---
        if force_recalculate:
            # 查找当前月份已存在的非替班账单
            existing_bill_for_month = CustomerBill.query.filter_by(
                contract_id=contract.id,
                year=year,
                month=month,
                is_substitute_bill=False
            ).first()

            if existing_bill_for_month:
                current_app.logger.info(f"    [MN CALC] 强制重算，找到现有账单 {existing_bill_for_month.id}。使用其周期 {existing_bill_for_month.cycle_start_date} to {existing_bill_for_month.cycle_end_date}")
                # 直接使用现有账单的周期日期来处理
                self._process_one_billing_cycle(contract, existing_bill_for_month.cycle_start_date, existing_bill_for_month.cycle_end_date, year, month, force_recalculate=True)
                return # 处理完毕，退出函数
            else:
                current_app.logger.warning(f"    [MN CALC] 强制重算，但未找到月嫂合同 {contract.id} 在 {year}-{month} 的现有账单。将按常规流程计算。")
        # --- 结束新增逻辑 ---

        # 原有逻辑：如果不是强制重算，或者强制重算但未找到现有账单，则按常规方式推导周期
        cycle_start = contract.actual_onboarding_date
        while cycle_start < contract_end:
            cycle_end = cycle_start + timedelta(days=26)
            if cycle_end >= contract_end:
                cycle_end = contract_end

            settlement_year, settlement_month = cycle_end.year, cycle_end.month

            if settlement_year == year and settlement_month == month:
                current_app.logger.info(f"    [MN CALC] 找到一个归属于 {year}-{month} 的结算周期: {cycle_start} to {cycle_end}")
                self._process_one_billing_cycle(contract, cycle_start, cycle_end, year, month, force_recalculate)
            
            if cycle_end >= contract_end:
                break

            cycle_start = cycle_end + timedelta(days=1)

    def _process_one_billing_cycle(self, contract: MaternityNurseContract, cycle_start_date, cycle_end_date, year: int, month: int, force_recalculate=False):
        current_app.logger.info(f"      [CYCLE PROC] 开始处理周期 {cycle_start_date} to {cycle_end_date} for settlement month {year}-{month}")

        # First, try to find an existing non-substitute bill for this contract and month                                 
        # This is crucial for handling postponed bills                                                                   
        existing_bill = CustomerBill.query.filter_by(                                                                    
            contract_id=contract.id,                                                                                     
            cycle_start_date=cycle_start_date,                                                                           
            year=year,                                                                                                   
            month=month,                                                                                                 
            is_substitute_bill=False                                                                                     
        ).first()                                                                                                        
                                                                                                                        
        # If an existing bill is found and we are not forcing recalculation, skip                                        
        if existing_bill and not force_recalculate:                                                                      
            current_app.logger.info(f"      [CYCLE PROC] 周期 {cycle_start_date} 的账单已存在且无需强制重算，跳过。")    
            current_app.logger.info(f"      [CYCLE PROC] 周期 {existing_bill.cycle_start_date} 的账单已存在且无需强制重算，跳过。")                                                                                 
            return                                                                                                       
                                                                                                                        
        bill, payroll = self._get_or_create_bill_and_payroll(contract, year, month, cycle_start_date, cycle_end_date)    
        # If an existing bill is found and we ARE forcing recalculation,                                                 
        # use its dates for the calculation to preserve postponement                                                     
        if existing_bill and force_recalculate:                                                                          
            actual_cycle_start_date = existing_bill.cycle_start_date                                                     
            actual_cycle_end_date = existing_bill.cycle_end_date                                                         
            current_app.logger.info(f"      [CYCLE PROC] Found existing bill {existing_bill.id} for recalculation.Using its dates: {actual_cycle_start_date} to {actual_cycle_end_date}")                                              
        else:                                                                                                            
            # If no existing bill, or not forcing recalculation, use the derived dates                                   
            actual_cycle_start_date = cycle_start_date                                                                   
            actual_cycle_end_date = cycle_end_date                                                                       
            current_app.logger.info(f"      [CYCLE PROC] No existing bill found or not forcing recalculation. Using derived dates: {actual_cycle_start_date} to {actual_cycle_end_date}")                                                
                                                                                                                        
                                                                                                                        
        bill, payroll = self._get_or_create_bill_and_payroll(contract, year, month, actual_cycle_start_date, actual_cycle_end_date)          
        bill, payroll = self._get_or_create_bill_and_payroll(contract, year, month, cycle_start_date, cycle_end_date)
        details = self._calculate_maternity_nurse_details(contract, bill, payroll)
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)
        log = self._create_calculation_log(details)
        self._update_bill_with_log(bill, payroll, details, log)

        current_app.logger.info(f"      [CYCLE PROC] 周期 {actual_cycle_start_date} 计算完成。")

    def _calculate_maternity_nurse_details(self, contract: MaternityNurseContract, bill: CustomerBill, payroll: EmployeePayroll):
        """计算月嫂合同的所有财务细节（已二次修正）。"""
        QUANTIZER = D('0.01')
        level = D(contract.employee_level or 0)
        # 此处直接使用客交保证金
        customer_deposit = D(contract.security_deposit_paid or 0)
        discount = D(contract.discount_amount or 0)
        security_deposit = D(contract.security_deposit_paid or 0)
        log_extras = {}

        # 1. 管理费和管理费率计算
        management_fee = (customer_deposit - level).quantize(QUANTIZER)
        management_fee_rate = (management_fee / customer_deposit).quantize(D('0.0001')) if customer_deposit > 0 else D(0)
        log_extras['management_fee_reason'] = f"客交保证金({customer_deposit:.2f}) - 级别({level:.2f}) = {management_fee:.2f}"
        log_extras['management_fee_rate_reason'] = f"管理费({management_fee:.2f}) / 客交保证金({customer_deposit:.2f}) = {management_fee_rate * 100:.2f}%"

        cycle_start = bill.cycle_start_date
        cycle_end = bill.cycle_end_date

        attendance = self._get_or_create_attendance(contract, cycle_start, cycle_end)
        overtime_days = D(attendance.overtime_days)
        
        # 在这里处理保证金，然后再获取调整项
        self._handle_security_deposit(contract, bill)
        cust_increase, cust_decrease, emp_increase, emp_decrease = self._get_adjustments(bill.id, payroll.id)


        # 2. 日薪区分 (保持完整精度)
        customer_overtime_daily_rate = (customer_deposit / D(26))
        employee_daily_rate = (level / D(26))
        log_extras['customer_overtime_daily_rate_reason'] = f"客交保证金({customer_deposit:.2f}) / 26"
        log_extras['employee_daily_rate_reason'] = f"级别({level:.2f}) / 26"

        actual_cycle_days = (cycle_end - cycle_start).days
        base_work_days = D(min(actual_cycle_days, 26))
        total_days_worked = base_work_days + overtime_days

        # 3. 费用计算 (修正 #1)
        customer_base_fee = (employee_daily_rate * base_work_days).quantize(QUANTIZER)
        customer_overtime_fee = (customer_overtime_daily_rate * overtime_days).quantize(QUANTIZER)
        employee_base_payout = (employee_daily_rate * base_work_days).quantize(QUANTIZER)
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

        is_last_bill = (contract.expected_offboarding_date and cycle_end >= contract.expected_offboarding_date)

        return {
            'type': 'maternity_nurse',
            'level': str(level),
            'customer_deposit': str(customer_deposit),
            'cycle_period': f"{cycle_start.isoformat()} to {cycle_end.isoformat()}",
            'base_work_days': str(base_work_days),
            'overtime_days': str(overtime_days),
            'total_days_worked': str(total_days_worked),
            'substitute_days': str(total_substitute_days),
            'substitute_deduction': '0.00',
            'customer_daily_rate': str(customer_overtime_daily_rate),
            'employee_daily_rate': str(employee_daily_rate),
            'management_fee_rate': str(management_fee_rate),
            'management_fee': str(management_fee),
            'customer_base_fee': str(customer_base_fee),
            'customer_overtime_fee': str(customer_overtime_fee),
            'discount': str(discount),
            'security_deposit_return': str(security_deposit) if is_last_bill else '0.00',
            'customer_increase': str(cust_increase),
            'customer_decrease': str(cust_decrease),
            'employee_base_payout': str(employee_base_payout),
            'employee_overtime_payout': str(employee_overtime_payout),
            # 'bonus_5_percent': str(bonus_5_percent),
            'employee_increase': str(emp_increase),
            'employee_decrease': str(emp_decrease),
            'log_extras': {**log_extras, 'substitute_deduction_logs': substitute_deduction_logs},
        }

    def _handle_security_deposit(self, contract, bill):
        """处理所有合同类型的首末月保证金收退逻辑。"""
        current_app.logger.debug(f"Handling security deposit for contract {contract.id}, type: {contract.type}")
        current_app.logger.debug(f"  Contract id = {contract.id}, type = {contract.type} attributes: end_date={contract.end_date}, expected_offboarding_date={contract.expected_offboarding_date}")
        # 1. 清理旧的系统生成的保证金调整项，确保幂等性
        FinancialAdjustment.query.filter(
            FinancialAdjustment.customer_bill_id == bill.id,
            FinancialAdjustment.description.like('[系统添加] 保证金%')
        ).delete(synchronize_session=False)
        
        if not contract.security_deposit_paid or contract.security_deposit_paid <= 0:
            current_app.logger.debug(f"  Contract {contract.id} has no security deposit or it's zero. Skipping.")
            return

        # 2. 判断是否为首期账单
        # 对于月嫂，使用 actual_onboarding_date；对于育儿嫂，使用 start_date
        contract_start_date = getattr(contract, 'actual_onboarding_date', contract.start_date)
        current_app.logger.debug(f"  Calculated contract_start_date: {contract_start_date}")
        if bill.cycle_start_date == contract_start_date:
            db.session.add(FinancialAdjustment(
                customer_bill_id=bill.id,
                adjustment_type=AdjustmentType.CUSTOMER_INCREASE,
                amount=contract.security_deposit_paid,
                description='[系统添加] 保证金',
                date=bill.cycle_start_date
            ))
            current_app.logger.info(f"为合同 {contract.id} 的首期账单 {bill.id} 添加保证金 {contract.security_deposit_paid}")

        # 3. 判断是否为末期账单
        # 根据合同类型确定正确的合同结束日期
        if contract.type == 'maternity_nurse':
            contract_end_date = contract.expected_offboarding_date or contract.end_date
        else: # nanny and nanny_trial
            contract_end_date = contract.end_date

        current_app.logger.debug(f"  Calculated contract_end_date: {contract_end_date} (based on contract type: {contract.type})")
        current_app.logger.debug(f"  Checking for last bill: contract_end_date={contract_end_date}, bill.cycle_end_date={bill.cycle_end_date}")
        if contract_end_date and bill.cycle_end_date >= contract_end_date:
            db.session.add(FinancialAdjustment(
                customer_bill_id=bill.id,
                adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
                amount=contract.security_deposit_paid,
                description='[系统添加] 保证金退款',
                date=bill.cycle_end_date
            ))
            current_app.logger.info(f"为合同 {contract.id} 的末期账单 {bill.id} 退还保证金 {contract.security_deposit_paid}")
            current_app.logger.debug(f"  Processing 保证金退款 for contract {contract.id}, amount: {contract.security_deposit_paid}")

    def calculate_for_substitute(self, substitute_record_id, commit=True):
        """为单条替班记录生成专属的客户账单和员工薪酬单。"""
        sub_record = db.session.get(SubstituteRecord, substitute_record_id)
        if not sub_record:
            current_app.logger.error(f"[SubCALC] 替班记录 {substitute_record_id} 未找到。")
            return

        current_app.logger.info(f"[SubCALC] 开始为替班记录 {sub_record.id} 生成账单。")
        
        main_contract = sub_record.main_contract
        if not main_contract:
            current_app.logger.error(f"[SubCALC] 替班记录 {sub_record.id} 关联的主合同未找到。")
            return

        year, month = sub_record.end_date.year, sub_record.end_date.month
        cycle_start, cycle_end = sub_record.start_date, sub_record.end_date
        
        bill = CustomerBill.query.filter_by(source_substitute_record_id=sub_record.id).first()
        if not bill:
            bill = CustomerBill(
                contract_id=main_contract.id, year=year, month=month,
                cycle_start_date=cycle_start, cycle_end_date=cycle_end,
                customer_name=f"{main_contract.customer_name} (替班)",
                is_substitute_bill=True, total_payable=D(0),
                source_substitute_record_id=sub_record.id
            )
            db.session.add(bill)

        substitute_employee_id = sub_record.substitute_user_id or sub_record.substitute_personnel_id
        if not substitute_employee_id:
            raise ValueError(f"Substitute record {sub_record.id} has no associated employee.")

        payroll = EmployeePayroll.query.filter_by(source_substitute_record_id=sub_record.id).first()
        if not payroll:
            payroll = EmployeePayroll(
                contract_id=main_contract.id, employee_id=substitute_employee_id,
                year=year, month=month, cycle_start_date=cycle_start, cycle_end_date=cycle_end,
                is_substitute_payroll=True, final_payout=D(0),
                source_substitute_record_id=sub_record.id
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
        current_app.logger.info(f"[SubCALC] 替班记录 {sub_record.id} 的账单已成功生成。")

    def _calculate_substitute_details(self, sub_record, main_contract):
        """计算替班记录的财务细节。"""
        QUANTIZER = D('0.01')
        substitute_days = D((sub_record.end_date - sub_record.start_date).days)
        substitute_level = D(sub_record.substitute_salary) # This is B-auntie's level
        overtime_days = D(sub_record.overtime_days or 0)
        substitute_type = sub_record.substitute_type

        # Common details
        details = {
            'type': 'substitute',
            'substitute_type': substitute_type,
            'main_contract_id': str(main_contract.id),
            'main_contract_type': main_contract.type,
            'substitute_record_id': str(sub_record.id),
            'substitute_user_id': str(sub_record.substitute_user_id or sub_record.substitute_personnel_id),
            'cycle_period': f"{sub_record.start_date.isoformat()} to {sub_record.end_date.isoformat()}",
            'base_work_days': str(substitute_days),
            'overtime_days': str(overtime_days),
            'total_days_worked': str(substitute_days + overtime_days),
            'customer_increase': '0.00', 'customer_decrease': '0.00',
            'employee_increase': '0.00', 'employee_decrease': '0.00',
            'discount': '0.00', 'first_month_deduction': '0.00',
            'log_extras': {},
            'level': str(substitute_level),
        }

        # Overtime fee is the same for both types
        # B阿姨级别 / 26 * 加班天数
        overtime_daily_rate = (substitute_level / D(26))
        overtime_fee = (overtime_daily_rate * overtime_days).quantize(QUANTIZER)
        details['customer_overtime_fee'] = str(overtime_fee)
        details['employee_overtime_payout'] = str(overtime_fee)
        details['log_extras']['overtime_reason'] = f"替班加班费: 替班级别({substitute_level})/26 * 加班天数({overtime_days})"


        if substitute_type == 'maternity_nurse':
            management_fee_rate = D(sub_record.substitute_management_fee)
            
            # 客户应付：B阿姨的级别 / 26 * 替班天数
            customer_daily_rate = (substitute_level * (D(1) - management_fee_rate) / D(26))
            customer_base_fee = (customer_daily_rate * substitute_days).quantize(QUANTIZER)
            

            # 员工工资：B阿姨的级别 * (1 - 管理费率) / 26 * 替班天数
            employee_daily_rate = (substitute_level * (D(1) - management_fee_rate) / D(26))
            employee_base_payout = (employee_daily_rate * substitute_days).quantize(QUANTIZER)
            
            # management_fee = (customer_base_fee - employee_base_payout).quantize(QUANTIZER)
            management_fee = (substitute_level *  management_fee_rate / D(26))

            details.update({
                'daily_rate': str(customer_daily_rate.quantize(QUANTIZER)),
                'employee_daily_rate': str(employee_daily_rate.quantize(QUANTIZER)),
                'management_fee_rate': str(management_fee_rate),
                'customer_base_fee': str(customer_base_fee),
                'management_fee': str(management_fee),
                'employee_base_payout': str(employee_base_payout)
            })
            details['log_extras']['customer_fee_reason'] = f"月嫂替班客户费用: 替班级别({substitute_level})*(1-{management_fee_rate*100}%)/26 * 替班天数({substitute_days})"
            details['log_extras']['employee_payout_reason'] = f"月嫂替班员工工资: 替班级别({substitute_level})*(1-{management_fee_rate*100}%)/26 * 替班天数({substitute_days})"

        elif substitute_type == 'nanny':
            # 育儿嫂替班不收取管理费
            management_fee_rate = D(0)
            management_fee = D(0)

            # 客户应付款 = B阿姨的级别 / 26 * 替班天数
            # 育儿嫂工资 = B阿姨的级别 / 26 * 替班天数
            daily_rate = (substitute_level / D(26))
            base_fee = (daily_rate * substitute_days).quantize(QUANTIZER)
            
            customer_base_fee = base_fee
            employee_base_payout = base_fee

            details.update({
                'daily_rate': str(daily_rate.quantize(QUANTIZER)),
                'employee_daily_rate': str(daily_rate.quantize(QUANTIZER)),
                'management_fee_rate': str(management_fee_rate),
                'customer_base_fee': str(customer_base_fee),
                'management_fee': str(management_fee),
                'employee_base_payout': str(employee_base_payout)
            })
            details['log_extras']['customer_fee_reason'] = f"育儿嫂替班客户费用: 替班级别({substitute_level})/26 * 替班天数({substitute_days})"
            details['log_extras']['employee_payout_reason'] = f"育儿嫂替班员工工资: 替班级别({substitute_level})/26 * 替班天数({substitute_days})"

        return details

    def _get_or_create_bill_and_payroll(self, contract, year, month, cycle_start_date, cycle_end_date):
        # 1. 首先尝试查询，这是最高效且最常见的路径
        bill = CustomerBill.query.filter_by(
            contract_id=contract.id,
            cycle_start_date=cycle_start_date,
            is_substitute_bill=False
        ).first()
        payroll = EmployeePayroll.query.filter_by(
            contract_id=contract.id,
            cycle_start_date=cycle_start_date,
            is_substitute_payroll=False
        ).first()

        # 2. 如果成功找到，则更新并返回
        if bill and payroll:
            current_app.logger.info(f"    [BILL UPDATE] Found existing bill/payroll for cycle {cycle_start_date}. Updating.")
            bill.year = year
            bill.month = month
            bill.cycle_end_date = cycle_end_date
            payroll.year = year
            payroll.month = month
            payroll.cycle_end_date = cycle_end_date
            return bill, payroll

        # 3. 如果没找到，则进入创建流程，并用 try/except 块来处理并发竞争
        current_app.logger.info(f"    [BILL CREATE] No existing bill/payroll found for cycle {cycle_start_date}. Attempting to create.")
        try:
            employee_id = contract.user_id or contract.service_personnel_id
            if not employee_id: raise ValueError(f"Contract {contract.id} has no associated employee.")

            bill = CustomerBill(
                contract_id=contract.id, year=year, month=month,
                cycle_start_date=cycle_start_date, cycle_end_date=cycle_end_date,
                customer_name=contract.customer_name,
                total_payable=D(0),  # 明确提供默认值
                is_substitute_bill=False
            )
            db.session.add(bill)

            payroll = EmployeePayroll(
                contract_id=contract.id, year=year, month=month,
                cycle_start_date=cycle_start_date, cycle_end_date=cycle_end_date,
                employee_id=employee_id,
                final_payout=D(0),  # 明确提供默认值
                is_substitute_payroll=False
            )
            db.session.add(payroll)

            # 立即 flush 以便在当前事务中捕获错误，但不 commit
            db.session.flush()
            current_app.logger.info(f"    [BILL CREATE] Successfully created new bill and payroll for cycle {cycle_start_date}.")
            return bill, payroll

        except IntegrityError:
            # 4. 如果在创建时发生唯一性冲突，则回滚并重新查询
            db.session.rollback()
            current_app.logger.warning(f"    [BILL CREATE] Race condition detected for cycle {cycle_start_date}. Re-querying.")

            bill = CustomerBill.query.filter_by(
                contract_id=contract.id,
                cycle_start_date=cycle_start_date,
                is_substitute_bill=False
            ).one()
            payroll = EmployeePayroll.query.filter_by(
                contract_id=contract.id,
                cycle_start_date=cycle_start_date,
                is_substitute_payroll=False
            ).one()

            # 更新刚刚获取到的记录
            bill.year = year
            bill.month = month
            bill.cycle_end_date = cycle_end_date
            payroll.year = year
            payroll.month = month
            payroll.cycle_end_date = cycle_end_date

            return bill, payroll
    
    def _get_or_create_attendance(self, contract, cycle_start_date, cycle_end_date):
        attendance = AttendanceRecord.query.filter_by(contract_id=contract.id, cycle_start_date=cycle_start_date).first()
        if not attendance:
            employee_id = contract.user_id or contract.service_personnel_id
            if not employee_id: raise ValueError(f"Contract {contract.id} has no associated employee.")
            
            default_work_days = 0
            if contract.type == 'maternity_nurse':
                default_work_days = 26
            elif contract.type == 'nanny':
                default_work_days = min((cycle_end_date - cycle_start_date).days, 26)

            attendance = AttendanceRecord(
                employee_id=employee_id, contract_id=contract.id,
                cycle_start_date=cycle_start_date, cycle_end_date=cycle_end_date,
                total_days_worked=default_work_days, overtime_days=0, 
                statutory_holiday_days=0
            )
            db.session.add(attendance)
            db.session.flush()
        return attendance
    
    def _get_adjustments(self, bill_id, payroll_id):
        customer_adjustments = FinancialAdjustment.query.filter_by(customer_bill_id=bill_id).all()
        employee_adjustments = FinancialAdjustment.query.filter_by(employee_payroll_id=payroll_id).all()
        
        cust_increase = sum(adj.amount for adj in customer_adjustments if adj.adjustment_type == AdjustmentType.CUSTOMER_INCREASE)
        cust_decrease = sum(adj.amount for adj in customer_adjustments if adj.adjustment_type == AdjustmentType.CUSTOMER_DECREASE)
        emp_increase = sum(adj.amount for adj in employee_adjustments if adj.adjustment_type == AdjustmentType.EMPLOYEE_INCREASE)
        emp_decrease = sum(adj.amount for adj in employee_adjustments if adj.adjustment_type == AdjustmentType.EMPLOYEE_DECREASE)
        
        return cust_increase, cust_decrease, emp_increase, emp_decrease
    
    def _calculate_final_amounts(self, bill, payroll, details):
        total_payable = (
            D(details['customer_base_fee']) + 
            D(details['customer_overtime_fee']) +
            D(details['management_fee']) + 
            D(details['customer_increase']) - 
            D(details['customer_decrease']) - 
            D(details.get('discount', 0)) -
            D(details.get('substitute_deduction', 0)) # 扣除替班费用
        )
        final_payout = (
            D(details['employee_base_payout']) + 
            D(details['employee_overtime_payout']) + 
            D(details['employee_increase']) - 
            D(details['employee_decrease']) -
            D(details.get('first_month_deduction', 0)) -
            D(details.get('substitute_deduction', 0)) # 扣除替班费用
        )

        bill.total_payable = total_payable.quantize(D('0.01'))
        payroll.final_payout = final_payout.quantize(D('0.01'))
        
        details['total_payable'] = str(bill.total_payable)
        details['final_payout'] = str(payroll.final_payout)
        
        return bill, payroll
    
    def _create_calculation_log(self, details):
        """根据计算详情字典，生成人类可读的计算过程日志。"""
        log = {}
        d = {k: D(v) for k, v in details.items() if isinstance(v, str) and v.replace('.', '', 1).isdigit()}
        log_extras = details.get('log_extras', {})
        calc_type = details.get('type')

        base_work_days = d.get('base_work_days', 0)
        overtime_days = d.get('overtime_days', 0)
        level = d.get('level', 0)

        if calc_type == 'substitute':
            log['基础劳务费'] = log_extras.get('customer_fee_reason', 'N/A')
            log['员工工资'] = log_extras.get('employee_payout_reason', 'N/A')
            if overtime_days > 0:
                log['加班费'] = log_extras.get('overtime_reason', 'N/A')
            if details.get('substitute_type') == 'maternity_nurse':
                log['管理费'] = f"客户应付({d.get('customer_base_fee', 0):.2f}) - 员工工资({d.get('employee_base_payout', 0):.2f}) = {d.get('management_fee', 0):.2f}"
            else:
                log['管理费'] = "0.00 (育儿嫂替班不收取管理费)"
        else:
            # Main contract types
            customer_daily_rate_formula = f"级别({level:.2f})/26"
            if calc_type == 'nanny':
                employee_daily_rate_formula = f"级别({level:.2f}) / 26"
                log['基础劳务费'] = f"{employee_daily_rate_formula} * 基本劳务天数({base_work_days}) = {d.get('employee_base_payout', 0):.2f}"
                log['加班费'] = f"{employee_daily_rate_formula} * 加班天数({overtime_days}) = {d.get('employee_overtime_payout', 0):.2f}"
                log['客户侧加班费'] = f"{customer_daily_rate_formula} * 加班天数({overtime_days}) = {d.get('customer_overtime_fee', 0):.2f}"
                log['本次交管理费'] = log_extras.get('management_fee_reason', 'N/A')
                if 'refund_amount' in log_extras: log['本次交管理费'] += f" | 末月退还: {log_extras['refund_amount']}"
                if d.get('first_month_deduction', 0) > 0: log['首月员工10%费用'] = log_extras.get('first_month_deduction_reason', 'N/A')
            else: # maternity_nurse & nanny_trial
                employee_daily_rate_formula = customer_daily_rate_formula
                log['基础劳务费'] = f"{customer_daily_rate_formula} * 基本劳务天数({base_work_days}) = {d.get('customer_base_fee', 0):.2f}"
                if overtime_days > 0: log['加班费'] = f"{customer_daily_rate_formula} * 加班天数({overtime_days}) = {d.get('customer_overtime_fee', 0):.2f}"
                if calc_type == 'maternity_nurse':
                    log['管理费'] = log_extras.get('management_fee_reason', 'N/A')
                    log['管理费率'] = log_extras.get('management_fee_rate_reason', 'N/A')
                    log['基础劳务费'] = f"({log_extras.get('employee_daily_rate_reason', '员工日薪')}) * 基本劳务天数({base_work_days}) = {d.get('customer_base_fee', 0):.2f}"
                    log['加班费'] = f"({log_extras.get('customer_overtime_daily_rate_reason', '客户加班日薪')}) * 加班天数({overtime_days}) = {d.get('customer_overtime_fee', 0):.2f}"
                    log['萌嫂保证金(工资)'] = f"({log_extras.get('employee_daily_rate_reason', '员工日薪')}) * 基本劳务天数({base_work_days}) = {d.get('employee_base_payout', 0):.2f}"
                if calc_type == 'nanny_trial' and d.get('first_month_deduction', 0) > 0:
                    log['首月员工10%费用'] = log_extras.get('first_month_deduction_reason', 'N/A')

            if d.get('substitute_deduction', 0) > 0 and calc_type != 'maternity_nurse':
                log_details_list = details.get('substitute_deduction_logs', [])
                if log_details_list:
                    log['被替班扣款'] = " + ".join(log_details_list)
                else:
                    log['被替班扣款'] = f"从替班账单的基础劳务费中扣除 = {d.get('substitute_deduction', 0):.2f}"

        log['客应付款'] = f"基础劳务费({d.get('customer_base_fee', 0):.2f}) + 加班费({d.get('customer_overtime_fee', 0):.2f}) + 管理费({d.get('management_fee', 0):.2f}) - 优惠({d.get('discount', 0):.2f}) - 被替班扣款({d.get('substitute_deduction', 0):.2f}) + 增款({d.get('customer_increase', 0):.2f}) - 减款({d.get('customer_decrease', 0):.2f}) = {d.get('total_payable', 0):.2f}"
        log['萌嫂应领款'] = f"基础工资({d.get('employee_base_payout', 0):.2f}) + 加班工资({d.get('employee_overtime_payout', 0):.2f}) + 奖励/增款({d.get('employee_increase', 0):.2f}) - 服务费/减款({d.get('first_month_deduction', 0) + d.get('employee_decrease', 0):.2f}) - 被替班扣款({d.get('substitute_deduction', 0):.2f}) = {d.get('final_payout', 0):.2f}"

        return log
    
    def _update_bill_with_log(self, bill, payroll, details, log):
        details['calculation_log'] = log
        bill.calculation_details = details
        payroll.calculation_details = details.copy()
        
        attributes.flag_modified(bill, "calculation_details")
        attributes.flag_modified(payroll, "calculation_details")
        
        db.session.add(bill)
        db.session.add(payroll)
        
        return bill, payroll
