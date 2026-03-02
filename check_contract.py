import sys
import os

sys.path.insert(0, '/Users/victor/develop/examdb')
from backend.app import app
from backend.models import db, BaseContract, CustomerBill, AttendanceRecord

with app.app_context():
    contract_id = '43cb5857-b7ea-404d-956e-7ffcd9e76e40'
    c = BaseContract.query.get(contract_id)
    if c:
        print(f"Contract: {c.id}")
        print(f"Start: {c.start_date}, End: {c.end_date}, Terminated: {c.termination_date}")
        print(f"Status: {c.status}")
        print(f"is_monthly_auto_renew: {getattr(c, 'is_monthly_auto_renew', None)}")
        print(f"actual_onboarding_date: {getattr(c, 'actual_onboarding_date', None)}")
    else:
        print("Contract not found")
        
    records = AttendanceRecord.query.filter_by(contract_id=contract_id).all()
    for r in records:
        print(f"Record Cycle: {r.cycle_start_date} to {r.cycle_end_date}")
        print(f"Total worked: {r.total_days_worked}, Overtime: {r.overtime_days}")

    bills = CustomerBill.query.filter_by(contract_id=contract_id).all()
    for b in bills:
        print(f"Bill Cycle: {b.cycle_start_date} to {b.cycle_end_date}, Actual: {b.actual_work_days}, Overtime: {b.overtime_days}")
