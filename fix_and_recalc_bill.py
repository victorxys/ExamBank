import sys
import os

sys.path.insert(0, '/Users/victor/develop/examdb')
from backend.app import app
from backend.models import db, AttendanceRecord, CustomerBill, EmployeePayroll
from backend.services.billing_engine import BillingEngine
from decimal import Decimal

with app.app_context():
    contract_id = '43cb5857-b7ea-404d-956e-7ffcd9e76e40'
    year = 2026
    month = 2
    
    # 1. Update AttendanceRecord to 26
    record = AttendanceRecord.query.filter_by(
        contract_id=contract_id
    ).filter(
        db.extract('year', AttendanceRecord.cycle_start_date) == year,
        db.extract('month', AttendanceRecord.cycle_start_date) == month
    ).first()
    
    if record:
        print(f"Found AttendanceRecord: {record.id}, old total_days: {record.total_days_worked}")
        if record.total_days_worked < 0:
            record.total_days_worked = Decimal('26')
            db.session.commit()
            print("Updated AttendanceRecord total_days_worked to 26")
    else:
        print("AttendanceRecord not found")

    # 2. Recalculate bill
    print("Recalculating bill...")
    try:
        engine = BillingEngine()
        engine.calculate_for_month(
            year,
            month,
            contract_id=contract_id,
            force_recalculate=True,
            actual_work_days_override=26.0
        )
        db.session.commit()
        print("Recalculation committed successfully.")
    except Exception as e:
        db.session.rollback()
        print(f"Failed to recalculate: {e}")

    # 3. Print the new bill calculations
    bill = CustomerBill.query.filter_by(
        contract_id=contract_id,
        year=year,
        month=month,
        is_substitute_bill=False
    ).first()
    if bill:
        print(f"Updated Bill -> Actual Work Days: {bill.actual_work_days}")
        calc = bill.calculation_details or {}
        print(f"Base Work Days from Calc Details: {calc.get('base_work_days')}")
        print(f"Total Days Worked from Calc Details: {calc.get('total_days_worked')}")
    else:
        print("Bill not found")
