#!/usr/bin/env python3
"""
Backfill renewal attendance copies and exact employee-payroll transfer amounts.

Dry-run by default:
    python3 fix_renewal_attendance_transfers.py CONTRACT_ID

Apply changes:
    python3 fix_renewal_attendance_transfers.py CONTRACT_ID --apply
"""

import argparse
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.app import app
from backend.models import AttendanceForm, BaseContract, CustomerBill, EmployeePayroll, db
from backend.services.billing_engine import BillingEngine
from backend.services.renewal_sync_service import (
    calculate_base_payroll_transfer_amount,
    calculate_overtime_payroll_transfer_amount,
    sync_related_renewal_attendance_forms,
    sync_renewal_overtime_transfer,
    sync_renewal_payroll_transfer,
)


def run(contract_id, apply=False):
    with app.app_context():
        bills = CustomerBill.query.filter_by(
            contract_id=contract_id,
            is_substitute_bill=False,
        ).order_by(CustomerBill.cycle_end_date.desc()).all()
        if not bills:
            print(f"未找到合同 {contract_id} 的账单")
            return 1

        successor = BaseContract.query.filter_by(previous_contract_id=contract_id).first()
        if successor and successor.start_date:
            successor_start = successor.start_date.date() if hasattr(successor.start_date, "date") else successor.start_date
            renewal_anchor = successor_start - timedelta(days=1)
            bills = [
                bill for bill in bills
                if bill.year == renewal_anchor.year and bill.month == renewal_anchor.month
            ]
        else:
            bills = bills[:1]

        touched = False
        engine = BillingEngine()
        for bill in bills:
            forms = AttendanceForm.query.filter(
                AttendanceForm.employee_id == bill.contract.service_personnel_id,
                AttendanceForm.cycle_start_date <= bill.cycle_end_date,
                AttendanceForm.cycle_end_date >= bill.cycle_start_date,
                AttendanceForm.status.in_(["customer_signed", "synced"]),
            ).order_by(AttendanceForm.updated_at.desc().nullslast(), AttendanceForm.created_at.desc()).all()

            for form in forms:
                contract = form.contract
                if not contract:
                    continue
                same_family = (
                    bill.contract.family_id
                    and contract.family_id
                    and bill.contract.family_id == contract.family_id
                )
                same_customer = bool(bill.contract.customer_name and bill.contract.customer_name == contract.customer_name)
                if not (same_family or same_customer):
                    continue

                changed_contract_ids = sync_related_renewal_attendance_forms(form.id)
                if changed_contract_ids:
                    print(f"考勤表 {form.id} 回填合同: {', '.join(changed_contract_ids)}")
                    touched = True

            engine.calculate_for_month(
                bill.year,
                bill.month,
                contract_id=contract_id,
                force_recalculate=True,
                cycle_start_date_override=bill.cycle_start_date,
                end_date_override=bill.cycle_end_date,
            )

            source_payroll = EmployeePayroll.query.filter_by(
                contract_id=contract_id,
                cycle_start_date=bill.cycle_start_date,
                is_substitute_payroll=False,
            ).first()
            if source_payroll:
                base_amount = calculate_base_payroll_transfer_amount(source_payroll)
                overtime_amount = calculate_overtime_payroll_transfer_amount(source_payroll)
                print(
                    f"{bill.year}-{bill.month:02d} 拆分金额: "
                    f"原工资转移 {base_amount}, 加班费补转 {overtime_amount}"
                )

            base_synced = sync_renewal_payroll_transfer(
                contract_id,
                bill.year,
                bill.month,
                recalculate=False,
            )
            overtime_synced = sync_renewal_overtime_transfer(
                contract_id,
                bill.year,
                bill.month,
                recalculate=False,
            )
            if base_synced or overtime_synced:
                print(f"同步 {bill.year}-{bill.month:02d} 续签员工工资拆分转移")
                touched = True

                engine.calculate_for_month(
                    bill.year,
                    bill.month,
                    contract_id=contract_id,
                    force_recalculate=True,
                    cycle_start_date_override=bill.cycle_start_date,
                    end_date_override=bill.cycle_end_date,
                )

                if successor:
                    target_bill = CustomerBill.query.filter_by(
                        contract_id=successor.id,
                        is_substitute_bill=False,
                    ).order_by(CustomerBill.cycle_start_date.asc()).first()
                    if target_bill:
                        engine.calculate_for_month(
                            target_bill.year,
                            target_bill.month,
                            contract_id=str(successor.id),
                            force_recalculate=True,
                            cycle_start_date_override=target_bill.cycle_start_date,
                            end_date_override=target_bill.cycle_end_date,
                        )

        if apply:
            db.session.commit()
            print("已提交修改")
        else:
            db.session.rollback()
            print("演习完成，未写入数据库。加 --apply 后提交。")

        if not touched:
            print("未发现需要处理的续签考勤或工资转移")
        return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("contract_id")
    parser.add_argument("--apply", action="store_true", help="写入数据库")
    args = parser.parse_args()
    raise SystemExit(run(args.contract_id, apply=args.apply))
