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
            
            print(f"找到 {total_bills} 个账单需要检查ảng")

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
                print(f"共检查 {total_bills} 个账单，更新了 {updated_count} 个账单的实收总额ảng")
            else:
                print("\n--- 检查完成 ---")
                print("所有账单的实收总额都已是最新，无需修复ảng")

        except Exception as e:
            db.session.rollback()
            print(f"执行修复任务时发生严重错误: {e}")

    @app.cli.command("recalc-bills")
    @click.option("--year", type=int, help="要计算的年份 (例如: 2025)。与 --month 一同使用。")
    @click.option("--month", type=int, help="要计算的月份 (例如: 8)。与 --year 一同使用。")
    @click.option("--contract-id", type=str, help="要单独重算账单的合同ID。可与 --year/--month 结合使用。")
    @with_appcontext
    def recalc_bills_command(year, month, contract_id):
        """
        强制重新计算账单。

        - 提供 --year 和 --month: 重算该月份所有有效合同的账单。
        - 提供 --contract-id: 重算该合同整个生命周期的所有账单。
        - 提供 --contract-id, --year, --month: 只重算该合同在该月份的账单。
        """
        engine = BillingEngine()

        if contract_id:
            if year and month:
                # --- 场景1: 重算指定合同在指定月份的账单 ---
                print(f"--- 开始为合同 {contract_id} 强制重算 {year}年{month}月 的账单 ---")
                try:
                    engine.calculate_for_month(
                        year=year,
                        month=month,
                        contract_id=contract_id,
                        force_recalculate=True
                    )
                    db.session.commit()
                    print("--- 重算完毕 ---")
                except Exception as e:
                    print(f"  -> 处理合同时发生错误: {e}")
                    db.session.rollback()
            else:
                # --- 场景2: 重算指定合同的全生命周期账单 ---
                print(f"--- 开始为合同 {contract_id} 强制重算其所有历史账单 ---")
                try:
                    engine.recalculate_all_bills_for_contract(contract_id=contract_id)
                    db.session.commit()
                    print("--- 全生命周期重算完毕 ---")
                except Exception as e:
                    print(f"  -> 处理合同时发生错误: {e}")
                    db.session.rollback()
        elif year and month:
            # --- 场景3: 重算某月份的所有合同 (保留原逻辑) ---
            print(f"--- 开始强制重算 {year}年{month}月 的所有账单 ---")
            try:
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
                        engine.calculate_for_month(
                            year=year,
                            month=month,
                            contract_id=contract.id,
                            force_recalculate=True
                        )
                        db.session.commit()
                    except Exception as e:
                        print(f"  -> 处理合同 {contract.id} 时发生错误: {e}")
                        db.session.rollback()
                print(f"--- {year}年{month}月 的账单重算任务执行完毕 ---")
            except Exception as e:
                print(f"执行重算任务时发生严重错误: {e}")
        else:
            print("错误: 请提供 --year 和 --month 参数，或提供 --contract-id 参数。")
            print("请使用 'flask recalc-bills --help' 查看帮助。")


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
                print("没有找到需要处理的合同ảng")
                return

            total = len(contracts_to_process)
            print(f"找到 {total} 个合同需要进行全生命周期重算ảng")

            for i, contract in enumerate(contracts_to_process):
                print(f"[{i+1}/{total}] 正在处理合同 ID: {contract.id} | 客户: {contract.customer_name} ...")
                try:
                    # --- 修改下面这一行 ---
                    # 旧代码: engine.generate_all_bills_for_contract(...)
                    # 新代码:
                    engine.recalculate_all_bills_for_contract(contract_id=contract.id)
                    # --- 修改结束 ---

                    db.session.commit()
                    print(f"  -> 合同 {contract.id} 处理完毕ảng")
                except Exception as e:
                    print(f"  -> 处理合同 {contract.id} 时发生错误: {e}")
                    db.session.rollback()

        except Exception as e:
            print(f"执行重算任务时发生严重错误: {e}")

    @app.cli.command("add-salary-adjustments")
    @with_appcontext
    def add_salary_adjustments_command():
        """为所有已结束合同的最后一个月账单，追溯添加“公司代付工资”及镜像调整项。"""
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

                # 直接调用新的、职责单一的函数来处理
                try:
                    engine.create_final_salary_adjustments(last_bill.id)
                    db.session.commit()
                    processed_count += 1
                    print(f" -> 已处理并触发重算。")

                except Exception as e:
                    print(f" -> 失败: {e}")
                    db.session.rollback()

            print(f"\\n--- 任务执行完毕 ---")
            print(f"共检查 {total} 个合同，成功为 {processed_count} 个账单处理了最终调整项。")

        except Exception as e:
            print(f"执行任务时发生严重错误: {e}")
            

    @app.cli.command("delete-salary-adjustments")
    @click.option('--dry-run', is_flag=True, help='只打印将要删除的条目，不实际执行删除操作。')
    @with_appcontext
    def delete_salary_adjustments_command(dry_run):
        """删除所有由系统自动添加的“公司代付工资”及其镜像财务调整项，并重算相关账单。"""
        if not dry_run:
            print("---【警告】即将开始删除操作，此过程不可逆。---")
        else:
            print("---【演习模式】将查找并列出要删除的调整项，但不会实际操作数据库。---")

        try:
            adjustments_to_delete = FinancialAdjustment.query.filter_by(
                description="[系统] 公司代付工资"
            ).all()

            if not adjustments_to_delete:
                print("没有找到需要删除的“[系统] 公司代付工资”调整项。")
                return

            total = len(adjustments_to_delete)
            print(f"找到 {total} 条需要处理的主调整项。")

            engine = BillingEngine()
            processed_count = 0

            for i, adj in enumerate(adjustments_to_delete):
                bill = adj.customer_bill
                if not bill:
                    print(f"[{i+1}/{total}] 调整项 ID: {adj.id} 缺少关联账单，跳过。")
                    continue

                print(f"[{i+1}/{total}] 准备处理 账单ID: {bill.id} (合同: {bill.contract_id}) 的主调整项 (ID: {adj.id})")

                if not dry_run:
                    try:
                        # 同时删除镜像调整项
                        if adj.mirrored_adjustment:
                            print(f"  -> 同时删除镜像调整项 ID: {adj.mirrored_adjustment.id}")
                            db.session.delete(adj.mirrored_adjustment)

                        db.session.delete(adj)

                        # 重算会清理所有不一致的地方
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
                    if adj.mirrored_adjustment:
                        print(f"  -> [演习] 将删除此调整项及其镜像 (ID: {adj.mirrored_adjustment.id})并重算账单。")
                    else:
                        print(f"  -> [演习] 将删除此调整项并重算账单。")

            print(f"\\n--- 任务执行完毕 ---")
            if not dry_run:
                print(f"共处理 {total} 条主调整项，成功删除并重算了 {processed_count} 个账单。")
            else:
                print(f"演习结束，共发现 {total} 条可删除的主调整项。")

        except Exception as e:
            print(f"执行删除任务时发生严重错误: {e}")
            if not dry_run:
                db.session.rollback()

    @app.cli.command("fix-salary-adj-links")
    @click.option('--dry-run', is_flag=True, help='只打印将要执行的操作，不实际修改数据库。')
    @with_appcontext
    def fix_salary_adj_links_command(dry_run):
        """修复历史数据中错误关联到工资单的“公司代付工资”调整项。"""
        if dry_run:
            print("---【演习模式】将查找并列出需要修复的调整项，但不会实际操作数据库。---")
        else:
            print("--- 开始修复“公司代付工资”调整项的关联错误 ---")

        try:
            adjustments_to_fix = FinancialAdjustment.query.filter(
                FinancialAdjustment.adjustment_type == AdjustmentType.COMPANY_PAID_SALARY,
                FinancialAdjustment.employee_payroll_id.isnot(None)
            ).all()

            if not adjustments_to_fix:
                print("没有找到错误关联到工资单的“公司代付工资”调整项ảng")
                return

            print(f"找到 {len(adjustments_to_fix)} 个需要修复的调整项ảng")
            fixed_count = 0
            failed_count = 0

            for adj in adjustments_to_fix:
                payroll = adj.employee_payroll
                if not payroll:
                    print(f"  - [跳过] 调整项 ID {adj.id}: 找不到关联的工资单 {adj.employee_payroll_id}ảng")
                    continue

                correct_bill = CustomerBill.query.filter_by(
                    contract_id=payroll.contract_id,
                    cycle_start_date=payroll.cycle_start_date,
                    is_substitute_bill=payroll.is_substitute_payroll
                ).first()

                if correct_bill:
                    print(f"  - [准备修复] 调整项 ID {adj.id}: 将从 Payroll ID {payroll.id} 转移到 Bill ID {correct_bill.id}ảng")
                    if not dry_run:
                        adj.customer_bill_id = correct_bill.id
                        adj.employee_payroll_id = None
                        db.session.add(adj)
                    fixed_count += 1
                else:
                    failed_count += 1
                    print(f"  - [失败] 调整项 ID {adj.id}: 找不到与工资单 {payroll.id} 匹配的客户账单ảng")

            if not dry_run:
                if fixed_count > 0:
                    db.session.commit()
                    print(f"--- 成功修复 {fixed_count} 个调整项的关联。---")
                if failed_count > 0:
                    print(f"--- 有 {failed_count} 个调整项因找不到匹配的客户账单而修复失败。---")
            else:
                print(f"--- 演习结束。如果执行，将会修复 {fixed_count} 个调整项ảng")

        except Exception as e:
            if not dry_run:
                db.session.rollback()
            print(f"执行修复任务时发生严重错误: {e}")
