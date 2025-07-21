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


D = decimal.Decimal
CTX = decimal.Context(prec=10)

class BillingEngine:
    def calculate_for_month(self, year: int, month: int, contract_id=None, force_recalculate=False):
        current_app.logger.info(f"开始计算contract:{contract_id}  {year}-{month} 的账单 force_recalculate:{force_recalculate}" )
        if contract_id:
            contracts_to_process = [db.session.get(BaseContract, contract_id)]
        else:
            contracts_to_process = BaseContract.query.filter_by(status='active').all()

        for contract in contracts_to_process:
            if not contract: continue
            
            try:
                if contract.type == 'maternity_nurse':
                    self._calculate_maternity_nurse_bill_for_month(contract, year, month, force_recalculate)
                
                elif contract.type == 'nanny':
                    self._calculate_nanny_bill_for_month(contract, year, month, force_recalculate)

                db.session.commit()
            except Exception as e:
                current_app.logger.error(f"为合同 {contract.id} 计算账单时失败: {e}", exc_info=True)
                db.session.rollback()

    def _calculate_nanny_bill_for_month(self, contract: NannyContract, year: int, month: int, force_recalculate=False):
        """育儿嫂计费逻辑的主入口，严格按照 ini.md 执行。"""
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
        
        # 核心计算逻辑
        details = self._calculate_nanny_details(contract, bill, payroll)
        
        # 更新最终金额
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)
        
        # 创建并保存日志
        log = self._create_calculation_log(details)
        self._update_bill_with_log(bill, payroll, details, log)
        
        current_app.logger.info(f"    [NannyCALC] 计算完成 for contract {contract.id}: {bill.calculation_details}")

    def generate_all_bills_for_contract(self, contract_id):
        """为单个合同的整个生命周期生成所有账单。"""
        current_app.logger.info(f"--- [Pre-calculation] 开始为合同 {contract_id} 生成全周期账单 ---")
        contract = db.session.get(BaseContract, contract_id)
        if not contract:
            current_app.logger.error(f"[Pre-calculation] 合同 {contract_id} 未找到。")
            return

        start_date = contract.start_date or contract.actual_onboarding_date
        end_date = contract.end_date or contract.expected_offboarding_date

        if not start_date or not end_date:
            current_app.logger.warning(f"[Pre-calculation] 合同 {contract_id} 缺少开始或结束日期，无法预计算。")
            return

        current_month_start = date(start_date.year, start_date.month, 1)
        while current_month_start <= end_date:
            year, month = current_month_start.year, current_month_start.month
            current_app.logger.info(f"  [Pre-calculation] 正在处理 {year}-{month}...")
            self.calculate_for_month(year, month, contract_id=contract.id, force_recalculate=True)
            
            current_month_start += relativedelta(months=1)
        
        current_app.logger.info(f"--- [Pre-calculation] 合同 {contract_id} 的全周期账单已生成完毕 ---")

    def _get_nanny_cycle_for_month(self, contract, year, month):
        """计算指定育儿嫂合同在目标年月的服务周期。"""
        first_day_of_month = date(year, month, 1)
        _, num_days_in_month = calendar.monthrange(year, month)
        last_day_of_month = date(year, month, num_days_in_month)

        if not contract.start_date or contract.start_date > last_day_of_month or (contract.end_date and contract.end_date < first_day_of_month):
            return None, None

        if contract.is_monthly_auto_renew:
            cycle_start = max(contract.start_date, first_day_of_month)
            cycle_end = min(contract.end_date or last_day_of_month, last_day_of_month)
            if cycle_start > cycle_end:
                return None, None
            return cycle_start, cycle_end
        else:
            current_cycle_start = contract.start_date
            while current_cycle_start <= (contract.end_date or last_day_of_month):
                current_cycle_end = current_cycle_start + relativedelta(months=1) - timedelta(days=1)
                
                if contract.end_date and current_cycle_end > contract.end_date:
                    current_cycle_end = contract.end_date

                if max(first_day_of_month, current_cycle_start) <= min(last_day_of_month, current_cycle_end):
                    return current_cycle_start, current_cycle_end

                if current_cycle_start > last_day_of_month or (contract.end_date and current_cycle_start > contract.end_date):
                    break
                
                current_cycle_start = current_cycle_end + timedelta(days=1)
            return None, None

    def _calculate_nanny_details(self, contract: NannyContract, bill: CustomerBill, payroll: EmployeePayroll):
        """根据 ini.md 规范，计算育儿嫂合同的所有财务细节。"""
        QUANTIZER = D('0.01')
    
        # 1. 定义核心变量
        level = D(contract.employee_level or 0)
        cycle_start = bill.cycle_start_date
        cycle_end = bill.cycle_end_date
    
        # 2. 获取考勤和财务调整
        attendance = self._get_or_create_attendance(contract, cycle_start, cycle_end)
        overtime_days = D(attendance.overtime_days)
        cust_increase, cust_decrease, emp_increase, emp_decrease = self._get_adjustments(bill.id, payroll.id)
    
        # 3. 计算天数和日薪 (严格按照 ini.md)
        cycle_actual_days = (cycle_end - cycle_start).days + 1
        base_work_days = D(min(cycle_actual_days, 26))
        total_days_worked = base_work_days + overtime_days
    
        customer_daily_rate = (level / D(26)).quantize(QUANTIZER)
        employee_daily_rate = ((level * D('0.9')) / D(26)).quantize(QUANTIZER)
    
        # 4. 计算客户账单各项
        customer_base_fee = (employee_daily_rate * base_work_days).quantize(QUANTIZER)
        customer_overtime_fee = (customer_daily_rate * overtime_days).quantize(QUANTIZER)
    
        # 管理费计算 (复杂逻辑)
        management_fee = D(0)
        is_first_bill = (cycle_start == contract.start_date)
        is_last_bill = (contract.end_date and cycle_end == contract.end_date)
    
        # --- 用于日志的额外变量 ---
        log_extras = {}
    
        if contract.is_monthly_auto_renew:
            management_fee = (level * D('0.1')).quantize(QUANTIZER)
            log_extras['management_fee_reason'] = "月签合同，按月收取"
        else: # 非月签
            if is_first_bill:
                delta = relativedelta(contract.end_date, contract.start_date)
                total_months = delta.years * 12 + delta.months
                if delta.days > 0 or (total_months == 0 and cycle_actual_days > 0):
                    total_months += 1
    
                management_fee = (level * D('0.1') * total_months).quantize(QUANTIZER)
                log_extras['management_fee_reason'] = f"非月签合同首月，一次性收取 {total_months} 个月管理费 ({management_fee} * {total_months})"
                log_extras['total_months_for_fee'] = total_months
            else:
                log_extras['management_fee_reason'] = "非月签合同非首月，不收取管理费"
    
            if is_last_bill and cycle_actual_days < 30:
                monthly_management_fee = (level * D('0.1')).quantize(QUANTIZER)
                daily_management_fee = (monthly_management_fee / D(30)).quantize(QUANTIZER)
                refund_days = 30 - cycle_actual_days
                refund_amount = (daily_management_fee * refund_days).quantize(QUANTIZER)
                cust_decrease += refund_amount
                log_extras['management_fee_refund_reason'] = f"末月服务不足30天，按比例退还 {refund_days} 天管理费"
                log_extras['refund_amount'] = str(refund_amount)
    
    
        # 5. 计算员工薪酬各项
        employee_base_payout = (employee_daily_rate * base_work_days).quantize(QUANTIZER)
        employee_overtime_payout = (employee_daily_rate * overtime_days).quantize(QUANTIZER)
    
        first_month_deduction = D(0)
        if is_first_bill:
            potential_income = employee_base_payout + employee_overtime_payout + emp_increase - emp_decrease
            service_fee_due = (level * D('0.1')).quantize(QUANTIZER)
            first_month_deduction = min(potential_income, service_fee_due)
            log_extras['first_month_deduction_reason'] = f"员工首月服务费: 级别*10%({service_fee_due:.2f}) 或 当期总收入({potential_income:.2f}) 取两者小的那个值)"
    
        return {
            'type': 'nanny', 'level': str(level), 'cycle_period': f"{cycle_start.isoformat()} to {cycle_end.isoformat()}",
            'base_work_days': str(base_work_days), 'overtime_days': str(overtime_days), 'total_days_worked': str(total_days_worked),
            'customer_base_fee': str(customer_base_fee), 'customer_overtime_fee': str(customer_overtime_fee),
            'management_fee': str(management_fee), 'customer_increase': str(cust_increase), 'customer_decrease': str(cust_decrease),
            'employee_base_payout': str(employee_base_payout), 'employee_overtime_payout': str(employee_overtime_payout),
            'first_month_deduction': str(first_month_deduction), 'employee_increase': str(emp_increase), 'employee_decrease': str(emp_decrease),
            'customer_daily_rate': str(customer_daily_rate), 'employee_daily_rate': str(employee_daily_rate),
            'log_extras': log_extras,
        }

    def _calculate_maternity_nurse_bill_for_month(self, contract: MaternityNurseContract, year: int, month: int, force_recalculate=False):
        current_app.logger.info(f"  [MN CALC] 开始处理月嫂合同 {contract.id} for {year}-{month}")
        if not contract.actual_onboarding_date:
            current_app.logger.info(f"    [MN CALC] 合同 {contract.id} 缺少实际上户日期，跳过。")
            return

        first_day_of_month = date(year, month, 1)
        _, num_days_in_month = calendar.monthrange(year, month)
        last_day_of_month = date(year, month, num_days_in_month)

        cycle_start = contract.actual_onboarding_date
        contract_end = contract.expected_offboarding_date or contract.end_date or last_day_of_month

        while cycle_start <= contract_end:
            cycle_end = cycle_start + timedelta(days=25)
            
            if cycle_end > contract_end:
                cycle_end = contract_end

            if first_day_of_month <= cycle_end <= last_day_of_month:
                current_app.logger.info(f"    [MN CALC] 找到一个归属于 {year}-{month} 的结算周期: {cycle_start} to {cycle_end}")
                self._process_one_billing_cycle(contract, cycle_start, cycle_end, year, month, force_recalculate)

            if cycle_start > last_day_of_month:
                break
            
            cycle_start = cycle_end + timedelta(days=1)

    def _process_one_billing_cycle(self, contract: MaternityNurseContract, cycle_start_date, cycle_end_date, year: int, month: int, force_recalculate=False):
        current_app.logger.info(f"      [CYCLE PROC] 开始处理周期 {cycle_start_date} to {cycle_end_date} for settlement month {year}-{month}")

        bill, payroll = self._get_or_create_bill_and_payroll(contract, year, month, cycle_start_date, cycle_end_date)

        if not force_recalculate and bill.calculation_details and 'calculation_log' in bill.calculation_details:
            current_app.logger.info(f"      [CYCLE PROC] 周期 {cycle_start_date} 的账单已存在且无需强制重算，跳过。")
            return
        
        # 核心计算逻辑
        details = self._calculate_maternity_nurse_details(contract, bill, payroll)
        
        # 更新最终金额
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)
        
        # 创建并保存日志
        log = self._create_calculation_log(details)
        self._update_bill_with_log(bill, payroll, details, log)
        
        current_app.logger.info(f"      [CYCLE PROC] 周期 {cycle_start_date} 计算完成。客户应付: {bill.total_payable}, 员工应领: {payroll.final_payout}")

    def _get_or_create_bill_and_payroll(self, contract, year, month, cycle_start_date, cycle_end_date):
        bill = CustomerBill.query.filter_by(contract_id=contract.id, cycle_start_date=cycle_start_date).first()
        payroll = EmployeePayroll.query.filter_by(contract_id=contract.id, cycle_start_date=cycle_start_date).first()

        if not bill:
            bill = CustomerBill(
                contract_id=contract.id, year=year, month=month,
                cycle_start_date=cycle_start_date, cycle_end_date=cycle_end_date,
                customer_name=contract.customer_name,
                total_payable=D(0) # <<<--- 修正：提供默认值
            )
            db.session.add(bill)
        else:
            bill.year, bill.month, bill.cycle_end_date = year, month, cycle_end_date

        if not payroll:
            employee_id = contract.user_id or contract.service_personnel_id
            if not employee_id: raise ValueError(f"Contract {contract.id} has no associated employee.")
            payroll = EmployeePayroll(
                contract_id=contract.id, year=year, month=month,
                cycle_start_date=cycle_start_date, cycle_end_date=cycle_end_date,
                employee_id=employee_id,
                final_payout=D(0) # <<<--- 修正：提供默认值
            )
            db.session.add(payroll)
        else:
            payroll.year, payroll.month, payroll.cycle_end_date = year, month, cycle_end_date
        
        db.session.flush()
        return bill, payroll
    
    def _get_or_create_attendance(self, contract, cycle_start_date, cycle_end_date):
        attendance = AttendanceRecord.query.filter_by(contract_id=contract.id, cycle_start_date=cycle_start_date).first()
        if not attendance:
            employee_id = contract.user_id or contract.service_personnel_id
            if not employee_id: raise ValueError(f"Contract {contract.id} has no associated employee.")
            
            # 默认出勤天数根据合同类型决定
            default_work_days = 0
            if contract.type == 'maternity_nurse':
                default_work_days = 26
            elif contract.type == 'nanny':
                default_work_days = min((cycle_end_date - cycle_start_date).days + 1, 26)

            attendance = AttendanceRecord(
                employee_id=employee_id, contract_id=contract.id,
                cycle_start_date=cycle_start_date, cycle_end_date=cycle_end_date,
                total_days_worked=default_work_days, # total_days_worked 将被重新计算，这里只是占位
                overtime_days=0, 
                statutory_holiday_days=0 # 已弃用，但为兼容旧模型保留
            )
            db.session.add(attendance)
            db.session.flush() # 确保获得ID
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
        total_payable = D(0)
        final_payout = D(0)

        if details['type'] == 'maternity_nurse':
            total_payable = (
                D(details['customer_base_fee']) + 
                D(details['customer_overtime_fee']) +
                D(details['management_fee']) + 
                D(details['customer_increase']) - 
                D(details['customer_decrease']) - 
                D(details['discount'])
            )
            final_payout = (
                D(details['employee_base_payout']) + 
                D(details['employee_overtime_payout']) + 
                D(details['bonus_5_percent']) + 
                D(details['employee_increase']) - 
                D(details['employee_decrease'])
            )
        elif details['type'] == 'nanny':
            total_payable = (
                D(details['customer_base_fee']) +
                D(details['customer_overtime_fee']) +
                D(details['management_fee']) +
                D(details['customer_increase']) -
                D(details['customer_decrease'])
            )
            final_payout = (
                D(details['employee_base_payout']) +
                D(details['employee_overtime_payout']) +
                D(details['employee_increase']) -
                D(details['employee_decrease']) -
                D(details['first_month_deduction'])
            )

        bill.total_payable = total_payable.quantize(D('0.01'))
        payroll.final_payout = final_payout.quantize(D('0.01'))
        
        details['total_payable'] = str(bill.total_payable)
        details['final_payout'] = str(payroll.final_payout)
        
        return bill, payroll
    
    def _calculate_maternity_nurse_details(self, contract: MaternityNurseContract, bill: CustomerBill, payroll: EmployeePayroll):
        """根据 ini.md 规范，计算月嫂合同的所有财务细节。"""
        QUANTIZER = D('0.01')
    
        # 1. 定义核心变量
        level = D(contract.employee_level or 0)
        management_fee_rate = D(contract.management_fee_rate or 0)
        discount = D(contract.discount_amount or 0)
        security_deposit = D(contract.security_deposit_paid or 0)
    
        cycle_start = bill.cycle_start_date
        cycle_end = bill.cycle_end_date
    
        # 2. 获取考勤和财务调整
        attendance = self._get_or_create_attendance(contract, cycle_start, cycle_end)
        overtime_days = D(attendance.overtime_days)
        cust_increase, cust_decrease, emp_increase, emp_decrease = self._get_adjustments(bill.id, payroll.id)
    
        # 3. 计算天数和日薪 (修正最后账单月的问题)
        # 日薪始终按标准26天计算
        daily_rate = (level / D(26)).quantize(QUANTIZER)
    
        # 基本劳务天数应为当前周期的实际天数，但不能超过26天
        actual_cycle_days = (cycle_end - cycle_start).days + 1
        base_work_days = D(min(actual_cycle_days, 26))
    
        total_days_worked = base_work_days + overtime_days
    
        # 4. 计算客户账单各项
        customer_base_fee = (daily_rate * base_work_days).quantize(QUANTIZER)
        customer_overtime_fee = (daily_rate * overtime_days).quantize(QUANTIZER)
        management_fee = (customer_base_fee * management_fee_rate).quantize(QUANTIZER)
    
        # 末月特殊逻辑
        is_last_bill = (contract.end_date and cycle_end >= contract.end_date)
        if is_last_bill:
            cust_decrease += security_deposit
    
        # 5. 计算员工薪酬各项
        employee_base_payout = (daily_rate * base_work_days).quantize(QUANTIZER)
        employee_overtime_payout = (daily_rate * overtime_days).quantize(QUANTIZER)
    
        bonus_5_percent = D(0)
        if management_fee_rate == D('0.15'):
            bonus_5_percent = (level * D('0.05')).quantize(QUANTIZER)
    
        return {
            'type': 'maternity_nurse', 'level': str(level), 'cycle_period': f"{cycle_start.isoformat()} to {cycle_end.isoformat()}",
            'base_work_days': str(base_work_days), 'overtime_days': str(overtime_days), 'total_days_worked': str(total_days_worked),
            'daily_rate': str(daily_rate), 'management_fee_rate': str(management_fee_rate),
            'customer_base_fee': str(customer_base_fee), 'customer_overtime_fee': str(customer_overtime_fee),
            'management_fee': str(management_fee), 'discount': str(discount),
            'security_deposit_return': str(security_deposit) if is_last_bill else '0.00',
            'customer_increase': str(cust_increase), 'customer_decrease': str(cust_decrease),
            'employee_base_payout': str(employee_base_payout), 'employee_overtime_payout': str(employee_overtime_payout),
            'bonus_5_percent': str(bonus_5_percent), 'employee_increase': str(emp_increase), 'employee_decrease': str(emp_decrease),
        }
    
    def _create_calculation_log(self, details):
        log = {}
        try:
            if details.get('type') == 'maternity_nurse':
                log['基础劳务费'] = f"级别({D(details['level']):.2f})"
                log['加班费'] = f"日薪({D(details['daily_rate']):.2f}) * 加班天数({details['overtime_days']}) = {D(details['customer_overtime_fee']):.2f}"
                log['管理费'] = f"基础劳务费({D(details['customer_base_fee']):.2f}) * 管理费率({D(details['management_fee_rate']):.0%}) = {D(details['management_fee']):.2f}"
    
                final_calc_str = (
                    f"基础劳务费({D(details['customer_base_fee']):.2f}) + 加班费({D(details['customer_overtime_fee']):.2f}) + 管理费({D(details['management_fee']):.2f}) "
                    f"- 优惠({D(details['discount']):.2f}) + 增款({D(details['customer_increase']):.2f}) - 减款({D(details['customer_decrease']):.2f})"
                )
                if D(details['security_deposit_return']) > 0:
                    final_calc_str += f"\n(减款中包含末月退还的保证金: {D(details['security_deposit_return']):.2f})"
                final_calc_str += f"\n= {D(details['total_payable']):.2f}"
                log['客应付款'] = final_calc_str
    
                log['萌嫂保证金(工资)'] = f"日薪({D(details['daily_rate']):.2f}) * 基本劳务天数({details['base_work_days']}) = {D(details['employee_base_payout']):.2f}"
                log['员工加班费'] = f"日薪({D(details['daily_rate']):.2f}) * 加班天数({details['overtime_days']}) = {D(details['employee_overtime_payout']):.2f}"
                if D(details['bonus_5_percent']) > 0:
                    log['5%奖励'] = f"级别工资({D(details['level']):.2f}) * 5% = {D(details['bonus_5_percent']):.2f}"
                log['萌嫂应领款'] = f"保证金({D(details['employee_base_payout']):.2f}) + 加班费({D(details['employee_overtime_payout']):.2f}) + 奖励({D(details['bonus_5_percent']):.2f}) + 增款({D(details['employee_increase']):.2f}) - 减款({D(details['employee_decrease']):.2f}) = {D(details['final_payout']):.2f}"
    
            elif details.get('type') == 'nanny':
                log_extras = details.get('log_extras', {})
                log['基础劳务费'] = f"(级别({D(details['level']):.2f}) * 90% / 26) * 基本劳务天数({details['base_work_days']}) = {D(details['customer_base_fee']):.2f}"
                log['加班费'] = f"(级别({D(details['level']):.2f}) / 26) * 加班天数({details['overtime_days']}) = {D(details['customer_overtime_fee']):.2f}"
                log['本次交管理费'] = f"{log_extras.get('management_fee_reason', '根据合同类型计算')} = {D(details['management_fee']):.2f}"
    
                final_calc_str = f"基础劳务费({D(details['customer_base_fee']):.2f}) + 加班费({D(details['customer_overtime_fee']):.2f}) + 管理费({D(details['management_fee']):.2f}) + 增款({D(details['customer_increase']):.2f}) - 减款({D(details['customer_decrease']):.2f})"
                if 'management_fee_refund_reason' in log_extras:
                    final_calc_str += f"\n(减款中包含: {log_extras['management_fee_refund_reason']} -{D(log_extras['refund_amount']):.2f})"
                final_calc_str += f"\n= {D(details['total_payable']):.2f}"
                log['客应付款'] = final_calc_str
    
                log['员工基础劳务费'] = f"(级别({D(details['level']):.2f}) * 90% / 26) * 基本劳务天数({details['base_work_days']}) = {D(details['employee_base_payout']):.2f}"
                log['员工加班费'] = f"(级别({D(details['level']):.2f}) * 90% / 26) * 加班天数({details['overtime_days']}) = {D(details['employee_overtime_payout']):.2f}"
                if D(details['first_month_deduction']) > 0:
                    log['首月员工10%费用'] = f"{log_extras.get('first_month_deduction_reason', '首月服务费')} = {D(details['first_month_deduction']):.2f}"
                log['萌嫂应领款'] = f"基础劳务费({D(details['employee_base_payout']):.2f}) + 加班费({D(details['employee_overtime_payout']):.2f}) - 首月费用({D(details['first_month_deduction']):.2f}) + 增款({D(details['employee_increase']):.2f}) - 减款({D(details['employee_decrease']):.2f}) = {D(details['final_payout']):.2f}"
    
        except (KeyError, TypeError, decimal.InvalidOperation) as e:
            current_app.logger.error(f"创建计算日志时出错: {e}. Details: {details}")
            return {"error": "生成计算日志时发生内部错误"}
    
        return log
    
    def _update_bill_with_log(self, bill, payroll, details, log):
        from sqlalchemy.orm.attributes import flag_modified
        details['calculation_log'] = log
        bill.calculation_details = details
        payroll.calculation_details = details.copy()
        
        flag_modified(bill, "calculation_details")
        flag_modified(payroll, "calculation_details")
        
        db.session.add(bill)
        db.session.add(payroll)
        
        return bill, payroll
    
    def recalculate_single_bill(self, bill_id):
        bill = db.session.get(CustomerBill, bill_id)
        if not bill: raise ValueError(f"Bill with ID {bill_id} not found.")
        contract = bill.contract
        payroll = EmployeePayroll.query.filter_by(contract_id=contract.id, cycle_start_date=bill.cycle_start_date).first()
        if not payroll: raise ValueError(f"Payroll for bill {bill_id} not found.")
            
        attendance = self._get_or_create_attendance(contract, bill.cycle_start_date, bill.cycle_end_date)
        adjustments = self._get_adjustments(bill.id, payroll.id)
        
        if contract.type == 'maternity_nurse':
            details = self._calculate_maternity_nurse_details(contract, attendance, adjustments)
        elif contract.type == 'nanny':
            self._calculate_nanny_bill(contract, bill)
            return bill, payroll
        else:
            raise TypeError(f"Unknown contract type: {contract.type}")
            
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)
        log = self._create_calculation_log(details)
        self._update_bill_with_log(bill, payroll, details, log)
        
        db.session.commit()
        current_app.logger.info(f"Successfully recalculated bill {bill_id}.")
        return bill, payroll