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
        """
        【已重构】计算指定育儿嫂合同在目标年月的服务周期。
        遵循三段式逻辑：首月、中间月、末月。
        """
        if not contract.start_date or not contract.end_date:
            return None, None

        first_day_of_target_month = date(year, month, 1)
        _, num_days_in_target_month = calendar.monthrange(year, month)
        last_day_of_target_month = date(year, month, num_days_in_target_month)

        start_year, start_month = contract.start_date.year, contract.start_date.month
        end_year, end_month = contract.end_date.year, contract.end_date.month

        # 1. 判断是否为“首月”账单
        if year == start_year and month == start_month:
            # 如果合同在一个月内开始和结束
            if start_year == end_year and start_month == end_month:
                return contract.start_date, contract.end_date
            else:
                # 正常的首月账单
                _, num_days_in_start_month = calendar.monthrange(start_year, start_month)
                last_day_of_start_month = date(start_year, start_month, num_days_in_start_month)
                return contract.start_date, last_day_of_start_month

        # 2. 判断是否为“末月”账单
        if year == end_year and month == end_month:
            # 确保不是在一个月内开始和结束的情况（已在上面处理）
            if not (start_year == end_year and start_month == end_month):
                first_day_of_end_month = date(end_year, end_month, 1)
                return first_day_of_end_month, contract.end_date

        # 3. 判断是否为“中间月份”账单
        # 条件：目标月份在合同的开始月份之后，且在结束月份之前
        target_month_date = date(year, month, 1)
        start_month_date = date(start_year, start_month, 1)
        end_month_date = date(end_year, end_month, 1)

        if start_month_date < target_month_date < end_month_date:
            return first_day_of_target_month, last_day_of_target_month

        # 4. 如果以上都不是，则说明本月没有账单
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

        # --- 核心修正：单独查询并处理优惠金额 ---
        cust_discount = D(db.session.query(func.sum(FinancialAdjustment.amount)).filter(
            FinancialAdjustment.customer_bill_id == bill.id,
            FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DISCOUNT
        ).scalar() or 0)

        # 3. 计算天数和日薪
        cycle_actual_days = (cycle_end - cycle_start).days + 1
        base_work_days = D(min(cycle_actual_days, 26))
        total_days_worked = base_work_days + overtime_days

        customer_daily_rate_full_precision = (level / D(26))
        employee_daily_rate_full_precision = ((level * D('0.9')) / D(26))

        # 4. 计算客户账单各项
        customer_base_fee = (employee_daily_rate_full_precision * base_work_days).quantize(QUANTIZER)
        customer_overtime_fee = (customer_daily_rate_full_precision * overtime_days).quantize(QUANTIZER)

        # (管理费和特殊逻辑部分保持不变)
        management_fee = D(0)
        is_first_bill = (cycle_start == contract.start_date)
        is_last_bill = (contract.end_date and cycle_end == contract.end_date)
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
                log_extras['management_fee_reason'] = f"非月签合同首月，一次性收取 {total_months} 个月管理费"
                log_extras['total_months_for_fee'] = total_months
            else:
                log_extras['management_fee_reason'] = "非月签合同非首月，不收取管理费"

            if is_last_bill and cycle_actual_days < 30:
                monthly_management_fee = (level * D('0.1')).quantize(QUANTIZER)
                daily_management_fee = (monthly_management_fee / D(30))
                refund_days = 30 - cycle_actual_days
                refund_amount = (daily_management_fee * refund_days).quantize(QUANTIZER)
                cust_decrease += refund_amount
                log_extras['management_fee_refund_reason'] = f"末月服务不足30天，按比例退还 {refund_days} 天管理费"
                log_extras['refund_amount'] = str(refund_amount)

        # 5. 计算员工薪酬各项
        employee_base_payout = (employee_daily_rate_full_precision * base_work_days).quantize(QUANTIZER)
        employee_overtime_payout = (employee_daily_rate_full_precision * overtime_days).quantize(QUANTIZER)

        first_month_deduction = D(0)
        if is_first_bill:
            potential_income = employee_base_payout + employee_overtime_payout + emp_increase - emp_decrease
            service_fee_due = (level * D('0.1')).quantize(QUANTIZER)
            first_month_deduction = min(potential_income, service_fee_due)
            log_extras['first_month_deduction_reason'] = f"员工首月服务费, min(当期总收入({potential_income:.2f}), 级别*10%({service_fee_due:.2f}))"

        return {
            'type': 'nanny', 'level': str(level), 'cycle_period': f"{cycle_start.isoformat()} to {cycle_end.isoformat()}",
            'base_work_days': str(base_work_days), 'overtime_days': str(overtime_days), 'total_days_worked': str(total_days_worked),
            'customer_base_fee': str(customer_base_fee), 'customer_overtime_fee': str(customer_overtime_fee),
            'management_fee': str(management_fee), 'customer_increase': str(cust_increase), 'customer_decrease': str(cust_decrease),
            'discount': str(cust_discount), # <-- 新增返回字段
            'employee_base_payout': str(employee_base_payout), 'employee_overtime_payout': str(employee_overtime_payout),
            'first_month_deduction': str(first_month_deduction), 'employee_increase': str(emp_increase), 'employee_decrease': str(emp_decrease),
            'customer_daily_rate': str(customer_daily_rate_full_precision.quantize(QUANTIZER)),
            'employee_daily_rate': str(employee_daily_rate_full_precision.quantize(QUANTIZER)),
            'log_extras': log_extras,
        }

    def _calculate_maternity_nurse_bill_for_month(self, contract: MaternityNurseContract, year: int, month: int, force_recalculate=False):
        current_app.logger.info(f"  [MN CALC] 开始处理月嫂合同 {contract.id} for {year}-{month}")
        if not contract.actual_onboarding_date:
            current_app.logger.info(f"    [MN CALC] 合同 {contract.id} 缺少实际上户日期，跳过。")
            return
    
        cycle_start = contract.actual_onboarding_date
        contract_end = contract.expected_offboarding_date or contract.end_date
    
        if not contract_end:
            current_app.logger.warning(f"    [MN CALC] 合同 {contract.id} 缺少结束日期，无法计算。")
            return
    
        while cycle_start < contract_end:
            cycle_end = cycle_start + timedelta(days=26)
            if cycle_end > contract_end:
                cycle_end = contract_end
    
            # --- 核心修正：确保只处理结束日期在本月的周期 ---
            if cycle_end.year == year and cycle_end.month == month:
                current_app.logger.info(f"    [MN CALC] 找到一个归属于 {year}-{month} 的结算周期: {cycle_start} to {cycle_end}")
                self._process_one_billing_cycle(contract, cycle_start, cycle_end, year, month, force_recalculate)
    
            if cycle_end >= contract_end:
                break
    
            cycle_start = cycle_end

    def _process_one_billing_cycle(self, contract: MaternityNurseContract, cycle_start_date, cycle_end_date, year: int, month: int, force_recalculate=False):
        current_app.logger.info(f"      [CYCLE PROC] 开始处理周期 {cycle_start_date} to {cycle_end_date} for settlement month {year}-{month}")

        # --- 核心修正：在任何操作前，先检查账单是否已存在 ---
        existing_bill = CustomerBill.query.filter_by(contract_id=contract.id, cycle_start_date=cycle_start_date).first()

        if existing_bill and not force_recalculate:
            current_app.logger.info(f"      [CYCLE PROC] 周期 {cycle_start_date} 的账单已存在且无需强制重算，跳过。")
            return

        bill, payroll = self._get_or_create_bill_and_payroll(contract, year, month, cycle_start_date, cycle_end_date)

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
                D(details['customer_decrease']) -
                D(details.get('discount', 0))
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
    
        # 3. 计算天数和日薪 (核心修正：保持中间计算的最高精度)
        # --- 使用完整精度进行计算 ---
        daily_rate_full_precision = (level / D(26))
    
        actual_cycle_days = (cycle_end - cycle_start).days + 1
        base_work_days = D(min(actual_cycle_days, 26))
    
        total_days_worked = base_work_days + overtime_days
    
        # 4. 计算客户账单各项 (使用完整精度日薪，最后再舍入)
        customer_base_fee = (daily_rate_full_precision * base_work_days).quantize(QUANTIZER)
        customer_overtime_fee = (daily_rate_full_precision * overtime_days).quantize(QUANTIZER)
        management_fee = (customer_base_fee * management_fee_rate).quantize(QUANTIZER)
    
        is_last_bill = (contract.expected_offboarding_date and cycle_end == contract.expected_offboarding_date)
        if is_last_bill:
            cust_decrease += security_deposit
    
        # 5. 计算员工薪酬各项 (同样使用完整精度日薪)
        employee_base_payout = (daily_rate_full_precision * base_work_days).quantize(QUANTIZER)
        employee_overtime_payout = (daily_rate_full_precision * overtime_days).quantize(QUANTIZER)
    
        bonus_5_percent = D(0)
        if management_fee_rate == D('0.15'):
            bonus_5_percent = (level * D('0.05')).quantize(QUANTIZER)
    
        return {
            'type': 'maternity_nurse', 'level': str(level), 'cycle_period': f"{cycle_start.isoformat()} to {cycle_end.isoformat()}",
            'base_work_days': str(base_work_days), 'overtime_days': str(overtime_days), 'total_days_worked': str(total_days_worked),
            'daily_rate': str(daily_rate_full_precision.quantize(QUANTIZER)), # 仅用于日志显示
            'management_fee_rate': str(management_fee_rate),
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
            # --- 辅助函数，用于构建公式字符串 ---
            def build_formula_string(parts):
                valid_parts = [p for p in parts if p['value'] and D(p['value']) != 0]
                if not valid_parts:
                    return "0.00"

                formula = []
                for i, part in enumerate(valid_parts):
                    if i == 0:
                        formula.append(f"{part['label']}({D(part['value']):.2f})")
                    else:
                        sign = '+' if D(part['value']) > 0 else '-'
                        formula.append(f" {sign} {part['label']}({abs(D(part['value'])):.2f})")

                return " ".join(formula)

            if details.get('type') == 'maternity_nurse':
                # --- 客户应付款日志 ---
                if D(details['customer_base_fee']) != 0: log['基础劳务费'] = f"日薪({D(details['daily_rate']):.2f}) * 基本劳务天数({details['base_work_days']}) = {D(details['customer_base_fee']):.2f}"
                if D(details['customer_overtime_fee']) != 0: log['加班费'] = f"日薪({D(details['daily_rate']):.2f}) * 加班天数({details['overtime_days']}) = {D(details['customer_overtime_fee']):.2f}"
                if D(details['management_fee']) != 0: log['管理费'] = f"基础劳务费({D(details['customer_base_fee']):.2f}) * 管理费率({D(details['management_fee_rate']):.0%}) = {D(details['management_fee']):.2f}"

                customer_parts = [
                    {'label': '基础劳务费', 'value': D(details['customer_base_fee'])},
                    {'label': '加班费', 'value': D(details['customer_overtime_fee'])},
                    {'label': '管理费', 'value': D(details['management_fee'])},
                    {'label': '增款', 'value': D(details['customer_increase'])},
                    # --- 核心修正：将保证金从普通减款中分离 ---
                    {'label': '退客户款', 'value': - (D(details['customer_decrease']) - D(details['security_deposit_return']))},
                    {'label': '优惠', 'value': -D(details.get('discount', 0))},
                    {'label': '末月抵扣保证金', 'value': -D(details['security_deposit_return'])},
                ]
                final_calc_str = build_formula_string(customer_parts)
                final_calc_str += f"\n= {D(details['total_payable']):.2f}"
                log['客应付款'] = final_calc_str

                # --- 员工应领款日志 (保持不变) ---
                if D(details['employee_base_payout']) != 0: log['萌嫂保证金(工资)'] = f"日薪({D(details['daily_rate']):.2f}) * 基本劳务天数({details['base_work_days']}) = {D(details['employee_base_payout']):.2f}"
                if D(details['employee_overtime_payout']) != 0: log['员工加班费'] = f"日薪({D(details['daily_rate']):.2f}) * 加班天数({details['overtime_days']}) = {D(details['employee_overtime_payout']):.2f}"
                if D(details['bonus_5_percent']) > 0: log['5%奖励'] = f"级别工资({D(details['level']):.2f}) * 5% = {D(details['bonus_5_percent']):.2f}"

                employee_parts = [
                    {'label': '保证金', 'value': D(details['employee_base_payout'])},
                    {'label': '加班费', 'value': D(details['employee_overtime_payout'])},
                    {'label': '奖励', 'value': D(details['bonus_5_percent'])},
                    {'label': '增款', 'value': D(details['employee_increase'])},
                    {'label': '减款', 'value': -D(details['employee_decrease'])},
                ]
                log['萌嫂应领款'] = f"{build_formula_string(employee_parts)} = {D(details['final_payout']):.2f}"

            elif details.get('type') == 'nanny':
                # (育儿嫂的日志逻辑保持不变)
                log_extras = details.get('log_extras', {})
                if D(details['customer_base_fee']) != 0: log['基础劳务费'] = f"员工日薪({D(details['employee_daily_rate']):.2f}) * 基本劳务天数({details['base_work_days']}) = {D(details['customer_base_fee']):.2f}"
                if D(details['customer_overtime_fee']) != 0: log['加班费'] = f"客户日薪({D(details['customer_daily_rate']):.2f}) * 加班天数({details['overtime_days']}) = {D(details['customer_overtime_fee']):.2f}"
                if D(details['management_fee']) != 0: log['本次交管理费'] = f"{log_extras.get('management_fee_reason', '根据合同类型计算')} = {D(details['management_fee']):.2f}"

                customer_parts = [
                    {'label': '基础劳务费', 'value': D(details['customer_base_fee'])},
                    {'label': '加班费', 'value': D(details['customer_overtime_fee'])},
                    {'label': '管理费', 'value': D(details['management_fee'])},
                    {'label': '增款', 'value': D(details['customer_increase'])},
                    {'label': '减款', 'value': -D(details['customer_decrease'])},
                    {'label': '优惠', 'value': -D(details.get('discount', 0))},
                ]
                final_calc_str = build_formula_string(customer_parts)
                if 'management_fee_refund_reason' in log_extras:
                    final_calc_str += f"\n(减款中包含: {log_extras['management_fee_refund_reason']} -{D(log_extras['refund_amount']):.2f})"
                final_calc_str += f"\n= {D(details['total_payable']):.2f}"
                log['客应付款'] = final_calc_str

                if D(details['employee_base_payout']) != 0: log['员工基础劳务费'] = f"员工日薪({D(details['employee_daily_rate']):.2f}) * 基本劳务天数({details['base_work_days']}) = {D(details['employee_base_payout']):.2f}"
                if D(details['employee_overtime_payout']) != 0: log['员工加班费'] = f"员工日薪({D(details['employee_daily_rate']):.2f}) * 加班天数({details['overtime_days']}) = {D(details['employee_overtime_payout']):.2f}"
                if D(details['first_month_deduction']) > 0: log['首月员工10%费用'] = f"{log_extras.get('first_month_deduction_reason', '首月服务费')} = -{D(details['first_month_deduction']):.2f}"

                employee_parts = [
                    {'label': '基础劳务费', 'value': D(details['employee_base_payout'])},
                    {'label': '加班费', 'value': D(details['employee_overtime_payout'])},
                    {'label': '增款', 'value': D(details['employee_increase'])},
                    {'label': '减款', 'value': -D(details['employee_decrease'])},
                    {'label': '首月费用', 'value': -D(details['first_month_deduction'])},
                ]
                log['萌嫂应领款'] = f"{build_formula_string(employee_parts)} = {D(details['final_payout']):.2f}"

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