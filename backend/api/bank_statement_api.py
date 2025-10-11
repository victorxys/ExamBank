from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from flask import request
from backend.services.bank_statement_service import BankStatementService, BankTransaction, BankTransactionStatus

bank_statement_api = Blueprint("bank_statement_api", __name__)


# backend/api/bank_statement_api.py

@bank_statement_api.route("/api/bank-statement/reconcile", methods=["POST"])
@jwt_required()
def reconcile_statement():
    """
    接收银行对账单文本，仅进行解析和存储。
    """
    
    data = request.get_json()
    # --- 修改这里，接收一个 "statement_lines" 数组 ---
    if not data or "statement_lines" not in data or not isinstance(data["statement_lines"], list):
        return jsonify({"error": "请求体必须包含 'statement_lines' 数组"}), 400

    statement_lines = data["statement_lines"]
    # -------------------------------------------------
    operator_id = get_jwt_identity()

    if not operator_id:
        return jsonify({"error": "无法获取操作员信息，请确认您已登录"}), 401

    try:
        service = BankStatementService()
        
        # 只调用解析和存储，并接收返回结果
        result = service.parse_and_store_statement(statement_lines, operator_id)
        
        return jsonify(result), 200

    except Exception as e:
        # 在实际应用中，这里应该有更详细的错误日志
        return jsonify({"error": f"处理过程中发生错误: {str(e)}"}), 500
    
@bank_statement_api.route("/api/bank-transactions", methods=["GET"])
@jwt_required()
def get_unmatched_transactions():
    """
    获取并分类所有未处理的银行流水。
    """
    try:
        year = request.args.get('year', type=int)
        month = request.args.get('month', type=int)
        if not year or not month:
            return jsonify({"error": "Query parameters 'year' and 'month' are required."}), 400

        service = BankStatementService()
        categorized_data = service.get_and_categorize_transactions(year, month)
        
        return jsonify(categorized_data), 200

    except Exception as e:
        current_app.logger.error(f"Failed to fetch and categorize transactions: {e}", exc_info=True)
        return jsonify({"error": f"获取流水失败: {str(e)}"}), 500
    
@bank_statement_api.route("/api/bank-transactions/<bank_transaction_id>/matching-details", methods=["GET"])
@jwt_required()
def get_matching_details(bank_transaction_id):
    """
    为指定的银行流水ID查找匹配的客户和指定年月的未付账单。
    """
    # --- 从 URL query string 中获取 year 和 month ---
    try:
        year = request.args.get('year', type=int)
        month = request.args.get('month', type=int)
        if not year or not month:
            return jsonify({"error": "Query parameters 'year' and 'month' are required."}), 400
    except (ValueError, TypeError):
        return jsonify({"error": "Query parameters 'year' and 'month' must be integers."}), 400
    # ---------------------------------------------

    try:
        service = BankStatementService()
        # --- 将 year 和 month 传递给 service 方法 ---
        result = service.find_customer_and_unpaid_bills(bank_transaction_id, year, month)
        # -----------------------------------------
        
        if result.get("error"):
            return jsonify(result), 404
        
        return jsonify(result), 200

    except Exception as e:
        current_app.logger.error(f"Failed to fetch matching details for txn {bank_transaction_id}: {e}", exc_info=True)
        return jsonify({"error": f"获取匹配详情失败: {str(e)}"}), 500
    
@bank_statement_api.route("/api/bank-transactions/<bank_transaction_id>/allocate", methods=["POST"])
@jwt_required()
def allocate_transaction(bank_transaction_id):
    """
    接收前端的分配方案，并执行分配。
    """
    data = request.get_json()
    if not data or "allocations" not in data or not isinstance(data["allocations"], list):
        return jsonify({"error": "Request body must contain an 'allocations' array."}), 400

    allocations = data["allocations"]
    operator_id = get_jwt_identity()

    service = BankStatementService()
    result = service.allocate_transaction(bank_transaction_id, allocations, operator_id)

    if result.get("error"):
        return jsonify(result), 400 # 或者 500，取决于错误类型

    return jsonify(result), 200

@bank_statement_api.route("/api/payment-records/<payment_record_id>", methods=["DELETE"])
@jwt_required()
def delete_payment_record(payment_record_id):
    """
    删除单个支付记录并反转相关的分配。
    """
    operator_id = get_jwt_identity()
    service = BankStatementService()
    result = service.delete_payment_record_and_reverse_allocation(payment_record_id, operator_id)

    if result.get("error"):
        return jsonify(result), 400

    return jsonify(result), 200

@bank_statement_api.route("/api/bank-transactions/<bank_transaction_id>/cancel-allocation", methods=["POST"])
@jwt_required()
def cancel_allocation(bank_transaction_id):
    """
    接收前端的撤销分配请求。
    """
    operator_id = get_jwt_identity()
    
    service = BankStatementService()
    result = service.cancel_allocation(bank_transaction_id, operator_id)

    if result.get("error"):
        return jsonify(result), 400

    return jsonify(result), 200