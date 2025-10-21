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
from sqlalchemy import or_
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

        main_contract = BaseContract.query.get(contract_id)
        if not main_contract:
            return jsonify({"error": "Main contract not found"}), 404
        
        current_app.logger.debug(f"[API-CreateSub] Found main_contract: ID={main_contract.id}, Status={main_contract.status}, EndDate={main_contract.end_date}, AutoRenew={getattr(main_contract, 'is_monthly_auto_renew', False)}")

        substitute_user = User.query.get(data["substitute_user_id"])
        if not substitute_user:
            return jsonify({"error": "Substitute user not found"}), 404

        # ... (previous code remains the same)

        new_record = SubstituteRecord(
            main_contract_id=str(contract_id),
            substitute_user_id=data["substitute_user_id"],
            start_date=start_date,
            end_date=end_date,
            substitute_salary=employee_level,
            substitute_type=substitute_type,
            original_customer_bill_id=original_bill_id,
            substitute_management_fee=D("0"), # Initialize with 0
        )

        # Calculate the fee
        total_fee = calculate_substitute_management_fee(new_record, main_contract)
        
        if total_fee > 0:
            new_record.substitute_management_fee = total_fee

        db.session.add(new_record)
        db.session.flush()

        # ... (rest of the code remains the same)

        engine = BillingEngine()
        engine.calculate_for_substitute(new_record.id)
        
        if original_bill_id:
            original_bill = CustomerBill.query.get(original_bill_id)
            if original_bill:
                engine.calculate_for_month(
                    original_bill.year, 
                    original_bill.month, 
                    original_bill.contract_id, 
                    force_recalculate=True
                )

        current_app.logger.debug(f"--- [API-CreateSub] END for contract: {contract_id} ---")
        return jsonify(
            {
                "message": "替班记录已创建，相关账单已更新。",
                "record_id": str(new_record.id),
            }
        ), 201

    except ValueError:
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


# 已在 billing_api 中实现
# @contract_bp.route("/<uuid:contract_id>/terminate", methods=["POST"])
# @jwt_required()
# def terminate_contract(contract_id):
#     current_app.logger.debug(f"=========开始终止合同========={contract_id}")
#     data = request.get_json()
#     termination_date_str = data.get("termination_date")
#     transfer_options = data.get("transfer_options")
#     current_app.logger.debug(f"[API-Terminate] Received termination_date_str: {termination_date_str}")
#     if not termination_date_str:
#         return jsonify({"error": "Termination date is required"}), 400

#     try:
#         termination_date = datetime.strptime(termination_date_str, "%Y-%m-%d").date()
#         current_app.logger.debug(f"[API-Terminate] Parsed termination_date: {termination_date}")# 添加此日志
#     except ValueError:
#         return jsonify({"error": "Invalid date format. Use YYYY-MM-DD."}), 400

#     contract =db.session.query(BaseContract).options(joinedload(BaseContract.substitute_records)).get_or_404(contract_id)
#     current_app.logger.debug(f"[API-Terminate] Contract status before termination: {contract.status}, end_date: {contract.end_date}") # 添加此日志

#     try:
#         # 如果是转签，按顺序执行新的总指挥逻辑
#         if transfer_options:
#             new_contract_id = transfer_options.get("new_contract_id")
#             substitute_user_id = transfer_options.get("substitute_user_id")
#             if not new_contract_id or not substitute_user_id:
#                 raise ValueError("转签失败：缺少新合同ID或替班员工ID。")
            
#             new_contract = db.session.get(BaseContract, new_contract_id)
#             if not new_contract:
#                 raise ValueError(f"转签失败：新合同 {new_contract_id} 未找到。")
#             substitute_user = db.session.get(User, substitute_user_id)
#             if not substitute_user:
#                 raise ValueError(f"转签失败：替班员工 {substitute_user_id} 未找到。")

#             # 第1步：作废旧合同的替班账单
#             cancel_substitute_bill_due_to_transfer(
#                 db.session,
#                 old_contract=contract,
#                 new_contract=new_contract,
#                 substitute_user=substitute_user,
#                 termination_date=termination_date
#             )

#             # 第2步：计算旧合同的应退款项
#             engine = BillingEngine()
#             refunds = engine.calculate_termination_refunds(contract, termination_date)

#             # 第3步：将退款作为信用额度应用到新合同
#             apply_transfer_credits_to_new_contract(
#                 db.session,
#                 new_contract=new_contract,
#                 credits=refunds,
#                 old_contract_id=str(contract.id),
#                 termination_date=termination_date
#             )
            
#             message = f"合同 {contract_id} 已成功终止，并完成费用转签。"

#         # 不论是否转签，最后都要执行终止操作
#         termination_year = termination_date.year
#         termination_month = termination_date.month

#         bills_to_delete_query = CustomerBill.query.with_entities(CustomerBill.id).filter(
#             CustomerBill.contract_id == contract_id,
#             ((CustomerBill.year == termination_year) & (CustomerBill.month > termination_month)) |
#             (CustomerBill.year > termination_year)
#         )
#         bill_ids_to_delete = [item[0] for item in bills_to_delete_query.all()]

#         payrolls_to_delete_query = EmployeePayroll.query.with_entities(EmployeePayroll.id).filter(
#             EmployeePayroll.contract_id == contract_id,
#             ((EmployeePayroll.year == termination_year) & (EmployeePayroll.month > termination_month)) |
#             (EmployeePayroll.year > termination_year)
#         )
#         payroll_ids_to_delete = [item[0] for item in payrolls_to_delete_query.all()]

#         if bill_ids_to_delete:
#             FinancialActivityLog.query.filter(FinancialActivityLog.customer_bill_id.in_(bill_ids_to_delete)).delete(synchronize_session=False)
#             CustomerBill.query.filter(CustomerBill.id.in_(bill_ids_to_delete)).delete(synchronize_session=False)

#         if payroll_ids_to_delete:
#             FinancialActivityLog.query.filter(FinancialActivityLog.employee_payroll_id.in_(payroll_ids_to_delete)).delete(synchronize_session=False)
#             EmployeePayroll.query.filter(EmployeePayroll.id.in_(payroll_ids_to_delete)).delete(synchronize_session=False)

#         contract.status = "terminated"
#         contract.end_date = termination_date
#         if hasattr(contract, 'expected_offboarding_date'):
#             contract.expected_offboarding_date = termination_date

#         # 如果不是转签，才需要重算最后一期账单。转签的账单由转移的费用本身来体现。
#         if not transfer_options:
#             calculate_monthly_billing_task.delay(
#                 termination_year, termination_month, contract_id=str(contract.id), force_recalculate=True
#             )
#             message = f"合同 {contract_id} 已终止，正在为您重算最后一期账单..."

#         # 【新增逻辑】检查并生成提前终止合同产生的替班管理费
#         for sub_record in contract.substitute_records:
#             current_app.logger.debug(f"[API-Terminate] Processing sub_record: {sub_record.id}, start_date: {sub_record.start_date}, end_date: {sub_record.end_date}") # 添加此日志
#             total_fee = calculate_substitute_management_fee(
#                 sub_record, contract, contract_termination_date=termination_date
#             )
#             current_app.logger.debug(f"[API-Terminate] Calculated total_fee for sub_record {sub_record.id}: {total_fee}") # 添加此日志
#             if total_fee > 0:
#                 sub_record.substitute_management_fee = total_fee
#                 db.session.add(sub_record)
#                 current_app.logger.info(
#                     f"因合同 {contract.id} 提前终止，为替班记录 {sub_record.id} 更新了 {total_fee} 元的管理费。"
#                 )
#             else: # 为调试添加此 else 块
#                 current_app.logger.info(
#                     f"因合同 {contract.id} 提前终止，替班记录 {sub_record.id} 未产生管理费 (total_fee: {total_fee})."
#                 )

#         # 统一提交数据库事务
#         db.session.commit()
#         current_app.logger.info(message)
#         return jsonify({"message": message}), 200

#     except Exception as e:
#         db.session.rollback()
#         current_app.logger.error(
#             f"Error during contract termination for {contract_id}: {e}",
#             exc_info=True
#         )
#         return jsonify({"error": "operation_failed", "message": str(e)}), 500


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