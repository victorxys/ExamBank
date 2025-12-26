#!/usr/bin/env python3
"""
修正员工工资单上的保证金支付工资调整项，确保与客户账单上的公司代付工资调整项金额一致。
"""

import sys
import os

# 添加项目根目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.app import app
from backend.models import db, BaseContract, CustomerBill, EmployeePayroll, FinancialAdjustment, AdjustmentType

def fix_employee_salary_adjustments(contract_id=None, dry_run=True):
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
                print(f"将处理指定合同: {contract.id} | 客户: {contract.customer_name}")
            else:
                # 处理所有已结束的合同
                contracts_to_process = BaseContract.query.filter(
                    BaseContract.status.in_(["terminated", "finished"])
                ).all()
                
                if not contracts_to_process:
                    print("没有找到需要处理的已结束合同。")
                    return
                
                print(f"找到 {len(contracts_to_process)} 个已结束的合同需要检查。")

            processed_count = 0
            total = len(contracts_to_process)

            for i, contract in enumerate(contracts_to_process):
                print(f"[{i+1}/{total}] 正在检查合同 ID: {contract.id} | 客户: {contract.customer_name} ...", end='')

                # 查找最后一个月的账单和工资单
                last_bill = CustomerBill.query.filter_by(
                    contract_id=contract.id,
                    is_substitute_bill=False
                ).order_by(CustomerBill.cycle_end_date.desc()).first()

                if not last_bill:
                    print(" -> 跳过 (无有效账单)")
                    continue

                last_payroll = EmployeePayroll.query.filter_by(
                    contract_id=contract.id,
                    cycle_start_date=last_bill.cycle_start_date,
                    is_substitute_payroll=False
                ).first()

                if not last_payroll:
                    print(" -> 跳过 (无有效工资单)")
                    continue

                # 查找客户账单上的公司代付工资调整项
                company_adj = FinancialAdjustment.query.filter_by(
                    customer_bill_id=last_bill.id,
                    adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
                    description="[系统] 公司代付工资"
                ).first()

                if not company_adj:
                    print(" -> 跳过 (无公司代付工资调整项)")
                    continue

                # 查找员工工资单上的保证金支付工资调整项
                employee_adj = FinancialAdjustment.query.filter_by(
                    employee_payroll_id=last_payroll.id,
                    adjustment_type=AdjustmentType.DEPOSIT_PAID_SALARY,
                    description="[系统] 保证金支付工资"
                ).first()

                print(f" -> 客户账单代付金额: {company_adj.amount}", end='')

                if employee_adj:
                    print(f", 员工工资单金额: {employee_adj.amount}", end='')
                    
                    # 检查金额是否匹配
                    amounts_match = employee_adj.amount == company_adj.amount
                    
                    # 检查镜像关联是否正确
                    mirror_links_correct = (
                        company_adj.mirrored_adjustment_id == employee_adj.id and 
                        employee_adj.mirrored_adjustment_id == company_adj.id
                    )
                    
                    if not amounts_match or not mirror_links_correct:
                        if not amounts_match:
                            print(f" -> 金额不匹配", end='')
                        if not mirror_links_correct:
                            print(f" -> 镜像关联错误", end='')
                        
                        if not dry_run:
                            # 更新员工工资单上的调整项金额
                            employee_adj.amount = company_adj.amount
                            db.session.add(employee_adj)
                            
                            # 确保互相关联
                            company_adj.mirrored_adjustment_id = employee_adj.id
                            employee_adj.mirrored_adjustment_id = company_adj.id
                            db.session.add(company_adj)
                            db.session.add(employee_adj)
                            
                            db.session.commit()
                            processed_count += 1
                            print(" -> 已修正")
                        else:
                            print(" -> [演习模式] 将会修正")
                            processed_count += 1
                    else:
                        print(" -> 金额和关联都正确")
                else:
                    print(" -> 缺少员工调整项", end='')
                    
                    if not dry_run:
                        # 创建员工工资单上的镜像调整项
                        new_employee_adj = FinancialAdjustment(
                            employee_payroll_id=last_payroll.id,
                            adjustment_type=AdjustmentType.DEPOSIT_PAID_SALARY,
                            amount=company_adj.amount,
                            description="[系统] 保证金支付工资",
                            date=company_adj.date,
                            mirrored_adjustment_id=company_adj.id
                        )
                        db.session.add(new_employee_adj)
                        db.session.flush()
                        
                        # 更新客户账单调整项的关联
                        company_adj.mirrored_adjustment_id = new_employee_adj.id
                        db.session.add(company_adj)
                        
                        db.session.commit()
                        processed_count += 1
                        print(" -> 已创建")
                    else:
                        print(" -> [演习模式] 将会创建")
                        processed_count += 1

            print(f"\n--- 任务执行完毕 ---")
            if dry_run:
                print(f"【演习模式】共检查 {total} 个合同，将为 {processed_count} 个合同修正员工工资单调整项。")
            else:
                print(f"共检查 {total} 个合同，成功为 {processed_count} 个合同修正了员工工资单调整项。")

        except Exception as e:
            print(f"执行任务时发生严重错误: {e}")
            if not dry_run:
                db.session.rollback()
            raise

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="修正员工工资单上的保证金支付工资调整项")
    parser.add_argument("--contract-id", type=str, help="要修正的合同ID")
    parser.add_argument("--dry-run", action="store_true", help="只打印将要执行的操作，不实际修改数据库")
    
    args = parser.parse_args()
    
    fix_employee_salary_adjustments(
        contract_id=args.contract_id,
        dry_run=args.dry_run
    )