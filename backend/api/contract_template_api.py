# backend/api/contract_template_api.py
from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from backend.models import db, ContractTemplate
from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_

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
    remark = data.get("remark")

    if not template_name or not contract_type or not content:
        return jsonify({"error": "模板名称、合同类型和内容是必填项"}), 400

    try:
        new_template = ContractTemplate(
            template_name=template_name,
            contract_type=contract_type,
            content=content,
            remark=remark
        )
        db.session.add(new_template)
        db.session.commit()
        return jsonify({
            "message": "合同模板创建成功",
            "id": str(new_template.id),
            "template_name": new_template.template_name,
            "contract_type": new_template.contract_type,
            "content": new_template.content,
            "remark": new_template.remark,
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
    获取所有合同模板列表，支持搜索、筛选和分页。
    新增了 'all=true' 参数以绕过分页，返回所有结果。
    """
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    if not get_jwt_identity():
        return jsonify(msg="Missing Authorization Header"), 401

    try:
        query = ContractTemplate.query

        search_term = request.args.get('search')
        contract_type_filter = request.args.get('contract_type')
        fetch_all = request.args.get('all', 'false').lower() == 'true'

        if search_term:
            search_pattern = f"%{search_term}%"
            query = query.filter(
                or_(
                    ContractTemplate.template_name.ilike(search_pattern),
                    ContractTemplate.remark.ilike(search_pattern)
                )
            )

        if contract_type_filter:
            query = query.filter(ContractTemplate.contract_type == contract_type_filter)

        query = query.order_by(
            ContractTemplate.template_name.asc(),
            ContractTemplate.version.desc()
        )

        if fetch_all:
            templates = query.all()
            total = len(templates)
        else:
            page = request.args.get('page', 1, type=int)
            per_page = request.args.get('per_page', 10, type=int)
            pagination = query.paginate(page=page, per_page=per_page, error_out=False)
            templates = pagination.items
            total = pagination.total
        
        result = []
        for template in templates:
            result.append({
                "id": str(template.id),
                "template_name": template.template_name,
                "contract_type": template.contract_type,
                "version": template.version,
                "remark": template.remark,
                "created_at": template.created_at.isoformat(),
                "updated_at": template.updated_at.isoformat(),
            })
        return jsonify({"templates": result, "total": total}), 200
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

        from backend.models import BaseContract
        in_use = db.session.query(BaseContract).filter_by(template_id=template_id).first() is not None

        return jsonify({
            "id": str(template.id),
            "template_name": template.template_name,
            "contract_type": template.contract_type,
            "content": template.content,
            "version": template.version,
            "remark": template.remark,
            "created_at": template.created_at.isoformat(),
            "updated_at": template.updated_at.isoformat(),
            "is_in_use": in_use,
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

    from backend.models import BaseContract
    in_use = db.session.query(BaseContract).filter_by(template_id=template_id).first() is not None
    if in_use:
        return jsonify({"error": "模板已被合同使用，禁止直接覆盖保存。请使用“另存为新版”。"}), 403

    data = request.get_json()
    template_name = data.get("template_name")
    contract_type = data.get("contract_type")
    content = data.get("content")
    remark = data.get("remark")

    if not template_name and not contract_type and not content and remark is None:
        return jsonify({"error": "至少提供名称、类型、内容或备注进行更新"}), 400

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
        if remark is not None:
            template.remark = remark

        db.session.commit()
        return jsonify({
            "message": "合同模板更新成功",
            "id": str(template.id),
            "template_name": template.template_name,
            "contract_type": template.contract_type,
            "content": template.content,
            "remark": template.remark,
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
        from backend.models import BaseContract
        in_use = db.session.query(BaseContract).filter_by(template_id=template_id).first() is not None
        if in_use:
            return jsonify({"error": "模板已被合同使用，无法删除。"}), 403

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

@contract_template_bp.route("/<uuid:template_id>/save_new_version", methods=["POST", "OPTIONS"])
@jwt_required(optional=True)
def save_new_version_contract_template(template_id):
    """
    将现有合同模板另存为新版本。
    """
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    if not get_jwt_identity():
        return jsonify(msg="Missing Authorization Header"), 401

    try:
        original_template = ContractTemplate.query.get(template_id)
        if not original_template:
            return jsonify({"error": "原始合同模板未找到"}), 404

        data = request.get_json()
        content = data.get("content", original_template.content)
        remark = data.get("remark", original_template.remark)

        max_version = db.session.query(db.func.max(ContractTemplate.version)).filter(
            ContractTemplate.template_name == original_template.template_name,
            ContractTemplate.contract_type == original_template.contract_type
        ).scalar()

        new_version_number = (max_version or 0) + 1

        new_template = ContractTemplate(
            template_name=original_template.template_name,
            contract_type=original_template.contract_type,
            content=content,
            version=new_version_number,
            remark=remark
        )
        db.session.add(new_template)
        db.session.commit()

        return jsonify({
            "message": "合同模板另存为新版本成功",
            "id": str(new_template.id),
            "template_name": new_template.template_name,
            "contract_type": new_template.contract_type,
            "content": new_template.content,
            "version": new_template.version,
            "remark": new_template.remark,
            "created_at": new_template.created_at.isoformat(),
            "updated_at": new_template.updated_at.isoformat(),
        }), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"合同模板 {template_id} 另存为新版本失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500

@contract_template_bp.route("/<uuid:template_id>/diff", methods=["GET", "OPTIONS"])
@jwt_required(optional=True)
def get_contract_template_diff(template_id):
    """
    获取当前合同模板与上一版本的内容差异。
    """
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    if not get_jwt_identity():
        return jsonify(msg="Missing Authorization Header"), 401

    try:
        current_template = ContractTemplate.query.get(template_id)
        if not current_template:
            return jsonify({"error": "合同模板未找到"}), 404

        previous_template = db.session.query(ContractTemplate).filter(
            ContractTemplate.contract_type == current_template.contract_type,
            ContractTemplate.created_at < current_template.created_at
        ).order_by(ContractTemplate.created_at.desc()).first()

        if not previous_template:
            return jsonify({"error": "未找到可供对比的更早的模板"}), 404
        
        return jsonify({
            "current_version": current_template.version,
            "current_content": current_template.content,
            "previous_version": previous_template.version,
            "previous_content": previous_template.content,
            "previous_template_id": str(previous_template.id)
        }), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"获取合同模板 {template_id} 差异失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500