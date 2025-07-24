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
                db.session.commit()
            except Exception as e:
                current_app.logger.error(f"为合同 {contract.id} 计算账单时失败: {e}", exc_info=True)
                db.session.rollback()

    def process_substitution(self, record_id):
        """处理单个替班记录，包括扣减原账单和生成新账单。"""
        sub_record = db.session.get(SubstituteRecord, record_id)
        if not sub_record:
            current_app.logger.error(f"[SubProcessing] 替班记录 {record_id} 未找到。")
            return

        main_contract = sub_record.main_contract
        if not main_contract:
            current_app.logger.error(f"[SubProcessing] 替班记录 {record_id} 关联的主合同未找到。")
            return

        # 1. 确定所有受影响的月份
        affected_months = set()
        current_date = sub_record.start_date
        while current_date <= sub_record.end_date:
            affected_months.add((current_date.year, current_date.month))
            current_date = (current_date.replace(day=1) + timedelta(days=32)).replace(day=1)

        # 2. 为每个受影响的月份，找到或创建原始账单，并建立关联
        for year, month in affected_months:
            # 找到这个月对应的原始账单周期
            if main_contract.type == 'nanny':
                cycle_start, cycle_end = self._get_nanny_cycle_for_month(main_contract, year, month)
            elif main_contract.type == 'maternity_nurse':
                # 对于月嫂，需要一个更复杂的方法来确定哪个周期与替班日期重叠
                # 这里简化处理，假设替班总是在一个账单月内，并获取该月的第一个周期
                # 注意：这是一个简化，复杂跨周期替班可能需要更精细的逻辑
                cycle_start, cycle_end = self._get_first_maternity_nurse_cycle_in_month(main_contract, year, month)
            else:
                continue # 不支持其他合同类型的替班

            if not cycle_start:
                continue

            # 获取或创建原始账单
            original_bill, _ = self._get_or_create_bill_and_payroll(main_contract, year, month, cycle_start, cycle_end)
            db.session.flush() # 确保 original_bill.id 可用

            # 建立关键链接！
            sub_record.original_customer_bill_id = original_bill.id
            current_app.logger.info(f"[SubProcessing] 已将替班记录 {sub_record.id} 关联到原始账单 {original_bill.id}")

            # 3. 强制重算原始账单，现在它能正确找到替班记录并进行扣减
            self.calculate_for_month(year, month, main_contract.id, force_recalculate=True)

        # 4. 为替班记录生成新的独立账单
        self.calculate_for_substitute(record_id)

        db.session.commit()

    

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

        base_work_days = D((cycle_end - cycle_start).days + 1)
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
        cust_increase, cust_decrease, emp_increase, emp_decrease = self._get_adjustments(bill.id, payroll.id)
        cust_discount = D(db.session.query(func.sum(FinancialAdjustment.amount)).filter(
            FinancialAdjustment.customer_bill_id == bill.id,
            FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DISCOUNT
        ).scalar() or 0)

        total_substitute_days = 0
        for record in bill.substitute_records_affecting_bill:
            overlap_start = max(cycle_start, record.start_date)
            overlap_end = min(cycle_end, record.end_date)
            if overlap_start <= overlap_end:
                total_substitute_days += (overlap_end - overlap_start).days + 1

        cycle_actual_days = (cycle_end - cycle_start).days + 1
        base_work_days = D(min(cycle_actual_days, 26))
        total_days_worked = base_work_days + overtime_days - D(total_substitute_days)

        customer_daily_rate_full_precision = (level / D(26))
        employee_daily_rate_full_precision = ((level * D('0.9')) / D(26))

        # 核心修改：计算替班扣款
        substitute_deduction = (employee_daily_rate_full_precision * D(total_substitute_days)).quantize(QUANTIZER)

        customer_base_fee = (employee_daily_rate_full_precision * base_work_days).quantize(QUANTIZER)
        customer_overtime_fee = (customer_daily_rate_full_precision * overtime_days).quantize(QUANTIZER)

        management_fee = D(0)
        is_first_bill = (cycle_start == contract.start_date)
        is_last_bill = (contract.end_date and cycle_end == contract.end_date)
        log_extras = {}

        if contract.is_monthly_auto_renew:
            management_fee = (level * D('0.1')).quantize(QUANTIZER)
            log_extras['management_fee_reason'] = "月签合同，按月收取"
        else:
            if is_first_bill:
                delta = relativedelta(contract.end_date, contract.start_date)
                total_months = delta.years * 12 + delta.months
                if delta.days > 0 or (total_months == 0 and cycle_actual_days > 0):
                    total_months += 1
                management_fee = (level * D('0.1') * total_months).quantize(QUANTIZER)
                log_extras['management_fee_reason'] = f"非月签合同首月，一次性收取: {level} * 10% * {total_months} 个月管理费"
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
            'substitute_days': str(total_substitute_days),
            'substitute_deduction': str(substitute_deduction), # 新增字段
            'customer_base_fee': str(customer_base_fee), 'customer_overtime_fee': str(customer_overtime_fee),
            'management_fee': str(management_fee), 'customer_increase': str(cust_increase), 'customer_decrease': str(cust_decrease),
            'discount': str(cust_discount),
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
    
            if cycle_end.year == year and cycle_end.month == month:
                current_app.logger.info(f"    [MN CALC] 找到一个归属于 {year}-{month} 的结算周期: {cycle_start} to {cycle_end}")
                self._process_one_billing_cycle(contract, cycle_start, cycle_end, year, month, force_recalculate)
    
            if cycle_end >= contract_end:
                break
    
            cycle_start = cycle_end

    def _process_one_billing_cycle(self, contract: MaternityNurseContract, cycle_start_date, cycle_end_date, year: int, month: int, force_recalculate=False):
        current_app.logger.info(f"      [CYCLE PROC] 开始处理周期 {cycle_start_date} to {cycle_end_date} for settlement month {year}-{month}")

        existing_bill = CustomerBill.query.filter_by(contract_id=contract.id, cycle_start_date=cycle_start_date).first()

        if existing_bill and not force_recalculate:
            current_app.logger.info(f"      [CYCLE PROC] 周期 {cycle_start_date} 的账单已存在且无需强制重算，跳过。")
            return

        bill, payroll = self._get_or_create_bill_and_payroll(contract, year, month, cycle_start_date, cycle_end_date)
        details = self._calculate_maternity_nurse_details(contract, bill, payroll)
        bill, payroll = self._calculate_final_amounts(bill, payroll, details)
        log = self._create_calculation_log(details)
        self._update_bill_with_log(bill, payroll, details, log)

        current_app.logger.info(f"      [CYCLE PROC] 周期 {cycle_start_date} 计算完成。")

    def _calculate_maternity_nurse_details(self, contract: MaternityNurseContract, bill: CustomerBill, payroll: EmployeePayroll):
        """计算月嫂合同的所有财务细节。"""
        QUANTIZER = D('0.01')
        level = D(contract.employee_level or 0)
        management_fee_rate = D(contract.management_fee_rate or 0)
        discount = D(contract.discount_amount or 0)
        security_deposit = D(contract.security_deposit_paid or 0)
    
        cycle_start = bill.cycle_start_date
        cycle_end = bill.cycle_end_date
    
        attendance = self._get_or_create_attendance(contract, cycle_start, cycle_end)
        overtime_days = D(attendance.overtime_days)
        cust_increase, cust_decrease, emp_increase, emp_decrease = self._get_adjustments(bill.id, payroll.id)
    
        total_substitute_days = 0
        for record in bill.substitute_records_affecting_bill:
            overlap_start = max(cycle_start, record.start_date)
            overlap_end = min(cycle_end, record.end_date)
            if overlap_start <= overlap_end:
                total_substitute_days += (overlap_end - overlap_start).days + 1

        daily_rate_full_precision = (level / D(26))
        actual_cycle_days = (cycle_end - cycle_start).days + 1
        base_work_days = D(min(actual_cycle_days, 26))
        total_days_worked = base_work_days + overtime_days - D(total_substitute_days)

        # 核心修改：计算替班扣款
        substitute_deduction = (daily_rate_full_precision * D(total_substitute_days)).quantize(QUANTIZER)
    
        customer_base_fee = (daily_rate_full_precision * base_work_days).quantize(QUANTIZER)
        customer_overtime_fee = (daily_rate_full_precision * overtime_days).quantize(QUANTIZER)
        management_fee = (customer_base_fee * management_fee_rate).quantize(QUANTIZER)
    
        is_last_bill = (contract.expected_offboarding_date and cycle_end == contract.expected_offboarding_date)
        if is_last_bill:
            cust_decrease += security_deposit
    
        employee_base_payout = (daily_rate_full_precision * base_work_days).quantize(QUANTIZER)
        employee_overtime_payout = (daily_rate_full_precision * overtime_days).quantize(QUANTIZER)
    
        bonus_5_percent = D(0)
        if management_fee_rate == D('0.15'):
            bonus_5_percent = (level * D('0.05')).quantize(QUANTIZER)
    
        return {
            'type': 'maternity_nurse', 'level': str(level), 'cycle_period': f"{cycle_start.isoformat()} to {cycle_end.isoformat()}",
            'base_work_days': str(base_work_days), 'overtime_days': str(overtime_days), 'total_days_worked': str(total_days_worked),
            'substitute_days': str(total_substitute_days),
            'substitute_deduction': str(substitute_deduction), # 新增字段
            'daily_rate': str(daily_rate_full_precision.quantize(QUANTIZER)),
            'management_fee_rate': str(management_fee_rate),
            'customer_base_fee': str(customer_base_fee), 'customer_overtime_fee': str(customer_overtime_fee),
            'management_fee': str(management_fee), 'discount': str(discount),
            'security_deposit_return': str(security_deposit) if is_last_bill else '0.00',
            'customer_increase': str(cust_increase), 'customer_decrease': str(cust_decrease),
            'employee_base_payout': str(employee_base_payout), 'employee_overtime_payout': str(employee_overtime_payout),
            'bonus_5_percent': str(bonus_5_percent), 'employee_increase': str(emp_increase), 'employee_decrease': str(emp_decrease),
        }

    def calculate_for_substitute(self, substitute_record_id):
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
        
        db.session.commit()
        current_app.logger.info(f"[SubCALC] 替班记录 {sub_record.id} 的账单已成功生成。")

    def _calculate_substitute_details(self, sub_record, main_contract):
        """计算替班记录的财务细节。"""
        QUANTIZER = D('0.01')
        substitute_days = D((sub_record.end_date - sub_record.start_date).days + 1)
        substitute_salary = D(sub_record.substitute_salary)
        overtime_days = D(sub_record.overtime_days or 0)

        sub_daily_rate = (substitute_salary / D(26)).quantize(QUANTIZER)
        
        # 根据文档，加班费的客户价和员工价是一样的
        overtime_fee = (sub_daily_rate * overtime_days).quantize(QUANTIZER)

        details = {
            'type': 'substitute',
            'main_contract_id': str(main_contract.id),
            'main_contract_type': main_contract.type,
            'substitute_record_id': str(sub_record.id),
            'substitute_user_id': str(sub_record.substitute_user_id or sub_record.substitute_personnel_id),
            'cycle_period': f"{sub_record.start_date.isoformat()} to {sub_record.end_date.isoformat()}",
            'base_work_days': str(substitute_days),
            'overtime_days': str(overtime_days),
            'total_days_worked': str(substitute_days + overtime_days),
            'customer_overtime_fee': str(overtime_fee),
            'employee_overtime_payout': str(overtime_fee),
            'customer_increase': '0.00', 'customer_decrease': '0.00',
            'employee_increase': '0.00', 'employee_decrease': '0.00',
            'discount': '0.00', 'first_month_deduction': '0.00',
            'log_extras': {}
        }

        if main_contract.type == 'maternity_nurse':
            management_fee_rate = D(sub_record.substitute_management_fee)
            
            customer_base_fee = (sub_daily_rate * substitute_days).quantize(QUANTIZER)
            management_fee = (customer_base_fee * management_fee_rate).quantize(QUANTIZER)
            employee_base_payout = (customer_base_fee * (D(1) - management_fee_rate)).quantize(QUANTIZER)
            
            details.update({
                'level': str(substitute_salary), 'daily_rate': str(sub_daily_rate),
                'management_fee_rate': str(management_fee_rate),
                'customer_base_fee': str(customer_base_fee),
                'management_fee': str(management_fee),
                'employee_base_payout': str(employee_base_payout)
            })
        elif main_contract.type == 'nanny':
            original_level = D(main_contract.employee_level or 0)
            
            management_fee = (original_level * D('0.1') / 26 * substitute_days).quantize(QUANTIZER)
            employee_base_payout = (sub_daily_rate * substitute_days).quantize(QUANTIZER)
            customer_base_fee = management_fee + employee_base_payout

            details.update({
                'level': str(substitute_salary), 'original_level': str(original_level),
                'daily_rate': str(sub_daily_rate),
                'customer_base_fee': str(customer_base_fee),
                'management_fee': str(management_fee),
                'employee_base_payout': str(employee_base_payout)
            })
        return details

    # --- UTILITY AND HELPER FUNCTIONS ---

    def _get_or_create_bill_and_payroll(self, contract, year, month, cycle_start_date, cycle_end_date):
        # 核心修复：查询主账单时，必须严格排除替班账单，避免数据覆盖
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

        if not bill:
            bill = CustomerBill(
                contract_id=contract.id, year=year, month=month,
                cycle_start_date=cycle_start_date, cycle_end_date=cycle_end_date,
                customer_name=contract.customer_name, total_payable=D(0),
                is_substitute_bill=False # 关键修复：创建时必须明确设置为 False
            )
            db.session.add(bill)
        else:
            # 确保即使找到现有账单，也更新其月份和周期结束日，以防周期调整
            bill.year, bill.month, bill.cycle_end_date = year, month, cycle_end_date

        if not payroll:
            employee_id = contract.user_id or contract.service_personnel_id
            if not employee_id: raise ValueError(f"Contract {contract.id} has no associated employee.")
            payroll = EmployeePayroll(
                contract_id=contract.id, year=year, month=month,
                cycle_start_date=cycle_start_date, cycle_end_date=cycle_end_date,
                employee_id=employee_id, final_payout=D(0),
                is_substitute_payroll=False # 关键修复：创建时必须明确设置为 False
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
            
            default_work_days = 0
            if contract.type == 'maternity_nurse':
                default_work_days = 26
            elif contract.type == 'nanny':
                default_work_days = min((cycle_end_date - cycle_start_date).days + 1, 26)

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
            D(details.get('bonus_5_percent', 0)) + 
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

        log['基础劳务费'] = f"日薪({d.get('daily_rate', 0):.2f}) * 基本劳务天数({d.get('base_work_days', 0)}) = {d.get('customer_base_fee', 0):.2f}"
        
        

        if d.get('customer_overtime_fee', 0) > 0:
            log['加班费'] = f"日薪({d.get('daily_rate', 0):.2f}) * 加班天数({d.get('overtime_days', 0)}) = {d.get('customer_overtime_fee', 0):.2f}"

        if details.get('type') == 'maternity_nurse':
            log['管理费'] = f"基础劳务费({d.get('customer_base_fee', 0):.2f}) * 管理费率({d.get('management_fee_rate', 0) * 100}%) = {d.get('management_fee', 0):.2f}"
            log['萌嫂保证金(工资)'] = f"日薪({d.get('daily_rate', 0):.2f}) * 基本劳务天数({d.get('base_work_days', 0)}) = {d.get('employee_base_payout', 0):.2f}"
            if d.get('bonus_5_percent', 0) > 0:
                log['5%奖励'] = f"级别({d.get('level', 0):.2f}) * 5% = {d.get('bonus_5_percent', 0):.2f}"
        
        if details.get('type') == 'nanny':
            log['本次交管理费'] = details.get('log_extras', {}).get('management_fee_reason', f"级别({d.get('level', 0):.2f}) * 10% = {d.get('management_fee', 0):.2f}")
            if 'refund_amount' in details.get('log_extras', {}):
                log['本次交管理费'] += f" | 末月退还: {details['log_extras']['refund_amount']}"
            log['基础劳务费'] = f"员工日薪({d.get('employee_daily_rate', 0):.2f}) * 基本劳务天数({d.get('base_work_days', 0)}) = {d.get('employee_base_payout', 0):.2f}"
            if d.get('first_month_deduction', 0) > 0:
                log['首月员工10%费用'] = details.get('log_extras', {}).get('first_month_deduction_reason', '计算员工首月服务费')

        if details.get('type') == 'substitute':
            main_contract_type = details.get('main_contract_type')
            # 客户侧的基础劳务费
            log['客户基础劳务费'] = f"替班日薪({d.get('daily_rate', 0):.2f}) * 替班天数({d.get('base_work_days', 0)}) = {d.get('customer_base_fee', 0):.2f}"
            # 员工侧的基础劳务费
            log['基础劳务费'] = f"替班日薪({d.get('daily_rate', 0):.2f}) * 替班天数({d.get('base_work_days', 0)}) = {d.get('employee_base_payout', 0):.2f}"

            if main_contract_type == 'nanny':
                 log['管理费'] = f"原合同日管理费({(d.get('original_level',0) * D('0.1')/26):.2f}) * 替班天数({d.get('base_work_days',0)}) = {d.get('management_fee',0):.2f}"
            else:
                 log['管理费'] = f"替班基础劳务费({d.get('customer_base_fee',0):.2f}) * 管理费率({d.get('management_fee_rate',0)*100}%) = {d.get('management_fee',0):.2f}"

        if d.get('substitute_deduction', 0) > 0:
            log['被替班扣款'] = f"日薪({d.get('daily_rate', 0):.2f}) * 被替班天数({d.get('substitute_days', 0)}) = {d.get('substitute_deduction', 0):.2f}"

        log['客应付款'] = f"基础劳务费({d.get('customer_base_fee', 0):.2f}) + 加班费({d.get('customer_overtime_fee', 0):.2f}) + 管理费({d.get('management_fee', 0):.2f}) - 优惠({d.get('discount', 0):.2f}) - 被替班扣款({d.get('substitute_deduction', 0):.2f}) + 增款({d.get('customer_increase', 0):.2f}) - 减款({d.get('customer_decrease', 0):.2f}) = {d.get('total_payable', 0):.2f}"
        log['萌嫂应领款'] = f"基础工资({d.get('employee_base_payout', 0):.2f}) + 加班工资({d.get('employee_overtime_payout', 0):.2f}) + 奖励/增款({d.get('bonus_5_percent', 0) + d.get('employee_increase', 0):.2f}) - 服务费/减款({d.get('first_month_deduction', 0) + d.get('employee_decrease', 0):.2f}) - 被替班扣款({d.get('substitute_deduction', 0):.2f}) = {d.get('final_payout', 0):.2f}"

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
''