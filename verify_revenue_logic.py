from backend.app import app
from backend.extensions import db
from backend.models import CustomerBill
from sqlalchemy import func, cast, Numeric

def verify_revenue_logic():
    with app.app_context():
        print("\n=== VERIFICATION: Real Revenue Logic (Feb 2025) ===\n")
        
        # Define the Real Revenue Expression
        # revenue = management_fee + extension_fee + employee_commission
        revenue_expr = (
            func.coalesce(
                cast(CustomerBill.calculation_details['management_fee'].astext, Numeric), 0
            ) +
            func.coalesce(
                cast(CustomerBill.calculation_details['extension_fee'].astext, Numeric), 0
            ) +
            func.coalesce(
                cast(CustomerBill.calculation_details['employee_commission'].astext, Numeric), 0
            )
        )

        query = db.session.query(
            CustomerBill.id,
            CustomerBill.customer_name,
            CustomerBill.total_due,
            revenue_expr.label('real_revenue'),
            CustomerBill.calculation_details
        ).filter(CustomerBill.year == 2025, CustomerBill.month == 2)\
         .order_by(CustomerBill.total_due.desc())

        results = query.all()
        
        total_billed = 0
        total_real = 0
        
        print(f"{'ID':<6} | {'Customer':<10} | {'Billed':<10} | {'Real Revenue':<12} | {'Diff'}")
        print("-" * 65)
        
        for bill in results:
            bid = str(bill.id)[:6]
            billed = float(bill.total_due)
            real = float(bill.real_revenue)
            diff = billed - real
            
            total_billed += billed
            total_real += real
            
            # Print only significant ones or first 10
            if abs(diff) > 1:
                print(f"{bid:<6} | {bill.customer_name[:10]:<10} | ¥{billed:<9.2f} | ¥{real:<11.2f} | ¥{diff:.2f}")

        print("-" * 65)
        print(f"TOTAL  | {'':<10} | ¥{total_billed:,.2f} | ¥{total_real:,.2f} | ¥{total_billed - total_real:,.2f}")
        print(f"\nReduction: -{(1 - total_real/total_billed)*100:.1f}%" if total_billed > 0 else "Reduction: N/A")

if __name__ == "__main__":
    verify_revenue_logic()
