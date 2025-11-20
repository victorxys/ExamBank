#!/usr/bin/env python3
"""
将历史合同关联到最新的合同模板。

使用方法:
    # 试运行，只打印将要进行的修改，不实际写入数据库
    python scripts/backfill_contract_templates.py --dry-run

    # 正式执行
    python scripts/backfill_contract_templates.py
"""
import os
import sys
import argparse
from sqlalchemy import func

# 将项目根目录添加到 Python 路径
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.app import app
from backend.models import db, BaseContract, ContractTemplate

def backfill_templates(dry_run=False):
    """
    遍历历史合同，将它们关联到最新的合同模板。
    """
    with app.app_context():
        print("=" * 70)
        print("开始执行历史合同与最新模板的关联脚本")
        print(f"模式: {'试运行 (Dry Run)' if dry_run else '正式执行'}")
        print("=" * 70)

        # 1. 高效地获取每种合同类型的最新模板。
        #    使用 DISTINCT ON 确保每个类型只返回最新的一条记录。
        #    排序逻辑: 首先按版本号降序，然后按更新时间降序。
        latest_templates_query = db.session.query(ContractTemplate).distinct(
            ContractTemplate.contract_type
        ).order_by(
            ContractTemplate.contract_type,
            ContractTemplate.version.desc(),
            ContractTemplate.updated_at.desc()
        )
        
        latest_templates_list = latest_templates_query.all()
        
        #    将最新模板存入字典以便快速查找
        templates_map = {template.contract_type: template for template in latest_templates_list}

        if not templates_map:
            print("错误：数据库中未找到任何合同模板。无法继续。")
            return 1

        print("\n[INFO] 已加载的最新模板版本:")
        for t_type, template in templates_map.items():
            print(f"  - 类型: {t_type:<20} | 版本: {template.version:<5} | 模板ID: {template.id}")
        
        # 2. 查找所有未关联模板的合同
        contracts_to_update = BaseContract.query.filter(BaseContract.template_id.is_(None)).all()

        if not contracts_to_update:
            print("\n[INFO] 所有合同都已关联模板，无需操作。")
            return 0
            
        print(f"\n[INFO] 找到 {len(contracts_to_update)} 个需要更新的合同。开始处理...")
        print("-" * 70)

        updated_count = 0
        failed_count = 0

        for contract in contracts_to_update:
            contract_type = contract.type
            
            # 3. 从字典中查找匹配的模板
            matched_template = templates_map.get(contract_type)

            if matched_template:
                print(f"[处理] 合同 ID: {contract.id} (类型: {contract_type})")
                print(f"  └─ 匹配到模板 ID: {matched_template.id} (版本: {matched_template.version})")
                
                # 4. 如果不是试运行，则更新记录
                if not dry_run:
                    contract.template_id = matched_template.id
                
                updated_count += 1
            else:
                print(f"[失败] 合同 ID: {contract.id} (类型: {contract_type})")
                print(f"  └─ 警告: 未能找到类型为 '{contract_type}' 的任何合同模板。")
                failed_count += 1
        
        # 5. 如果不是试运行，提交数据库事务
        if not dry_run:
            try:
                print("\n[执行] 正在提交数据库更改...")
                db.session.commit()
                print("[成功] 数据库更新已成功提交。")
            except Exception as e:
                print(f"\n[错误] 数据库提交失败: {e}")
                print("[回滚] 正在回滚所有更改...")
                db.session.rollback()
                return 1
        
        print("\n" + "=" * 70)
        print("脚本执行完毕")
        print("=" * 70)
        print(f"总共处理合同: {len(contracts_to_update)}")
        print(f"  成功匹配 (将会/已经更新): {updated_count}")
        print(f"  匹配失败 (未找到模板): {failed_count}")
        
        if dry_run:
            print("\n[注意] 这是试运行，未对数据库做任何实际修改。")
            print("       要应用更改，请移除 --dry-run 参数后重新运行。")

        return 0

if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='将历史合同关联到其对应类型的最新版本模板。',
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='试运行模式。脚本将执行所有检查和匹配逻辑，但不会向数据库写入任何更改。\n' 
             '建议在正式执行前先使用此模式进行检查。'
    )
    
    args = parser.parse_args()
    
    exit_code = backfill_templates(dry_run=args.dry_run)
    sys.exit(exit_code)
