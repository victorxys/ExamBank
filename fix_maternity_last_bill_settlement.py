#!/usr/bin/env python3
"""
批量重算月嫂合同账单（与当前计费逻辑对齐）：

保留规则：
1. 每期均收「本次交管理费」（含末期）= (保证金-月薪)/26*天数
2. 末期在有可用客交保证金时自动生成「公司代付工资」+ 员工侧「保证金支付工资」
3. 定金计入客户应收；同月多期全部重算
4. 清理历史上误加的「保证金代付管理费」系统项

用法：
    python fix_maternity_last_bill_settlement.py --dry-run
    python fix_maternity_last_bill_settlement.py
    python fix_maternity_last_bill_settlement.py --contract-id <UUID>
"""

from __future__ import annotations

import argparse
import os
import sys
from decimal import Decimal as D

sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))
os.environ.setdefault("FLASK_APP", "backend.app")

from backend.app import app
from backend.extensions import db
from backend.models import (
    AdjustmentType,
    CustomerBill,
    FinancialAdjustment,
    MaternityNurseContract,
)
from backend.services.billing_engine import BillingEngine


def _d(v) -> D:
    return D(str(v or 0))


def _last_bill(contract_id: str):
    return (
        CustomerBill.query.filter_by(contract_id=contract_id, is_substitute_bill=False)
        .order_by(CustomerBill.cycle_end_date.desc())
        .first()
    )


def _first_bill(contract_id: str):
    return (
        CustomerBill.query.filter_by(contract_id=contract_id, is_substitute_bill=False)
        .order_by(CustomerBill.cycle_start_date.asc())
        .first()
    )


def diagnose_contract(engine: BillingEngine, contract: MaternityNurseContract) -> dict:
    """对照新规则，判断合同账单是否需要重算。"""
    bills = (
        CustomerBill.query.filter_by(contract_id=contract.id, is_substitute_bill=False)
        .order_by(CustomerBill.cycle_start_date.asc())
        .all()
    )
    if not bills:
        return {"needs_fix": False, "reasons": ["no_bills"], "bills": 0}

    reasons = []
    last = bills[-1]
    is_last = engine._is_last_maternity_nurse_cycle(
        contract, last.cycle_start_date, last.cycle_end_date
    )
    deposit_out = engine._is_security_deposit_transferred_out(last)
    can_pay = engine._has_customer_security_deposit_for_salary(contract, last)
    has_company_paid = (
        FinancialAdjustment.query.filter_by(
            customer_bill_id=last.id,
            adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
        ).count()
        > 0
    )
    mgmt = _d((last.calculation_details or {}).get("management_fee"))
    paid_sal = _d((last.calculation_details or {}).get("total_paid_salary_adjustments"))

    if is_last:
        if deposit_out and has_company_paid:
            reasons.append("末期保证金已转出但仍有代付工资")
        if can_pay and not has_company_paid and contract.status in (
            "active",
            "finished",
            "terminated",
            "pending",
        ):
            reasons.append("末期有可用保证金但缺少代付工资")
        if can_pay and has_company_paid and paid_sal == 0:
            company_rows = FinancialAdjustment.query.filter_by(
                customer_bill_id=last.id,
                adjustment_type=AdjustmentType.COMPANY_PAID_SALARY,
            ).all()
            company_amt = sum((_d(a.amount) for a in company_rows), D(0))
            if company_amt > 0:
                reasons.append("有代付工资但账单total未计入paid_sal")
        # 误加的保证金代付管理费
        if (
            FinancialAdjustment.query.filter(
                FinancialAdjustment.customer_bill_id == last.id,
                FinancialAdjustment.description == "[系统] 保证金代付管理费",
            ).count()
            > 0
        ):
            reasons.append("存在应清理的保证金代付管理费")
        # 末期本次交管理费应为按天公式（非 0，除非拆分为 0）
        level = _d(contract.employee_level)
        deposit = _d(contract.security_deposit_paid)
        days = _d((last.calculation_details or {}).get("base_work_days") or last.actual_work_days or 0)
        if days <= 0 and last.cycle_start_date and last.cycle_end_date:
            days = D(min((last.cycle_end_date.date() - last.cycle_start_date.date()).days
                         if hasattr(last.cycle_end_date, 'date') else (last.cycle_end_date - last.cycle_start_date).days, 26))
        expected_mgmt = ((deposit - level) / D(26) * days).quantize(D("0.01")) if deposit > level and days > 0 else D(0)
        if expected_mgmt > 0 and abs(mgmt - expected_mgmt) > D("0.05"):
            reasons.append(f"末期管理费不符(期望{expected_mgmt},实际{mgmt})")

    # 定金
    first = bills[0]
    dingjin = _d(getattr(contract, "deposit_amount", 0))
    if dingjin > 0:
        dep_adj = FinancialAdjustment.query.filter(
            FinancialAdjustment.customer_bill_id == first.id,
            FinancialAdjustment.adjustment_type == AdjustmentType.DEPOSIT,
        ).first()
        if dep_adj:
            inc = _d((first.calculation_details or {}).get("customer_increase"))
            sec = _d(contract.security_deposit_paid)
            if inc + D("0.5") < sec + dingjin:
                reasons.append("首期应收可能未计入定金")

    return {
        "needs_fix": bool(reasons),
        "reasons": reasons,
        "bills": len(bills),
        "last_total": str(last.total_due),
        "last_mgmt": str(mgmt),
        "deposit_out": deposit_out,
        "can_pay": can_pay,
        "has_company_paid": has_company_paid,
        "customer_name": contract.customer_name,
        "status": contract.status,
    }


def fix_contract(engine: BillingEngine, contract: MaternityNurseContract) -> None:
    engine.generate_all_bills_for_contract(str(contract.id), force_recalculate=True)


def run(dry_run: bool = True, contract_id: str | None = None, only_issues: bool = True):
    with app.app_context():
        engine = BillingEngine()
        q = MaternityNurseContract.query
        if contract_id:
            q = q.filter(MaternityNurseContract.id == contract_id)
        contracts = q.order_by(MaternityNurseContract.created_at.desc()).all()

        mode = "演习 DRY-RUN" if dry_run else "执行 EXECUTE"
        print(f"=== 月嫂账单结算批量矫正 [{mode}] ===")
        if contract_id:
            print(f"限定合同: {contract_id}")
        print(f"扫描合同数: {len(contracts)}\n")

        to_fix = []
        for c in contracts:
            info = diagnose_contract(engine, c)
            if only_issues and not info["needs_fix"]:
                continue
            if not only_issues and info.get("reasons") == ["no_bills"]:
                continue
            to_fix.append((c, info))

        if not to_fix and only_issues:
            print("未发现需要矫正的合同（或尚无账单）。")
            if contract_id:
                # 仍打印诊断
                c = MaternityNurseContract.query.get(contract_id)
                if c:
                    print("诊断:", diagnose_contract(engine, c))
            return

        print(f"将处理: {len(to_fix)} 份合同\n")
        fixed = 0
        failed = 0

        for c, info in to_fix:
            print(
                f"- {c.id} | {info.get('customer_name')} | {info.get('status')} | "
                f"bills={info.get('bills')} | last_total={info.get('last_total')} | "
                f"reasons={info.get('reasons')}"
            )
            if dry_run:
                fixed += 1
                continue
            try:
                before = {
                    "last_total": info.get("last_total"),
                    "has_company_paid": info.get("has_company_paid"),
                    "last_mgmt": info.get("last_mgmt"),
                }
                fix_contract(engine, c)
                db.session.commit()
                after = diagnose_contract(engine, c)
                last = _last_bill(str(c.id))
                print(
                    f"  [已重算] last_total {before['last_total']} -> {last.total_due if last else None}; "
                    f"仍有问题={after.get('reasons') or '无'}"
                )
                fixed += 1
            except Exception as exc:
                db.session.rollback()
                failed += 1
                print(f"  [失败] {exc}")

        print("\n--- 汇总 ---")
        print(f"{'将处理' if dry_run else '已处理'}: {fixed}")
        if not dry_run:
            print(f"失败: {failed}")
        if dry_run:
            print("\n演习模式未写库。确认后去掉 --dry-run 执行。")
            print("默认只处理诊断有问题的合同；加 --all 可强制重算全部有账单的月嫂合同。")


def main():
    parser = argparse.ArgumentParser(description="批量矫正月嫂合同末期结算/管理费/定金")
    parser.add_argument("--dry-run", action="store_true", help="只扫描不写库")
    parser.add_argument("--contract-id", type=str, default=None, help="只处理指定合同")
    parser.add_argument(
        "--all",
        action="store_true",
        help="重算全部有账单的月嫂合同（默认只修诊断有问题的）",
    )
    args = parser.parse_args()
    run(
        dry_run=args.dry_run,
        contract_id=args.contract_id,
        only_issues=not args.all,
    )


if __name__ == "__main__":
    main()
