"""
微信关联管理API - 供管理员使用
"""
from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from backend.models import db, ServicePersonnel, User
from sqlalchemy import or_

wechat_admin_bp = Blueprint('wechat_admin_api', __name__, url_prefix='/api/admin/wechat')

@wechat_admin_bp.route('/employee-links', methods=['GET'])
@jwt_required()
def get_employee_wechat_links():
    """
    获取员工微信关联列表
    """
    try:
        # 检查管理员权限
        current_user_id = get_jwt_identity()
        current_user = User.query.get(current_user_id)
        if not current_user or current_user.role != 'admin':
            return jsonify({"error": "权限不足"}), 403
        
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        search = request.args.get('search', '')
        
        # 构建查询
        query = ServicePersonnel.query
        
        if search:
            query = query.filter(
                or_(
                    ServicePersonnel.name.ilike(f'%{search}%'),
                    ServicePersonnel.phone_number.ilike(f'%{search}%'),
                    ServicePersonnel.wechat_openid.ilike(f'%{search}%')
                )
            )
        
        # 分页查询
        pagination = query.order_by(ServicePersonnel.created_at.desc()).paginate(
            page=page, per_page=per_page, error_out=False
        )
        
        employees = []
        for emp in pagination.items:
            employees.append({
                "id": str(emp.id),
                "name": emp.name,
                "phone_number": emp.phone_number,
                "id_card_number": emp.id_card_number,
                "wechat_openid": emp.wechat_openid,
                "is_active": emp.is_active,
                "has_wechat": bool(emp.wechat_openid),
                "created_at": emp.created_at.isoformat() if emp.created_at else None,
                "updated_at": emp.updated_at.isoformat() if emp.updated_at else None
            })
        
        return jsonify({
            "employees": employees,
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": pagination.total,
                "pages": pagination.pages,
                "has_prev": pagination.has_prev,
                "has_next": pagination.has_next
            }
        })
        
    except Exception as e:
        current_app.logger.error(f"获取员工微信关联列表失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

@wechat_admin_bp.route('/employee-links/<employee_id>', methods=['DELETE'])
@jwt_required()
def remove_employee_wechat_link(employee_id):
    """
    解除员工微信关联
    """
    try:
        # 检查管理员权限
        current_user_id = get_jwt_identity()
        current_user = User.query.get(current_user_id)
        if not current_user or current_user.role != 'admin':
            return jsonify({"error": "权限不足"}), 403
        
        employee = ServicePersonnel.query.get(employee_id)
        if not employee:
            return jsonify({"error": "员工不存在"}), 404
        
        if not employee.wechat_openid:
            return jsonify({"error": "该员工未关联微信账号"}), 400
        
        old_openid = employee.wechat_openid
        employee.wechat_openid = None
        db.session.commit()
        
        current_app.logger.info(f"管理员 {current_user.username} 解除了员工 {employee.name} (ID: {employee.id}) 的微信关联 (openid: {old_openid})")
        
        return jsonify({
            "message": "微信关联已解除",
            "employee": {
                "id": str(employee.id),
                "name": employee.name,
                "phone_number": employee.phone_number
            }
        })
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"解除员工微信关联失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

@wechat_admin_bp.route('/employee-links/<employee_id>', methods=['PUT'])
@jwt_required()
def update_employee_wechat_link(employee_id):
    """
    更新员工微信关联（管理员手动关联）
    """
    try:
        # 检查管理员权限
        current_user_id = get_jwt_identity()
        current_user = User.query.get(current_user_id)
        if not current_user or current_user.role != 'admin':
            return jsonify({"error": "权限不足"}), 403
        
        data = request.get_json()
        new_openid = data.get('wechat_openid', '').strip()
        
        if not new_openid:
            return jsonify({"error": "微信openid不能为空"}), 400
        
        employee = ServicePersonnel.query.get(employee_id)
        if not employee:
            return jsonify({"error": "员工不存在"}), 404
        
        # 检查openid是否已被其他员工使用
        existing_employee = ServicePersonnel.query.filter(
            ServicePersonnel.wechat_openid == new_openid,
            ServicePersonnel.id != employee.id
        ).first()
        
        if existing_employee:
            return jsonify({
                "error": f"该微信账号已关联员工: {existing_employee.name}"
            }), 400
        
        old_openid = employee.wechat_openid
        employee.wechat_openid = new_openid
        db.session.commit()
        
        current_app.logger.info(f"管理员 {current_user.username} 更新了员工 {employee.name} (ID: {employee.id}) 的微信关联: {old_openid} -> {new_openid}")
        
        return jsonify({
            "message": "微信关联已更新",
            "employee": {
                "id": str(employee.id),
                "name": employee.name,
                "phone_number": employee.phone_number,
                "wechat_openid": employee.wechat_openid
            }
        })
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新员工微信关联失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

@wechat_admin_bp.route('/stats', methods=['GET'])
@jwt_required()
def get_wechat_link_stats():
    """
    获取微信关联统计信息
    """
    try:
        # 检查管理员权限
        current_user_id = get_jwt_identity()
        current_user = User.query.get(current_user_id)
        if not current_user or current_user.role != 'admin':
            return jsonify({"error": "权限不足"}), 403
        
        # 统计数据
        total_employees = ServicePersonnel.query.filter_by(is_active=True).count()
        linked_employees = ServicePersonnel.query.filter(
            ServicePersonnel.is_active == True,
            ServicePersonnel.wechat_openid.isnot(None)
        ).count()
        unlinked_employees = total_employees - linked_employees
        
        # 最近关联的员工
        recent_links = ServicePersonnel.query.filter(
            ServicePersonnel.wechat_openid.isnot(None)
        ).order_by(ServicePersonnel.updated_at.desc()).limit(5).all()
        
        recent_list = []
        for emp in recent_links:
            recent_list.append({
                "id": str(emp.id),
                "name": emp.name,
                "phone_number": emp.phone_number,
                "linked_at": emp.updated_at.isoformat() if emp.updated_at else None
            })
        
        return jsonify({
            "stats": {
                "total_employees": total_employees,
                "linked_employees": linked_employees,
                "unlinked_employees": unlinked_employees,
                "link_rate": round(linked_employees / total_employees * 100, 2) if total_employees > 0 else 0
            },
            "recent_links": recent_list
        })
        
    except Exception as e:
        current_app.logger.error(f"获取微信关联统计失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500