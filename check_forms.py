import sys
import os

sys.path.insert(0, '/Users/victor/develop/examdb')
from backend.app import app
from backend.models import db, AttendanceForm

with app.app_context():
    # 55cc91b9-7835-4b21-8a46-5583198ff1bc
    # 333a2080-198d-4a90-8f78-0a54a6f5dcbb
    form1 = AttendanceForm.query.get('55cc91b9-7835-4b21-8a46-5583198ff1bc')
    form2 = AttendanceForm.query.get('333a2080-198d-4a90-8f78-0a54a6f5dcbb')

    print("Form 1:", form1.id if form1 else "Not Found")
    if form1:
        print("Form 1 Data:")
        for k, v in form1.form_data.items():
            if 'records' in k:
                print(f"  {k}: {v}")
    
    print("\nForm 2:", form2.id if form2 else "Not Found")
    if form2:
        print("Form 2 Data:")
        for k, v in form2.form_data.items():
            if 'records' in k:
                print(f"  {k}: {v}")

