# backend/api/course_resource_api.py
import os
import uuid
import re
from flask import (
    Blueprint, request, jsonify, current_app,
    send_from_directory, Response, stream_with_context # <<<--- 确保 Response, stream_with_context 已导入
)
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt, decode_token, verify_jwt_in_request
from jwt import PyJWTError # 用于捕获 decode_token 可能的错误

from werkzeug.utils import secure_filename
from datetime import datetime

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
    print(f"Checking resource access for user {user_id} and resource {resource_id}")
    return UserResourceAccess.query.filter_by(user_id=user_id, resource_id=resource_id).first() is not None

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
    # ... 您的上传资源代码 ...
    # (请确保这里能正常工作)
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
                file_path=file_save_path_relative_to_instance,
                file_type=file_main_type,
                mime_type=mime_type,
                size_bytes=file_size,
                duration_seconds=duration,
                uploaded_by_user_id=current_user_id,
                sort_order=int(request.form.get('sort_order', 0))
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
        return jsonify({'error': '没有权限访问此资源，请联系管理员开通或学习此课程。'}), 403
           
    return jsonify(resource.to_dict(include_uploader=True))

# ... (您现有的 update_course_resource 和 delete_course_resource 接口，也确保有权限校验)
@course_resource_bp.route('/resources/<uuid:resource_id_str>', methods=['PUT'])
@jwt_required() # 通常需要权限
def update_course_resource(resource_id_str):
    resource_id = str(resource_id_str)
    # TODO: 将来在这里加入权限检查，确保操作者有权修改此资源
    # --- 权限校验 ---
    can_access = False
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

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided for update'}), 400

    try:
        if 'name' in data: resource.name = data['name']
        if 'description' in data: resource.description = data['description']
        if 'sort_order' in data: resource.sort_order = int(data['sort_order'])
        # file_path, file_type, mime_type, size_bytes, duration_seconds 通常在上传时确定，不轻易修改
        # uploaded_by_user_id, created_at 也不应在此修改
        
        db.session.commit()
        return jsonify({'message': 'Resource updated successfully', 'resource': resource.to_dict(include_uploader=True)})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error updating resource {resource_id}: {e}", exc_info=True)
        return jsonify({'error': f'Failed to update resource: {str(e)}'}), 500

@course_resource_bp.route('/resources/<uuid:resource_id_str>', methods=['DELETE'])
@jwt_required() # 通常需要权限
def delete_course_resource(resource_id_str):
    resource_id = str(resource_id_str)
    # TODO: 将来在这里加入权限检查
    # --- 权限校验 ---
    can_access = False
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
# @jwt_required()
def stream_course_resource(resource_id_str):
    resource_id = str(resource_id_str)
    current_user_id = None
    user_jwt_claims = {} # 用于存储解析后的 JWT claims

    # 尝试从 Authorization header 获取 Token
    auth_header = request.headers.get('Authorization', None)
    if auth_header and auth_header.startswith('Bearer '):
        token = auth_header.split(' ')[1]
        try:
            # 尝试验证请求头中的 JWT
            verify_jwt_in_request(locations=['headers']) # 这会验证并设置 JWT 上下文
            current_user_id = get_jwt_identity()
            user_jwt_claims = get_jwt()
            current_app.logger.info(f"Stream: Token validated from Header for user {current_user_id}")
        except Exception as e: # 包括 NoAuthorizationError, InvalidHeaderError 等
            current_app.logger.warning(f"Stream: Header token validation failed: {e}")
            # 如果 Header Token 验证失败，尝试从 URL 参数获取

    # 如果 Header 中没有有效 Token，尝试从 URL 参数获取 (仅用于调试)
    if not current_user_id:
        url_token = request.args.get('access_token', None)
        if url_token:
            current_app.logger.info(f"Stream: Attempting to validate token from URL parameter.")
            try:
                # 注意：直接 decode_token 不会像 jwt_required 那样处理所有类型的 JWT 错误
                # 并且它不会自动设置 get_jwt_identity() 和 get_jwt() 的上下文
                # 我们需要手动解码并获取 claims
                decoded_jwt = decode_token(url_token) # 这需要您的 JWT secret key 已配置
                current_user_id = decoded_jwt.get('sub') # 'sub' 通常是 identity
                user_jwt_claims = decoded_jwt # 将整个解码后的 token 作为 claims
                if not current_user_id:
                    raise PyJWTError("Token from URL is missing 'sub' claim.")
                current_app.logger.info(f"Stream: Token validated from URL parameter for user {current_user_id}")
            except PyJWTError as e_jwt: # 捕获 JWT 解码或验证错误
                current_app.logger.error(f"Stream: Invalid token from URL parameter: {e_jwt}")
                return jsonify({'error': 'Invalid or expired token from URL'}), 401
            except Exception as e_other:
                current_app.logger.error(f"Stream: Error processing token from URL: {e_other}")
                return jsonify({'error': 'Error processing token from URL'}), 401
        else:
            # 如果 Header 和 URL 参数都没有 Token
            current_app.logger.warning("Stream: No token provided in headers or URL params.")
            return jsonify({'error': 'Missing Authorization'}), 401
    
    # --- 后续逻辑使用 current_user_id 和 user_jwt_claims ---
    user = User.query.get(current_user_id)
    if not user:
        return jsonify({'error': 'User not found for token identity'}), 401
    is_admin = (user_jwt_claims.get('role') == 'admin') # 从解析的 claims 中获取 role

    resource = CourseResource.query.get(resource_id)
    if not resource:
        return jsonify({'error': 'Resource not found'}), 404

    can_access = False
    # if is_admin or check_resource_access(current_user_id, resource_id) or check_course_access_for_resource(current_user_id, resource):
    if is_admin or check_resource_access(current_user_id, resource_id):
        can_access = True
    
    if not can_access:
        current_app.logger.warning(f"User {current_user_id} denied access to stream resource {resource_id}")
        return jsonify({'error': 'Access denied to this resource'}), 403

    # INSTANCE_FOLDER_PATH 应该在文件顶部定义
    file_absolute_path = os.path.join(INSTANCE_FOLDER_PATH, resource.file_path)

    if not os.path.exists(file_absolute_path):
        current_app.logger.error(f"File not found on server for resource {resource_id}: {file_absolute_path}")
        return jsonify({'error': 'File not found on server'}), 404

    def generate_chunks(path, chunk_size=8192): # 增加 chunk_size
        with open(path, 'rb') as f:
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                yield chunk
    
    # Range header 处理 (简化版，仅支持 bytes=start-)
    range_header = request.headers.get('Range', None)
    file_size = resource.size_bytes or os.path.getsize(file_absolute_path)
    start_byte = 0
    
    if range_header:
        try:
            range_match = re.match(r'bytes=(\d+)-', range_header)
            if range_match:
                start_byte = int(range_match.group(1))
        except ValueError:
            pass # 如果 range 格式不对，从头开始流式传输

    if start_byte >= file_size:
        return Response(status=416) # Range Not Satisfiable

    def generate_ranged_chunks(path, start, chunk_size=8192):
        with open(path, 'rb') as f:
            f.seek(start)
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                yield chunk

    if range_header and start_byte > 0:
        resp_length = file_size - start_byte
        headers = {
            'Content-Range': f'bytes {start_byte}-{file_size-1}/{file_size}',
            'Accept-Ranges': 'bytes',
            'Content-Length': str(resp_length),
            'Content-Disposition': f'inline; filename="{secure_filename(resource.name)}"'
        }
        return Response(
            stream_with_context(generate_ranged_chunks(file_absolute_path, start_byte)), 
            status=206, # Partial Content
            mimetype=resource.mime_type or 'application/octet-stream',
            headers=headers
        )
    else:
        return Response(
            stream_with_context(generate_chunks(file_absolute_path)), 
            mimetype=resource.mime_type or 'application/octet-stream',
            headers={
                'Content-Disposition': f'inline; filename="{secure_filename(resource.name)}"',
                'Content-Length': str(file_size),
                'Accept-Ranges': 'bytes' # 表明支持 Range 请求
            }
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

# (确保现有的 update_course_resource 和 delete_course_resource 也添加了权限校验)
# ...