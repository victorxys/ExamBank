#!/usr/bin/env python3
"""
诊断员工工资单调整项问题
"""

import sys
import os

# 添加项目根目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.app import app
from backend.models import db, BaseContract, CustomerBill, EmployeePayroll, FinancialAdjustment, AdjustmentType

def diagnose_salary_adjustment_issue():
    """诊断员工工资单调整项问题"""
    with app.app_context():
        print("🔍 诊断员工工资单调整项问题...")
        
        contract_id = "ec55950a-0f87-4b7b-b46c-9036d143befe"
        contract = BaseContract.query.get(contract_id)
        
        if not contract:
            print(f"  -> 找不到合同 {contract_id}")
            return
        
        print(f"  合同: {contract.id} | 客户: {contract.customer_name}")
        print(f"  合同状态: {contract.status}")
        print(f"  终止日期: {contract.termination_date}")
        
        # 查找最后一个月的账单和工资单
        last_bill = CustomerBill.query.filter_by(
            contract_id=contract.id,
            is_substitute_bill=False
        ).order_by(CustomerBill.cycle_end_date.desc()).first()
        
        if not last_bill:
            print("  -> 没有找到最后一个月的账单")
            return
        
        print(f"  最后账单: {last_bill.year}年{last_bill.month}月 (ID: {last_bill.id})")
        
        last_payroll = EmployeePayroll.query.filter_by(
            contract_id=contract.id,
            cycle_start_date=last_bill.cycle_start_date,
            is_substitute_payroll=False
        ).first()
        
        if not last_payroll:
            print("  -> 没有找到对应的工资单")
            return
        
        print(f"  工资单: {last_payroll.id}")
        print(f"  工资单总额: {last_payroll.total_due}")
        
        # 查找客户账单上的公司代付工资调整项
        company_adj = FinancialAdjustment.query.filter_by(
            customer_bill_id=last_bill.id,
            adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
            description="[系统] 公司代付工资"
        ).first()
        
        if company_adj:
            print(f"\n  📋 客户账单上的公司代付工资调整项:")
            print(f"    ID: {company_adj.id}")
            print(f"    金额: {company_adj.amount}")
            print(f"    镜像调整项ID: {company_adj.mirrored_adjustment_id}")
        else:
            print("\n  ❌ 客户账单上没有公司代付工资调整项")
        
        # 查找员工工资单上的保证金支付工资调整项
        employee_adj = FinancialAdjustment.query.filter_by(
            employee_payroll_id=last_payroll.id,
            adjustment_type=AdjustmentType.DEPOSIT_PAID_SALARY,
            description="[系统] 保证金支付工资"
        ).first()
        
        if employee_adj:
            print(f"\n  📋 员工工资单上的保证金支付工资调整项:")
            print(f"    ID: {employee_adj.id}")
            print(f"    金额: {employee_adj.amount}")
            print(f"    镜像调整项ID: {employee_adj.mirrored_adjustment_id}")
        else:
            print("\n  ❌ 员工工资单上没有保证金支付工资调整项")
        
        # 分析问题
        print(f"\n  🔍 问题分析:")
        if company_adj and employee_adj:
            if company_adj.amount == employee_adj.amount:
                print(f"    ✅ 两个调整项金额一致: {company_adj.amount}")
            else:
                print(f"    ❌ 金额不一致:")
                print(f"      客户账单: {company_adj.amount}")
                print(f"      员工工资单: {employee_adj.amount}")
                print(f"      差额: {company_adj.amount - employee_adj.amount}")
            
            # 检查关联关系
            if (company_adj.mirrored_adjustment_id == employee_adj.id and 
                employee_adj.mirrored_adjustment_id == company_adj.id):
                print(f"    ✅ 镜像关联关系正确")
            else:
                print(f"    ❌ 镜像关联关系错误")
                print(f"      客户调整项指向: {company_adj.mirrored_adjustment_id}")
                print(f"      员工调整项指向: {employee_adj.mirrored_adjustment_id}")
        elif company_adj and not employee_adj:
            print(f"    ❌ 只有客户账单调整项，缺少员工工资单调整项")
        elif not company_adj and employee_adj:
            print(f"    ❌ 只有员工工资单调整项，缺少客户账单调整项")
        else:
            print(f"    ❌ 两个调整项都不存在")
        
        # 检查是否应该有这些调整项
        print(f"\n  🔍 应该存在调整项吗?")
        if contract.status in ['terminated', 'finished']:
            print(f"    ✅ 合同已结束，应该有最终薪资调整项")
            
            # 检查是否是最后一个账单
            all_bills = CustomerBill.query.filter_by(
                contract_id=contract.id,
                is_substitute_bill=False
            ).order_by(CustomerBill.cycle_end_date.desc()).all()
            
            if all_bills and all_bills[0].id == last_bill.id:
                print(f"    ✅ 这是最后一个账单，应该有调整项")
            else:
                print(f"    ❌ 这不是最后一个账单")
        else:
            print(f"    ❌ 合同未结束，不应该有最终薪资调整项")
        
        print("\n✅ 诊断完成")

if __name__ == "__main__":
    diagnose_salary_adjustment_issue()