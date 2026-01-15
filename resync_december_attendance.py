#!/usr/bin/env python3
"""
Re-sync December 2025 attendance record to include onboarding_time_info
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.app import create_app
from backend.services.attendance_sync_service import sync_attendance_to_record

def main():
    app = create_app()
    
    with app.app_context():
        # December 2025 attendance form ID for contract b87a13dc-85e2-4e52-ac66-32b80954f96f
        attendance_form_id = "10a78eef-a98d-43e5-ac8e-d761e190e318"
        
        print(f"Re-syncing attendance form {attendance_form_id}...")
        
        try:
            sync_attendance_to_record(attendance_form_id)
            print("✅ Successfully re-synced December attendance record!")
            print("The attendance record should now include onboarding_time_info and offboarding_time_info fields.")
        except Exception as e:
            print(f"❌ Error re-syncing attendance: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    main()