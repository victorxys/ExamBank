# backend/services/billing_engine.py (周期计算最终版)

from flask import current_app
from datetime import date, timedelta
import decimal

from backend.models import (
    db, BaseContract, MaternityNurseContract, AttendanceRecord, 
    CustomerBill, EmployeePayroll, FinancialAdjustment, AdjustmentType
)


D = decimal.Decimal
CTX = decimal.Context(prec=10)

# +++ 新增：一个用于表示默认考勤的简单类 +++
class DefaultAttendance:
    """一个临时的、用于生成预估账单的默认考勤对象。"""
    total_days_worked = 26
    statutory_holiday_days = 0
    # 未来如果计算需要更多字段，可在此处添加
# +++++++++++++++++++++++++++++++++++++++++


class BillingEngine:
    def calculate_for_month(self, year: int, month: int, contract_id=None, force_recalculate=False):
        active_contracts = BaseContract.query.filter_by(status='active').all()
        for contract in active_contracts:
            try:
                if contract.type == 'maternity_nurse':
                    self._calculate_maternity_nurse_bill_for_month(contract, year, month,force_recalculate)
            except Exception as e:
                current_app.logger.error(f"为合同 {contract.id} 计算账单时失败: {e}", exc_info=True)

    def _calculate_maternity_nurse_bill_for_month(self, contract: MaternityNurseContract, year: int, month: int, force_recalculate: bool):
        if not contract.actual_onboarding_date:
            return

        month_first_day = date(year, month, 1)
        next_month_first_day = (month_first_day.replace(day=28) + timedelta(days=4)).replace(day=1)
        month_last_day = next_month_first_day - timedelta(days=1)

        cycle_start_date = contract.actual_onboarding_date
        while cycle_start_date <= (contract.end_date or month_last_day):
            cycle_end_date = cycle_start_date + timedelta(days=25)

            if cycle_start_date <= month_last_day and cycle_end_date >= month_first_day:
                
                # --- 智能计算/跳过逻辑 (最终版) ---
                
                # **核心修正**: 判断基准变为是否存在财务调整项
                bill = CustomerBill.query.filter_by(contract_id=contract.id, year=year, month=month).first()
                payroll = EmployeePayroll.query.filter_by(contract_id=contract.id, year=year, month=month).first()

                has_manual_adjustments = False
                if bill:
                    # 检查是否存在任何与此账单关联的财务调整项
                    if FinancialAdjustment.query.filter_by(customer_bill_id=bill.id).first():
                        has_manual_adjustments = True
                if not has_manual_adjustments and payroll:
                     if FinancialAdjustment.query.filter_by(employee_payroll_id=payroll.id).first():
                        has_manual_adjustments = True

                # 如果不是强制重算，并且已经存在财务调整项，则跳过
                if not force_recalculate and has_manual_adjustments:
                    current_app.logger.info(f"合同 {contract.id} 已存在财务调整项，批量计算时跳过。")
                    break # 找到了本月的周期，处理完毕，跳出while循环

                # --- 继续执行计算 ---
                attendance = AttendanceRecord.query.filter_by(
                    contract_id=contract.id,
                    cycle_start_date=cycle_start_date
                ).first()
                
                # 从数据库查询调整项，并传递给计算函数
                customer_adjustments = FinancialAdjustment.query.filter_by(customer_bill_id=bill.id).all() if bill else []
                employee_adjustments = FinancialAdjustment.query.filter_by(employee_payroll_id=payroll.id).all() if payroll else []
                adjustments_for_engine = [
                    {"adjustment_type": adj.adjustment_type.name, "amount": adj.amount} 
                    for adj in customer_adjustments + employee_adjustments
                ]

                if not attendance:
                    self._process_one_billing_cycle(contract, DefaultAttendance(), year, month)
                else:
                    self._process_one_billing_cycle(contract, attendance, year, month)
                
                break # 处理完本月相关周期即可
            
            cycle_start_date = cycle_end_date + timedelta(days=1)


    

   # backend/services/billing_engine.py (基于最终公式的绝对正确版)

    def _process_one_billing_cycle(self, contract: MaternityNurseContract, attendance, year: int, month: int):
        try:
            current_app.logger.info(f"--- [ENGINE START] 合同 {contract.id} 周期计算开始 ---")
            
            # --- 1. 定义基础变量 ---
            level_salary = D(contract.employee_level or 0)
            management_rate = D(contract.management_fee_rate or 0)
            standard_days = D(26)
            overtime_days = D(getattr(attendance, 'overtime_days', 0))
            QUANTIZER = D('0.01') # 用于金额量化

            current_app.logger.info(f"[ENGINE-1] 输入参数: level_salary={level_salary}, rate={management_rate}, overtime_days={overtime_days}")

            # --- 2. 核心计算 (严格按照最终公式) ---
            
            # 出勤总天数
            total_days_worked = standard_days + overtime_days

            # 管理费 = 级别 * 管理费率 / 26 * min(出勤总天数, 26)
            daily_management_fee = CTX.divide(CTX.multiply(level_salary, management_rate), standard_days)
            management_fee_days = min(total_days_worked, standard_days)
            management_fee = CTX.multiply(daily_management_fee, management_fee_days).quantize(QUANTIZER)

            # 加班工资 = (级别 / 26) * max(0, 出勤总天数 - 26)
            daily_salary = CTX.divide(level_salary, standard_days)
            actual_overtime_days = max(D(0), total_days_worked - standard_days)
            overtime_payout = CTX.multiply(daily_salary, actual_overtime_days).quantize(QUANTIZER)
            
            # 员工基本劳务费 = 级别 * (1 - 管理费率)
            base_labor_payout_for_employee = CTX.multiply(level_salary, (D(1) - management_rate)).quantize(QUANTIZER)
            
            # 客户应付款 = 级别 + 加班工资
            customer_total_payable = level_salary + overtime_payout
            
            # 员工应领款 = 员工基本劳务费 + 加班工资
            employee_final_payout = base_labor_payout_for_employee + overtime_payout
            
            # --- 3. 处理财务调整项 ---
            bill = CustomerBill.query.filter_by(contract_id=contract.id, year=year, month=month).first()
            payroll = EmployeePayroll.query.filter_by(contract_id=contract.id, year=year, month=month).first()
            customer_adjustments = FinancialAdjustment.query.filter_by(customer_bill_id=bill.id).all() if bill else []
            employee_adjustments = FinancialAdjustment.query.filter_by(employee_payroll_id=payroll.id).all() if payroll else []
            
            discount_amount = sum(adj.amount for adj in customer_adjustments if adj.adjustment_type == AdjustmentType.CUSTOMER_DISCOUNT)
            customer_increase = sum(adj.amount for adj in customer_adjustments if adj.adjustment_type == AdjustmentType.CUSTOMER_INCREASE)
            customer_decrease = sum(adj.amount for adj in customer_adjustments if adj.adjustment_type == AdjustmentType.CUSTOMER_DECREASE)
            employee_increase = sum(adj.amount for adj in employee_adjustments if adj.adjustment_type == AdjustmentType.EMPLOYEE_INCREASE)
            employee_decrease = sum(adj.amount for adj in employee_adjustments if adj.adjustment_type == AdjustmentType.EMPLOYEE_DECREASE)
            
            # 将调整项计入最终总额
            customer_total_payable += (customer_increase - customer_decrease - discount_amount)
            employee_final_payout += (employee_increase - employee_decrease)

            current_app.logger.info(f"[ENGINE-2] 计算完成: customer_payable={customer_total_payable}, employee_payout={employee_final_payout}")

            # --- 4. 更新数据库 ---
            if not bill or not payroll:
                return

            bill.total_payable = customer_total_payable
            bill.calculation_details = {
                'level_salary': str(level_salary),
                'management_fee_rate': str(management_rate),
                'overtime_days': str(overtime_days),
                'total_days_worked': str(total_days_worked),
                'management_fee': str(management_fee),
                'overtime_payout': str(overtime_payout),
                'base_labor_payout_for_employee': str(base_labor_payout_for_employee),
                'customer_payable_before_adjust': str(level_salary + overtime_payout),
                'discount': str(discount_amount),
                'customer_increase': str(customer_increase),
                'customer_decrease': str(customer_decrease),
                'source': 'real_attendance' if hasattr(attendance, 'id') else 'default_26_days'
            }
            
            payroll.final_payout = employee_final_payout
            payroll.calculation_details = bill.calculation_details.copy()
            payroll.calculation_details['employee_increase'] = str(employee_increase)
            payroll.calculation_details['employee_decrease'] = str(employee_decrease)
            
        except Exception as e:
            current_app.logger.error(f"--- [ENGINE CRASH] 合同 {contract.id} 计算崩溃: {e} ---", exc_info=True)
            raise