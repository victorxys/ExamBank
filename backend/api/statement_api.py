from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from backend.models import MonthlyStatement, CustomerBill
from sqlalchemy.orm import joinedload
from backend.extensions import db  # <-- 新增
from backend.services.billing_engine import BillingEngine # <-- 新增
from decimal import Decimal, InvalidOperation # <-- 新增
from datetime import date # <-- 新增

statement_bp = Blueprint("statement_api", __name__)


@statement_bp.route("/statements", methods=["GET"])
@jwt_required()
def get_statements():
    """
    获取当前登录用户的月度结算单列表，支持分页。
    """
    current_user_id = get_jwt_identity()
    
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 10, type=int)

    # 使用 paginate 进行分页查询
    pagination = MonthlyStatement.query.filter_by(customer_id=current_user_id).order_by(
        MonthlyStatement.year.desc(), MonthlyStatement.month.desc()
    ).paginate(page=page, per_page=per_page, error_out=False)

    statements = pagination.items
    
    def serialize_statement(stmt):
        return {
            "id": stmt.id,
            "customer_id": stmt.customer_id,
            "year": stmt.year,
            "month": stmt.month,
            "total_amount": str(stmt.total_amount),
            "paid_amount": str(stmt.paid_amount),
            "status": stmt.status,
            "created_at": stmt.created_at.isoformat() if stmt.created_at else None,
            "updated_at": stmt.updated_at.isoformat() if stmt.updated_at else None,
        }

    return jsonify({
        "items": [serialize_statement(s) for s in statements],
        "total": pagination.total,
        "pages": pagination.pages,
        "page": pagination.page,
        "per_page": pagination.per_page,
        "has_next": pagination.has_next,
        "has_prev": pagination.has_prev,
    })


@statement_bp.route("/statements/<int:statement_id>", methods=["GET"])
@jwt_required()
def get_statement_detail(statement_id):
    """
    获取单个结算单的详细信息，包含其关联的所有账单。
    """
    current_user_id = get_jwt_identity()

    # 查询时同时验证用户权限，如果找不到或不属于该用户，则返回404
    statement = MonthlyStatement.query.filter_by(
        id=statement_id, customer_id=current_user_id
    ).options(
        joinedload(MonthlyStatement.bills) # 预加载关联的账单，提高效率
    ).first_or_404("结算单不存在或您没有权限查看。")

    def serialize_bill(bill):
        # 获取合同编号，用于UI显示
        contract_serial = bill.contract.contract_serial_number if bill.contract else "N/A"
        return {
            "id": bill.id,
            "contract_id": bill.contract_id,
            "contract_serial_number": contract_serial,
            "year": bill.year,
            "month": bill.month,
            "cycle_start_date": bill.cycle_start_date.isoformat() if bill.cycle_start_date else None,
            "cycle_end_date": bill.cycle_end_date.isoformat() if bill.cycle_end_date else None,
            "total_due": str(bill.total_due),
            "paid_amount": str(bill.paid_amount),
            "payment_status": bill.payment_status.value if bill.payment_status else None,
            "is_substitute_bill": bill.is_substitute_bill,
            # calculation_details 包含前端渲染明细所需的所有数据
            "calculation_details": bill.calculation_details,
        }

    # 按账单周期开始日期排序
    sorted_bills = sorted(statement.bills, key=lambda b: (b.cycle_start_date is None, b.cycle_start_date))

    return jsonify({
        "id": statement.id,
        "customer_id": statement.customer_id,
        "year": statement.year,
        "month": statement.month,
        "total_amount": str(statement.total_amount),
        "paid_amount": str(statement.paid_amount),
        "status": statement.status,
        "created_at": statement.created_at.isoformat() if statement.created_at else None,
        "updated_at": statement.updated_at.isoformat() if statement.updated_at else None,
        "bills": [serialize_bill(b) for b in sorted_bills],
    })

@statement_bp.route("/statements/<int:statement_id>/pay", methods=["POST"])
@jwt_required()
def pay_statement(statement_id):
    """
    为指定的月度结算单创建一笔支付。
    """
    current_user_id = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({"error": "请求体不能为空"}), 400

    try:
        amount = Decimal(data.get("amount"))
        if amount <= 0:
            raise ValueError("支付金额必须为正数。")
    except (InvalidOperation, ValueError, TypeError):
        return jsonify({"error": "无效的支付金额"}), 400

    payment_date_str = data.get("payment_date")
    try:
        payment_date = date.fromisoformat(payment_date_str) if payment_date_str else date.today()
    except ValueError:
        return jsonify({"error": "无效的日期格式，请使用 YYYY-MM-DD。"}), 400
        
    payment_method = data.get("method", "线上支付")
    notes = data.get("notes", f"月度结算单 {statement_id} 支付")

    engine = BillingEngine()
    try:
        engine.process_statement_payment(
            statement_id=statement_id,
            payment_amount=amount,
            payment_date=payment_date,
            payment_method=payment_method,
            notes=notes,
            operator_id=current_user_id
        )
        db.session.commit()
        return jsonify({"message": "支付成功处理"}), 200
    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 404 # 找不到结算单时返回404
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"处理结算单 {statement_id} 支付时发生未知错误: {e}", exc_info=True)
        return jsonify({"error": "处理支付时发生内部错误"}), 500