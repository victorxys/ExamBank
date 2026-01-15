#!/usr/bin/env python3
"""
Debug why get_onboarding_time_for_contract is not finding the onboarding record
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.app import app
from backend.models import AttendanceForm
from backend.services.attendance_sync_service import get_onboarding_time_for_contract

def main():
    with app.app_context():
        employee_id = '25efcf40-7755-496e-a42c-76eb8ab60712'
        contract_id = 'b87a13dc-85e2-4e52-ac66-32b80954f96f'
        
        print(f"测试 get_onboarding_time_for_contract 函数...")
        print(f"员工: {employee_id}")
        print(f"合同: {contract_id}")
        
        result = get_onboarding_time_for_contract(employee_id, contract_id)
        print(f"\n函数返回结果: {result}")

if __name__ == "__main__":
    main()
