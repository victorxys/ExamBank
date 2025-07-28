# backend/api/permission_api.py
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt
from datetime import datetime, timedelta, time
from sqlalchemy import func
from backend.models import db, User, TrainingCourse, CourseResource, UserCourseAccess, UserResourceAccess

permission_bp = Blueprint('permission_api', __name__, url_prefix='/api/permissions')

# 辅助函数：检查管理员权限 (如果需要，可以从其他地方导入)
def admin_required(fn):
    @jwt_required()
    def wrapper(*args, **kwargs):
        claims = get_jwt()
        if claims.get('role') != 'admin': # 假设您的 JWT 中有 'role' claim
            return jsonify(msg="管理员权限不足"), 403
        return fn(*args, **kwargs)
    wrapper.__name__ = fn.__name__ # 保留原函数名，方便调试
    return wrapper

@permission_bp.route('/user/<uuid:user_id_str>', methods=['GET'])
@admin_required 
def get_user_permissions(user_id_str):
    user_id = str(user_id_str)
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    granted_course_ids = [str(uca.course_id) for uca in UserCourseAccess.query.filter_by(user_id=user_id).all()]
    
    # 获取用户已授权的资源及其有效期
    granted_resources_details = []
    resource_access_records = UserResourceAccess.query.filter_by(user_id=user_id).all()
    for ura in resource_access_records:
        granted_resources_details.append({
            'resource_id': str(ura.resource_id),
            'expires_at': ura.expires_at.isoformat() if ura.expires_at else None
        })

    return jsonify({
        'user_id': user_id,
        'granted_course_ids': granted_course_ids,
        'granted_resource_details': granted_resources_details, # 返回更详细的资源权限信息
    })

# 辅助函数计算过期时间
def calculate_expiry_date(expiry_type, custom_date_str=None):
    if expiry_type == "permanent":
        return None
    elif expiry_type == "one_week":
        # 设置为一周后的 23:59:59
        target_date = datetime.now() + timedelta(days=7)
        return datetime.combine(target_date.date(), time.max) # time.max is 23:59:59.999999
    elif expiry_type == "custom" and custom_date_str:
        try:
            # 前端应发送 YYYY-MM-DD 格式
            custom_date = datetime.strptime(custom_date_str, "%Y-%m-%d").date()
            return datetime.combine(custom_date, time.max)
        except ValueError:
            current_app.logger.warning(f"Invalid custom_expiry_date format: {custom_date_str}")
            return None # 或者抛出错误
    return None # 默认或错误情况

@permission_bp.route('/user/<uuid:user_id_str>', methods=['PUT'])
@admin_required
def update_user_permissions(user_id_str):
    user_id = str(user_id_str)
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    data = request.get_json()
    if data is None:
        return jsonify({'error': 'Request body must be JSON'}), 400

    new_granted_course_ids = set(data.get('granted_course_ids', []))
    # resource_permissions 应为 [{ resource_id: "uuid", expiry_type: "...", custom_expiry_date: "..." }]
    resource_permissions_data = data.get('resource_permissions', []) 
    
    # 将 resource_permissions_data 转换为以 resource_id 为键的字典，方便查找
    new_resource_permissions_map = {
        item['resource_id']: {
            'expiry_type': item.get('expiry_type', 'permanent'), # 默认为永久
            'custom_expiry_date': item.get('custom_expiry_date')
        } for item in resource_permissions_data if 'resource_id' in item
    }
    new_granted_resource_ids = set(new_resource_permissions_map.keys())

    try:
        # 1. 处理课程权限 (保持不变)
        UserCourseAccess.query.filter_by(user_id=user_id).filter(UserCourseAccess.course_id.notin_(new_granted_course_ids)).delete(synchronize_session=False)
        current_course_permissions = {str(uca.course_id) for uca in UserCourseAccess.query.filter_by(user_id=user_id).all()}
        for course_id_to_add in new_granted_course_ids:
            if course_id_to_add not in current_course_permissions:
                if not TrainingCourse.query.get(course_id_to_add):
                    current_app.logger.warning(f"Attempted to grant permission for non-existent course_id: {course_id_to_add}")
                    continue
                db.session.add(UserCourseAccess(user_id=user_id, course_id=course_id_to_add))

        # 2. 处理资源权限 (重点修改)
        # 删除不再授予的资源权限
        UserResourceAccess.query.filter_by(user_id=user_id).filter(UserResourceAccess.resource_id.notin_(new_granted_resource_ids)).delete(synchronize_session=False)
        
        current_resource_access_records = UserResourceAccess.query.filter_by(user_id=user_id).all()
        current_resource_permissions_map = {str(ura.resource_id): ura for ura in current_resource_access_records}

        for resource_id_str, perm_info in new_resource_permissions_map.items():
            expires_at_val = calculate_expiry_date(perm_info['expiry_type'], perm_info.get('custom_expiry_date'))
            
            if resource_id_str in current_resource_permissions_map:
                # 更新现有权限的有效期
                existing_record = current_resource_permissions_map[resource_id_str]
                if existing_record.expires_at != expires_at_val: # 仅当有效期改变时更新
                    existing_record.expires_at = expires_at_val
                    existing_record.granted_at = func.now() # 可选：更新授权时间
                    current_app.logger.info(f"Updating expiry for resource {resource_id_str} for user {user_id} to {expires_at_val}")
            else:
                # 添加新的资源权限
                resource_obj = CourseResource.query.get(resource_id_str)
                if not resource_obj:
                    current_app.logger.warning(f"Attempted to grant permission for non-existent resource_id: {resource_id_str}")
                    continue
                
                new_access = UserResourceAccess(
                    user_id=user_id,
                    resource_id=resource_id_str,
                    expires_at=expires_at_val
                )
                db.session.add(new_access)
                current_app.logger.info(f"Adding new access for resource {resource_id_str} for user {user_id}, expires_at: {expires_at_val}")
        
        db.session.commit()
        return jsonify({'message': 'User permissions updated successfully'})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error updating permissions for user {user_id}: {e}", exc_info=True)
        return jsonify({'error': f'Failed to update permissions: {str(e)}'}), 500


# --- 获取所有课程和其下的资源，用于权限配置界面 ---
@permission_bp.route('/all-courses-with-resources', methods=['GET'])
@admin_required
def get_all_courses_with_resources_for_permission_setting():
    try:
        courses = TrainingCourse.query.order_by(TrainingCourse.course_name).all()
        result = []
        for course in courses:
            course_data = {
                'id': str(course.id),
                'name': course.course_name,
                'resources': []
            }
            # 获取该课程下的所有资源 (这里可以考虑只获取ID和名称，或者更多信息)
            resources = CourseResource.query.filter_by(course_id=course.id).order_by(CourseResource.sort_order, CourseResource.name).all()
            for resource in resources:
                course_data['resources'].append({
                    'id': str(resource.id),
                    'name': resource.name,
                    'file_type': resource.file_type
                })
            result.append(course_data)
        return jsonify(result)
    except Exception as e:
        current_app.logger.error(f"Error fetching courses with resources: {e}", exc_info=True)
        return jsonify({'error': f'Failed to fetch courses with resources: {str(e)}'}), 500