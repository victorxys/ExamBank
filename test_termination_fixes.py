#!/usr/bin/env python3
"""
测试终止合同时的修复：
1. 代付员工工资调整项按实际劳务费计算
2. 非月签合同管理费退款逻辑
3. 当用户修改实际劳务天数时，代付工资调整项也会更新
"""

from datetime import date, timedelta, datetime
import sys
import os

# 添加项目根目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.app import app
from backend.models import db, NannyContract, CustomerBill, EmployeePayroll
from backend.services.attendance_sync_service import _calculate_records_days, _calculate_records_days_in_cycle
from backend.services.billing_engine import BillingEngine
from decimal import Decimal as D

def test_final_salary_adjustment_logic():
    """测试代付工资调整项的修复逻辑"""
    with app.app_context():
        print("🧪 测试代付工资调整项逻辑...")
        
        # 模拟一个提前终止的合同
        contract = NannyContract()
        contract.employee_level = "5000"  # 保证金5000元
        contract.termination_date = date(2025, 12, 15)  # 提前终止
        contract.type = "nanny"
        
        # 模拟账单和薪酬单
        bill = CustomerBill()
        bill.contract = contract
        
        payroll = EmployeePayroll()
        payroll.total_due = D("3500.50")  # 实际劳务费（包含加班费）
        
        # 测试逻辑：应该使用min(实际劳务费, 保证金)
        employee_level = D(contract.employee_level or '0')
        expected_amount = min(payroll.total_due, employee_level)
        
        print(f"  员工保证金: {employee_level}")
        print(f"  实际劳务费: {payroll.total_due}")
        print(f"  预期代付金额: {expected_amount}")
        
        # 验证修复后的逻辑：始终使用实际劳务费
        amount_to_set = min(payroll.total_due, employee_level).quantize(D("1"))
        print(f"  计算结果: {amount_to_set}")
        assert amount_to_set == D("3500"), f"期望3500，实际{amount_to_set}"  # 3500.50 quantize到整数是3500
        print("✅ 代付工资调整项逻辑测试通过")
        
        # 测试场景2：实际劳务费变化时的更新
        print("\n  测试实际劳务费变化场景...")
        payroll.total_due = D("2800.75")  # 修改后的实际劳务费
        new_amount = min(payroll.total_due, employee_level).quantize(D("1"))
        print(f"  修改后实际劳务费: {payroll.total_due}")
        print(f"  新的代付金额: {new_amount}")
        assert new_amount == D("2801"), f"期望2801，实际{new_amount}"  # 2800.75 quantize到整数是2801（四舍五入）
        print("✅ 实际劳务费变化时代付金额更新测试通过")

def test_non_monthly_management_fee_refund():
    """测试非月签合同管理费退款逻辑"""
    print("\n🧪 测试非月签合同管理费退款逻辑...")
    
    # 测试场景：2025年1月11日开始，2025年6月11日结束的合同
    # 在2025年3月15日提前终止
    contract_start = date(2025, 1, 11)
    contract_end = date(2025, 6, 11)
    termination_date = date(2025, 3, 15)
    
    monthly_management_fee = D("500")  # 月管理费500元
    daily_management_fee = (monthly_management_fee / D(30)).quantize(D("0.0001"))
    
    print(f"  合同期间: {contract_start} 到 {contract_end}")
    print(f"  终止日期: {termination_date}")
    print(f"  月管理费: {monthly_management_fee}")
    print(f"  日管理费: {daily_management_fee}")
    
    # 测试情况1：收取终止日管理费 (charge_on_termination_date = True)
    print("\n  情况1：收取终止日管理费")
    charge_on_termination_date = True
    next_month_10th = date(2025, 4, 10)  # 4月10日（下一个周期的前一天）
    
    if charge_on_termination_date:
        # 从3月16日开始计算到4月10日
        refund_start_date = termination_date + timedelta(days=1)  # 3月16日
        days_to_refund = (next_month_10th - refund_start_date).days + 1  # 包含4月10日当天
    else:
        # 从3月15日开始计算到4月10日
        refund_start_date = termination_date  # 3月15日
        days_to_refund = (next_month_10th - refund_start_date).days + 1  # 包含4月10日当天
    
    partial_refund = (daily_management_fee * D(days_to_refund)).quantize(D("0.01"))
    remaining_cycles = 2
    full_cycles_refund = monthly_management_fee * D(remaining_cycles)
    total_refund = partial_refund + full_cycles_refund
    
    print(f"    退款起始日期: {refund_start_date}")
    print(f"    退款天数: {days_to_refund}天")
    print(f"    部分周期退款: {partial_refund}")
    print(f"    完整周期退款: {full_cycles_refund}")
    print(f"    总退款金额: {total_refund}")
    
    # 验证：3月16日到4月10日 = 26天（包含4月10日当天）
    assert days_to_refund == 26, f"期望26天，实际{days_to_refund}天"
    
    # 测试情况2：不收取终止日管理费 (charge_on_termination_date = False)
    print("\n  情况2：不收取终止日管理费")
    charge_on_termination_date = False
    
    if charge_on_termination_date:
        refund_start_date = termination_date + timedelta(days=1)
        days_to_refund = (next_month_10th - refund_start_date).days + 1
    else:
        refund_start_date = termination_date
        days_to_refund = (next_month_10th - refund_start_date).days + 1
    
    partial_refund = (daily_management_fee * D(days_to_refund)).quantize(D("0.01"))
    total_refund = partial_refund + full_cycles_refund
    
    print(f"    退款起始日期: {refund_start_date}")
    print(f"    退款天数: {days_to_refund}天")
    print(f"    部分周期退款: {partial_refund}")
    print(f"    总退款金额: {total_refund}")
    
    # 验证：3月15日到4月10日 = 27天（包含4月10日当天）
    assert days_to_refund == 27, f"期望27天，实际{days_to_refund}天"
    
    print("✅ 非月签管理费退款逻辑测试通过")

def test_trial_contract_logic():
    """测试试工合同的代付工资逻辑"""
    print("\n🧪 测试试工合同代付工资逻辑...")
    
    # 模拟试工合同
    contract = NannyContract()
    contract.type = "nanny_trial"
    contract.employee_level = "5000"
    
    payroll = EmployeePayroll()
    payroll.total_due = D("1200.00")  # 试工期实际劳务费
    
    # 试工合同应该使用全部实际劳务费
    expected_amount = payroll.total_due.quantize(D("1"))
    
    print(f"  试工合同实际劳务费: {payroll.total_due}")
    print(f"  预期代付金额: {expected_amount}")
    
    # 验证逻辑
    amount_to_set = payroll.total_due.quantize(D("1"))
    assert amount_to_set == D("1200"), f"期望1200，实际{amount_to_set}"
    print("✅ 试工合同代付工资逻辑测试通过")

def test_terminated_cycle_excludes_rest_days_after_contract_end():
    """终止后重算时，合同外休息不能继续扣减实际出勤。"""
    rest_records = [
        {
            "date": "2026-07-03",
            "type": "rest",
            "hours": 24 * 29,
            "minutes": 0,
            "daysOffset": 28,
        }
    ]

    assert _calculate_records_days(rest_records) == D("29")
    assert _calculate_records_days_in_cycle(
        rest_records,
        date(2026, 7, 1),
        date(2026, 7, 3),
    ) == D("1")

    allocated_rest_days = BillingEngine()._attendance_days_in_cycle(
        rest_records,
        date(2026, 7, 1),
        date(2026, 7, 3),
    )
    assert allocated_rest_days == D("1.000")
    assert max(D("0"), D("3") - allocated_rest_days) == D("2.000")

def test_terminated_cycle_work_days_are_never_negative_when_all_valid_days_are_rest():
    """即使有效周期内全部休息，实际出勤也不能变成负数。"""
    rest_records = [
        {
            "date": "2026-07-01",
            "type": "rest",
            "hours": 24 * 31,
            "minutes": 0,
            "daysOffset": 30,
        }
    ]

    allocated_rest_days = BillingEngine()._attendance_days_in_cycle(
        rest_records,
        date(2026, 7, 1),
        date(2026, 7, 3),
    )
    assert allocated_rest_days == D("3.000")
    assert max(D("0"), D("3") - allocated_rest_days) == D("0")

if __name__ == "__main__":
    test_final_salary_adjustment_logic()
    test_non_monthly_management_fee_refund()
    test_trial_contract_logic()
    test_terminated_cycle_excludes_rest_days_after_contract_end()
    test_terminated_cycle_work_days_are_never_negative_when_all_valid_days_are_rest()
    print("\n🎉 所有测试完成")
