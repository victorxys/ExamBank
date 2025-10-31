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
)
from backend.tasks import calculate_monthly_billing_task
from backend.services.billing_engine import BillingEngine, calculate_substitute_management_fee
from backend.services.contract_service import cancel_substitute_bill_due_to_transfer, apply_transfer_credits_to_new_contract
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
    搜索合同。支持按客户姓名或拼音进行模糊搜索。
    """
    search_term = request.args.get("search", "").strip()
    
    if not search_term:
        return jsonify([])

    # 为了性能，限制返回结果的数量
    limit = request.args.get("limit", 10, type=int)

    try:
        # 同时搜索客户姓名和拼音字段
        pinyin_search_term = search_term.replace(" ", "")
        query = BaseContract.query.filter(
            or_(
                BaseContract.customer_name.ilike(f"%{search_term}%"),
                BaseContract.customer_name_pinyin.ilike(f"%{pinyin_search_term}%")
            )
        ).limit(limit)

        contracts = query.all()

        # 我们只需要合同ID和客户名，避免返回过多不必要的数据
        results = [
            {
                "id": str(contract.id),
                "customer_name": contract.customer_name
            }
            for contract in contracts
        ]
        
        return jsonify(results)

    except Exception as e:
        current_app.logger.error(f"Failed to search contracts: {e}", exc_info=True)
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
    """
    current_app.logger.info(f"[SuccessorCheck] 开始为合同 {contract_id} 查找续约合同...")
    try:
        current_contract = BaseContract.query.get(contract_id)
        if not current_contract:
            current_app.logger.warning(f"[SuccessorCheck] 合同 {contract_id} 未找到")
            return jsonify({"error": "Contract not found"}), 404

        # 确定合同的实际结束日期，优先使用终止日期
        effective_end_date = current_contract.termination_date or current_contract.end_date
        current_app.logger.info(f"[SuccessorCheck] 合同 {contract_id} 的类型为 {current_contract.type}, 状态为 {current_contract.status}")
        current_app.logger.info(f"[SuccessorCheck] 原始 end_date: {current_contract.end_date}, 原始 termination_date: {current_contract.termination_date}")
        current_app.logger.info(f"[SuccessorCheck] 计算出的实际结束日期 (effective_end_date): {effective_end_date}")

        if not effective_end_date:
            current_app.logger.info(f"[SuccessorCheck] 合同 {contract_id} 没有有效的结束日期，无法查找续约合同。")
            return "", 204

        # 查找续约合同
        successor = BaseContract.query.filter(
            BaseContract.customer_name == current_contract.customer_name,
            BaseContract.type == current_contract.type,
            BaseContract.service_personnel_id == current_contract.service_personnel_id,
            BaseContract.user_id == current_contract.user_id,
            BaseContract.id != current_contract.id,
            BaseContract.start_date >= effective_end_date, # 新合同在当前合同实际结束后开始
            BaseContract.status != 'terminated'  # <-- 新增的过滤条件
        ).order_by(BaseContract.start_date.asc()).first()

        if successor:
            current_app.logger.info(f"[SuccessorCheck] 找到了续约合同 {successor.id}，开始日期: {successor.start_date}")
            return jsonify({
                "id": str(successor.id),
                "customer_name": successor.customer_name,
                "start_date": successor.start_date.isoformat(),
                "end_date": successor.end_date.isoformat()
            })
        else:
            current_app.logger.info(f"[SuccessorCheck] 未找到 {contract_id} 的续约合同。")
            return "", 204
            
    except Exception as e:
        current_app.logger.error(f"查找续约合同失败 {contract_id}: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500