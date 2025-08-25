# backend/api/billing_api.py (添加考勤录入API)

from flask import Blueprint, jsonify, current_app, request, Response
from flask_jwt_extended import jwt_required
from sqlalchemy import or_, case, and_, func, distinct, extract, cast, String
from sqlalchemy.orm import with_polymorphic, attributes
from flask_jwt_extended import get_jwt_identity
from dateutil.parser import parse as date_parse
from sqlalchemy.orm import with_polymorphic # <--- 别忘了导入
from sqlalchemy import func, distinct
from sqlalchemy.sql import extract
import csv # <-- 添加此行
import io # <-- 添加此行
import calendar
from datetime import date, timedelta, datetime, timezone
import decimal
from dateutil.relativedelta import relativedelta
from collections import defaultdict
from pypinyin import pinyin, Style
import os
import uuid
from werkzeug.utils import secure_filename


# --- 新增 AttendanceRecord 的导入 ---
from backend.models import (
    db,
    BaseContract,
    User,
    ServicePersonnel,
    NannyContract,
    MaternityNurseContract,
    NannyTrialContract,
    AttendanceRecord,
    CustomerBill,
    EmployeePayroll,
    FinancialAdjustment,
    FinancialActivityLog,
    SubstituteRecord,
    InvoiceRecord,
    PaymentStatus,
    PaymentRecord,
    PayoutStatus,
    PayoutRecord,
    AdjustmentType,
    ExternalSubstitutionContract
)
from backend.tasks import (
    sync_all_contracts_task,
    calculate_monthly_billing_task,
    post_virtual_contract_creation_task,
    generate_all_bills_for_contract_task,
)  # 导入新任务
from backend.services.billing_engine import BillingEngine
from backend.models import AdjustmentType

D = decimal.Decimal

billing_bp = Blueprint("billing_api", __name__, url_prefix="/api/billing")

ADJUSTMENT_TYPE_LABELS = {
    AdjustmentType.CUSTOMER_INCREASE: "客户增款",
    AdjustmentType.CUSTOMER_DECREASE: "退客户款",
    AdjustmentType.CUSTOMER_DISCOUNT: "优惠",
    AdjustmentType.EMPLOYEE_INCREASE: "员工增款",
    AdjustmentType.EMPLOYEE_DECREASE: "员工减款",
    AdjustmentType.DEFERRED_FEE: "上期顺延费用",
}

def _get_or_create_personnel_ref(name: str, phone: str = None):
    """
    根据姓名和（可选）手机号，查找或创建服务人员。
    逻辑与 data_sync_service 一致。
    返回一个包含人员类型和ID的字典。
    """
    # 1. 按手机号在 User 表中精确查找
    if phone:
        user = User.query.filter_by(phone_number=phone).first()
        if user:
            return {"type": "user", "id": user.id}

    # 2. 按姓名在 User 表中查找
    user = User.query.filter_by(username=name).first()
    if user:
        return {"type": "user", "id": user.id}

    # 3. 按手机号在 ServicePersonnel 表中精确查找
    if phone:
        sp = ServicePersonnel.query.filter_by(phone_number=phone).first()
        if sp:
            return {"type": "service_personnel", "id": sp.id}

    # 4. 按姓名在 ServicePersonnel 表中查找
    sp = ServicePersonnel.query.filter_by(name=name).first()
    if sp:
        return {"type": "service_personnel", "id": sp.id}

    # 5. 如果都找不到，则创建新的 ServicePersonnel
    # --- 新增：生成拼音 ---
    name_pinyin_full = "".join(item[0] for item in pinyin(name, style=Style.NORMAL))
    name_pinyin_initials = "".join(item[0] for item in pinyin(name, style=Style.FIRST_LETTER))
    name_pinyin_combined = f"{name_pinyin_full} {name_pinyin_initials}"
    # --- 结束 ---

    new_sp = ServicePersonnel(
        name=name,
        phone_number=phone,
        name_pinyin=name_pinyin_combined # <-- 在这里使用生成的拼音
    )
    db.session.add(new_sp)
    db.session.flush()
    current_app.logger.info(f"创建了新的服务人员: {name} (Pinyin: {name_pinyin_combined})")
    return {"type": "service_personnel", "id": new_sp.id}

# 创建一个辅助函数来记录日志
def _log_activity(bill, payroll, action, details=None):
    user_id = get_jwt_identity()  # 获取当前登录用户的ID
    log = FinancialActivityLog(
        customer_bill_id=bill.id if bill else None,
        employee_payroll_id=payroll.id if payroll else None,
        user_id=user_id,
        action=action,
        details=details,
    )
    db.session.add(log)


def _get_billing_details_internal(
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

    employee_payroll = EmployeePayroll.query.filter_by(
        contract_id=contract.id,
        cycle_start_date=cycle_start,
        is_substitute_payroll=customer_bill.is_substitute_bill,
    ).first()

    customer_details, employee_details = _get_details_template(
        contract, cycle_start, cycle_end
    )
    # 为替班账单强制使用正确的员工薪酬模板
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

    # --- 客户账单详情 ---
    calc_cust = customer_bill.calculation_details or {}
    customer_details.update({
        "id": str(customer_bill.id),
        "calculation_details": calc_cust,
        "final_amount": {"客应付款": str(customer_bill.total_due)}, # V2: 使用 total_due
        # 【V2.0 修改】直接从 bill 对象获取支付状态信息
        "payment_status": {
            'status': customer_bill.payment_status.value,
            'total_due': str(customer_bill.total_due),
            'total_paid': str(customer_bill.total_paid)
        }
    })
    _fill_group_fields(customer_details["groups"][1]["fields"], calc_cust, ["base_work_days", "overtime_days", "total_days_worked", "substitute_days"])
    _fill_group_fields(customer_details["groups"][2]["fields"], calc_cust, ["management_fee", "management_fee_rate"])
    if contract.type == "nanny" or contract.type == "maternity_nurse" or contract.type == "external_substitution":
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
            "final_amount": {"萌嫂应领款": str(employee_payroll.total_due)}, # V2 修改
            # 【V2.0 员工侧修改】
            "payout_status": {
                'status': employee_payroll.payout_status.value,
                'total_due': str(employee_payroll.total_due),
                'total_paid_out': str(employee_payroll.total_paid_out)
            }
        })
        _fill_group_fields(employee_details["groups"][0]["fields"], calc_payroll, ["employee_base_payout","employee_overtime_payout", "first_month_deduction", "substitute_deduction"],is_substitute_payroll=employee_payroll.is_substitute_payroll)
        
    adjustment_filters = []
    if customer_bill:
        adjustment_filters.append(FinancialAdjustment.customer_bill_id == customer_bill.id)
    if employee_payroll:
        adjustment_filters.append(FinancialAdjustment.employee_payroll_id == employee_payroll.id)
    adjustments = FinancialAdjustment.query.filter(or_(*adjustment_filters)).all() if adjustment_filters else []

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
    customer_details['groups'][0]['fields']['合同备注'] = contract.notes or "—"

    later_bill_exists = db.session.query(db.session.query(CustomerBill).filter(CustomerBill.contract_id == contract.id,CustomerBill.is_substitute_bill == False, CustomerBill.cycle_start_date > customer_bill.cycle_start_date).exists()).scalar()
    is_last_bill = not later_bill_exists
    
    
    # --- ITERATION v3: START (Linus Fixed) ---
    # 统一处理所有合同类型的“延长服务”逻辑

    # 1. 确定合同是否符合延长的基本资格及其权威结束日期
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
            # 【关键修正】临时替班合同没有“预计下户日期”，直接用合同结束日期
            authoritative_end_date = contract.end_date

    # 2. 如果符合资格，则执行统一的计算和注入逻辑
    current_app.logger.info(f"检查合同 {contract.id} 的延长服务资格: is_eligible_for_extension={is_eligible_for_extension}, authoritative_end_date={authoritative_end_date}")
    if is_eligible_for_extension and authoritative_end_date:
        current_app.logger.info(f"合同 {contract.id} 符合延长服务资格，权威结束日期为 {authoritative_end_date}")
        # --- 关键修复：在比较前，确保两个对象都是 date 类型 ---
        bill_end_date_obj =customer_bill.cycle_end_date
        auth_end_date_obj = authoritative_end_date

        bill_end_date = bill_end_date_obj.date() if isinstance(bill_end_date_obj, datetime) else bill_end_date_obj
        auth_end_date = auth_end_date_obj.date() if isinstance(auth_end_date_obj, datetime) else auth_end_date
        # --- 修复结束 ---

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

                # 注入到 customer_details
                for group in customer_details["groups"]:
                    if group["name"] == "劳务周期":
                        group["fields"]["延长服务天数"] = str(extension_days)
                        customer_details["calculation_details"]["log_extras"]["extension_days_reason"] = extension_log
                    if group["name"] == "费用明细":
                        group["fields"]["延长期服务费"] = str(extension_fee)
                        customer_details["calculation_details"]["log_extras"]["extension_fee_reason"] = extension_fee_log
                        group["fields"]["延长期管理费"] = str(extension_manage_fee)
                        customer_details["calculation_details"]["log_extras"]["extension_manage_fee_reason"] = extension_manage_fee_log

                # 注入到 employee_details
                if employee_details and employee_details.get("groups"):
                    for group in employee_details["groups"]:
                        if group["name"] in ["薪酬明细", "劳务周期"]:
                             group["fields"]["延长服务天数"] = str(extension_days)
                             group["fields"]["延长期服务费"] = str(extension_fee)
    # --- ITERATION v3: END ---
    # current_app.logger.info(f"生成账单详情customer_details:{customer_details}完成: 客户账单ID={customer_bill.id}, 员工薪酬ID={(employee_payroll.id if employee_payroll else 'N/A')}")
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
    }


def _get_details_template(contract, cycle_start, cycle_end):
    is_maternity = contract.type == "maternity_nurse"
    is_nanny = contract.type == "nanny"
    current_app.logger.info(
        f"[DEBUG] Generating billing details template for contract type: {contract.type}, is_maternity: {is_maternity}, is_nanny: {is_nanny}"
    )
    engine = BillingEngine()
        # 【关键修复】使用 _to_date 辅助函数，确保我们处理的是纯 date 对象
    cycle_start_d = engine._to_date(cycle_start)
    cycle_end_d = engine._to_date(cycle_end)

    period_str = "日期错误" # 默认值
    if cycle_start_d and cycle_end_d:
        # 对于外部替班合同，由于时间精确到分钟，计算天数可能会误导，所以不显示天数
        if contract.type == 'external_substitution' or contract.type == 'nanny':
            #  period_str = f"{cycle_start.strftime('%Y-%m-%d %H:%M')} ~ {cycle_end.strftime('%Y-%m-%d %H:%M')}"
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
                "劳务时间段": period_str, # <-- 使用我们格式化好的字符串
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
            # "管理费": "待计算",
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

    return {"id": None, "groups": customer_groups}, {"id": None, "groups":employee_groups}


# def _fill_payment_status(details, payment_data, is_paid, is_customer):
#     payment = payment_data or {}
#     status_dict = {}

#     if is_customer:
#         # --- 客户账单 ---
#         invoice_needed = payment.get('invoice_needed', False)

#         # 核心修正：根据是否存在发票信息来动态决定 issued 状态
#         invoice_amount = payment.get('invoice_amount')
#         invoice_number = payment.get('invoice_number')
#         # 只要有金额或号码，就认为“已开票”这个动作发生了
#         invoice_issued = bool(invoice_amount or invoice_number)

#         status_dict['customer_is_paid'] = is_paid
#         status_dict['customer_payment_date'] = payment.get('payment_date')
#         status_dict['customer_payment_channel'] = payment.get('payment_channel')
#         status_dict['invoice_needed'] = invoice_needed
#         status_dict['invoice_issued'] = invoice_issued # 使用我们动态计算的值

#         status_dict['是否打款'] = '是' if is_paid else '否'
#         status_dict['打款时间及渠道'] = f"{payment.get('payment_date', '') or '—'} / {payment.get('payment_channel', '') or '—'}"if is_paid else "—"
#         status_dict['发票记录'] = '无需开票' if not invoice_needed else ('已开票' if invoice_issued else '待开票')
#     else:
#         # --- 员工薪酬 (保持不变) ---
#         status_dict['employee_is_paid'] = is_paid
#         status_dict['employee_payout_date'] = payment.get('date')
#         status_dict['employee_payout_channel'] = payment.get('channel')
#         status_dict['是否领款'] = '是' if is_paid else '否'
#         status_dict['领款时间及渠道'] = f"{payment.get('date', '') or '—'} / {payment.get('channel', '') or '—'}" if is_paid else"—"

#     details['payment_status'] = status_dict

def _fill_group_fields(group_fields, calc, field_keys, is_substitute_payroll=False):
    for key in field_keys:
        if key in calc:
            # --- Gemini-generated code for debugging: Start ---
            if key == 'overtime_days':
                value_before = calc[key]
                current_app.logger.info(f"[BACKEND-DEBUG] Inside _fill_group_fields for 'overtime_days':")
                current_app.logger.info(f"  - Value from calculation_details (before processing): {value_before}")
                current_app.logger.info(f"  - Type of value: {type(value_before)}")
            # --- Gemini-generated code for debugging: End ---

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

            # --- Gemini-generated code for debugging: Start ---
            if key == 'overtime_days':
                value_after = group_fields[label]
                current_app.logger.info(f"  - Value assigned to group_fields (after processing): {value_after}")
                current_app.logger.info(f"  - Type of assigned value: {type(value_after)}")
            # --- Gemini-generated code for debugging: End ---


def admin_required(fn):
    return jwt_required()(fn)


@billing_bp.route("/sync-contracts", methods=["POST"])
@admin_required
def trigger_sync_contracts():
    try:
        task = sync_all_contracts_task.delay()
        return jsonify(
            {"message": "合同同步任务已成功提交到后台处理。", "task_id": task.id}
        ), 202
    except Exception:
        return jsonify({"error": "提交后台任务时发生错误"}), 500


@billing_bp.route("/calculate-bills", methods=["POST"])
@admin_required
def trigger_calculate_bills():
    # 这个接口用于【批量计算】，应该触发【异步任务】
    data = request.get_json()
    year = data.get("year")
    month = data.get("month")
    if not all([year, month]):
        return jsonify({"error": "缺少 year 和 month 参数"}), 400

    # 调用 Celery 任务，使用 .delay()
    task = calculate_monthly_billing_task.delay(
        year=year, month=month, force_recalculate=False
    )
    return jsonify({"task_id": task.id, "message": "批量计算任务已提交"})


# 新增一个用于强制重算的接口
@billing_bp.route("/force-recalculate", methods=["POST"])
@admin_required
def force_recalculate_bill():
    # 这个接口用于【单个强制重算】，也应该触发【异步任务】，以避免请求超时
    data = request.get_json()
    contract_id = data.get("contract_id")
    year = data.get("year")
    month = data.get("month")
    if not all([contract_id, year, month]):
        return jsonify({"error": "缺少必要参数"}), 400

    # 调用 Celery 任务，并传递所有参数
    task = calculate_monthly_billing_task.delay(
        year=year, month=month, contract_id=contract_id, force_recalculate=True
    )
    return jsonify({"message": "强制重算任务已提交", "task_id": task.id})


@billing_bp.route("/attendance", methods=["POST"])
@admin_required
def save_attendance():
    data = request.get_json()
    # 简化输入，只需要加班天数
    required_fields = [
        "contract_id",
        "cycle_start_date",
        "cycle_end_date",
        "overtime_days",
        "billing_year",
        "billing_month",
    ]
    if not all(field in data for field in required_fields):
        return jsonify({"error": "缺少必要字段"}), 400

    try:
        contract_id = data["contract_id"]
        cycle_start = datetime.strptime(data["cycle_start_date"], "%Y-%m-%d").date()
        cycle_end = datetime.strptime(data["cycle_end_date"], "%Y-%m-%d").date()
        overtime_days = int(data["overtime_days"])
        billing_year = int(data["billing_year"])
        billing_month = int(data["billing_month"])

        contract = BaseContract.query.get(contract_id)
        if not contract:
            return jsonify({"error": "关联合同未找到"}), 404

        employee_id = contract.user_id or contract.service_personnel_id
        if not employee_id:
            return jsonify({"error": "合同未关联任何员工"}), 400

        attendance_record = AttendanceRecord.query.filter_by(
            contract_id=contract_id, cycle_start_date=cycle_start
        ).first()

        if attendance_record:
            attendance_record.overtime_days = overtime_days
            # 删掉 statutory_holiday_days 的处理，统一为 overtime_days
            attendance_record.statutory_holiday_days = 0
            attendance_record.total_days_worked = 26 + overtime_days
            msg = "考勤记录更新成功"
        else:
            attendance_record = AttendanceRecord(
                employee_id=employee_id,
                contract_id=contract_id,
                cycle_start_date=cycle_start,
                cycle_end_date=cycle_end,
                overtime_days=overtime_days,
                statutory_holiday_days=0,
                total_days_worked=26 + overtime_days,
            )
            db.session.add(attendance_record)
            msg = "考勤记录创建成功"

        db.session.commit()

        # 自动触发重算
        engine = BillingEngine()
        engine.calculate_for_month(billing_year, billing_month)

        latest_details = _get_billing_details_internal(
            contract_id=contract_id,
            year=billing_year,
            month=billing_month,
            cycle_start_date_from_bill=cycle_start,
            is_substitute_bill=False,
        )

        return jsonify(
            {"message": f"{msg}，账单已自动重算。", "latest_details": latest_details}
        )

    except Exception as e:
        current_app.logger.error(f"保存考勤记录失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500


@billing_bp.route("/bills", methods=["GET"])
@admin_required
def get_bills():
    try:
        page = request.args.get("page", 1, type=int)
        per_page = request.args.get("per_page", 100, type=int)
        search_term = request.args.get("search", "").strip()
        contract_type = request.args.get("type", "")
        status = request.args.get("status", "")
        billing_month_str = request.args.get("billing_month")
        payment_status_filter = request.args.get("payment_status", "")
        payout_status_filter = request.args.get("payout_status", "") # V2 修改

        if not billing_month_str:
            return jsonify({"error": "必须提供账单月份 (billing_month) 参数"}), 400

        billing_year, billing_month = map(int, billing_month_str.split("-"))

        contract_poly = with_polymorphic(BaseContract, "*")
        query = (
            db.session.query(CustomerBill, contract_poly)
            .select_from(CustomerBill)
            .join(contract_poly, CustomerBill.contract_id == contract_poly.id)
            .outerjoin(User, contract_poly.user_id == User.id)
            .outerjoin(
                ServicePersonnel,
                contract_poly.service_personnel_id == ServicePersonnel.id,
            )
        )

        query = query.filter(
            CustomerBill.year == billing_year, CustomerBill.month == billing_month
        )

        if status:
            query = query.filter(contract_poly.status == status)
        if contract_type:
            query = query.filter(contract_poly.type == contract_type)
        if search_term:
            query = query.filter(
                db.or_(
                    contract_poly.customer_name.ilike(f"%{search_term}%"),
                    User.username.ilike(f"%{search_term}%"),
                    ServicePersonnel.name.ilike(f"%{search_term}%"),
                )
            )

        if payment_status_filter:
            try:
                status_enum = PaymentStatus(payment_status_filter)
                query = query.filter(CustomerBill.payment_status == status_enum)
            except ValueError:
                pass

        # 【V2 修改】根据新的 payout_status 枚举进行过滤
        if payout_status_filter:
            query = query.join(
                EmployeePayroll,
                and_(
                    EmployeePayroll.contract_id == CustomerBill.contract_id,
                    EmployeePayroll.cycle_start_date == CustomerBill.cycle_start_date,
                ),
            )
            try:
                status_enum = PayoutStatus(payout_status_filter)
                query = query.filter(EmployeePayroll.payout_status == status_enum)
            except ValueError:
                pass

        query = query.order_by(
            contract_poly.customer_name, CustomerBill.cycle_start_date
        )

        filtered_bill_ids_query = query.with_entities(CustomerBill.id)
        filtered_bill_ids = [item[0] for item in filtered_bill_ids_query.all()]

        total_management_fee = 0
        if filtered_bill_ids:
            total_management_fee = db.session.query(
                func.sum(CustomerBill.calculation_details['management_fee'].as_float())
            ).filter(
                CustomerBill.id.in_(filtered_bill_ids)
            ).scalar() or 0

        paginated_results = query.paginate(
            page=page, per_page=per_page, error_out=False
        )

        results = []
        engine = BillingEngine()

        # 【V2 修改】定义状态到中文的映射
        status_map = {
            PaymentStatus.PAID: "已支付",
            PaymentStatus.UNPAID: "未支付",
            PaymentStatus.PARTIALLY_PAID: "部分支付",
            PaymentStatus.OVERPAID: "超额支付",
        }

        payout_status_map = {
            PayoutStatus.PAID: "已发放",
            PayoutStatus.UNPAID: "未发放",
            PayoutStatus.PARTIALLY_PAID: "部分发放",
        }

        for i, (bill, contract) in enumerate(paginated_results.items):
            payroll = EmployeePayroll.query.filter_by(
                contract_id=bill.contract_id, cycle_start_date=bill.cycle_start_date
            ).first()

            invoice_balance = engine.calculate_invoice_balance(str(bill.id))

            item = {
                "id": str(bill.id),
                "contract_id": str(contract.id),
                "customer_name": contract.customer_name,
                "status": contract.status,
                "customer_payable": str(bill.total_due), # <-- 修改
                "customer_is_paid": bill.payment_status == PaymentStatus.PAID, # <-- 修改
                "is_deferred": False, # <-- 旧字段，暂时硬编码为False
                "employee_payout": str(payroll.total_due) if payroll else "待计算",
                "employee_is_paid": payroll.payout_status == PayoutStatus.PAID if payroll else False,
                
                "is_substitute_bill": bill.is_substitute_bill,
                "contract_type_label": get_contract_type_details(contract.type),
                "is_monthly_auto_renew": getattr(contract, 'is_monthly_auto_renew', False),
                "contract_type_value": contract.type,
                "employee_level": str(contract.employee_level or "0"),
                "active_cycle_start": bill.cycle_start_date.isoformat() if bill.cycle_start_date else None,
                "active_cycle_end": bill.cycle_end_date.isoformat() if bill.cycle_end_date else None,
                "invoice_needed": invoice_balance.get("auto_invoice_needed", False),
                "remaining_invoice_amount": str(invoice_balance.get("remaining_un_invoiced", "0.00")),
                # 【V2 新增】返回新的支付状态文本
                "payment_status_label": status_map.get(bill.payment_status, "未知"),
                "payout_status_label": payout_status_map.get(payroll.payout_status, "未知") if payroll else "未知",
            }

            start = contract.start_date.isoformat() if contract.start_date else "—"
            end = contract.end_date.isoformat() if contract.end_date else "—"
            item["contract_period"] = f"{start} ~ {end}"

            original_employee = contract.user or contract.service_personnel
            item["employee_name"] = getattr(
                original_employee,
                "username",
                getattr(original_employee, "name", "未知员工"),
            )

            if bill.is_substitute_bill:
                item["contract_type_label"] = (
                    f"{item.get('contract_type_label', '未知类型')} (替)"
                )
                sub_record = bill.source_substitute_record
                if sub_record:
                    sub_employee = (
                        sub_record.substitute_user or sub_record.substitute_personnel
                    )
                    item["employee_name"] = getattr(
                        sub_employee,
                        "username",
                        getattr(sub_employee, "name", "未知替班员工"),
                    )
                    item["employee_level"] = str(sub_record.substitute_salary or "0")
                    item["active_cycle_start"] = sub_record.start_date.isoformat()
                    item["active_cycle_end"] = sub_record.end_date.isoformat()
                else:
                    item["employee_name"] = "替班(记录丢失)"
                    item["employee_level"] = "N/A"

            results.append(item)

        return jsonify(
            {
                "items": results,
                "total": paginated_results.total,
                "page": paginated_results.page,
                "per_page": paginated_results.per_page,
                "pages": paginated_results.pages,
                "summary": {
                    "total_management_fee": str(D(total_management_fee).quantize(D('0.01')))
                }
            }
        )
    except Exception as e:
        current_app.logger.error(f"获取账单列表失败: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


# --- 新增：批量获取账单摘要的API ---
@billing_bp.route("/summary", methods=["POST"])
@admin_required
def get_billing_summaries():
    data = request.get_json()
    contract_ids = data.get("contract_ids", [])
    billing_month_str = data.get("billing_month")
    if not contract_ids or not billing_month_str:
        return jsonify({"error": "缺少合同ID列表或账单月份"}), 400

    billing_year, billing_month = map(int, billing_month_str.split("-"))

    try:
        summaries = (
            db.session.query(CustomerBill.contract_id, CustomerBill.total_due)
            .filter(
                CustomerBill.contract_id.in_(contract_ids),
                CustomerBill.year == billing_year,
                CustomerBill.month == billing_month,
            )
            .all()
        )

        # 将结果转换为字典，方便前端查找
        summary_map = {
            str(contract_id): str(total_due)
            for contract_id, total_due in summaries
        }

        return jsonify(summary_map)
    except Exception as e:
        current_app.logger.error(f"获取账单摘要失败: {e}", exc_info=True)
        return jsonify({"error": "获取账单摘要时发生服务器内部错误"}), 500


@billing_bp.route("/details", methods=["GET"])
@admin_required
def get_billing_details():
    bill_id = request.args.get("bill_id")
    if not bill_id:
        return jsonify({"error": "缺少 bill_id 参数"}), 400

    try:
        # 1. 调用旧的内部函数获取基础信息
        details = _get_billing_details_internal(bill_id=bill_id)
        if details is None:
            return jsonify({"error": "获取账单详情失败"}), 404

        # 2. 调用新的发票余额计算引擎
        engine = BillingEngine()
        invoice_balance = engine.calculate_invoice_balance(bill_id)

        # 3. 将发票余额信息合并到返回结果中
        details["invoice_balance"] = invoice_balance

        # 4. 单独补充账单自身的 "invoice_needed" 状态
        target_bill = db.session.get(CustomerBill, bill_id)
        details["invoice_needed"] = (target_bill.payment_details or {}).get("invoice_needed", False) if target_bill else False


        return jsonify(details)
    except Exception as e:
        current_app.logger.error(f"获取账单详情失败: {e}", exc_info=True)
        return jsonify({"error": "获取账单详情时发生服务器内部错误"}), 500


# --- 新增：计算前预检查的API ---
@billing_bp.route("/pre-check", methods=["POST"])  # <--- 方法从 GET 改为 POST
@admin_required
def pre_check_billing():
    # --- 核心修正：从请求体中获取合同ID列表 ---
    data = request.get_json()
    if not data:
        return jsonify({"error": "缺少请求体"}), 400

    contract_ids = data.get("contract_ids", [])
    if not contract_ids:
        # 如果前端列表为空，直接返回空结果，是正常情况
        return jsonify([])

    # 查找这些合同中，是月嫂合同且缺少实际上户日期的
    missing_date_contracts = (
        MaternityNurseContract.query.filter(
            MaternityNurseContract.id.in_(contract_ids),  # <--- 只在提供的ID中查找
            MaternityNurseContract.actual_onboarding_date is None,
        )
        .join(User, BaseContract.user_id == User.id, isouter=True)
        .join(
            ServicePersonnel,
            BaseContract.service_personnel_id == ServicePersonnel.id,
            isouter=True,
        )
        .add_columns(User.username, ServicePersonnel.name.label("sp_name"))
        .all()
    )

    results = []
    for contract, user_name, sp_name in missing_date_contracts:
        results.append(
            {
                "id": str(contract.id),
                "customer_name": contract.customer_name,
                "employee_name": user_name or sp_name or "未知员工",
                "provisional_start_date": contract.provisional_start_date.isoformat()
                if contract.provisional_start_date
                else None,
            }
        )

    return jsonify(results)


@billing_bp.route("/contracts/<uuid:contract_id>", methods=["PUT"])
@admin_required
def update_single_contract(contract_id):
    """
    一个通用的、用于更新单个合同字段的API。
    当月嫂合同的实际上户日期被设置时，会触发一个后台任务来串行生成所有账单。
    """
    contract = db.session.get(BaseContract, str(contract_id))
    if not contract:
        return jsonify({"error": "合同未找到"}), 404

    data = request.get_json()
    if not data:
        return jsonify({"error": "缺少更新数据"}), 400

    try:
        should_generate_bills = False
        log_details = {}

        if "actual_onboarding_date" in data:
            new_onboarding_date_str = data["actual_onboarding_date"]
            if new_onboarding_date_str:
                new_onboarding_date = datetime.strptime(new_onboarding_date_str, "%Y-%m-%d")
                if isinstance(contract, MaternityNurseContract):

                    existing_date_obj = contract.actual_onboarding_date
                    existing_date = existing_date_obj.date() if isinstance(existing_date_obj,datetime) else existing_date_obj

                    if existing_date != new_onboarding_date.date():
                        contract.actual_onboarding_date = new_onboarding_date

                        provisional_start_obj = contract.provisional_start_date
                        provisional_start = provisional_start_obj.date() if isinstance(provisional_start_obj, datetime) else provisional_start_obj

                        original_end_obj = contract.end_date
                        original_end = original_end_obj.date() if isinstance(original_end_obj,datetime) else original_end_obj

                        if provisional_start and original_end:
                            total_days = (original_end - provisional_start).days
                            contract.expected_offboarding_date = new_onboarding_date +timedelta(days=total_days)
                        else:
                            contract.expected_offboarding_date = new_onboarding_date +timedelta(days=26)

                        should_generate_bills = True
                else:
                    return jsonify({"error": "只有月嫂合同才能设置实际上户日期"}), 400
            else:
                if isinstance(contract, MaternityNurseContract):
                    contract.actual_onboarding_date = None
                    contract.expected_offboarding_date = None

        if "introduction_fee" in data and hasattr(contract, 'introduction_fee'):
            new_fee = D(data["introduction_fee"] or 0)
            if contract.introduction_fee != new_fee:
                log_details['介绍费'] = {'from': str(contract.introduction_fee), 'to': str(new_fee)}
                contract.introduction_fee = new_fee

        if "notes" in data:
            original_note = contract.notes or ""
            appended_note = data["notes"] or ""
            separator = "\\n\\n--- 运营备注 ---\\n"
            if separator in original_note:
                base_note = original_note.split(separator)[0]
                new_full_note = f"{base_note}{separator}{appended_note}"
            else:
                new_full_note = f"{original_note}{separator}{appended_note}"
            if contract.notes != new_full_note:
                log_details['备注'] = {'from': contract.notes, 'to': new_full_note}
                contract.notes = new_full_note

        if log_details:
            any_bill = CustomerBill.query.filter_by(contract_id=contract.id).first()
            any_payroll = EmployeePayroll.query.filter_by(contract_id=contract.id).first()
            _log_activity(any_bill, any_payroll, "更新了合同详情", details=log_details)

        db.session.commit()

        if should_generate_bills:
            current_app.logger.info(f"为合同 {contract.id} 触发统一的后台账单生成任务...")
            generate_all_bills_for_contract_task.delay(str(contract.id))
            return jsonify({"message": "合同信息更新成功，并已在后台开始生成所有相关账单。"})

        return jsonify({"message": "合同信息更新成功"})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新合同 {contract_id} 失败: {e}", exc_info=True)
        return jsonify({"error": "更新合同失败，服务器内部错误"}), 500

def _apply_all_adjustments_and_settlements(adjustments_data, bill, payroll):
    """(V9 - 最终正确记账版) 处理所有调整项，确保结算记录归属正确。"""
    user_id = get_jwt_identity()
    old_adjustments = FinancialAdjustment.query.filter(
        or_(FinancialAdjustment.customer_bill_id == bill.id,FinancialAdjustment.employee_payroll_id == payroll.id)
    ).all()
    old_adjustments_map = {str(adj.id): adj for adj in old_adjustments}
    new_adjustments_ids = {str(adj.get('id')) for adj in adjustments_data if adj.get('id')}

    employee = payroll.contract.user or payroll.contract.service_personnel
    employee_name = employee.username if hasattr(employee, 'username') else employee.name if employee else "未知员工"

    # 删除
    for old_id, old_adj in old_adjustments_map.items():
        if old_id not in new_adjustments_ids:
            if old_adj.is_settled and old_adj.details and 'linked_record' in old_adj.details:
                linked_record_info = old_adj.details['linked_record']
                record_id, record_type = linked_record_info.get('id'),linked_record_info.get('type')
                if record_id and record_type == 'payment':
                    db.session.query(PaymentRecord).filter_by(id=record_id).delete()
                elif record_id and record_type == 'payout':
                    db.session.query(PayoutRecord).filter_by(id=record_id).delete()
            db.session.delete(old_adj)

    # 新增或更新
    for adj_data in adjustments_data:
        adj_id = str(adj_data.get('id', ''))
        adj_type = AdjustmentType(adj_data["adjustment_type"])
        adj_amount = D(adj_data["amount"])
        adj_description = adj_data["description"]
        is_settled = adj_data.get('is_settled', False)
        settlement_date_str = adj_data.get('settlement_date')
        settlement_date = date_parse(settlement_date_str).date() if settlement_date_str else date.today()
        settlement_details = adj_data.get('settlement_details')

        if adj_id and adj_id in old_adjustments_map:
            existing_adj = old_adjustments_map[adj_id]
            if existing_adj.details is None: existing_adj.details = {}

            settlement_method = (settlement_details or {}).get('notes') or'settlement'

            # 状态变更1：从未结算 -> 已结算 (创建记录)
            if is_settled and not existing_adj.is_settled:
                new_record, record_type = None, None
                record_notes = f"[来自结算调整项] {adj_description}"

                if adj_type == AdjustmentType.CUSTOMER_INCREASE:
                    new_record = PaymentRecord(customer_bill_id=bill.id, amount=abs(adj_amount), payment_date=settlement_date, method=settlement_method,notes=record_notes, created_by_user_id=user_id)
                    record_type = 'payment'
                elif adj_type in [AdjustmentType.CUSTOMER_DECREASE,AdjustmentType.CUSTOMER_DISCOUNT]:
                    # 【关键修正】客户侧的减款/优惠是负向的“收款记录”
                    new_record = PaymentRecord(customer_bill_id=bill.id, amount=abs(adj_amount) * -1, payment_date=settlement_date, method=settlement_method,notes=f"[客户退款] {adj_description}", created_by_user_id=user_id)
                    record_type = 'payment'
                elif adj_type == AdjustmentType.EMPLOYEE_INCREASE:
                    new_record = PayoutRecord(employee_payroll_id=payroll.id,amount=abs(adj_amount), payout_date=settlement_date, method=settlement_method,notes=record_notes, payer='公司', created_by_user_id=user_id)
                    record_type = 'payout'
                elif adj_type == AdjustmentType.EMPLOYEE_DECREASE:
                    new_record = PayoutRecord(employee_payroll_id=payroll.id,amount=abs(adj_amount) * -1, payout_date=settlement_date,method=settlement_method, notes=f"[员工缴款] {adj_description}",payer=employee_name, created_by_user_id=user_id)
                    record_type = 'payout'

                if new_record:
                    db.session.add(new_record)
                    db.session.flush()
                    existing_adj.details['linked_record'] = {'id': str(new_record.id), 'type': record_type}

            # 状态变更2：从已结算 -> 未结算 (删除记录)
            elif not is_settled and existing_adj.is_settled:
                linked_record_info = existing_adj.details.pop('linked_record',None)
                if linked_record_info:
                    record_id, record_type = linked_record_info.get('id'),linked_record_info.get('type')
                    if record_id and record_type == 'payment':
                        db.session.query(PaymentRecord).filter_by(id=record_id).delete()
                    elif record_id and record_type == 'payout':
                        db.session.query(PayoutRecord).filter_by(id=record_id).delete()

            # 状态变更3：已结算 -> 已结算 (更新记录)
            elif is_settled and existing_adj.is_settled:
                linked_record_info = existing_adj.details.get('linked_record')
                if linked_record_info:
                    record_id, record_type = linked_record_info.get('id'),linked_record_info.get('type')
                    record_to_update = None
                    if record_type == 'payment':
                        record_to_update = db.session.get(PaymentRecord,record_id)
                        if record_to_update: record_to_update.payment_date =settlement_date
                    elif record_type == 'payout':
                        record_to_update = db.session.get(PayoutRecord, record_id)
                        if record_to_update: record_to_update.payout_date =settlement_date

                    if record_to_update:
                        record_to_update.method = settlement_method
                        # 根据类型决定金额是正是负
                        if adj_type in [AdjustmentType.CUSTOMER_DECREASE,AdjustmentType.CUSTOMER_DISCOUNT, AdjustmentType.EMPLOYEE_DECREASE]:
                             record_to_update.amount = abs(adj_amount) * -1
                        else:
                             record_to_update.amount = abs(adj_amount)

            # 更新 adjustment 自身的信息
            existing_adj.amount = abs(adj_amount)
            existing_adj.description = adj_description
            existing_adj.adjustment_type = adj_type
            existing_adj.is_settled = is_settled
            existing_adj.settlement_date = settlement_date
            existing_adj.settlement_details = settlement_details
            attributes.flag_modified(existing_adj, "details")

        elif not adj_id or 'temp' in adj_id:
            # 新增调整项的逻辑
            new_adj = FinancialAdjustment(
                adjustment_type=adj_type, amount=abs(adj_amount),description=adj_description,
                date=bill.cycle_start_date, is_settled=is_settled,
                settlement_date=settlement_date,settlement_details=settlement_details
            )
            if adj_type.name.startswith("CUSTOMER"):
                new_adj.customer_bill_id = bill.id
            else:
                new_adj.employee_payroll_id = payroll.id
            db.session.add(new_adj)

    # 在所有循环结束后，统一更新一次账单和薪酬单的状态
    _update_bill_payment_status(bill)
    _update_payroll_payout_status(payroll)

@billing_bp.route("/batch-update", methods=["POST"])
@admin_required
def batch_update_billing_details():
    data = request.get_json()
    bill_id = data.get("bill_id")
    if not bill_id:
        return jsonify({"error": "请求体中缺少 bill_id"}), 400

    try:
        bill = db.session.get(CustomerBill, bill_id)
        if not bill:
            return jsonify({"error": "账单未找到"}), 404

        payroll = EmployeePayroll.query.filter_by(
            contract_id=bill.contract_id,
            cycle_start_date=bill.cycle_start_date,
            is_substitute_payroll=bill.is_substitute_bill,
        ).first()

        if not payroll:
            return jsonify({"error": f"未找到与账单ID {bill_id} 关联的薪酬单"}), 404

        engine = BillingEngine()

        # 【V2.0 重构】
        # 这个函数现在只负责处理非支付类的更新，例如：
        # - 调整项 (通过 _apply_all_adjustments_and_settlements)
        # - 发票记录
        # - 加班天数
        # - 实际工作天数
        # - 账单是否需要开票
        #
        # 所有关于“支付/结算”状态的逻辑都已被移除，它们现在由 add_payment_record API 统一处理。

        # --- 1. 处理发票记录 ---
        invoices_from_frontend = data.get('invoices', [])
        if invoices_from_frontend:
            existing_invoices_map = {str(inv.id): inv for inv in bill.invoices}
            new_invoice_ids = {str(inv_data.get('id')) for inv_data in invoices_from_frontend if inv_data.get('id')}
            for inv_data in invoices_from_frontend:
                inv_id = inv_data.get('id')
                if inv_id and str(inv_id) in existing_invoices_map:
                    invoice_to_update = existing_invoices_map[str(inv_id)]
                    invoice_to_update.amount = D(inv_data.get('amount', '0'))
                    invoice_to_update.issue_date = date_parse(inv_data.get('issue_date')).date() if inv_data.get('issue_date')else None
                    invoice_to_update.invoice_number = inv_data.get('invoice_number')
                    invoice_to_update.notes = inv_data.get('notes')
                elif not inv_id or 'temp' in str(inv_id):
                    db.session.add(InvoiceRecord(
                        customer_bill_id=bill.id,
                        amount=D(inv_data.get('amount', '0')),
                        issue_date=date_parse(inv_data.get('issue_date')).date() if inv_data.get('issue_date') else None,
                        invoice_number=inv_data.get('invoice_number'),
                        notes=inv_data.get('notes')
                    ))
            for old_id, old_invoice in existing_invoices_map.items():
                if old_id not in new_invoice_ids:
                    db.session.delete(old_invoice)

        # --- 2. 处理其他可编辑字段 ---
        new_actual_work_days = D(str(data['actual_work_days'])) if 'actual_work_days' in data and data['actual_work_days'] is not None and data['actual_work_days'] != '' else None
        if new_actual_work_days is not None and bill.actual_work_days != new_actual_work_days:
            bill.actual_work_days = new_actual_work_days
            payroll.actual_work_days = new_actual_work_days

        new_overtime_decimal = D(str(data.get("overtime_days", "0")))
        attendance_record = AttendanceRecord.query.filter_by(contract_id=bill.contract_id,cycle_start_date=bill.cycle_start_date).first()
        if attendance_record:
            if attendance_record.overtime_days.quantize(D('0.01')) != new_overtime_decimal.quantize(D('0.01')):
                attendance_record.overtime_days = new_overtime_decimal
        elif new_overtime_decimal > 0:
            employee_id = bill.contract.user_id or bill.contract.service_personnel_id
            if employee_id:
                db.session.add(AttendanceRecord(
                    employee_id=employee_id, contract_id=bill.contract_id,
                    cycle_start_date=bill.cycle_start_date, cycle_end_date=bill.cycle_end_date,
                    overtime_days=new_overtime_decimal, total_days_worked=0
                ))

        if 'invoice_needed' in data:
            bill.invoice_needed = data.get('invoice_needed', False)

        # --- 3. 处理财务调整项 ---
        if 'adjustments' in data:
            adjustments_data = data.get('adjustments', [])
            _apply_all_adjustments_and_settlements(adjustments_data, bill, payroll)

        # --- 4. 运行引擎重算 ---
        # 注意：我们不再需要运行两次引擎，因为支付状态的变更已经和这个函数解耦
        engine.calculate_for_month(
            year=bill.year, month=bill.month, contract_id=bill.contract_id,
            force_recalculate=True, actual_work_days_override=new_actual_work_days,
            cycle_start_date_override=bill.cycle_start_date
        )

        # --- 5. 提交所有更改 ---
        db.session.commit()

        # --- 6. 返回最新数据 ---
        latest_details = _get_billing_details_internal(bill_id=bill.id)
        return jsonify({"message": "账单已更新并成功重算！", "latest_details": latest_details})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"批量更新失败 (bill_id: {bill_id}): {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500


@billing_bp.route("/logs", methods=["GET"])
@admin_required
def get_activity_logs():
    bill_id = request.args.get("bill_id")
    payroll_id = request.args.get("payroll_id")

    # 至少需要一个ID
    if not bill_id and not payroll_id:
        return jsonify({"error": "缺少 bill_id 或 payroll_id 参数"}), 400

    # 构建一个灵活的查询过滤器
    # **核心修正**: 使用 or_() 来查询关联到任意一个ID的日志
    from sqlalchemy import or_

    filters = []
    if bill_id:
        filters.append(FinancialActivityLog.customer_bill_id == bill_id)
    if payroll_id:
        filters.append(FinancialActivityLog.employee_payroll_id == payroll_id)

    logs = (
        FinancialActivityLog.query.filter(or_(*filters))
        .order_by(FinancialActivityLog.created_at.desc())
        .all()
    )

    results = [
        {
            "id": str(log.id),
            "user": log.user.username if log.user else "未知用户",
            "action": log.action,
            "details": log.details,
            "created_at": log.created_at.isoformat(),
        }
        for log in logs
    ]
    return jsonify(results)


# Helper function to get contract type label
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

@billing_bp.route("/contracts/eligible-for-transfer", methods=["GET"])
@admin_required
def get_eligible_contracts_for_transfer():
    """
    获取用于保证金转移的目标合同列表。
    列表只包含同一客户名下、状态为 active 的、非当前的其它合同。
    """
    customer_name = request.args.get("customer_name")
    exclude_contract_id = request.args.get("exclude_contract_id")

    if not customer_name or not exclude_contract_id:
        return jsonify({"error": "缺少 customer_name 或 exclude_contract_id 参数"}), 400

    try:
        eligible_contracts = BaseContract.query.filter(
            BaseContract.customer_name == customer_name,
            BaseContract.id != exclude_contract_id,
            BaseContract.status == 'active'
        ).order_by(BaseContract.start_date.desc()).all()

        results = [
            {
                "id": str(contract.id),
                "label": f"{get_contract_type_details(contract.type)} - {contract.user.username if contract.user else contract.service_personnel.name} ({contract.start_date.strftime('%Y-%m-%d')}生效)"
            }
            for contract in eligible_contracts
        ]

        return jsonify(results)

    except Exception as e:
        current_app.logger.error(f"获取可转移合同列表失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

@billing_bp.route("/contracts", methods=["GET"])
@admin_required
def get_all_contracts():
    try:
        page = request.args.get("page", 1, type=int)
        per_page = request.args.get("per_page", 100, type=int)
        search_term = request.args.get("search", "").strip()
        contract_type = request.args.get("type", "")
        status = request.args.get("status", "active")
        sort_by = request.args.get("sort_by", None)
        sort_order = request.args.get("sort_order", "asc")

        query = (
            BaseContract.query.options(
                db.joinedload(BaseContract.user),
                db.joinedload(BaseContract.service_personnel),
            )
            .join(User, BaseContract.user_id == User.id, isouter=True)
            .join(
                ServicePersonnel,
                BaseContract.service_personnel_id == ServicePersonnel.id,
                isouter=True,
            )
        )

        if status and status != "all":
            query = query.filter(BaseContract.status == status)

        if contract_type:
            query = query.filter(BaseContract.type == contract_type)
        if search_term:
            query = query.filter(
                db.or_(
                    BaseContract.customer_name.ilike(f"%{search_term}%"),
                    BaseContract.customer_name_pinyin.ilike(f"%{search_term}%"),
                    User.username.ilike(f"%{search_term}%"),
                    User.name_pinyin.ilike(f"%{search_term}%"),
                    ServicePersonnel.name.ilike(f"%{search_term}%"),
                    ServicePersonnel.name_pinyin.ilike(f"%{search_term}%"),
                )
            )

        today = date.today()

        if sort_by == "remaining_days":
            end_date_expr = case(
                (
                    MaternityNurseContract.expected_offboarding_date is not None,
                    MaternityNurseContract.expected_offboarding_date,
                ),
                else_=BaseContract.end_date,
            )
            order_expr = case(
                (NannyContract.is_monthly_auto_renew, date(9999, 12, 31)),
                else_=end_date_expr,
            )
            if sort_order == "desc":
                query = query.order_by(db.desc(order_expr))
            else:
                query = query.order_by(db.asc(order_expr))
        else:
            query = query.order_by(BaseContract.start_date.desc())

        paginated_contracts = query.paginate(
            page=page, per_page=per_page, error_out=False
        )

        results = []
        for contract in paginated_contracts.items:
            employee_name = (
                contract.user.username
                if contract.user
                else contract.service_personnel.name
                if contract.service_personnel
                else "未知员工"
            )

            remaining_months_str = "N/A"
            highlight_remaining = False

            # 【关键修复】使用 isinstance 进行类型检查，兼容 datetime 和 date 对象
            start_date_dt = contract.actual_onboarding_date or contract.start_date
            start_date_for_calc = None
            if isinstance(start_date_dt, datetime):
                start_date_for_calc = start_date_dt.date()
            elif isinstance(start_date_dt, date):
                start_date_for_calc = start_date_dt

            end_date_dt = None
            if contract.type == "maternity_nurse":
                end_date_dt = (
                    contract.expected_offboarding_date or contract.end_date
                )
            else:
                end_date_dt = contract.end_date

            end_date_for_calc = None
            if isinstance(end_date_dt, datetime):
                end_date_for_calc = end_date_dt.date()
            elif isinstance(end_date_dt, date):
                end_date_for_calc = end_date_dt

            today = date.today()
            if isinstance(contract, NannyContract) and getattr(
                contract, "is_monthly_auto_renew", False
            ):
                remaining_months_str = "月签"
            elif start_date_for_calc and end_date_for_calc:
                if start_date_for_calc > today:
                    remaining_months_str = "合同未开始"
                elif end_date_for_calc > today:
                    total_days_remaining = (end_date_for_calc - today).days

                    if contract.type == "nanny" and total_days_remaining < 30:
                        highlight_remaining = True

                    if total_days_remaining >= 365:
                        years = total_days_remaining // 365
                        months = (total_days_remaining % 365) // 30
                        remaining_months_str = f"约{years}年{months}个月"
                    elif total_days_remaining >= 30:
                        months = total_days_remaining // 30
                        remaining_months_str = f"{months}个月"
                    elif total_days_remaining >= 0:
                        remaining_months_str = f"{total_days_remaining}天"
                    else:
                        remaining_months_str = "已结束"
                else:
                    remaining_months_str = "已结束"

            results.append(
                {
                    "id": str(contract.id),
                    "customer_name": contract.customer_name,
                    "employee_name": employee_name,
                    "contract_type_value": contract.type,
                    "contract_type_label": get_contract_type_details(contract.type),
                    "status": contract.status,
                    "employee_level": contract.employee_level,
                    "start_date": contract.start_date.isoformat() if contract.start_date else None,
                    "end_date": contract.end_date.isoformat() if contract.end_date else None,
                    "actual_onboarding_date": getattr(contract,"actual_onboarding_date", None),
                    "provisional_start_date": getattr(contract,"provisional_start_date", None),
                    "remaining_months": remaining_months_str,
                    "highlight_remaining": highlight_remaining,
                }
            )

        return jsonify(
            {
                "items": results,
                "total": paginated_contracts.total,
                "page": paginated_contracts.page,
                "per_page": paginated_contracts.per_page,
                "pages": paginated_contracts.pages,
            }
        )

    except Exception as e:
        current_app.logger.error(f"获取所有合同列表失败: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@billing_bp.route("/personnel/search", methods=["GET"])
@admin_required
def search_personnel():
    """
    用于前端自动补全，搜索员工/服务人员。
    """
    query_str = request.args.get("q", "").strip()
    if not query_str:
        return jsonify([])

    search_term = f"%{query_str}%"

    # 查询 User 表
    users = User.query.filter(
        or_(
            User.username.ilike(search_term),
            User.name_pinyin.ilike(search_term)
        )
    ).limit(10).all()

    # 查询 ServicePersonnel 表
    service_personnel = ServicePersonnel.query.filter(
        or_(
            ServicePersonnel.name.ilike(search_term),
            ServicePersonnel.name_pinyin.ilike(search_term)
        )
    ).limit(10).all()

    results = []
    seen_names = set()

    for u in users:
        if u.username not in seen_names:
            results.append({"id": str(u.id), "name": u.username, "source": "user"})
            seen_names.add(u.username)

    for sp in service_personnel:
        if sp.name not in seen_names:
            results.append({"id": str(sp.id), "name": sp.name, "source": "service_personnel"})
            seen_names.add(sp.name)

    # 可以根据需要对结果进行排序
    results.sort(key=lambda x: x['name'])

    return jsonify(results)


@billing_bp.route("/customers/search", methods=["GET"])
@admin_required
def search_customers():
    """
    用于前端自动补全，搜索已存在的客户名称。
    """
    query_str = request.args.get("q", "").strip()
    if not query_str:
        return jsonify([])

    search_term = f"%{query_str}%"

    # 在合同表中去重查找
    customers_query = db.session.query(BaseContract.customer_name).filter(
        or_(
            BaseContract.customer_name.ilike(search_term),
            BaseContract.customer_name_pinyin.ilike(search_term)
        )
    ).distinct().limit(10)

    results = [item[0] for item in customers_query.all()]

    return jsonify(results)

@billing_bp.route("/contracts/virtual", methods=["POST"])
@admin_required
def create_virtual_contract():
    """手动创建虚拟合同。"""
    data = request.get_json()
    if not data:
        return jsonify({"error": "请求体不能为空"}), 400

    required_fields = ["contract_type", "customer_name", "employee_name","employee_level", "start_date", "end_date"]
    if not all(field in data for field in required_fields):
        return jsonify({"error": f"缺少必要字段: {', '.join(required_fields)}"}),400

    try:
        employee_ref = _get_or_create_personnel_ref(data["employee_name"])

        customer_name = data["customer_name"]
        cust_pinyin_full = "".join(item[0] for item in pinyin(customer_name,style=Style.NORMAL))
        cust_pinyin_initials = "".join(item[0] for item in pinyin(customer_name,style=Style.FIRST_LETTER))
        customer_name_pinyin = f"{cust_pinyin_full} {cust_pinyin_initials}"

        common_params = {
            "customer_name": data["customer_name"],
            "customer_name_pinyin": customer_name_pinyin,
            "contact_person": data.get("contact_person"),
            "employee_level": D(data["employee_level"]),
            # 【关键修改】直接解析为 DateTime 对象，不再取 .date()
            "start_date": date_parse(data["start_date"]),
            "end_date": date_parse(data["end_date"]),
            "notes": data.get("notes"),
            "source": "virtual",
        }
        if employee_ref["type"] == "user":
            common_params["user_id"] = employee_ref["id"]
        else:
            common_params["service_personnel_id"] = employee_ref["id"]

        contract_type = data["contract_type"]
        new_contract = None

        if contract_type == "maternity_nurse":
            new_contract = MaternityNurseContract(
                **common_params,
                status="active",
                # 关键修改：直接使用 date_parse 解析为 datetime 对象
                provisional_start_date=date_parse(data["provisional_start_date"]) if data.get("provisional_start_date") else None,
                security_deposit_paid=D(data.get("security_deposit_paid") or 0),
                management_fee_amount=D(data.get("management_fee_amount") or 0),
                introduction_fee=D(data.get("introduction_fee") or 0)
            )
        elif contract_type == "nanny":
            new_contract = NannyContract(
                **common_params,
                status="active",
                is_monthly_auto_renew=data.get("is_monthly_auto_renew", False),
                management_fee_amount=D(data.get("management_fee_amount") or 0),
                introduction_fee=D(data.get("introduction_fee") or 0),
                security_deposit_paid=D(data["employee_level"])
            )
        elif contract_type == "nanny_trial":
            new_contract = NannyTrialContract(
                **common_params,
                status="trial_active",
                introduction_fee=D(data.get("introduction_fee") or 0)
            )
        # 【新增分支】
        elif contract_type == "external_substitution":
            new_contract = ExternalSubstitutionContract(
                **common_params,
                status="active", # 外部替班合同默认为 active
                management_fee_rate=D(data.get("management_fee_rate", 0.20)),
                management_fee_amount=D(data.get("management_fee_amount") or 0),
            )
        else:
            return jsonify({"error": "无效的合同类型"}), 400

        db.session.add(new_contract)
        db.session.commit()
        current_app.logger.info(f"成功创建虚拟合同，ID: {new_contract.id}, 类型: {contract_type}")

        # 根据合同类型，触发正确的后续处理任务
        if contract_type == "nanny":
            post_virtual_contract_creation_task.delay(str(new_contract.id))
            current_app.logger.info(f"已为育儿嫂合同 {new_contract.id} 提交后续处理任务。")
        elif contract_type == "maternity_nurse":
            generate_all_bills_for_contract_task.delay(str(new_contract.id))
            current_app.logger.info(f"已为月嫂合同 {new_contract.id} 提交账单生成任务。")
        elif contract_type == "external_substitution":
            # 对于外部替班合同，调用通用的月度计算任务即可，因为它只有一个账单
            calculate_monthly_billing_task.delay(
                year=new_contract.start_date.year,
                month=new_contract.start_date.month,
                contract_id=str(new_contract.id),
                force_recalculate=True
            )
            current_app.logger.info(f"已为外部替班合同 {new_contract.id} 提交月度账单计算任务。")

        return jsonify({
            "message": "虚拟合同创建成功！",
            "contract_id": str(new_contract.id)
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"创建虚拟合同失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误，创建失败"}), 500

# 批量生成月嫂合同账单
@billing_bp.route(
    "/contracts/<string:contract_id>/generate-all-bills", methods=["POST"]
)
@admin_required
def generate_all_bills_for_contract(contract_id):
    current_app.logger.info(
        f"--- [API START] 开始为合同 {contract_id} 批量生成账单 ---"
    )
    contract = db.session.get(MaternityNurseContract, contract_id)
    if (
        not contract
        or not contract.actual_onboarding_date
        or not contract.expected_offboarding_date
    ):
        return jsonify({"error": "合同未找到或缺少必要日期"}), 404

    try:
        cycle_start = contract.actual_onboarding_date
        processed_months = set()
        cycle_count = 0

        current_app.logger.info(
            f"[API] 准备进入循环，预计下户日期为: {contract.expected_offboarding_date}"
        )

        while cycle_start <= contract.expected_offboarding_date:
            cycle_count += 1
            cycle_end = cycle_start + timedelta(days=26)
            if cycle_end > contract.expected_offboarding_date:
                cycle_end = contract.expected_offboarding_date

            settlement_month_key = (cycle_end.year, cycle_end.month)

            if settlement_month_key not in processed_months:
                current_app.logger.info(
                    f"[API] 正在为周期 {cycle_start} ~ {cycle_end} 创建后台计算任务 (结算月: {settlement_month_key[0]}-{settlement_month_key[1]})"
                )
                calculate_monthly_billing_task.delay(
                    year=settlement_month_key[0],
                    month=settlement_month_key[1],
                    contract_id=str(contract.id),
                    force_recalculate=True,
                )
                processed_months.add(settlement_month_key)

            if cycle_end >= contract.expected_offboarding_date:
                break
            cycle_start = cycle_end + timedelta(days=1)

        if cycle_end == contract.expected_offboarding_date:
            current_app.logger.info(
                f"[API LOOP-{cycle_count}] 已到达预计下户日期，循环结束。"
            )

        current_app.logger.info(
            f"--- [API END] 所有周期处理完毕，共涉及月份: {processed_months} ---"
        )
        current_app.logger.info(
            f"--- [API END] 所有周期处理完毕，共循环 {cycle_count} 次。---"
        )

        return jsonify({"message": f"已为合同 {contract.id} 成功预生成所有账单。"})

    except Exception as e:
        # 这里的 rollback 可能不是必须的，因为引擎内部已经处理了
        current_app.logger.error(
            f"为合同 {contract_id} 批量生成账单时发生顶层错误: {e}", exc_info=True
        )
        return jsonify({"error": "批量生成账单失败"}), 500


@billing_bp.route("/contracts/<string:contract_id>/bills", methods=["GET"])
@admin_required
def get_bills_for_contract(contract_id):
    bills = (
        CustomerBill.query.filter_by(contract_id=contract_id)
        .order_by(CustomerBill.cycle_start_date.asc())
        .all()
    )

    results = []
    engine = BillingEngine()

    # 定义状态映射
    status_map = {
        PaymentStatus.PAID: "已支付",
        PaymentStatus.UNPAID: "未支付",
        PaymentStatus.PARTIALLY_PAID: "部分支付",
        PaymentStatus.OVERPAID: "超额支付",
    }


    for bill in bills:
        calc = bill.calculation_details or {}
        invoice_balance = engine.calculate_invoice_balance(str(bill.id))

        results.append(
            {
                "id": str(bill.id),
                "billing_period": f"{bill.year}-{str(bill.month).zfill(2)}",
                "cycle_start_date": bill.cycle_start_date.isoformat() if bill.cycle_start_date else "N/A",
                "cycle_end_date": bill.cycle_end_date.isoformat() if bill.cycle_end_date else "N/A",
                "total_due": str(bill.total_due),
                "status": status_map.get(bill.payment_status, "未知"), # <-- V2 修改
                "payment_status_label": status_map.get(bill.payment_status, "未知"), # <-- V2 新增
                "customer_is_paid": bill.payment_status == PaymentStatus.PAID, # <-- V2 新增
                "overtime_days": calc.get("overtime_days", "0"),
                "base_work_days": calc.get("base_work_days", "0"),
                "is_substitute_bill": bill.is_substitute_bill,
                "invoice_needed": (bill.payment_details or {}).get("invoice_needed", False),
                "remaining_invoice_amount": str(invoice_balance.get("remaining_un_invoiced", "0.00"))
            }
        )
    return jsonify(results)


# backend/api/billing_api.py (添加新端点)
# 更新月嫂账单周期，后续账单向后顺延
@billing_bp.route("/bills/<string:bill_id>/postpone", methods=["POST"])
@admin_required
def postpone_subsequent_bills(bill_id):
    data = request.get_json()
    new_end_date_str = data.get("new_end_date")
    if not new_end_date_str:
        return jsonify({"error": "缺少新的结束日期 (new_end_date)"}), 400

    try:
        new_end_date = datetime.strptime(new_end_date_str, "%Y-%m-%d").date()

        # 1. 找到当前被修改的账单及其关联的考勤记录
        target_bill = db.session.get(CustomerBill, bill_id)
        if not target_bill:
            return jsonify({"error": "目标账单未找到"}), 404

        target_attendance = AttendanceRecord.query.filter_by(
            contract_id=target_bill.contract_id,
            year=target_bill.year,
            month=target_bill.month,
        ).first()  # 假设通过年月能找到唯一考勤

        if not target_attendance:
            return jsonify({"error": "关联的考勤记录未找到，无法顺延"}), 404

        # 2. 更新当前考勤周期的结束日期
        # original_end_date = target_attendance.cycle_end_date
        target_attendance.cycle_end_date = new_end_date

        # 3. 找出所有后续的考勤记录
        subsequent_attendances = (
            AttendanceRecord.query.filter(
                AttendanceRecord.contract_id == target_bill.contract_id,
                AttendanceRecord.cycle_start_date > target_attendance.cycle_start_date,
            )
            .order_by(AttendanceRecord.cycle_start_date)
            .all()
        )

        # 4. 循环顺延更新后续所有周期
        current_start_date = new_end_date + timedelta(days=1)
        for attendance in subsequent_attendances:
            attendance.cycle_start_date = current_start_date
            attendance.cycle_end_date = current_start_date + timedelta(days=26)

            # 同时更新关联账单的年月
            related_bill = CustomerBill.query.filter_by(
                contract_id=attendance.contract_id,
                # 这里需要一个更可靠的方式来找到关联账单，例如通过考勤ID关联
            ).first()
            if related_bill:
                related_bill.year = attendance.cycle_end_date.year
                related_bill.month = attendance.cycle_end_date.month

            current_start_date = attendance.cycle_end_date + timedelta(days=1)

        db.session.commit()
        return jsonify({"message": "后续所有账单周期已成功顺延更新。"})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"顺延账单失败: {e}", exc_info=True)
        return jsonify({"error": "顺延操作失败"}), 500


# backend/api/billing_api.py (添加新端点)


@billing_bp.route("/bills/<string:bill_id>/update-cycle", methods=["POST"])
@admin_required
def update_bill_cycle_and_cascade(bill_id):
    data = request.get_json()
    new_start_str = data.get("new_start_date")
    new_end_str = data.get("new_end_date")

    if not all([new_start_str, new_end_str]):
        return jsonify({"error": "必须提供新的开始和结束日期"}), 400

    try:
        with db.session.begin():
            new_start_date = datetime.strptime(new_start_str, "%Y-%m-%d").date()
            new_end_date = datetime.strptime(new_end_str, "%Y-%m-%d").date()

            # 1. 找到当前被修改的账单及其关联考勤
            target_bill = db.session.get(CustomerBill, bill_id)
            if not target_bill:
                return jsonify({"error": "目标账单未找到"}), 404

            # **核心修正**: 使用周期重叠的方式查找关联的考勤记录
            year, month = target_bill.year, target_bill.month
            first_day_of_month = date(year, month, 1)
            last_day_of_month = (
                first_day_of_month.replace(day=28) + timedelta(days=4)
            ).replace(day=1) - timedelta(days=1)

            target_attendance = AttendanceRecord.query.filter(
                AttendanceRecord.contract_id == target_bill.contract_id,
                AttendanceRecord.cycle_end_date >= first_day_of_month,
                AttendanceRecord.cycle_start_date <= last_day_of_month,
            ).first()

            if not target_attendance:
                return jsonify({"error": "关联的考勤记录未找到"}), 404

            # 2. 更新当前周期的起止日期
            original_cycle_start = target_attendance.cycle_start_date
            target_attendance.cycle_start_date = new_start_date
            target_attendance.cycle_end_date = new_end_date

            # 3. 找出所有后续的考勤记录
            subsequent_attendances = (
                AttendanceRecord.query.filter(
                    AttendanceRecord.contract_id == target_bill.contract_id,
                    AttendanceRecord.cycle_start_date > original_cycle_start,
                )
                .order_by(AttendanceRecord.cycle_start_date)
                .all()
            )

            # 4. 循环顺延更新后续所有周期
            current_next_start_date = new_end_date + timedelta(days=1)
            for attendance in subsequent_attendances:
                # 获取旧周期的天数
                cycle_duration = (
                    attendance.cycle_end_date - attendance.cycle_start_date
                ).days

                # 设置新的起止日期
                attendance.cycle_start_date = current_next_start_date
                attendance.cycle_end_date = current_next_start_date + timedelta(
                    days=cycle_duration
                )

                # 找到并更新关联账单的年月（这依然是潜在的问题点）
                related_bill = CustomerBill.query.filter(
                    CustomerBill.contract_id == attendance.contract_id,
                    # ...需要一个可靠的方式找到bill
                ).first()
                if related_bill:
                    related_bill.year = attendance.cycle_end_date.year
                    related_bill.month = attendance.cycle_end_date.month

                current_next_start_date = attendance.cycle_end_date + timedelta(days=1)

        return jsonify({"message": "当前周期已更新，且所有后续账单已成功顺延。"})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新并顺延账单失败: {e}", exc_info=True)
        return jsonify({"error": "操作失败"}), 500


@billing_bp.route("/contracts/<string:contract_id>/details", methods=["GET"])
@admin_required
def get_single_contract_details(contract_id):
    try:
        query = db.session.query(with_polymorphic(BaseContract, "*"))
        contract = query.filter(BaseContract.id == contract_id).first()

        if not contract:
            return jsonify({"error": "合同未找到"}), 404

        employee_name = (
            contract.user.username
            if contract.user
            else contract.service_personnel.name
            if contract.service_personnel
            else "未知员工"
        )

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

        if isinstance(contract, NannyContract) and getattr(
            contract, "is_monthly_auto_renew", False
        ):
            remaining_months_str = "月签"
        elif start_date_for_calc and end_date_for_calc:
            if start_date_for_calc > today:
                remaining_months_str = "合同未开始"
            elif end_date_for_calc > today:
                total_days_remaining = (end_date_for_calc - today).days
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

        result = {
            "id": str(contract.id),
            "customer_name": contract.customer_name,
            "contact_person": contract.contact_person,
            "management_fee_amount": contract.management_fee_amount,
            "management_fee_rate": getattr(contract, "management_fee_rate", None),
            "employee_name": employee_name,
            "contract_type_value": contract.type,
            "contract_type_label": get_contract_type_details(contract.type),
            "status": contract.status,
            "employee_level": contract.employee_level,
            "start_date": safe_isoformat(contract.start_date),
            "end_date": safe_isoformat(contract.end_date),
            "actual_onboarding_date": safe_isoformat(getattr(contract, "actual_onboarding_date",None)),
            "provisional_start_date": safe_isoformat(getattr(contract, "provisional_start_date",None)),
            "remaining_months": remaining_months_str,
            "highlight_remaining": highlight_remaining,
        }
        return jsonify(result)

    except Exception as e:
        current_app.logger.error(f"获取合同详情 {contract_id} 失败: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@billing_bp.route("/contracts/<string:contract_id>", methods=["PUT"])
@admin_required
def update_contract(contract_id):
    data = request.get_json()
    if not data:
        return jsonify({"error": "请求体不能为空"}), 400

    contract = db.session.get(BaseContract, contract_id)
    if not contract:
        return jsonify({"error": "合同未找到"}), 404

    try:
        # **核心修正**: 增加自动调整结束日的逻辑
        if "actual_onboarding_date" in data and data["actual_onboarding_date"]:
            new_onboarding_date_str = data["actual_onboarding_date"]
            new_onboarding_date = datetime.strptime(
                new_onboarding_date_str, "%Y-%m-%d"
            ).date()

            # 更新实际上户日期
            contract.actual_onboarding_date = new_onboarding_date

            # 如果是月嫂合同，自动计算并更新合同结束日
            if contract.type == "maternity_nurse":
                # 假设所有月嫂合同都是一个标准的26天周期
                # 结束日 = 实际上户日期 + 26天
                new_end_date = new_onboarding_date + timedelta(days=26)
                contract.end_date = new_end_date
                current_app.logger.info(
                    f"合同 {contract_id} 的实际上户日更新为 {new_onboarding_date}，合同结束日自动调整为 {new_end_date}。"
                )

        # 未来可以增加更新其他字段的逻辑
        # ...

        db.session.commit()
        return jsonify({"message": "合同信息更新成功"})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新合同 {contract_id} 失败: {e}", exc_info=True)
        return jsonify({"error": "更新失败"}), 500


@billing_bp.route("/contracts/<uuid:contract_id>/terminate", methods=["POST"])
def terminate_contract(contract_id):
    data = request.get_json()
    termination_date_str = data.get("termination_date")

    if not termination_date_str:
        return jsonify({"error": "Termination date is required"}), 400

    try:
        termination_date = date_parse(termination_date_str).date()
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid date format."}), 400

    contract = db.session.get(BaseContract, contract_id)
    if not contract:
        return jsonify({"error": "合同未找到"}), 404

    contract_start_date = contract.start_date.date() if isinstance(contract.start_date,datetime) else contract.start_date
    contract_end_date = contract.end_date.date() if isinstance(contract.end_date,datetime) else contract.end_date

    # --- Gemini-generated code: Start ---
    # 核心逻辑：根据合同类型进行不同的处理
    if isinstance(contract, NannyTrialContract):
        # 这是“试工失败”的结算流程
        try:
            if termination_date < contract_start_date:
                return jsonify({"error": "终止日期不能早于合同开始日期"}), 400

            actual_trial_days = (termination_date - contract_start_date).days

            engine = BillingEngine()
            engine.process_trial_termination(contract, actual_trial_days)
            
            # 更新合同状态
            contract.status = "terminated"
            contract.end_date = termination_date
            db.session.commit()

            return jsonify({"message": "育儿嫂试工合同已成功结算并终止。"})

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"处理试工合同终止失败: {e}", exc_info=True)
            return jsonify({"error": f"处理试工失败结算时发生错误: {e}"}), 500
    # --- Gemini-generated code: End ---

    # --- 原有的通用合同终止逻辑 ---
    # ... (原有的处理 NannyContract 和其他合同类型的逻辑保持不变) ...

    # --- 全新的、精确的退款逻辑 ---
    if isinstance(contract, NannyContract) and not contract.is_monthly_auto_renew:
        monthly_management_fee = contract.management_fee_amount if contract.management_fee_amount > 0 else (contract.employee_level * D("0.1"))
        if monthly_management_fee <= 0:
            return jsonify({"error": "合同管理费为0，无需处理退款。"}), 400

        original_end_date = contract_end_date
        if termination_date < original_end_date:
            if termination_date.year == contract_start_date.year and termination_date.month ==contract_start_date.month:
                current_app.logger.info(f"合同 {contract.id} 在首月内终止，将重算首月管理费。")
            else:
                level = D(contract.employee_level or 0)
                monthly_management_fee = (level * D("0.1")).quantize(D("0.01"))
                daily_management_fee = (monthly_management_fee / D(30)).quantize(
                    D("0.0001")
                )

                # 找到即将生成的最后一期账单
                final_bill = CustomerBill.query.filter(
                    CustomerBill.contract_id == contract_id,
                    CustomerBill.year == termination_date.year,
                    CustomerBill.month == termination_date.month,
                ).first()
                if not final_bill:
                    final_bill = (
                        CustomerBill.query.filter(
                            CustomerBill.contract_id == contract_id,
                            CustomerBill.cycle_end_date < termination_date,
                        )
                        .order_by(CustomerBill.cycle_end_date.desc())
                        .first()
                    )

                total_refund_amount = D(0)
                description_parts = ["合同提前终止，管理费退款计算如下："]

                # --- 计算退款总额 ---
                # A. 终止月剩余部分
                term_month_refund_amount = D(0)
                if termination_date.year == contract_end_date.year and termination_date.month ==contract_end_date.month:
                    refund_days_term = original_end_date.day - termination_date.day
                else:
                    refund_days_term = 30 - termination_date.day
                if refund_days_term > 0:
                    term_month_refund_amount = (
                        D(refund_days_term) * daily_management_fee
                    ).quantize(D("0.01"))

                # B. 中间完整月份
                full_months_count = 0
                full_months_total_amount = D(0)
                full_months_start_date = None
                full_months_end_date = None

                current_month_start = termination_date.replace(day=1) + relativedelta(
                    months=1
                )
                while current_month_start.year < original_end_date.year or (
                    current_month_start.year == original_end_date.year
                    and current_month_start.month < original_end_date.month
                ):
                    if full_months_start_date is None:
                        full_months_start_date = current_month_start
                    full_months_end_date = current_month_start
                    full_months_count += 1
                    current_month_start += relativedelta(months=1)

                if full_months_count > 0:
                    full_months_total_amount = monthly_management_fee * D(full_months_count)

                # C. 原始末月已付部分
                original_end_month_refund_amount = D(0)
                is_original_end_month_a_full_month = False
                if not (
                    termination_date.year == original_end_date.year
                    and termination_date.month == original_end_date.month
                ):
                    # --- 关键修复：判断原始结束日期是否是当月的最后一天 ---
                    _, last_day_of_month = calendar.monthrange(original_end_date.year,original_end_date.month)
                    is_full_month = (original_end_date.day == last_day_of_month)

                    if is_full_month:
                        # 如果是完整的一个月，则退还全月管理费
                        is_original_end_month_a_full_month = True
                        original_end_month_refund_amount = monthly_management_fee
                    else:
                        # 如果不是完整的一个月，则按天退费
                        refund_days_original_end = original_end_date.day
                        if refund_days_original_end > 0:
                            original_end_month_refund_amount = (
                                D(refund_days_original_end) * daily_management_fee
                            ).quantize(D("0.01"))

                total_refund_amount = (
                    term_month_refund_amount
                    + full_months_total_amount
                    + original_end_month_refund_amount
                )

                # --- 构建描述字符串 ---
                if total_refund_amount > 0:
                    if term_month_refund_amount > 0:
                        description_parts.append(
                            f"  - 终止月({termination_date.month}月{termination_date.day}日)剩余 {refund_days_term} 天: {term_month_refund_amount:.2f}元"
                        )

                    if full_months_count > 0 and full_months_total_amount > 0:
                        start_str = f"{full_months_start_date.year}年{full_months_start_date.month}月"
                        end_str = (
                            f"{full_months_end_date.year}年{full_months_end_date.month}月"
                        )
                        period_str = (
                            start_str
                            if full_months_count == 1
                            else f"{start_str}~{end_str}"
                        )
                        description_parts.append(f"  - {period_str}")
                        description_parts.append(
                            f"    {full_months_count}个整月*{monthly_management_fee:.2f}元 = {full_months_total_amount:.2f}元"
                        )

                    # --- 关键修改：根据是否为整月，生成不同的描述 ---
                    if original_end_month_refund_amount > 0:
                        if is_original_end_month_a_full_month:
                            description_parts.append(
                                f"  - 原始末月({original_end_date.year}年{original_end_date.month}月)整月: {original_end_month_refund_amount:.2f}元"
                            )
                        else:
                            description_parts.append(
                                f"  - 原始末月({original_end_date.month}月)部分 {original_end_date.day} 天: {original_end_month_refund_amount:.2f}元"
                            )

                    description_parts.append(f"  - 总计：{total_refund_amount:.2f}元")

                    final_description = "\n".join(description_parts)
                    db.session.add(
                        FinancialAdjustment(
                            customer_bill_id=final_bill.id if final_bill else None,
                            adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
                            amount=total_refund_amount,
                            description=final_description,
                            date=termination_date,
                        )
                    )
    elif isinstance(contract, NannyContract) and not contract.is_monthly_auto_renew:
        # 1. 找到终止月份的账单
        final_bill = CustomerBill.query.filter(
            CustomerBill.contract_id == contract_id,
            CustomerBill.year == termination_date.year,
            CustomerBill.month == termination_date.month,
        ).first()

        if final_bill:
            # 2. 计算当月管理费和每日管理费
            level = D(contract.employee_level or 0)
            # 假设管理费率为10%
            monthly_management_fee = (level * D("0.1")).quantize(D("0.01"))
            daily_management_fee = (monthly_management_fee / D(30)).quantize(
                D("0.0001")
            )

            # 3. 计算需要退款的天数和金额
            # 假设管理费在月初支付，覆盖整个月
            refund_days = 30 - termination_date.day
            if refund_days > 0:
                refund_amount = (D(refund_days) * daily_management_fee).quantize(
                    D("0.01")
                )

                if refund_amount > 0:
                    # 4. 创建一笔财务调整（退款）
                    description = f"育儿嫂月签合同于 {termination_date_str} 终止，退还当月剩余 {refund_days} 天管理费。"
                    db.session.add(
                        FinancialAdjustment(
                            customer_bill_id=final_bill.id,
                            adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
                            amount=refund_amount,
                            description=description,
                            date=termination_date,
                        )
                    )
                    current_app.logger.info(
                        f"为月签合同 {contract.id} 创建管理费退款 {refund_amount} 元。"
                    )

    # --- 原有逻辑继续 ---
    # 1. 找到即将被删除的账单和薪酬单的ID
    bills_to_delete_query = CustomerBill.query.with_entities(CustomerBill.id).filter(
        CustomerBill.contract_id == contract_id,
        CustomerBill.cycle_start_date > termination_date,
    )
    bill_ids_to_delete = [item[0] for item in bills_to_delete_query.all()]

    payrolls_to_delete_query = EmployeePayroll.query.with_entities(
        EmployeePayroll.id
    ).filter(
        EmployeePayroll.contract_id == contract_id,
        EmployeePayroll.cycle_start_date > termination_date,
    )
    payroll_ids_to_delete = [item[0] for item in payrolls_to_delete_query.all()]

    # 2. 首先删除关联的财务活动日志
    if bill_ids_to_delete:
        FinancialActivityLog.query.filter(
            FinancialActivityLog.customer_bill_id.in_(bill_ids_to_delete)
        ).delete(synchronize_session=False)

    if payroll_ids_to_delete:
        FinancialActivityLog.query.filter(
            FinancialActivityLog.employee_payroll_id.in_(payroll_ids_to_delete)
        ).delete(synchronize_session=False)

    # 3. 现在可以安全地删除账单和薪酬单了
    if bill_ids_to_delete:
        CustomerBill.query.filter(CustomerBill.id.in_(bill_ids_to_delete)).delete(
            synchronize_session=False
        )

    if payroll_ids_to_delete:
        EmployeePayroll.query.filter(
            EmployeePayroll.id.in_(payroll_ids_to_delete)
        ).delete(synchronize_session=False)

    # +++ 新增：修正最后一个周期的结束日期 +++
    # 查找横跨终止日期的客户账单
        # +++ 新增：修正最后一个周期的结束日期 +++
    year_to_recalculate = None
    month_to_recalculate = None

    # 查找横跨终止日期的客户账单
    current_app.logger.debug(f"termination_date: {termination_date}")
    final_bill_to_update = CustomerBill.query.filter(
        CustomerBill.contract_id == contract_id,
        CustomerBill.cycle_start_date <= termination_date,
        CustomerBill.cycle_end_date >= termination_date,
    ).first()

    if final_bill_to_update:
        # --- 关键修正：从被修改的账单中获取正确的年月 ---
        year_to_recalculate = final_bill_to_update.year
        month_to_recalculate = final_bill_to_update.month
        # --- 结束修正 ---

        final_bill_to_update.cycle_end_date = termination_date
        current_app.logger.info(
            f"已将账单 {final_bill_to_update.id} 的结束日期更新为 {termination_date}"
        )

        # 同时查找并更新对应的员工薪酬单
        final_payroll_to_update = EmployeePayroll.query.filter(
            EmployeePayroll.contract_id == contract_id,
            EmployeePayroll.cycle_start_date
            == final_bill_to_update.cycle_start_date,
        ).first()

        if final_payroll_to_update:
            final_payroll_to_update.cycle_end_date = termination_date
            current_app.logger.info(
                f"已将薪酬单 {final_payroll_to_update.id} 的结束日期更新为 {termination_date}"
            )

        # Find and update the corresponding attendance record
        attendance_to_update = AttendanceRecord.query.filter(
            AttendanceRecord.contract_id == contract_id,
            AttendanceRecord.cycle_start_date
            == final_bill_to_update.cycle_start_date,
        ).first()
        if attendance_to_update:
            attendance_to_update.cycle_end_date = termination_date

            # --- 核心修复：重新计算总工作天数 ---
            if attendance_to_update.cycle_start_date and attendance_to_update.cycle_end_date:
                att_start_date = attendance_to_update.cycle_start_date.date() if isinstance(attendance_to_update.cycle_start_date, datetime) else attendance_to_update.cycle_start_date

                current_app.logger.debug(
                    f"Recalculating total_days_worked for AttendanceRecord {attendance_to_update.id}: "
                    f"start_date = {attendance_to_update.cycle_start_date}, "
                    f"att_start_date = {att_start_date}, "
                    f"end_date = {attendance_to_update.cycle_end_date}, "
                    f"overtime_days = {attendance_to_update.overtime_days}"
                )
                # 加1是因为天数计算是包含首尾的
                total_days = (attendance_to_update.cycle_end_date - att_start_date).days
                # 加上加班天数
                overtime_days = attendance_to_update.overtime_days or 0
                attendance_to_update.total_days_worked = total_days + overtime_days

            current_app.logger.info(
                f"已将考勤记录 {attendance_to_update.id} 的结束日期更新为 {termination_date} 并重新计算总工时"
            )

    # 4. 更新合同状态和结束日期
    contract.status = "terminated"
    contract.end_date = termination_date

    if contract.type == "maternity_nurse":
        contract.expected_offboarding_date = termination_date

    # 5. 为正确的结算月份触发一次强制重算
    current_app.logger.debug(f"year_to_recalculate = {year_to_recalculate} month_to_recalculate = {month_to_recalculate}")
    if year_to_recalculate and month_to_recalculate:
        calculate_monthly_billing_task.delay(
            year_to_recalculate, month_to_recalculate, contract_id=str(contract_id), force_recalculate=True
        )
        current_app.logger.info(
            f"Contract {contract_id} terminated on {termination_date}. Recalculation triggered for {year_to_recalculate}-{month_to_recalculate}."
        )
    else:
        # 如果没有找到需要更新的账单（例如，终止日期在所有账单之前），则不触发重算
        current_app.logger.warning(
            f"Contract {contract_id} terminated, but no existing bill was found to update and recalculate."
        )

    db.session.commit()

    return jsonify(
        {
            "message": f"Contract {contract_id} has been terminated. Recalculation for {year_to_recalculate}-{month_to_recalculate} is in progress."
        }
    )


@billing_bp.route("/contracts/<uuid:contract_id>/succeed", methods=["POST"])
def succeed_trial_contract(contract_id):
    contract = BaseContract.query.get_or_404(contract_id)

    if contract.type != "nanny_trial":
        return jsonify({"error": "Only trial contracts can succeed."}), 400

    if contract.status != "trial_active":
        return jsonify(
            {
                "error": f"Contract is not in trial_active state, but in {contract.status}."
            }
        ), 400

    contract.status = "trial_succeeded"
    db.session.commit()

    current_app.logger.info(
        f"Trial contract {contract_id} has been marked as 'trial_succeeded'."
    )
    return jsonify({"message": "Trial contract marked as succeeded."})


@billing_bp.route("/bills/find", methods=["GET"])
@admin_required
def find_bill_and_its_page():
    bill_id = request.args.get("bill_id")
    per_page = request.args.get("per_page", 100, type=int)

    if not bill_id:
        return jsonify({"error": "bill_id is required"}), 400

    target_bill = db.session.get(CustomerBill, bill_id)
    if not target_bill:
        return jsonify({"error": "Bill not found"}), 404

    billing_year = target_bill.year
    billing_month = target_bill.month
    # 不要直接用 target_bill.contract，而是用 with_polymorphic 重新查询
    contract_poly = with_polymorphic(BaseContract, "*")
    contract = db.session.query(contract_poly).filter(contract_poly.id == target_bill.contract_id).first()

    if not contract:
        return jsonify({"error": "Associated contract not found"}), 404

    query = (
        CustomerBill.query.join(
            BaseContract, CustomerBill.contract_id == BaseContract.id
        )
        .filter(CustomerBill.year == billing_year, CustomerBill.month == billing_month)
        .order_by(BaseContract.customer_name, CustomerBill.cycle_start_date)
    )

    all_bill_ids_in_month = [str(b.id) for b in query.all()]

    try:
        position = all_bill_ids_in_month.index(bill_id)
        page_number = (position // per_page) + 1 # 页码从1开始
    except ValueError:
        return jsonify(
            {"error": "Bill found but could not determine its position."}
        ), 500

    details = _get_billing_details_internal(bill_id=bill_id)

    # --- Modification: Add necessary contract info to the response ---
    employee_name = (
        contract.user.username
        if contract.user
        else contract.service_personnel.name
        if contract.service_personnel
        else "未知员工"
    )

    return jsonify(
        {
            "bill_details": details,
            "page": page_number,
            "billing_month": f"{billing_year}-{str(billing_month).zfill(2)}",
            # Add a 'context' object that mimics the list's bill structure
            "context": {
                "id": str(target_bill.id),
                "contract_id": str(contract.id),
                "customer_name": contract.customer_name,
                "employee_name": employee_name,
                "contract_type_value": contract.type,
                "status": contract.status,
                "employee_level": contract.employee_level,
                "is_monthly_auto_renew": getattr(contract, 'is_monthly_auto_renew', False),
            },
        }
    )

@billing_bp.route("/bills/<string:bill_id>/extend", methods=["POST"])
@admin_required
def extend_single_bill(bill_id):
    data = request.get_json()
    new_end_date_str = data.get("new_end_date")
    if not new_end_date_str:
        return jsonify({"error": "必须提供新的结束日期 (new_end_date)"}), 400

    try:
        bill = db.session.get(CustomerBill, bill_id)
        if not bill:
            return jsonify({"error": "账单未找到"}), 404

        new_end_date = date_parse(new_end_date_str).date()
        contract = bill.contract

        # --- 核心修复：确保所有变更和计算都在一个事务内，并使用正确的逻辑 ---

        # 1. 更新合同的权威结束日期
        #    我们统一使用 expected_offboarding_date 来存储延长后的日期
        contract.expected_offboarding_date = new_end_date

        # 2. 更新当前账单的结束日期以匹配
        bill.cycle_end_date = new_end_date

        db.session.add(contract)
        db.session.add(bill)

        # 3. 调用计算引擎，并把新的结束日期作为最高优先级传入
        engine = BillingEngine()
        engine.calculate_for_month(
            year=bill.year,
            month=bill.month,
            contract_id=bill.contract_id,
            force_recalculate=True,
            cycle_start_date_override=bill.cycle_start_date,
            end_date_override=new_end_date
        )

        # 4. 提交所有更改（日期变更和计算结果）
        db.session.commit()

        # 5. 返回最新的、正确的数据
        latest_details = _get_billing_details_internal(bill_id=bill.id)

        # current_app.logger.info(f"账单 {bill_id} 已成功延latest_details长至 {latest_details}")
        return jsonify(latest_details)

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"延长账单 {bill_id} 失败: {e}", exc_info=True)
        return jsonify({"error": f"延长服务失败: {str(e)}"}), 500

@billing_bp.route('/customer-bills/<uuid:bill_id>/defer', methods=['POST'])
@admin_required
def defer_customer_bill(bill_id):
    """
    将指定账单中未支付的客户应付款，顺延到下一个月的账单。
    """
    bill_to_defer = db.session.get(CustomerBill, str(bill_id))
    if not bill_to_defer:
        return jsonify({"error": "要顺延的账单未找到"}), 404

    # 关键修复 1: 使用新的 payment_status 字段来判断
    if bill_to_defer.payment_status == PaymentStatus.PAID:
        return jsonify({"error": "已结清的账单不能顺延"}), 400

    # 关键修复 2: 检查是否已存在顺延记录，防止重复操作
    existing_deferral = FinancialAdjustment.query.filter_by(
        description=f"[系统添加] 从账单 {bill_to_defer.id} 顺延"
    ).first()
    if existing_deferral:
        return jsonify({"error": "此账单已被顺延，不能重复操作"}), 400

    # 找到下一个月的账单
    next_month_date = (date(bill_to_defer.year, bill_to_defer.month, 1) + relativedelta(months=1))
    next_bill = CustomerBill.query.filter_by(
        contract_id=bill_to_defer.contract_id,
        year=next_month_date.year,
        month=next_month_date.month,
        is_substitute_bill=False
    ).first()

    if not next_bill:
        return jsonify({"error": "未找到下一个月的账单可供顺延"}), 404

    # 计算待付金额
    amount_to_defer = bill_to_defer.total_due - bill_to_defer.total_paid
    if amount_to_defer <= 0:
        return jsonify({"error": "没有待付金额可以顺延"}), 400

    try:
        # 在下个账单中创建一个“上期顺延费用”的增款项
        deferred_fee_adjustment = FinancialAdjustment(
            customer_bill_id=next_bill.id,
            adjustment_type=AdjustmentType.DEFERRED_FEE,
            amount=amount_to_defer,
            description=f"[系统添加] 从账单 {bill_to_defer.id} 顺延",
            date=next_bill.cycle_start_date
        )
        db.session.add(deferred_fee_adjustment)

        # 在当前账单中创建一个等额的减款项，使其结清
        offsetting_adjustment = FinancialAdjustment(
            customer_bill_id=bill_to_defer.id,
            adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
            amount=amount_to_defer,
            description=f"[系统添加] 顺延至账单 {next_bill.id}",
            date=bill_to_defer.cycle_end_date
        )
        db.session.add(offsetting_adjustment)

        # 重新计算两个账单
        engine = BillingEngine()
        engine.calculate_for_month(year=bill_to_defer.year, month=bill_to_defer.month,contract_id=bill_to_defer.contract_id, force_recalculate=True)
        engine.calculate_for_month(year=next_bill.year, month=next_bill.month,contract_id=next_bill.contract_id, force_recalculate=True)

        db.session.commit()
        return jsonify({"message": "费用已成功顺延到下个账单"})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"顺延账单 {bill_id} 失败: {e}", exc_info=True)
        return jsonify({"error": "顺延操作失败"}), 500
    
@billing_bp.route("/batch-settle", methods=["POST"])
@admin_required
def batch_settle():
    """
    批量更新账单和薪酬单的支付/发放状态。
    """
    data = request.get_json()
    updates = data.get("updates")
    if not updates:
        return jsonify({"error": "缺少更新数据"}), 400

    try:
        # 【关键修复】：在函数开头获取当前操作用户的ID
        user_id = get_jwt_identity()
        updated_count = 0

        for update_data in updates:
            bill_id = update_data.get("bill_id")
            customer_is_paid = update_data.get("customer_is_paid")
            employee_is_paid = update_data.get("employee_is_paid")

            bill = db.session.get(CustomerBill, bill_id)
            if not bill:
                continue

            # --- 客户账单结算 ---
            if customer_is_paid is not None:
                current_customer_paid_status = (bill.payment_status == PaymentStatus.PAID)
                if current_customer_paid_status != customer_is_paid:
                    if customer_is_paid:
                        pending_amount = bill.total_due - bill.total_paid
                        if pending_amount > 0:
                             db.session.add(PaymentRecord(
                                customer_bill_id=bill.id,
                                amount=pending_amount,
                                payment_date=date.today(),
                                method='batch_settle',
                                notes='[系统] 批量结算抹平差额',
                                created_by_user_id=user_id  # <--- 使用获取到的用户ID
                            ))
                    else:
                        PaymentRecord.query.filter_by(
                            customer_bill_id=bill.id,
                            method='batch_settle'
                        ).delete(synchronize_session=False)

                    _update_bill_payment_status(bill)
                    updated_count += 1

            # --- 员工薪酬结算 ---
            payroll = EmployeePayroll.query.filter_by(
                contract_id=bill.contract_id,
                cycle_start_date=bill.cycle_start_date
            ).first()

            if payroll and employee_is_paid is not None:
                current_employee_paid_status = (payroll.payout_status == PayoutStatus.PAID)
                if current_employee_paid_status != employee_is_paid:
                    if employee_is_paid:
                        pending_amount = payroll.total_due - payroll.total_paid_out
                        if pending_amount > 0:
                            db.session.add(PayoutRecord(
                                employee_payroll_id=payroll.id,
                                amount=pending_amount,
                                payout_date=date.today(),
                                method='batch_settle',
                                notes='[系统] 批量结算抹平差额',
                                created_by_user_id=user_id  # <--- 在这里也使用获取到的用户ID
                            ))
                    else:
                        PayoutRecord.query.filter_by(
                            employee_payroll_id=payroll.id,
                            method='batch_settle'
                        ).delete(synchronize_session=False)

                    _update_payroll_payout_status(payroll)
                    updated_count += 1

        if updated_count > 0:
            db.session.commit()
            return jsonify({"message": f"成功更新 {updated_count} 条记录的结算状态。"})
        else:
            return jsonify({"message": "没有记录的状态需要更新。"})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"批量结算失败: {e}", exc_info=True)
        return jsonify({"error": "批量结算时发生服务器内部错误"}), 500

@billing_bp.route("/dashboard/summary", methods=["GET"])
@admin_required
def get_dashboard_summary():
    """
    获取用于仪表盘显示的核心业务摘要数据。
    """
    try:
        today = date.today()

        # === 1. KPIs (逻辑不变) ===
        active_contracts_count = db.session.query(func.count(BaseContract.id)).filter(BaseContract.status == 'active').scalar() or 0
        active_employees_count = db.session.query(func.count(distinct(BaseContract.user_id))).filter(
            BaseContract.status == 'active',
            BaseContract.user_id.isnot(None)
        ).scalar() or 0

        # 年度已收管理费
        yearly_management_fee_received = db.session.query(
            func.sum(case((CustomerBill.payment_status == PaymentStatus.PAID,CustomerBill.calculation_details['management_fee'].as_float()), else_=0))
        ).filter(
            CustomerBill.year == today.year
        ).scalar() or 0

        # 年度应收管理费
        yearly_management_fee_total = db.session.query(
            func.sum(CustomerBill.calculation_details['management_fee'].as_float())
        ).filter(
            CustomerBill.year == today.year
        ).scalar() or 0

        kpis = {
            "monthly_management_fee_received": f"{D(yearly_management_fee_received).quantize(D('0.01'))}",
            "monthly_management_fee_total": f"{D(yearly_management_fee_total).quantize(D('0.01'))}",
            "active_contracts_count": active_contracts_count,
            "active_employees_count": active_employees_count,
        }

        # === 2. TODO Lists (逻辑不变) ===
        # ... (此部分代码与上一版相同，为简洁省略，请保留你已有的代码) ...
        two_weeks_later = today + timedelta(weeks=2)
        expiring_contracts_query = BaseContract.query.filter(
            BaseContract.status == 'active',
            func.date(BaseContract.end_date).between(today, today + timedelta(days=30))
        ).order_by(BaseContract.end_date.asc()).limit(5)

        expiring_contracts = [{
            "id": str(c.id),
            "customer_name": c.customer_name,
            "employee_name": (c.user.username if c.user else c.service_personnel.name if c.service_personnel else '未知'),
            "end_date": (c.end_date.date() if isinstance(c.end_date, datetime) else c.end_date).isoformat(),
            "expires_in_days": ((c.end_date.date() if isinstance(c.end_date, datetime) else c.end_date) - today).days
        } for c in expiring_contracts_query.all()]

        upcoming_maternity_contracts_query = MaternityNurseContract.query.filter(
            MaternityNurseContract.status == 'active',
            MaternityNurseContract.provisional_start_date.isnot(None),
            func.date(MaternityNurseContract.provisional_start_date).between(today, today +timedelta(weeks=2))
        ).order_by(MaternityNurseContract.provisional_start_date.asc()).limit(5)

        upcoming_maternity_contracts = [{
            "id": str(c.id),
            "customer_name": c.customer_name,
            "provisional_start_date": (c.provisional_start_date.date() if isinstance(c.provisional_start_date, datetime) else c.provisional_start_date).isoformat(),
            "days_until": ((c.provisional_start_date.date() if isinstance(c.provisional_start_date,datetime) else c.provisional_start_date) - today).days
        } for c in upcoming_maternity_contracts_query.all()]

        pending_payments_query = CustomerBill.query.filter(
            CustomerBill.year == today.year,
            CustomerBill.month == today.month,
            CustomerBill.payment_status.in_([PaymentStatus.UNPAID, PaymentStatus.PARTIALLY_PAID]),
            CustomerBill.total_due > CustomerBill.total_paid
        ).order_by(CustomerBill.total_due.desc()).limit(5)

        pending_payments = [{
            "bill_id": str(p.id),
            "customer_name": p.customer_name,
            "contract_type": get_contract_type_details(p.contract.type),
            "amount": f"{(p.total_due - p.total_paid).quantize(D('0.01'))}"
        } for p in pending_payments_query.all()]

        todo_lists = {
            "expiring_contracts": expiring_contracts,
            "approaching_provisional": upcoming_maternity_contracts,
            "pending_payments": pending_payments
        }


        # === 3. Charts (核心修改) ===
        last_12_months_dates = [today - relativedelta(months=i) for i in range(12)]

        # --- 柱状图数据 ---
        # 3.1 查询过去12个月的“应收”管理费
        due_revenue_data = db.session.query(
            CustomerBill.year,
            CustomerBill.month,
            func.sum(CustomerBill.calculation_details['management_fee'].as_float())
        ).filter(
            func.date_trunc('month', func.to_date(func.concat(cast(CustomerBill.year, String), '-',cast(CustomerBill.month, String)), 'YYYY-MM')) >= func.date_trunc('month', today -relativedelta(months=11))
        ).group_by(CustomerBill.year, CustomerBill.month).all()
        due_revenue_by_month = {f"{r.year}-{r.month}": float(r[2] or 0) for r in due_revenue_data}

        # 3.2 查询过去12个月的“已收”管理费
        paid_revenue_data = db.session.query(
            CustomerBill.year,
            CustomerBill.month,
            func.sum(case((CustomerBill.payment_status == PaymentStatus.PAID,CustomerBill.calculation_details['management_fee'].as_float()), else_=0))
        ).filter(
            func.date_trunc('month', func.to_date(func.concat(cast(CustomerBill.year, String), '-',cast(CustomerBill.month, String)), 'YYYY-MM')) >= func.date_trunc('month', today -relativedelta(months=11))
        ).group_by(CustomerBill.year, CustomerBill.month).all()
        paid_revenue_by_month = {f"{r.year}-{r.month}": float(r[2] or 0) for r in paid_revenue_data}

        # 3.3 组装成前端需要的数据结构
        revenue_trend = {
            "categories": [],
            "series": [{"name": "应收管理费", "data": []}],
            "paid_data": [] # 新增一个数组，专门存放已收数据
        }
        for dt in sorted(last_12_months_dates, key=lambda d: (d.year, d.month)):
            month_key = f"{dt.year}-{dt.month}"
            revenue_trend["categories"].append(f"{dt.month}月")
            revenue_trend["series"][0]["data"].append(due_revenue_by_month.get(month_key, 0))
            revenue_trend["paid_data"].append(paid_revenue_by_month.get(month_key, 0))

        # --- 饼图数据 ---
        # 3.4 查询本年度“应收”管理费的分布
        distribution_query = db.session.query(
            BaseContract.type,
            func.sum(CustomerBill.calculation_details['management_fee'].as_float())
        ).join(CustomerBill).filter(
            CustomerBill.year == today.year
            # 移除了 payment_status 的过滤条件
        ).group_by(BaseContract.type).all()

        management_fee_distribution = {
            "this_year": {"labels": [], "series": []},
            "last_12_months": {"labels": [], "series": []}
        }
        for contract_type, total_fee in distribution_query:
            management_fee_distribution["this_year"]["labels"].append(get_contract_type_details(contract_type))
            management_fee_distribution["this_year"]["series"].append(float(total_fee or 0))

        # === Final Assembly ===
        summary = {
            "kpis": kpis,
            "todo_lists": todo_lists,
            "revenue_trend": revenue_trend,
            "management_fee_distribution": management_fee_distribution
        }
        return jsonify(summary)

    except Exception as e:
        current_app.logger.error(f"获取仪表盘数据失败: {e}", exc_info=True)
        return jsonify({"error": "获取仪表盘数据时发生服务器内部错误"}), 500

@billing_bp.route("/export-management-fees", methods=["GET"])
@admin_required
def export_management_fees_csv():
    """
    导出指定月份的管理费明细为CSV文件。
    """
    billing_month_str = request.args.get("billing_month")
    if not billing_month_str:
        return jsonify({"error": "必须提供账单月份 (billing_month) 参数"}), 400

    try:
        billing_year, billing_month = map(int, billing_month_str.split("-"))

        # 复用 get_bills 的查询逻辑来获取过滤后的账单
        # (这是一个简化的版本，您可以根据需要从 get_bills 复制完整的过滤逻辑)
        search_term = request.args.get("search", "").strip()
        contract_type = request.args.get("type", "")
        status = request.args.get("status", "")
        payment_status_filter = request.args.get("payment_status", "")
        payout_status_filter = request.args.get("payout_status", "")

        contract_poly = with_polymorphic(BaseContract, "*")
        query = db.session.query(CustomerBill, contract_poly).join(
            contract_poly, CustomerBill.contract_id == contract_poly.id
        ).outerjoin(
            User, contract_poly.user_id == User.id
        ).outerjoin(
            ServicePersonnel, contract_poly.service_personnel_id == ServicePersonnel.id
        ).filter(
            CustomerBill.year == billing_year, CustomerBill.month == billing_month
        )

        if status:
            query = query.filter(contract_poly.status == status)
        if contract_type:
            query = query.filter(contract_poly.type == contract_type)
        if search_term:
            query = query.filter(
                db.or_(
                    contract_poly.customer_name.ilike(f"%{search_term}%"),
                    User.username.ilike(f"%{search_term}%"),
                    ServicePersonnel.name.ilike(f"%{search_term}%"),
                )
            )
        if payment_status_filter:
            query = query.filter(CustomerBill.payment_status ==PaymentStatus(payment_status_filter))

        bills_with_contracts = query.order_by(contract_poly.customer_name).all()

        # --- 关键修复：使用状态映射来显示正确的支付状态 ---
        status_map = {
            PaymentStatus.PAID: "已支付",
            PaymentStatus.UNPAID: "未支付",
            PaymentStatus.PARTIALLY_PAID: "部分支付",
            PaymentStatus.OVERPAID: "超额支付",
        }

        output = io.StringIO()
        writer = csv.writer(output)

        # 写入CSV表头
        writer.writerow([
            "客户姓名", "员工姓名", "合同类型", "管理费", "支付状态"
        ])

        # 写入数据行
        for bill, contract in bills_with_contracts:
            calc_details = bill.calculation_details or {}
            management_fee = calc_details.get("management_fee", "0.00")

            employee = contract.user or contract.service_personnel
            employee_name = getattr(employee, 'username', getattr(employee, 'name', '未知'))

            writer.writerow([
                bill.customer_name,
                employee_name,
                get_contract_type_details(contract.type),
                management_fee,
                status_map.get(bill.payment_status, "未知") # <-- 使用 status_map
            ])

        output.seek(0)

        return Response(
            output,
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment;filename=management_fees_{billing_month_str}.csv"}
        )

    except Exception as e:
        current_app.logger.error(f"导出管理费明细失败: {e}", exc_info=True)
        return jsonify({"error": "导出失败，服务器内部错误"}), 500
    
@billing_bp.route("/conflicts", methods=['GET'])
@admin_required
def get_billing_conflicts():
    """
    检测指定月份的合同冲突。
    """
    billing_month_str = request.args.get("billing_month")
    if not billing_month_str:
        return jsonify({"error": "必须提供 billing_month 参数 (格式: YYYY-MM)"}), 400

    try:
        year, month = map(int, billing_month_str.split('-'))
    except ValueError:
        return jsonify({"error": "无效的 billing_month 格式"}), 400

    # 1. 获取目标月份的所有有效账单
    bills = db.session.query(
        CustomerBill
    ).join(BaseContract, CustomerBill.contract_id == BaseContract.id).filter(
        CustomerBill.year == year,
        CustomerBill.month == month,
        BaseContract.status == 'active'
    ).all()

    # 2. 员工冲突检测
    employee_bills = defaultdict(list)
    for bill in bills:
        # 确保合同关联了员工
        if bill.contract and (bill.contract.service_personnel_id or bill.contract.user_id):
            employee_id = bill.contract.service_personnel_id or bill.contract.user_id
            employee_bills[employee_id].append(bill)

    employee_conflicts = []
    processed_employee_pairs = set()

    for employee_id, bill_list in employee_bills.items():
        if len(bill_list) > 1:
            sorted_bills = sorted(bill_list, key=lambda b: b.cycle_start_date)
            for i in range(len(sorted_bills)):
                for j in range(i + 1, len(sorted_bills)):
                    bill_a = sorted_bills[i]
                    bill_b = sorted_bills[j]

                    # 创建一个唯一的键来标识这对账单
                    pair_key = tuple(sorted( (str(bill_a.id), str(bill_b.id)) ))
                    if pair_key in processed_employee_pairs:
                        continue

                    if bill_a.cycle_start_date <= bill_b.cycle_end_date and bill_a.cycle_end_date >= bill_b.cycle_start_date:
                        employee = bill_a.contract.user or bill_a.contract.service_personnel
                        if not employee: continue # 如果找不到员工信息，则跳过

                        # 查找是否已存在该员工的冲突记录
                        existing_conflict = next((c for c in employee_conflicts if c['identifier_id'] == employee_id), None)

                        formatted_bill_a = format_bill_for_conflict_response(bill_a)
                        formatted_bill_b = format_bill_for_conflict_response(bill_b)

                        if existing_conflict:
                            # 如果已存在，将新的冲突账单添加进去
                            if formatted_bill_a not in existing_conflict['conflicts']:
                                existing_conflict['conflicts'].append(formatted_bill_a)
                            if formatted_bill_b not in existing_conflict['conflicts']:
                                existing_conflict['conflicts'].append(formatted_bill_b)
                        else:
                            # 否则，创建新的冲突记录
                            employee_conflicts.append({
                                "type": "employee",
                                "identifier_id": employee_id,
                                "identifier_name": employee.username if hasattr(employee, 'username') else employee.name,
                                "conflicts": [formatted_bill_a, formatted_bill_b]
                            })

                        processed_employee_pairs.add(pair_key)

    # 3. 客户冲突检测
    customer_bills = defaultdict(list)
    for bill in bills:
        if bill.customer_name:
            customer_bills[bill.customer_name].append(bill)

    customer_conflicts = []
    processed_customer_pairs = set()

    for customer_name, bill_list in customer_bills.items():
        if len(bill_list) > 1:
            sorted_bills = sorted(bill_list, key=lambda b: b.cycle_start_date)
            for i in range(len(sorted_bills)):
                for j in range(i + 1, len(sorted_bills)):
                    bill_a = sorted_bills[i]
                    bill_b = sorted_bills[j]

                    pair_key = tuple(sorted((str(bill_a.id), str(bill_b.id))))
                    if pair_key in processed_customer_pairs:
                        continue

                    if bill_a.cycle_start_date <= bill_b.cycle_end_date and bill_a.cycle_end_date >= bill_b.cycle_start_date:
                        existing_conflict = next((c for c in customer_conflicts if c['identifier_name'] == customer_name),None)

                        formatted_bill_a = format_bill_for_conflict_response(bill_a)
                        formatted_bill_b = format_bill_for_conflict_response(bill_b)

                        if existing_conflict:
                            if formatted_bill_a not in existing_conflict['conflicts']:
                                existing_conflict['conflicts'].append(formatted_bill_a)
                            if formatted_bill_b not in existing_conflict['conflicts']:
                                existing_conflict['conflicts'].append(formatted_bill_b)
                        else:
                            customer_conflicts.append({
                                "type": "customer",
                                "identifier_name": customer_name,
                                "conflicts": [formatted_bill_a, formatted_bill_b]
                            })

                        processed_customer_pairs.add(pair_key)

    return jsonify({
        "employee_conflicts": employee_conflicts,
        "customer_conflicts": customer_conflicts
    })

def format_bill_for_conflict_response(bill):
    """
    辅助函数，用于格式化冲突检测接口中的账单信息。
    """
    employee = None
    contract_start_date = None
    contract_end_date = None
    management_fee = None

    if bill.contract:
        employee = bill.contract.user or bill.contract.service_personnel
        # 如果不是替班账单，则获取合同的起止日期
        if not bill.is_substitute_bill:
            contract_start_date = bill.contract.start_date.isoformat() if bill.contract.start_date else None
            contract_end_date = bill.contract.end_date.isoformat() if bill.contract.end_date else None

    # 从 calculation_details 中获取管理费
    if bill.calculation_details and 'management_fee' in bill.calculation_details:
        management_fee = bill.calculation_details['management_fee']

    return {
        "bill_id": str(bill.id),
        "contract_id": str(bill.contract_id),
        "customer_name": bill.customer_name,
        "employee_name": employee.username if employee and hasattr(employee, 'username') else (employee.name if employee else "N/A"),
        "contract_type": get_contract_type_details(bill.contract.type) if bill.contract else "N/A",
        "cycle_start_date": bill.cycle_start_date.isoformat(),
        "cycle_end_date": bill.cycle_end_date.isoformat(),
        "is_substitute_bill": bill.is_substitute_bill,
        "contract_start_date": contract_start_date,
        "contract_end_date": contract_end_date,
        "total_due": str(bill.total_due or 0),
        "management_fee": str(management_fee or 0)
    }

@billing_bp.route("/financial-adjustments/<uuid:adjustment_id>/transfer", methods=["POST"])
@admin_required
def transfer_financial_adjustment(adjustment_id):
    """
    将一个财务调整项转移到下一个账单周期。
    优先转移到同一合同的下一期账单。
    若无下一期账单，则转移到同一客户名下，另一指定合同的账单中。
    """
    data = request.get_json()
    # destination_contract_id 现在是可选的
    destination_contract_id = data.get("destination_contract_id")

    try:
        # 1. 数据校验
        source_adj = db.session.get(FinancialAdjustment, adjustment_id)
        if not source_adj:
            return jsonify({"error": "需要转移的财务调整项未找到"}), 404

        # 精确检查，只禁止对“已转出”或“冲账”的条目进行操作
        if source_adj.details and source_adj.details.get('status') in ['transferred_out', 'offsetting_transfer']:
            return jsonify({"error": "该款项是转出或冲账条目，无法再次转移"}), 400

        source_bill_or_payroll = None
        is_employee_adj = False
        if source_adj.customer_bill_id:
            source_bill_or_payroll = db.session.get(CustomerBill,source_adj.customer_bill_id)
            source_contract = source_bill_or_payroll.contract
        elif source_adj.employee_payroll_id:
            source_bill_or_payroll = db.session.get(EmployeePayroll,source_adj.employee_payroll_id)
            source_contract = source_bill_or_payroll.contract
            is_employee_adj = True
        else:
            return jsonify({"error": "源财务调整项未关联到任何账单或薪酬单"}), 500

        if not source_bill_or_payroll:
             return jsonify({"error": "找不到源财务调整项所属的账单或薪酬单"}),500

        # 2. 智能确定目标账单
        destination_bill = None
        dest_contract = None

        # 策略一：查找同一合同的下一期账单
        next_bill_in_contract = CustomerBill.query.filter(
            CustomerBill.contract_id == source_contract.id,
            CustomerBill.cycle_start_date >source_bill_or_payroll.cycle_start_date,
            CustomerBill.is_substitute_bill == False
        ).order_by(CustomerBill.cycle_start_date.asc()).first()

        if next_bill_in_contract:
            destination_bill = next_bill_in_contract
            dest_contract = source_contract
            current_app.logger.info(f"找到同一合同的下一期账单 {destination_bill.id} 作为转移目标。")

        # 策略二：如果策略一失败，且提供了目标合同ID，则使用现有逻辑
        elif destination_contract_id:
            dest_contract = db.session.get(BaseContract, destination_contract_id)
            if not dest_contract:
                return jsonify({"error": "目标合同未找到"}), 404
            if source_contract.customer_name != dest_contract.customer_name:
                return jsonify({"error": "只能在同一客户名下的不同合同间转移"}),400

            # 查找目标合同的最早一期账单
            destination_bill = CustomerBill.query.filter(
                CustomerBill.contract_id == dest_contract.id,
                CustomerBill.is_substitute_bill == False
            ).order_by(CustomerBill.cycle_start_date.asc()).first()

            if not destination_bill:
                return jsonify({"error": "目标合同没有任何账单，无法接收转移款项"}), 400
            current_app.logger.info(f"使用指定的另一个合同 {dest_contract.id} 的账单 {destination_bill.id} 作为转移目标。")

        else:
            return jsonify({"error":"当前合同已无后续账单，且未指定可供转移的目标合同。"}), 400

        # 3. 执行转移和冲抵操作
        with db.session.begin_nested():
            original_description = source_adj.description

            # 3a. 在目标账单下创建“转入”项
            original_type_label =ADJUSTMENT_TYPE_LABELS.get(source_adj.adjustment_type,source_adj.adjustment_type.name)
            new_adj_in = FinancialAdjustment(
                adjustment_type=source_adj.adjustment_type,
                amount=source_adj.amount,
                description=f"[转入] {original_type_label}: {original_description}",
                date=destination_bill.cycle_start_date,
                details={
                    "status": "transferred_in",
                    "transferred_from_adjustment_id": str(source_adj.id),
                    "transferred_from_bill_id": str(source_bill_or_payroll.id),
                    "transferred_from_bill_info": f"{source_bill_or_payroll.year}-{source_bill_or_payroll.month}"
                }
            )

            dest_payroll = None
            if is_employee_adj:
                dest_payroll = EmployeePayroll.query.filter_by(
                    contract_id=destination_bill.contract_id,
                    cycle_start_date=destination_bill.cycle_start_date
                ).first()
                if not dest_payroll:
                    raise Exception("目标账单没有对应的薪酬单，无法转移员工调整项")
                new_adj_in.employee_payroll_id = dest_payroll.id
            else:
                new_adj_in.customer_bill_id = destination_bill.id

            db.session.add(new_adj_in)
            db.session.flush()

            # 3b. 在源账单下，创建一笔冲抵项
            offsetting_type = None
            if source_adj.adjustment_type in [AdjustmentType.CUSTOMER_INCREASE,AdjustmentType.EMPLOYEE_DECREASE]:
                offsetting_type = AdjustmentType.CUSTOMER_DECREASE if not is_employee_adj else AdjustmentType.EMPLOYEE_INCREASE
            elif source_adj.adjustment_type in [AdjustmentType.CUSTOMER_DECREASE,AdjustmentType.EMPLOYEE_INCREASE]:
                offsetting_type = AdjustmentType.CUSTOMER_INCREASE if not is_employee_adj else AdjustmentType.EMPLOYEE_DECREASE
            else:
                offsetting_type = AdjustmentType.CUSTOMER_DECREASE if not is_employee_adj else AdjustmentType.EMPLOYEE_INCREASE

            offsetting_adj = FinancialAdjustment(
                adjustment_type=offsetting_type,
                amount=source_adj.amount,
                description=f"[冲账] {original_description}",
                date=source_bill_or_payroll.cycle_end_date,
                details={
                    "status": "offsetting_transfer",
                    "offset_for_adjustment_id": str(source_adj.id),
                    "linked_adjustment_id": str(new_adj_in.id),
                    "transferred_to_bill_id": str(destination_bill.id),
                    "transferred_to_bill_info": f"{destination_bill.year}-{destination_bill.month}"
                }
            )
            if is_employee_adj:
                offsetting_adj.employee_payroll_id = source_bill_or_payroll.id
            else:
                offsetting_adj.customer_bill_id = source_bill_or_payroll.id

            db.session.add(offsetting_adj)

            # 3c. 更新源调整项，标记为已转移
            source_adj.details = {
                "status": "transferred_out",
                "transferred_to_contract_id": str(dest_contract.id),
                "transferred_to_bill_id": str(destination_bill.id),
                "transferred_to_bill_info": f"{destination_bill.year}-{destination_bill.month}",
                "offsetting_adjustment_id": str(offsetting_adj.id)
            }
            source_adj.description = f"{original_description} [已转移]"
            attributes.flag_modified(source_adj, "details")

            # 3d. 记录日志
            log_to_customer = dest_contract.customer_name if dest_contract else source_contract.customer_name
            _log_activity(source_bill_or_payroll if not is_employee_adj else None,source_bill_or_payroll if is_employee_adj else None, "执行款项转移(转出)",details={"amount": str(source_adj.amount), "description": original_description,"to_customer": log_to_customer})
            _log_activity(destination_bill if not is_employee_adj else None,dest_payroll, "接收转移款项(转入)", details={"amount": str(new_adj_in.amount),"description": original_description, "from_customer":source_contract.customer_name})

        db.session.commit()

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"款项转移操作失败: {e}", exc_info=True)
        return jsonify({"error": f"服务器内部错误，转移操作失败: {e}"}), 500

    # 4. 触发重算
    recalculation_error = None
    try:
        engine = BillingEngine()
        # 重算源账单
        engine.calculate_for_month(year=source_bill_or_payroll.year,month=source_bill_or_payroll.month, contract_id=source_contract.id,force_recalculate=True,cycle_start_date_override=source_bill_or_payroll.cycle_start_date)
        # 重算目标账单
        if destination_bill:
             engine.calculate_for_month(year=destination_bill.year,month=destination_bill.month, contract_id=dest_contract.id, force_recalculate=True,cycle_start_date_override=destination_bill.cycle_start_date)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"款项转移后重算账单失败: {e}", exc_info=True)
        recalculation_error = f"自动重算失败: {e}"
    
    # 5. 获取并返回更新后的源账单完整信息
    refresh_bill_id = None
    if not is_employee_adj:
        # 如果是客户侧调整，直接用 bill id
        refresh_bill_id = source_bill_or_payroll.id
    else:
        # 如果是员工侧调整，需要找到对应的客户账单ID
        source_customer_bill = CustomerBill.query.filter_by(
            contract_id=source_contract.id,
            cycle_start_date=source_bill_or_payroll.cycle_start_date,
            is_substitute_bill=source_bill_or_payroll.is_substitute_payroll
        ).first()
        if source_customer_bill:
            refresh_bill_id = source_customer_bill.id

    latest_details = _get_billing_details_internal(bill_id=refresh_bill_id) if refresh_bill_id else None

    response_message = "款项转移成功。"
    if recalculation_error:
        response_message += f" 但{recalculation_error}，请尝试手动重算。"
    else:
        response_message += " 账单已自动重算。"

    return jsonify({
        "message": response_message,
        "latest_details": latest_details
    })
    


def _update_bill_payment_status(bill: CustomerBill):
    """
    根据一个账单的所有支付记录，更新其 total_paid 和 payment_status.
    """
    if not bill:
        return

    # 计算已支付总额
    total_paid = db.session.query(func.sum(PaymentRecord.amount)).filter(
        PaymentRecord.customer_bill_id == bill.id
    ).scalar() or D(0)

    bill.total_paid = total_paid.quantize(D("0.01"))

    # 更新支付状态
    if bill.total_paid <= 0:
        bill.payment_status = PaymentStatus.UNPAID
    elif bill.total_paid < bill.total_due:
        bill.payment_status = PaymentStatus.PARTIALLY_PAID
    elif bill.total_paid == bill.total_due:
        bill.payment_status = PaymentStatus.PAID
    else: # total_paid > bill.total_due
        bill.payment_status = PaymentStatus.OVERPAID

    db.session.add(bill)
    current_app.logger.info(f"Updated bill {bill.id} status to {bill.payment_status.value} with total_paid {bill.total_paid}")


@billing_bp.route("/bills/<string:bill_id>/payments", methods=["POST", "OPTIONS"])
@admin_required
def add_payment_record(bill_id):
    if request.method == 'OPTIONS':
        return jsonify({'status': 'ok'}), 200

    bill = db.session.get(CustomerBill, bill_id)
    if not bill:
        return jsonify({"error": "账单未找到"}), 404

    data = request.form
    if not data or not data.get('amount') or not data.get('payment_date'):
        return jsonify({"error": "必须提供支付金额和支付日期"}), 400

    image_url = None
    if 'image' in request.files:
        image_file = request.files['image']
        image_url = _handle_image_upload(image_file)

    try:
        new_payment = PaymentRecord(
            customer_bill_id=bill.id,
            amount=D(data['amount']),
            payment_date=date_parse(data['payment_date']).date(),
            method=data.get('method'),
            notes=data.get('notes'),
            image_url=image_url,
            created_by_user_id=get_jwt_identity()
        )
        db.session.add(new_payment)

        _update_bill_payment_status(bill)

        log_action = f"新增了支付记录，金额: {new_payment.amount:.2f}"
        _log_activity(bill, None, log_action, details=dict(data))

        db.session.commit()

        return jsonify({"message": "支付记录添加成功"}), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"添加支付记录失败 (bill_id: {bill_id}): {e}",exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500
    
def _update_payroll_payout_status(payroll: EmployeePayroll):
    """
    根据一个薪酬单的所有支付记录，更新其 total_paid_out 和 payout_status.
    """
    if not payroll:
        return

    total_paid_out = db.session.query(func.sum(PayoutRecord.amount)).filter(
        PayoutRecord.employee_payroll_id == payroll.id
    ).scalar() or D(0)

    payroll.total_paid_out = total_paid_out.quantize(D("0.01"))

    if payroll.total_paid_out <= 0:
        payroll.payout_status = PayoutStatus.UNPAID
    elif payroll.total_paid_out < payroll.total_due:
        payroll.payout_status = PayoutStatus.PARTIALLY_PAID
    else: # total_paid_out >= payroll.total_due
        payroll.payout_status = PayoutStatus.PAID

    db.session.add(payroll)
    current_app.logger.info(f"Updated payroll {payroll.id} status to {payroll.payout_status.value} with total_paid_out {payroll.total_paid_out}")

@billing_bp.route("/payrolls/<string:payroll_id>/payouts", methods=["POST", "OPTIONS"])
@admin_required
def add_payout_record(payroll_id):
    if request.method == 'OPTIONS':
        return jsonify({'status': 'ok'}), 200

    payroll = db.session.get(EmployeePayroll, payroll_id)
    if not payroll:
        return jsonify({"error": "薪酬单未找到"}), 404

    data = request.form
    if not data or not data.get('amount') or not data.get('payout_date'):
        return jsonify({"error": "必须提供支付金额和支付日期"}), 400

    image_url = None
    if 'image' in request.files:
        image_file = request.files['image']
        image_url = _handle_image_upload(image_file)

    try:
        new_payout = PayoutRecord(
            employee_payroll_id=payroll.id,
            amount=D(data['amount']),
            payout_date=date_parse(data['payout_date']).date(),
            method=data.get('method'),
            notes=data.get('notes'),
            payer=data.get('payer'),
            image_url=image_url,
            created_by_user_id=get_jwt_identity()
        )
        db.session.add(new_payout)

        _update_payroll_payout_status(payroll)

        log_action = f"新增了工资发放记录，金额: {new_payout.amount:.2f}"
        _log_activity(None, payroll, log_action, details=dict(data))

        db.session.commit()

        return jsonify({"message": "工资发放记录添加成功"}), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"添加工资发放记录失败 (payroll_id: {payroll_id}):{e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

@billing_bp.route("/payments/<uuid:payment_id>", methods=["DELETE", "OPTIONS"])
@admin_required
def delete_payment_record(payment_id):
    if request.method == 'OPTIONS':
        return jsonify({'status': 'ok'}), 200

    payment_record = db.session.get(PaymentRecord, payment_id)
    if not payment_record:
        return jsonify({"error": "支付记录未找到"}), 404

    bill = payment_record.customer_bill
    log_details = payment_record.to_dict()

    try:
        db.session.delete(payment_record)
        _update_bill_payment_status(bill)
        log_action = f"删除了支付记录，金额: {log_details['amount']}"
        _log_activity(bill, None, log_action, details=log_details)
        db.session.commit()
        return jsonify({"message": "支付记录删除成功"}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"删除支付记录失败 (id: {payment_id}): {e}",exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

@billing_bp.route("/payouts/<uuid:payout_id>", methods=["DELETE", "OPTIONS"])
@admin_required
def delete_payout_record(payout_id):
    if request.method == 'OPTIONS':
        return jsonify({'status': 'ok'}), 200

    payout_record = db.session.get(PayoutRecord, payout_id)
    if not payout_record:
        return jsonify({"error": "工资发放记录未找到"}), 404

    payroll = payout_record.employee_payroll
    log_details = payout_record.to_dict()

    try:
        db.session.delete(payout_record)
        _update_payroll_payout_status(payroll)
        log_action = f"删除了工资发放记录，金额: {log_details['amount']}"
        _log_activity(None, payroll, log_action, details=log_details)
        db.session.commit()
        return jsonify({"message": "工资发放记录删除成功"}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"删除工资发放记录失败 (id: {payout_id}): {e}",exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500
    
def _allowed_file(filename):
    ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def _handle_image_upload(file_storage):
    """Saves an image from a FileStorage object and returns its URL."""
    if not file_storage or file_storage.filename == '':
        return None

    if _allowed_file(file_storage.filename):
        filename = secure_filename(file_storage.filename)
        unique_filename = str(uuid.uuid4()) + "_" + filename

        # 确保上传目录存在
        upload_folder = os.path.join(current_app.instance_path, 'uploads','financial_records')
        os.makedirs(upload_folder, exist_ok=True)

        file_path = os.path.join(upload_folder, unique_filename)
        file_storage.save(file_path)

        # 返回用于存入数据库的URL路径
        return f"/uploads/financial_records/{unique_filename}"
