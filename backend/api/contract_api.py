# backend/api/contract_api.py
from flask import Blueprint, jsonify, request, current_app, send_file, render_template,send_from_directory
import os
from flask_jwt_extended import jwt_required
from backend.models import (
    db,
    BaseContract,
    User,
    SubstituteRecord,
    CustomerBill,
    EmployeePayroll,
    FinancialActivityLog,
    PaymentStatus,
    ContractTemplate, 
    SigningStatus, # 导入 SigningStatus 枚举
    Customer, # 导入 Customer
    ServicePersonnel, # 导入 ServicePersonnel
    NannyContract,MaternityNurseContract,NannyTrialContract, ExternalSubstitutionContract,
    CompanyBankAccount,
    FinancialAdjustment,
    PaymentRecord
)
from backend.tasks import calculate_monthly_billing_task
from backend.services.billing_engine import BillingEngine, calculate_substitute_management_fee, _update_bill_payment_status
from backend.services.contract_service import (
    cancel_substitute_bill_due_to_transfer,
    apply_transfer_credits_to_new_contract,
    _find_successor_contract_internal,
    update_salary_history_on_contract_activation # 导入薪资历史服务函数
)
# from backend.api.billing_api import _get_billing_details_internal
from datetime import datetime
import decimal
from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_, extract
from sqlalchemy.orm import joinedload
D = decimal.Decimal
from backend.tasks import calculate_monthly_billing_task, trigger_initial_bill_generation_task

contract_bp = Blueprint("contract_api", __name__, url_prefix="/api/contracts")


@contract_bp.route("/<string:contract_id>/substitutes", methods=["POST"])
@jwt_required()
def create_substitute_record(contract_id):
    data = request.get_json()
    current_app.logger.debug(f"--- [API-CreateSub] START for contract: {contract_id} ---")
    current_app.logger.debug(f"[API-CreateSub] Received data: {data}")

    required_fields = [
        "substitute_user_id",
        "start_date",
        "end_date",
        "employee_level",
        "substitute_type",
    ]
    if not all(field in data and data[field] for field in required_fields):
        return jsonify({"error": "请填写所有必填项"}), 400

    try:
        start_date = datetime.fromisoformat(data["start_date"])
        end_date = datetime.fromisoformat(data["end_date"])
        employee_level = D(data["employee_level"])
        substitute_type = data["substitute_type"]
        original_bill_id = data.get("original_bill_id")
        substitute_management_fee_rate = D(data.get("substitute_management_fee_rate", 0))

        main_contract = BaseContract.query.get(contract_id)
        if not main_contract:
            return jsonify({"error": "Main contract not found"}), 404

        substitute_user = User.query.get(data["substitute_user_id"])
        if not substitute_user:
            return jsonify({"error": "Substitute user not found"}), 404

        # 1. 创建记录并立即保存费率
        new_record = SubstituteRecord(
            main_contract_id=str(contract_id),
            substitute_user_id=data["substitute_user_id"],
            start_date=start_date,
            end_date=end_date,
            substitute_salary=employee_level,
            substitute_type=substitute_type,
            original_customer_bill_id=original_bill_id,
            substitute_management_fee_rate=substitute_management_fee_rate,
        )

        # 2. 根据类型，选择性地预计算费用金额
        if substitute_type == 'nanny':
            # 育儿嫂：调用辅助函数计算仅超出合同期的管理费
            # 该函数现在将使用 new_record 上已保存的费率
            total_fee = calculate_substitute_management_fee(new_record, main_contract)
            new_record.substitute_management_fee = total_fee
        elif substitute_type == 'maternity_nurse':
            # 月嫂：不在API层面计算费用金额，其逻辑更复杂，完全由后续的BillingEngine处理
            new_record.substitute_management_fee = D(0) # 提供一个默认值

        db.session.add(new_record)
        db.session.flush() # flush以获取new_record.id

        # 3. 调用计费引擎，它将使用已保存的费率和金额进行最终的账单生成
        engine = BillingEngine()
        engine.calculate_for_substitute(new_record.id)

        # 如果影响了原始账单，也触发重算
        if original_bill_id:
            original_bill = CustomerBill.query.get(original_bill_id)
            if original_bill:
                engine.calculate_for_month(
                    original_bill.year,
                    original_bill.month,
                    original_bill.contract_id,
                    force_recalculate=True
                )

        db.session.commit()

        current_app.logger.debug(f"--- [API-CreateSub] END for contract: {contract_id} ---")
        return jsonify(
            {
                "message": "替班记录已创建，相关账单已更新。",
                "record_id": str(new_record.id),
            }
        ), 201

    except (ValueError, decimal.InvalidOperation):
        db.session.rollback()
        return jsonify({"error": "Invalid date or amount format"}), 400
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(
            f"Failed to create substitute record: {e}", exc_info=True
        )
        return jsonify({"error": "Internal server error"}), 500


@contract_bp.route("/<string:contract_id>/substitutes", methods=["GET"])
@jwt_required()
def get_substitute_records(contract_id):
    try:
        records = (
            SubstituteRecord.query.filter_by(main_contract_id=contract_id)
            .order_by(SubstituteRecord.start_date.desc())
            .all()
        )
        result = []
        for record in records:
            current_app.logger.debug(f"[API-GetSub] Retrieved record ID: {record.id}, start_date:{record.start_date}, end_date: {record.end_date}") # 添加此行
            result.append({
                "id": str(record.id),
                "substitute_user_id": str(record.substitute_user_id),
                "substitute_user_name": record.substitute_user.username
                if record.substitute_user
                else "N/A",
                "start_date": record.start_date.isoformat(),
                "end_date": record.end_date.isoformat(),
                "substitute_salary": str(record.substitute_salary),
                "substitute_management_fee": str(record.substitute_management_fee),
                "created_at": record.created_at.isoformat(),
                "original_customer_bill_id": str(record.original_customer_bill_id) if record.original_customer_bill_id else None,
                 # 【修复】在这里加上前端需要的替班账单ID
                "substitute_customer_bill_id": str(record.generated_bill_id) if record.generated_bill_id else None,
            })
        return jsonify(result)
    except Exception as e:
        current_app.logger.error(
            f"Failed to get substitute records for contract {contract_id}: {e}",
            exc_info=True,
        )
        return jsonify({"error": "Internal server error"}), 500


@contract_bp.route("/substitutes/<string:record_id>", methods=["DELETE"])
@jwt_required()
def delete_substitute_record(record_id):
    force_delete = request.args.get("force", "false").lower() == "true"

    sub_record = SubstituteRecord.query.get(record_id)
    if not sub_record:
        return jsonify({"error": "Substitute record not found"}), 404

    try:
        recalc_info = None
        if sub_record.original_customer_bill_id:
            original_bill = CustomerBill.query.get(sub_record.original_customer_bill_id)
            if original_bill:
                recalc_info = {
                    "year": original_bill.year,
                    "month": original_bill.month,
                    "contract_id": original_bill.contract_id,
                }
        current_app.logger.info(
            f"Deleting substitute record {record_id} for contract {sub_record.main_contract_id}, force delete: {force_delete}"
        )
        if force_delete:
            if sub_record.generated_bill_id:
                FinancialActivityLog.query.filter_by(
                    customer_bill_id=sub_record.generated_bill_id
                ).delete(synchronize_session=False)
            if sub_record.generated_payroll_id:
                FinancialActivityLog.query.filter_by(
                    employee_payroll_id=sub_record.generated_payroll_id
                ).delete(synchronize_session=False)

        if sub_record.generated_bill_id:
            CustomerBill.query.filter_by(id=sub_record.generated_bill_id).delete(
                synchronize_session=False
            )
        if sub_record.generated_payroll_id:
            EmployeePayroll.query.filter_by(id=sub_record.generated_payroll_id).delete(
                synchronize_session=False
            )

        db.session.delete(sub_record)
        db.session.flush()

        if recalc_info:
            engine = BillingEngine()
            engine.calculate_for_month(
                recalc_info["year"],
                recalc_info["month"],
                recalc_info["contract_id"],
                force_recalculate=True,
            )

        db.session.commit()

        return jsonify({"message": "Substitute record deleted successfully."}), 200

    except IntegrityError as e:
        db.session.rollback()
        if "financial_activity_logs" in str(e.orig):
            return jsonify(
                {
                    "error": "conflict_logs_exist",
                    "message": "Cannot delete because associated bill/payroll has activity logs. Use force=true to override.",
                }
            ), 409
        else:
            current_app.logger.error(
                f"Integrity error on delete substitute record {record_id}: {e}",
                exc_info=True,
            )
            return jsonify({"error": "Database integrity error"}), 500

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(
            f"Failed to delete substitute record {record_id}: {e}", exc_info=True
        )
        return jsonify({"error": "Internal server error"}), 500


@contract_bp.route("/<uuid:contract_id>/succeed", methods=["POST"])
@jwt_required()
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


@contract_bp.route("/search-unpaid-bills", methods=["GET"])
@jwt_required()
def search_unpaid_bills():
    """
    根据客户名或拼音，搜索指定年月下未付清的账单。
    """
    search_term = request.args.get("search", "").strip()
    year = request.args.get("year", type=int)
    month = request.args.get("month", type=int)

    if not search_term or not year or not month:
        return jsonify([])

    try:
        pinyin_search_term = search_term.replace(" ", "")
        
        query = db.session.query(CustomerBill).join(BaseContract).filter(
            or_(
                BaseContract.customer_name.ilike(f"%{search_term}%"),
                BaseContract.customer_name_pinyin.ilike(f"%{pinyin_search_term}%")
            ),
            CustomerBill.year == year,
            CustomerBill.month == month,
            CustomerBill.total_due > 0,
            or_(
                CustomerBill.payment_status == PaymentStatus.UNPAID,
                CustomerBill.payment_status == PaymentStatus.PARTIALLY_PAID
            )
        ).limit(20) # 限制返回结果，避免过多数据

        bills = query.all()

        results = [
            {
                "bill_id": str(bill.id),
                "customer_name": bill.contract.customer_name,
                "employee_name": bill.contract.service_personnel.name if bill.contract.service_personnel else (bill.contract.user.username if bill.contract.user else "未知"),
                "cycle": f"{bill.cycle_start_date.strftime('%Y-%m-%d')} to {bill.cycle_end_date.strftime('%Y-%m-%d')}",
                "amount_remaining": str(bill.total_due - bill.total_paid)
            }
            for bill in bills
        ]
        
        return jsonify(results)

    except Exception as e:
        current_app.logger.error(f"Failed to search unpaid bills: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500
    
from weasyprint import HTML
import io
from flask import render_template, send_file
import markdown

# 在 backend/api/contract_api.py 文件末尾添加

@contract_bp.route("/<string:contract_id>/download", methods=["GET"])
@jwt_required()
def download_contract_pdf(contract_id):
    """
    生成并下载合同的PDF版本。
    """
    try:
        contract = BaseContract.query.options(
            joinedload(BaseContract.customer),
            joinedload(BaseContract.service_personnel)
        ).get_or_404(contract_id)

        if contract.type == 'maternity_nurse':
            pdf_title = "月嫂服务合同"
        else:
            pdf_title = "家政服务合同"

        # 检查签名状态，理论上应该双方都签署了才提供下载
        if contract.signing_status != SigningStatus.SIGNED:
            # 暂时允许下载未完全签署的合同，以便预览
            current_app.logger.warning(f"合同 {contract_id} 正在被下载，但其签署状态为 {contract.signing_status}")

        service_content_html = markdown.markdown(contract.service_content)
        # 1. 读取并转换主模板内容
        main_content_html = markdown.markdown(contract.template_content) if contract.template_content else ''
        # 2. 读取并转换附件内容
        attachment_content_html = markdown.markdown(contract.attachment_content) if contract.attachment_content else ''

        rendered_html = render_template(
            "contract_pdf.html",
            pdf_title=pdf_title, 
            service_content=service_content_html,
            main_content=main_content_html,
            attachment_content=attachment_content_html,
            customer_signature=contract.customer_signature,
            employee_signature=contract.employee_signature,
            customer=contract.customer,
            employee=contract.service_personnel,
            contract=contract
        )

        pdf_file = HTML(string=rendered_html, base_url=request.url_root).write_pdf()

        return send_file(
            io.BytesIO(pdf_file),
            mimetype='application/pdf',
            as_attachment=True,
            download_name=f"contract_{contract.customer_name}_{contract.start_date.strftime('%Y%m%d')}.pdf"
        )

    except Exception as e:
        current_app.logger.error(f"为合同 {contract_id} 生成PDF失败: {e}", exc_info=True)
        return jsonify({"error": "生成PDF失败"}), 500


@contract_bp.route("", methods=["GET"])
@jwt_required()
def search_contracts():
    """
    搜索或列出合同。
    如果提供 'search' 参数，则按客户姓名或拼音进行模糊搜索。
    如果不提供，则返回所有合同的分页列表。
    """
    search_term = request.args.get("search", "").strip()
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 15, type=int)
    type_filter = request.args.get("type", "").strip()
    status_filter = request.args.get("status", "all").strip()
    deposit_status_filter = request.args.get("deposit_status", "").strip()
    signing_status_filter = request.args.get("signing_status", "").strip()
    sort_by = request.args.get("sort_by", "created_at").strip()
    sort_order = request.args.get("sort_order", "desc").strip()

    try:
        query = BaseContract.query.options(joinedload(BaseContract.service_personnel))

        if search_term:
            pinyin_search_term = search_term.replace(" ", "")
            query = query.filter(
                or_(
                    BaseContract.customer_name.ilike(f"%{search_term}%"),
                    BaseContract.customer_name_pinyin.ilike(f"%{pinyin_search_term}%")
                )
            )
        
        if type_filter:
            if type_filter == 'nanny':
                query = query.filter(BaseContract.type.in_(['nanny', 'external_substitution']))
            else:
                query = query.filter(BaseContract.type == type_filter)

        if status_filter != 'all':
            query = query.filter(BaseContract.status == status_filter)
        if signing_status_filter:
            query = query.filter(BaseContract.signing_status == signing_status_filter)
        if deposit_status_filter:
            if deposit_status_filter == 'paid':
                query = query.filter(BaseContract.deposit_amount > 0, BaseContract.security_deposit_paid >= BaseContract.deposit_amount)
            elif deposit_status_filter == 'unpaid':
                query = query.filter(BaseContract.deposit_amount > 0, BaseContract.security_deposit_paid < BaseContract.deposit_amount)

        # Sorting logic
        if hasattr(BaseContract, sort_by):
            column_to_sort = getattr(BaseContract, sort_by)
            if sort_order == 'desc':
                query = query.order_by(column_to_sort.desc())
            else:
                query = query.order_by(column_to_sort.asc())
        else:
            query = query.order_by(BaseContract.created_at.desc())

        paginated_contracts = query.paginate(page=page, per_page=per_page, error_out=False)
        contracts = paginated_contracts.items

        TYPE_CHOICES = {
            "nanny": "育儿嫂合同",
            "maternity_nurse": "月嫂合同",
            "nanny_trial": "育儿嫂试工合同",
            "external_substitution": "外部替班合同",
        }

        results = [
            {
                "id": str(contract.id),
                "customer_name": contract.customer_name,
                "service_personnel_name": contract.service_personnel.name if contract.service_personnel else "N/A",
                "start_date": contract.start_date.isoformat(),
                "end_date": contract.end_date.isoformat(),
                "status": contract.status,
                "signing_status": contract.signing_status.value if contract.signing_status else None,
                "customer_signing_token": contract.customer_signing_token,
                "employee_signing_token": contract.employee_signing_token,
                "customer_signature": contract.customer_signature,
                "employee_signature": contract.employee_signature,
                "created_at": contract.created_at.isoformat(),
                # Include fields needed for filtering and display that were in the old API
                "contract_type_value": contract.type,
                "contract_type_label": TYPE_CHOICES.get(contract.type, contract.type),
                "deposit_amount": str(getattr(contract, 'deposit_amount', 0) or 0),
                "deposit_paid": bool(getattr(contract, 'security_deposit_paid', 0) and getattr(contract, 'deposit_amount', 0) and getattr(contract, 'security_deposit_paid', 0) >= getattr(contract, 'deposit_amount', 0)),
            }
            for contract in contracts
        ]
        
        return jsonify({
            "contracts": results,
            "total": paginated_contracts.total,
            "pages": paginated_contracts.pages,
            "current_page": paginated_contracts.page
        })

    except Exception as e:
        current_app.logger.error(f"Failed to search or list contracts: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@contract_bp.route("/<uuid:contract_id>/substitute-context", methods=["GET"])
@jwt_required()
def get_contract_substitute_context(contract_id):
    """
    获取用于判断替班管理费逻辑的合同上下文信息。
    """
    try:
        contract = db.session.query(BaseContract).get(contract_id)

        if not contract:
            return jsonify({"error": "Contract not found"}), 404

        contract_type_key = "non_auto_renewing"
        effective_end_date = None

        # 判断是否为自动续签的育儿嫂合同 (NannyContract)
        if contract.type == 'nanny' and hasattr(contract, 'is_monthly_auto_renew') and contract.is_monthly_auto_renew:
            contract_type_key = "auto_renewing"
            # 对于自动续签合同，只有终止日期有意义
            if contract.termination_date:
                effective_end_date = contract.termination_date
            else:
                # 没有终止日期，视为无限期
                effective_end_date = None
        else:
            # 对于所有其他类型的合同 (非自动续签育儿嫂, 月嫂等)
            contract_type_key = "non_auto_renewing"
            if contract.termination_date:
                effective_end_date = max(contract.end_date, contract.termination_date)
            else:
                effective_end_date = contract.end_date

        return jsonify({
            "contract_type": contract_type_key,
            "effective_end_date": effective_end_date.isoformat() if effective_end_date else None
        })

    except Exception as e:
        current_app.logger.error(f"Failed to get contract substitute context for {contract_id}: {e}",exc_info=True)
        return jsonify({"error": "Internal server error"}), 500
    
@contract_bp.route("/<uuid:contract_id>/successor", methods=["GET"])
@jwt_required()
def find_successor_contract(contract_id):
    """
    查找并返回给定合同的续约合同。
    此函数现在作为API包装器，调用内部服务函数。
    """
    try:
        successor = _find_successor_contract_internal(str(contract_id))
        if successor:
            return jsonify({
                "id": str(successor.id),
                "customer_name": successor.customer_name,
                "start_date": successor.start_date.isoformat(),
                "end_date": successor.end_date.isoformat()
            })
        else:
            return "", 204
    except Exception as e:
        current_app.logger.error(f"查找续约合同失败 {contract_id}: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

import uuid

# ... (other imports remain the same)

@contract_bp.route("/formal", methods=["POST"])
@jwt_required()
def create_formal_contract():
    """
    创建新的正式合同 (支持现有客户、新客户、或无客户信息创建)。
    """
    data = request.get_json()
    current_app.logger.debug(f"--- [API-CreateFormalContract] START ---")
    current_app.logger.debug(f"[API-CreateFormalContract] Received data: {data}")

    # --- Validation (Only base fields are strictly required) ---
    base_required = ["template_id", "service_personnel_id", "start_date", "end_date", "contract_type"]
    for field in base_required:
        if not data.get(field):
            return jsonify({"error": f"缺少必填字段: {field}"}), 400

    try:
        # --- Fetch related objects that are always required ---
        service_personnel = ServicePersonnel.query.get(data["service_personnel_id"])
        if not service_personnel:
            return jsonify({"error": "服务人员未找到"}), 404

        contract_template = ContractTemplate.query.get(data["template_id"])
        if not contract_template:
            return jsonify({"error": "合同模板未找到"}), 404

        # --- Prepare Customer Info (Handles all 3 cases) ---
        customer_attributes = { "customer_id": None, "customer_name": "待认领", "customer_name_pinyin": "dairenling drl" }
        customer_id = data.get("customer_id")
        customer_name_from_request = data.get("customer_name")

        if customer_id:
            # Case 1: Existing Customer ID is provided
            customer = Customer.query.get(customer_id)
            if not customer:
                return jsonify({"error": f"客户ID {customer_id} 未找到"}), 404
            customer_attributes["customer_id"] = customer.id
            customer_attributes["customer_name"] = customer.name
            customer_attributes["customer_name_pinyin"] = customer.name_pinyin
        elif customer_name_from_request:
            # Case 2: A temporary name for a new customer is provided
            customer_attributes["customer_name"] = customer_name_from_request
            from pypinyin import pinyin, Style
            pinyin_full = "".join(p[0] for p in pinyin(customer_name_from_request, style=Style.NORMAL))
            pinyin_initials = "".join(p[0] for p in pinyin(customer_name_from_request, style=Style.FIRST_LETTER))
            customer_attributes["customer_name_pinyin"] = f"{pinyin_full} {pinyin_initials}"
        # Case 3: No customer info provided, use the default "待认领"

        # --- Prepare Contract Attributes ---
        def to_decimal(value, default=0):
            if value is None or value == '': return D(str(default))
            return D(str(value))

        common_attributes = {
            **customer_attributes,
            "service_personnel_id": service_personnel.id,
            "template_id": data["template_id"],
            "type": data["contract_type"],
            "start_date": datetime.fromisoformat(data["start_date"].split('T')[0]),
            "end_date": datetime.fromisoformat(data["end_date"].split('T')[0]),
            "status": "pending",
            "signing_status": SigningStatus.UNSIGNED,
            "customer_signing_token": str(uuid.uuid4()),
            "employee_signing_token": str(uuid.uuid4()),
            "employee_level": to_decimal(data.get("employee_level")),
            "notes": data.get("notes"),
            "introduction_fee": to_decimal(data.get("introduction_fee")),
            "management_fee_amount": to_decimal(data.get("management_fee_amount")),
            "management_fee_rate": to_decimal(data.get("management_fee_rate")),
            "template_content" : contract_template.content,
            "service_content": data.get("service_content"),
            "service_type": data.get("service_type"),
            "is_auto_renew": data.get("is_auto_renew", False),
            "attachment_content": data.get("attachment_content"),
            "previous_contract_id": data.get("previous_contract_id"),
        }

        # --- Model Selection and Creation ---
        contract_type = data["contract_type"]
        ContractModel = None

        # --- Model Selection and Creation ---
        contract_type = data["contract_type"]
        ContractModel = None

        if contract_type == "nanny":
            ContractModel = NannyContract
            common_attributes["is_monthly_auto_renew"] = data.get("is_monthly_auto_renew", False)
            # 育儿嫂合同的保证金等于员工级别
            common_attributes["security_deposit_paid"] = to_decimal(data.get("employee_level") or 0)

        elif contract_type == "maternity_nurse":
            ContractModel = MaternityNurseContract
            common_attributes["deposit_amount"] = to_decimal(data.get("deposit_amount"))
            common_attributes["provisional_start_date"] = datetime.fromisoformat(data[ "provisional_start_date"].split('T')[0]) if data.get("provisional_start_date") else None
            # 月嫂合同的保证金从前端传入
            common_attributes["security_deposit_paid"] = to_decimal(data.get( "security_deposit_paid") or 0)

        elif contract_type == "nanny_trial":
            ContractModel = NannyTrialContract
            # 试工合同没有保证金，显式设为0
            common_attributes["security_deposit_paid"] = D(0)

        elif contract_type == "external_substitution":
            ContractModel = ExternalSubstitutionContract
            common_attributes["management_fee_rate"] = D(data.get("management_fee_rate", 0.20))
            # 外部替班合同没有保证金，显式设为0
            common_attributes["security_deposit_paid"] = D(0)

        else:
            return jsonify({"error": f"不支持的合同类型: {contract_type}"}), 400

        new_contract = ContractModel(**common_attributes)
        db.session.add(new_contract)
        db.session.commit()

        # 触发后台任务以生成初始账单
        trigger_initial_bill_generation_task.delay(str(new_contract.id))
        current_app.logger.info(f"合同 {new_contract.id} 已创建，已提交后台任务以生成初始账单。")

        # --- 构造完整的签名URL ---
        frontend_base_url = current_app.config.get('FRONTEND_BASE_URL')
        # current_app.logger.debug(f"[API-CreateFormalContract] FRONTEND_BASE_URL: {frontend_base_url}")
        customer_url = f"{frontend_base_url}/sign/{new_contract.customer_signing_token}"
        employee_url = f"{frontend_base_url}/sign/{new_contract.employee_signing_token}"

        return jsonify({
            "message": "正式合同创建成功",
            "contract_id": str(new_contract.id),
            "customer_signing_token": new_contract.customer_signing_token,
            "employee_signing_token": new_contract.employee_signing_token,
            "customer_signing_url": customer_url, # <-- 新增
            "employee_signing_url": employee_url, # <-- 新增
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"创建正式合同失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500


@contract_bp.route("/sign/<string:token>", methods=["GET"])
def get_contract_for_signing(token):
    """
    一个公开的API，供客户或员工使用专属令牌查看合同。
    """
    # Determine role and find contract by the provided token
    role = None
    contract = BaseContract.query.filter_by(customer_signing_token=token).first()
    if contract:
        role = "customer"
    else:
        contract = BaseContract.query.filter_by(employee_signing_token=token).first()
        if contract:
            role = "employee"

    if not contract:
        return jsonify({"error": "无效的签名链接或合同不存在"}), 404

    # 关联加载所需信息
    contract = BaseContract.query.options(
        joinedload(BaseContract.customer),
        joinedload(BaseContract.service_personnel)
    ).filter_by(id=contract.id).first()

    customer_info = {
        "id": contract.customer.id,
        "name": contract.customer.name,
        "id_card_number": contract.customer.id_card_number,
        "phone_number": contract.customer.phone_number,
        "address": contract.customer.address
    } if contract.customer else {}

    employee_info = {
        "id": contract.service_personnel.id,
        "name": contract.service_personnel.name,
        "id_card_number": contract.service_personnel.id_card_number,
        "phone_number": contract.service_personnel.phone_number,
        "address": contract.service_personnel.address
    } if contract.service_personnel else {}

    # Safely get subclass-specific attributes like deposit_amount
    deposit_amount = getattr(contract, 'deposit_amount', None)
    security_deposit_paid = getattr(contract, 'security_deposit_paid', None)

    return jsonify({
        "contract_id": str(contract.id),
        "role": role,
        "customer_name": contract.customer_name,
        "template_content": contract.template_content,
        "service_content": contract.service_content,
        "attachment_content": contract.attachment_content,
        "customer_info": customer_info,
        "employee_info": employee_info,
        "signing_status": contract.signing_status.value if contract.signing_status else None,
        "customer_signature": contract.customer_signature,
        "employee_signature": contract.employee_signature,

        # --- 核心修正：添加前端需要的所有核心信息字段 ---
        "type": contract.type,
        "service_type": contract.service_type,
        "start_date": contract.start_date.isoformat(),
        "end_date": contract.end_date.isoformat(),
        "employee_level": float(contract.employee_level) if contract.employee_level is not None else None,
        "management_fee_amount": float(contract.management_fee_amount) if contract.management_fee_amount is not None else None,
        "deposit_amount": float(deposit_amount) if deposit_amount is not None else None,
        "security_deposit_paid": float(security_deposit_paid) if security_deposit_paid is not None else None,
    })


@contract_bp.route("/sign/<string:token>", methods=["POST"])
def submit_signature(token):
    """
    一个公开的API，用于接收签名。
    (已更新为支持在签名时创建或更新客户/员工信息)
    """
    data = request.get_json()
    if not data or "signature" not in data:
        return jsonify({"error": "缺少 'signature' 参数"}), 400

    # 确定角色并查找合同
    role = None
    contract = BaseContract.query.filter_by(customer_signing_token=token).first()
    if contract:
        role = "customer"
    else:
        contract = BaseContract.query.filter_by(employee_signing_token=token).first()
        if contract:
            role = "employee"

    if not contract:
        return jsonify({"error": "无效的签名链接或合同不存在"}), 404

    signature = data["signature"]

    try:
        if role == "customer":
            customer_info_data = data.get("customer_info")
            if not customer_info_data or not all(customer_info_data.get(f) for f in ['name', 'phone_number', 'id_card_number', 'address']):
                return jsonify({"error": "客户信息不完整，所有字段均为必填项。"}), 400

            # 场景1 & 2: 合同没有customer_id，需要创建或关联客户
            if not contract.customer_id:
                existing_customer = Customer.query.filter(
                    or_(Customer.id_card_number == customer_info_data['id_card_number'], Customer.phone_number == customer_info_data['phone_number'])
                ).first()

                if existing_customer:
                    # 如果根据身份证或手机号找到了已存在的客户，则直接关联
                    customer_to_work_with = existing_customer
                    # 更新信息以防有变
                    customer_to_work_with.name = customer_info_data['name']
                    customer_to_work_with.address = customer_info_data['address']
                    customer_to_work_with.phone_number = customer_info_data['phone_number']
                    current_app.logger.info(f"发现已存在的客户 (ID: {existing_customer.id} )，更新其信息并关联到合同。")
                else:
                    # 创建新客户
                    from pypinyin import pinyin, Style
                    name = customer_info_data['name']
                    pinyin_full = "".join(p[0] for p in pinyin(name, style=Style.NORMAL))
                    pinyin_initials = "".join(p[0] for p in pinyin(name, style=Style.FIRST_LETTER))

                    new_customer = Customer(
                        name=name,
                        phone_number=customer_info_data['phone_number'],
                        id_card_number=customer_info_data['id_card_number'],
                        address=customer_info_data['address'],
                        name_pinyin=f"{pinyin_full} {pinyin_initials}"
                    )
                    db.session.add(new_customer)
                    db.session.flush()
                    customer_to_work_with = new_customer
                    current_app.logger.info(f"创建了新客户 (ID: {new_customer.id})。")

                contract.customer_id = customer_to_work_with.id
                contract.customer_name = customer_to_work_with.name
                contract.customer_name_pinyin = customer_to_work_with.name_pinyin

            # 场景3: 合同已有customer_id，表示更新老客户信息
            else:
                customer_to_update = Customer.query.get(contract.customer_id)
                if customer_to_update:
                    customer_to_update.name = customer_info_data['name']
                    customer_to_update.phone_number = customer_info_data['phone_number']
                    customer_to_update.id_card_number = customer_info_data['id_card_number']
                    customer_to_update.address = customer_info_data['address']
                    current_app.logger.info(f"更新了客户 (ID: {customer_to_update.id}) 的信息。" )

            # 更新签名
            contract.customer_signature = signature
            if contract.signing_status == SigningStatus.EMPLOYEE_SIGNED:
                contract.signing_status = SigningStatus.SIGNED
                contract.status = "active"
                update_salary_history_on_contract_activation(contract)
                current_app.logger.info(f"合同 {contract.id} 已激活。")
            else:
                contract.signing_status = SigningStatus.CUSTOMER_SIGNED

        elif role == "employee":
            employee_info_data = data.get("employee_info")
            if not employee_info_data or not all(employee_info_data.get(f) for f in ['name', 'phone_number', 'id_card_number', 'address']):
                return jsonify({"error": "员工信息不完整，所有字段均为必填项。"}), 400

            employee_to_update = ServicePersonnel.query.get(contract.service_personnel_id)
            if employee_to_update:
                employee_to_update.name = employee_info_data['name']
                employee_to_update.phone_number = employee_info_data['phone_number']
                employee_to_update.id_card_number = employee_info_data['id_card_number']
                employee_to_update.address = employee_info_data['address']
                current_app.logger.info(f"更新了服务人员 (ID: {employee_to_update.id}) 的信息。" )

            # 更新签名
            contract.employee_signature = signature
            if contract.signing_status == SigningStatus.CUSTOMER_SIGNED:
                contract.signing_status = SigningStatus.SIGNED
                contract.status = "active"
                update_salary_history_on_contract_activation(contract)
                current_app.logger.info(f"合同 {contract.id} 已激活。")
            else:
                contract.signing_status = SigningStatus.EMPLOYEE_SIGNED

        db.session.commit()
        return jsonify({"message": "签名成功！", "signing_status": contract.signing_status.value})

    except IntegrityError as e:
        db.session.rollback()
        current_app.logger.error(f"保存客户/员工信息或签名时发生数据库完整性错误: {e}", exc_info=True)
        return jsonify({"error": "提交的信息与现有记录冲突（身份证或手机号可能已存在），请核实。"}), 409
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"保存签名失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500
    
# 1. 定义一个从“资产ID”到真实文件名的映射
# 这两个UUID是我们为签章图片指定的唯一ID
SEAL_ASSETS = {
    "c7a8f0e2-3b4d-4c6e-8a9b-1c2d3e4f5a6b": "company_sign_myms.webp",
    "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d": "company_sign_jfa.webp",
}

@contract_bp.route("/assets/<string:asset_id>", methods=["GET"])
def get_private_asset(asset_id):
    """
    一个安全的接口，用于根据ID提供私有静态资源（如签章图片）。
    """
    # 2. 将目录路径的定义移到函数内部
    # 此时 app context 已经存在，current_app 可用
    private_asset_dir = os.path.join(current_app.root_path, '..', 'backend', 'static', 'private_assets')

    # 3. 从映射中查找文件名
    filename = SEAL_ASSETS.get(asset_id)

    if not filename:
        return "Asset not found", 404

    try:
        # 4. 使用 Flask 的 send_from_directory 安全地发送文件
        return send_from_directory(private_asset_dir, filename)
    except FileNotFoundError:
        current_app.logger.error(f"Asset file not found on disk: {filename} in dir {private_asset_dir}")
        return "Asset file not found", 404


@contract_bp.route("/<string:contract_id>/signing-messages", methods=["GET"])
@jwt_required()
def generate_signing_messages(contract_id):
    """
    为新创建的合同生成客户和员工的签署通知消息 (V3 - 包含支付记录)。
    """
    try:
        # 1. 关联加载获取合同、客户及服务人员信息
        contract = BaseContract.query.options(
            joinedload(BaseContract.customer),
            joinedload(BaseContract.service_personnel)
        ).filter_by(id=contract_id).first()

        if not contract:
            return jsonify({"error": "合同未找到"}), 404

        customer_name = contract.customer.name if contract.customer else contract.customer_name
        employee_name = contract.service_personnel.name if contract.service_personnel else "服务人员"

        # 2. 根据合同类型选择正确的银行账户
        if contract.type == 'maternity_nurse':
            account_nickname = '萌姨萌嫂账号'
        else:
            account_nickname = '家福安账号'

        bank_account = CompanyBankAccount.query.filter_by(account_nickname=account_nickname, is_active=True).first()
        if not bank_account:
            return jsonify({"error": f"未找到昵称为 '{account_nickname}' 的有效公司银行账户"}), 500

        # 3. 查找第一期账单
        first_bill = CustomerBill.query.filter_by(
            contract_id=contract_id,
            is_substitute_bill=False
        ).order_by(CustomerBill.cycle_start_date.asc()).first()

        # 4. 构建签署链接
        frontend_base_url = current_app.config.get('FRONTEND_BASE_URL', '')
        customer_signing_url = f"{frontend_base_url}/sign/{contract.customer_signing_token}"
        employee_signing_url = f"{frontend_base_url}/sign/{contract.employee_signing_token}"

        # 5. 生成客户消息
        customer_message_lines = []
        customer_message_lines.append(f"{customer_name}——{employee_name}：签约 {contract.start_date.strftime('%Y.%m.%d')}~{contract.end_date.strftime('%Y.%m.%d')}，")

        payment_records = []
        if first_bill:
            # --- V3 核心修改：强制刷新账单支付状态 ---
            _update_bill_payment_status(first_bill)
            db.session.commit()
            db.session.refresh(first_bill)

                        # --- 提取费用详情 (V4 - 增加月嫂合同特殊处理) ---
            calculation_details = first_bill.calculation_details or {}
            
            if contract.type == 'maternity_nurse':
                # --- 月嫂合同的特殊消息格式 ---
                customer_deposit = D(calculation_details.get('customer_deposit', 0))
                management_fee = D(calculation_details.get('management_fee', 0))
                
                # if customer_deposit > 0:
                    # customer_message_lines.append(f"本次应交保证金：{customer_deposit:.2f}元")
                if management_fee > 0:
                    # 从日志中获取更详细的管理费说明，对客户更友好
                    log = calculation_details.get('calculation_log', {})
                    mgmt_fee_log = log.get('管理费', f'{management_fee:.2f}元')
                    if '=' in mgmt_fee_log:
                        mgmt_fee_log = mgmt_fee_log.split('=')[-1].strip()
                    customer_message_lines.append(f"管理费：{mgmt_fee_log}")

            else:
                # --- 其他合同类型的现有逻辑 (保持不变) ---
                log = calculation_details.get('calculation_log', {})
                if '本次交管理费' in log and log['本次交管理费']:
                    full_desc = log['本次交管理费']
                    if '=' in full_desc:
                        desc = full_desc.split('=')[-1].strip()
                    else:
                        desc = full_desc.split(':', 1)[-1].strip() if ':' in full_desc else full_desc
                    customer_message_lines.append(f"本次交管理费：{desc}")

                        # --- 通用逻辑：处理其他增减款项 ---
            adjustments = FinancialAdjustment.query.filter_by(customer_bill_id=first_bill.id).all ()
            for adj in adjustments:
                # --- 核心修正：为月嫂合同增加更强的过滤，防止重复 ---
                if contract.type == 'maternity_nurse':
                    # 如果 adjustment 类型或描述是我们已经明确处理过的，就跳过
                    if adj.adjustment_type in ['customer_deposit', 'management_fee'] or \
                       adj.description.strip() in ["保证金", "客交保证金", "管理费"]:
                        continue
                
                # 排除不应由客户看到的员工侧调整
                if adj.adjustment_type not in ['employee_salary_adjustment', 'employee_bonus', 'employee_deduction']:
                    customer_message_lines.append(f"{adj.description.strip()}：{adj.amount:.2f} 元")
            # --- 添加总计和已支付 ---
            amount_to_pay = first_bill.total_due
            customer_message_lines.append(f"费用总计：{amount_to_pay:.2f}元")
            if first_bill.total_paid > 0:
                customer_message_lines.append(f"已支付：{first_bill.total_paid:.2f}元")
                customer_message_lines.append(f"还需支付：{(amount_to_pay - first_bill.total_paid):.2f}元，")
            # else:
            #      customer_message_lines.append("，") # 保持格式一致

            # 查询收款记录
            payment_records = PaymentRecord.query.filter_by(customer_bill_id=first_bill.id ).order_by(PaymentRecord.payment_date.asc()).all()
        else:
            current_app.logger.warning(f"合同 {contract_id} 的首期账单尚未生成，消息中将不包含费用信息。")

        customer_message_lines.append(f"户名：{bank_account.payee_name}")
        customer_message_lines.append(f"帐号：{bank_account.account_number}")
        customer_message_lines.append(f"银行：{bank_account.bank_name}")
        customer_message_lines.append("\n合同：")
        customer_message_lines.append(customer_signing_url)
        customer_message_lines.append("1、 请点开上面链接，将甲方内容填写完整")
        customer_message_lines.append("2、 阅读完内容后，最下面签字、提交")
        customer_message_lines.append("3、 看见提交成功即可")

        # --- V3 新增：附上收款记录 ---
        if payment_records:
            customer_message_lines.append("\n--- 收款记录 ---")
            for p in payment_records:
                payment_date_str = p.payment_date.strftime('%Y-%m-%d') if p.payment_date else 'N/A'
                # 【已修复】移除.2和f之间的空格
                customer_message_lines.append(f"通过「{p.method}」打款 {p.amount:.2f}元 {p.notes} ")

        # 6. 生成员工消息 (保持不变)
        employee_message_lines = []
        employee_message_lines.append(f"{customer_name}——{employee_name}：签约 {contract.start_date.strftime('%Y.%m.%d')}~{contract.end_date.strftime('%Y.%m.%d')}，")
        employee_message_lines.append(f"月薪：{contract.employee_level or '待定'}，")
        employee_message_lines.append("\n合同：")
        employee_message_lines.append(employee_signing_url)
        employee_message_lines.append("1、 请点开上面链接，将乙方内容填写完整")
        employee_message_lines.append("2、 阅读完内容后，最下面签字、提交")
        employee_message_lines.append("3. 看见提交成功即可")

        customer_message = '\n'.join(customer_message_lines).replace("[系统添加] ", "").strip()
        employee_message = '\n'.join(employee_message_lines).replace("[系统添加] ", "").strip()

        return jsonify({
            "customer_message": customer_message,
            "employee_message": employee_message
        })

    except Exception as e:
        current_app.logger.error(f"为合同 {contract_id} 生成签署消息失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500