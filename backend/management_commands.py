# backend/management_commands.py

import click
from flask.cli import with_appcontext
from backend.services.billing_engine import BillingEngine
from backend.models import BaseContract, db

def register_commands(app):
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

            print(f"--- 所有合同的全生命周期账单重算任务执行完毕 ---")

        except Exception as e:
            print(f"执行重算任务时发生严重错误: {e}")