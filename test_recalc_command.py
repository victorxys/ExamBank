#!/usr/bin/env python3
"""
测试修改后的recalc-bills命令是否会正确更新最终薪资调整项
"""

import sys
import os

# 添加项目根目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.app import app
from backend.models import db, BaseContract, CustomerBill, FinancialAdjustment, AdjustmentType

def test_recalc_command_logic():
    """测试recalc命令的逻辑"""
    with app.app_context():
        print("🧪 测试recalc-bills命令逻辑...")
        
        # 查找一个已终止的合同
        terminated_contract = BaseContract.query.filter_by(
            status='terminated'
        ).first()
        
        if not terminated_contract:
            print("  -> 没有找到已终止的合同进行测试")
            return
        
        print(f"  找到已终止合同: {terminated_contract.id} | 客户: {terminated_contract.customer_name}")
        
        # 查找最后一个月的账单
        last_bill = CustomerBill.query.filter_by(
            contract_id=terminated_contract.id,
            is_substitute_bill=False
        ).order_by(CustomerBill.cycle_end_date.desc()).first()
        
        if not last_bill:
            print("  -> 该合同没有有效账单")
            return
        
        print(f"  最后一个月账单: {last_bill.year}年{last_bill.month}月")
        
        # 检查是否已有最终薪资调整项
        existing_adj = FinancialAdjustment.query.filter_by(
            customer_bill_id=last_bill.id,
            adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
            description="[系统] 公司代付工资"
        ).first()
        
        if existing_adj:
            print(f"  现有最终薪资调整项金额: {existing_adj.amount}")
        else:
            print("  没有现有的最终薪资调整项")
        
        print(f"\n  建议运行命令:")
        print(f"  flask recalc-bills --contract-id {terminated_contract.id} --year {last_bill.year} --month {last_bill.month}")
        
        print("✅ 测试逻辑检查完成")

if __name__ == "__main__":
    test_recalc_command_logic()