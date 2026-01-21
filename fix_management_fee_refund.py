#!/usr/bin/env python3
"""
修复非月签育儿嫂合同终止时管理费退款计算错误的脚本

问题描述：
对于开始日和结束日相同的非月签合同（如17日开始17日结束），
在终止时计算管理费退款时，错误地将"终止日到下个月的周期结束日"作为部分周期，
导致少算了一个完整周期。

例如：2025-10-17 ~ 2026-10-17 的合同，在2026-01-06终止
- 错误逻辑：部分周期 1月6日~2月16日（42天），完整周期8个
- 正确逻辑：部分周期 1月6日~1月16日（11天），完整周期9个

使用方法：
    python fix_management_fee_refund.py --dry-run  # 预览将要修复的数据
    python fix_management_fee_refund.py            # 实际执行修复
"""

import sys
import os
from datetime import date, timedelta
from decimal import Decimal as D
import calendar

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

# 设置环境变量
os.environ['FLASK_APP'] = 'backend.app'

from backend.extensions import db
from backend.models import NannyContract, CustomerBill, FinancialAdjustment, AdjustmentType
from backend.app import app


def calculate_correct_refund(contract, termination_date, charge_on_termination_date=False):
    """
    计算正确的管理费退款金额
    
    Args:
        contract: NannyContract 对象
        termination_date: 终止日期
        charge_on_termination_date: 是否收取终止日管理费
    
    Returns:
        dict: {
            'partial_refund': Decimal,  # 部分周期退款
            'full_cycles_refund': Decimal,  # 完整周期退款
            'total_refund': Decimal,  # 总退款
            'days_to_cycle_end': int,  # 到当前周期结束的天数
            'remaining_cycles': int,  # 剩余完整周期数
            'description': str  # 描述
        }
    """
    contract_start_date = contract.start_date.date() if hasattr(contract.start_date, 'date') else contract.start_date
    original_end_date = contract.end_date.date() if hasattr(contract.end_date, 'date') else contract.end_date
    
    contract_start_day = contract_start_date.day
    contract_end_day = original_end_date.day
    
    # 只处理开始日和结束日相同的合同
    if contract_start_day != contract_end_day:
        return None
    
    # 计算管理费
    monthly_management_fee = contract.management_fee_amount if contract.management_fee_amount and contract.management_fee_amount > 0 else (D(contract.employee_level or '0') * D("0.1"))
    daily_management_fee = (monthly_management_fee / D(30)).quantize(D("0.0001"))
    
    print(f"  [DEBUG] 月管理费: {monthly_management_fee:.2f}元, 日管理费: {daily_management_fee:.4f}元")
    
    # 找到终止日所在周期的结束日
    if termination_date.day >= contract_start_day:
        # 终止日在当前周期内（例如：1月17日~1月31日之间）
        # 当前周期结束日是下个月的 contract_start_day - 1
        if termination_date.month == 12:
            current_cycle_end = date(termination_date.year + 1, 1, contract_start_day - 1)
        else:
            current_cycle_end = date(termination_date.year, termination_date.month + 1, contract_start_day - 1)
    else:
        # 终止日在上个周期的后半段（例如：1月1日~1月16日之间）
        # 当前周期结束日是本月的 contract_start_day - 1
        current_cycle_end = date(termination_date.year, termination_date.month, contract_start_day - 1)
    
    # 计算部分周期退款
    if charge_on_termination_date:
        refund_start_date = termination_date + timedelta(days=1)
        days_to_cycle_end = (current_cycle_end - refund_start_date).days + 1
        description_suffix = f"(收取终止日管理费，从{refund_start_date.month}月{refund_start_date.day}日开始退款)"
    else:
        refund_start_date = termination_date
        days_to_cycle_end = (current_cycle_end - refund_start_date).days + 1
        description_suffix = f"(不收取终止日管理费，从{refund_start_date.month}月{refund_start_date.day}日开始退款)"
    
    # 如果天数为0或负数，说明终止日正好是周期结束日或之后，不需要部分周期退款
    if days_to_cycle_end <= 0:
        days_to_cycle_end = 0
        partial_refund = D('0')
    else:
        partial_refund = (daily_management_fee * D(days_to_cycle_end)).quantize(D("0.01"))
    
    # 计算剩余完整周期数
    remaining_cycles = 0
    current_cycle_start = current_cycle_end + timedelta(days=1)
    
    while current_cycle_start < original_end_date:
        remaining_cycles += 1
        if current_cycle_start.month == 12:
            current_cycle_start = date(current_cycle_start.year + 1, 1, contract_start_day)
        else:
            try:
                current_cycle_start = date(current_cycle_start.year, current_cycle_start.month + 1, contract_start_day)
            except ValueError:
                current_cycle_start = date(current_cycle_start.year, current_cycle_start.month + 1, min(contract_start_day, calendar.monthrange(current_cycle_start.year, current_cycle_start.month + 1)[1]))
    
    full_cycles_refund = monthly_management_fee * D(remaining_cycles)
    total_refund = partial_refund + full_cycles_refund
    
    # 生成描述
    description_parts = ["合同提前终止，管理费退款计算如下："]
    if days_to_cycle_end > 0:
        description_parts.append(f"  - 退款天数: {days_to_cycle_end}天 * {daily_management_fee:.4f} = {partial_refund:.2f}元 {description_suffix}")
    if remaining_cycles > 0:
        description_parts.append(f"  - 剩余完整周期: {remaining_cycles}个 * {monthly_management_fee:.2f} = {full_cycles_refund:.2f}元")
    description_parts.append(f"  - 总计：{total_refund:.2f}元")
    
    return {
        'partial_refund': partial_refund,
        'full_cycles_refund': full_cycles_refund,
        'total_refund': total_refund,
        'days_to_cycle_end': days_to_cycle_end,
        'remaining_cycles': remaining_cycles,
        'description': '\n'.join(description_parts),
        'current_cycle_end': current_cycle_end,
        'refund_start_date': refund_start_date
    }


def find_affected_contracts():
    """
    查找所有受影响的合同
    
    返回：
        list: 受影响的合同列表，每个元素包含合同和相关信息
    """
    affected = []
    
    # 查找所有已终止的非月签育儿嫂合同
    contracts = NannyContract.query.filter(
        NannyContract.status == 'terminated',
        NannyContract.is_monthly_auto_renew == False,
        NannyContract.termination_date.isnot(None)
    ).all()
    
    print(f"找到 {len(contracts)} 个已终止的非月签育儿嫂合同")
    
    for contract in contracts:
        # 只处理开始日和结束日相同的合同
        contract_start_date = contract.start_date.date() if hasattr(contract.start_date, 'date') else contract.start_date
        original_end_date = contract.end_date.date() if hasattr(contract.end_date, 'date') else contract.end_date
        termination_date = contract.termination_date.date() if hasattr(contract.termination_date, 'date') else contract.termination_date
        
        if contract_start_date.day != original_end_date.day:
            continue
        
        # 跳过同月终止的情况（这种情况逻辑是正确的）
        if termination_date.year == original_end_date.year and termination_date.month == original_end_date.month:
            continue
        
        # 查找最后一个账单
        last_bill = CustomerBill.query.filter(
            CustomerBill.contract_id == contract.id,
            CustomerBill.is_substitute_bill == False
        ).order_by(CustomerBill.cycle_end_date.desc()).first()
        
        if not last_bill:
            continue
        
        # 查找管理费退款调整项
        refund_adjustments = FinancialAdjustment.query.filter(
            FinancialAdjustment.customer_bill_id == last_bill.id,
            FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DECREASE,
            FinancialAdjustment.description.like('%管理费退款%')
        ).all()
        
        if not refund_adjustments:
            continue
        
        # 计算正确的退款金额
        # 尝试从描述中判断是否收取终止日管理费
        charge_on_termination_date = True  # 默认收取（与API默认值一致）
        
        # 首先检查描述中是否有明确说明
        has_explicit_flag = False
        for adj in refund_adjustments:
            if '不收取终止日管理费' in adj.description:
                charge_on_termination_date = False
                has_explicit_flag = True
                break
            elif '收取终止日管理费' in adj.description:
                charge_on_termination_date = True
                has_explicit_flag = True
                break
        
        # 如果描述中没有明确说明，尝试通过天数反推
        if not has_explicit_flag:
            # 尝试两种情况，看哪种更接近当前金额
            correct_refund_charge = calculate_correct_refund(contract, termination_date, True)
            correct_refund_no_charge = calculate_correct_refund(contract, termination_date, False)
            
            current_total_refund = sum(adj.amount for adj in refund_adjustments)
            
            if correct_refund_charge and correct_refund_no_charge:
                diff_charge = abs(current_total_refund - correct_refund_charge['total_refund'])
                diff_no_charge = abs(current_total_refund - correct_refund_no_charge['total_refund'])
                
                # 选择差异较小的那个
                charge_on_termination_date = diff_charge < diff_no_charge
                
                print(f"  [自动判断] 当前金额: {current_total_refund:.2f}元")
                print(f"  [自动判断] 收取终止日: {correct_refund_charge['total_refund']:.2f}元 (差异: {diff_charge:.2f})")
                print(f"  [自动判断] 不收取终止日: {correct_refund_no_charge['total_refund']:.2f}元 (差异: {diff_no_charge:.2f})")
                print(f"  [自动判断] 判断结果: {'收取' if charge_on_termination_date else '不收取'}终止日管理费")
        
        correct_refund = calculate_correct_refund(contract, termination_date, charge_on_termination_date)
        
        if not correct_refund:
            continue
        
        # 计算当前的退款总额
        current_total_refund = sum(adj.amount for adj in refund_adjustments)
        
        # 如果金额不一致，说明需要修复
        if abs(current_total_refund - correct_refund['total_refund']) > D('0.01'):
            affected.append({
                'contract': contract,
                'last_bill': last_bill,
                'refund_adjustments': refund_adjustments,
                'current_total_refund': current_total_refund,
                'correct_refund': correct_refund,
                'termination_date': termination_date,
                'charge_on_termination_date': charge_on_termination_date
            })
    
    return affected


def fix_contract_refund(item, dry_run=True):
    """
    修复单个合同的管理费退款
    
    Args:
        item: 包含合同和相关信息的字典
        dry_run: 是否为演习模式
    """
    contract = item['contract']
    last_bill = item['last_bill']
    refund_adjustments = item['refund_adjustments']
    current_total_refund = item['current_total_refund']
    correct_refund = item['correct_refund']
    termination_date = item['termination_date']
    charge_on_termination_date = item['charge_on_termination_date']
    
    print(f"\n{'[演习]' if dry_run else '[执行]'} 修复合同 {contract.id}")
    print(f"  客户: {contract.customer.name if contract.customer else 'N/A'}")
    print(f"  员工: {contract.service_personnel.name if contract.service_personnel else 'N/A'}")
    print(f"  合同周期: {contract.start_date.date()} ~ {contract.end_date.date()}")
    print(f"  终止日期: {termination_date}")
    print(f"  终止日管理费: {'收取' if charge_on_termination_date else '不收取'}")
    print(f"  当前退款: {current_total_refund:.2f}元")
    print(f"  正确退款: {correct_refund['total_refund']:.2f}元")
    print(f"  差额: {correct_refund['total_refund'] - current_total_refund:.2f}元")
    print(f"  当前周期结束: {correct_refund['current_cycle_end']}")
    print(f"  部分周期天数: {correct_refund['days_to_cycle_end']}天")
    print(f"  剩余完整周期: {correct_refund['remaining_cycles']}个")
    
    if not dry_run:
        # 删除旧的退款调整项
        for adj in refund_adjustments:
            print(f"  删除旧调整项: ID={adj.id}, 金额={adj.amount:.2f}元")
            db.session.delete(adj)
        
        # 创建新的退款调整项
        new_adjustment = FinancialAdjustment(
            customer_bill_id=last_bill.id,
            adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
            amount=correct_refund['total_refund'],
            description=correct_refund['description'],
            date=termination_date
        )
        db.session.add(new_adjustment)
        print(f"  创建新调整项: 金额={correct_refund['total_refund']:.2f}元")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='修复非月签育儿嫂合同管理费退款计算错误')
    parser.add_argument('--dry-run', action='store_true', help='演习模式，只显示将要修复的数据，不实际修改数据库')
    args = parser.parse_args()
    
    with app.app_context():
        print("=" * 80)
        print("非月签育儿嫂合同管理费退款修复脚本")
        print("=" * 80)
        
        if args.dry_run:
            print("\n【演习模式】- 只显示将要修复的数据，不会实际修改数据库\n")
        else:
            print("\n【执行模式】- 将实际修改数据库\n")
            response = input("确认要执行修复吗？(yes/no): ")
            if response.lower() != 'yes':
                print("已取消")
                return
        
        # 查找受影响的合同
        print("\n正在查找受影响的合同...")
        affected = find_affected_contracts()
        
        if not affected:
            print("\n未找到需要修复的合同")
            return
        
        print(f"\n找到 {len(affected)} 个需要修复的合同\n")
        
        # 修复每个合同
        total_diff = D('0')
        for item in affected:
            fix_contract_refund(item, dry_run=args.dry_run)
            total_diff += item['correct_refund']['total_refund'] - item['current_total_refund']
        
        print("\n" + "=" * 80)
        print(f"总计: {len(affected)} 个合同需要修复")
        print(f"总差额: {total_diff:.2f}元")
        print("=" * 80)
        
        if not args.dry_run:
            try:
                db.session.commit()
                print("\n✓ 修复完成，数据已提交到数据库")
            except Exception as e:
                db.session.rollback()
                print(f"\n✗ 修复失败: {e}")
                raise
        else:
            print("\n【演习模式】未修改数据库")
            print("如需实际执行修复，请运行: python fix_management_fee_refund.py")


if __name__ == '__main__':
    main()
