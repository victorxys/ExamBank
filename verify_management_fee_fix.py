#!/usr/bin/env python3
"""
验证管理费退款修正的结果
"""

import sys
import os

# 添加项目根目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.app import app
from backend.models import db, BaseContract, CustomerBill, FinancialAdjustment, AdjustmentType

def verify_management_fee_fix():
    """验证管理费退款修正的结果"""
    with app.app_context():
        print("🔍 验证管理费退款修正结果...")
        
        contract_id = "ec55950a-0f87-4b7b-b46c-9036d143befe"
        contract = BaseContract.query.get(contract_id)
        
        if not contract:
            print(f"  -> 找不到合同 {contract_id}")
            return
        
        print(f"  合同: {contract.id} | 客户: {contract.customer_name}")
        print(f"  终止日期: {contract.termination_date}")
        print(f"  原始结束日期: {contract.end_date}")
        
        # 查找最后一个月的账单
        last_bill = CustomerBill.query.filter_by(
            contract_id=contract.id,
            is_substitute_bill=False
        ).order_by(CustomerBill.cycle_end_date.desc()).first()
        
        if not last_bill:
            print("  -> 没有找到最后一个月的账单")
            return
        
        print(f"  最后账单: {last_bill.year}年{last_bill.month}月")
        
        # 查找管理费退款调整项
        refund_adjustments = FinancialAdjustment.query.filter(
            FinancialAdjustment.customer_bill_id == last_bill.id,
            FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DECREASE,
            FinancialAdjustment.description.like('%管理费%退%')
        ).all()
        
        if not refund_adjustments:
            print("  -> 没有找到管理费退款调整项")
            return
        
        for adj in refund_adjustments:
            print(f"\n  📋 管理费退款调整项:")
            print(f"    金额: {adj.amount}")
            print(f"    描述: {adj.description}")
            print(f"    日期: {adj.date}")
            
            # 检查描述中是否包含正确的天数
            if "退款天数:" in adj.description:
                lines = adj.description.split('\n')
                for line in lines:
                    if "退款天数:" in line:
                        print(f"    ✅ 找到天数信息: {line.strip()}")
                        # 检查是否是16天而不是17天
                        if "16天" in line:
                            print("    ✅ 天数计算正确 (16天)")
                        elif "17天" in line:
                            print("    ❌ 天数计算仍然错误 (17天)")
                        else:
                            print(f"    ⚠️  天数信息: {line}")
        
        print("\n✅ 验证完成")

if __name__ == "__main__":
    verify_management_fee_fix()