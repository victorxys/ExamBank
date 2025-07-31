# backend/api/billing_api.py (添加考勤录入API)

from flask import Blueprint, jsonify, current_app, request
from flask_jwt_extended import jwt_required
from sqlalchemy import or_, case, and_
from sqlalchemy.orm import with_polymorphic, attributes
from flask_jwt_extended import get_jwt_identity
from dateutil.parser import parse as date_parse



from datetime import date, timedelta
from datetime import datetime
import decimal
from dateutil.relativedelta import relativedelta


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
            "customer_base_fee",
            "customer_overtime_fee",
            "management_fee",
            "management_fee_rate",
            "substitute_deduction",
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

    return {
        "customer_bill_details": customer_details,
        "employee_payroll_details": employee_details,
        "adjustments": [adj.to_dict() for adj in adjustments],
        "attendance": {
            "overtime_days": overtime_days
        },
        "invoice_details": {
            "number": (customer_bill.payment_details or {}).get("invoice_number", ""),
            "amount": (customer_bill.payment_details or {}).get("invoice_amount", ""),
            "date": (customer_bill.payment_details or {}).get("invoice_date", None),
        },
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
    employee_groups = [{"name": "薪酬明细", "fields": {}}]

    if is_maternity:
        customer_groups[2]["fields"] = {
            "基础劳务费": "待计算",
            "加班费": "待计算",
            "管理费": "待计算",
            "被替班费用": "0.00",
            "优惠": str(getattr(contract, "discount_amount", 0)),
        }
        employee_groups[0]["fields"] = {
            "萌嫂保证金(工资)": "待计算",
            "加班费": "待计算",
            "被替班费用": "0.00",
            "5%奖励": "待计算",
        }
    elif is_nanny:
        customer_groups[2]["fields"] = {
            "基础劳务费": "待计算",
            "加班费": "待计算",
            "本次交管理费": "待计算",
            "被替班费用": "0.00",
        }
        employee_groups[0]["fields"] = {
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

    # 创建一个空的 status_dict，我们将在这里构建前端需要的所有数据
    status_dict = {}

    if is_customer:
        # --- 处理客户账单 ---
        # 1. 添加前端 state 需要的原始数据，并使用前端期望的键名
        status_dict['customer_is_paid'] = is_paid
        status_dict['customer_payment_date'] = payment.get('payment_date')
        status_dict['customer_payment_channel'] = payment.get('payment_channel')
        status_dict['invoice_needed'] = payment.get('invoice_needed', False)
        status_dict['invoice_issued'] = payment.get('invoice_issued', False)

        # 2. 添加前端 UI 直接显示的格式化文本
        status_dict['是否打款'] = '是' if is_paid else '否'
        status_dict['打款时间及渠道'] = f"{payment.get('payment_date', '') or '—'} / {payment.get('payment_channel', '') or '—'}"if is_paid else "—"
        status_dict['发票记录'] = '无需开票' if not status_dict['invoice_needed'] else ('已开票' if status_dict['invoice_issued']else '待开票')
    else:
        # --- 处理员工薪酬 ---
        # 1. 添加前端 state 需要的原始数据，并使用前端期望的键名
        status_dict['employee_is_paid'] = is_paid
        status_dict['employee_payout_date'] = payment.get('date')
        status_dict['employee_payout_channel'] = payment.get('channel')

        # 2. 添加前端 UI 直接显示的格式化文本
        status_dict['是否领款'] = '是' if is_paid else '否'
        status_dict['领款时间及渠道'] = f"{payment.get('date', '') or '—'} / {payment.get('channel', '') or '—'}" if is_paid else"—"

    # 将这个包含了所有正确键名和数据的字典，赋值给 payment_status
    details['payment_status'] = status_dict


def _fill_group_fields(group_fields, calc, field_keys, is_substitute_payroll=False):
    for key in field_keys:
        if key in calc:
            # 映射数据库字段名到前端显示标签
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
                # 'employee_base_payout': '基础劳务费' if is_substitute_payroll else ('基础劳务费' if 'nanny' in calc.get('type','') else '萌嫂保证金(工资)'),
                "employee_base_payout": "基础劳务费"
                if "nanny" in calc.get("type", "")
                else "萌嫂保证金(工资)",
                "employee_overtime_payout": "加班费",
                "first_month_deduction": "首月员工10%费用",
            }
            label = label_map.get(key, key)  # 使用映射，如果找不到则用原key
            group_fields[label] = calc[key]


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

        # 核心修正: 显式查询多态合同以加载完整信息
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

        # 应用月份筛选
        query = query.filter(
            CustomerBill.year == billing_year, CustomerBill.month == billing_month
        )

        # 应用其他筛选条件
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

        # 应用支付状态筛选
        if payment_status == "paid":
            query = query.filter(CustomerBill.is_paid)
        elif payment_status == "unpaid":
            query = query.filter(~CustomerBill.is_paid)

        # 应用领款状态筛选 (需要join EmployeePayroll)
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

        # 排序
        query = query.order_by(
            contract_poly.customer_name, CustomerBill.cycle_start_date
        )

        paginated_results = query.paginate(
            page=page, per_page=per_page, error_out=False
        )

        results = []
        current_app.logger.info(
            f"[DEBUG] Found {paginated_results.total} bills for the current query."
        )  # DEBUG LOG
        for i, (bill, contract) in enumerate(paginated_results.items):
            current_app.logger.info(
                f"[DEBUG] Processing item {i+1}/{paginated_results.total}: Bill ID {bill.id}, Contract ID {contract.id}"
            )  # DEBUG LOG
            current_app.logger.info(
                f"[DEBUG]   - Contract Type from DB: {contract.type}"
            )  # DEBUG LOG
            current_app.logger.info(
                f"[DEBUG]   - Is Substitute Bill: {bill.is_substitute_bill}"
            )  # DEBUG LOG
            current_app.logger.info(
                f"[DEBUG]   - Contract raw object: {contract.__dict__}"
            )  # DEBUG LOG

            payroll = EmployeePayroll.query.filter_by(
                contract_id=bill.contract_id, cycle_start_date=bill.cycle_start_date
            ).first()

            # 1. 从关联合同中获取基础信息
            item = {
                "id": str(bill.id),
                "contract_id": str(contract.id),
                "customer_name": contract.customer_name,
                "status": contract.status,
                "customer_payable": str(bill.total_payable) if bill else "待计算",
                "customer_is_paid": bill.is_paid,
                "employee_payout": str(payroll.final_payout) if payroll else "待计算",
                "employee_is_paid": payroll.is_paid if payroll else False,
                "is_substitute_bill": bill.is_substitute_bill,
                "contract_type_label": get_contract_type_details(contract.type),
                "contract_type_value": contract.type,  # <-- 新增这一行
                "employee_level": str(contract.employee_level or "0"),
                "active_cycle_start": bill.cycle_start_date.isoformat()
                if bill.cycle_start_date
                else None,
                "active_cycle_end": bill.cycle_end_date.isoformat()
                if bill.cycle_end_date
                else None,
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

            # 2. 如果是替班账单，则覆盖特定信息
            if bill.is_substitute_bill:
                # 在合同类型后加上"(替)"标识
                item["contract_type_label"] = (
                    f"{item.get('contract_type_label', '未知类型')} (替)"
                )

                sub_record = bill.source_substitute_record
                if sub_record:
                    # 员工姓名应为替班员工
                    sub_employee = (
                        sub_record.substitute_user or sub_record.substitute_personnel
                    )
                    item["employee_name"] = getattr(
                        sub_employee,
                        "username",
                        getattr(sub_employee, "name", "未知替班员工"),
                    )
                    # 级别/薪资应为替班员工的薪资
                    item["employee_level"] = str(sub_record.substitute_salary or "0")
                    # 劳务时间段应为替班的起止日期
                    item["active_cycle_start"] = sub_record.start_date.isoformat()
                    item["active_cycle_end"] = sub_record.end_date.isoformat()
                else:
                    # 如果找不到替班记录，提供明确的提示
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
        details = _get_billing_details_internal(bill_id=bill_id)
        if details is None:
            return jsonify({"error": "获取账单详情失败"}), 404

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

        # 查找关联的薪酬单
        payroll = None
        if bill.is_substitute_bill:
            # 对于替班账单，通过 source_substitute_record_id 找到 payroll
            if bill.source_substitute_record_id:
                payroll = EmployeePayroll.query.filter_by(
                    source_substitute_record_id=bill.source_substitute_record_id
                ).first()
        else:
            # 对于主账单，通过 contract_id 和 cycle_start_date 查找
            payroll = EmployeePayroll.query.filter_by(
                contract_id=bill.contract_id,
                cycle_start_date=bill.cycle_start_date,
                is_substitute_payroll=False,
            ).first()

        if not payroll:
            return jsonify({"error": f"未找到与账单ID {bill_id} 关联的薪酬单"}), 404


        old_settlement = {
            'customer_is_paid': bill.is_paid,
            'employee_is_paid': payroll.is_paid,
            'customer_payment_date': (bill.payment_details or {}).get('payment_date', None),
            'employee_payout_date': (payroll.payout_details or {}).get('date', None),
            'customer_payment_channel': (bill.payment_details or {}).get('payment_channel', None),
            'employee_payout_channel': (payroll.payout_details or {}).get('channel', None),
            'invoice_number': (bill.payment_details or {}).get('invoice_number', None),
            'invoice_amount': (bill.payment_details or {}).get('invoice_amount', None),
            'invoice_date': (bill.payment_details or {}).get('invoice_date', None),
            'invoice_needed': (bill.payment_details or {}).get('invoice_needed', False),
            'invoice_issued': (bill.payment_details or {}).get('invoice_issued', False)
        }

        overtime_days = data.get("overtime_days", 0)

        # 根据账单类型更新正确的加班记录
        if bill.is_substitute_bill:
            sub_record = (
                db.session.query(SubstituteRecord)
                .filter_by(generated_bill_id=bill.id)
                .first()
            )
            if sub_record:
                old_overtime = sub_record.overtime_days or 0
                if old_overtime != overtime_days:
                    sub_record.overtime_days = overtime_days
                    _log_activity(
                        bill,
                        payroll,
                        "修改替班加班天数",
                        {"from": old_overtime, "to": overtime_days},
                    )
        else:
             # --- 核心修正：同时处理主合同的考勤记录 ---
            attendance_record = AttendanceRecord.query.filter_by(
                contract_id=bill.contract_id, cycle_start_date=bill.cycle_start_date
            ).first()

            # --- 关键修正：不再假设基础工作日，而是从账单的计算详情中动态获取 ---
            base_work_days_str = (bill.calculation_details or {}).get('base_work_days')
            if not base_work_days_str:
                # 这是一个保护措施，正常情况下已计算的账单必定有此字段
                return jsonify({"error": "无法确定基础劳务天数，因为账单从未被成功计算过或计算详情已损坏。"}), 500

            base_work_days = int(D(base_work_days_str))
            new_total_days_worked = base_work_days + overtime_days
            # --- 结束关键修正 ---

            if attendance_record:
                old_overtime = attendance_record.overtime_days
                if old_overtime != overtime_days:
                    # 更新现有记录
                    attendance_record.overtime_days = overtime_days
                    attendance_record.total_days_worked = new_total_days_worked # <-- 使用动态计算的总天数
                    _log_activity(
                        bill,
                        payroll,
                        "修改加班天数",
                        {"from": old_overtime, "to": overtime_days},
                    )
            else:
                # 创建新记录
                employee_id = (
                    bill.contract.user_id or bill.contract.service_personnel_id
                )
                attendance_record = AttendanceRecord(
                    employee_id=employee_id,
                    contract_id=bill.contract_id,
                    cycle_start_date=bill.cycle_start_date,
                    cycle_end_date=bill.cycle_end_date,
                    overtime_days=overtime_days,
                    total_days_worked=new_total_days_worked, # <-- 使用动态计算的总天数
                )
                db.session.add(attendance_record)
                _log_activity(
                    bill, payroll, "新增考勤并设置加班天数", {"to": overtime_days}
                )

        # --- 处理财务调整项 (带有正确日志记录和数据库操作的最终逻辑) ---
        adjustments_data = data.get('adjustments', [])

        # 1. 定义一个从枚举到中文标签的映射，用于生成可读日志
        ADJUSTMENT_TYPE_LABELS = {
            AdjustmentType.CUSTOMER_INCREASE: "客户增款",
            AdjustmentType.CUSTOMER_DECREASE: "退客户款",
            AdjustmentType.CUSTOMER_DISCOUNT: "优惠",
            AdjustmentType.EMPLOYEE_INCREASE: "员工增款",
            AdjustmentType.EMPLOYEE_DECREASE: "员工减款",
        }

        # 2. 获取旧的财务调整项，用于比较
        old_adjustments_query = FinancialAdjustment.query.filter(
            or_(
                FinancialAdjustment.customer_bill_id == bill.id,
                FinancialAdjustment.employee_payroll_id == payroll.id
            )
        ).all()
        old_adjustments_map = {str(adj.id): adj for adj in old_adjustments_query}

        # 3. 处理删除项
        new_adjustments_ids = {str(adj.get('id')) for adj in adjustments_data if adj.get('id')}
        for old_id, old_adj in old_adjustments_map.items():
            if old_id not in new_adjustments_ids:
                # 获取中文标签
                action_label = ADJUSTMENT_TYPE_LABELS.get(old_adj.adjustment_type, old_adj.adjustment_type.name)
                # 记录日志
                _log_activity(
                    bill if 'CUSTOMER' in old_adj.adjustment_type.name else None,
                    payroll if 'EMPLOYEE' in old_adj.adjustment_type.name else None,
                    action=f"删除了财务调整: {action_label} ({old_adj.description})",
                    details={"amount": str(old_adj.amount), "type": old_adj.adjustment_type.value}
                )
                # 从数据库中删除
                db.session.delete(old_adj)

        # 4. 处理新增和修改项
        for adj_data in adjustments_data:
            # **核心修正**: 通过值来查找枚举成员，不再使用 .upper()
            adj_type = AdjustmentType(adj_data["adjustment_type"])
            adj_amount = D(adj_data["amount"])
            adj_description = adj_data["description"]
            action_label = ADJUSTMENT_TYPE_LABELS.get(adj_type, adj_type.name)
            adj_id = str(adj_data.get('id', ''))

            if adj_id and adj_id in old_adjustments_map:
                # 这是修改
                existing_adj = old_adjustments_map[adj_id]
                if existing_adj.amount != adj_amount or existing_adj.description != adj_description or existing_adj.adjustment_type!= adj_type:
                    _log_activity(
                        bill if 'CUSTOMER' in adj_type.name else None,
                        payroll if 'EMPLOYEE' in adj_type.name else None,
                        action=f"修改了财务调整: {action_label}",
                        details={
                            "from_amount": str(existing_adj.amount), "to_amount": str(adj_amount),
                            "from_desc": existing_adj.description, "to_desc": adj_description,
                            "from_type": existing_adj.adjustment_type.value, "to_type": adj_type.value
                        }
                    )
                    existing_adj.amount = adj_amount
                    existing_adj.description = adj_description
                    existing_adj.adjustment_type = adj_type

            elif 'temp' in adj_id or not adj_id:
                # 这是新增
                _log_activity(
                    bill if 'CUSTOMER' in adj_type.name else None,
                    payroll if 'EMPLOYEE' in adj_type.name else None,
                    action=f"新增了财务调整: {action_label} ({adj_description})",
                    details={"amount": str(adj_amount), "type": adj_type.value}
                )
                new_adj = FinancialAdjustment(
                    adjustment_type=adj_type, amount=adj_amount,
                    description=adj_description, date=bill.cycle_start_date,
                )
                if adj_type.name.startswith("CUSTOMER"):
                    new_adj.customer_bill_id = bill.id
                else:
                    new_adj.employee_payroll_id = payroll.id
                db.session.add(new_adj)

        # --- 触发账单重算 ---
        engine = BillingEngine()
        if bill.is_substitute_bill:
            engine.calculate_for_substitute(bill.source_substitute_record_id)
        else:
            engine.calculate_for_month(
                year=bill.year,
                month=bill.month,
                contract_id=bill.contract_id,
                force_recalculate=True,
            )

        # --- 更新结算和发票状态 ---
        # settlement_status = data.get("settlement_status", {})
        # (此处省略了更新 bill.is_paid, payroll.is_paid, payment_details 等的详细代码，因为它们不影响核心逻辑)
                # --- 5. 在重算之后，再更新结算和发票状态 (核心修正：顺序调整) ---
        settlement_status = data.get('settlement_status', {})
        invoice_details_from_frontend = settlement_status.get('invoice_details', {})
        current_app.logger.info(f"[BATCH-UPDATE-5-0] 准备更新结算状态: {settlement_status}")
        current_app.logger.info(f"[BATCH-UPDATE-5] 准备更新结算状态: {settlement_status}")
        current_app.logger.info(f"[BATCH-UPDATE-6] 准备更新发票详情: {invoice_details_from_frontend}")

        # 客户打款状态日志记录

        new_customer_paid = settlement_status.get('customer_is_paid', False)
        new_payment_date_str = settlement_status.get('customer_payment_date')
        new_payment_date = new_payment_date_str.split('T')[0] if new_payment_date_str else None
        new_payment_channel = settlement_status.get('customer_payment_channel', '')

        has_payment_change = False
        log_details = {}

        # 1. 比较打款状态的变化
        if old_settlement['customer_is_paid'] != new_customer_paid:
            has_payment_change = True
            log_details['是否打款'] = {"from": "未打款", "to": "已打款"} if new_customer_paid else {"from": "已打款", "to":"未打款"}

        # 2. 比较打款日期的变化
        if old_settlement['customer_payment_date'] != new_payment_date and (old_settlement['customer_payment_date'] or new_payment_date):
            has_payment_change = True
            log_details['打款日期'] = {"from": old_settlement['customer_payment_date'], "to": new_payment_date}

        # 3. 比较打款渠道的变化
        if old_settlement['customer_payment_channel'] != new_payment_channel and (old_settlement['customer_payment_channel'] or new_payment_channel):
            has_payment_change = True
            log_details['打款渠道'] = {"from": old_settlement['customer_payment_channel'], "to": new_payment_channel}

        # 4. 如果有任何变化，则记录一条聚合日志
        if has_payment_change:
            # 动态生成 action 文本
            action_text = "更新了客户打款状态"
            if '是否打款' in log_details:
                action_text = "标记客户为【已打款】" if new_customer_paid else "将客户标记为【未打款】"

            _log_activity(bill, None, action_text, log_details)

        # 为了安全，重新从会话中获取最新的 bill 和 payroll 对象
        # 虽然在同一个事务中可能不是必须的，但这是最保险的做法
        final_bill = db.session.get(CustomerBill, bill.id)
        final_payroll = db.session.get(EmployeePayroll, payroll.id)




        # 发票状态日志记录
        invoice_details_from_frontend = settlement_status.get('invoice_details', {})
        new_invoice_needed = settlement_status.get('invoice_needed', False)
        new_invoice_issued = settlement_status.get('invoice_issued', False)
        new_invoice_number = invoice_details_from_frontend.get('number', '')
        new_invoice_amount = invoice_details_from_frontend.get('amount', '')
        new_invoice_date = invoice_details_from_frontend.get('date')

        has_invoice_change = False
        invoice_log_details = {}

        if old_settlement['invoice_needed'] != new_invoice_needed:
            has_invoice_change = True
            invoice_log_details['需求状态'] = {"from": "不需要" if not old_settlement['invoice_needed'] else "需要", "to": "需要"if new_invoice_needed else "不需要"}

        if old_settlement['invoice_issued'] != new_invoice_issued:
            has_invoice_change = True
            invoice_log_details['开具状态'] = {"from": "未开" if not old_settlement['invoice_issued'] else "已开", "to": "已开" if new_invoice_issued else "未开"}

        if old_settlement['invoice_number'] != new_invoice_number and (old_settlement['invoice_number'] or new_invoice_number):
            has_invoice_change = True
            invoice_log_details['发票号'] = {"from": old_settlement['invoice_number'], "to": new_invoice_number}

        if old_settlement['invoice_amount'] != new_invoice_amount and (old_settlement['invoice_amount'] or new_invoice_amount):
            has_invoice_change = True
            invoice_log_details['金额'] = {"from": old_settlement['invoice_amount'], "to": new_invoice_amount}

        # --- 核心修正：在比较日期前，先进行格式化 ---
        def format_date_for_comparison(date_input):
            if not date_input:
                return None
            # 如果是带时间的字符串，只取日期部分
            if isinstance(date_input, str) and 'T' in date_input:
                return date_input.split('T')[0]
            # 如果已经是 Date 对象，转换为 ISO 格式字符串
            if hasattr(date_input, 'isoformat'):
                return date_input.isoformat()
            return str(date_input)
         # --- 使用格式化函数来比较发票日期 ---
        invoice_details_from_frontend = settlement_status.get('invoice_details', {})
        old_invoice_date = format_date_for_comparison(old_settlement['invoice_date'] )
        new_invoice_date = format_date_for_comparison(invoice_details_from_frontend.get('date'))

        if old_invoice_date != new_invoice_date:
            # 只有在格式化后的纯日期字符串不相等时，才记录日志
            has_invoice_change = True
            invoice_log_details['日期'] = {"from": old_invoice_date, "to": new_invoice_date}

        # if old_settlement['invoice_date'] != new_invoice_date and (old_settlement['invoice_date'] or new_invoice_date):
        #     has_invoice_change = True
        #     invoice_log_details['日期'] = {"from": old_settlement['invoice_date'], "to": new_invoice_date}

        if has_invoice_change:
            _log_activity(final_bill, None, "更新了发票信息", invoice_log_details)




        final_bill.is_paid = settlement_status.get('customer_is_paid', False)
        payment_date_str = settlement_status.get('customer_payment_date')

        # **核心修正**: 将所有状态存入 payment_details
        if final_bill.payment_details is None:
            final_bill.payment_details = {}

        # final_bill.payment_details['payment_date'] = payment_date_str.split('T')[0] if payment_date_str else None
        # final_bill.payment_details['payment_channel'] = settlement_status.get('customer_payment_channel')

        # final_bill.payment_details['payment_date'] = bill.payment_details['payment_date'] if bill.payment_details['payment_date'] else None
        final_bill.payment_details['payment_date'] = payment_date_str.split('T')[0] if payment_date_str else None
        final_bill.payment_details['payment_channel'] = settlement_status.get('customer_payment_channel')


        final_bill.payment_details['invoice_needed'] = new_invoice_needed
        final_bill.payment_details['invoice_issued'] = new_invoice_issued
        final_bill.payment_details['invoice_number'] = invoice_details_from_frontend.get('number')
        final_bill.payment_details['invoice_amount'] = invoice_details_from_frontend.get('amount')
        final_bill.payment_details['invoice_date'] = invoice_details_from_frontend.get('date')


        attributes.flag_modified(final_bill, "payment_details")
        current_app.logger.info(f"[BATCH-UPDATE-7] 更新后的结算详情: {final_bill.payment_details}")



        # 员工领款状态及日志
        # **核心修正**: 聚合员工领款相关的日志记录
        new_employee_paid = settlement_status.get('employee_is_paid', False)
        new_payout_date_str = settlement_status.get('employee_payout_date')
        new_payout_date = new_payout_date_str.split('T')[0] if new_payout_date_str else None
        new_payout_channel = settlement_status.get('employee_payout_channel', '')

        has_payout_change = False
        payout_log_details = {}

        if old_settlement['employee_is_paid'] != new_employee_paid:
            has_payout_change = True
            payout_log_details['员工是否领款'] = {"from": "未领款", "to": "已领款"} if new_employee_paid else {"from": "已领款","to": "未领款"}
        if old_settlement['employee_payout_date'] != new_payout_date and (old_settlement['employee_payout_date'] or new_payout_date):
            has_payout_change = True
            payout_log_details['员工领款日期'] = {"from": old_settlement['employee_payout_date'], "to": new_payout_date}
        if old_settlement['employee_payout_channel'] != new_payout_channel and (old_settlement['employee_payout_channel'] or new_payout_channel):
            has_payout_change = True
            payout_log_details['员工领款渠道'] = {"from": old_settlement['employee_payout_channel'], "to": new_payout_channel}

        if has_payout_change:
            action_text = "更新了员工领款状态"
            if '员工是否领款' in payout_log_details:
                action_text = "标记员工为【已领款】" if new_employee_paid else "将员工标记为【未领款】"
            _log_activity(None, final_payroll, action_text, payout_log_details)

        final_payroll.is_paid = new_employee_paid
        if final_payroll.payout_details is None: final_payroll.payout_details = {}
        final_payroll.payout_details['date'] = new_payout_date
        final_payroll.payout_details['channel'] = new_payout_channel
        attributes.flag_modified(final_payroll, "payout_details")



       # 如果 calculation_details 是 None, 初始化为空字典
        if final_bill.calculation_details is None:
            final_bill.calculation_details = {}

        # 确保 invoice_details 子字典存在
        if 'invoice_details' not in final_bill.calculation_details:
            final_bill.calculation_details['invoice_details'] = {}

        # 更新所有发票相关字段
        final_bill.calculation_details['invoice_details']['needed'] = settlement_status.get('invoice_needed', False)
        final_bill.calculation_details['invoice_details']['issued'] = settlement_status.get('invoice_issued', False)
        # 从前端传来的专用对象中获取详细信息
        final_bill.calculation_details['invoice_details']['number'] = invoice_details_from_frontend.get('number')
        final_bill.calculation_details['invoice_details']['amount'] = invoice_details_from_frontend.get('amount')
        final_bill.calculation_details['invoice_details']['date'] = invoice_details_from_frontend.get('date')

        attributes.flag_modified(final_bill, "calculation_details")

        db.session.commit()

        # --- 获取并返回最新详情 ---
        latest_details = _get_billing_details_internal(bill_id=bill.id)
        return jsonify(
            {"message": "所有更改已保存并成功重算！", "latest_details": latest_details}
        )

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(
            f"批量更新失败 (bill_id: {bill_id}): {e}", exc_info=True
        )
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
                    User.username.ilike(f"%{search_term}%"),
                    ServicePersonnel.name.ilike(f"%{search_term}%"),
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
    for bill in bills:
        calc = bill.calculation_details or {}
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
                "base_work_days": calc.get("base_work_days", "0"),  # 新增：基本劳务天数
                "is_substitute_bill": bill.is_substitute_bill,  # 确保这个字段存在
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
                }
            )
        elif contract.type == "nanny_trial":
            result.update(
                {
                    "introduction_fee": str(contract.introduction_fee or 0),
                }
            )

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
    contract = target_bill.contract

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
        page_number = position // per_page
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
            },
        }
    )
