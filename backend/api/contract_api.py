# backend/api/contract_api.py
from flask import Blueprint, jsonify, request, current_app
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
    NannyContract,MaternityNurseContract,NannyTrialContract
)
from backend.tasks import calculate_monthly_billing_task
from backend.services.billing_engine import BillingEngine, calculate_substitute_management_fee
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
    
# 在 backend/api/contract_api.py 文件末尾添加

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
    创建新的正式合同（已重构为支持多态）。
    """
    data = request.get_json()
    current_app.logger.debug(f"--- [API-CreateFormalContract] START ---")
    current_app.logger.debug(f"[API-CreateFormalContract] Received data: {data}")

    required_fields = ["template_id", "customer_id", "service_personnel_id", "start_date", "end_date", "contract_type"]
    for field in required_fields:
        if field not in data or not data[field]:
            return jsonify({"error": f"缺少必填字段: {field}"}), 400

    try:
        customer = Customer.query.get(data["customer_id"])
        if not customer:
            return jsonify({"error": "客户未找到"}), 404

        service_personnel = ServicePersonnel.query.get(data["service_personnel_id"])
        if not service_personnel:
            return jsonify({"error": "服务人员未找到"}), 404
        
        contract_template = ContractTemplate.query.get(data["template_id"])
        if not contract_template:
            return jsonify({"error": "合同模板未找到"}), 404

        def to_decimal(value, default=0):
            if value is None or value == '':
                return D(str(default))
            return D(str(value))

        # 1. 准备所有合同共有的基础属性
        common_attributes = {
            "customer_name": customer.name,
            "customer_id": customer.id, # 增加 customer_id 关联
            "service_personnel_id": service_personnel.id,
            "template_id": data["template_id"],
            "type": data["contract_type"],
            "start_date": datetime.fromisoformat(data["start_date"].split('T')[0]),
            "end_date": datetime.fromisoformat(data["end_date"].split('T')[0]),
            "status": "active",
            "signing_status": SigningStatus.UNSIGNED,
            "customer_signing_token": str(uuid.uuid4()),
            "employee_signing_token": str(uuid.uuid4()),
            "employee_level": to_decimal(data.get("employee_level")),
            "notes": data.get("notes"),
            "introduction_fee": to_decimal(data.get("introduction_fee")),
            "management_fee_amount": to_decimal(data.get("management_fee_amount")),
            "management_fee_rate": to_decimal(data.get("management_fee_rate")),
            "service_content": contract_template.content, 
            "service_type": data.get("service_type"),
            "is_auto_renew": data.get("is_auto_renew", False),
            "attachment_content": data.get("attachment_content"),
            "previous_contract_id": data.get("previous_contract_id"),
        }

        # 2. 根据合同类型，选择模型并添加特定属性
        contract_type = data["contract_type"]
        ContractModel = None

        if contract_type == "nanny":
            ContractModel = NannyContract
            common_attributes["is_monthly_auto_renew"] = data.get("is_monthly_auto_renew", False)
        elif contract_type == "maternity_nurse":
            ContractModel = MaternityNurseContract
            common_attributes["deposit_amount"] = to_decimal(data.get("deposit_amount"))
            common_attributes["provisional_start_date"] = datetime.fromisoformat(data[ "provisional_start_date"].split('T')[0]) if data.get("provisional_start_date") else None
            common_attributes["security_deposit_paid"] = to_decimal(data.get( "security_deposit_paid"))
        elif contract_type == "nanny_trial":
            ContractModel = NannyTrialContract
            # trial 合同特有字段可以在这里添加
        else:
            return jsonify({"error": f"不支持的合同类型: {contract_type}"}), 400

        # 3. 使用正确的模型和所有属性来创建实例
        new_contract = ContractModel(**common_attributes)

        db.session.add(new_contract)
        db.session.commit()

        current_app.logger.debug(f"--- [API-CreateFormalContract] END, new contract ID: {new_contract.id} ---")
        return jsonify({
            "message": "正式合同创建成功",
            "contract_id": str(new_contract.id),
            "customer_signing_token": new_contract.customer_signing_token,
            "employee_signing_token": new_contract.employee_signing_token,
        }), 201

    except (ValueError, decimal.InvalidOperation) as e:
        db.session.rollback()
        current_app.logger.error(f"数据格式错误: {e}", exc_info=True)
        return jsonify({"error": f"数据格式错误: {e}"}), 400
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
        "name": contract.customer.name,
        "id_card_number": contract.customer.id_card_number,
        "phone_number": contract.customer.phone_number,
        "address": contract.customer.address
    } if contract.customer else {}

    employee_info = {
        "name": contract.service_personnel.name,
        "id_card_number": contract.service_personnel.id_card_number,
        "phone_number": contract.service_personnel.phone_number,
        "address": contract.service_personnel.address
    } if contract.service_personnel else {}

    return jsonify({
        "contract_id": str(contract.id),
        "role": role,  # <-- 告诉前端当前用户的角色
        "service_content": contract.service_content,
        "attachment_content": contract.attachment_content,
        "customer_info": customer_info,
        "employee_info": employee_info,
        "signing_status": contract.signing_status.value if contract.signing_status else None,
        "customer_signature": contract.customer_signature,
        "employee_signature": contract.employee_signature,
    })


@contract_bp.route("/sign/<string:token>", methods=["POST"])
def submit_signature(token):
    """
    一个公开的API，用于接收签名（已更新为使用专属token）。
    """
    data = request.get_json()
    if not data or "signature" not in data:
        return jsonify({"error": "缺少 'signature' 参数"}), 400

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

    signature = data["signature"]

    if role == "customer":
        contract.customer_signature = signature
        if contract.signing_status == SigningStatus.EMPLOYEE_SIGNED:
            contract.signing_status = SigningStatus.SIGNED
            contract.status = "active"
            update_salary_history_on_contract_activation(contract)
        else:
            contract.signing_status = SigningStatus.CUSTOMER_SIGNED

    elif role == "employee":
        contract.employee_signature = signature
        if contract.signing_status == SigningStatus.CUSTOMER_SIGNED:
            contract.signing_status = SigningStatus.SIGNED
            contract.status = "active"
            update_salary_history_on_contract_activation(contract)
        else:
            contract.signing_status = SigningStatus.EMPLOYEE_SIGNED

    try:
        db.session.commit()
        return jsonify({"message": "签名成功！", "signing_status": contract.signing_status.value})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"保存签名失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500