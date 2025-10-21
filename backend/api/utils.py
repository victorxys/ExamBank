# backend/api/utils.py

from datetime import date, datetime
import decimal
from flask_jwt_extended import get_jwt_identity
from backend.models import (
    db,
    CustomerBill,
    EmployeePayroll,
    FinancialAdjustment,
    AttendanceRecord,
    NannyContract,
    FinancialActivityLog,
)
from backend.services.billing_engine import BillingEngine

D = decimal.Decimal

def get_contract_type_details(contract_type):
    if contract_type == "nanny":
        return "育儿嫂"
    elif contract_type == "maternity_nurse":
        return "月嫂"
    elif contract_type == "external_substitution":
        return "临时替工"
    elif contract_type == "nanny_trial":
        return "育儿嫂试工"
    return "未知类型"

def _fill_group_fields(group_fields, calc, field_keys, is_substitute_payroll=False):
    for key in field_keys:
        if key in calc:
            label_map = {
                "base_work_days": "基本劳务天数",
                "overtime_days": "加班天数",
                "total_days_worked": "总劳务天数",
                "substitute_days": "被替班天数",
                "customer_base_fee": "基础劳务费",
                "customer_overtime_fee": "加班费",
                "management_fee": "管理费",
                "management_fee_rate": "管理费率",
                "substitute_deduction": "被替班费用",
                "employee_base_payout": "基础劳务费"
                if "nanny" in calc.get("type", "") or calc.get("type") == "substitute"
                else "萌嫂保证金(工资)",
                "employee_overtime_payout": "加班费",
                "first_month_deduction": "首月员工10%费用",
            }
            label = label_map.get(key, key)
            group_fields[label] = calc[key]

def _get_details_template(contract, cycle_start, cycle_end):
    is_maternity = contract.type == "maternity_nurse"
    is_nanny = contract.type == "nanny"
    is_nanny_trial = contract.type == "nanny_trial"

    engine = BillingEngine()
    cycle_start_d = engine._to_date(cycle_start)
    cycle_end_d = engine._to_date(cycle_end)

    period_str = "日期错误" 
    if cycle_start_d and cycle_end_d:
        if contract.type == 'external_substitution' or contract.type == 'nanny':
            days_in_cycle = (cycle_end_d - cycle_start_d).days + 1
            period_str = f"{cycle_start_d.isoformat()} ~ {cycle_end_d.isoformat()} ({days_in_cycle}天)"
        else:
            days_in_cycle = (cycle_end_d - cycle_start_d).days
            period_str = f"{cycle_start_d.isoformat()} ~ {cycle_end_d.isoformat()} ({days_in_cycle}天)"

    customer_groups = [
        {
            "name": "级别与保证金",
            "fields": {
                "级别": str(contract.employee_level or 0),
                "客交保证金": str(getattr(contract, "security_deposit_paid", 0)),
                "管理费": str(getattr(contract, "management_fee_amount", 0)),
                "定金": str(getattr(contract, "deposit_amount", 0)) if is_maternity else "0.00",
                "介绍费": str(getattr(contract, "introduction_fee", "0.00")),
                "合同备注": contract.notes or "—",
            },
        },
        {
            "name": "劳务周期",
            "fields": {
                "劳务时间段": period_str, 
                "基本劳务天数": "待计算",
                "加班天数": "0",
                "被替班天数": "0",
                "总劳务天数": "待计算",
            },
        },
        {"name": "费用明细", "fields": {}},
    ]

    employee_groups = [{"name": "薪酬明细", "fields": {}}]

    if is_maternity:
        customer_groups[2]["fields"] = {
            "优惠": str(getattr(contract, "discount_amount", 0)),
            "本次交管理费": "待计算",
        }
        employee_groups[0]["fields"] = {
            "级别": str(contract.employee_level or 0),
            "萌嫂保证金(工资)": "待计算",
            "加班费": "待计算",
            "被替班费用": "0.00",
            "5%奖励": "待计算",
        }
    elif is_nanny:
        customer_groups[2]["fields"] = {
            "本次交管理费": "待计算",
        }
        employee_groups[0]["fields"] = {
            "级别": str(contract.employee_level or 0),
            "基础劳务费": "待计算",
            "加班费": "待计算",
            "被替班费用": "0.00",
            "首月员工10%费用": "待计算",
        }
    elif is_nanny_trial:
        customer_groups[2]["fields"] = {
            "本次交管理费": "待计算",
        }
        employee_groups[0]["fields"] = {
            "级别": str(contract.employee_level or 0),
            "基础劳务费": "待计算",
            "加班费": "待计算",
        }

    return {"id": None, "groups": customer_groups}, {"id": None, "groups":employee_groups}

def get_billing_details_internal(
    bill_id=None,
    contract_id=None,
    year=None,
    month=None,
    cycle_start_date_from_bill=None,
    is_substitute_bill=False,
):
    customer_bill = None
    if bill_id:
        customer_bill = db.session.get(CustomerBill, bill_id)
    elif contract_id and year and month and cycle_start_date_from_bill:
        customer_bill = CustomerBill.query.filter_by(
            contract_id=contract_id,
            year=year,
            month=month,
            cycle_start_date=cycle_start_date_from_bill,
            is_substitute_bill=is_substitute_bill,
        ).first()

    if not customer_bill:
        return None

    contract = customer_bill.contract
    cycle_start, cycle_end = (
        customer_bill.cycle_start_date,
        customer_bill.cycle_end_date,
    )

    has_prev_bill = db.session.query(CustomerBill.query.filter(
        CustomerBill.contract_id == contract.id,
        CustomerBill.cycle_start_date < customer_bill.cycle_start_date,
        CustomerBill.is_substitute_bill == False
    ).exists()).scalar()

    has_next_bill = db.session.query(CustomerBill.query.filter(
        CustomerBill.contract_id == contract.id,
        CustomerBill.cycle_start_date > customer_bill.cycle_start_date,
        CustomerBill.is_substitute_bill == False
    ).exists()).scalar()

    employee_payroll = EmployeePayroll.query.filter_by(
        contract_id=contract.id,
        cycle_start_date=cycle_start,
        is_substitute_payroll=customer_bill.is_substitute_bill,
    ).first()

    customer_details, employee_details = _get_details_template(
        contract, cycle_start, cycle_end
    )
    if customer_bill.is_substitute_bill and customer_bill.source_substitute_record:
        sub_record = customer_bill.source_substitute_record
        employee_details['groups'] = [{
            "name": "薪酬明细",
            "fields": {
                "级别": str(sub_record.substitute_salary or 0),
                "基础劳务费": "待计算",
                "加班费": "待计算",
            }
        }]

    calc_cust = customer_bill.calculation_details or {}
    customer_details.update({
        "id": str(customer_bill.id),
        "calculation_details": calc_cust,
        "final_amount": {"客应付款": str(customer_bill.total_due)}, 
        "payment_status": {
            'status': customer_bill.payment_status.value,
            'total_due': str(customer_bill.total_due),
            'total_paid': str(customer_bill.total_paid)
        }
    })
    _fill_group_fields(customer_details["groups"][1]["fields"], calc_cust, ["base_work_days", "overtime_days", "total_days_worked", "substitute_days"])
    _fill_group_fields(customer_details["groups"][2]["fields"], calc_cust, ["management_fee", "management_fee_rate"])
    if contract.type == "nanny" or contract.type == "maternity_nurse" or contract.type == "external_substitution" or contract.type == "nanny_trial":
        customer_details["groups"][2]["fields"]["本次交管理费"] = calc_cust.get("management_fee", "待计算")

    if customer_bill.is_substitute_bill:
        sub_record = customer_bill.source_substitute_record
        if sub_record:
            for group in customer_details["groups"]:
                if group["name"] == "级别与保证金":
                    group["fields"]["级别"] = str(sub_record.substitute_salary or "0")
                    break
    
    extension_fee_str = calc_cust.get("extension_fee")
    if extension_fee_str and float(extension_fee_str) > 0:
        for group in customer_details["groups"]:
            if group["name"] == "费用明细":
                group["fields"]["延长期服务费"] = extension_fee_str
                group["fields"]["延长期管理费"] = "待计算"

    if employee_payroll:
        calc_payroll = employee_payroll.calculation_details or {}
        employee_details.update({
            "id": str(employee_payroll.id),
            "calculation_details": calc_payroll,
            "final_amount": {"萌嫂应领款": str(employee_payroll.total_due)}, 
            "payout_status": {
                'status': employee_payroll.payout_status.value,
                'total_due': str(employee_payroll.total_due),
                'total_paid_out': str(employee_payroll.total_paid_out)
            }
        })
        _fill_group_fields(employee_details["groups"][0]["fields"], calc_payroll, ["employee_base_payout","employee_overtime_payout", "first_month_deduction", "substitute_deduction"],is_substitute_payroll=employee_payroll.is_substitute_payroll)
        
    customer_adjustments = []
    if customer_bill:
        customer_adjustments =FinancialAdjustment.query.filter_by(customer_bill_id=customer_bill.id).all()

    employee_adjustments = []
    if employee_payroll:
        employee_adjustments =FinancialAdjustment.query.filter_by(employee_payroll_id=employee_payroll.id).all()

    adjustments_map = {adj.id: adj for adj in customer_adjustments}
    for adj in employee_adjustments:
        adjustments_map[adj.id] = adj

    adjustments = list(adjustments_map.values())

    overtime_days = 0
    if customer_bill.is_substitute_bill:
        sub_record = customer_bill.source_substitute_record
        if sub_record:
            overtime_days = sub_record.overtime_days or 0
    else:
        attendance_record = AttendanceRecord.query.filter_by(contract_id=contract.id, cycle_start_date=cycle_start).first()
        if attendance_record:
            overtime_days = attendance_record.overtime_days

    if contract.type == 'nanny_trial':
        customer_details['groups'][0]['fields']['介绍费'] = str(getattr(contract, "introduction_fee", "0.00"))
        customer_details['groups'][0]['fields']['管理费'] = calc_cust.get("management_fee", "待计算")
    customer_details['groups'][0]['fields']['合同备注'] = contract.notes or "—"

    later_bill_exists = db.session.query(db.session.query(CustomerBill).filter(CustomerBill.contract_id == contract.id,CustomerBill.is_substitute_bill == False, CustomerBill.cycle_start_date > customer_bill.cycle_start_date).exists()).scalar()
    is_last_bill = not later_bill_exists
    
    
    is_eligible_for_extension = False
    authoritative_end_date = None

    if is_last_bill:
        contract_type = contract.type
        if contract_type == 'nanny' and not getattr(contract, 'is_monthly_auto_renew', False):
            is_eligible_for_extension = True
            authoritative_end_date = contract.end_date
        elif contract_type == 'maternity_nurse':
            is_eligible_for_extension = True
            authoritative_end_date = getattr(contract,'expected_offboarding_date', None) or contract.end_date
        elif contract_type == 'external_substitution':
            is_eligible_for_extension = True
            authoritative_end_date = contract.end_date

    if is_eligible_for_extension and authoritative_end_date:
        bill_end_date_obj =customer_bill.cycle_end_date
        auth_end_date_obj = authoritative_end_date

        bill_end_date = bill_end_date_obj.date() if isinstance(bill_end_date_obj, datetime) else bill_end_date_obj
        auth_end_date = auth_end_date_obj.date() if isinstance(auth_end_date_obj, datetime) else auth_end_date

        if bill_end_date and auth_end_date and bill_end_date > auth_end_date:
            extension_days = (bill_end_date -auth_end_date).days

            if extension_days > 0:
                extension_log = f"原合同于 {auth_end_date.strftime('%m月%d日')} 结束，手动延长至{bill_end_date.strftime('%m月%d日')}，共{extension_days} 天。"

                level = D(contract.employee_level or'0')
                daily_rate = level / D(26)
                extension_fee = (daily_rate *D(extension_days)).quantize(D('0.01'))
                extension_fee_log = f"级别({level:.2f})/26 * 延长天数延期了({extension_days}) = {extension_fee:.2f}"

                if contract.management_fee_amount is not None:
                    management_fee = D(contract.management_fee_amount)
                else:
                    management_fee = (level * D('0.1')).quantize(D('0.01'))
                extension_manage_fee = management_fee * D(extension_days) / D(30)
                extension_manage_fee_log = f"延长期管理费({management_fee:.2f})/30 * 延长天数延期了({extension_days}) = {extension_manage_fee:.2f}"

                if "calculation_details" not in customer_details:
                    customer_details["calculation_details"] = {}
                if "log_extras" not in customer_details["calculation_details"]:
                    customer_details["calculation_details"]["log_extras"] = {}

                for group in customer_details["groups"]:
                    if group["name"] == "劳务周期":
                        group["fields"]["延长服务天数"] = str(extension_days)
                        customer_details["calculation_details"]["log_extras"]["extension_days_reason"] = extension_log
                    if group["name"] == "费用明细":
                        group["fields"]["延长期服务费"] = str(extension_fee)
                        customer_details["calculation_details"]["log_extras"]["extension_fee_reason"] = extension_fee_log
                        group["fields"]["延长期管理费"] = str(extension_manage_fee)
                        customer_details["calculation_details"]["log_extras"]["extension_manage_fee_reason"] = extension_manage_fee_log

                if employee_details and employee_details.get("groups"):
                    for group in employee_details["groups"]:
                        if group["name"] in ["薪酬明细", "劳务周期"]:
                             group["fields"]["延长服务天数"] = str(extension_days)
                             group["fields"]["延长期服务费"] = str(extension_fee)
    remaining_months_str = "N/A"
    highlight_remaining = False
    today = date.today()

    start_date_obj = contract.actual_onboarding_date or contract.start_date
    start_date_for_calc = start_date_obj.date() if isinstance(start_date_obj, datetime) else start_date_obj

    end_date_obj = None
    if contract.type == "maternity_nurse":
        end_date_obj = contract.expected_offboarding_date or contract.end_date
    else:
        end_date_obj = contract.end_date

    end_date_for_calc = end_date_obj.date() if isinstance(end_date_obj, datetime) else end_date_obj

    if isinstance(contract, NannyContract) and getattr(contract, "is_monthly_auto_renew", False):
        remaining_months_str = "月签"
    elif start_date_for_calc and end_date_for_calc:
        if start_date_for_calc > today:
            remaining_months_str = "合同未开始"
        elif end_date_for_calc > today:
            total_days_remaining = (end_date_for_calc -today).days
            if contract.type == "nanny" and total_days_remaining < 30:
                highlight_remaining = True
            if total_days_remaining >= 365:
                years = total_days_remaining // 365
                months = (total_days_remaining % 365) // 30
                remaining_months_str = f"约{years}年{months}个月"
            elif total_days_remaining >= 30:
                months = total_days_remaining // 30
                days = total_days_remaining % 30
                remaining_months_str = f"{months}个月"
                if days > 0:
                    remaining_months_str += f" {days}天"
            elif total_days_remaining >= 0:
                remaining_months_str = f"{total_days_remaining}天"
            else:
                remaining_months_str = "已结束"
        else:
            remaining_months_str = "已结束"

    def safe_isoformat(dt_obj):
        if not dt_obj:
            return None
        if isinstance(dt_obj, datetime):
            return dt_obj.date().isoformat()
        return dt_obj.isoformat()
    return {
        "customer_bill_details": customer_details,
        "employee_payroll_details": employee_details,
        "adjustments": [adj.to_dict() for adj in adjustments],
        "payment_records": [p.to_dict() for p in customer_bill.payment_records],
        "payout_records": [p.to_dict() for p in employee_payroll.payout_records] if employee_payroll else [],
        "attendance": {
            "overtime_days": float(overtime_days) if overtime_days is not None else 0
        },
        "invoice_details": {
            "number": (customer_bill.payment_details or {}).get("invoice_number", ""),
            "amount": (customer_bill.payment_details or {}).get("invoice_amount", ""),
            "date": (customer_bill.payment_details or {}).get("invoice_date", None),
        },
        "is_last_bill": is_last_bill,
        "cycle_start_date": cycle_start.isoformat(),
        "cycle_end_date": cycle_end.isoformat(),
        "is_substitute_bill": customer_bill.is_substitute_bill,
            "contract_info": {
            "contract_id": str(contract.id),
            "contract_type_label":get_contract_type_details(contract.type),
            "start_date": safe_isoformat(contract.start_date),
            "end_date": safe_isoformat(contract.end_date),
            "notes": contract.notes,
            "remaining_months": remaining_months_str,
            "is_monthly_auto_renew": getattr(contract,'is_monthly_auto_renew', None)
        },
        "has_prev_bill": has_prev_bill,
        "has_next_bill": has_next_bill
    }

def _log_activity(bill, payroll, action, details=None, contract=None):
    """
    记录一条财务活动日志。
    """
    user_id = get_jwt_identity()

    final_contract_id = None
    if contract:
        final_contract_id = contract.id
    elif bill and hasattr(bill, 'contract_id'):
        final_contract_id = bill.contract_id
    elif payroll and hasattr(payroll, 'contract_id'):
        final_contract_id = payroll.contract_id

    log = FinancialActivityLog(
        customer_bill_id=bill.id if bill else None,
        employee_payroll_id=payroll.id if payroll else None,
        contract_id=final_contract_id,
        user_id=user_id,
        action=action,
        details=details,
    )
    db.session.add(log)