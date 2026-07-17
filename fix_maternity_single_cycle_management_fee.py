#!/usr/bin/env python3
"""
已弃用：请改用 fix_maternity_last_bill_settlement.py

原「末期管理费为0」规则已撤销。月嫂每期（含末期）均收取本次交管理费：
  (客交保证金 - 月薪) / 26 * 劳务天数

本脚本保留为兼容入口，实际转发到新脚本。
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))


def main():
    print(
        "注意: fix_maternity_single_cycle_management_fee.py 已弃用。\n"
        "请使用: fix_maternity_last_bill_settlement.py [--dry-run] [--contract-id UUID]\n"
        "正在转发...\n"
    )
    # 复用新脚本
    from fix_maternity_last_bill_settlement import run

    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--contract-id", type=str, default=None)
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run, contract_id=args.contract_id, only_issues=not args.all)


if __name__ == "__main__":
    main()
