from backend.app import app
from backend.extensions import db
from backend.models import CustomerBill
import json

def inspect_bill_details(bill_id_fragment):
    with app.app_context():
        # Find bill by partial ID
        bill = db.session.query(CustomerBill).filter(
            CustomerBill.id.cast(db.String).like(f"{bill_id_fragment}%")
        ).first()
        
        if not bill:
            print(f"Bill {bill_id_fragment} not found.")
            return

        print(f"\n=== Bill Inspection: {bill.id} ===")
        print(f"Total Due: {bill.total_due}")
        print(f"Calculation Details (JSON):")
        print(json.dumps(bill.calculation_details, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    # Inspecting the large Maternity Nurse bill from Feb 2025 finding in previous step
    inspect_bill_details("7f2892")
