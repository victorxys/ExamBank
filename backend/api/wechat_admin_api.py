"""
微信关联管理API - 供管理员使用
"""
from datetime import datetime, timedelta
import uuid

from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from backend.models import Customer, CustomerWechatAccount, EmployeeWechatAccount, MiniappDebugAccess, db, ServicePersonnel, User
from sqlalchemy import or_

wechat_admin_bp = Blueprint('wechat_admin_api', __name__, url_prefix='/api/admin/wechat')


def _require_admin():
    current_user_id = get_jwt_identity()
    current_user = User.query.get(current_user_id)
    if not current_user or current_user.role != 'admin':
        return None, (jsonify({"error": "权限不足"}), 403)
    return current_user, None


def _format_datetime(value):
    return value.isoformat() if value else None


def _format_miniapp_openid_account(account, role):
    if role == "customer":
        subject = account.customer
        return {
            "id": str(account.id),
            "role": "customer",
            "role_label": "客户",
            "subject_id": str(subject.id) if subject else None,
            "name": subject.name if subject else "",
            "phone_number": subject.phone_number if subject else account.phone_number,
            "mini_openid": account.mini_openid,
            "unionid": account.unionid,
            "bind_method": account.bind_method,
            "verified_at": _format_datetime(account.verified_at),
            "last_login_at": _format_datetime(account.last_login_at),
            "created_at": _format_datetime(account.created_at),
            "updated_at": _format_datetime(account.updated_at),
        }

    subject = account.employee
    return {
        "id": str(account.id),
        "role": "employee",
        "role_label": "员工",
        "subject_id": str(subject.id) if subject else None,
        "name": subject.name if subject else "",
        "phone_number": subject.phone_number if subject else account.phone_number,
        "mini_openid": account.mini_openid,
        "unionid": account.unionid,
        "bind_method": account.bind_method,
        "verified_at": _format_datetime(account.verified_at),
        "last_login_at": _format_datetime(account.last_login_at),
        "created_at": _format_datetime(account.created_at),
        "updated_at": _format_datetime(account.updated_at),
    }


def _format_debug_access(access):
    target = None
    if access.target_type == "employee":
        target = ServicePersonnel.query.get(access.target_id)
    elif access.target_type == "customer":
        target = Customer.query.get(access.target_id)

    return {
        "id": str(access.id),
        "debugger_openid": access.debugger_openid,
        "role": access.role,
        "role_label": "员工" if access.role == "employee" else "客户",
        "target_type": access.target_type,
        "target_id": str(access.target_id),
        "target_name": target.name if target else "",
        "target_phone_number": getattr(target, "phone_number", "") if target else "",
        "reason": access.reason or "",
        "enabled": bool(access.enabled),
        "is_active": bool(access.enabled and access.expires_at and access.expires_at > datetime.now(access.expires_at.tzinfo)),
        "expires_at": _format_datetime(access.expires_at),
        "last_used_at": _format_datetime(access.last_used_at),
        "created_at": _format_datetime(access.created_at),
        "disabled_at": _format_datetime(access.disabled_at),
    }


def _miniapp_openid_matches(item, search):
    if not search:
        return True
    needle = search.lower()
    fields = [
        item.get("mini_openid"),
        item.get("unionid"),
        item.get("name"),
        item.get("phone_number"),
        item.get("bind_method"),
    ]
    return any(needle in str(field or "").lower() for field in fields)


@wechat_admin_bp.route('/miniapp-openids', methods=['GET'])
@jwt_required()
def get_miniapp_openid_links():
    """
    获取小程序 OpenID 身份绑定列表。
    """
    try:
        _, error_response = _require_admin()
        if error_response:
            return error_response

        page = max(request.args.get('page', 1, type=int), 1)
        per_page = min(max(request.args.get('per_page', 20, type=int), 1), 100)
        search = (request.args.get('search') or '').strip()
        role_filter = (request.args.get('role') or '').strip()

        items = []
        if role_filter in ('', 'customer'):
            customer_accounts = CustomerWechatAccount.query.join(
                CustomerWechatAccount.customer
            ).all()
            items.extend(_format_miniapp_openid_account(account, "customer") for account in customer_accounts)

        if role_filter in ('', 'employee'):
            employee_accounts = EmployeeWechatAccount.query.join(
                EmployeeWechatAccount.employee
            ).all()
            items.extend(_format_miniapp_openid_account(account, "employee") for account in employee_accounts)

        items = [item for item in items if _miniapp_openid_matches(item, search)]
        items.sort(key=lambda item: item.get("updated_at") or item.get("created_at") or "", reverse=True)

        total = len(items)
        start = (page - 1) * per_page
        end = start + per_page
        paged_items = items[start:end]
        pages = (total + per_page - 1) // per_page if total else 0

        return jsonify({
            "items": paged_items,
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": pages,
            "has_prev": page > 1,
            "has_next": page < pages,
        })
    except Exception as e:
        current_app.logger.error(f"获取小程序 OpenID 绑定列表失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500


@wechat_admin_bp.route('/miniapp-debug-access', methods=['GET'])
@jwt_required()
def get_miniapp_debug_access_list():
    try:
        _, error_response = _require_admin()
        if error_response:
            return error_response

        debugger_openid = (request.args.get('debugger_openid') or '').strip()
        target_id = (request.args.get('target_id') or '').strip()
        role_filter = (request.args.get('role') or '').strip()
        include_disabled = request.args.get('include_disabled', 'false').lower() == 'true'

        query = MiniappDebugAccess.query
        if debugger_openid:
            query = query.filter(MiniappDebugAccess.debugger_openid == debugger_openid)
        if target_id:
            try:
                query = query.filter(MiniappDebugAccess.target_id == uuid.UUID(target_id))
            except ValueError:
                return jsonify({"error": "target_id 格式不正确"}), 400
        if role_filter in ("employee", "customer"):
            query = query.filter(MiniappDebugAccess.role == role_filter)
        if not include_disabled:
            query = query.filter(MiniappDebugAccess.enabled.is_(True))

        access_list = query.order_by(MiniappDebugAccess.created_at.desc()).limit(200).all()
        return jsonify({"items": [_format_debug_access(access) for access in access_list]})
    except Exception as e:
        current_app.logger.error(f"获取小程序调试授权失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500


@wechat_admin_bp.route('/miniapp-debug-access', methods=['POST'])
@jwt_required()
def create_miniapp_debug_access():
    try:
        current_user, error_response = _require_admin()
        if error_response:
            return error_response

        data = request.get_json(silent=True) or {}
        debugger_openid = (data.get("debugger_openid") or "").strip()
        role = (data.get("role") or "").strip()
        target_id = (data.get("target_id") or "").strip()
        reason = (data.get("reason") or "").strip()
        expires_in_minutes = int(data.get("expires_in_minutes") or 120)

        if not debugger_openid:
            return jsonify({"error": "调试人员 OpenID 不能为空"}), 400
        if role not in ("employee", "customer"):
            return jsonify({"error": "角色必须是 employee 或 customer"}), 400
        if expires_in_minutes < 5 or expires_in_minutes > 24 * 60:
            return jsonify({"error": "授权时长需在 5 分钟到 24 小时之间"}), 400

        try:
            target_uuid = uuid.UUID(target_id)
        except (TypeError, ValueError):
            return jsonify({"error": "目标ID格式不正确"}), 400

        if role == "employee":
            target = ServicePersonnel.query.get(target_uuid)
            target_type = "employee"
        else:
            target = Customer.query.get(target_uuid)
            target_type = "customer"
        if not target:
            return jsonify({"error": "目标人员不存在"}), 404

        access = MiniappDebugAccess(
            debugger_openid=debugger_openid,
            role=role,
            target_type=target_type,
            target_id=target_uuid,
            reason=reason,
            expires_at=datetime.now() + timedelta(minutes=expires_in_minutes),
            created_by=current_user.id,
        )
        db.session.add(access)
        db.session.commit()

        current_app.logger.info(
            "管理员 %s 创建小程序临时调试授权 openid=%s role=%s target=%s:%s expires=%s",
            current_user.username,
            debugger_openid,
            role,
            target_type,
            target_uuid,
            access.expires_at,
        )
        return jsonify({"message": "临时调试授权已创建", "item": _format_debug_access(access)})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"创建小程序调试授权失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500


@wechat_admin_bp.route('/miniapp-debug-access/<access_id>', methods=['DELETE'])
@jwt_required()
def disable_miniapp_debug_access(access_id):
    try:
        current_user, error_response = _require_admin()
        if error_response:
            return error_response

        access = MiniappDebugAccess.query.get(access_id)
        if not access:
            return jsonify({"error": "调试授权不存在"}), 404

        access.enabled = False
        access.disabled_at = datetime.now()
        access.disabled_by = current_user.id
        db.session.commit()
        return jsonify({"message": "临时调试授权已停用", "item": _format_debug_access(access)})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"停用小程序调试授权失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500


@wechat_admin_bp.route('/miniapp-openids/<role>/<account_id>', methods=['DELETE'])
@jwt_required()
def remove_miniapp_openid_link(role, account_id):
    """
    解绑小程序 OpenID 身份绑定，不删除合同/考勤访问与历史签署记录。
    """
    try:
        current_user, error_response = _require_admin()
        if error_response:
            return error_response

        if role == "customer":
            account = CustomerWechatAccount.query.get(account_id)
        elif role == "employee":
            account = EmployeeWechatAccount.query.get(account_id)
        else:
            return jsonify({"error": "不支持的角色类型"}), 400

        if not account:
            return jsonify({"error": "绑定记录不存在"}), 404

        account_info = _format_miniapp_openid_account(account, role)
        db.session.delete(account)
        db.session.commit()

        current_app.logger.info(
            "管理员 %s 解绑小程序 OpenID 身份绑定 role=%s account_id=%s openid=%s subject=%s",
            current_user.username,
            role,
            account_id,
            account_info.get("mini_openid"),
            account_info.get("name"),
        )

        return jsonify({
            "message": "小程序 OpenID 身份绑定已解绑",
            "removed": account_info,
        })
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"解绑小程序 OpenID 绑定失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

@wechat_admin_bp.route('/employee-links', methods=['GET'])
@jwt_required()
def get_employee_wechat_links():
    """
    获取员工微信关联列表
    """
    try:
        # 检查管理员权限
        _, error_response = _require_admin()
        if error_response:
            return error_response
        
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
