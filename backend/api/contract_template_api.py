# backend/api/contract_template_api.py
from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from backend.models import db, ContractTemplate
from sqlalchemy.exc import IntegrityError

contract_template_bp = Blueprint("contract_template_api", __name__, url_prefix="/api/contract_templates")

@contract_template_bp.route("", methods=["POST", "OPTIONS"])
@jwt_required(optional=True)
def create_contract_template():
    """
    创建新的合同模板。
    """
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    if not get_jwt_identity():
        return jsonify(msg="Missing Authorization Header"), 401

    data = request.get_json()
    template_name = data.get("template_name")
    contract_type = data.get("contract_type")
    content = data.get("content")

    if not template_name or not contract_type or not content:
        return jsonify({"error": "模板名称、合同类型和内容是必填项"}), 400

    try:
        new_template = ContractTemplate(
            template_name=template_name,
            contract_type=contract_type,
            content=content
        )
        db.session.add(new_template)
        db.session.commit()
        return jsonify({
            "message": "合同模板创建成功",
            "id": str(new_template.id),
            "template_name": new_template.template_name,
            "contract_type": new_template.contract_type,
            "content": new_template.content,
            "created_at": new_template.created_at.isoformat(),
            "updated_at": new_template.updated_at.isoformat(),
        }), 201
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "模板名称已存在"}), 409
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"创建合同模板失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500


@contract_template_bp.route("", methods=["GET", "OPTIONS"])
@jwt_required(optional=True)
def get_all_contract_templates():
    """
    获取所有合同模板列表。
    """
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    if not get_jwt_identity():
        return jsonify(msg="Missing Authorization Header"), 401

    try:
        templates = ContractTemplate.query.order_by(ContractTemplate.template_name).all()
        result = []
        for template in templates:
            result.append({
                "id": str(template.id),
                "template_name": template.template_name,
                "contract_type": template.contract_type,
                "content": template.content,
                "version": template.version,
                "created_at": template.created_at.isoformat(),
                "updated_at": template.updated_at.isoformat(),
            })
        return jsonify(result), 200
    except Exception as e:
        current_app.logger.error(f"获取合同模板列表失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500

@contract_template_bp.route("/<uuid:template_id>", methods=["GET", "OPTIONS"])
@jwt_required(optional=True)
def get_contract_template(template_id):
    """
    根据ID获取单个合同模板。
    """
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    if not get_jwt_identity():
        return jsonify(msg="Missing Authorization Header"), 401

    try:
        template = ContractTemplate.query.get(template_id)
        if not template:
            return jsonify({"error": "合同模板未找到"}), 404
        return jsonify({
            "id": str(template.id),
            "template_name": template.template_name,
            "content": template.content,
            "created_at": template.created_at.isoformat(),
            "updated_at": template.updated_at.isoformat(),
        }), 200
    except Exception as e:
        current_app.logger.error(f"获取合同模板 {template_id} 失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500

@contract_template_bp.route("/<uuid:template_id>", methods=["PUT", "OPTIONS"])
@jwt_required(optional=True)
def update_contract_template(template_id):
    """
    更新现有合同模板。
    """
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    if not get_jwt_identity():
        return jsonify(msg="Missing Authorization Header"), 401

    data = request.get_json()
    template_name = data.get("template_name")
    contract_type = data.get("contract_type")
    content = data.get("content")

    if not template_name and not contract_type and not content:
        return jsonify({"error": "至少提供名称、类型或内容进行更新"}), 400

    try:
        template = ContractTemplate.query.get(template_id)
        if not template:
            return jsonify({"error": "合同模板未找到"}), 404

        if template_name:
            template.template_name = template_name
        if contract_type:
            template.contract_type = contract_type
        if content:
            template.content = content

        db.session.commit()
        return jsonify({
            "message": "合同模板更新成功",
            "id": str(template.id),
            "template_name": template.template_name,
            "contract_type": template.contract_type,
            "content": template.content,
            "created_at": template.created_at.isoformat(),
            "updated_at": template.updated_at.isoformat(),
        }), 200
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "模板名称已存在"}), 409
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新合同模板 {template_id} 失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500

@contract_template_bp.route("/<uuid:template_id>", methods=["DELETE", "OPTIONS"])
@jwt_required(optional=True)
def delete_contract_template(template_id):
    """
    删除合同模板。
    """
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    if not get_jwt_identity():
        return jsonify(msg="Missing Authorization Header"), 401

    try:
        template = ContractTemplate.query.get(template_id)
        if not template:
            return jsonify({"error": "合同模板未找到"}), 404
        
        db.session.delete(template)
        db.session.commit()
        return jsonify({"message": "合同模板删除成功"}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"删除合同模板 {template_id} 失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500
