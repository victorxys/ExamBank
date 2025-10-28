# backend/api/financial_adjustment_api.py
from flask import Blueprint, request, jsonify, current_app
from sqlalchemy.exc import IntegrityError
from ..models import db, FinancialAdjustment, AdjustmentType

financial_adjustment_api = Blueprint('financial_adjustment_api', __name__)

@financial_adjustment_api.route('/financial-adjustments', methods=['POST'])
def create_financial_adjustment():
    """
    手动创建一条财务调整记录 (e.g., 手动收款/付款).
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid input"}), 400

    required_fields = ['adjustment_type', 'amount', 'description', 'date']
    if not all(field in data for field in required_fields):
        return jsonify({"error": "Missing required fields"}), 400

    # 验证 adjustment_type
    try:
        adjustment_type = AdjustmentType[data['adjustment_type'].upper()]
    except KeyError:
        return jsonify({"error": f"Invalid adjustment_type: {data['adjustment_type']}"}), 400

    new_adjustment = FinancialAdjustment(
        adjustment_type=adjustment_type,
        amount=data['amount'],
        description=data['description'],
        date=data['date'],
        customer_bill_id=data.get('customer_bill_id'),
        employee_payroll_id=data.get('employee_payroll_id'),
        details=data.get('details'),
        payer_type=data.get('payer_type'),
        # 根据设计，手动创建的记录可以立即标记为已结算
        is_settled=data.get('is_settled', False),
        settlement_date=data.get('settlement_date'),
        settlement_details=data.get('settlement_details')
    )

    db.session.add(new_adjustment)
    try:
        db.session.commit()
    except IntegrityError as e:
        db.session.rollback()
        return jsonify({"error": "Database integrity error", "message": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "An unexpected error occurred", "message": str(e)}), 500

    return jsonify(new_adjustment.to_dict()), 201

@financial_adjustment_api.route('/financial-adjustments', methods=['GET'])
def get_financial_adjustments():
    """
    查询财务调整/流水列表.
    支持按 is_settled, customer_bill_id, employee_payroll_id, start_date, end_date 过滤.
    """
    query = FinancialAdjustment.query

    # 过滤
    if 'is_settled' in request.args:
        is_settled_val = request.args.get('is_settled', '').lower() == 'true'
        query = query.filter(FinancialAdjustment.is_settled == is_settled_val)
    
    if 'customer_bill_id' in request.args:
        query = query.filter(FinancialAdjustment.customer_bill_id == request.args['customer_bill_id'])

    if 'employee_payroll_id' in request.args:
        query = query.filter(FinancialAdjustment.employee_payroll_id == request.args['employee_payroll_id'])

    if 'start_date' in request.args:
        query = query.filter(FinancialAdjustment.date >= request.args['start_date'])

    if 'end_date' in request.args:
        query = query.filter(FinancialAdjustment.date <= request.args['end_date'])

    # 排序
    query = query.order_by(FinancialAdjustment.date.desc(), FinancialAdjustment.created_at.desc())

    adjustments = query.all()
    return jsonify([adj.to_dict() for adj in adjustments]), 200

@financial_adjustment_api.route('/financial-adjustments/<uuid:adjustment_id>', methods=['PUT'])
def update_financial_adjustment(adjustment_id):
    """
    更新财务调整记录, 主要用于标记为已结算.
    """
    adjustment = FinancialAdjustment.query.get_or_404(adjustment_id)
    data = request.get_json()

    if not data:
        return jsonify({"error": "Invalid input"}), 400

    # 主要更新结算信息
    if 'is_settled' in data:
        adjustment.is_settled = data['is_settled']
    if 'settlement_date' in data:
        adjustment.settlement_date = data['settlement_date']
    if 'settlement_details' in data:
        adjustment.settlement_details = data['settlement_details']

    # 也允许更新其他信息
    if 'description' in data:
        adjustment.description = data['description']
    if 'amount' in data:
        adjustment.amount = data['amount']
    if 'date' in data:
        adjustment.date = data['date']
    if 'payer_type' in data:
        adjustment.payer_type = data['payer_type']

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "An unexpected error occurred", "message": str(e)}), 500

    return jsonify(adjustment.to_dict()), 200

@financial_adjustment_api.route('/financial-adjustments/<uuid:adjustment_id>', methods=['DELETE'])
def delete_financial_adjustment(adjustment_id):
    """
    删除一条财务调整记录, 并确保其镜像关联项也被原子性地删除。
    """
    adjustment = FinancialAdjustment.query.get_or_404(adjustment_id)

    try:
        # 检查并删除它所镜像的原始调整项
        if adjustment.mirror_of:
            db.session.delete(adjustment.mirror_of)

        # 检查并删除它的镜像调整项
        if adjustment.mirrored_adjustment:
            db.session.delete(adjustment.mirrored_adjustment)

        # 最后删除自己
        db.session.delete(adjustment)

        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"删除财务调整项失败: {e}")
        return jsonify(error="删除失败，已回滚事务"), 500

    return jsonify(message="财务调整项及关联项已成功删除"), 200
