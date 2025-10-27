# backend/management_commands.py

import click
from flask.cli import with_appcontext
from backend.services.billing_engine import BillingEngine, _update_bill_payment_status
from backend.models import BaseContract, db, CustomerBill, PaymentRecord,FinancialAdjustment,EmployeePayroll, AdjustmentType
from sqlalchemy import func
from decimal import Decimal

def register_commands(app):
    @app.cli.command("fix-bill-totals")
    @with_appcontext
    def fix_bill_totals_command():
        """
        修复所有客户账单的实收总额(total_paid)和支付状态(payment_status)。
        这个脚本会遍历所有账单，根据关联的支付记录重新计算总额。
        """
        print("--- 开始修复历史账单的实收总额和支付状态 ---")
        
        try:
            all_bills = CustomerBill.query.all()
            total_bills = len(all_bills)
            updated_count = 0
            
            print(f"找到 {total_bills} 个账单需要检查。")

            for i, bill in enumerate(all_bills):
                # 重新计算实收总额
                correct_total_paid = db.session.query(func.sum(PaymentRecord.amount)).filter(
                    PaymentRecord.customer_bill_id == bill.id
                ).scalar() or Decimal('0')
                
                correct_total_paid = correct_total_paid.quantize(Decimal("0.01"))

                # 检查是否需要更新
                if bill.total_paid != correct_total_paid:
                    updated_count += 1
                    print(f"  -> [{i+1}/{total_bills}] 发现不一致: 账单ID {bill.id} | 旧总额: {bill.total_paid} | 新总额: {correct_total_paid}")
                    bill.total_paid = correct_total_paid
                
                # 无论总额是否变化，都重新检查一下状态
                original_status = bill.payment_status
                _update_bill_payment_status(bill)
                if bill.payment_status != original_status:
                    if not (bill.total_paid == correct_total_paid): # Only log status change if total was not already being updated
                         print(f"     - 状态更新: 账单ID {bill.id} | 旧状态: {original_status.value} | 新状态: {bill.payment_status.value}")

            if updated_count > 0:
                db.session.commit()
                print("\n--- 修复完成 ---")
                print(f"共检查 {total_bills} 个账单，更新了 {updated_count} 个账单的实收总额。")
            else:
                print("\n--- 检查完成 ---")
                print("所有账单的实收总额都已是最新，无需修复。")

        except Exception as e:
            db.session.rollback()
            print(f"执行修复任务时发生严重错误: {e}")

    @app.cli.command("recalc-bills")
    @click.option("--year", required=True, type=int, help="要计算的年份 (例如: 2025)")
    @click.option("--month", required=True, type=int, help="要计算的月份 (例如: 8)")
    @with_appcontext
    def recalc_bills_command(year, month):
        """
        强制重新计算指定月份的所有有效合同的账单。
        """
        print(f"--- 开始强制重算 {year}年{month}月 的所有账单 ---")

        try:
            engine = BillingEngine()

            # 查询所有需要处理的合同
            contracts_to_process = BaseContract.query.filter(
                BaseContract.status.in_(["active", "terminated", "trial_active", "trial_succeeded"])
            ).all()

            if not contracts_to_process:
                print("没有找到需要处理的合同。")
                return

            total = len(contracts_to_process)
            print(f"找到 {total} 个合同需要处理。")

            for i, contract in enumerate(contracts_to_process):
                print(f"[{i+1}/{total}] 正在处理合同 ID: {contract.id} | 客户: {contract.customer_name} ...")
                try:
                    # 直接调用核心计算函数，并设置 force_recalculate=True
                    engine.calculate_for_month(
                        year=year,
                        month=month,
                        contract_id=contract.id,
                        force_recalculate=True
                    )
                    # 每次成功后提交，以防单个合同失败影响全部
                    db.session.commit()
                except Exception as e:
                    print(f"  -> 处理合同 {contract.id} 时发生错误: {e}")
                    db.session.rollback()

            print(f"--- {year}年{month}月 的账单重算任务执行完毕 ---")

        except Exception as e:
            print(f"执行重算任务时发生严重错误: {e}")


    @app.cli.command("recalc-all-bills-full-lifecycle")
    @with_appcontext
    def recalc_all_bills_full_lifecycle_command():
        """
        【谨慎使用】强制重算所有有效合同的整个生命周期的所有账单。
        这是一个非常耗时的操作。
        """
        print("--- 【警告】即将开始重算所有合同的全部历史账单，此过程可能需要很长时间。 ---")

        try:
            engine = BillingEngine()

            contracts_to_process = BaseContract.query.filter(
                BaseContract.status.in_(["active", "terminated", "trial_active", "trial_succeeded"])
            ).all()

            if not contracts_to_process:
                print("没有找到需要处理的合同。")
                return

            total = len(contracts_to_process)
            print(f"找到 {total} 个合同需要进行全生命周期重算。")

            for i, contract in enumerate(contracts_to_process):
                print(f"[{i+1}/{total}] 正在处理合同 ID: {contract.id} | 客户: {contract.customer_name} ...")
                try:
                    # --- 修改下面这一行 ---
                    # 旧代码: engine.generate_all_bills_for_contract(...)
                    # 新代码:
                    engine.recalculate_all_bills_for_contract(contract_id=contract.id)
                    # --- 修改结束 ---

                    db.session.commit()
                    print(f"  -> 合同 {contract.id} 处理完毕。")
                except Exception as e:
                    print(f"  -> 处理合同 {contract.id} 时发生错误: {e}")
                    db.session.rollback()

        except Exception as e:
            print(f"执行重算任务时发生严重错误: {e}")


    @app.cli.command("add-salary-adjustments")
    @with_appcontext
    def add_salary_adjustments_command():
        """为所有已结束合同的最后一个月账单，追溯添加“公司代付工资”调整项。"""
        print("--- 开始为已结束的合同追溯添加“公司代付工资”调整项 ---")
        try:
            engine = BillingEngine()
            contracts_to_process = BaseContract.query.filter(
                BaseContract.status.in_(["terminated", "finished"])
            ).all()

            if not contracts_to_process:
                print("没有找到需要处理的已结束合同。")
                return

            total = len(contracts_to_process)
            processed_count = 0
            print(f"找到 {total} 个已结束的合同需要检查。")

            for i, contract in enumerate(contracts_to_process):
                print(f"[{i+1}/{total}] 正在检查合同 ID: {contract.id} | 客户: {contract.customer_name} ...", end='')
                
                last_bill = CustomerBill.query.filter_by(
                    contract_id=contract.id, 
                    is_substitute_bill=False
                ).order_by(CustomerBill.cycle_end_date.desc()).first()

                if not last_bill:
                    print(" -> 跳过 (无有效账单)")
                    continue

                # 修正: 按类型检查，而不是按描述
                existing_adj = FinancialAdjustment.query.filter_by(
                    customer_bill_id=last_bill.id,
                    adjustment_type=AdjustmentType.COMPANY_PAID_SALARY
                ).first()

                if existing_adj:
                    print(" -> 跳过 (调整项已存在)")
                    continue

                payroll = EmployeePayroll.query.filter_by(
                    contract_id=contract.id,
                    cycle_start_date=last_bill.cycle_start_date,
                    is_substitute_payroll=False
                ).first()

                if not payroll or not payroll.total_due or payroll.total_due <= 0:
                    print(" -> 跳过 (无有效薪酬或薪酬为0)")
                    continue

                try:
                    # 新增: 金额不能超过员工级别
                    employee_level = Decimal(contract.employee_level or '0')
                    amount_to_add = min(payroll.total_due, employee_level).quantize(Decimal("1"))

                    new_adj = FinancialAdjustment(
                        customer_bill_id=last_bill.id,
                        adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
                        amount=amount_to_add,
                        description="[系统] 公司代付员工工资",
                        date=last_bill.cycle_end_date.date()
                    )
                    db.session.add(new_adj)
                    
                    engine.calculate_for_month(
                        year=last_bill.year,
                        month=last_bill.month,
                        contract_id=contract.id,
                        force_recalculate=True,
                        cycle_start_date_override=last_bill.cycle_start_date
                    )
                    db.session.commit()
                    processed_count += 1
                    print(f" -> 成功添加调整项，金额: {payroll.total_due}")
                except Exception as e:
                    print(f" -> 失败: {e}")
                    db.session.rollback()

            print(f"\n--- 任务执行完毕 ---")
            print(f"共检查 {total} 个合同，成功为 {processed_count} 个账单添加了调整项。")

        except Exception as e:
            print(f"执行任务时发生严重错误: {e}")

    @app.cli.command("delete-salary-adjustments")
    @click.option('--dry-run', is_flag=True, help='只打印将要删除的条目，不实际执行删除操作。')
    @with_appcontext
    def delete_salary_adjustments_command(dry_run):
        """删除所有由系统自动添加的“公司代付工资”财务调整项，并重算相关账单。"""
        if not dry_run:
            print("---【警告】即将开始删除操作，此过程不可逆。---")
        else:
            print("---【演习模式】将查找并列出要删除的调整项，但不会实际操作数据库。---")
        
        try:
            adjustments_to_delete = FinancialAdjustment.query.filter_by(
                description="[系统] 公司代付员工工资"
            ).all()

            if not adjustments_to_delete:
                print("没有找到需要删除的“[系统] 公司代付员工工资”调整项。")
                return

            total = len(adjustments_to_delete)
            print(f"找到 {total} 条需要处理的调整项。")
            
            engine = BillingEngine()
            processed_count = 0

            for i, adj in enumerate(adjustments_to_delete):
                bill = adj.customer_bill
                if not bill:
                    print(f"[{i+1}/{total}] 调整项 ID: {adj.id} 缺少关联账单，跳过。")
                    continue

                print(f"[{i+1}/{total}] 准备处理 账单ID: {bill.id} (合同: {bill.contract_id}) 的调整项 (ID: {adj.id})")

                if not dry_run:
                    try:
                        db.session.delete(adj)
                        
                        engine.calculate_for_month(
                            year=bill.year,
                            month=bill.month,
                            contract_id=bill.contract_id,
                            force_recalculate=True,
                            cycle_start_date_override=bill.cycle_start_date
                        )
                        db.session.commit()
                        processed_count += 1
                        print(f"  -> 成功删除调整项并重算账单。")
                    except Exception as e:
                        print(f"  -> 处理时发生错误: {e}")
                        db.session.rollback()
                else:
                    print(f"  -> [演习] 将删除此调整项并重算账单。")

            print("\n--- 任务执行完毕 ---")
            if not dry_run:
                print(f"共处理 {total} 条调整项，成功删除并重算了 {processed_count} 个账单。")
            else:
                print(f"演习结束，共发现 {total} 条可删除的调整项。")

        except Exception as e:
            print(f"执行删除任务时发生严重错误: {e}")
            if not dry_run:
                db.session.rollback()