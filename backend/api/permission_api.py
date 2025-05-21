# backend/api/permission_api.py
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
import uuid

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

    # 获取用户已授权的课程ID
    granted_course_ids = [str(uca.course_id) for uca in UserCourseAccess.query.filter_by(user_id=user_id).all()]
    
    # 获取用户已授权的资源ID
    granted_resource_ids = [str(ura.resource_id) for ura in UserResourceAccess.query.filter_by(user_id=user_id).all()]

    return jsonify({
        'user_id': user_id,
        'granted_course_ids': granted_course_ids,
        'granted_resource_ids': granted_resource_ids
    })

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
    new_granted_resource_ids = set(data.get('granted_resource_ids', []))

    try:
        # 1. 处理课程权限
        # 删除不再授予的课程权限
        UserCourseAccess.query.filter_by(user_id=user_id).filter(UserCourseAccess.course_id.notin_(new_granted_course_ids)).delete(synchronize_session=False)
        
        # 添加新的课程权限
        current_course_permissions = {str(uca.course_id) for uca in UserCourseAccess.query.filter_by(user_id=user_id).all()}
        for course_id_to_add in new_granted_course_ids:
            if course_id_to_add not in current_course_permissions:
                # 验证课程是否存在
                if not TrainingCourse.query.get(course_id_to_add):
                    current_app.logger.warning(f"Attempted to grant permission for non-existent course_id: {course_id_to_add}")
                    continue # 跳过不存在的课程
                db.session.add(UserCourseAccess(user_id=user_id, course_id=course_id_to_add))

        # 2. 处理资源权限 (类似课程权限)
        UserResourceAccess.query.filter_by(user_id=user_id).filter(UserResourceAccess.resource_id.notin_(new_granted_resource_ids)).delete(synchronize_session=False)
        
        current_resource_permissions = {str(ura.resource_id) for ura in UserResourceAccess.query.filter_by(user_id=user_id).all()}
        for resource_id_to_add in new_granted_resource_ids:
            if resource_id_to_add not in current_resource_permissions:
                # 验证资源是否存在
                if not CourseResource.query.get(resource_id_to_add):
                    current_app.logger.warning(f"Attempted to grant permission for non-existent resource_id: {resource_id_to_add}")
                    continue
                db.session.add(UserResourceAccess(user_id=user_id, resource_id=resource_id_to_add))
        
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