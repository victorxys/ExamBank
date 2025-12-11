#!/usr/bin/env python3
"""
测试家庭ID合并情况下的账单计算修复
"""
import sys
import os
sys.path.append('.')

from backend.services.billing_engine import BillingEngine
from backend.models import db, BaseContract
from backend.app import app

def test_billing_fix():
    with app.app_context():
        print("🧪 测试家庭ID合并情况下的账单计算...")
        
        # 获取测试合同
        contract_id = "6f7f20e6-642d-484d-a5d1-aaf836d3cb0d"
        contract = BaseContract.query.get(contract_id)
        
        if not contract:
            print(f"❌ 找不到合同 {contract_id}")
            return
            
        print(f"✅ 找到合同: {contract.customer_name} (family_id: {contract.family_id})")
        
        # 创建BillingEngine并重算
        engine = BillingEngine()
        try:
            print("🔄 开始重算账单...")
            engine.calculate_for_month(2025, 11, contract_id=contract_id, force_recalculate=True)
            print("✅ 账单重算完成")
            
            # 检查结果
            from backend.models import CustomerBill, AttendanceRecord
            bill = CustomerBill.query.filter_by(
                contract_id=contract_id,
                year=2025,
                month=11
            ).first()
            
            if bill:
                print(f"📊 账单金额: {bill.total_due}")
                print(f"📅 账单周期: {bill.cycle_start_date} 到 {bill.cycle_end_date}")
                
                # 检查用户填写的考勤记录（优先级最高）
                user_attendance = AttendanceRecord.query.filter(
                    AttendanceRecord.employee_id == contract.service_personnel_id,
                    AttendanceRecord.cycle_start_date >= '2025-11-01',
                    AttendanceRecord.cycle_start_date < '2025-12-01',
                    AttendanceRecord.attendance_form_id.isnot(None)
                ).first()
                
                if user_attendance:
                    print(f"✅ 找到用户填写的考勤记录: {user_attendance.id}")
                    print(f"📈 实际出勤天数: {user_attendance.total_days_worked}")
                    print(f"⏰ 加班天数: {user_attendance.overtime_days}")
                    print(f"📅 考勤周期: {user_attendance.cycle_start_date} 到 {user_attendance.cycle_end_date}")
                    print(f"📝 关联表单ID: {user_attendance.attendance_form_id}")
                else:
                    print("❌ 没有找到用户填写的考勤记录")
            else:
                print("❌ 没有找到账单")
                
        except Exception as e:
            print(f"❌ 重算失败: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    test_billing_fix()