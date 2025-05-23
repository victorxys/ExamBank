# backend/api/course_resource_api.py
import os
import uuid
import re
from flask import (
    Blueprint, request, jsonify, current_app,
    send_from_directory, Response, stream_with_context
)
from werkzeug.exceptions import NotFound # 可以用来抛出标准的404
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt, decode_token, verify_jwt_in_request
from jwt import PyJWTError # 用于捕获 decode_token 可能的错误

from werkzeug.utils import secure_filename
from datetime import datetime
from sqlalchemy.exc import IntegrityError # <<<--- 新增：导入 IntegrityError
from sqlalchemy import func, or_


# 从 backend.models 导入所有需要的模型
from backend.models import (
    db, CourseResource, TrainingCourse, User,
    UserCourseAccess, UserResourceAccess, UserResourcePlayLog # <<<--- 确保这些都导入了
)
from sqlalchemy.dialects import postgresql # 用于编译为特定方言的SQL

course_resource_bp = Blueprint('course_resource_api', __name__, url_prefix='/api')

# --- 确保这些常量和辅助函数存在 ---
INSTANCE_FOLDER_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'instance'))
UPLOAD_FOLDER_RELATIVE = 'uploads/course_resources'
UPLOAD_FOLDER_ABSOLUTE = os.path.join(INSTANCE_FOLDER_PATH, UPLOAD_FOLDER_RELATIVE)

ALLOWED_EXTENSIONS = {'mp4', 'mov', 'webm', 'mp3', 'wav', 'ogg', 'pdf', 'doc', 'docx', 'ppt', 'pptx'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_file_type_from_extension(filename):
    ext = filename.rsplit('.', 1)[1].lower()
    if ext in ['mp4', 'mov', 'webm', 'avi', 'mkv']:
        return 'video'
    elif ext in ['mp3', 'wav', 'ogg', 'aac', 'flac']:
        return 'audio'
    elif ext in ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'xls', 'xlsx']:
        return 'document'
    return 'other'

# --- 权限检查辅助函数 (如果还没添加，请添加) ---
def check_resource_access(user_id, resource_id):
    # print(f"DATABASE QUERY in check_resource_access for user {user_id} and resource {resource_id}")
    query_obj = UserResourceAccess.query.filter(
        UserResourceAccess.user_id == user_id,
        UserResourceAccess.resource_id == resource_id,
        or_( # <<<--- 新增 OR 条件
            UserResourceAccess.expires_at == None, # 永久有效
            UserResourceAccess.expires_at >= datetime.now(UserResourceAccess.expires_at.type.timezone_convert_expressions[0].type.timezone if hasattr(UserResourceAccess.expires_at.type, 'timezone_convert_expressions') and UserResourceAccess.expires_at.type.timezone_convert_expressions else None) # 确保比较时区一致性
        )
    )
    # 为了更清晰地调试时区问题，可以这样写：
    # now_in_utc = datetime.now(timezone.utc) # 如果你的 expires_at 存储的是 UTC
    # query_obj = UserResourceAccess.query.filter(
    #     UserResourceAccess.user_id == user_id,
    #     UserResourceAccess.resource_id == resource_id,
    #     or_(
    #         UserResourceAccess.expires_at == None,
    #         UserResourceAccess.expires_at >= now_in_utc
    #     )
    # )
    # print(f"SQL for check_resource_access: {str(query_obj.statement.compile(dialect=postgresql.dialect(), compile_kwargs={'literal_binds': True}))}")
    result = query_obj.first()
    # print(f"DB Result for direct resource access: {result}")
    return result is not None

def check_course_access_for_resource(user_id, resource):
    if not resource or not resource.course_id:
        return False
    return UserCourseAccess.query.filter_by(user_id=user_id, course_id=str(resource.course_id)).first() is not None
# --- 结束权限检查辅助函数 ---

# ======================================================================
# === 以下是您可能已有的资源管理接口 (上传、列表、详情、更新、删除) ===
# === 请确保它们存在并且功能正常。                         ===
# ======================================================================

@course_resource_bp.route('/courses/<uuid:course_id_str>/resources', methods=['POST'])
@jwt_required()
def upload_course_resource(course_id_str):
    course_id = str(course_id_str)
    current_user_id = get_jwt_identity()

    if 'file' not in request.files:
        return jsonify({'error': 'No file part in the request'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        course = TrainingCourse.query.get(course_id)
        if not course:
            return jsonify({'error': 'Course not found'}), 404

        course_upload_folder_relative = os.path.join(UPLOAD_FOLDER_RELATIVE, course_id)
        course_upload_folder_absolute = os.path.join(INSTANCE_FOLDER_PATH, course_upload_folder_relative)
        os.makedirs(course_upload_folder_absolute, exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
        unique_filename = f"{timestamp}_{filename}"
        file_save_path_absolute = os.path.join(course_upload_folder_absolute, unique_filename)
        file_save_path_relative_to_instance = os.path.join(course_upload_folder_relative, unique_filename)

        try:
            file.save(file_save_path_absolute)
            file_size = os.path.getsize(file_save_path_absolute)
            file_main_type = get_file_type_from_extension(filename)
            mime_type = file.mimetype
            duration = None # TODO: Implement duration extraction

            new_resource = CourseResource(
                course_id=course_id,
                name=request.form.get('name', filename.split('.')[0]),
                description=request.form.get('description'),
                file_path=file_save_path_relative_to_instance, # 指向新上传的文件
                file_type=file_main_type,
                mime_type=mime_type,
                size_bytes=file_size,
                duration_seconds=duration,
                uploaded_by_user_id=current_user_id,
                sort_order=int(request.form.get('sort_order', 0))
                # 移除了 share_slug 和 is_latest_for_slug
            )
            db.session.add(new_resource)
            db.session.commit()
            return jsonify({'message': 'File uploaded successfully', 'resource': new_resource.to_dict()}), 201
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Error saving file or db record: {e}", exc_info=True)
            if os.path.exists(file_save_path_absolute):
                try: os.remove(file_save_path_absolute)
                except OSError as e_remove: current_app.logger.error(f"Failed to remove file: {e_remove}")
            return jsonify({'error': f'Failed to upload file: {str(e)}'}), 500
    return jsonify({'error': 'File type not allowed'}), 400


# backend/api/course_resource_api.py
@course_resource_bp.route('/courses/<uuid:course_id_str>/resources', methods=['GET'])
@jwt_required()
def get_course_resources(course_id_str):
    course_id = str(course_id_str)
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user: return jsonify({'error': 'User not found'}), 401
    
    is_admin = (get_jwt().get('role') == 'admin')

    course = TrainingCourse.query.get(course_id)
    if not course:
        return jsonify({'error': 'Course not found'}), 404

    if is_admin:
        # 管理员可以看到该课程下的所有资源
        resources = CourseResource.query.filter_by(course_id=course_id)\
            .order_by(CourseResource.sort_order, CourseResource.created_at).all()
        return jsonify([res.to_dict(include_uploader=True) for res in resources])
    else:
        # 普通用户：
        # 1. 首先检查用户是否至少有权“接触”到这个课程（或者说，这个课程是否应该出现在他的视野里）
        #    这可以通过 UserCourseAccess 或者其下是否有任何一个授权资源来判断。
        #    如果一个用户对课程A没有任何形式的授权（既没有课程级授权，也没有任何一个课程A下资源的授权），
        #    那么他请求课程A的资源列表时，应该直接返回 403。
        
        has_any_access_to_course_context = UserCourseAccess.query.filter_by(
            user_id=current_user_id, course_id=course_id
        ).first() is not None

        # 2. 获取用户在该课程下被明确授权的资源ID列表
        granted_resource_ids_query = db.session.query(UserResourceAccess.resource_id)\
            .join(CourseResource, UserResourceAccess.resource_id == CourseResource.id)\
            .filter(UserResourceAccess.user_id == current_user_id, CourseResource.course_id == course_id)
        
        granted_resource_ids = [str(row[0]) for row in granted_resource_ids_query.all()]

        if not has_any_access_to_course_context and not granted_resource_ids:
            # 如果既没有课程级访问权限，也没有任何该课程下的资源访问权限，则拒绝
            current_app.logger.info(f"User {current_user_id} has no access whatsoever to course {course_id} or its resources.")
            return jsonify({'error': 'Access denied to this course and its resources'}), 403

        # 即使有课程权限 (has_any_access_to_course_context is True)，也只返回 granted_resource_ids 中的资源。
        # 如果 granted_resource_ids 为空，意味着虽然他可能在“我的课程”里看到这个课程，但课程下没有他能看的具体资源。
        if not granted_resource_ids:
            current_app.logger.info(f"User {current_user_id} has access to course {course_id} context, but no specific resources are granted to them under this course.")
            return jsonify([]) # 返回空列表

        # 根据授权的资源ID列表获取资源
        resources = CourseResource.query.filter(
            CourseResource.id.in_(granted_resource_ids) # 确保 CourseResource.id 也是 UUID 类型进行比较
        ).order_by(CourseResource.sort_order, CourseResource.created_at).all()
        
        return jsonify([res.to_dict(include_uploader=True) for res in resources])


@course_resource_bp.route('/resources/<uuid:resource_id_str>', methods=['GET'])
@jwt_required()
def get_course_resource_detail(resource_id_str):
    # ... 您的获取单个资源详情的代码，确保加入了权限校验 ...
    # (参考上一条回复中的 get_course_resource_detail 实现)
    resource_id = str(resource_id_str)
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    is_admin = (get_jwt().get('role') == 'admin')

    resource = CourseResource.query.get(resource_id)
    if not resource:
        return jsonify({'error': 'Resource not found'}), 404

    can_access = False
    # if is_admin or check_resource_access(current_user_id, resource_id) or check_course_access_for_resource(current_user_id, resource):
    if is_admin or check_resource_access(current_user_id, resource_id):
        can_access = True
    
    if not can_access:
        return jsonify({'error': '没有权限访问此课程，请联系管理员开通或学习此课程。'}), 403
           
    return jsonify(resource.to_dict(include_uploader=True))

# ... (您现有的 update_course_resource 和 delete_course_resource 接口，也确保有权限校验)
@course_resource_bp.route('/resources/<uuid:resource_id_str>', methods=['PUT'])
@jwt_required()
def update_course_resource(resource_id_str):
    resource_id = str(resource_id_str)
    # --- 权限校验逻辑 ---
    current_user_id_uuid = uuid.UUID(get_jwt_identity()) # 确保是UUID对象
    user = User.query.get(current_user_id_uuid)
    if not user: return jsonify({'error': 'User not found for token'}), 401
    is_admin = (get_jwt().get('role') == 'admin')
    
    resource = CourseResource.query.get(resource_id)
    if not resource:
        return jsonify({'error': 'Resource not found'}), 404

    can_manage = False
    if is_admin:
        can_manage = True
    # else: # 也可以添加非管理员但有特定课程管理权限的逻辑
    #     if check_course_access_for_resource(current_user_id_uuid, resource): # 假设有课程权限即可编辑资源
    #         can_manage = True
    
    if not can_manage: # 简化：只有管理员可以编辑
        current_app.logger.warning(f"User {current_user_id_uuid} denied access to update resource {resource_id}")
        return jsonify({'error': 'Access denied to update this resource'}), 403
    # --- 权限校验结束 ---
    
    # multipart/form-data 请求，非文件字段在 request.form 中
    # 文件字段在 request.files 中
    data_name = request.form.get('name')
    data_description = request.form.get('description')
    data_sort_order = request.form.get('sort_order')
    new_file = request.files.get('file') # 获取名为 'file' 的上传文件

    try:
        if data_name is not None: resource.name = data_name.strip()
        if data_description is not None: resource.description = data_description.strip()
        if data_sort_order is not None:
            try:
                resource.sort_order = int(data_sort_order)
            except ValueError:
                return jsonify({'error': 'Sort order must be an integer'}), 400


        if new_file and allowed_file(new_file.filename):
            current_app.logger.info(f"Updating resource {resource.id} with new file: {new_file.filename}")
            
            old_file_path_absolute = None
            if resource.file_path:
                old_file_path_absolute = os.path.join(INSTANCE_FOLDER_PATH, resource.file_path)
                if os.path.exists(old_file_path_absolute):
                    try:
                        os.remove(old_file_path_absolute)
                        current_app.logger.info(f"Old file deleted: {old_file_path_absolute}")
                    except OSError as e_remove:
                        current_app.logger.error(f"Failed to delete old file {old_file_path_absolute}: {e_remove}")
                        # 不中断，继续尝试保存新文件
                else:
                    current_app.logger.warning(f"Old file path for resource {resource.id} not found: {old_file_path_absolute}")

            filename = secure_filename(new_file.filename)
            course_upload_folder_relative = os.path.join(UPLOAD_FOLDER_RELATIVE, str(resource.course_id))
            course_upload_folder_absolute = os.path.join(INSTANCE_FOLDER_PATH, course_upload_folder_relative)
            os.makedirs(course_upload_folder_absolute, exist_ok=True)
            
            timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
            unique_filename = f"{timestamp}_{filename}"
            new_file_save_path_absolute = os.path.join(course_upload_folder_absolute, unique_filename)
            new_file_save_path_relative_to_instance = os.path.join(course_upload_folder_relative, unique_filename)
            
            new_file.save(new_file_save_path_absolute)
            current_app.logger.info(f"New file saved to: {new_file_save_path_absolute}")

            resource.file_path = new_file_save_path_relative_to_instance
            resource.mime_type = new_file.mimetype
            resource.size_bytes = os.path.getsize(new_file_save_path_absolute)
            resource.file_type = get_file_type_from_extension(filename)
            # resource.duration_seconds = ... 
            resource.updated_at = func.now()
        
        elif new_file and not allowed_file(new_file.filename):
             return jsonify({'error': 'New file type not allowed'}), 400

        db.session.commit()
        return jsonify({'message': 'Resource updated successfully', 'resource': resource.to_dict(include_uploader=True)})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error updating resource {resource_id}: {e}", exc_info=True)
        if 'new_file_save_path_absolute' in locals() and os.path.exists(new_file_save_path_absolute):
            try: os.remove(new_file_save_path_absolute)
            except OSError: pass
        return jsonify({'error': f'Failed to update resource: {str(e)}'}), 500

@course_resource_bp.route('/resources/<uuid:resource_id_str>', methods=['DELETE'])
@jwt_required() # 通常需要权限
def delete_course_resource(resource_id_str):
    resource_id = str(resource_id_str)
    #) # 或者 resource_id_uuid = resource_id_str 如果路由转换了
    # --- 权限 --- 新增：获取当前用户信息和角色 ---
    can_access = False
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user: return jsonify({'error': 'User not found for token'}), 401
    is_admin = (get_jwt().get('role') == 'admin')
    
    if is_admin:
        can_access = True
    else:
        if check_resource_access(current_user_id, resource_id):
            can_access = True
        elif check_course_access_for_resource(current_user_id, resource):
            can_access = True
    
    if not can_access:
        current_app.logger.warning(f"User {current_user_id} denied access to stream resource {resource_id}")
        return jsonify({'error': 'Access denied to this resource'}), 403
    # --- 权限校验结束 ---
    
    resource = CourseResource.query.get(resource_id)
    if not resource:
        return jsonify({'error': 'Resource not found'}), 404

    file_path_to_delete_absolute = os.path.join(INSTANCE_FOLDER_PATH, resource.file_path)

    try:
        db.session.delete(resource)
        db.session.commit()
        
        # 删除物理文件
        if os.path.exists(file_path_to_delete_absolute):
            try:
                os.remove(file_path_to_delete_absolute)
                current_app.logger.info(f"Successfully deleted physical file: {file_path_to_delete_absolute}")
            except OSError as e_remove:
                current_app.logger.error(f"Failed to delete physical file {file_path_to_delete_absolute} after DB record deletion: {e_remove}")
                # 即使文件删除失败，数据库记录已删除，所以仍返回成功，但记录错误
                # 或者您可以选择回滚数据库操作如果文件删除是关键的
        else:
            current_app.logger.warning(f"Physical file not found for deleted resource {resource_id}: {file_path_to_delete_absolute}")

        return jsonify({'message': 'Resource deleted successfully'}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error deleting resource {resource_id}: {e}", exc_info=True)
        return jsonify({'error': f'Failed to delete resource: {str(e)}'}), 500
# ======================================================================
# === 以下是新增的用于播放和统计的 API 接口                     ===
# ======================================================================

@course_resource_bp.route('/resources/<uuid:resource_id_str>/stream', methods=['GET'])
# @jwt_required() # 我们之前注释掉了这个，因为要手动处理 URL token
def stream_course_resource(resource_id_str):
    resource_id_uuid = resource_id_str

    current_user_id_from_token_str = None
    user_jwt_claims = {} # 用于存储解析后的 JWT claims

    # 1. 尝试从 Authorization header 获取并验证 Token (如果存在)
    # Flask-JWT-Extended 的 verify_jwt_in_request 会处理这个
    # 但由于我们可能依赖 URL token，这里需要更灵活
    header_token_valid = False
    try:
        # optional=True 意味着如果 Header 中没有 Token，它不会立即抛出错误
        # locations=['headers'] 只检查头部
        verify_jwt_in_request(optional=True, locations=['headers']) 
        temp_identity = get_jwt_identity() # 如果验证成功，这个会有值
        if temp_identity:
            current_user_id_from_token_str = temp_identity
            user_jwt_claims = get_jwt() # 获取完整的 claims
            header_token_valid = True
            current_app.logger.info(f"Stream: Token validated from Header for user {current_user_id_from_token_str}")
    except Exception as e_header_jwt:
        current_app.logger.info(f"Stream: No valid token in header or header validation failed: {e_header_jwt}")
        # 继续尝试 URL token

    # 2. 如果 Header 中没有有效 Token (或我们优先URL token)，尝试从 URL 参数获取
    if not header_token_valid: # 只有当 Header Token 无效或不存在时才检查 URL Token
        url_token = request.args.get('access_token', None)
        if url_token:
            current_app.logger.info(f"Stream: Attempting to validate token from URL parameter: {url_token[:20]}...")
            try:
                # 使用 decode_token 来解码和验证 URL Token
                # 这需要您的 Flask app 配置了 JWT_SECRET_KEY
                decoded_jwt = decode_token(url_token) 
                # current_app.config.get("JWT_IDENTITY_CLAIM", "sub") 通常是 'sub'
                identity_claim_key = current_app.config.get("JWT_IDENTITY_CLAIM", "sub")
                current_user_id_from_token_str = decoded_jwt.get(identity_claim_key)
                
                if not current_user_id_from_token_str:
                    current_app.logger.error(f"Stream: Token from URL is missing identity claim ('{identity_claim_key}'). Decoded: {decoded_jwt}")
                    raise PyJWTError(f"Token from URL is missing identity claim ('{identity_claim_key}').")
                
                # 对于手动解码的 Token，我们需要手动构建 user_jwt_claims
                # get_jwt() 依赖于 Flask-JWT-Extended 的上下文，这里可能没有
                # 所以直接使用 decoded_jwt 作为 user_jwt_claims
                user_jwt_claims = decoded_jwt
                
                current_app.logger.info(f"Stream: Token from URL parameter validated for user {current_user_id_from_token_str}")
            except PyJWTError as e_jwt: # 捕获 JWT 解码、签名或过期错误
                current_app.logger.error(f"Stream: Invalid or expired token from URL parameter: {e_jwt}")
                return jsonify({'error': 'Invalid or expired token from URL'}), 401
            except Exception as e_other_url_token:
                current_app.logger.error(f"Stream: Error processing token from URL: {e_other_url_token}", exc_info=True)
                return jsonify({'error': 'Error processing token from URL'}), 401
        else:
            # 如果 Header 和 URL 参数都没有 Token
            if not header_token_valid: # 再次确认 header 确实没有token
                current_app.logger.warning("Stream: No token provided in headers or URL params for stream.")
                return jsonify({'error': 'Missing Authorization for stream'}), 401
    
    # 如果 current_user_id_from_token_str 仍然是 None，说明两种方式都失败了
    if not current_user_id_from_token_str:
        current_app.logger.error("Stream: Failed to establish user identity from any token source.")
        return jsonify({'error': 'Authentication required.'}), 401

    # --- 将获取到的用户ID字符串转换为UUID ---
    try:
        current_user_id_uuid = uuid.UUID(current_user_id_from_token_str)
    except (ValueError, TypeError) as e_uuid:
        current_app.logger.error(f"Stream: Invalid UUID format for user identity '{current_user_id_from_token_str}': {e_uuid}")
        return jsonify({'error': f"Invalid user identity format in token: {current_user_id_from_token_str}"}), 400

    user = User.query.get(current_user_id_uuid)
    if not user: return jsonify({'error': 'User from token not found.'}), 401

    # current_app.logger.info(f"DEBUG Stream: Value of user_jwt_claims before checking role: {user_jwt_claims}")
    # current_app.logger.info(f"DEBUG Stream: Type of user_jwt_claims: {type(user_jwt_claims)}")
    # if isinstance(user_jwt_claims, dict):
    #     current_app.logger.info(f"DEBUG Stream: Keys in user_jwt_claims: {list(user_jwt_claims.keys())}")

    # is_admin = (get_jwt().get('role') == 'admin')
    is_admin = (user_jwt_claims.get('role') == 'admin')
    
    # role_from_claims = user_jwt_claims.get('role') if isinstance(user_jwt_claims, dict) else "user_jwt_claims_is_not_dict"
    # is_admin_result = (role_from_claims == 'admin')
    # is_admin = (role_from_claims == 'admin')

    # current_app.logger.info(f"DEBUG Stream: Role retrieved from claims: '{role_from_claims}', Is Admin: {is_admin_result}")
    # is_admin = is_admin_result # 确保 is_admin 被正确赋值



    print(f"=====current user role from token_str=====: {get_jwt().get('role')}")
    resource = CourseResource.query.get(resource_id_uuid)
    current_app.logger.info(f"Stream: User ID (UUID): {current_user_id_uuid}, Is Admin: {is_admin}")

    if not resource: return jsonify({'error': 'Resource not found'}), 404

    can_access = False
    if is_admin:
        can_access = True
        current_app.logger.info(f"Stream: Access granted via admin role.")
    else:
        direct_resource_access = check_resource_access(current_user_id_uuid, resource_id_uuid)
        current_app.logger.info(f"Stream: Result of check_resource_access: {direct_resource_access}")
        if direct_resource_access:
            can_access = True
            current_app.logger.info(f"Stream: Access granted via direct resource permission.")
        else:
            course_context_access = check_course_access_for_resource(current_user_id_uuid, resource)
            current_app.logger.info(f"Stream: Result of check_course_access_for_resource: {course_context_access}")
            if course_context_access:
                can_access = True
                current_app.logger.info(f"Stream: Access granted via course context permission.")

    if not can_access:
        current_app.logger.warning(f"Stream: Final access check DENIED for user {current_user_id_uuid} on resource {resource_id_uuid}")
        return jsonify({'error': 'Access denied to this resource stream'}), 403

    current_app.logger.info(f"Stream: Final access check GRANTED for user {current_user_id_uuid} on resource {resource_id_uuid}")
        
    # --- 3. Range 处理和流式传输逻辑 (与之前提供的版本一致) ---
    file_absolute_path = os.path.join(INSTANCE_FOLDER_PATH, resource.file_path)
    if not os.path.exists(file_absolute_path):
        current_app.logger.error(f"Stream: File not found on server: {file_absolute_path}")
        return jsonify({'error': 'File not found on server'}), 404
    
    file_size = resource.size_bytes or os.path.getsize(file_absolute_path)
    range_header = request.headers.get('Range', None)
    
    start = 0
    end = file_size - 1 
    status_code = 200
    content_length = file_size
    headers = {
        'Content-Type': resource.mime_type or 'application/octet-stream',
        'Content-Disposition': f'inline; filename="{secure_filename(resource.name)}"',
        'Accept-Ranges': 'bytes', # 非常重要，告知客户端支持 Range
    }

    if range_header:
        current_app.logger.info(f"Stream: Received Range header: {range_header}")
        try:
            # 尝试解析 bytes=start-end 和 bytes=start-
            range_match = re.match(r'bytes=(\d*)-(\d*)', range_header)
            if range_match:
                g = range_match.groups()
                range_start_str = g[0]
                range_end_str = g[1]

                if range_start_str: start = int(range_start_str)
                if range_end_str: end = int(range_end_str)
                elif range_start_str: end = file_size - 1 # 如果只有 start，则到末尾
                else: raise ValueError("Invalid Range format (no start)") # 例如 "bytes=-100" 暂时不处理

                if start < 0 or start >= file_size or start > end:
                    current_app.logger.warning(f"Stream: Range Not Satisfiable. Range: {range_header}, FileSize: {file_size}")
                    # 对于不满足的 Range，返回 416
                    return Response(status=416, headers={'Content-Range': f'bytes */{file_size}'})
                
                end = min(end, file_size - 1) # 确保 end 不超过文件边界
                status_code = 206 
                content_length = (end - start) + 1
                headers['Content-Range'] = f'bytes {start}-{end}/{file_size}'
                current_app.logger.info(f"Stream: Responding with 206. Content-Range: {headers['Content-Range']}, Content-Length: {content_length}")
            else: # 如果 Range 格式不匹配我们解析的，忽略它，发送整个文件
                current_app.logger.warning(f"Stream: Could not parse Range header with regex: {range_header}, sending full content.")
                start = 0; end = file_size - 1; status_code = 200; content_length = file_size
        except ValueError as e_val: # 捕获 int() 转换错误等
             current_app.logger.warning(f"Stream: ValueError parsing Range header '{range_header}': {e_val}. Sending full content.")
             start = 0; end = file_size - 1; status_code = 200; content_length = file_size
        except Exception as e_range: # 其他 Range 处理错误
            current_app.logger.error(f"Stream: Error processing Range header '{range_header}': {e_range}", exc_info=True)
            start = 0; end = file_size - 1; status_code = 200; content_length = file_size
    else:
        current_app.logger.info("Stream: No Range header, sending full content.")
    
    headers['Content-Length'] = str(content_length)
    current_app.logger.debug(f"Stream: Final response headers: {headers}, Status: {status_code}")

    def generate_file_stream(path, offset, length_to_read, chunk_size=8192):
        with open(path, 'rb') as f:
            f.seek(offset)
            bytes_remaining = length_to_read
            while bytes_remaining > 0:
                read_size = min(chunk_size, bytes_remaining)
                data = f.read(read_size)
                if not data: break
                yield data
                bytes_remaining -= len(data)
    
    return Response(
        stream_with_context(generate_file_stream(file_absolute_path, start, content_length)),
        status=status_code,
        headers=headers,
        mimetype=resource.mime_type or 'application/octet-stream'
    )


@course_resource_bp.route('/resources/<uuid:resource_id_str>/play-log', methods=['POST'])
@jwt_required()
def log_resource_play(resource_id_str):
    resource_id = str(resource_id_str)
    current_user_id = get_jwt_identity()

    resource = CourseResource.query.get(resource_id)
    if not resource:
        return jsonify({'error': 'Resource not found'}), 404

    user = User.query.get(current_user_id)
    if not user: return jsonify({'error': 'User not found for token'}), 401
    is_admin = (get_jwt().get('role') == 'admin')
    
    can_access = is_admin or check_resource_access(current_user_id, resource_id) or \
                 check_course_access_for_resource(current_user_id, resource)
    if not can_access:
        return jsonify({'error': 'Access denied to log play for this resource'}), 403

    data = request.get_json() or {}
    watch_time = data.get('watch_time_seconds')
    percentage = data.get('percentage_watched')

    try:
        # 使用 SQLAlchemy 的 ORM 进行原子更新（如果数据库支持）
        # 对于简单的计数器，直接赋值然后 commit 也可以，但需要注意并发
        # 更安全的方式是使用 session.query(CourseResource).filter_by(id=resource_id).update({CourseResource.play_count: CourseResource.play_count + 1})
        # 但这需要设置 synchronize_session=False 或其他处理。简单起见：
        resource.play_count = (resource.play_count or 0) + 1 # 确保 play_count 不是 None
        
        play_log_entry = UserResourcePlayLog(
            user_id=current_user_id,
            resource_id=resource_id,
            watch_time_seconds=watch_time if watch_time is not None else None,
            percentage_watched=percentage if percentage is not None else None
        )
        db.session.add(play_log_entry)
        db.session.commit()
        return jsonify({'message': 'Play logged successfully', 'new_play_count': resource.play_count}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error logging play for resource {resource_id}: {e}", exc_info=True)
        return jsonify({'error': 'Failed to log play event'}), 500

@course_resource_bp.route('/resources/<uuid:resource_id_str>/stats', methods=['GET'])
@jwt_required()
def get_resource_stats(resource_id_str):
    resource_id = str(resource_id_str)
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user: return jsonify({'error': 'User not found'}), 401
    is_admin = (get_jwt().get('role') == 'admin')
    
    resource = CourseResource.query.get(resource_id)
    if not resource:
        return jsonify({'error': 'Resource not found'}), 404

    can_access = is_admin or check_resource_access(current_user_id, resource_id) or \
                 check_course_access_for_resource(current_user_id, resource)
    if not can_access:
        return jsonify({'error': 'Access denied to this resource stats'}), 403
        
    return jsonify({
        'resource_id': str(resource.id),
        'play_count': resource.play_count,
    })

@course_resource_bp.route('/s/<path:share_slug_str>', methods=['GET'])
# 此接口的认证方式可以与 stream_course_resource 保持一致或根据需求调整
# 如果是公开分享，可能不需要 @jwt_required()，或者需要不同的权限检查逻辑
# 为了安全，我们先假设它需要和原 stream 接口一样的认证和权限
def stream_shared_resource_by_slug(share_slug_str):
    current_app.logger.info(f"ShareStreamBySlug: Accessing resource with slug: {share_slug_str}")
    
    clean_slug = secure_filename(share_slug_str.strip().lower())
    if not clean_slug:
        return jsonify({'error': '无效的分享链接标识符'}), 400

    resource = CourseResource.query.filter_by(
        share_slug=clean_slug,
        is_latest_for_slug=True
    ).first()

    if not resource:
        current_app.logger.warning(f"ShareStreamBySlug: No latest sharable resource found for slug '{clean_slug}'")
        # return jsonify({'error': '分享的资源未找到或链接已失效。'}), 404
        raise NotFound('分享的资源未找到或链接已失效。') # 使用 werkzeug 异常

    # === 复用 stream_course_resource 中的权限检查和流式传输逻辑 ===
    # 为避免代码重复，最好将 stream_course_resource 的核心逻辑提取到一个辅助函数中
    # _stream_file_content(resource_obj, request_headers, current_user_id_uuid, user_jwt_claims)
    # 这里为了快速演示，我们直接调用，并传递 resource.id
    # 注意：这需要 stream_course_resource 能够正确处理这种情况，或者对其进行修改。
    # 一个更简单的方法是直接在这里复制粘贴 stream_course_resource 后半部分的流式逻辑。
    
    # --- (以下代码段是从 stream_course_resource 复制并修改的) ---
    # 1. 权限检查逻辑 (需要 current_user_id_uuid 和 user_jwt_claims)
    #    这部分逻辑与 stream_course_resource 中的 token 处理和权限检查完全相同，
    #    只是我们已经通过 slug 找到了 `resource` 对象。

    current_user_id_from_token_str = None
    user_jwt_claims = {}
    header_token_valid = False
    try:
        verify_jwt_in_request(optional=True, locations=['headers']) 
        temp_identity = get_jwt_identity()
        if temp_identity:
            current_user_id_from_token_str = temp_identity
            user_jwt_claims = get_jwt()
            header_token_valid = True
    except Exception as e_header_jwt:
        pass # 继续

    if not header_token_valid:
        url_token = request.args.get('access_token', None)
        if url_token:
            try:
                decoded_jwt = decode_token(url_token) 
                identity_claim_key = current_app.config.get("JWT_IDENTITY_CLAIM", "sub")
                current_user_id_from_token_str = decoded_jwt.get(identity_claim_key)
                if not current_user_id_from_token_str: raise PyJWTError("Token missing identity.")
                user_jwt_claims = decoded_jwt
            except PyJWTError as e_jwt:
                return jsonify({'error': '访问令牌无效或已过期'}), 401
            except Exception as e_other_url_token:
                return jsonify({'error': '处理访问令牌时出错'}), 401
    
    if not current_user_id_from_token_str: # 必须有用户身份才能进行权限检查
        return jsonify({'error': '需要认证才能访问此分享资源'}), 401

    try:
        current_user_id_uuid = uuid.UUID(current_user_id_from_token_str)
    except (ValueError, TypeError):
        return jsonify({'error': f"无效的用户身份格式"}), 400

    user = User.query.get(current_user_id_uuid)
    if not user: return jsonify({'error': '用户不存在'}), 401
    is_admin = (user_jwt_claims.get('role') == 'admin')
    
    can_access = False
    if is_admin or check_resource_access(current_user_id_uuid, resource.id) or \
       check_course_access_for_resource(current_user_id_uuid, resource):
        can_access = True
    
    if not can_access:
        current_app.logger.warning(f"ShareStreamBySlug: Access denied for slug '{clean_slug}' (User: {current_user_id_uuid})")
        return jsonify({'error': '您没有权限访问此分享资源。'}), 403
    
    current_app.logger.info(f"ShareStreamBySlug: Access GRANTED for slug '{clean_slug}' (User: {current_user_id_uuid})")

    # 2. 流式传输逻辑 (与 stream_course_resource 后半部分相同, 使用 `resource` 对象)
    file_absolute_path = os.path.join(INSTANCE_FOLDER_PATH, resource.file_path)
    if not os.path.exists(file_absolute_path):
        current_app.logger.error(f"ShareStreamBySlug: File not found on server: {file_absolute_path}")
        raise NotFound('分享的资源文件在服务器上未找到。')

    file_size = resource.size_bytes or os.path.getsize(file_absolute_path)
    range_header = request.headers.get('Range', None)
    
    start = 0
    end = file_size - 1 
    status_code = 200
    content_length = file_size
    headers = {
        'Content-Type': resource.mime_type or 'application/octet-stream',
        'Content-Disposition': f'inline; filename="{secure_filename(resource.name)}"',
        'Accept-Ranges': 'bytes',
    }

    if range_header:
        # (此处省略 Range 处理逻辑，与 stream_course_resource 中的相同)
        # 务必复制粘贴并确保正确性
        try:
            range_match = re.match(r'bytes=(\d*)-(\d*)', range_header)
            if range_match:
                g = range_match.groups()
                range_start_str, range_end_str = g[0], g[1]
                if range_start_str: start = int(range_start_str)
                if range_end_str: end = int(range_end_str)
                elif range_start_str: end = file_size - 1
                else: raise ValueError("Invalid Range")
                if start < 0 or start >= file_size or start > end:
                    return Response(status=416, headers={'Content-Range': f'bytes */{file_size}'})
                end = min(end, file_size - 1)
                status_code = 206
                content_length = (end - start) + 1
                headers['Content-Range'] = f'bytes {start}-{end}/{file_size}'
        except ValueError: pass # Ignore invalid range header
        except Exception as e_range_parse:
            current_app.logger.warning(f"ShareStreamBySlug: Error parsing Range header '{range_header}': {e_range_parse}")


    headers['Content-Length'] = str(content_length)

    def generate_file_stream_slug(path, offset, length_to_read, chunk_size=8192):
        with open(path, 'rb') as f:
            f.seek(offset)
            bytes_remaining = length_to_read
            while bytes_remaining > 0:
                read_size = min(chunk_size, bytes_remaining)
                data = f.read(read_size)
                if not data: break
                yield data
                bytes_remaining -= len(data)
    
    return Response(
        stream_with_context(generate_file_stream_slug(file_absolute_path, start, content_length)),
        status=status_code,
        headers=headers,
        mimetype=resource.mime_type or 'application/octet-stream'
    )

# (确保现有的 update_course_resource 和 delete_course_resource 也添加了权限校验)
# ...