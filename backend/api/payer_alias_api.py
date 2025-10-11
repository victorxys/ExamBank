# backend/api/payer_alias_api.py

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy.exc import IntegrityError

from ..models import db, PayerAlias, BaseContract

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

    # 验证合同是否存在
    contract = db.session.get(BaseContract, contract_id)
    if not contract:
        return jsonify({"error": "Contract not found."}), 404

    try:
        existing_alias = PayerAlias.query.filter_by(payer_name=payer_name).first()

        if existing_alias:
            existing_alias.contract_id = contract_id
            existing_alias.notes = notes
            existing_alias.created_by_user_id = operator_id
            message = "Payer alias updated successfully."
        else:
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
        return jsonify({"error": "Database integrity error."}), 409
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Failed to create/update payer alias: {e}",exc_info=True)
        return jsonify({"error": "Internal server error"}), 500


@payer_alias_api.route("/<string:payer_name>", methods=["DELETE"])
@jwt_required()
def delete_payer_alias(payer_name):
    """
    根据付款人姓名删除一个别名。
    """
    try:
        alias = PayerAlias.query.filter_by(payer_name=payer_name).first()
        if not alias:
            return jsonify({"error": "Alias not found."}), 404
        
        db.session.delete(alias)
        db.session.commit()
        return jsonify({"success": True, "message": "Alias deleted successfully."}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Failed to delete payer alias for {payer_name}: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500