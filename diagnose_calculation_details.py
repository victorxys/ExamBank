#!/usr/bin/env python3
"""
诊断 calculation_details 中的基础劳务费
"""

import sys
import os
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.app import app
from backend.models import db, BaseContract, CustomerBill, EmployeePayroll

def diagnose_calculation_details():
    """诊断 calculation_details 中的基础劳务费"""
    with app.app_context():
        print("🔍 诊断 calculation_details 中的基础劳务费...")
        
        contract_id = "ec55950a-0f87-4b7b-b46c-9036d143befe"
        contract = BaseContract.query.get(contract_id)
        
        if not contract:
            print(f"  -> 找不到合同 {contract_id}")
            return
        
        print(f"  合同: {contract.id} | 客户: {contract.customer_name}")
        print(f"  员工级别(月薪): {contract.employee_level}")
        
        # 查找最后一个月的账单和工资单
        last_bill = CustomerBill.query.filter_by(
            contract_id=contract.id,
            is_substitute_bill=False
        ).order_by(CustomerBill.cycle_end_date.desc()).first()
        
        if not last_bill:
            print("  -> 没有找到最后一个月的账单")
            return
        
        print(f"\n  📋 账单 calculation_details:")
        calc_details = last_bill.calculation_details or {}
        for key, value in calc_details.items():
            print(f"    {key}: {value}")
        
        last_payroll = EmployeePayroll.query.filter_by(
            contract_id=contract.id,
            cycle_start_date=last_bill.cycle_start_date,
            is_substitute_payroll=False
        ).first()
        
        if not last_payroll:
            print("  -> 没有找到对应的工资单")
            return
        
        print(f"\n  📋 工资单 calculation_details:")
        payroll_calc_details = last_payroll.calculation_details or {}
        for key, value in payroll_calc_details.items():
            print(f"    {key}: {value}")
        
        # 计算应该使用的金额
        employee_base_payout = Decimal(str(payroll_calc_details.get('employee_base_payout', 0)))
        employee_overtime_fee = Decimal(str(payroll_calc_details.get('employee_overtime_fee', 0)))
        actual_labor_fee = employee_base_payout + employee_overtime_fee
        employee_level = Decimal(contract.employee_level or '0')
        
        print(f"\n  🔍 计算分析:")
        print(f"    基础劳务费 (employee_base_payout): {employee_base_payout}")
        print(f"    加班费 (employee_overtime_fee): {employee_overtime_fee}")
        print(f"    实际劳务费 (基础+加班): {actual_labor_fee}")
        print(f"    员工月薪 (employee_level): {employee_level}")
        print(f"    应该使用的代付金额: min({actual_labor_fee}, {employee_level}) = {min(actual_labor_fee, employee_level)}")
        print(f"    工资单总额 (total_due): {last_payroll.total_due}")
        
        print("\n✅ 诊断完成")

if __name__ == "__main__":
    diagnose_calculation_details()
