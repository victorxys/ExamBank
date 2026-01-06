from backend.app import app
from backend.extensions import db
from backend.models import CustomerBill, BaseContract
from sqlalchemy import func

def audit_feb_2025():
    with app.app_context():
        print("\n=== AUDIT: February 2025 Revenue ===\n")
        
        # 1. Total Sum Verification
        total = db.session.query(func.sum(CustomerBill.total_due))\
            .filter(CustomerBill.year == 2025, CustomerBill.month == 2)\
            .scalar() or 0
        
        print(f"Total Revenue (Feb 2025): ¥{total:,.2f}")
        
        # 2. Detailed Breakdown
        bills = db.session.query(
            CustomerBill.id,
            CustomerBill.total_due,
            BaseContract.type,
            BaseContract.customer_name, # Correct attribute
            CustomerBill.cycle_start_date,
            CustomerBill.cycle_end_date
        ).join(BaseContract, CustomerBill.contract_id == BaseContract.id)\
         .filter(CustomerBill.year == 2025, CustomerBill.month == 2)\
         .order_by(CustomerBill.total_due.desc())\
         .all()
        
        print(f"\nBreakdown ({len(bills)} Bills):")
        print(f"{'ID':<6} | {'Type':<15} | {'Amount':<10} | {'Period'}")
        print("-" * 60)
        
        for bid, amt, ctype, name, start, end in bills:
            # Handle potential None for dates
            s_str = str(start) if start else "?"
            e_str = str(end) if end else "?"
            print(f"{str(bid)[:6]:<6} | {ctype:<15} | ¥{amt:<9.2f} | {s_str} to {e_str}")

if __name__ == "__main__":
    audit_feb_2025()
