#!/usr/bin/env python3
"""
测试账单详情API是否能正确显示家庭ID合并情况下的考勤记录
"""
import sys
import os
sys.path.append('.')

from backend.api.utils import get_billing_details_internal
from backend.models import db, BaseContract, CustomerBill
from backend.app import app

def test_billing_details():
    with app.app_context():
        print("🧪 测试账单详情API中的考勤记录显示...")
        
        # 获取测试合同和账单（有家庭ID的合同）
        contract_id = "6f7f20e6-642d-484d-a5d1-aaf836d3cb0d"
        
        # 验证这是有家庭ID的合同
        contract = BaseContract.query.get(contract_id)
        if contract:
            print(f"📋 合同信息: {contract.customer_name} (family_id: {contract.family_id})")
        else:
            print("❌ 找不到合同")
            return
        
        # 查找账单
        bill = CustomerBill.query.filter_by(
            contract_id=contract_id,
            year=2025,
            month=11
        ).first()
        
        if not bill:
            print(f"❌ 找不到账单")
            return
            
        print(f"✅ 找到账单: {bill.id}")
        print(f"📅 账单周期: {bill.cycle_start_date} 到 {bill.cycle_end_date}")
        
        # 调用账单详情API
        try:
            details = get_billing_details_internal(bill_id=str(bill.id))
            
            if details:
                print("✅ 成功获取账单详情")
                
                # 检查考勤信息
                attendance = details.get("attendance", {})
                print("\n📊 考勤信息:")
                print(f"  加班天数: {attendance.get('overtime_days', 0)}")
                print(f"  出京天数: {attendance.get('out_of_beijing_days', 0)}")
                print(f"  出境天数: {attendance.get('out_of_country_days', 0)}")
                print(f"  请假天数: {attendance.get('leave_days', 0)}")
                print(f"  带薪假天数: {attendance.get('paid_leave_days', 0)}")
                print(f"  休息天数: {attendance.get('rest_days', 0)}")
                
                # 检查是否有考勤数据
                has_attendance_data = any([
                    attendance.get('overtime_days', 0) > 0,
                    attendance.get('out_of_beijing_days', 0) > 0,
                    attendance.get('out_of_country_days', 0) > 0,
                    attendance.get('leave_days', 0) > 0,
                    attendance.get('paid_leave_days', 0) > 0,
                    attendance.get('rest_days', 0) > 0,
                ])
                
                if has_attendance_data:
                    print("✅ 账单详情中包含考勤数据")
                else:
                    print("❌ 账单详情中没有考勤数据")
                    
            else:
                print("❌ 获取账单详情失败")
                
        except Exception as e:
            print(f"❌ 调用账单详情API失败: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    test_billing_details()