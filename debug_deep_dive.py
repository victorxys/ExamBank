from backend.app import app
from backend.extensions import db
from backend.models import PaymentRecord, CustomerBill, BaseContract
from sqlalchemy import func, extract, and_

def deep_dive_2025():
    with app.app_context():
        print("\n=== 2025 DATA DEEP DIVE ===\n")

        # 1. Payment Records (Cash In)
        print("--- PaymentRecords (2025) ---")
        payments = db.session.query(
            func.count(PaymentRecord.id),
            func.sum(PaymentRecord.amount)
        ).filter(extract('year', PaymentRecord.payment_date) == 2025).first()
        print(f"Count: {payments[0]}")
        print(f"Total Amount: {payments[1]}")
        
        # 2. Customer Bills (Invoiced/Billed)
        print("\n--- CustomerBills (2025 Cycle) ---")
        bills = db.session.query(
            func.count(CustomerBill.id),
            func.sum(CustomerBill.total_due) # Assuming total_due exists from previous schema check
        ).filter(CustomerBill.year == 2025).first()
        print(f"Count: {bills[0]}")
        print(f"Total Due (Sum): {bills[1]}")

        # Check Bill Payment Status distribution
        print("\n--- Bill Payment Status (2025) ---")
        status_counts = db.session.query(
            CustomerBill.payment_status,
            func.count(CustomerBill.id)
        ).filter(CustomerBill.year == 2025).group_by(CustomerBill.payment_status).all()
        for status, count in status_counts:
            print(f"- {status}: {count}")

        # 3. Contracts (Active in 2025)
        print("\n--- Active Contracts (2025) ---")
        # Contracts that started before 2026-01-01 and ended after 2025-01-01
        active_contracts = db.session.query(func.count(BaseContract.id)).filter(
            and_(
                BaseContract.start_date <= '2025-12-31',
                BaseContract.end_date >= '2025-01-01'
            )
        ).scalar()
        print(f"Active Contracts touching 2025: {active_contracts}")

if __name__ == "__main__":
    deep_dive_2025()
