# backend/management_commands.py

import click
from flask.cli import with_appcontext
from backend.services.billing_engine import BillingEngine, _update_bill_payment_status
from backend.models import BaseContract, db, CustomerBill, PaymentRecord,FinancialAdjustment,EmployeePayroll, AdjustmentType, User,Customer, ServicePersonnel,EmployeeSalaryHistory,NannyTrialContract,SigningStatus,NannyContract,MaternityNurseContract, ContractTemplate, ContractSignature
from backend.services.signature_service import SignatureService
from sqlalchemy import func
from decimal import Decimal
import logging
from pypinyin import pinyin, Style
from backend.services.data_sync_service import DataSyncService
from backend.services.contract_service import ContractService
import base64
import os
import httpx
from urllib.parse import urlparse
from flask import current_app
import uuid

logger = logging.getLogger(__name__)
# --- START: Sync functions (only sync_user_to_sp remains) ---
def sync_user_to_sp(session, dry_run=True):
    """
    Synchronizes records from User (with role='student') to ServicePersonnel.
    - If a 'student' user has no linked SP, it tries to find one by id_card_number, then phone_number, then name.
    - If found, it links them.
    - If not found, it creates a new ServicePersonnel.
    - It also syncs id_card_number from User to SP if the SP's is empty.
    """
    click.echo("\n--- Syncing from User (role='student') to ServicePersonnel ---")
    # 核心修正：查询所有 'student' 用户，以确保能更新已存在但数据不完整的记录
    users_to_sync = session.query(User).filter(User.role == 'student').all()

    if not users_to_sync:
        click.echo("  -> OK: No 'student' Users found to process.")
        return

    click.echo(f"  Found {len(users_to_sync)} 'student' Users to process.")

    for user in users_to_sync:
        click.echo(f"\n  Processing User: {user.username} (ID: {user.id})")
        
        # 优先通过已建立的 backref 关系查找
        sp = user.service_personnel_profile
        if sp:
            click.echo(f"    - Found linked ServicePersonnel via relationship: {sp.name} (ID: {sp.id})")
        else:
            # 如果没有直接关联，再通过其他字段查找
            if user.id_card_number:
                sp = session.query(ServicePersonnel).filter(ServicePersonnel.id_card_number == user.id_card_number).first()
                if sp:
                    click.echo(f"    - Found matching ServicePersonnel by ID card number: {sp.name} (ID: {sp.id})")
            if not sp and user.phone_number:
                sp = session.query(ServicePersonnel).filter(ServicePersonnel.phone_number == user.phone_number).first()
                if sp:
                    click.echo(f"    - Found matching ServicePersonnel by phone number: {sp.name} (ID: {sp.id})")
            if not sp and user.username:
                sp = session.query(ServicePersonnel).filter(ServicePersonnel.name == user.username).first()
                if sp:
                    click.echo(f"    - Found matching ServicePersonnel by name: {sp.name} (ID: {sp.id })")

        is_active = (user.status == 'active')

        if sp:
            # --- 更新逻辑 ---
            if sp.user_id is None:
                click.echo(f"    - ACTION: Will link ServicePersonnel {sp.id} to User {user.id}." )
                if not dry_run:
                    sp.user_id = user.id
            # elif str(sp.user_id) != str(user.id):
            #     # click.echo(f"    - WARNING: ServicePersonnel {sp.id} is already linked to a DIFFERENT User ({sp.user_id}). Manual check required. Skipping link.")
            # else:
            #     # click.echo(f"    - INFO: ServicePersonnel {sp.id} is already correctly linked to User {user.id}.")

            if user.id_card_number and not sp.id_card_number:
                click.echo(f"    - ACTION: Will update ServicePersonnel {sp.id}'s id_card_number to '{user.id_card_number}'.")
                if not dry_run:
                    sp.id_card_number = user.id_card_number
            
            if user.phone_number and not sp.phone_number:
                click.echo(f"    - ACTION: Will update ServicePersonnel {sp.id}'s phone_number to '{user.phone_number}'.")
                if not dry_run:
                    sp.phone_number = user.phone_number
            
            if user.name_pinyin and not sp.name_pinyin:
                click.echo(f"    - ACTION: Will update ServicePersonnel {sp.id}'s name_pinyin to '{user.name_pinyin}'.")
                if not dry_run:
                    sp.name_pinyin = user.name_pinyin

            if sp.is_active != is_active:
                click.echo(f"    - ACTION: Will update ServicePersonnel {sp.id}'s is_active status to '{is_active}'.")
                if not dry_run:
                    sp.is_active = is_active
            
            if not dry_run:
                session.add(sp)

        else:
            # --- 创建逻辑 ---
            click.echo(f"    - No matching ServicePersonnel found for '{user.username}'.")
            click.echo(f"    - ACTION: Will create a new ServicePersonnel record.")
            if not dry_run:
                new_sp = ServicePersonnel(
                    name=user.username,
                    phone_number=user.phone_number,
                    id_card_number=user.id_card_number,
                    user_id=user.id,
                    name_pinyin=user.name_pinyin,
                    is_active=is_active
                )
                session.add(new_sp)
                click.echo(f"      - Created ServicePersonnel {new_sp.name} and linked to User {user.id}.")

def register_commands(app):

    @app.cli.command("backfill-salary-history")
    @click.option('--dry-run', is_flag=True, help='只打印将要执行的操作，不实际修改数据库。')
    @with_appcontext
    def backfill_salary_history_command(dry_run):
        """
        遍历所有合同，为缺少薪酬历史记录的合同补充记录。
        此工具会自动跳过试工合同。
        """
        if dry_run:
            click.echo("---【演习模式】将查找并列出需要创建或更新的薪酬记录。---")
        else:
            click.echo("--- 开始回填历史合同的薪酬记录 ---")

        try:
            contract_service = ContractService()
            
            from sqlalchemy import cast, Numeric
            contracts_to_process = BaseContract.query.filter(
                BaseContract.service_personnel_id.isnot(None),
                BaseContract.employee_level.isnot(None),
                cast(BaseContract.employee_level, Numeric) > 0
            ).order_by(BaseContract.start_date.asc()).all()

            if not contracts_to_process:
                click.echo("没有找到需要处理的合同。")
                return

            click.echo(f"找到 {len(contracts_to_process)} 份有员工和薪酬的合同需要检查。")
            
            created_count = 0
            updated_count = 0
            skipped_count = 0

            with click.progressbar(contracts_to_process, label="正在检查合同") as bar:
                for contract in bar:
                    if contract.type == 'nanny_trial':
                        skipped_count += 1
                        continue

                    existing_history = EmployeeSalaryHistory.query.filter_by(
                        employee_id=contract.service_personnel_id,
                        contract_id=contract.id
                    ).first()

                    contract_salary = Decimal(contract.employee_level)

                    if existing_history:
                        if existing_history.base_salary != contract_salary:
                            click.echo(f"\\n  - [准备更新] 合同ID {contract.id}: 薪酬不匹配。"
                                       f"历史记录: {existing_history.base_salary}, 合同记录: {contract_salary}")
                            if not dry_run:
                                salary_data = {"base_salary": contract_salary}
                                # --- 核心修复：将ID转换为字符串 ---
                                contract_service.update_employee_salary_history(
                                    str(contract.service_personnel_id), str(contract.id), salary_data
                                )
                            updated_count += 1
                        else:
                            skipped_count += 1
                    else:
                        click.echo(f"\\n  - [准备创建] 合同ID {contract.id}: 未找到薪酬历史记录。"
                                   f"将使用薪酬 {contract_salary} 创建。")
                        if not dry_run:
                            salary_data = {"base_salary": contract_salary}
                            # --- 核心修复：将ID转换为字符串 ---
                            contract_service.update_employee_salary_history(
                                str(contract.service_personnel_id), str(contract.id), salary_data
                            )
                        created_count += 1
            
            if not dry_run and (created_count > 0 or updated_count > 0):
                db.session.commit()
                click.echo(click.style("\\n数据库变更已成功提交！", fg="green"))

            click.echo("\\n--- 回填任务报告 ---")
            click.echo(f"总共检查合同: {len(contracts_to_process)}")
            click.echo(click.style(f"创建新记录: {created_count}", fg="cyan"))
            click.echo(click.style(f"更新现有记录: {updated_count}", fg="yellow"))
            click.echo(f"无需操作或跳过: {skipped_count}")
            if dry_run:
                click.echo(click.style("\\n【演习模式】未对数据库做任何实际修改。", fg="yellow" ))

        except Exception as e:
            if not dry_run:
                db.session.rollback()
            click.echo(click.style(f"\\n执行任务时发生严重错误: {e}", fg="red"))
            logger.exception("Error during backfill-salary-history task:")

    @app.cli.command("clean-salary-history")
    @click.option('--dry-run', is_flag=True, help='只打印将要删除的条目，不实际执行删除操作。')
    @with_appcontext
    def clean_salary_history_command(dry_run):
        """
        清理薪酬历史中员工与合同不匹配的错误记录。
        """
        if dry_run:
            click.echo("---【演习模式】将查找并列出因员工与合同不匹配而需要删除的薪酬记录。---")
        else:
            click.echo("---【警告】即将开始清理错误的薪酬记录，此过程不可逆。---")

        try:
            all_salary_records = EmployeeSalaryHistory.query.options(
                db.joinedload(EmployeeSalaryHistory.contract)
            ).all()

            if not all_salary_records:
                click.echo("薪酬历史表为空，无需清理。")
                return

            click.echo(f"开始检查 {len(all_salary_records)} 条薪酬历史记录...")
            records_to_delete = []

            with click.progressbar(all_salary_records, label="正在检查记录") as bar:
                for record in bar:
                    if not record.contract:
                        click.echo(f"\\n[警告] 记录 {record.id} 关联的合同 {record.contract_id} 不存在，建议手动核查。")
                        continue

                    # 核心检查：薪酬记录的员工ID是否与关联合同上的员工ID匹配
                    if record.contract.service_personnel_id and str(record.employee_id) != str(record.contract.service_personnel_id):
                        records_to_delete.append(record)

            if not records_to_delete:
                click.echo(click.style("\\n检查完成，未发现员工与合同不匹配的错误记录。", fg="green"))
                return

            click.echo(f"\\n发现 {len(records_to_delete)} 条错误记录需要删除。")
            for record in records_to_delete:
                click.echo(
                    f"  - [删除] 记录ID: {record.id} | "
                    f"员工ID: {record.employee_id} | "
                    f"合同ID: {record.contract_id} (该合同属于员工 {record.contract.service_personnel_id})"
                )
                if not dry_run:
                    db.session.delete(record)
            
            if not dry_run and len(records_to_delete) > 0:
                db.session.commit()
                click.echo(click.style(f"\\n--- 清理完成 ---", fg="green"))
                click.echo(click.style(f"成功删除了 {len(records_to_delete)} 条错误记录。", fg="green"))
            elif dry_run:
                click.echo(f"\\n--- 演习结束 ---")
                click.echo(f"如果执行，将会删除 {len(records_to_delete)} 条错误记录。")
            else:
                click.echo("\\n没有需要删除的记录。")

        except Exception as e:
            if not dry_run:
                db.session.rollback()
            click.echo(click.style(f"执行清理任务时发生严重错误: {e}", fg="red"))
    @app.cli.command("populate-pinyin")
    @with_appcontext
    def populate_pinyin_command():
        """
        Backfills the name_pinyin field for existing Customers and ServicePersonnel.
        """
        click.echo("Starting to backfill name_pinyin for existing records...")

        models_to_process = [Customer, ServicePersonnel]
        total_updated = 0

        for model in models_to_process:
            model_name = model.__name__
            click.echo(f"Processing model: {model_name}")
            
            records_to_update = model.query.filter(model.name_pinyin.is_(None)).all()
            
            if not records_to_update:
                click.echo(f"  -> No records in {model_name} need updating.")
                continue

            with click.progressbar(records_to_update, label=f"Updating {model_name} records") as bar:
                for record in bar:
                    if record.name:
                        try:
                            pinyin_full = "".join(p[0] for p in pinyin(record.name, style=Style.NORMAL))
                            pinyin_initials = "".join(p[0] for p in pinyin(record.name, style=Style.FIRST_LETTER))
                            record.name_pinyin = f"{pinyin_full} {pinyin_initials}"
                            db.session.add(record)
                            total_updated += 1
                        except Exception as e:
                            logger.error(f"Could not generate pinyin for {model_name} ID {record.id} ({record.name}): {e}")
        
        if total_updated > 0:
            try:
                db.session.commit()
                click.echo(click.style(f"\\nSuccessfully updated {total_updated} records.", fg="green"))
            except Exception as e:
                db.session.rollback()
                click.echo(click.style(f"\\nError committing changes: {e}", fg="red"))
        else:
            click.echo("\\nNo records were updated.")

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
            print("---【演习模式】将查找并列出需要修复的调整项，但不会实际操作数据库。--- ")
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

    @app.cli.command("import-users-from-jinshuju")
    @with_appcontext
    def import_users_from_jinshuju():
        """
        Fetches all contract entries from Jinshuju and populates/updates
        customer and employee information in the local database.
        """
        click.echo("Starting user import process from Jinshuju...")

        try:
            importer = UserImporter()
            importer.run()
            click.echo(click.style("User import process completed successfully!", fg="green"))
        except Exception as e:
            logger.error(f"An error occurred during the import process: {e}", exc_info=True)
            click.echo(click.style(f"Error: {e}", fg="red"))
    
     # --- START: sync-users command ---
    @app.cli.command("sync-users")
    @click.option('--commit', is_flag=True, help='实际执行数据库修改，而不是只进行演习。')
    @with_appcontext
    def sync_users_command(commit):
        """
        同步 User 和 ServicePersonnel 表的数据，确保员工信息一致。
        目前只将 User 表中的员工数据同步到 ServicePersonnel 表中。
        默认只进行演习，不修改数据库。使用 --commit 实际执行。
        """
        session = db.session
        dry_run = not commit
        
        if dry_run:
            click.echo("--- 运行在【演习模式】。不会对数据库进行任何修改。 ---")
        else:
            click.echo("--- 运行在【提交模式】。数据库修改将会被执行。 ---")

        try:
            # 只从 User 同步到 ServicePersonnel
            sync_user_to_sp(session, dry_run)

            if not dry_run:
                click.echo("\n正在提交修改...")
                session.commit()
                click.echo(click.style("修改已成功提交。", fg="green"))
            else:
                click.echo("\n演习完成。未进行任何数据库修改。")
                
        except Exception as e:
            click.echo(click.style(f"\n发生错误: {e}", fg="red"))
            if not dry_run:
                click.echo("正在回滚修改...")
            logger.exception("Error during user/service personnel sync:")
        finally:
            session.close()
    # --- END: sync-users command ---
    @app.cli.command("fix-trial-contract-ids")
    @click.option('--dry-run', is_flag=True, help='只打印将要执行的操作，不实际修改数据库。')
    @with_appcontext
    def fix_trial_contract_ids_command(dry_run):
        """
        修复历史的“育儿嫂试工合同”中，错误地使用了 serial_number 作为 jinshuju_entry_id 的问题。
        此脚本会从金数据获取正确的值 (field_1) 并更新数据库。
        """
        if dry_run:
            click.echo( "---【演习模式】将查找并列出需要修正的育儿嫂试工合同ID，但不会实际操作数据库。---")
        else:
            click.echo("---【警告】即将开始修正育儿嫂试工合同的 `jinshuju_entry_id`，此过程不可逆。---")

        try:
            # 1. 初始化服务并获取金数据记录
            click.echo("正在从金数据获取 '育儿嫂试工' (o8CFxx) 表单的所有记录...")
            sync_service = DataSyncService()
            form_token = "o8CFxx"
            all_entries = sync_service.get_form_entries(form_token)
            
            if not all_entries:
                click.echo(click.style("从金数据获取记录为0，无法继续执行。", fg="yellow"))
                return

            click.echo(f"成功获取 {len(all_entries)} 条金数据记录。")

            # 2. 创建从 serial_number 到 field_1 的映射
            id_map = {
                str(entry.get("serial_number")): str(entry.get("field_1"))
                for entry in all_entries
                if entry.get("serial_number") and entry.get("field_1")
            }
            
            if not id_map:
                click.echo(click.style("未能成功创建 serial_number -> field_1 的映射，请检查金数据记录。", fg="red"))
                return

            # 3. 查询数据库中所有需要修正的合同
            click.echo("正在查询本地数据库中的育儿嫂试工合同...")
            contracts_to_fix = NannyTrialContract.query.filter (NannyTrialContract.jinshuju_entry_id.isnot(None)).all()

            if not contracts_to_fix:
                click.echo(click.style("数据库中没有找到需要修正的育儿嫂试工合同。", fg="green" ))
                return
            
            click.echo(f"找到 {len(contracts_to_fix)} 条本地合同记录需要检查。")

            updated_count = 0
            skipped_count = 0
            
            # 4. 遍历并修正
            with click.progressbar(contracts_to_fix, label="正在检查并修正合同") as bar:
                for contract in bar:
                    current_id = contract.jinshuju_entry_id
                    
                    # 如果当前ID在映射表的 "key" (serial_number) 中，说明它是错误的
                    if current_id in id_map:
                        correct_id = id_map[current_id]
                        
                        if current_id != correct_id:
                            click.echo(f"\\n  - [修正] 合同ID: {contract.id} | "
                                       f"旧 jinshuju_entry_id: {current_id} -> "
                                       f"新 jinshuju_entry_id: {correct_id}")
                            if not dry_run:
                                contract.jinshuju_entry_id = correct_id
                                db.session.add(contract)
                            updated_count += 1
                        else:
                            # --- 新增日志 ---
                            click.echo(f"\\n  - [跳过] 合同ID: {contract.id} | 原因: jinshuju_entry_id ('{current_id}') 已是正确的值。")
                            skipped_count += 1
                    else:
                        # --- 新增日志 ---
                        # 如果当前ID不在映射表的 "key" 中，它可能已经是正确的 field_1，或者是一条孤立的数据
                        click.echo(f"\\n  - [跳过] 合同ID: {contract.id} | 原因: 当前 jinshuju_entry_id ('{current_id}') 在金数据记录中未找到对应的 serial_number。可能是孤立数据或已是正确ID。")
                        skipped_count += 1

            # 5. 提交并报告
            if not dry_run and updated_count > 0:
                click.echo("\\n正在提交数据库变更...")
                db.session.commit()
                click.echo(click.style("数据库变更已成功提交！", fg="green"))
            

            
            click.echo("\n--- 修正任务报告 ---")
            click.echo(f"总共检查合同: {len(contracts_to_fix)}")
        except Exception as e:
            if not dry_run:
                db.session.rollback()
            click.echo(click.style(f"\n执行任务时发生严重错误: {e}", fg="red"))
            logger.exception("Error during fix-trial-contract-ids task:")
     
    @app.cli.command("align-trial-contract-serial-numbers")
    @click.option('--dry-run', is_flag=True, help='只打印将要执行的操作，不实际修改数据库。')
    @with_appcontext
    def align_trial_contract_serial_numbers_command(dry_run):
        """
        最终对齐“育儿嫂试工合同”的 jinshuju_entry_id。
        此脚本使用当前库中的 ID (应为 field_1 的值) 去正确的金数据表单 (sqcCWM) 中
        反向查找出真正的 serial_number，并更新到数据库。
        """
        if dry_run:
            click.echo( "---【演习模式】将查找并列出需要最终对齐的试工合同ID，但不会实际操作数据库。---")
        else:
            click.echo("---【警告】即将开始最终对齐试工合同的 `jinshuju_entry_id`，此过程不可逆。---")

        try:
            # 1. 从正确的表单 (sqcCWM) 获取所有记录
            click.echo("正在从正确的金数据表单 'sqcCWM' 获取所有记录...")
            sync_service = DataSyncService()
            correct_form_token = "sqcCWM"
            all_entries = sync_service.get_form_entries(correct_form_token)
            
            if not all_entries:
                click.echo(click.style("从金数据表单 'sqcCWM' 获取记录为0，无法继续执行。", fg= "red"))
                return

            click.echo(f"成功获取 {len(all_entries)} 条金数据记录。")

            # 2. 创建从 field_1 到 serial_number 的反向映射
            reverse_id_map = {
                str(entry.get("field_1")): str(entry.get("serial_number"))
                for entry in all_entries
                if entry.get("serial_number") and entry.get("field_1")
            }
            
            if not reverse_id_map:
                click.echo(click.style("未能成功创建 field_1 -> serial_number 的反向映射，请检查金数据记录。", fg="red"))
                return

            # 3. 查询数据库中所有需要对齐的合同
            click.echo("正在查询本地数据库中的育儿嫂试工合同...")

            contracts_to_align = NannyTrialContract.query.filter (NannyTrialContract.jinshuju_entry_id.isnot(None)).all()

            if not contracts_to_align:
                click.echo(click.style("数据库中没有找到需要对齐的育儿嫂试工合同。", fg="green" ))
                return
            
            click.echo(f"找到 {len(contracts_to_align)} 条本地合同记录需要检查。")

            updated_count = 0
            skipped_count = 0
            
            # 4. 遍历并对齐
            with click.progressbar(contracts_to_align, label="正在检查并对齐合同") as bar:
                for contract in bar:
                    current_field_1_val = contract.jinshuju_entry_id
                    
                    if current_field_1_val in reverse_id_map:
                        correct_serial_number = reverse_id_map[current_field_1_val]
                        
                        if current_field_1_val != correct_serial_number:
                            click.echo(f"\\n  - [对齐] 合同ID: {contract.id} | "
                                       f"当前 ID (field_1): {current_field_1_val} -> "
                                       f"最终 serial_number: {correct_serial_number}")
                            if not dry_run:
                                contract.jinshuju_entry_id = correct_serial_number
                                db.session.add(contract)
                            updated_count += 1
                        else:
                            click.echo(f"\\n  - [跳过] 合同ID: {contract.id} | 原因: 当前 ID (' {current_field_1_val}') 已是正确的 serial_number。")
                            skipped_count += 1
                    else:
                        click.echo(f"\\n  - [跳过] 合同ID: {contract.id} | 原因: 当前 ID (' {current_field_1_val}') 在 'sqcCWM' 表单中未找到对应的 field_1。可能是孤立数据。")
                        skipped_count += 1

            # 5. 提交并报告
            if not dry_run and updated_count > 0:
                click.echo("\\n正在提交数据库变更...")
                db.session.commit()
                click.echo(click.style("数据库变更已成功提交！", fg="green"))
            
            click.echo("\\n--- 对齐任务报告 ---")
            click.echo(f"总共检查合同: {len(contracts_to_align)}")
            click.echo(click.style(f"成功对齐合同: {updated_count}", fg="green"))
            click.echo(f"无需对齐或跳过: {skipped_count}")
            if dry_run and updated_count > 0:
                click.echo(click.style("\\n【演习模式】未对数据库做任何实际修改。", fg="yellow" ))

        except Exception as e:
            if not dry_run:
                db.session.rollback()
            click.echo(click.style(f"\\n执行任务时发生严重错误: {e}", fg="red"))
            logger.exception("Error during align-trial-contract-serial-numbers task:")

    def _update_signing_status(contract):
        """Helper function to update the signing status based on signature presence."""
        has_customer_sig = ContractSignature.query.filter_by(
            contract_id=contract.id, signature_type='customer'
        ).first() is not None
        has_employee_sig = ContractSignature.query.filter_by(
            contract_id=contract.id, signature_type='employee'
        ).first() is not None

        new_status = SigningStatus.UNSIGNED
        if has_customer_sig and has_employee_sig:
            new_status = SigningStatus.SIGNED
        elif has_customer_sig:
            new_status = SigningStatus.CUSTOMER_SIGNED
        elif has_employee_sig:
            new_status = SigningStatus.EMPLOYEE_SIGNED
        
        if contract.signing_status != new_status:
            contract.signing_status = new_status
            return True
        return False

    def _download_signature_content(signature_url):
        """Downloads a signature image and returns it as bytes."""
        if not signature_url:
            return None
        
        try:
            with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                response = client.get(signature_url)
                response.raise_for_status()
            
            return response.content

        except Exception as e:
            click.echo(f"\\n  - [错误] 下载签名失败 URL: {signature_url}, 错误: {e}")
            return None

    @app.cli.command("sync-signatures")
    @click.option('--dry-run', is_flag=True, help='只打印将要执行的操作，不实际修改数据库。')
    @with_appcontext
    def sync_signatures_command(dry_run):
        """从金数据同步育儿嫂、月嫂、试工合同的客户及员工签名，并更新签名状态。"""
        if dry_run:
            click.echo("---【演习模式】将查找并列出需要同步的签名，但不会实际操作数据库。---")
        else:
            click.echo("---【警告】即将开始同步签名信息，此过程会覆盖数据库中现有的签名。---")

        form_configs = [
            {
                "name": "育儿嫂合同", "form_token": "Iqltzj", "model": NannyContract,
                "customer_sig_field": "field_1_associated_field_16", "employee_sig_field": "field_13",
            },
            {
                "name": "月嫂合同", "form_token": "QlpHFA", "model": MaternityNurseContract,
                "customer_sig_field": "field_1_associated_field_15", "employee_sig_field": "field_10",
            },
            {
                "name": "育儿嫂试工合同", "form_token": "sqcCWM", "model": NannyTrialContract,
                "customer_sig_field": "field_1_associated_field_16", "employee_sig_field": "field_10",
            },
        ]

        sync_service = DataSyncService()
        total_updated_contracts = 0

        try:
            for config in form_configs:
                click.echo(f"\\n--- 开始处理: {config['name']} (Form: {config['form_token']}) ---")
                
                all_entries = sync_service.get_form_entries(config['form_token'])
                if not all_entries:
                    click.echo(click.style(f"  -> 从金数据获取记录为0，跳过此表单。", fg= "yellow"))
                    continue
                click.echo(f"  -> 成功获取 {len(all_entries)} 条金数据记录。")

                signature_map = {
                    str(entry.get("serial_number")): {
                        "customer_sig": entry.get(config["customer_sig_field"]),
                        "employee_sig": entry.get(config["employee_sig_field"]),
                    }
                    for entry in all_entries if entry.get("serial_number")
                }

                local_contracts = config['model'].query.filter(config['model' ].jinshuju_entry_id.isnot(None)).all()
                click.echo(f"  -> 找到 {len(local_contracts)} 条本地合同记录需要检查。")

                form_updated_count = 0
                with click.progressbar(local_contracts, label=f"检查 {config['name']}") as bar:
                    for contract in bar:
                        jinshuju_id = contract.jinshuju_entry_id
                        
                        if jinshuju_id in signature_map:
                            signatures = signature_map[jinshuju_id]
                            customer_sig_url = signatures.get("customer_sig")
                            employee_sig_url = signatures.get("employee_sig")

                            # 检查是否需要下载新签名 (如果URL存在，且DB中没有签名记录)
                            customer_sig_record = ContractSignature.query.filter_by(contract_id=contract.id, signature_type='customer').first()
                            employee_sig_record = ContractSignature.query.filter_by(contract_id=contract.id, signature_type='employee').first()

                            customer_sig_needs_download = customer_sig_url and not customer_sig_record
                            employee_sig_needs_download = employee_sig_url and not employee_sig_record
                            
                            original_status = contract.signing_status
                            _update_signing_status(contract)
                            status_needs_update = contract.signing_status != original_status
                            contract.signing_status = original_status

                            if not (customer_sig_needs_download or employee_sig_needs_download or status_needs_update):
                                continue

                            click.echo(f"\\n  - [更新] 合同ID: {contract.id} (Jinshuju ID: {jinshuju_id})")
                            form_updated_count += 1

                            if customer_sig_needs_download:
                                click.echo(f"    - 客户签名: 准备从金数据下载。")
                                if not dry_run:
                                    sig_content = _download_signature_content(customer_sig_url)
                                    if sig_content:
                                        sig_dir = os.path.join(current_app.root_path, 'static', 'signatures')
                                        os.makedirs(sig_dir, exist_ok=True)
                                        filename = f"contract_{contract.id}_customer_{uuid.uuid4()}.png"
                                        file_path = os.path.join(sig_dir, filename)
                                        with open(file_path, "wb") as f:
                                            f.write(sig_content)
                                        
                                        new_sig = ContractSignature(
                                            contract_id=contract.id,
                                            signature_type='customer',
                                            file_path=file_path,
                                            mime_type="image/png"
                                        )
                                        db.session.add(new_sig)
                                        click.echo(f"      -> 成功保存客户签名。")
                            
                            if employee_sig_needs_download:
                                click.echo(f"    - 员工签名: 准备从金数据下载。")
                                if not dry_run:
                                    sig_content = _download_signature_content(employee_sig_url)
                                    if sig_content:
                                        sig_dir = os.path.join(current_app.root_path, 'static', 'signatures')
                                        os.makedirs(sig_dir, exist_ok=True)
                                        filename = f"contract_{contract.id}_employee_{uuid.uuid4()}.png"
                                        file_path = os.path.join(sig_dir, filename)
                                        with open(file_path, "wb") as f:
                                            f.write(sig_content)
                                        
                                        new_sig = ContractSignature(
                                            contract_id=contract.id,
                                            signature_type='employee',
                                            file_path=file_path,
                                            mime_type="image/png"
                                        )
                                        db.session.add(new_sig)
                                        click.echo(f"      -> 成功保存员工签名。")

                            if _update_signing_status(contract):
                                 click.echo(f"    - 签名状态更新为: {contract.signing_status.value}")

                            if not dry_run:
                                db.session.add(contract)

                if form_updated_count > 0:
                    total_updated_contracts += form_updated_count
                    click.echo(f"\\n  -> {config['name']} 中有 {form_updated_count} 条记录已准备更新。")

            if not dry_run and total_updated_contracts > 0:
                click.echo("\\n正在提交所有数据库变更...")
                db.session.commit()
                click.echo(click.style("数据库变更已成功提交！", fg="green"))
            
            click.echo("\\n--- 签名同步任务报告 ---")
            click.echo(click.style(f"总共准备更新 {total_updated_contracts} 条合同记录的签名或状态。", fg="green"))
            if dry_run and total_updated_contracts > 0:
                click.echo(click.style("\\n【演习模式】未对数据库做任何实际修改。", fg= "yellow"))

        except Exception as e:
            if not dry_run:
                db.session.rollback()
            click.echo(click.style(f"\\n执行任务时发生严重错误: {e}", fg="red"))
            logger.exception("Error during sync-signatures task:")
    
    @app.cli.command("diagnose-duplicate-ids")
    @with_appcontext
    def diagnose_duplicate_ids_command():
        """
        诊断 'o8CFxx' 表单中是否存在重复的 field_1 值，这会导致 'fix-trial-contract-ids' 失败。
        """
        click.echo("--- 开始诊断金数据表单 'o8CFxx' 中的重复 field_1 值 ---")
        try:
            click.echo("正在从金数据获取 '育儿嫂试工' (o8CFxx) 表单的所有记录...")
            sync_service = DataSyncService()
            form_token = "o8CFxx"
            all_entries = sync_service.get_form_entries(form_token)
            
            if not all_entries:
                click.echo(click.style("从金数据获取记录为0，无法诊断。", fg="yellow"))
                return
            click.echo(f"成功获取 {len(all_entries)} 条金数据记录。")

            click.echo("正在分析数据以查找重复的 field_1 值...")
            field_1_to_serials = {}
            for entry in all_entries:
                field_1_val = entry.get("field_1")
                serial_num = entry.get("serial_number")
                if field_1_val and serial_num:
                    field_1_str = str(field_1_val)
                    if field_1_str not in field_1_to_serials:
                        field_1_to_serials[field_1_str] = []
                    field_1_to_serials[field_1_str].append(str(serial_num))
            
            duplicates = {k: v for k, v in field_1_to_serials.items() if len(v) > 1}

            if not duplicates:
                click.echo(click.style("\\n--- 诊断完成：未发现重复的 field_1 值。问题可能出在其他地方。 ---", fg="green"))
                return

            click.echo(click.style(f"\\n--- 诊断报告：发现 {len(duplicates)} 个重复的 field_1 值 ---", fg="red"))
            click.echo("以下是导致唯一性约束失败的重复数据：")
            
            for field_1_val, serial_nums in duplicates.items():
                click.echo(f"  - [重复] field_1 的值 '{field_1_val}' 被以下 {len(serial_nums)} 个不同的 serial_number 共享:")
                for sn in serial_nums:
                    click.echo(f"    -> serial_number: {sn}")
            
            click.echo("\\n请前往金数据后台，根据以上报告，检查并修正这些重复的记录。")

        except Exception as e:
            click.echo(click.style(f"\\n执行诊断时发生严重错误: {e}", fg="red"))
            logger.exception("Error during diagnose-duplicate-ids task:")
    # --- START: migrate-contract-links command ---
    @app.cli.command("migrate-contract-links")
    @click.option('--commit', is_flag=True, help='实际执行数据库修改，而不是只进行演习。')
    @with_appcontext
    def migrate_contract_links_command(commit):
        """
        将 BaseContract 表中旧的 user_id 关联迁移到新的 service_personnel_id。
        """
        session = db.session
        dry_run = not commit

        if dry_run:
            click.echo("--- 运行在【演习模式】。不会对数据库进行任何修改。 ---")
        else:
            click.echo("--- 运行在【提交模式】。数据库修改将会被执行。 ---")

        try:
            contracts_to_migrate = session.query(BaseContract).filter(
                BaseContract.service_personnel_id.is_(None),
                BaseContract.user_id.isnot(None)).options(db.joinedload(BaseContract.user).joinedload(User.service_personnel_profile)).all()

            if not contracts_to_migrate:
                click.echo(click.style("所有合同都已正确关联到 service_personnel_id，无需迁移。", fg="green"))
                return

            click.echo(f"发现 {len(contracts_to_migrate)} 份合同需要迁移关联...")
            migrated_count = 0
            failed_count = 0

            with click.progressbar(contracts_to_migrate, label="正在迁移合同") as bar:
                for contract in bar:
                    if contract.user and contract.user.service_personnel_profile:
                        if not dry_run:
                            contract.service_personnel_id = contract.user.service_personnel_profile.id
                        migrated_count += 1
                    else:
                        click.echo(f"\n  - [失败] 合同ID {contract.id}: 找不到对应的 ServicePersonnel 档案。")
                        failed_count += 1
            
            click.echo(f"\\n--- 迁移摘要 ---")
            click.echo(f"成功处理: {migrated_count} 份合同。")
            if failed_count > 0:
                click.echo(click.style(f"失败: {failed_count} 份合同 (请检查上述日志)。", fg= "red"))

            if not dry_run and migrated_count > 0:
                click.echo("\\n正在提交修改...")
                session.commit()
                click.echo(click.style("修改已成功提交。", fg="green"))
            elif dry_run:
                click.echo("\\n演习完成。未进行任何数据库修改。")

        except Exception as e:
            click.echo(click.style(f"\\n发生错误: {e}", fg="red"))
            if not dry_run:
                click.echo("正在回滚修改...")
            logger.exception("Error during contract link migration:")
        finally:
            session.close()
    # --- END: migrate-contract-links command ---

    @app.cli.command("associate-latest-contract-template")
    @click.option('--dry-run', is_flag=True, help='只打印将要执行的操作，不实际修改数据库。')
    @with_appcontext
    def associate_latest_contract_template_command(dry_run):
        """
        为缺少合同模板ID或内容的合同，根据合同类型关联最新的合同模板。
        """
        session = db.session
        
        if dry_run:
            click.echo("---【演习模式】将查找并列出需要关联最新合同模板的合同，但不会实际操作数据库。---")
        else:
            click.echo("---【警告】即将开始关联合同模板，此过程不可逆。---")

        try:
            # 1. 获取所有需要处理的合同
            contracts_to_process = session.query(BaseContract).filter(
                (BaseContract.template_id.is_(None))
            ).all()

            if not contracts_to_process:
                click.echo(click.style("没有找到需要关联合同模板的合同。", fg="green"))
                return

            click.echo(f"发现 {len(contracts_to_process)} 份合同需要处理...")

            # 2. 获取所有最新的合同模板
            all_templates = session.query(ContractTemplate).all()
            
            latest_templates = {}
            for template in all_templates:
                # Assuming 'version' is a numeric field for comparison
                if template.contract_type not in latest_templates or \
                   template.version > latest_templates[template.contract_type].version:
                    latest_templates[template.contract_type] = template
            
            updated_count = 0
            skipped_count = 0

            with click.progressbar(contracts_to_process, label="正在处理合同") as bar:
                for contract in bar:
                    contract_type = contract.type
                    
                    if contract_type in latest_templates:
                        latest_template = latest_templates[contract_type]
                        
                        click.echo(f"\n  - [处理] 合同ID: {contract.id} (类型: {contract_type})")
                        click.echo(f"    -> 找到最新模板: {latest_template.template_name} (ID: {latest_template.id}, 版本: {latest_template.version})")

                        if not dry_run:
                            contract.template_id = latest_template.id
                            session.add(contract)
                        updated_count += 1
                    else:
                        click.echo(f"\n  - [跳过] 合同ID: {contract.id} (类型: {contract_type}): 未找到对应的最新合同模板。")
                        skipped_count += 1
            
            click.echo(f"\\n--- 模板关联任务报告 ---")
            click.echo(f"总共检查合同: {len(contracts_to_process)}")
            click.echo(click.style(f"成功关联: {updated_count} 份合同。", fg="green"))
            click.echo(f"跳过: {skipped_count} 份合同。")

            if not dry_run and updated_count > 0:
                click.echo("\\n正在提交修改...")
                session.commit()
                click.echo(click.style("修改已成功提交。", fg="green"))
            elif dry_run:
                click.echo("\\n演习完成。未进行任何数据库修改。")

        except Exception as e:
            click.echo(click.style(f"\\n发生错误: {e}", fg="red"))
            if not dry_run:
                session.rollback()
            logger.exception("Error during associate-latest-contract-template task:")
        finally:
            session.close()

    @app.cli.command("migrate-employee-balance-transfer")
    @click.option('--dry-run', is_flag=True, help='只打印将要执行的操作,不实际修改数据库。')
    @with_appcontext
    def migrate_employee_balance_transfer_command(dry_run):
        """
        将历史数据中的"[冲抵]员工待付工资转移至续约合同"调整项类型
        从 EMPLOYEE_DECREASE 迁移到 EMPLOYEE_BALANCE_TRANSFER。
        """
        if dry_run:
            click.echo("---【演习模式】将查找并列出需要迁移的调整项,但不会实际操作数据库。---")
        else:
            click.echo("--- 开始迁移员工余额转移调整项 ---")

        try:
            # 查找所有描述匹配且类型为 EMPLOYEE_DECREASE 的调整项
            adjustments_to_migrate = FinancialAdjustment.query.filter(
                FinancialAdjustment.description == "[冲抵]员工待付工资转移至续约合同",
                FinancialAdjustment.adjustment_type == AdjustmentType.EMPLOYEE_DECREASE
            ).all()

            if not adjustments_to_migrate:
                click.echo("没有找到需要迁移的调整项。")
                return

            click.echo(f"找到 {len(adjustments_to_migrate)} 个需要迁移的调整项。")
            
            migrated_count = 0
            
            for adj in adjustments_to_migrate:
                click.echo(f"  - [准备迁移] 调整项 ID {adj.id} (账单/工资单日期: {adj.date})")
                if not dry_run:
                    adj.adjustment_type = AdjustmentType.EMPLOYEE_BALANCE_TRANSFER
                    db.session.add(adj)
                migrated_count += 1

            if not dry_run:
                if migrated_count > 0:
                    db.session.commit()
                    click.echo(click.style(f"\n成功迁移了 {migrated_count} 个调整项。", fg="green"))
            else:
                click.echo(f"\n--- 演习结束。如果执行,将会迁移 {migrated_count} 个调整项。---")

        except Exception as e:
            if not dry_run:
                db.session.rollback()
            click.echo(click.style(f"执行迁移任务时发生严重错误: {e}", fg="red"))

    app.cli.add_command(import_users_from_jinshuju)

class UserImporter:
    def __init__(self):
        self.sync_service = DataSyncService()
        self.contract_service = ContractService()
        self.form_configs = self._get_form_configs()
        self.stats = {'customers': {'created': 0, 'updated': 0, 'skipped': 0},
                      'employees': {'created': 0, 'updated': 0, 'skipped': 0},
                      'salary_records': {'skipped': 0}}

    def run(self):
        click.echo("Fetching entries from all configured forms...")
        BATCH_SIZE = 50  # Commit every 50 records

        for config in self.form_configs:
            form_token = config["form_token"]
            contract_type = config["contract_type"]
            mapping_rules = config["mapping"]

            click.echo(f"Processing form: {form_token} ({contract_type})")

            try:
                entries = self.sync_service.get_form_entries(form_token)
                click.echo(f"Found {len(entries)} entries.")

                with click.progressbar(entries, label="Processing entries") as bar:
                    for i, entry in enumerate(bar):
                        try:
                            self._process_entry(entry, mapping_rules)

                            # Commit in batches
                            if (i + 1) % BATCH_SIZE == 0:
                                db.session.commit()
                        except Exception as e:
                            db.session.rollback()
                            logger.error(f"Failed to process entry serial_number={entry.get( 'serial_number')}: {e}", exc_info=True)

                # Commit any remaining entries
                db.session.commit()
                click.echo(f"\\nForm {form_token} processing complete.")

            except Exception as e:
                db.session.rollback()
                logger.error(f"Fatal error processing form {form_token}: {e}", exc_info=True)
                click.echo(click.style(f"  -> Error processing form {form_token}: {e}", fg="red" ))

        click.echo("\\n--- Import Statistics ---")
        self._print_stats()


    def _process_entry(self, entry, mapping_rules):
        contract_data = {}
        contract_data['jinshuju_entry_id'] = entry.get('serial_number')

        for db_field, jinshuju_config in mapping_rules.items():
            jinshuju_field_id = jinshuju_config["field_id"]
            value = None
            if jinshuju_config.get("is_association"):
                associated_field_id = jinshuju_config["associated_field_id"]
                key_to_lookup = f'{jinshuju_field_id}_associated_{associated_field_id}'
                value = entry.get(key_to_lookup)
            else:
                value = entry.get(jinshuju_field_id)

            if isinstance(value, dict):
                if all(k in value for k in ["province", "city", "district", "street"]):
                    value = f"{value.get('province','')}{value.get('city','')}{value.get( 'district','')}{value.get('street','')}"
                else:
                    value = value.get("value")
            contract_data[db_field] = str(value) if value is not None else None

        # Process Customer
        self._get_or_create_person(
            name=contract_data.get("customer_name"),
            phone=contract_data.get("customer_phone"),
            id_card=contract_data.get("customer_id_card"),
            address=contract_data.get("customer_address"),
            role='customer'
        )

        # Process Employee
        employee = self._get_or_create_person(
            name=contract_data.get("employee_name"),
            phone=contract_data.get("employee_phone"),
            id_card=contract_data.get("employee_id_card"),
            address=contract_data.get("employee_address"),
            role='employee'
        )

        if employee:
            self._create_employee_salary_if_needed(employee, contract_data)

    def _get_or_create_person(self, name, phone, id_card, address, role):
        if not name or not name.strip():
            if role == 'customer': self.stats['customers']['skipped'] += 1
            else: self.stats['employees']['skipped'] += 1
            return None

        name = name.strip()
        phone = phone.strip() if phone else None
        id_card = id_card.strip() if id_card else None
        address = address.strip() if address else None

        Model = Customer if role == 'customer' else ServicePersonnel
        
        person = None
        # 1. 优先使用身份证号查找，这是最唯一的标识
        if id_card:
            person = Model.query.filter(Model.id_card_number == id_card).first()
        
        # 2. 如果找不到，再尝试使用手机号查找
        if not person and phone:
            person = Model.query.filter(Model.phone_number == phone).first()

        # 3. 作为最后的手段，才使用姓名查找（这可能是导致问题的根源）
        if not person and name:
            person = Model.query.filter(Model.name == name).first()


        if person:
            updated = False
            if not person.phone_number and phone:
                person.phone_number = phone
                updated = True
            if not person.id_card_number and id_card:
                person.id_card_number = id_card
                updated = True
            if not person.address and address:
                person.address = address
                updated = True
            if updated:
                self.stats[role + 's']['updated'] += 1
                db.session.add(person)
            return person
        else:
            try:
                pinyin_full = "".join(p[0] for p in pinyin(name, style=Style.NORMAL))
                pinyin_initials = "".join(p[0] for p in pinyin(name, style=Style.FIRST_LETTER))
                pinyin_str = f"{pinyin_full} {pinyin_initials}"
            except Exception:
                pinyin_str = None

            new_person = Model(
                name=name,
                phone_number=phone,
                id_card_number=id_card,
                address=address,
                name_pinyin=pinyin_str
            )
            self.stats[role + 's']['created'] += 1
            db.session.add(new_person)
            return new_person


    def _create_employee_salary_if_needed(self, employee, contract_data):
        jinshuju_id = contract_data.get('jinshuju_entry_id')
        
        contract = BaseContract.query.filter_by(jinshuju_entry_id=str(jinshuju_id)).first()

        if not contract:
            self.stats['salary_records']['skipped'] += 1
            logger.warning(f"Skipping salary history for Jinshuju entry {jinshuju_id} because contract was not found in DB.")
            return

        # --- THE FIX ---
        # Always use the salary from the contract object in our database as the source of truth.
        salary_str = contract.employee_level 
        if not salary_str:
            self.stats['salary_records']['skipped'] += 1
            logger.warning(f"Skipping salary history for contract {contract.id} because employee_level is not set in the database contract.")
            return
        # --- END FIX ---

        logger.info(f"--- [SALARY DEBUG] Processing contract_id: {contract.id} for employee_id: {employee.id} ---")
        logger.info(f"    -> Salary from Jinshuju source ('contract_data'): {contract_data.get('employee_level')}")
        logger.info(f"    -> Salary from DB contract object ('contract.employee_level'): {contract.employee_level}")
        logger.info(f"    -> FINAL salary to be used: {salary_str}")

        try:
            salary = Decimal(salary_str)
            salary_data = {"base_salary": salary}

            # Directly call the service function. All business logic (like skipping trial contracts) is handled there.
            self.contract_service.update_employee_salary_history(employee.id, contract.id, salary_data)

        except (ValueError, TypeError):
            logger.warning(f"Could not parse salary '{salary_str}' for contract {contract.id}. Skipping salary record.")
            self.stats['salary_records']['skipped'] += 1
        except Exception as e:
            logger.error(f"Failed to process salary history for contract {contract.id}: {e}", exc_info=True)
            self.stats['salary_records']['skipped'] += 1

    def _print_stats(self):
        click.echo(f"Customers: {self.stats['customers']['created']} created, {self.stats[ 'customers']['updated']} updated, {self.stats['customers']['skipped']} skipped.")
        click.echo(f"Employees: {self.stats['employees']['created']} created, {self.stats[ 'employees']['updated']} updated, {self.stats['employees']['skipped']} skipped.")
        click.echo(f"Salary Records: Attempts processed. Skipped due to missing data: {self.stats[ 'salary_records']['skipped']}.")

    def _get_form_configs(self):
        # This mapping should be identical to the one in tasks.py
        return [
            {
                "form_token": "Iqltzj",
                "contract_type": "nanny",
                "mapping": {
                    "customer_name": {"field_id": "field_1", "is_association": True, "associated_field_id": "field_2"},
                    "customer_phone": {"field_id": "field_1", "is_association": True, "associated_field_id": "field_3"},
                    "customer_id_card": {"field_id": "field_1", "is_association": True, "associated_field_id": "field_4"},
                    "customer_address": {"field_id": "field_1", "is_association": True, "associated_field_id": "field_5"},
                    "employee_name": {"field_id": "field_2"},
                    "employee_phone": {"field_id": "field_3"},
                    "employee_id_card": {"field_id": "field_4"},
                    "employee_address": {"field_id": "field_5"},
                    "employee_level": {"field_id": "field_9"},
                },
            },
            {
                "form_token": "QlpHFA",
                "contract_type": "maternity_nurse",
                "mapping": {
                    "customer_name": {"field_id": "field_1", "is_association": True, "associated_field_id": "field_2"},
                    "customer_phone": {"field_id": "field_1", "is_association": True, "associated_field_id": "field_3"},
                    "customer_id_card": {"field_id": "field_1", "is_association": True, "associated_field_id": "field_4"},
                    "customer_address": {"field_id": "field_1", "is_association": True, "associated_field_id": "field_5"},
                    "employee_name": {"field_id": "field_11"},
                    "employee_phone": {"field_id": "field_3"},
                    "employee_id_card": {"field_id": "field_4"},
                    "employee_address": {"field_id": "field_12"},
                    "employee_level": {"field_id": "field_7"},
                },
            },
            {
                "form_token": "o8CFxx",
                "contract_type": "nanny_trial",
                "mapping": {
                    "customer_name": {"field_id": "field_2"},
                    "customer_phone": {"field_id": "field_3"},
                    "customer_id_card": {"field_id": "field_4"},
                    "customer_address": {"field_id": "field_5"},
                    "employee_name": {"field_id": "field_7"},
                    "employee_phone": {"field_id": "field_8"},
                    "employee_id_card": {"field_id": "field_9"},
                    "employee_address": {"field_id": "field_10"},
                    "employee_level": {"field_id": "field_12"},
                },
            },
        ]