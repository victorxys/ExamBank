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
        # **核心修正**: 这是兼容两种合同类型的最终总入口
        
        if contract_id:
            # 如果指定了单个合同，则只处理这一个
            contracts_to_process = [db.session.get(BaseContract, contract_id)]
        else:
            # 否则，处理所有 active 的合同
            contracts_to_process = BaseContract.query.filter_by(status='active').all()

        first_day_of_month = date(year, month, 1)
        next_month_first_day = (first_day_of_month.replace(day=28) + timedelta(days=4)).replace(day=1)
        last_day_of_month = next_month_first_day - timedelta(days=next_month_first_day.day)
            
        for contract in contracts_to_process:
            if not contract: continue
            
            try:
                # --- 月嫂合同的处理逻辑 ---
                if contract.type == 'maternity_nurse':
                    self._calculate_maternity_nurse_bill_for_month(contract, year, month, force_recalculate)
                
                # --- 育儿嫂合同的处理逻辑 ---
                elif contract.type == 'nanny':
                    # 判断合同生命周期是否与本月重叠
                    contract_starts_after_month = contract.start_date and contract.start_date > last_day_of_month
                    contract_ends_before_month = contract.end_date and contract.end_date < first_day_of_month
                    
                    if not contract_starts_after_month and not contract_ends_before_month:
                        
                        # 如果不需要强制重算，并且已存在账单，则跳过
                        existing_bill = CustomerBill.query.filter_by(contract_id=contract.id, year=year, month=month).first()
                        if existing_bill and not force_recalculate:
                            current_app.logger.info(f"育儿嫂合同 {contract.id} 在 {year}-{month} 已存在账单，跳过计算。")
                            continue

                        # 未来在这里调用育儿嫂的计算函数
                        # self._calculate_nanny_bill_for_month(contract, year, month)
                        current_app.logger.info(f"检测到育儿嫂合同 {contract.id} 在 {year}-{month} 需要计算，待实现计算逻辑。")
                db.session.commit()


            except Exception as e:
                current_app.logger.error(f"为合同 {contract.id} 计算账单时失败: {e}", exc_info=True)
        

    def _calculate_maternity_nurse_bill_for_month(self, contract: MaternityNurseContract, year: int, month: int, force_recalculate=False):
        # 这个内部函数现在只负责处理单个合同的周期查找和调用核心计算
        current_app.logger.info(f"  [ENGINE.CALC] 进入，目标月份: {year}-{month}")

        if not contract.actual_onboarding_date or not contract.expected_offboarding_date:
            return

        next_month_first_day = date(year, month, 1).replace(day=28) + timedelta(days=4)
        last_day_of_month = next_month_first_day - timedelta(days=next_month_first_day.day)

        cycle_start_date = contract.actual_onboarding_date
        
        processed_in_this_call = False

        # --- 循环处理所有周期，包括标准周期和最后的尾款周期 ---
        while cycle_start_date <= contract.expected_offboarding_date:
            # 确定当前周期的结束日
            # 这是一个标准的26天周期，还是最后的尾款周期？
            if (cycle_start_date + timedelta(days=25)) <= contract.expected_offboarding_date:
                cycle_end_date = cycle_start_date + timedelta(days=25)
            else:
                cycle_end_date = contract.expected_offboarding_date
            current_app.logger.info(f"  [ENGINE.CALC] 正在检查周期 {cycle_start_date} ~ {cycle_end_date}")
            # **判断**：只有当这个周期的结束日落在我们关心的月份时，才处理它
            if cycle_end_date.year == year and cycle_end_date.month == month:
                current_app.logger.info(f"  [ENGINE.CALC] 周期匹配！准备调用 process 函数。")
                self._process_one_billing_cycle(contract, cycle_start_date, cycle_end_date, year, month, force_recalculate)
                processed_in_this_call = True

            if cycle_start_date == cycle_end_date: # 防止尾款周期是同一天时死循环
                break
            
            
            cycle_start_date = cycle_end_date + timedelta(days=1)

    

   # backend/services/billing_engine.py (基于最终公式的绝对正确版)

    def _process_one_billing_cycle(self, contract: MaternityNurseContract, cycle_start_date, cycle_end_date, year: int, month: int, force_recalculate=False):
        try:
            current_app.logger.info(f"    [ENGINE.PROCESS] 开始处理周期 {cycle_start_date} (结算月: {year}-{month})")
            
            # --- 1. 定义基础变量 ---
            level_salary = D(contract.employee_level or 0)
            management_rate = D(contract.management_fee_rate or 0)
            standard_days = D(26)
            # overtime_days = D(getattr(attendance, 'overtime_days', 0))
            QUANTIZER = D('0.01') # 用于金额量化

            # 计算本周期的实际天数 （尤其是最后一个账单月）
            actual_days_in_cycle = (cycle_end_date - cycle_start_date).days + 1

            # 查询或创建考勤数据
            attendance = AttendanceRecord.query.filter_by(
                contract_id=contract.id, cycle_start_date=cycle_start_date
            ).first()

            if not attendance:
                # 如果没有真实考勤，则认为出勤天数等于周期天数，且无加班
                class TempAttendance:
                    overtime_days = 0
                    total_days_worked = actual_days_in_cycle # <-- 关键
                
                current_attendance = TempAttendance()
                is_default = True
            else:
                current_attendance = attendance
                is_default = False

            overtime_days = D(getattr(current_attendance, 'overtime_days', 0))


            current_app.logger.info(f"[ENGINE-1] 输入参数: level_salary={level_salary}, rate={management_rate}, overtime_days={overtime_days}")

            # --- 2. 核心计算 (严格按照最终公式) ---
            
            # 出勤总天数
            # total_days_worked = standard_days + overtime_days
            total_days_worked = D(actual_days_in_cycle) + overtime_days


            # 管理费 = 级别 * 管理费率 / 26 * min(出勤总天数, 26)
            daily_management_fee = CTX.divide(CTX.multiply(level_salary, management_rate), standard_days)
            management_fee_days = min(actual_days_in_cycle, standard_days)
            management_fee = CTX.multiply(daily_management_fee, management_fee_days).quantize(QUANTIZER)

            # 加班工资 = (级别 / 26) * max(0, 出勤总天数 - 26)
            daily_salary = CTX.divide(level_salary, standard_days)
            actual_overtime_days = max(D(0), total_days_worked - actual_days_in_cycle)
            overtime_payout = CTX.multiply(daily_salary, actual_overtime_days).quantize(QUANTIZER)
            
            # 员工基本劳务费 = 级别 * (1 - 管理费率)
            base_labor_payout_for_employee = CTX.multiply(level_salary, (D(1) - management_rate)).quantize(QUANTIZER)
            
            # 客户应付款 = 级别 + 加班工资
            customer_total_payable = level_salary + overtime_payout
            
            # 员工应领款 = 员工基本劳务费 + 加班工资
            employee_final_payout = base_labor_payout_for_employee + overtime_payout
            
            # --- 3. 处理财务调整项 ---
            bill = CustomerBill.query.filter_by(contract_id=contract.id, year=year, month=month, cycle_start_date=cycle_start_date).first()
            payroll = EmployeePayroll.query.filter_by(contract_id=contract.id, year=year, month=month, cycle_start_date=cycle_start_date).first()

            if bill and not force_recalculate:
                current_app.logger.info(f"    [ENGINE.PROCESS] 周期 {cycle_start_date} 的账单已存在且不强制重算，跳过。")
                return
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
            # --- 1. 获取或创建 bill 和 payroll 对象 ---
            if not bill:
                current_app.logger.warning(f"[ENGINE] 未找到 bill，正在创建新实例...")
                bill = CustomerBill(
                    contract_id=contract.id,
                    cycle_start_date=cycle_start_date,
                    cycle_end_date=cycle_end_date,
                    year=year,
                    month=month,
                    customer_name=contract.customer_name,
                    total_payable=0,
                    is_paid=False,
                    payment_details={},
                    calculation_details={}
                )
                db.session.add(bill)
            
            if not payroll:
                current_app.logger.warning(f"[ENGINE] 未找到 payroll，正在创建新实例...")
                employee_id = contract.user_id or contract.service_personnel_id
                payroll = EmployeePayroll(
                    contract_id=contract.id, cycle_start_date=cycle_start_date, cycle_end_date=cycle_end_date, year=year, month=month,
                    employee_id=employee_id,
                    final_payout=0, is_paid=False, payout_details={}, calculation_details={}
                )
                db.session.add(payroll)

            bill.total_payable = customer_total_payable
            bill.calculation_details = {
                'level_salary': str(level_salary),
                'management_fee_rate': str(management_rate),
                'overtime_days': str(overtime_days),
                'cycle_start_date': str(cycle_start_date),
                'cycle_end_date': str(cycle_end_date),
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