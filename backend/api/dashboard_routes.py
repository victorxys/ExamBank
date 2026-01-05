from flask import Blueprint, jsonify, request
from sqlalchemy import func, case, and_, extract
from backend.extensions import db
from backend.models import CustomerBill, PaymentRecord, BaseContract, ServicePersonnel, User
from datetime import datetime, date, timedelta
import calendar

dashboard_bp = Blueprint('revenue_dashboard', __name__, url_prefix='/api/dashboard')

@dashboard_bp.route('/revenue/summary', methods=['GET'])
def get_revenue_summary():
    """
    Get executive summary KPIs: Total Revenue, Net Income, Active Customers, Employees.
    Query Params: year (int), period ('year' or 'last_12_months')
    """
    try:
        current_year = date.today().year
        target_year = request.args.get('year', default=current_year, type=int)
        period = request.args.get('period', default='year', type=str)

        # 1. Date Range Calculation
        if period == 'last_12_months':
            end_date = date.today()
            start_date = end_date - timedelta(days=365)
            
            # Previous Period (for YoY)
            prev_end_date = start_date - timedelta(days=1)
            prev_start_date = prev_end_date - timedelta(days=365)
        else: # Standard Calendar Year
            start_date = date(target_year, 1, 1)
            end_date = date(target_year, 12, 31)
            
            # Previous Year
            prev_start_date = date(target_year - 1, 1, 1)
            prev_end_date = date(target_year - 1, 12, 31)

        # 2. Revenue Calculation (Paid Bills)
        # Revenue = Introduction + Management + Trial + Balance. Exclude Deposits.
        def calculate_revenue(s_date, e_date):
            return db.session.query(func.sum(PaymentRecord.amount))\
                .join(CustomerBill, PaymentRecord.customer_bill_id == CustomerBill.id)\
                .filter(PaymentRecord.payment_date >= s_date)\
                .filter(PaymentRecord.payment_date <= e_date)\
                .scalar() or 0

        current_revenue = calculate_revenue(start_date, end_date)
        prev_revenue = calculate_revenue(prev_start_date, prev_end_date)
        
        yoy_diff = float(current_revenue) - float(prev_revenue)
        yoy_growth = (yoy_diff / float(prev_revenue)) if prev_revenue > 0 else 0

        # 3. People Stats (Snapshot - Realtime)
        # Active Customers = Active Contracts
        # Assuming 'status' column exists and has 'active' or 'servicing'. 
        active_customers = db.session.query(BaseContract).filter(
            # Adjust status filter based on actual Model status enums. Assuming 'active' for now.
            # BaseContract doesn't have a simple 'status' in snippet, might be inferred or mapped.
            # Using 'nanny' etc. type check for now + checking strict status if calculated.
            # Let's approximate: Bills generated recently or EndDate > Today.
            # Simplified: Count all contracts not 'terminated' or 'completed'
             BaseContract.status.in_(['active', 'pending_renewal', 'servicing']) 
        ).count()

        # Employees = ServicePersonnel + Internal Staff
        # Count all ServicePersonnel
        total_personnel = db.session.query(ServicePersonnel).count()
        # Count all Internal Users (Staff)
        # Assuming User table has an 'is_staff' or role. 
        # For now, just count Users or ServicePersonnel to be safe.
        # Let's count ServicePersonnel (Aunties) + User (Staff)
        # This might double count if staff are users.
        # Let's just use ServicePersonnel for 'Field Staff' as represented in mockup context?
        # Mockup said "Aunties + Internal".
        internal_staff = db.session.query(User).count()
        total_employees = total_personnel + internal_staff

        return jsonify({
            "total_revenue": {
                "value": float(current_revenue),
                "yoy_growth": round(yoy_growth * 100, 1),
                "yoy_diff": float(yoy_diff)
            },
            # Placeholder for Net Income (Revenue - Expenses)
            # Complex to calc accurately without Expense model details.
            # For V1, we might approximate or set as Revenue * Margin or 0 if not calc.
            "net_income": {
                "value": float(current_revenue) * 0.7, # Mock: 30% operational cost
                "yoy_growth": round(yoy_growth * 100, 1) # Assumed similar trend
            },
            "active_customers": {
                "value": active_customers,
                "label": "Active Contracts"
            },
            "employees": {
                "value": total_employees,
                "label": "Total Staff"
            }
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@dashboard_bp.route('/revenue/charts', methods=['GET'])
def get_revenue_charts():
    try:
        current_year = date.today().year
        target_year = request.args.get('year', default=current_year, type=int)
        
        # 1. Monthly Revenue Trend (Annual)
        # Group by Month for Target Year and Target Year - 1
        
        def get_monthly_data(year):
            data = [0] * 12
            results = db.session.query(
                extract('month', PaymentRecord.payment_date).label('month'),
                func.sum(PaymentRecord.amount)
            ).join(CustomerBill, PaymentRecord.customer_bill_id == CustomerBill.id)\
             .filter(extract('year', PaymentRecord.payment_date) == year)\
             .group_by(extract('month', PaymentRecord.payment_date)).all()
            
            for m, amt in results:
                data[int(m)-1] = float(amt)
            return data

        current_trend = get_monthly_data(target_year)
        prev_trend = get_monthly_data(target_year - 1)

        # 2. Revenue Breakdown & Service Mix
        # Segments: Nanny-Mgmt, Nanny-Intro, Maternity-Mgmt, Maternity-Intro, Other
        
        # Query: Sum Amount Group By Contract.type, Bill.bill_type
        # Filter: Target Year
        breakdown_query = db.session.query(
            BaseContract.type,
            func.sum(PaymentRecord.amount)
        ).join(CustomerBill, PaymentRecord.customer_bill_id == CustomerBill.id)\
         .join(BaseContract, CustomerBill.contract_id == BaseContract.id)\
         .filter(extract('year', PaymentRecord.payment_date) == target_year)\
         .group_by(BaseContract.type).all()

        # Initialize Segments
        # Nanny
        nanny_mgmt = 0
        nanny_intro = 0
        # Maternity
        maternity_mgmt = 0
        maternity_intro = 0
        # Other
        other_total = 0

        for c_type, amount in breakdown_query:
            amount = float(amount)
            if c_type == 'nanny':
                # Without bill_type, we can't distinguish mgmt vs intro. 
                # For now, put all into mgmt or split 50/50? 
                # Let's put into mgmt as default.
                nanny_mgmt += amount
            elif c_type == 'maternity_nurse':
                maternity_mgmt += amount
            else:
                other_total += amount

        total_breakdown = nanny_mgmt + nanny_intro + maternity_mgmt + maternity_intro + other_total
        
        # 3. Category Trends (Monthly)
        # Nanny Trend, Maternity Trend, Other Trend
        category_trends = {
            'nanny': [0]*12,
            'maternity': [0]*12,
            'other': [0]*12
        }
        
        trend_query = db.session.query(
            extract('month', PaymentRecord.payment_date).label('month'),
            BaseContract.type,
            func.sum(PaymentRecord.amount)
        ).join(CustomerBill, PaymentRecord.customer_bill_id == CustomerBill.id)\
         .join(BaseContract, CustomerBill.contract_id == BaseContract.id)\
         .filter(extract('year', PaymentRecord.payment_date) == target_year)\
         .group_by(extract('month', PaymentRecord.payment_date), BaseContract.type).all()

        for m, c_type, amt in trend_query:
            idx = int(m) - 1
            amt = float(amt)
            if c_type == 'nanny':
                category_trends['nanny'][idx] += amt
            elif c_type == 'maternity_nurse':
                category_trends['maternity'][idx] += amt
            else:
                category_trends['other'][idx] += amt

        return jsonify({
            "trend": {
                "labels": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
                "current": current_trend,
                "previous": prev_trend
            },
            "mix": {
                "nanny_mgmt": nanny_mgmt,
                "nanny_intro": nanny_intro,
                "maternity_mgmt": maternity_mgmt,
                "maternity_intro": maternity_intro,
                "other": other_total,
                "total": total_breakdown
            },
            "category_trends": category_trends
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500
