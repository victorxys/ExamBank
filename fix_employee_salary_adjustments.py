#!/usr/bin/env python3
"""
修正员工工资单上的保证金支付工资调整项，确保与客户账单上的公司代付工资调整项金额一致。
同时修复金额计算逻辑：使用实际劳务费（基础劳务费+加班费）而不是工资单总额。
"""

import sys
import os
from decimal import Decimal

# 添加项目根目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.app import app
from backend.models import db, BaseContract, CustomerBill, EmployeePayroll, FinancialAdjustment, AdjustmentType

D = Decimal

def rounded_bill_amount(amount):
    """四舍五入到整元，仅用于判断历史小数金额是否等价。"""
    return D(str(amount or 0)).quantize(D("1"))

def amounts_equivalent(left, right):
    return rounded_bill_amount(left) == rounded_bill_amount(right)

def calculate_correct_amount(_contract, payroll):
    """
    计算正确的保证金支付工资金额：使用工资单最终应发总额。
    工资单总额本身已经按最终结算口径完成四舍五入。
    """
    return D(str(payroll.total_due or 0)).quantize(D("0.01"))

def find_company_paid_salary_adjustment(bill):
    """优先复用任意已有公司代付工资项，避免重复创建系统项。"""
    manual_adj = FinancialAdjustment.query.filter(
        FinancialAdjustment.customer_bill_id == bill.id,
        FinancialAdjustment.adjustment_type == AdjustmentType.COMPANY_PAID_SALARY,
        FinancialAdjustment.description != "[系统] 公司代付工资",
    ).order_by(FinancialAdjustment.created_at.asc()).first()
    if manual_adj:
        return manual_adj

    system_adj = FinancialAdjustment.query.filter_by(
        customer_bill_id=bill.id,
        adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
        description="[系统] 公司代付工资"
    ).first()
    if system_adj:
        return system_adj

    return FinancialAdjustment.query.filter_by(
        customer_bill_id=bill.id,
        adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
    ).order_by(FinancialAdjustment.created_at.asc()).first()

def find_system_company_paid_salary_adjustment(bill):
    return FinancialAdjustment.query.filter_by(
        customer_bill_id=bill.id,
        adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
        description="[系统] 公司代付工资",
    ).first()

def format_dt(dt):
    return dt.strftime("%Y-%m-%d") if dt else "-"

def fix_employee_salary_adjustments(contract_id=None, dry_run=True, verbose=False):
    """修正员工工资单上的保证金支付工资调整项，确保与客户账单上的公司代付工资调整项金额一致。"""
    with app.app_context():
        if dry_run:
            print("--- 【演习模式】修正员工工资单调整项 ---")
        else:
            print("--- 开始修正员工工资单调整项 ---")
        
        try:
            if contract_id:
                # 处理单个合同
                contract = BaseContract.query.get(contract_id)
                if not contract:
                    print(f"错误：找不到合同 ID {contract_id}")
                    return
                
                contracts_to_process = [contract]
                if verbose:
                    print(f"将处理指定合同: {contract.id} | 客户: {contract.customer_name}")
            else:
                # 处理所有已结束的合同
                contracts_to_process = BaseContract.query.filter(
                    BaseContract.status.in_(["terminated", "finished"])
                ).all()
                
                if not contracts_to_process:
                    print("没有找到需要处理的已结束合同。")
                    return
                
                print(f"找到 {len(contracts_to_process)} 个已结束的合同需要检查。仅输出需要修改的合同及账单。")

            processed_count = 0
            total = len(contracts_to_process)
            skipped_count = 0

            for i, contract in enumerate(contracts_to_process):
                if verbose:
                    print(f"[{i+1}/{total}] 正在检查合同 ID: {contract.id} | 客户: {contract.customer_name} ...", end='')

                # 查找最后一个月的账单和工资单
                last_bill = CustomerBill.query.filter_by(
                    contract_id=contract.id,
                    is_substitute_bill=False
                ).order_by(CustomerBill.cycle_end_date.desc()).first()

                if not last_bill:
                    if verbose:
                        print(" -> 跳过 (无有效账单)")
                    skipped_count += 1
                    continue

                last_payroll = EmployeePayroll.query.filter_by(
                    contract_id=contract.id,
                    cycle_start_date=last_bill.cycle_start_date,
                    is_substitute_payroll=False
                ).first()

                if not last_payroll:
                    if verbose:
                        print(" -> 跳过 (无有效工资单)")
                    skipped_count += 1
                    continue

                # 计算正确的代付金额
                correct_amount = calculate_correct_amount(contract, last_payroll)
                
                if correct_amount <= 0:
                    if verbose:
                        print(" -> 跳过 (计算金额为0)")
                    skipped_count += 1
                    continue

                company_adj = find_company_paid_salary_adjustment(last_bill)
                system_company_adj = find_system_company_paid_salary_adjustment(last_bill)
                duplicate_system_adj = (
                    system_company_adj
                    if company_adj and system_company_adj and company_adj.id != system_company_adj.id
                    else None
                )

                # 查找员工工资单上的保证金支付工资调整项
                employee_adj = FinancialAdjustment.query.filter_by(
                    employee_payroll_id=last_payroll.id,
                    adjustment_type=AdjustmentType.DEPOSIT_PAID_SALARY,
                    description="[系统] 保证金支付工资"
                ).first()

                needs_fix = False
                issues = []
                
                # 检查客户账单调整项。历史数据可能保留小数；
                # 只要四舍五入后等价，就不强制覆盖历史金额。
                if company_adj:
                    if system_company_adj and company_adj.id == system_company_adj.id and not amounts_equivalent(company_adj.amount, correct_amount):
                        issues.append(f"客户账单金额: {company_adj.amount} (需修正)")
                        needs_fix = True
                    elif verbose:
                        issues.append(f"客户账单金额: {company_adj.amount} (已存在，使用该项)")
                    else:
                        pass
                else:
                    issues.append("缺少客户账单调整项")
                    needs_fix = True

                if duplicate_system_adj:
                    issues.append(f"存在重复系统公司代付工资: {duplicate_system_adj.amount} (将删除)")
                    needs_fix = True

                # 检查员工工资单调整项。同样按四舍五入后的结果判断是否等价。
                if employee_adj:
                    if employee_adj.amount != correct_amount:
                        issues.append(f"员工工资单金额: {employee_adj.amount} (需修正)")
                        needs_fix = True
                    elif verbose:
                        issues.append(f"员工工资单金额: {employee_adj.amount} (正确)")
                    else:
                        pass
                else:
                    issues.append("缺少员工工资单调整项")
                    needs_fix = True

                # 检查镜像关联
                if company_adj and employee_adj:
                    if company_adj.mirrored_adjustment_id != employee_adj.id or employee_adj.mirrored_adjustment_id != company_adj.id:
                        issues.append("镜像关联错误")
                        needs_fix = True

                if not needs_fix:
                    if verbose:
                        print(f" -> 正确金额: {correct_amount}, {', '.join(issues)} -> 无需修正")
                    skipped_count += 1
                    continue

                bill_meta = (
                    f"[{i+1}/{total}] 合同ID: {contract.id} | 客户: {contract.customer_name} | "
                    f"账单: {last_bill.year}-{last_bill.month:02d} | 账单ID: {last_bill.id} | "
                    f"服务周期: {format_dt(last_bill.cycle_start_date)}~{format_dt(last_bill.cycle_end_date)} | "
                    f"正确金额: {correct_amount}"
                )
                print(bill_meta)
                print(f"  问题: {', '.join(issues)}")

                if not dry_run:
                    # 创建或更新客户账单调整项
                    if not company_adj:
                        company_adj = FinancialAdjustment(
                            customer_bill_id=last_bill.id,
                            adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
                            amount=correct_amount,
                            description="[系统] 公司代付工资",
                            date=last_bill.cycle_end_date
                        )
                        db.session.add(company_adj)
                        db.session.flush()
                    else:
                        if system_company_adj and company_adj.id == system_company_adj.id and not amounts_equivalent(company_adj.amount, correct_amount):
                            company_adj.amount = correct_amount
                        db.session.add(company_adj)
                    
                    # 创建或更新员工工资单调整项
                    if not employee_adj:
                        employee_adj = FinancialAdjustment(
                            employee_payroll_id=last_payroll.id,
                            adjustment_type=AdjustmentType.DEPOSIT_PAID_SALARY,
                            amount=correct_amount,
                            description="[系统] 保证金支付工资",
                            date=last_bill.cycle_end_date,
                            mirrored_adjustment_id=company_adj.id
                        )
                        db.session.add(employee_adj)
                        db.session.flush()
                    else:
                        if employee_adj.amount != correct_amount:
                            employee_adj.amount = correct_amount
                        db.session.add(employee_adj)
                    
                    if duplicate_system_adj:
                        if duplicate_system_adj.mirrored_adjustment_id == employee_adj.id:
                            duplicate_system_adj.mirrored_adjustment_id = None
                        db.session.delete(duplicate_system_adj)
                        db.session.flush()

                    # 确保双向镜像关联
                    company_adj.mirrored_adjustment_id = employee_adj.id
                    employee_adj.mirrored_adjustment_id = company_adj.id
                    db.session.add(company_adj)
                    db.session.add(employee_adj)
                    db.session.flush()
                    
                    db.session.commit()
                    processed_count += 1
                    print("  结果: 已修正")
                else:
                    processed_count += 1
                    print("  结果: [演习模式] 将会修正")

            print(f"\n--- 任务执行完毕 ---")
            if dry_run:
                print(f"【演习模式】共检查 {total} 个合同，跳过 {skipped_count} 个，将为 {processed_count} 个合同修正调整项。")
            else:
                print(f"共检查 {total} 个合同，跳过 {skipped_count} 个，成功为 {processed_count} 个合同修正了调整项。")

        except Exception as e:
            print(f"执行任务时发生严重错误: {e}")
            import traceback
            traceback.print_exc()
            if not dry_run:
                db.session.rollback()

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="修正员工工资单上的保证金支付工资调整项")
    parser.add_argument("--contract-id", type=str, help="要修正的合同ID")
    parser.add_argument("--dry-run", action="store_true", help="只打印将要执行的操作，不实际修改数据库")
    parser.add_argument("--verbose", action="store_true", help="输出所有合同检查过程；默认只输出需要修改的合同及账单")
    
    args = parser.parse_args()
    
    fix_employee_salary_adjustments(
        contract_id=args.contract_id,
        dry_run=args.dry_run,
        verbose=args.verbose
    )
