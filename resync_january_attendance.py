#!/usr/bin/env python3
"""
Re-sync January 2026 attendance record to include onboarding_time_info
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.app import create_app
from backend.services.attendance_sync_service import sync_attendance_to_record

def main():
    app = create_app()
    
    with app.app_context():
        # January 2026 attendance form ID for contract b87a13dc-85e2-4e52-ac66-32b80954f96f
        # Need to find the form ID first
        from backend.models import AttendanceForm
        
        form = AttendanceForm.query.filter_by(
            contract_id='b87a13dc-85e2-4e52-ac66-32b80954f96f'
        ).filter(
            AttendanceForm.cycle_start_date >= '2026-01-01',
            AttendanceForm.cycle_start_date < '2026-02-01'
        ).first()
        
        if not form:
            print("❌ 未找到2026年1月的考勤表")
            return
        
        print(f"找到考勤表 ID: {form.id}")
        print(f"周期: {form.cycle_start_date} ~ {form.cycle_end_date}")
        print(f"Re-syncing attendance form {form.id}...")
        
        try:
            sync_attendance_to_record(form.id)
            print("✅ Successfully re-synced January attendance record!")
            print("The attendance record should now include onboarding_time_info field.")
        except Exception as e:
            print(f"❌ Error re-syncing attendance: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    main()
