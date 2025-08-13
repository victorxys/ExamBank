# backend/api/billing_api.py (添加考勤录入API)

from flask import Blueprint, jsonify, current_app, request
from flask_jwt_extended import jwt_required
from sqlalchemy import or_, case, and_
from sqlalchemy.orm import with_polymorphic, attributes
from flask_jwt_extended import get_jwt_identity
from dateutil.parser import parse as date_parse
from sqlalchemy.orm import with_polymorphic # <--- 别忘了导入
from sqlalchemy import func, distinct
from sqlalchemy.sql import extract
import csv # <-- 添加此行
import io # <-- 添加此行
import calendar
from datetime import date, timedelta
from datetime import datetime
import decimal
from dateutil.relativedelta import relativedelta
from collections import defaultdict


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
)
from backend.tasks import (
    sync_all_contracts_task,
    calculate_monthly_billing_task,
    generate_all_bills_for_contract_task,
)  # 导入新任务
from backend.services.billing_engine import BillingEngine
from backend.models import AdjustmentType

D = decimal.Decimal

billing_bp = Blueprint("billing_api", __name__, url_prefix="/api/billing")


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
    customer_details.update(
        {
            "id": str(customer_bill.id),
            "calculation_details": calc_cust,  # <-- 核心修正：传递完整的 calculation_details
            "final_amount": {"客应付款": str(customer_bill.total_payable)},
        }
    )
    _fill_payment_status(
        customer_details,
        customer_bill.payment_details,
        customer_bill.is_paid,
        is_customer=True,
    )
    _fill_group_fields(
        customer_details["groups"][1]["fields"],
        calc_cust,
        ["base_work_days", "overtime_days", "total_days_worked", "substitute_days"],
    )
    _fill_group_fields(
        customer_details["groups"][2]["fields"],
        calc_cust,
        [
            # "customer_base_fee",
            # "customer_overtime_fee",
            "management_fee",
            "management_fee_rate",
            # "substitute_deduction",
        ],
    )
    if contract.type == "nanny":
        customer_details["groups"][2]["fields"]["本次交管理费"] = calc_cust.get(
            "management_fee", "待计算"
        )

    # --- 修正：如果当前是替班账单，覆盖客户账单中的“级别”为替班员工的日薪 ---
    if customer_bill.is_substitute_bill:
        sub_record = customer_bill.source_substitute_record
        if sub_record:
            # 找到“级别与保证金”组，并更新“级别”字段
            for group in customer_details["groups"]:
                if group["name"] == "级别与保证金":
                    group["fields"]["级别"] = str(sub_record.substitute_salary or "0")
                    break

    # --- 员工薪酬详情 ---
    if employee_payroll:
        calc_payroll = employee_payroll.calculation_details or {}
        employee_details.update(
            {
                "id": str(employee_payroll.id),
                "calculation_details": calc_payroll,  # <-- 核心修正：传递完整的 calculation_details
                "final_amount": {"萌嫂应领款": str(employee_payroll.final_payout)},
            }
        )
        _fill_payment_status(
            employee_details,
            employee_payroll.payout_details,
            employee_payroll.is_paid,
            is_customer=False,
        )
        _fill_group_fields(
            employee_details["groups"][0]["fields"],
            calc_payroll,
            [
                "employee_base_payout",
                "employee_overtime_payout",
                "first_month_deduction",
                "substitute_deduction",
            ],
            is_substitute_payroll=employee_payroll.is_substitute_payroll,
        )

    # --- Gemini Final Fix: Start ---
    # 重构查询逻辑，确保只获取与当前账单或薪酬单严格关联的调整项
    adjustment_filters = []
    if customer_bill:
        adjustment_filters.append(FinancialAdjustment.customer_bill_id == customer_bill.id)
    
    if employee_payroll:
        adjustment_filters.append(FinancialAdjustment.employee_payroll_id == employee_payroll.id)

    adjustments = []
    if adjustment_filters:
        adjustments = FinancialAdjustment.query.filter(or_(*adjustment_filters)).all()
    # --- Gemini Final Fix: End ---

    # --- 获取加班天数 ---
    overtime_days = 0
    if customer_bill.is_substitute_bill:
        sub_record = customer_bill.source_substitute_record  # 替班账单关联的替班记录
        if sub_record:
            overtime_days = sub_record.overtime_days or 0
    else:
        attendance_record = AttendanceRecord.query.filter_by(
            contract_id=contract.id, cycle_start_date=cycle_start
        ).first()
        if attendance_record:
            overtime_days = attendance_record.overtime_days

    # --- Gemini Final Fix for issue #3: Start ---
    # 在返回账单详情时，补充关联合同的介绍费和备注
    if contract.type == 'nanny_trial':
        customer_details['groups'][0]['fields']['介绍费'] = str(getattr(contract, "introduction_fee", "0.00"))

    customer_details['groups'][0]['fields']['合同备注'] = contract.notes or "—"
    # --- Gemini Final Fix for issue #3: End ---
    current_app.logger.debug(f"获取到加班记录:{overtime_days}")
    current_app.logger.info(f"[BACKEND-DEBUG] Final 'attendance' object being sent to frontend: {{'overtime_days': {float(overtime_days) if overtime_days is not None else 0}}}")
    
     # 添加 is_last_bill 标志
    is_last_bill = False
    later_bill_exists = db.session.query(
        db.session.query(CustomerBill)
        .filter(
            CustomerBill.contract_id == contract.id,
            CustomerBill.is_substitute_bill == False,
            CustomerBill.cycle_start_date > customer_bill.cycle_start_date
        ).exists()
    ).scalar()

    is_last_bill = not later_bill_exists
    
    
    # --- ITERATION v2: START ---
    # 统一处理所有合同类型的“延长服务”逻辑

    # 1. 确定合同是否符合延长的基本资格及其权威结束日期
    is_eligible_for_extension = False
    authoritative_end_date = None

    # 前提条件：必须是最后一期账单
    if is_last_bill:
        # 场景A: 育儿嫂（非月签）
        if contract.type == 'nanny' and not getattr(contract, 'is_monthly_auto_renew', False):
            is_eligible_for_extension = True
            authoritative_end_date = contract.end_date

        # 场景B: 月嫂
        elif contract.type == 'maternity_nurse':
            is_eligible_for_extension = True
            # 月嫂的权威结束日期优先使用“预计下户日期”，若无则使用合同结束日期
            authoritative_end_date = getattr(contract, 'expected_offboarding_date', None) or contract.end_date

    # 2. 如果符合资格，则执行统一的计算和注入逻辑
    if is_eligible_for_extension and authoritative_end_date:

        # 只有当账单的结束日期 > 合同的权威结束日期时，才视为延长
        if customer_bill.cycle_end_date > authoritative_end_date:
            extension_days = (customer_bill.cycle_end_date - authoritative_end_date).days

            if extension_days > 0:
                # 准备日志信息
                extension_log = f"原合同于 {authoritative_end_date.strftime('%m月%d日')} 结束，手动延长至 {customer_bill.cycle_end_date.strftime('%m月%d日')}，共 {extension_days} 天。"

                # 计算延长期服务费 (此公式对两种合同通用)
                level = D(contract.employee_level or '0')
                daily_rate = level / D(26)
                extension_fee = (daily_rate * D(extension_days)).quantize(D('0.01'))
                extension_fee_log = f"级别({level:.2f})/26 * 延长天数({extension_days}) = {extension_fee:.2f}"

                # 确保 calculation_details 和 log_extras 字典存在
                if "calculation_details" not in customer_details:
                    customer_details["calculation_details"] = {}
                if "log_extras" not in customer_details["calculation_details"]:
                    customer_details["calculation_details"]["log_extras"] = {}

                # 注入到 customer_details (前端客户账单)
                for group in customer_details["groups"]:
                    if group["name"] == "劳务周期":
                        group["fields"]["延长服务天数"] = str(extension_days)
                        customer_details["calculation_details"]["log_extras"]["extension_days_reason"] = extension_log

                    if group["name"] == "费用明细":
                        group["fields"]["延长期服务费"] = str(extension_fee)
                        customer_details["calculation_details"]["log_extras"]["extension_fee_reason"] = extension_fee_log

                # 注入到 employee_details (前端员工薪酬)
                if employee_details and employee_details.get("groups"):
                    for group in employee_details["groups"]:
                        if group["name"] == "劳务周期":
                            group["fields"]["延长服务天数"] = str(extension_days)
                        if group["name"] == "薪酬明细":
                            group["fields"]["延长期服务费"] = str(extension_fee)
    # --- ITERATION v2: END ---
    
    return {
        "customer_bill_details": customer_details,
        "employee_payroll_details": employee_details,
        "adjustments": [adj.to_dict() for adj in adjustments],
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
    days_adjustment = 1
    if contract.type == "nanny" and cycle_start != contract.start_date:
        days_adjustment = 1
    customer_groups = [
        {
            "name": "级别与保证金",
            "fields": {
                "级别": str(contract.employee_level or 0),
                # "客交保证金": str(getattr(contract, 'security_deposit_paid', 0)) if is_maternity else "0.00",
                "客交保证金": str(getattr(contract, "security_deposit_paid", 0)),
                "定金": str(getattr(contract, "deposit_amount", 0))
                if is_maternity
                else "0.00",
                "介绍费": str(getattr(contract, "introduction_fee", "0.00")),
                "合同备注": contract.notes or "—",
            },
        },
        {
            "name": "劳务周期",
            "fields": {
                "劳务时间段": f"{cycle_start.isoformat()} ~ {cycle_end.isoformat()} ({ (cycle_end - cycle_start).days + days_adjustment }天)",
                "基本劳务天数": "待计算",
                "加班天数": "0",
                "被替班天数": "0",
                "总劳务天数": "待计算",
            },
        },
        {"name": "费用明细", "fields": {}},
    ]
    employee_groups = [{"name": "薪酬明细", "fields": {
        # "级别": str(contract.employee_level or 0)
    }}]

    if is_maternity:
        customer_groups[2]["fields"] = {
            # "基础劳务费": "待计算",
            # "加班费": "待计算",
            "管理费": "待计算",
            # "被替班费用": "0.00",
            "优惠": str(getattr(contract, "discount_amount", 0)),
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
            # "基础劳务费": "待计算",
            # "加班费": "待计算",
            "本次交管理费": "待计算",
            # "被替班费用": "0.00",
        }
        employee_groups[0]["fields"] = {
            "级别": str(contract.employee_level or 0),
            "基础劳务费": "待计算",
            "加班费": "待计算",
            "被替班费用": "0.00",
            "首月员工10%费用": "待计算",
        }

    return {"id": None, "groups": customer_groups}, {
        "id": None,
        "groups": employee_groups,
    }


def _fill_payment_status(details, payment_data, is_paid, is_customer):
    payment = payment_data or {}
    status_dict = {}

    if is_customer:
        # --- 客户账单 ---
        invoice_needed = payment.get('invoice_needed', False)

        # 核心修正：根据是否存在发票信息来动态决定 issued 状态
        invoice_amount = payment.get('invoice_amount')
        invoice_number = payment.get('invoice_number')
        # 只要有金额或号码，就认为“已开票”这个动作发生了
        invoice_issued = bool(invoice_amount or invoice_number)

        status_dict['customer_is_paid'] = is_paid
        status_dict['customer_payment_date'] = payment.get('payment_date')
        status_dict['customer_payment_channel'] = payment.get('payment_channel')
        status_dict['invoice_needed'] = invoice_needed
        status_dict['invoice_issued'] = invoice_issued # 使用我们动态计算的值

        status_dict['是否打款'] = '是' if is_paid else '否'
        status_dict['打款时间及渠道'] = f"{payment.get('payment_date', '') or '—'} / {payment.get('payment_channel', '') or '—'}"if is_paid else "—"
        status_dict['发票记录'] = '无需开票' if not invoice_needed else ('已开票' if invoice_issued else '待开票')
    else:
        # --- 员工薪酬 (保持不变) ---
        status_dict['employee_is_paid'] = is_paid
        status_dict['employee_payout_date'] = payment.get('date')
        status_dict['employee_payout_channel'] = payment.get('channel')
        status_dict['是否领款'] = '是' if is_paid else '否'
        status_dict['领款时间及渠道'] = f"{payment.get('date', '') or '—'} / {payment.get('channel', '') or '—'}" if is_paid else"—"

    details['payment_status'] = status_dict

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

        payment_status = request.args.get("payment_status", "")
        payout_status = request.args.get("payout_status", "")

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
                    contract_poly.customer_name_pinyin.ilike(f"%{search_term}%"),
                    User.username.ilike(f"%{search_term}%"),
                    User.name_pinyin.ilike(f"%{search_term}%"),
                    ServicePersonnel.name.ilike(f"%{search_term}%"),
                    ServicePersonnel.name_pinyin.ilike(f"%{search_term}%"),
                )
            )

        if payment_status == "paid":
            query = query.filter(CustomerBill.is_paid)
        elif payment_status == "unpaid":
            query = query.filter(~CustomerBill.is_paid)

        if payout_status:
            query = query.join(
                EmployeePayroll,
                and_(
                    EmployeePayroll.contract_id == CustomerBill.contract_id,
                    EmployeePayroll.cycle_start_date == CustomerBill.cycle_start_date,
                ),
            )
            if payout_status == "paid":
                query = query.filter(EmployeePayroll.is_paid)
            elif payout_status == "unpaid":
                query = query.filter(~EmployeePayroll.is_paid)

        query = query.order_by(
            contract_poly.customer_name, CustomerBill.cycle_start_date
        )
        # --- 修正：分两步计算总计，避免JOIN导致重复计算 ---
        # 1. 先根据所有筛选条件，获取匹配账单的ID列表
        filtered_bill_ids_query = query.with_entities(CustomerBill.id)
        filtered_bill_ids = [item[0] for item in filtered_bill_ids_query.all()]

        # 2. 然后只对这些ID进行干净的聚合查询
        total_management_fee = 0
        if filtered_bill_ids:
            total_management_fee = db.session.query(
                func.sum(CustomerBill.calculation_details['management_fee'].as_float())
            ).filter(
                CustomerBill.id.in_(filtered_bill_ids)
            ).scalar() or 0
        # --- 修正结束 ---
        paginated_results = query.paginate(
            page=page, per_page=per_page, error_out=False
        )

        results = []
        engine = BillingEngine() # 初始化引擎

        for i, (bill, contract) in enumerate(paginated_results.items):
            payroll = EmployeePayroll.query.filter_by(
                contract_id=bill.contract_id, cycle_start_date=bill.cycle_start_date
            ).first()

            # 为每个账单计算其发票余额
            invoice_balance = engine.calculate_invoice_balance(str(bill.id))
            

            item = {
                "id": str(bill.id),
                "contract_id": str(contract.id),
                "customer_name": contract.customer_name,
                "status": contract.status,
                "customer_payable": str(bill.total_payable) if bill else "待计算",
                "customer_is_paid": bill.is_paid,
                 "is_deferred": bill.is_deferred,
                "employee_payout": str(payroll.final_payout) if payroll else "待计算",
                "employee_is_paid": payroll.is_paid if payroll else False,
                "is_substitute_bill": bill.is_substitute_bill,
                "contract_type_label": get_contract_type_details(contract.type),
                "is_monthly_auto_renew": getattr(contract, 'is_monthly_auto_renew', False),
                "contract_type_value": contract.type,
                "employee_level": str(contract.employee_level or "0"),
                "active_cycle_start": bill.cycle_start_date.isoformat()
                if bill.cycle_start_date
                else None,
                "active_cycle_end": bill.cycle_end_date.isoformat()
                if bill.cycle_end_date
                else None,
                # --- 新增字段 ---
                "invoice_needed": invoice_balance.get("auto_invoice_needed", False),
                "remaining_invoice_amount": str(invoice_balance.get("remaining_un_invoiced", "0.00"))
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
            db.session.query(CustomerBill.contract_id, CustomerBill.total_payable)
            .filter(
                CustomerBill.contract_id.in_(contract_ids),
                CustomerBill.year == billing_year,
                CustomerBill.month == billing_month,
            )
            .all()
        )

        # 将结果转换为字典，方便前端查找
        summary_map = {
            str(contract_id): str(total_payable)
            for contract_id, total_payable in summaries
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
                new_onboarding_date = datetime.strptime(new_onboarding_date_str, "%Y-%m-%d").date()
                if isinstance(contract, MaternityNurseContract):
                    # 只有当日期实际发生变化时才继续
                    if contract.actual_onboarding_date != new_onboarding_date:
                        contract.actual_onboarding_date = new_onboarding_date

                        # 重新计算预计下户日期
                        if contract.provisional_start_date and contract.end_date:
                            total_days = (contract.end_date - contract.provisional_start_date).days
                            contract.expected_offboarding_date = new_onboarding_date + timedelta(days=total_days)
                        else:
                            contract.expected_offboarding_date = new_onboarding_date + timedelta(days=26)

                        should_generate_bills = True
                else:
                    return jsonify({"error": "只有月嫂合同才能设置实际上户日期"}), 400
            else:
                # 如果传入空值，则清空日期
                if isinstance(contract, MaternityNurseContract):
                    contract.actual_onboarding_date = None
                    contract.expected_offboarding_date = None
        # --- 新增：处理介绍费 ---
        if "introduction_fee" in data and hasattr(contract, 'introduction_fee'):
            new_fee = D(data["introduction_fee"] or 0)
            if contract.introduction_fee != new_fee:
                log_details['介绍费'] = {'from': str(contract.introduction_fee), 'to': str(new_fee)}
                contract.introduction_fee = new_fee

        # --- 新增：处理备注 (只追加逻辑) ---
        if "notes" in data:
            original_note = contract.notes or ""
            appended_note = data["notes"] or ""

            separator = "\\n\\n--- 运营备注 ---\\n"

            # 检查原始备注中是否已有运营备注
            if separator in original_note:
                base_note = original_note.split(separator)[0]
                new_full_note = f"{base_note}{separator}{appended_note}"
            else:
                # 如果没有，则直接追加
                new_full_note = f"{original_note}{separator}{appended_note}"

            if contract.notes != new_full_note:
                log_details['备注'] = {'from': contract.notes, 'to': new_full_note}
                contract.notes = new_full_note

        # 如果有任何变更，记录日志
        if log_details:
            # 找到任意一个关联的账单或薪酬单来挂载日志
            any_bill = CustomerBill.query.filter_by(contract_id=contract.id).first()
            any_payroll = EmployeePayroll.query.filter_by(contract_id=contract.id).first()
            _log_activity(any_bill, any_payroll, "更新了合同详情", details=log_details)


        # 先提交对合同日期的修改
        db.session.commit()

        # 如果需要，触发唯一的后台任务
        if should_generate_bills:
            current_app.logger.info(f"为合同 {contract.id} 触发统一的后台账单生成任务...")
            generate_all_bills_for_contract_task.delay(str(contract.id))
            return jsonify({"message": "合同信息更新成功，并已在后台开始生成所有相关账单。"})

        return jsonify({"message": "合同信息更新成功"})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新合同 {contract_id} 失败: {e}", exc_info=True)
        return jsonify({"error": "更新合同失败，服务器内部错误"}), 500


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

        # --- 核心修复：区分替班账单和普通账单 ---
        if bill.is_substitute_bill:
            # --- 这是替班账单的逻辑 ---
            sub_record = bill.source_substitute_record
            if not sub_record:
                return jsonify({"error": "未找到关联的替班记录"}), 404

            # 1. 更新加班天数
            if "overtime_days" in data:
                new_overtime_decimal = D(str(data.get("overtime_days", "0")))
                if sub_record.overtime_days != new_overtime_decimal:
                    _log_activity(bill, payroll, "修改替班加班天数", {"from": str(sub_record.overtime_days), "to": str(new_overtime_decimal)})
                    sub_record.overtime_days = new_overtime_decimal

            # (注意：此处可以根据需要，从 else 分支中复制处理财务调整项的逻辑)

            db.session.commit()

            # 2. 【关键】调用替班专用的重算方法
            current_app.logger.info(f"正在为替班记录 {sub_record.id} 触发重新计算...")
            engine.calculate_for_substitute(sub_record.id)
        else:
            # --- 这是普通账单的逻辑 (将现有代码移入) ---
            # --- 1. 处理多发票记录 ---
            invoices_from_frontend = data.get('invoices', [])
            existing_invoices_map = {str(inv.id): inv for inv in bill.invoices}
            new_invoice_ids = set()

            for inv_data in invoices_from_frontend:
                inv_id = inv_data.get('id')
                amount = D(inv_data.get('amount', '0'))
                issue_date_str = inv_data.get('issue_date')
                issue_date = date_parse(issue_date_str).date() if issue_date_str and issue_date_str else None
                invoice_number = inv_data.get('invoice_number')
                notes = inv_data.get('notes')

                if inv_id and str(inv_id) in existing_invoices_map:
                    new_invoice_ids.add(str(inv_id))
                    invoice_to_update = existing_invoices_map[str(inv_id)]
                    if (invoice_to_update.amount != amount or
                        invoice_to_update.issue_date != issue_date or
                        invoice_to_update.invoice_number != invoice_number or
                        invoice_to_update.notes != notes):
                        _log_activity(bill, None, "更新了发票记录", {
                            "invoice_number": invoice_number,
                            "from_amount": str(invoice_to_update.amount), "to_amount": str(amount)
                        })
                        invoice_to_update.amount = amount
                        invoice_to_update.issue_date = issue_date
                        invoice_to_update.invoice_number = invoice_number
                        invoice_to_update.notes = notes
                elif not inv_id or 'temp' in str(inv_id):
                    new_invoice = InvoiceRecord(
                        customer_bill_id=bill.id, amount=amount, issue_date=issue_date,
                        invoice_number=invoice_number, notes=notes
                    )
                    db.session.add(new_invoice)
                    _log_activity(bill, None, "新增了发票记录", {"invoice_number": invoice_number, "amount": str(amount)})

            for old_id, old_invoice in existing_invoices_map.items():
                if old_id not in new_invoice_ids:
                    _log_activity(bill, None, "删除了发票记录", {"invoice_number": old_invoice.invoice_number, "amount": str(old_invoice.amount)})
                    db.session.delete(old_invoice)

            # --- 2. 处理其他字段 ---
            new_actual_work_days = None
            if 'actual_work_days' in data and data['actual_work_days'] is not None and data['actual_work_days'] != '':
                new_actual_work_days = D(str(data['actual_work_days']))
                if bill.actual_work_days != new_actual_work_days:
                    _log_activity(bill, payroll, "修改实际劳务天数", {"from": str(bill.actual_work_days), "to": str(new_actual_work_days)})
                    bill.actual_work_days = new_actual_work_days
                    payroll.actual_work_days = new_actual_work_days
            
            # --- 加班天数精度修正开始 ---
            new_overtime_decimal = D(str(data.get("overtime_days", "0")))
            attendance_record = AttendanceRecord.query.filter_by(contract_id=bill.contract_id, cycle_start_date=bill.cycle_start_date).first()
            
            if attendance_record:
                old_overtime_decimal = attendance_record.overtime_days
                # 比较前，将两边都格式化为两位小数
                if old_overtime_decimal.quantize(D('0.01')) != new_overtime_decimal.quantize(D('0.01')):
                    _log_activity(
                        bill, payroll, "修改加班天数", 
                        {"from": str(old_overtime_decimal.quantize(D('0.01'))), "to": str(new_overtime_decimal.quantize(D('0.01')))}
                    )
                    attendance_record.overtime_days = new_overtime_decimal
            else:
                # 如果记录不存在，且加班大于0，则创建新记录
                if new_overtime_decimal > 0:
                    employee_id = bill.contract.user_id or bill.contract.service_personnel_id
                    if employee_id:
                        attendance_record = AttendanceRecord(
                            employee_id=employee_id,
                            contract_id=bill.contract_id,
                            cycle_start_date=bill.cycle_start_date,
                            cycle_end_date=bill.cycle_end_date,
                            overtime_days=new_overtime_decimal,
                            total_days_worked=0 # 总天数由计算引擎处理
                        )
                        db.session.add(attendance_record)
                        _log_activity(bill, payroll, "新增考勤并设置加班天数", {"to": str(new_overtime_decimal.quantize(D('0.01')))}) 
            # --- 加班天数精度修正结束 ---
            
            # --- 3. 【核心修正】处理财务调整项 ---
            adjustments_data = data.get('adjustments', [])
            ADJUSTMENT_TYPE_LABELS = {
                AdjustmentType.CUSTOMER_INCREASE: "客户增款",
                AdjustmentType.CUSTOMER_DECREASE: "退客户款",
                AdjustmentType.CUSTOMER_DISCOUNT: "优惠",
                AdjustmentType.EMPLOYEE_INCREASE: "员工增款",
                AdjustmentType.EMPLOYEE_DECREASE: "员工减款",
            }
            # 直接查询 FinancialAdjustment 表，而不是通过 bill.adjustments
            old_adjustments_query = FinancialAdjustment.query.filter(
                or_(
                    FinancialAdjustment.customer_bill_id == bill.id,
                    FinancialAdjustment.employee_payroll_id == payroll.id
                )
            ).all()
            old_adjustments_map = {str(adj.id): adj for adj in old_adjustments_query}
            new_adjustments_ids = {str(adj.get('id')) for adj in adjustments_data if adj.get('id')}

            for old_id, old_adj in old_adjustments_map.items():
                if old_id not in new_adjustments_ids:
                    action_label = ADJUSTMENT_TYPE_LABELS.get(old_adj.adjustment_type, old_adj.adjustment_type.name)
                    _log_activity(bill if 'CUSTOMER' in old_adj.adjustment_type.name else None,
                                payroll if 'EMPLOYEE' in old_adj.adjustment_type.name else None,
                                action=f"删除了财务调整: {action_label} ({old_adj.description})",
                                details={"amount": str(old_adj.amount), "type": old_adj.adjustment_type.value})
                    db.session.delete(old_adj)

            for adj_data in adjustments_data:
                adj_type = AdjustmentType(adj_data["adjustment_type"])
                adj_amount = D(adj_data["amount"])
                adj_description = adj_data["description"]
                adj_id = str(adj_data.get('id', ''))

                if adj_id and adj_id in old_adjustments_map:
                    existing_adj = old_adjustments_map[adj_id]
                    if existing_adj.amount != adj_amount or existing_adj.description != adj_description or existing_adj.adjustment_type != adj_type:
                        action_label = ADJUSTMENT_TYPE_LABELS.get(adj_type, adj_type.name)
                        _log_activity(bill if 'CUSTOMER' in adj_type.name else None,
                                    payroll if 'EMPLOYEE' in adj_type.name else None,
                                    action=f"修改了财务调整: {action_label}",
                                    details={"from_amount": str(existing_adj.amount), "to_amount": str(adj_amount),
                                            "from_desc": existing_adj.description, "to_desc": adj_description})
                        existing_adj.amount = adj_amount
                        existing_adj.description = adj_description
                        existing_adj.adjustment_type = adj_type
                elif not adj_id or 'temp' in str(adj_id):
                    action_label = ADJUSTMENT_TYPE_LABELS.get(adj_type, adj_type.name)
                    new_adj = FinancialAdjustment(
                        adjustment_type=adj_type, amount=adj_amount, description=adj_description, date=bill.cycle_start_date
                    )
                    if adj_type.name.startswith("CUSTOMER"):
                        new_adj.customer_bill_id = bill.id
                    else:
                        new_adj.employee_payroll_id = payroll.id
                    db.session.add(new_adj)
                    _log_activity(bill if 'CUSTOMER' in adj_type.name else None,
                                payroll if 'EMPLOYEE' in adj_type.name else None,
                                action=f"新增了财务调整: {action_label} ({adj_description})",
                                details={"amount": str(adj_amount), "type": adj_type.value})

            # --- 4. 处理客户打款和员工领款状态 ---
            settlement_status = data.get('settlement_status', {})
            bill.is_paid = settlement_status.get('customer_is_paid', False)
            payroll.is_paid = settlement_status.get('employee_is_paid', False)
            
            if bill.payment_details is None: bill.payment_details = {}
            payment_date_str = settlement_status.get('customer_payment_date')
            payment_date_obj = date_parse(payment_date_str).date() if payment_date_str and payment_date_str else None
            bill.payment_details['payment_date'] = payment_date_obj.isoformat() if payment_date_obj else None
            bill.payment_details['payment_channel'] = settlement_status.get('customer_payment_channel')
            attributes.flag_modified(bill, "payment_details")

            if payroll.payout_details is None: payroll.payout_details = {}
            payout_date_str = settlement_status.get('employee_payout_date')
            payout_date_obj = date_parse(payout_date_str).date() if payout_date_str and payout_date_str else None
            payroll.payout_details['date'] = payout_date_obj.isoformat() if payout_date_obj else None
            payroll.payout_details['channel'] = settlement_status.get('employee_payout_channel')
            attributes.flag_modified(payroll, "payout_details")

            # --- 5. 更新账单的 invoice_needed 状态 ---
            bill.invoice_needed = data.get('invoice_needed', False)

            db.session.commit()

            # --- 6. 触发重算 ---
            engine = BillingEngine()
            engine.calculate_for_month(
                year=bill.year, month=bill.month, contract_id=bill.contract_id,
                force_recalculate=True, actual_work_days_override=new_actual_work_days,
                cycle_start_date_override=bill.cycle_start_date
            )
            db.session.commit()
        
        # --- 7. 获取并返回最新的完整账单详情 ---
        final_bill = db.session.get(CustomerBill, bill_id)
        latest_details = _get_billing_details_internal(bill_id=final_bill.id)
        invoice_balance = engine.calculate_invoice_balance(final_bill.id)
        latest_details["invoice_balance"] = invoice_balance
        latest_details["invoice_needed"] = final_bill.invoice_needed

        return jsonify({"message": "所有更改已保存并成功重算！", "latest_details": latest_details})

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
    elif contract_type == "nanny_trial":
        return "育儿嫂试工"
    return "未知类型"


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

            actual_onboarding_date = getattr(contract, "actual_onboarding_date", None)
            provisional_start_date = getattr(contract, "provisional_start_date", None)

            remaining_months_str = "N/A"
            highlight_remaining = False

            start_date_for_calc = contract.actual_onboarding_date or contract.start_date

            end_date_for_calc = None
            if contract.type == "maternity_nurse":
                end_date_for_calc = (
                    contract.expected_offboarding_date or contract.end_date
                )
            else:
                end_date_for_calc = contract.end_date

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
                        # days = total_days_remaining % 30
                        remaining_months_str = f"{months}个月"
                        # if days > 0:
                        #     remaining_months_str += f" {days}天"
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
                    "start_date": contract.start_date.isoformat()
                    if contract.start_date
                    else None,
                    "end_date": contract.end_date.isoformat()
                    if contract.end_date
                    else None,
                    "actual_onboarding_date": actual_onboarding_date.isoformat()
                    if actual_onboarding_date
                    else None,
                    "provisional_start_date": provisional_start_date.isoformat()
                    if provisional_start_date
                    else None,
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

    for bill in bills:
        calc = bill.calculation_details or {}

        invoice_balance = engine.calculate_invoice_balance(str(bill.id))

        results.append(
            {
                "id": str(bill.id),
                "billing_period": f"{bill.year}-{str(bill.month).zfill(2)}",
                "cycle_start_date": bill.cycle_start_date.isoformat()
                if bill.cycle_start_date
                else "N/A",
                "cycle_end_date": bill.cycle_end_date.isoformat()
                if bill.cycle_end_date
                else "N/A",
                "total_payable": str(bill.total_payable),
                "status": "已支付" if bill.is_paid else "未支付",
                "overtime_days": calc.get("overtime_days", "0"),
                "base_work_days": calc.get("base_work_days", "0"),
                "is_substitute_bill": bill.is_substitute_bill,
                # **核心修正**: 从 payment_details JSON 字段中获取
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

        # --- 核心修正：使用全新的、更健壮的剩余有效期计算逻辑 ---
        remaining_months_str = "N/A"
        highlight_remaining = False
        today = date.today()

        start_date_for_calc = contract.actual_onboarding_date or contract.start_date
        # end_date_for_calc = getattr(contract, 'expected_offboarding_date', contract.end_date)
        end_date_for_calc = None
        if contract.type == "maternity_nurse":
            end_date_for_calc = contract.expected_offboarding_date or contract.end_date
        else:  # 育儿嫂合同
            end_date_for_calc = contract.end_date

        if isinstance(contract, NannyContract) and getattr(
            contract, "is_monthly_auto_renew", False
        ):
            remaining_months_str = "月签"
        elif start_date_for_calc and end_date_for_calc:
            if start_date_for_calc > today:
                remaining_months_str = "合同未开始"
            elif end_date_for_calc > today:
                # 合同生效中，计算从今天到结束日期的剩余时间
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
                    remaining_months_str = "已结束"  # 理论上不会进入此分支
            else:
                remaining_months_str = "已结束"

        result = {
            "id": str(contract.id),
            "customer_name": contract.customer_name,
            "contact_person": contract.contact_person,
            "employee_name": employee_name,
            "employee_level": contract.employee_level,
            "status": contract.status,
            "start_date": contract.start_date.isoformat()
            if contract.start_date
            else None,
            "end_date": contract.end_date.isoformat() if contract.end_date else None,
            "created_at": contract.created_at.isoformat(),
            "contract_type": contract.type,
            "notes": contract.notes or "",
            "remaining_months": remaining_months_str,
            "highlight_remaining": highlight_remaining,
            "introduction_fee": str(getattr(contract, 'introduction_fee', 0) or 0),
        }

        if contract.type == "maternity_nurse":
            result.update(
                {
                    "deposit_amount": str(contract.deposit_amount or 0),
                    "management_fee_rate": str(contract.management_fee_rate or 0),
                    "provisional_start_date": contract.provisional_start_date.isoformat()
                    if contract.provisional_start_date
                    else None,
                    "actual_onboarding_date": contract.actual_onboarding_date.isoformat()
                    if contract.actual_onboarding_date
                    else None,
                    "expected_offboarding_date": contract.expected_offboarding_date.isoformat()
                    if contract.expected_offboarding_date
                    else None,
                    "security_deposit_paid": str(contract.security_deposit_paid or 0),
                    "discount_amount": str(contract.discount_amount or 0),
                    "management_fee_amount": str(contract.management_fee_amount or 0),
                }
            )
        elif contract.type == "nanny":
            result.update(
                {
                    "is_monthly_auto_renew": contract.is_monthly_auto_renew,
                    "management_fee_paid_months": contract.management_fee_paid_months,
                    "is_first_month_fee_paid": contract.is_first_month_fee_paid,
                    "management_fee_amount": str(contract.management_fee_amount or 0),
                }
            )
        elif contract.type == "nanny_trial":
            pass
        return jsonify(result)

    except Exception as e:
        current_app.logger.error(f"获取合同详情 {contract_id} 失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500


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

    # --- Gemini-generated code: Start ---
    # 核心逻辑：根据合同类型进行不同的处理
    if isinstance(contract, NannyTrialContract):
        # 这是“试工失败”的结算流程
        try:
            if termination_date < contract.start_date:
                return jsonify({"error": "终止日期不能早于合同开始日期"}), 400

            actual_trial_days = (termination_date - contract.start_date).days

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
        original_end_date = contract.end_date
        if termination_date < original_end_date:
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
            if not (
                termination_date.year == original_end_date.year
                and termination_date.month == original_end_date.month
            ):
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

                if original_end_month_refund_amount > 0:
                    description_parts.append(
                        f"  - 原始末月({original_end_date.month}月{original_end_date.day}日)已付 {original_end_date.day} 天: {original_end_month_refund_amount:.2f}元"
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
                # 加1是因为天数计算是包含首尾的
                total_days = (attendance_to_update.cycle_end_date - attendance_to_update.cycle_start_date).days
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
@jwt_required()
def extend_single_bill(bill_id):
    data = request.get_json()
    new_end_date_str = data.get("new_end_date")
    if not new_end_date_str:
        return jsonify({"error": "必须提供新的结束日期"}), 400

    try:
        new_end_date = datetime.strptime(new_end_date_str, "%Y-%m-%d").date()

        bill = db.session.get(CustomerBill, bill_id)
        if not bill:
            return jsonify({"error": "账单未找到"}), 404

        if new_end_date <= bill.cycle_end_date:
            return jsonify({"error": "新的结束日期必须晚于当前结束日期"}), 400

        original_end_date = bill.cycle_end_date
        contract = bill.contract

        # 1. 更新日期
        bill.cycle_end_date = new_end_date
        payroll = EmployeePayroll.query.filter_by(
            contract_id=bill.contract_id,
            cycle_start_date=bill.cycle_start_date
        ).first()
        if payroll:
            payroll.cycle_end_date = new_end_date

        # 2. 记录操作日志
        _log_activity(
            bill,
            payroll,
            action="延长服务期",
            details={
                "from": original_end_date.isoformat(),
                "to": new_end_date.isoformat(),
                "message": f"将服务延长至 {new_end_date.strftime('%m-%d')}"
            }
        )

        # --- Gemini-generated code (Final Fix): Start ---
        # 3. 直接、精确地重算当前账单对象
        engine = BillingEngine()

        # 手动调用计算引擎的内部核心函数，确保在当前事务中完成所有计算
        # 注意：这里的 contract, bill, payroll 都是我们从数据库中获取并已在内存中修改的对象
        # 【关键修复】根据合同类型，调用正确的计费函数
        details = {}
        if contract.type == 'nanny':
            details = engine._calculate_nanny_details(contract, bill, payroll)
        elif contract.type == 'maternity_nurse':
            details = engine._calculate_maternity_nurse_details(contract, bill, payroll)
        else:
            # 如果有其他合同类型，可以在此添加或抛出错误
            return jsonify({"error": f"不支持的合同类型: {contract.type}"}), 400
        bill, payroll = engine._calculate_final_amounts(bill, payroll, details)
        log = engine._create_calculation_log(details)
        engine._update_bill_with_log(bill, payroll, details, log)

        current_app.logger.info(f"账单 {bill.id} 已在当前会话中被直接重算。")
        # --- Gemini-generated code (Final Fix): End ---

        # 4. 在所有操作完成后，一次性提交事务
        db.session.commit()

        # 5. 获取并返回最新的账单详情
        latest_details = _get_billing_details_internal(bill_id=bill.id)
        return jsonify({
            "message": "服务期延长成功，账单已重算。",
            "latest_details": latest_details
        })

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"延长账单 {bill_id} 失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

@billing_bp.route('/customer-bills/<uuid:bill_id>/defer', methods=['POST'])
@admin_required # 假设需要管理员权限
def defer_customer_bill(bill_id):
    """
    将指定账单顺延到下一个账期。
    这是一个手动操作，会立即修改当前账单状态并将金额添加到下一个账单。
    """
    bill_to_defer = db.session.get(CustomerBill, bill_id)

    if not bill_to_defer:
        return jsonify({"error": "未找到指定的账单"}), 404

    if bill_to_defer.is_paid:
        return jsonify({"error": "账单已支付，无法顺延"}), 400

    if bill_to_defer.is_deferred:
        return jsonify({"error": "账单已被顺延，请勿重复操作"}), 400

    # 查找该合同的下一个账单
    # 核心逻辑：下一个账单的开始日期必须在当前账单的结束日期之后
    next_bill = CustomerBill.query.filter(
        CustomerBill.contract_id == bill_to_defer.contract_id,
        CustomerBill.cycle_start_date > bill_to_defer.cycle_start_date,
        CustomerBill.is_substitute_bill == False
    ).order_by(CustomerBill.cycle_start_date.asc()).first()

    if not next_bill:
        return jsonify({"error": "未找到该合同的下一个有效账单，无法顺延"}), 404

    try:
        # 1. 标记当前账单为已顺延
        bill_to_defer.is_deferred = True

        # 2. 在下一个账单中创建代表“顺延费用”的调整项
        deferred_adjustment = FinancialAdjustment(
            customer_bill_id=next_bill.id,
            adjustment_type=AdjustmentType.DEFERRED_FEE,
            amount=bill_to_defer.total_payable,
            description=f"[系统] 上期账单({bill_to_defer.year}-{str(bill_to_defer.month).zfill(2)})顺延金额",
            date=next_bill.cycle_start_date,
        )
        db.session.add(deferred_adjustment)

        # 3. 立即重新计算下一个账单的总额，以包含这笔顺延费用
        engine = BillingEngine()
        engine.calculate_for_month(
            year=next_bill.year,
            month=next_bill.month,
            contract_id=next_bill.contract_id,
            force_recalculate=True,
            cycle_start_date_override=next_bill.cycle_start_date # 使用周期开始日精确指定重算目标
        )

        # --- 在这里新增日志记录 ---
        action_text = f"将客户应付款顺延到下期 {next_bill.year}-{str(next_bill.month).zfill(2)} 账单中"
        details_payload = {"next_bill_id": str(next_bill.id)}
        _log_activity(bill_to_defer, None, action=action_text, details=details_payload)
        # --- 新增结束 ---

        db.session.commit()
        return jsonify({"message": f"账单 {bill_id} 已成功顺延至账单 {next_bill.id}"}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"顺延账单 {bill_id} 时发生错误: {e}", exc_info=True)
        return jsonify({"error": "处理顺延操作时发生内部错误"}), 500
    
@billing_bp.route("/batch-settle", methods=["POST"])
@admin_required
def batch_settle():
    """
    批量更新多张账单的结算状态。
    """
    data = request.get_json()
    updates = data.get("updates")

    if not isinstance(updates, list):
        return jsonify({"error": "请求体必须包含一个 'updates' 数组。"}), 400

    try:
        # 使用事务确保操作的原子性
        with db.session.begin_nested():
            for update_data in updates:
                bill_id = update_data.get("bill_id")
                if not bill_id:
                    continue

                bill = db.session.get(CustomerBill, bill_id)
                if not bill:
                    current_app.logger.warning(f"[BatchSettle] 未找到账单ID {bill_id}，已跳过。")
                    continue

                payroll = EmployeePayroll.query.filter_by(
                    contract_id=bill.contract_id,
                    cycle_start_date=bill.cycle_start_date,
                    is_substitute_payroll=bill.is_substitute_bill,
                ).first()

                if not payroll:
                    current_app.logger.warning(f"[BatchSettle] 未找到账单 {bill_id} 对应的薪酬单，已跳过。")
                    continue

                # 1. 更新客户账单 (CustomerBill)
                customer_is_paid = update_data.get("customer_is_paid")
                if customer_is_paid is not None and bill.is_paid != customer_is_paid:
                    bill.is_paid = customer_is_paid
                    _log_activity(bill, None, f"批量结算-客户打款状态变更为: {'已打款' if customer_is_paid else '未打款'}")

                if bill.payment_details is None:
                    bill.payment_details = {}

                customer_payment_date_str = update_data.get("customer_payment_date")
                customer_payment_channel = update_data.get("customer_payment_channel")

                # 更新JSON字段中的值
                bill.payment_details['payment_date'] = customer_payment_date_str
                bill.payment_details['payment_channel'] = customer_payment_channel
                # 标记JSON字段为已修改，以便SQLAlchemy能检测到变化
                attributes.flag_modified(bill, "payment_details")

                # 2. 更新员工薪酬单 (EmployeePayroll)
                employee_is_paid = update_data.get("employee_is_paid")
                if employee_is_paid is not None and payroll.is_paid != employee_is_paid:
                    payroll.is_paid = employee_is_paid
                    _log_activity(None, payroll, f"批量结算-员工领款状态变更为: {'已领款' if employee_is_paid else '未领款'}")

                if payroll.payout_details is None:
                    payroll.payout_details = {}

                employee_payout_date_str = update_data.get("employee_payout_date")
                employee_payout_channel = update_data.get("employee_payout_channel")

                payroll.payout_details['date'] = employee_payout_date_str
                payroll.payout_details['channel'] = employee_payout_channel
                attributes.flag_modified(payroll, "payout_details")

        # 提交整个事务
        db.session.commit()
        return jsonify({"message": "批量结算成功！"})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"批量结算失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

@billing_bp.route("/dashboard/summary", methods=['GET'])
@admin_required
def get_dashboard_summary():
    """
    获取运营仪表盘所需的所有核心数据。
    """
    try:
        today = date.today()
        current_year = today.year

        # --- 1. 计算核心KPI指标 (逻辑保持不变) ---
        monthly_fees = db.session.query(
            func.sum(CustomerBill.calculation_details['management_fee'].as_float()),
            func.sum(case((CustomerBill.is_paid == True, CustomerBill.calculation_details['management_fee'].as_float()), else_=0))
        ).filter(
            CustomerBill.year == current_year,
            CustomerBill.is_substitute_bill == False
        ).first()
        monthly_management_fee_total = D(monthly_fees[0] or 0)
        monthly_management_fee_received = D(monthly_fees[1] or 0)

        active_contracts_count = db.session.query(func.count(BaseContract.id)).filter(BaseContract.status.in_(['active','trial_active'])).scalar()

        active_personnel_count = db.session.query(func.count(distinct(BaseContract.service_personnel_id))).filter(BaseContract.status.in_(['active', 'trial_active']), BaseContract.service_personnel_id.isnot(None)).scalar()
        active_user_count = db.session.query(func.count(distinct(BaseContract.user_id))).filter(BaseContract.status.in_(['active','trial_active']), BaseContract.user_id.isnot(None)).scalar()
        active_employees_count = active_personnel_count + active_user_count

        # --- 2. 月度收入趋势 (12个月) ---
        revenue_trend_data = []
        for i in range(11, -1, -1):
            target_date = today - relativedelta(months=i)
            target_year = target_date.year
            target_month = target_date.month
            monthly_revenue = db.session.query(
                func.sum(CustomerBill.calculation_details['management_fee'].as_float())
            ).filter(
                CustomerBill.year == target_year,
                CustomerBill.month == target_month,
            ).scalar() or 0
            revenue_trend_data.append({
                "month": target_date.strftime("%Y-%m"),
                "revenue": D(monthly_revenue).quantize(D('0.01'))
            })

        # --- 3. 待办事项列表 (修改) ---

        # 3.1 即将到期合同 (< 30天)
        thirty_days_later = today + timedelta(days=30)
        expiring_contracts_query = BaseContract.query.filter(
            BaseContract.end_date.between(today, thirty_days_later),
            BaseContract.status == 'active'
        ).order_by(BaseContract.end_date.asc()).limit(5).all()
        expiring_contracts = [{
            "customer_name": c.customer_name,
            "employee_name": c.user.username if c.user else c.service_personnel.name,
            "contract_type": get_contract_type_details(c.type),
            "end_date": c.end_date.isoformat(),
            "expires_in_days": (c.end_date - today).days
        } for c in expiring_contracts_query]

        # 3.2 本月待收管理费
        pending_payments_query = CustomerBill.query.filter(
            CustomerBill.year == today.year,
            CustomerBill.month == today.month,
            CustomerBill.is_paid == False,
            CustomerBill.is_substitute_bill == False,
            CustomerBill.calculation_details['management_fee'].as_float() > 0
        ).order_by(CustomerBill.id.desc()).limit(5).all()
        pending_payments = [{
            "customer_name": bill.customer_name,
            "contract_type": get_contract_type_details(bill.contract.type),
            "amount": str(D(bill.calculation_details.get('management_fee', 0)).quantize(D('0.01')))
        } for bill in pending_payments_query]

        # 3.3 新增：临近预产期 (< 14天)
        two_weeks_later = today + timedelta(days=14)
        approaching_provisional_query = MaternityNurseContract.query.filter(
            MaternityNurseContract.provisional_start_date.between(today, two_weeks_later),
            MaternityNurseContract.status == 'active' # 可以根据需要调整状态过滤
        ).order_by(MaternityNurseContract.provisional_start_date.asc()).limit(5).all()

        approaching_provisional = [{
            "customer_name": c.customer_name,
            "provisional_start_date": c.provisional_start_date.isoformat(),
            "days_until": (c.provisional_start_date - today).days
        } for c in approaching_provisional_query]


        # --- 4. 管理费按合同类型分布 (饼图数据) ---
        def get_fee_distribution(time_filter):
            query = db.session.query(
                BaseContract.type,
                func.sum(CustomerBill.calculation_details['management_fee'].as_float())
            ).join(
                BaseContract, CustomerBill.contract_id == BaseContract.id
            ).filter(
                CustomerBill.calculation_details['management_fee'].as_float() > 0
            ).filter(
                time_filter
            ).group_by(BaseContract.type)
            results = query.all()
            labels = [get_contract_type_details(r[0]) for r in results]
            series = [float(r[1]) for r in results]
            return {"labels": labels, "series": series}

        this_year_filter = (CustomerBill.year == current_year)
        distribution_this_year = get_fee_distribution(this_year_filter)

        twelve_months_ago = today - relativedelta(months=12)
        last_12_months_filter = (
            func.make_date(CustomerBill.year, CustomerBill.month, 1) >= func.make_date(twelve_months_ago.year,twelve_months_ago.month, 1)
        )
        distribution_last_12_months = get_fee_distribution(last_12_months_filter)


        # --- 5. 组装最终结果 ---
        dashboard_data = {
            "kpis": {
                "monthly_management_fee_total": str(monthly_management_fee_total),
                "monthly_management_fee_received": str(monthly_management_fee_received),
                "active_contracts_count": active_contracts_count,
                "active_employees_count": active_employees_count,
            },
            "revenue_trend": {
                "series": [{"name": "管理费收入", "data": [item['revenue'] for item in revenue_trend_data]}],
                "categories": [item['month'] for item in revenue_trend_data]
            },
            "todo_lists": {
                "expiring_contracts": expiring_contracts,
                "pending_payments": pending_payments,
                "approaching_provisional": approaching_provisional # <-- 新增字段
            },
            "management_fee_distribution": {
                "this_year": distribution_this_year,
                "last_12_months": distribution_last_12_months
            }
        }

        return jsonify(dashboard_data)

    except Exception as e:
        current_app.logger.error(f"获取仪表盘数据失败: {e}", exc_info=True)
        return jsonify({"error": "获取仪表盘数据时发生服务器内部错误"}), 500

@billing_bp.route("/export-management-fees", methods=['GET'])
@admin_required
def export_management_fees_csv():
    """
    根据筛选条件导出管理费明细的CSV文件。
    """
    try:
        # 1. 获取与 get_bills 相同的筛选参数
        billing_month_str = request.args.get("billing_month")
        if not billing_month_str:
            return jsonify({"error": "必须提供账单月份 (billing_month) 参数"}), 400

        billing_year, billing_month = map(int, billing_month_str.split("-"))
        search_term = request.args.get("search", "").strip()
        contract_type = request.args.get("type", "")
        status = request.args.get("status", "")
        payment_status = request.args.get("payment_status", "")
        payout_status = request.args.get("payout_status", "")

        # 2. 构建与 get_bills 完全相同的查询逻辑
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
        # 应用所有筛选条件...
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
        if payment_status == "paid":
            query = query.filter(CustomerBill.is_paid)
        elif payment_status == "unpaid":
            query = query.filter(~CustomerBill.is_paid)

        # 3. 获取所有匹配的账单，不分页
        all_bills = query.all()

        # 4. 生成CSV文件内容
        output = io.StringIO()
        writer = csv.writer(output)

        # 写入表头
        writer.writerow(["客户姓名", "服务人员", "合同类型", "账单周期", "管理费金额", "支付状态"])

        # 写入数据行
        for bill, contract in all_bills:
            employee = contract.user or contract.service_personnel
            writer.writerow([
                bill.customer_name,
                employee.username if hasattr(employee, 'username') else employee.name,
                get_contract_type_details(contract.type),
                f"{bill.cycle_start_date.isoformat()} ~ {bill.cycle_end_date.isoformat()}",
                bill.calculation_details.get('management_fee', '0'),
                "已支付" if bill.is_paid else "未支付"
            ])

        output.seek(0)

        # 5. 返回CSV文件
        from flask import Response
        return Response(
            output,
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment;filename=management_fees_{billing_year}-{billing_month}.csv"}
        )

    except Exception as e:
        current_app.logger.error(f"导出管理费明细失败: {e}", exc_info=True)
        return jsonify({"error": "导出失败"}), 500
    
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
        "total_payable": str(bill.total_payable or 0),
        "management_fee": str(management_fee or 0)
    }