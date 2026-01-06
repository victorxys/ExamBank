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

        # 2. Revenue Calculation (Real Revenue based on Fees & Commissions)
        # Formula: management_fee + extension_fee + employee_commission
        real_revenue_expr = (
            func.coalesce(
                func.cast(CustomerBill.calculation_details['management_fee'].astext, db.Numeric), 0
            ) +
            func.coalesce(
                func.cast(CustomerBill.calculation_details['extension_fee'].astext, db.Numeric), 0
            ) +
            func.coalesce(
                func.cast(CustomerBill.calculation_details['employee_commission'].astext, db.Numeric), 0
            )
        )

        def calculate_revenue(y=None, start=None, end=None):
            query = db.session.query(func.sum(real_revenue_expr))
            if y:
                query = query.filter(CustomerBill.year == y)
            elif start and end:
                query = query.filter(CustomerBill.cycle_start_date >= start)\
                             .filter(CustomerBill.cycle_start_date <= end)
            return query.scalar() or 0

        # Current Period
        if period == 'year':
            current_revenue = calculate_revenue(y=target_year)
        else:
            current_revenue = calculate_revenue(start=start_date, end=end_date)
        
        # Previous Period
        if period == 'year':
            prev_revenue = calculate_revenue(y=target_year - 1)
        else:
            prev_revenue = calculate_revenue(start=prev_start_date, end=prev_end_date)
        
        yoy_diff = float(current_revenue) - float(prev_revenue)
        yoy_growth = (yoy_diff / float(prev_revenue)) if prev_revenue > 0 else 0

        # 3. People Stats (Snapshot - Realtime)
        active_customers = db.session.query(BaseContract).filter(
             BaseContract.status.in_(['active', 'pending_renewal', 'servicing']) 
        ).count()

        total_personnel = db.session.query(ServicePersonnel).count()
        internal_staff = db.session.query(User).count()
        total_employees = total_personnel + internal_staff

        return jsonify({
            "total_revenue": {
                "value": float(current_revenue),
                "yoy_growth": round(yoy_growth * 100, 1),
                "yoy_diff": float(yoy_diff)
            },
            "net_income": {
                "value": float(current_revenue) * 0.7, # Mock: 30% operational cost
                "yoy_growth": round(yoy_growth * 100, 1)
            },
            "active_customers": {
                "value": active_customers,
                "label": "Active Contracts"
            },
            "employees": {
                "value": total_employees,
                "label": "Total Staff"
            },
            "_debug": {
                "message": "Data based on CUSTOMER_BILLS (Accrual Basis).",
                "filter_mode": "year_column" if period == 'year' else "date_range",
                "period": period,
                "target_year": target_year,
                "start_date": str(start_date) if period != 'year' else None,
                "end_date": str(end_date) if period != 'year' else None,
                "billed_revenue": float(current_revenue)
            }
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@dashboard_bp.route('/revenue/charts', methods=['GET'])
def get_revenue_charts():
    try:
        current_year = date.today().year
        target_year = request.args.get('year', default=current_year, type=int)
        period = request.args.get('period', default='year', type=str)
        
        # 1. Trend Data & Labels
        labels = []
        current_trend = []
        prev_trend = [0] * 12 
        
        start_date = None
        end_date = None
        
        # Real Revenue Expression (Management + Extension + Commission)
        real_revenue_val = (
            func.coalesce(func.cast(CustomerBill.calculation_details['management_fee'].astext, db.Numeric), 0) +
            func.coalesce(func.cast(CustomerBill.calculation_details['extension_fee'].astext, db.Numeric), 0) +
            func.coalesce(func.cast(CustomerBill.calculation_details['employee_commission'].astext, db.Numeric), 0)
        )
        
        if period == 'year':
            labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
            
            start_date = date(target_year, 1, 1)
            end_date = date(target_year, 12, 31)

            def get_year_data(y):
                data = [0] * 12
                # Use real_revenue_val sum
                results = db.session.query(
                    CustomerBill.month,
                    func.sum(real_revenue_val)
                ).filter(CustomerBill.year == y)\
                 .group_by(CustomerBill.month).all()
                for m, amt in results:
                    if 1 <= m <= 12:
                        data[int(m)-1] = float(amt)
                return data

            current_trend = get_year_data(target_year)
            prev_trend = get_year_data(target_year - 1)

        else:
            # Last 12 Months (Rolling)
            end_date_obj = date.today()
            # 12 buckets ending in current month.
            
            for i in range(-11, 1):
                # Calculate relative month
                m = (end_date_obj.month + i - 1) % 12 + 1
                y = end_date_obj.year + ((end_date_obj.month + i - 1) // 12)
                
                # Label
                label_name = calendar.month_abbr[m]
                labels.append(label_name)
                
                # Query
                val = db.session.query(func.sum(real_revenue_val))\
                    .filter(CustomerBill.year == y, CustomerBill.month == m)\
                    .scalar() or 0
                current_trend.append(float(val))

            start_date = end_date_obj - timedelta(days=365)
            end_date = end_date_obj

        # 2. Revenue Breakdown & Service Mix
        breakdown_query = db.session.query(
            BaseContract.type,
            func.sum(real_revenue_val)
        ).join(BaseContract, CustomerBill.contract_id == BaseContract.id)

        if period == 'year':
            breakdown_query = breakdown_query.filter(CustomerBill.year == target_year)
        else:
            breakdown_query = breakdown_query.filter(CustomerBill.cycle_start_date >= start_date)\
                                             .filter(CustomerBill.cycle_start_date <= end_date)

        breakdown_results = breakdown_query.group_by(BaseContract.type).all()

        # Initialize Segments
        nanny_mgmt = 0
        nanny_intro = 0
        maternity_mgmt = 0
        maternity_intro = 0
        other_total = 0

        for c_type, amount in breakdown_results:
            amount = float(amount)
            if c_type == 'nanny':
                nanny_mgmt += amount
            elif c_type == 'maternity_nurse':
                maternity_mgmt += amount
            else:
                other_total += amount

        total_breakdown = nanny_mgmt + nanny_intro + maternity_mgmt + maternity_intro + other_total
        
        # 3. Category Trends (Monthly)
        category_trends = {
            'nanny': [0]*12,
            'maternity': [0]*12,
            'other': [0]*12
        }

        # Build Index Map for (Year, Month) -> Chart Index (0-11)
        bucket_map = {}
        if period == 'year':
            for m in range(1, 13):
                bucket_map[f"{target_year}-{m}"] = m - 1
        else:
            # L12M: Re-generate buckets to map Y-M
            end_date_obj = date.today()
            for i in range(-11, 1):
                m = (end_date_obj.month + i - 1) % 12 + 1
                y = end_date_obj.year + ((end_date_obj.month + i - 1) // 12)
                idx = i + 11 
                bucket_map[f"{y}-{m}"] = idx

        trend_query = db.session.query(
            CustomerBill.year,
            CustomerBill.month,
            BaseContract.type,
            func.sum(real_revenue_val)
        ).join(BaseContract, CustomerBill.contract_id == BaseContract.id)

        if period == 'year':
             trend_query = trend_query.filter(CustomerBill.year == target_year)
        else:
             trend_query = trend_query.filter(CustomerBill.cycle_start_date >= start_date)\
                                      .filter(CustomerBill.cycle_start_date <= end_date)
        
        trend_results = trend_query.group_by(CustomerBill.year, CustomerBill.month, BaseContract.type).all()

        for y, m, c_type, amt in trend_results:
            key = f"{y}-{m}"
            if key in bucket_map:
                idx = bucket_map[key]
                amt = float(amt)
                if c_type == 'nanny':
                    category_trends['nanny'][idx] += amt
                elif c_type == 'maternity_nurse':
                    category_trends['maternity'][idx] += amt
                else:
                    category_trends['other'][idx] += amt

        return jsonify({
            "trend": {
                "labels": labels,
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
