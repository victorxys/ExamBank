# backend/services/billing_engine.py (周期计算最终版)

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
                    cycle_start, cycle_end = self._get_nanny_cycle_for_month(contract, year, month)
                    if not cycle_start:
                        current_app.logger.info(f"    [NannyCALC] 合同 {contract.id} 在 {year}-{month} 无需创建账单，跳过。")
                        continue
                    
                    bill, payroll = self._get_or_create_bill_and_payroll(contract, year, month, cycle_start, cycle_end)
                    
                    if force_recalculate or not bill.calculation_details or 'calculation_log' not in bill.calculation_details:
                        current_app.logger.info(f"    [NannyCALC] 为合同 {contract.id} 执行计算 (force_recalculate={force_recalculate})")
                        self._calculate_nanny_bill(contract, bill)
                    else:
                        current_app.logger.info(f"    [NannyCALC] 合�� {contract.id} 的账单已存在且无需重算，跳过。")

                db.session.commit()
            except Exception as e:
                current_app.logger.error(f"为合同 {contract.id} 计算账单时失败: {e}", exc_info=True)
                db.session.rollback()

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

    def _calculate_nanny_bill(self, contract: NannyContract, bill: CustomerBill):
        current_app.logger.info(f"    [NannyCALC] 开始计算育儿嫂合同 {contract.id} for bill {bill.id} ({bill.year}-{bill.month})")
        
        level_salary = D(contract.employee_level or 0)
        management_fee_rate = D('0.10')
        work_day_divisor = D(26)
        management_fee_divisor = D(30)
        daily_salary = CTX.divide(level_salary, work_day_divisor) if work_day_divisor > 0 else D(0)
        QUANTIZER = D('0.01')

        billing_start_date = bill.cycle_start_date
        billing_end_date = bill.cycle_end_date

        payroll = EmployeePayroll.query.filter_by(contract_id=contract.id, cycle_start_date=billing_start_date).first()
        if not payroll:
            current_app.logger.error(f"    [NannyCALC] 未找到与账单 {bill.id} 匹配的薪酬单，计算中止。")
            return

        attendance = self._get_or_create_attendance(contract, billing_start_date, billing_end_date)
        total_days_worked = D(attendance.total_days_worked)
        overtime_days = D(attendance.overtime_days)
        
        cust_increase, cust_decrease, emp_increase, emp_decrease = self._get_adjustments(bill.id, payroll.id)

        customer_base_labor_fee = level_salary
        overtime_payout = CTX.multiply(daily_salary, overtime_days).quantize(QUANTIZER)

        management_fee_for_period = D(0)
        management_fee_refund_adjustment = D(0)
        total_months_for_fee = 0
        
        is_first_billing_period = (billing_start_date == contract.start_date)
        is_last_billing_period = (contract.end_date and billing_end_date == contract.end_date)

        if contract.is_monthly_auto_renew:
            management_fee_for_period = (level_salary * management_fee_rate).quantize(QUANTIZER)
        else:
            if is_first_billing_period and contract.management_fee_status != 'paid':
                delta = relativedelta(contract.end_date, contract.start_date)
                total_months_for_fee = delta.years * 12 + delta.months
                if delta.days > 0: total_months_for_fee += 1
                management_fee_for_period = (level_salary * management_fee_rate * total_months_for_fee).quantize(QUANTIZER)
            
            if is_last_billing_period:
                days_in_last_period = (billing_end_date - billing_start_date).days + 1
                if days_in_last_period < 30:
                    monthly_management_fee = (level_salary * management_fee_rate).quantize(QUANTIZER)
                    daily_management_fee = CTX.divide(monthly_management_fee, management_fee_divisor)
                    refund_days = 30 - days_in_last_period
                    management_fee_refund_adjustment = (daily_management_fee * refund_days).quantize(QUANTIZER)
                    cust_decrease += management_fee_refund_adjustment

        employee_base_payout = CTX.multiply(daily_salary, total_days_worked).quantize(QUANTIZER)
        
        first_month_deduction = D(0)
        if is_first_billing_period:
            service_fee_due = (level_salary * D('0.1')).quantize(QUANTIZER)
            first_month_deduction = min(service_fee_due, employee_base_payout)
        
        details = {
            'type': 'nanny',
            'is_monthly_auto_renew': contract.is_monthly_auto_renew,
            'is_first_billing_period': is_first_billing_period,
            'level_salary': str(level_salary),
            'daily_salary': str(daily_salary.quantize(QUANTIZER)),
            'billing_period': f"{billing_start_date.isoformat()} ~ {billing_end_date.isoformat()}",
            'total_days_worked': str(total_days_worked),
            'overtime_days': str(overtime_days),
            'customer_base_labor_fee': str(customer_base_labor_fee),
            'overtime_payout': str(overtime_payout),
            'total_management_fee_for_period': str(management_fee_for_period),
            'total_months_for_fee': total_months_for_fee,
            'management_fee_refund': str(management_fee_refund_adjustment),
            'customer_increase': str(cust_increase),
            'customer_decrease': str(cust_decrease),
            'employee_base_payout': str(employee_base_payout),
            'first_month_deduction': str(first_month_deduction),
            'employee_increase': str(emp_increase),
            'employee_decrease': str(emp_decrease),
        }

        bill, payroll = self._calculate_final_amounts(bill, payroll, details)
        log = self._create_calculation_log(details)
        self._update_bill_with_log(bill, payroll, details, log)
        
        current_app.logger.info(f"    [NannyCALC] 计算完成 for contract {contract.id}: {bill.calculation_details}")

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
        
        attendance = self._get_or_create_attendance(contract, cycle_start_date, cycle_end_date)
        
        adjustments = self._get_adjustments(bill.id, payroll.id)
        
        details = self._calculate_maternity_nurse_details(contract, attendance, adjustments)
        
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)
        
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
            
            default_work_days = 26

            attendance = AttendanceRecord(
                employee_id=employee_id, contract_id=contract.id,
                cycle_start_date=cycle_start_date, cycle_end_date=cycle_end_date,
                total_days_worked=default_work_days,
                overtime_days=0, statutory_holiday_days=0
            )
            db.session.add(attendance)
        return attendance
    
    def _get_adjustments(self, bill_id, payroll_id):
        customer_adjustments = FinancialAdjustment.query.filter_by(customer_bill_id=bill_id).all()
        employee_adjustments = FinancialAdjustment.query.filter_by(employee_payroll_id=payroll_id).all()
        
        cust_increase = sum(adj.amount for adj in customer_adjustments if adj.adjustment_type == AdjustmentType.CUSTOMER_INCREASE)
        cust_decrease = sum(adj.amount for adj in customer_adjustments if adj.adjustment_type == AdjustmentType.CUSTOMER_DECREASE)
        emp_increase = sum(adj.amount for adj in employee_adjustments if adj.adjustment_type == AdjustmentType.EMPLOYEE_INCREASE)
        emp_decrease = sum(adj.amount for adj in employee_adjustments if adj.adjustment_type == AdjustmentType.EMPLOYEE_DECREASE)
        
        return cust_increase, cust_decrease, emp_increase, emp_decrease
    
    def _calculate_final_amounts(self, bill, payroll, calculation_details):
        total_payable = D(0)
        final_payout = D(0)

        if calculation_details['type'] == 'maternity_nurse':
            total_payable = (
                D(calculation_details['labor_fee']) + 
                D(calculation_details['management_fee']) + 
                D(calculation_details['customer_increase']) - 
                D(calculation_details['customer_decrease']) - 
                D(calculation_details['discount'])
            )
            final_payout = (
                D(calculation_details['employee_base_payout']) + 
                D(calculation_details['overtime_payout']) + 
                D(calculation_details['bonus_5_percent']) + 
                D(calculation_details['employee_increase']) - 
                D(calculation_details['employee_decrease'])
            )
        elif calculation_details['type'] == 'nanny':
            total_payable = (
                D(calculation_details['customer_base_labor_fee']) +
                D(calculation_details['overtime_payout']) +
                D(calculation_details['total_management_fee_for_period']) +
                D(calculation_details['customer_increase']) -
                D(calculation_details['customer_decrease'])
            )
            final_payout = (
                D(calculation_details['employee_base_payout']) +
                D(calculation_details['overtime_payout']) +
                D(calculation_details['employee_increase']) -
                D(calculation_details['employee_decrease']) -
                D(calculation_details['first_month_deduction'])
            )

        bill.total_payable = total_payable.quantize(D('0.01'))
        payroll.final_payout = final_payout.quantize(D('0.01'))
        
        calculation_details['total_payable'] = str(bill.total_payable)
        calculation_details['final_payout'] = str(payroll.final_payout)
        
        return bill, payroll
    
    def _calculate_maternity_nurse_details(self, contract, attendance, adjustments):
        cust_increase, cust_decrease, emp_increase, emp_decrease = adjustments
        
        QUANTIZER = D('0.01')
        level_salary = D(contract.employee_level or 0)
        management_fee_rate = D(contract.management_fee_rate or 0)
        discount = D(contract.discount_amount or 0)
        
        labor_days = D(attendance.total_days_worked)
        daily_level_salary = CTX.divide(level_salary, D(26))
        labor_fee = CTX.multiply(daily_level_salary, labor_days).quantize(QUANTIZER)
        
        management_fee = CTX.multiply(labor_fee, management_fee_rate).quantize(QUANTIZER)
        
        employee_daily_salary = CTX.divide(CTX.multiply(level_salary, (D(1) - management_fee_rate)), D(26))
        
        base_work_days = labor_days - D(attendance.statutory_holiday_days)
        employee_base_payout = CTX.multiply(employee_daily_salary, base_work_days).quantize(QUANTIZER)
        
        total_overtime_days = D(attendance.overtime_days) + (D(attendance.statutory_holiday_days) * D(2))
        overtime_payout = CTX.multiply(employee_daily_salary, total_overtime_days).quantize(QUANTIZER)
        
        bonus = D(0)
        if management_fee_rate == D('0.15'):
            bonus = (level_salary * D('0.05')).quantize(QUANTIZER)
            
        return {
            'type': 'maternity_nurse',
            'billing_period': f"{attendance.cycle_start_date.isoformat()} ~ {attendance.cycle_end_date.isoformat()}",
            'level_salary': str(level_salary),
            'labor_days': str(labor_days),
            'labor_fee': str(labor_fee),
            'management_fee_rate': str(management_fee_rate),
            'management_fee': str(management_fee),
            'discount': str(discount),
            'customer_increase': str(cust_increase),
            'customer_decrease': str(cust_decrease),
            'employee_daily_salary': str(employee_daily_salary.quantize(QUANTIZER)),
            'employee_base_payout': str(employee_base_payout),
            'overtime_days_calc': f"{attendance.overtime_days} (非节假日) + {attendance.statutory_holiday_days} (节假日) * 2 = {total_overtime_days} (折算天数)",
            'overtime_payout': str(overtime_payout),
            'bonus_5_percent': str(bonus),
            'employee_increase': str(emp_increase),
            'employee_decrease': str(emp_decrease),
        }
    
    def _create_calculation_log(self, details):
        log = {}
        try:
            if details.get('type') == 'maternity_nurse':
                log['labor_fee'] = f"日薪({D(details['level_salary'])/26:.2f}) * 劳务天数({details['labor_days']}) = {D(details['labor_fee']):.2f}"
                log['management_fee'] = f"劳务费({D(details['labor_fee']):.2f}) * 管理费率({D(details['management_fee_rate']):.2%}) = {D(details['management_fee']):.2f}"
                log['total_payable'] = f"劳务费 + 管理费 + 增款 - 减款 - 优惠\n= {D(details['labor_fee']):.2f} + {D(details['management_fee']):.2f} + {D(details['customer_increase']):.2f} - {D(details['customer_decrease']):.2f} - {D(details['discount']):.2f}\n= {D(details['total_payable']):.2f}"
                log['employee_daily_salary'] = f"级别工��� * (1 - 管理费率) / 26天\n= {D(details['level_salary']):.2f} * (1 - {D(details['management_fee_rate']):.0%}) / 26\n= {D(details['employee_daily_salary']):.2f}"
                log['employee_base_payout'] = f"员工日薪({D(details['employee_daily_salary']):.2f}) * (工作天数 - 节假日天数) = {D(details['employee_base_payout']):.2f}"
                log['overtime_payout'] = f"员工日薪({D(details['employee_daily_salary']):.2f}) * 折算加班天数({details['overtime_days_calc']}) = {D(details['overtime_payout']):.2f}"
                log['bonus_5_percent'] = f"级别工资({D(details['level_salary']):.2f}) * 5% = {D(details['bonus_5_percent']):.2f}"
                log['final_payout'] = f"基础工资 + 加班费 + 奖励 + 增款 - 减款\n= {D(details['employee_base_payout']):.2f} + {D(details['overtime_payout']):.2f} + {D(details['bonus_5_percent']):.2f} + {D(details['employee_increase']):.2f} - {D(details['employee_decrease']):.2f}\n= {D(details['final_payout']):.2f}"

            elif details.get('type') == 'nanny':
                log['customer_base_labor_fee'] = f"合同约定月薪 = {D(details['customer_base_labor_fee']):.2f}"
                log['overtime_payout'] = f"日薪({D(details['daily_salary']):.2f}) * 加班天数({details['overtime_days']}) = {D(details['overtime_payout']):.2f}"
                if details.get('is_monthly_auto_renew'):
                    log['total_management_fee_for_period'] = f"月薪({D(details['level_salary']):.2f}) * 10% = {D(details['total_management_fee_for_period']):.2f}"
                else:
                    if D(details['total_management_fee_for_period']) > 0:
                         log['total_management_fee_for_period'] = f"首月收取全年管理费: 月薪 * 10% * 总月数({details['total_months_for_fee']}) = {D(details['total_management_fee_for_period']):.2f}"
                    else:
                         log['total_management_fee_for_period'] = "非首月，无需缴纳"
                
                log['total_payable'] = f"基本劳务费 + 加班费 + 管理费 + 增款 - 减款\n= {D(details['customer_base_labor_fee']):.2f} + {D(details['overtime_payout']):.2f} + {D(details['total_management_fee_for_period']):.2f} + {D(details['customer_increase']):.2f} - {D(details['customer_decrease']):.2f}\n= {D(details['total_payable']):.2f}"
                log['employee_base_payout'] = f"日薪({D(details['daily_salary']):.2f}) * 出勤天数({details['total_days_worked']}) = {D(details['employee_base_payout']):.2f}"
                log['first_month_deduction'] = f"首月服务费(员工交公司10%) = {D(details['first_month_deduction']):.2f}"
                log['final_payout'] = f"基础工资 + 加班费 + 增款 - 减款 - 首月服务费\n= {D(details['employee_base_payout']):.2f} + {D(details['overtime_payout']):.2f} + {D(details['employee_increase']):.2f} - {D(details['employee_decrease']):.2f} - {D(details['first_month_deduction']):.2f}\n= {D(details['final_payout']):.2f}"

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