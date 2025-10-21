from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from backend.models import BankTransaction, BankTransactionStatus, TransactionDirection
from backend.services.bank_statement_service import BankStatementService
from backend.api.billing_api import delete_payment_record as delete_payment_record_from_billing # 导入目标函数
from sqlalchemy import or_, extract

bank_statement_api = Blueprint('bank_statement_api', __name__)

@bank_statement_api.route('/api/search-payable-items', methods=['GET'])
@jwt_required()
def search_payable_items_route():
    search_term = request.args.get('search', '', type=str)
    if not search_term:
        return jsonify(results=[])
    service = BankStatementService()
    results = service.search_payable_items(search_term)
    return jsonify(results)

@bank_statement_api.route('/api/outbound-transactions/categorized', methods=['GET'])
@jwt_required()
def get_categorized_outbound_transactions():
    service = BankStatementService()
    year = request.args.get('year', type=int)
    month = request.args.get('month', type=int)
    if not year or not month:
        return jsonify({"error": "Year and month are required"}), 400
    try:
        transactions = service.get_and_categorize_outbound_transactions(year, month)
        return jsonify(transactions)
    except Exception as e:
        current_app.logger.error(f"Failed to get categorized outbound transactions: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@bank_statement_api.route('/api/payable-items', methods=['GET'])
@jwt_required()
def get_payable_items_route():
    service = BankStatementService()
    year = request.args.get('year', type=int)
    month = request.args.get('month', type=int)
    
    # --- NEW: Check for payee-specific filtering ---
    payee_type = request.args.get('payee_type', type=str)
    payee_id = request.args.get('payee_id', type=str)

    if not year or not month:
        return jsonify({"error": "Year and month are required"}), 400

    try:
        if payee_type and payee_id:
            # If payee info is provided, get items for that specific payee
            items = service.get_payable_items_for_payee(payee_type, payee_id, year, month)
        else:
            # Otherwise, get all payable items for the month
            items = service.get_payable_items(year, month)
        
        return jsonify(items)
    except Exception as e:
        current_app.logger.error(f"Failed to get payable items: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@bank_statement_api.route('/api/outbound-transactions/<bank_transaction_id>/allocate', methods=['POST'])
@jwt_required()
def allocate_outbound_transaction_route(bank_transaction_id):
    data = request.get_json()
    allocations = data.get('allocations')
    operator_id = get_jwt_identity()

    if not allocations:
        return jsonify({"error": "Allocations data is required"}), 400

    service = BankStatementService()
    result = service.allocate_outbound_transaction(bank_transaction_id, allocations, operator_id)
    
    if result.get("error"):
        return jsonify(result), 400
    
    return jsonify(result), 200

@bank_statement_api.route('/api/bank-statement/unmatched-transactions', methods=['GET'])
@jwt_required()
def get_unmatched_transactions():
    service = BankStatementService()
    year = request.args.get('year', type=int)
    month = request.args.get('month', type=int)
    
    if not year or not month:
        return jsonify({"error": "Year and month are required"}), 400
        
    transactions = service.get_and_categorize_transactions(year, month)
    return jsonify(transactions)

@bank_statement_api.route('/api/bank-statement/statement', methods=['POST'])
@jwt_required()
def post_bank_statement():
    if 'statement' not in request.files:
        return jsonify({"error": "No statement file part"}), 400
    file = request.files['statement']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    try:
        service = BankStatementService()
        result = service.import_statement(file)
        return jsonify(result), 200
    except Exception as e:
        current_app.logger.error(f"Failed to process statement: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


# 为前端错误的URL /api/payment-records/ 创建一个别名路由
@bank_statement_api.route("/api/payment-records/<uuid:payment_id>", methods=["DELETE", "OPTIONS"])
@jwt_required()
def handle_delete_payment_record_alias(payment_id):
    """这是一个别名路由，用于处理前端错误的API调用，将请求转发到正确的函数。"""
    if request.method == 'OPTIONS':
        return jsonify({'status': 'ok'}), 200
    return delete_payment_record_from_billing(payment_id)

@bank_statement_api.route('/api/bank-transactions/<bank_transaction_id>/allocate', methods=['POST'])
@jwt_required()
def allocate_transaction_route(bank_transaction_id):
    data = request.get_json()
    allocations = data.get('allocations')
    operator_id = get_jwt_identity()

    if not allocations:
        return jsonify({"error": "Allocations data is required"}), 400

    service = BankStatementService()
    result = service.allocate_transaction(bank_transaction_id, allocations, operator_id)
    
    if result.get("error"):
        return jsonify(result), 400
    
    return jsonify(result), 200

@bank_statement_api.route('/api/bank-transactions/<bank_transaction_id>/cancel-allocation', methods=['POST'])
@jwt_required()
def cancel_allocation_route(bank_transaction_id):
    operator_id = get_jwt_identity()
    service = BankStatementService()
    result = service.cancel_allocation(bank_transaction_id, operator_id)
    if result.get("error"):
        return jsonify(result), 400
    return jsonify(result), 200

@bank_statement_api.route("/api/bank-transactions/<bank_transaction_id>/ignore", methods=["POST"])
@jwt_required()
def ignore_transaction_route(bank_transaction_id):
    operator_id = get_jwt_identity()
    data = request.get_json() or {}
    remark = data.get("remark")
    is_permanent = data.get("is_permanent", False) # 从请求中读取标志
    service = BankStatementService()
    # 将标志传递给服务层
    result = service.ignore_transaction(bank_transaction_id, operator_id, remark=remark, is_permanent=is_permanent)
    if result.get("error"):
        return jsonify(result), 400
    return jsonify(result), 200

@bank_statement_api.route("/api/bank-transactions/<bank_transaction_id>/unignore", methods=["POST"])
@jwt_required()
def unignore_transaction_route(bank_transaction_id):
    operator_id = get_jwt_identity()
    service = BankStatementService()
    result = service.unignore_transaction(bank_transaction_id, operator_id)
    if result.get("error"):
        return jsonify(result), 400
    return jsonify(result), 200

@bank_statement_api.route('/api/bank-transactions', methods=['GET'])
@jwt_required()
def get_all_transactions():
    """
    获取所有银行流水记录，支持分页、按月筛选和多字段搜索。
    """
    try:
        # --- 获取查询参数 ---
        year = request.args.get('year', type=int)
        month = request.args.get('month', type=int)
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        search_term = request.args.get('search_term', '', type=str).strip()
        status = request.args.get('status', '', type=str).strip()
        direction = request.args.get('direction', '', type=str).strip()

        if not year or not month:
            return jsonify({"error": "Year and month parameters are required"}), 400

        # --- 构建基础查询 ---
        query = BankTransaction.query.filter(
            extract('year', BankTransaction.transaction_time) == year,
            extract('month', BankTransaction.transaction_time) == month
        )

        # --- 应用状态筛选 ---
        if status:
            try:
                status_enum = BankTransactionStatus(status)
                query = query.filter(BankTransaction.status == status_enum)
            except ValueError:
                return jsonify({"error": f"Invalid status value: {status}"}), 400

        # --- 应用方向筛选 ---
        if direction:
            try:
                direction_enum = TransactionDirection(direction.upper())
                query = query.filter(BankTransaction.direction == direction_enum)
            except ValueError:
                return jsonify({"error": f"Invalid direction value: {direction}"}), 400

        # --- 应用多字段搜索 ---
        if search_term:
            pinyin_search_term = search_term.replace(" ", "")
            query = query.filter(
                or_(
                    BankTransaction.transaction_id.ilike(f"%{search_term}%"),
                    BankTransaction.payer_name.ilike(f"%{search_term}%"),
                    BankTransaction.payer_name_pinyin.ilike(f"%{pinyin_search_term}%"),
                    BankTransaction.summary.ilike(f"%{search_term}%")
                )
            )

        # --- 排序和分页 ---
        query = query.order_by(BankTransaction.transaction_time.desc())
        paginated_txns = query.paginate(page=page, per_page=per_page, error_out=False)
        
        # --- 格式化返回结果 ---
        results = []
        for txn in paginated_txns.items:
            # 点击流水后，需要查看其分配详情，这里可以预先准备一些信息
            allocations = []
            if txn.status in [BankTransactionStatus.MATCHED, BankTransactionStatus.PARTIALLY_ALLOCATED]:
                for record in txn.payment_records:
                    bill = record.customer_bill
                    if bill:
                        allocations.append({
                            'customer_name': bill.contract.customer_name,
                            'employee_name': bill.contract.service_personnel.name if bill.contract.service_personnel else (bill.contract.user.username if bill.contract.user else "未知"),
                            'cycle': f"{bill.cycle_start_date.strftime('%Y-%m-%d')} to {bill.cycle_end_date.strftime('%Y-%m-%d')}",
                            'allocated_amount': str(record.amount)
                        })

            results.append({
                'id': str(txn.id),
                'transaction_id': txn.transaction_id,
                'transaction_time': txn.transaction_time.isoformat(),
                'payer_name': txn.payer_name,
                'amount': str(txn.amount),
                'summary': txn.summary,
                'status': txn.status.value,
                'direction': txn.direction.value,
                'allocated_amount': str(txn.allocated_amount),
                'allocations': allocations, # 分配详情
                'ignore_remark': txn.ignore_remark
            })

        return jsonify({
            'items': results,
            'total': paginated_txns.total,
            'page': paginated_txns.page,
            'per_page': paginated_txns.per_page,
            'pages': paginated_txns.pages,
        })

    except Exception as e:
        current_app.logger.error(f"Failed to get all transactions: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@bank_statement_api.route('/api/outbound-transactions', methods=['GET'])
@jwt_required()
def get_outbound_transactions():
    """
    获取所有对外付款的银行流水记录，使用新的序列化方法。
    """
    try:
        service = BankStatementService()
        # --- 获取查询参数 ---
        year = request.args.get('year', type=int)
        month = request.args.get('month', type=int)
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        search_term = request.args.get('search_term', '', type=str).strip()
        status = request.args.get('status', '', type=str).strip()

        if not year or not month:
            return jsonify({"error": "Year and month parameters are required"}), 400

        # --- 构建基础查询 (硬编码方向为 DEBIT) ---
        query = BankTransaction.query.filter(
            extract('year', BankTransaction.transaction_time) == year,
            extract('month', BankTransaction.transaction_time) == month,
            BankTransaction.direction == TransactionDirection.DEBIT
        )

        # --- 应用状态筛选 ---
        if status:
            try:
                status_enum = BankTransactionStatus(status)
                query = query.filter(BankTransaction.status == status_enum)
            except ValueError:
                return jsonify({"error": f"Invalid status value: {status}"}), 400

        # --- 应用多字段搜索 ---
        if search_term:
            # Simple pinyin search for payer_name
            pinyin_search_term = search_term.replace(" ", "")
            search_filter = or_(
                BankTransaction.transaction_id.ilike(f"%{search_term}%"),
                BankTransaction.payer_name.ilike(f"%{search_term}%"),
                BankTransaction.summary.ilike(f"%{search_term}%")
            )
            # Check if a related pinyin column exists before adding to query
            if hasattr(BankTransaction, 'payer_name_pinyin'):
                 search_filter.append(BankTransaction.payer_name_pinyin.ilike(f"%{pinyin_search_term}%"))
            query = query.filter(search_filter)

        # --- 排序和分页 ---
        query = query.order_by(BankTransaction.transaction_time.desc())
        paginated_txns = query.paginate(page=page, per_page=per_page, error_out=False)
        
        # --- 格式化返回结果 (使用新的 Service 方法) ---
        results = [service.serialize_transaction(txn) for txn in paginated_txns.items]

        return jsonify({
            'items': results,
            'total': paginated_txns.total,
            'page': paginated_txns.page,
            'per_page': paginated_txns.per_page,
            'pages': paginated_txns.pages,
        })

    except Exception as e:
        current_app.logger.error(f"Failed to get outbound transactions: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@bank_statement_api.route('/api/bank-statement/reconcile', methods=['POST'])
@jwt_required()
def post_pasted_statement():
    data = request.get_json()
    # 根据日志，前端发送的是一个包含 statement_lines 键的对象
    lines = data.get('statement_lines') 
    if not lines or not isinstance(lines, list):
        return jsonify({"error": "Request body must be a JSON object with a 'statement_lines' array."}), 400
    
    operator_id = get_jwt_identity()
    service = BankStatementService()
    result = service.parse_and_store_statement(lines, operator_id)
    return jsonify(result), 200