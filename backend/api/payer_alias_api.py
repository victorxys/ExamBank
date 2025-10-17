# backend/api/payer_alias_api.py

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy.exc import IntegrityError

from ..models import db, PayerAlias, BaseContract, PaymentRecord, BankTransaction, CustomerBill
from ..services.billing_engine import delete_payment_record_and_reverse_allocation

payer_alias_api = Blueprint("payer_alias_api", __name__, url_prefix="/api/payer-aliases")

@payer_alias_api.route("", methods=["POST"])
@jwt_required()
def create_payer_alias():
    """
    创建或更新一个付款人别名，将其关联到一份合同。
    """
    data = request.get_json()
    payer_name = data.get("payer_name")
    contract_id = data.get("contract_id")
    notes = data.get("notes", "")
    operator_id = get_jwt_identity()

    if not payer_name or not contract_id:
        return jsonify({"error": "payer_name and contract_id are required."}), 400

    contract = db.session.get(BaseContract, contract_id)
    if not contract:
        return jsonify({"error": "Contract not found."}), 404

    try:
        # 核心修正：使用 payer_name 和 contract_id 联合查询
        existing_alias = PayerAlias.query.filter_by(
            payer_name=payer_name,
            contract_id=contract_id
        ).first()

        if existing_alias:
            # 如果这个精确的关联已存在，可以选择更新备注
            existing_alias.notes = notes
            existing_alias.created_by_user_id = operator_id
            message = "Payer alias already exists, notes updated."
        else:
            # 如果不存在，则创建新的关联记录
            new_alias = PayerAlias(
                payer_name=payer_name,
                contract_id=contract_id,
                notes=notes,
                created_by_user_id=operator_id
            )
            db.session.add(new_alias)
            message = "Payer alias created successfully."

        db.session.commit()
        return jsonify({"success": True, "message": message}), 201

    except IntegrityError:
        db.session.rollback()
        # 这个错误现在只应该在极端的并发情况下发生
        return jsonify({"error": "Database integrity error, likely a race condition."}), 409
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Failed to create/update payer alias: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500


@payer_alias_api.route("/<string:payer_name>", methods=["DELETE"])
@jwt_required()
def delete_payer_alias(payer_name):
    """
    根据付款人姓名删除一个别名。
    如果有关联的付款，会根据 `delete_payments` 参数决定行为。
    """
    delete_payments = request.args.get('delete_payments', 'false').lower() == 'true'

    try:
        # 注意：此接口现在会删除该付款人名下的所有别名关系
        # 如果未来需要精确删除某个特定合同的别名，需要修改此接口
        aliases = PayerAlias.query.filter_by(payer_name=payer_name).all()
        if not aliases:
            return jsonify({"error": "Alias not found."}), 404

        for alias in aliases:
            payments_to_delete = db.session.query(PaymentRecord).join(
                BankTransaction, PaymentRecord.bank_transaction_id == BankTransaction.id
            ).join(
                CustomerBill, PaymentRecord.customer_bill_id == CustomerBill.id
            ).filter(
                BankTransaction.payer_name == alias.payer_name,
                CustomerBill.contract_id == alias.contract_id
            ).all()

            if payments_to_delete:
                if delete_payments:
                    for payment in payments_to_delete:
                        delete_payment_record_and_reverse_allocation(payment.id)
                else:
                    return jsonify({
                        "error": "Conflict: This alias has associated payments.",
                        "message": f"Found {len(payments_to_delete)} payment(s) associated with this alias for contract {alias.contract_id}. To proceed, you must confirm the deletion of these payments."
                    }), 409

            db.session.delete(alias)

        db.session.commit()
        return jsonify({"success": True, "message": f"Successfully deleted {len(aliases)} alias(es) for '{payer_name}'."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Failed to delete payer alias for {payer_name}: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500