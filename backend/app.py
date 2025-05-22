from flask import Flask, jsonify, request, send_from_directory, current_app
from flask_cors import CORS
import psycopg2
import os
from dotenv import load_dotenv
import uuid
from dateutil import parser
import logging
import json
from backend.security_utils import generate_password_hash
from werkzeug.security import check_password_hash 
from psycopg2.extras import RealDictCursor, register_uuid # 确保导入
# from flask_sqlalchemy import SQLAlchemy # 如果你打算用 ORM，虽然 Flask-Migrate 不强制
# from flask_migrate import Migrate # 导入 Migrate
import traceback
# 配置密码加密方法为pbkdf2
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity,get_jwt
from datetime import timedelta, datetime
import datetime as dt

# --- 从 extensions 导入 ---
from .extensions import db, migrate
# -----------------------
from backend.api.temp_answer import save_temp_answer, get_temp_answers, mark_temp_answers_submitted  # 使用绝对导入
from backend.api.evaluation import get_evaluation_items, get_user_evaluations, update_evaluation
from backend.api.user_profile import get_user_profile
from backend.db import get_db_connection
from backend.models import db, TrainingCourse, User, UserCourseAccess # 
# from backend.api.evaluation_visibility import bp as evaluation_visibility_bp
# from backend.api.evaluation_item import bp as evaluation_item_bp
from backend.api.wechatshare import wechat_share_bp
from backend.api.user_sync import sync_user
from backend.api.employee_self_evaluation import employee_self_evaluation_bp
from backend.api.evaluation_aspect import bp as evaluation_aspect_bp # 新增
from backend.api.evaluation_category import bp as evaluation_category_bp # 新增
from backend.api.evaluation_item import bp as evaluation_item_api_bp # 保留或确认蓝图名称未冲突
from backend.api.evaluation_visibility import bp as evaluation_visibility_bp # 保留
from backend.api.evaluation_order import bp as evaluation_order_bp # 新增
from backend.api.llm_config_api import llm_config_bp # 修改导入
from backend.api.llm_log_api import llm_log_bp # 新增导入
from backend.api.tts_api import tts_bp # 新增导入
from backend.api.course_resource_api import course_resource_bp # <--- 新增导入
from backend.api.permission_api import permission_bp # <--- 新增导入


app = Flask(__name__)
# CORS(app) # 注册 CORS，允许所有源
CORS(app, 
     supports_credentials=True, 
     origins=[
         "http://localhost:5175",
         "https://ai.mengyimengsao.com"
     ],
     allow_headers=[ # 显式声明允许的请求头
         "Content-Type", 
         "Authorization", # 如果您的认证服务也可能使用 Bearer Token
         "X-Api-Key"      # 如果您的前端会发送这个头部
         # 根据需要添加其他自定义头部
     ],
)



register_uuid() # 确保 UUID 适配器已注册
# 创建带有角色信息的访问令牌
def create_token_with_role(user_id, role):
    return create_access_token(identity=user_id, additional_claims={'role': role})



load_dotenv()




app.config['SECRET_KEY'] = os.environ['SECRET_KEY']  # 设置 SECRET_KEY
app.config['JWT_SECRET_KEY'] = os.environ['SECRET_KEY']  # JWT密钥
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=30)  # Token过期时间
app.config['TTS_AUDIO_STORAGE_PATH'] = os.path.join(app.root_path, 'static', 'tts_audio')
# 如果前端需要通过 /static/tts_audio/... 这样的URL访问，确保这个路径配置正确
# 并且 Flask (或 Nginx) 配置为可以服务这个目录下的文件。
# 对于API返回的URL，您可能还需要一个基础URL
app.config['TTS_AUDIO_BASE_URL_FOR_API'] = '/static/tts_audio' # 前端拼接时用的基础路径

app.config["JWT_ACCESS_COOKIE_NAME"] = "auth_token"
app.config["JWT_TOKEN_LOCATION"] = ["headers", "cookies"] # 允许从请求头和 Cookie 中获取 Token
app.config["JWT_COOKIE_SECURE"] = False # 开发环境可以设为 False，生产环境应为 True (HTTPS)
app.config["JWT_COOKIE_SAMESITE"] = "Lax" # 或 "Strict"
# 如果您的 Token Cookie 不是 HttpOnly，那么前端 JS 可以访问它，但这里主要是为了让浏览器自动发送
# 如果您在登录时通过后端设置了 HttpOnly Cookie 来存储 Token，那是最好的

os.makedirs(app.config['TTS_AUDIO_STORAGE_PATH'], exist_ok=True)


jwt = JWTManager(app)  # 初始化JWT管理器
# --- JWT 错误处理器 ---
def add_cors_headers_to_response(response):
    # 这个函数可以被多个错误处理器调用
    response.headers.add("Access-Control-Allow-Origin", "http://localhost:5175") # 你的前端源
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    response.headers.add('Access-Control-Allow-Credentials', 'true')
    return response

@jwt.unauthorized_loader
def unauthorized_response(callback):
    response = jsonify({
        'status': 401,
        'sub_status': 42, # 自定义子状态码
        'msg': '请求未包含有效的访问令牌 (Missing Authorization Header or Invalid Token)'
    })
    response.status_code = 401
    return add_cors_headers_to_response(response) # 添加CORS头

@jwt.invalid_token_loader
def invalid_token_response(callback): # callback is the error message string
    response = jsonify({
        'status': 401, # 或者 422 Unprocessable Entity
        'sub_status': 43,
        'msg': '无效的令牌 (Invalid Token)' ,
        'error_detail': callback
    })
    response.status_code = 401 # 或者 422
    return add_cors_headers_to_response(response)

@jwt.expired_token_loader
def expired_token_response(jwt_header, jwt_payload):
    response = jsonify({
        'status': 401,
        'sub_status': 44,
        'msg': '令牌已过期 (Token has expired)'
    })
    response.status_code = 401
    return add_cors_headers_to_response(response)

@jwt.revoked_token_loader
def revoked_token_response(jwt_header, jwt_payload):
    response = jsonify({
        'status': 401,
        'sub_status': 45,
        'msg': '令牌已被撤销 (Token has been revoked)'
    })
    response.status_code = 401
    return add_cors_headers_to_response(response)

@jwt.needs_fresh_token_loader
def token_not_fresh_response(jwt_header, jwt_payload):
    response = jsonify({
        'status': 401,
        'sub_status': 46,
        'msg': '需要新的令牌 (Fresh token required)'
    })
    response.status_code = 401
    return add_cors_headers_to_response(response)
# --- JWT 错误处理器结束 ---

# 定义头像数据存储目录 (与 download_avatars.py 中的 output_dir 相同)
AVATAR_DATA_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'avatars')
os.makedirs(AVATAR_DATA_FOLDER, exist_ok=True) # 确保目录存在

# --- 配置数据库连接 (SQLAlchemy 方式，推荐与 Alembic 配合) ---
# 即使你不完全使用 SQLAlchemy 的 ORM 功能，配置它对 Alembic 也有帮助
# 确保你的 DATABASE_URL 环境变量设置正确
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ['DATABASE_URL']
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False # 建议关闭

# db = SQLAlchemy(app) # 初始化 SQLAlchemy
# migrate = Migrate(app, db) # 初始化 Flask-Migrate
# --- 初始化扩展 ---
db.init_app(app)
migrate.init_app(app, db)
# --- 将模型导入移到这里，并在应用上下文中 ---
with app.app_context():
    from . import models # <<--- 模型导入在这里
    print("DEBUG [app.py]: Checking db.metadata after app context and model import...")
    print(f"DEBUG [app.py]: db.metadata.tables keys: {list(db.metadata.tables.keys())}")
    if 'course_resource' in db.metadata.tables:
        print("DEBUG [app.py]: 'course_resource' table IS IN metadata.")
    else:
        print("DEBUG [app.py]: 'course_resource' table IS NOT IN metadata.")
    if 'user_resource_play_log' in db.metadata.tables:
        print("DEBUG [app.py]: 'user_resource_play_log' table IS IN metadata.")
    else:
        print("DEBUG [app.py]: 'user_resource_play_log' table IS NOT IN metadata.")
# --- 模型导入结束 ---

# 注册评价管理相关的蓝图
app.register_blueprint(evaluation_visibility_bp, url_prefix='/api')
app.register_blueprint(wechat_share_bp, url_prefix='/api/wechat')
app.register_blueprint(employee_self_evaluation_bp)
app.register_blueprint(evaluation_aspect_bp)
app.register_blueprint(evaluation_category_bp)
app.register_blueprint(evaluation_item_api_bp) # 确认蓝图名称
app.register_blueprint(evaluation_order_bp) # 新增注册
app.register_blueprint(llm_config_bp) # 修改注册
app.register_blueprint(llm_log_bp)   # 新增注册
app.register_blueprint(tts_bp) # 注册 TTS 蓝图
app.register_blueprint(course_resource_bp) # <--- 新增注册
app.register_blueprint(permission_bp) # <--- 新增注册





flask_log = os.environ['FLASK_LOG_FILE'] # 设置flask log地址

# 配置日志记录
log = logging.getLogger(__name__)
log.setLevel(logging.DEBUG)
handler = logging.FileHandler(flask_log)
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
log.addHandler(handler)

def insert_exam_knowledge_points(exam_id, total_score, data):
    """
    将知识点摘要插入到 exam 表的 knowledge_point_summary 字段中。
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        merge_kp_result_json = json.dumps(data, ensure_ascii=False)
        sql = """
            UPDATE exam
            SET knowledge_point_summary = %s, total_score = %s
            WHERE id = %s;
        """
        # sql = """
        #     INSERT INTO exam (id, knowledge_point_summary)
        #     VALUES (%s, %s)
        #     ON CONFLICT (id) DO UPDATE
        #     SET knowledge_point_summary = %s, updated_at = NOW();
        # """

        cur.execute(sql, (merge_kp_result_json, total_score, exam_id))
        conn.commit()

        logging.info(f"成功插入或更新 exam_id: {exam_id} 的知识点摘要。")

    except json.JSONDecodeError as e:
        logging.error(f"JSON 编码错误，exam_id: {exam_id}, 错误信息: {e}")
    except Exception as e:
        logging.error(f"未知错误，exam_id: {exam_id}, 错误信息: {e}")
    finally:
        if conn:
            cur.close()
            conn.close()

# 定义头像数据存储目录
# 使用 current_app.root_path 获取应用根目录，更稳健
def get_avatar_folder():
    folder = os.path.join(current_app.root_path, 'data', 'avatars')
    # 确保目录存在，可以在应用启动时调用此函数并创建目录
    # 例如，在 create_app 函数内部调用 os.makedirs(folder, exist_ok=True)
    return folder

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    # print("开始登录，登录数据：", data)
    if not data or 'phone_number' not in data or 'password' not in data:
        return jsonify({'error': '请提供用户名和密码'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('SELECT * FROM "user" WHERE "phone_number" = %s', (data['phone_number'],))
        user = cur.fetchone()

        if user and check_password_hash(user['password'], data['password']):
            # print("登录成功，用户ID：", user['id'])
            access_token = create_token_with_role(user['id'], user['role'])
            return jsonify({
                'access_token': access_token,
                'user': {
                    'id': user['id'],
                    'username': user['username'],
                    'role': user['role']
                }
            })
        return jsonify({'error': '用户名或密码错误,初始密码是”身份证后6位“'}), 401
    except Exception as e:
        # print('Error in login:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()


# API key 用来确保来源系统的可靠性。
AUTHORIZED_KEYS = {
    "api_key_123":"ai_mengyimengsao" # 目前用于 聊天机器人的登录与认证。
}
# 外部用户登录的api 为 ai系统提供的配额和 AUTHORIZED_KEYS 来配置使用
@app.route('/api/auth/login', methods=['POST'])
def login_api():
    api_key = request.headers.get('X-API-Key')
    log.debug(f"Received API login request with API Key: {'*' * len(api_key) if api_key else 'None'}") 
    
    if not api_key or api_key not in AUTHORIZED_KEYS:
        log.warning("Invalid or missing API Key received.")
        return jsonify({"error": "Invalid API Key"}), 401

    data = request.get_json()
    if not data:
         log.warning("API login request received no JSON data.")
         return jsonify({"error": "Missing request body"}), 400
         
    phone_number = data.get('phone_number')
    password = data.get('password')
    
    if not phone_number or not password:
         log.warning("API login request missing phone_number or password.")
         return jsonify({"error": "Missing phone_number or password"}), 400

    log.info(f"Attempting API login for phone number: {phone_number}")

    # --- 恢复手动管理连接和游标 ---
    conn = None
    cur = None
    try:
        conn = get_db_connection() # 直接获取连接
        cur = conn.cursor(cursor_factory=RealDictCursor) # 手动创建游标
        
        log.debug(f"Executing user lookup for phone: {phone_number}")
        # 查询 status 列
        cur.execute('SELECT id, username, password, role, status FROM "user" WHERE "phone_number" = %s', (phone_number,))
        user = cur.fetchone() 
        log.debug(f"User lookup completed for phone: {phone_number}. User found: {bool(user)}")

        # --- 检查逻辑保持不变 ---
        if user is None:
            log.warning(f"API login failed: Phone number {phone_number} not found in database.")
            # 注意：因为没有连接池，不需要在这里 return 后关闭连接，finally会处理
        elif user['status'] != 'active':
            log.warning(f"API login failed for phone number: {phone_number}. User status is '{user['status']}' (not active).")
            # 同上，finally 会处理关闭
        elif check_password_hash(user['password'], password):
            log.info(f"API login successful for user ID: {user['id']} (Phone: {phone_number})")
            access_token = create_token_with_role(user['id'], user['role']) 
            # 成功时，在 finally 关闭前返回
            return jsonify({
                'access_token': access_token,
                'user': {
                    'id': user['id'],
                    'username': user['username'],
                }
            })
        else:
            # 密码错误
            log.warning(f"API login failed for phone number: {phone_number} (Incorrect password)")
            # 同上，finally 会处理关闭

        # --- 如果上面的检查有失败的，会执行到这里，需要返回错误 ---
        # （根据上面的逻辑，这里只可能是 手机号不存在、状态不对 或 密码错误）
        if user is None:
             return jsonify({"error": "手机号不正确，请与管理员确认手机号"}), 401 
        elif user['status'] != 'active':
             return jsonify({"error": "用户未激活，请联系管理员"}), 401
        else: # 密码错误
             return jsonify({'error': '密码错误,默认密码为身份证号后6位'}), 401

    except Exception as e:
        log.exception(f"API login process failed unexpectedly for phone {phone_number}") 
        return jsonify({'error': f'登录过程中发生错误: {str(e)}'}), 500
    finally:
        # --- 确保无论如何都关闭游标和连接 ---
        if cur:
            cur.close()
        if conn:
            conn.close()
        log.debug(f"Database connection closed for API login attempt (phone: {phone_number})")

@app.route('/api/users/<user_id>/profile', methods=['GET', 'PUT'])
@jwt_required(optional=True)
def user_profile(user_id):
    if request.method == 'GET':
        # print("开始获取用户详细信息，用户ID：", user_id)
        public_param = request.args.get('public', 'false').lower() == 'true'
        if not public_param and (not get_jwt_identity() and not public_param):
            return jsonify({'msg': 'Missing authorization'}), 401
        return get_user_profile(user_id)
    elif request.method == 'PUT':
        if not get_jwt_identity():
            return jsonify({'msg': 'Missing authorization'}), 401
        data = request.get_json()
        data_str = json.dumps(data)
        # print("更新用户详细信息，用户data：", data)
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        try:
            # 更新user_profile表中的profile_data
            cur.execute("""
                INSERT INTO user_profile (user_id, profile_data)
                VALUES (%s, %s)
                ON CONFLICT (user_id)
                DO UPDATE SET profile_data = %s
                RETURNING profile_data
            """, (user_id, data_str, data_str))
            updated_profile = cur.fetchone()
            conn.commit()
            return jsonify(updated_profile['profile_data'])
        except Exception as e:
            conn.rollback()
            print('Error in update_user_profile:', str(e))
            return jsonify({'error': str(e)}), 500
        finally:
            cur.close()
            conn.close()

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'error': '请提供用户名和密码'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查用户名是否已存在
        cur.execute('SELECT id FROM users WHERE username = %s', (data['username'],))
        if cur.fetchone():
            return jsonify({'error': '用户名已存在'}), 400

        # 创建新用户
        hashed_password = generate_password_hash(data['password'])
        cur.execute(
            'INSERT INTO users (username, password, role) VALUES (%s, %s, %s) RETURNING id, username, role',
            (data['username'], hashed_password, data.get('role', 'user'))
        )
        new_user = cur.fetchone()
        conn.commit()

        # 生成访问令牌
        # access_token = create_access_token(identity=new_user['id'])
        access_token = create_token_with_role(new_user['id'], new_user['role'])
        return jsonify({
            'access_token': access_token,
            'user': {
                'id': new_user['id'],
                'username': new_user['username'],
                'role': new_user['role']
            }
        })
    except Exception as e:
        conn.rollback()
        print('Error in register:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()



# 全局错误处理
@app.errorhandler(Exception)
def handle_exception(e):
    # print('未处理的异常:', str(e))
    # print('异常类型:', type(e).__name__)
    import traceback
    # print('异常堆栈:')
    traceback.print_exc()
    log.exception("An unhandled exception occurred:")
    return jsonify({'error': str(e)}), 500


@app.route('/api/courses', methods=['GET']) # 或者蓝图注册的 @course_bp.route(...)
@jwt_required() # 假设获取课程列表需要登录
def get_courses():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    is_admin = (get_jwt().get('role') == 'admin')

    conn = get_db_connection() # 您现有的方式
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        base_query = """
            SELECT DISTINCT
                c.id, c.course_name, c.age_group, c.description, c.created_at, c.updated_at,
                COUNT(DISTINCT kp.id) as knowledge_point_count,
                COUNT(DISTINCT q.id) as question_count
            FROM trainingcourse c
            LEFT JOIN knowledgepoint kp ON kp.course_id = c.id
            LEFT JOIN question q ON q.knowledge_point_id = kp.id
        """
        
        params = []
        
        if not is_admin:
            # 普通用户：只选择他们有权限的课程
            # 我们需要获取该用户有权限的 course_ids
            # 注意：如果 UserCourseAccess 是通过 SQLAlchemy ORM 查询，会更简洁
            # 这里我们假设您可能也想用原生 SQL 或扩展现有查询
            user_course_ids_query = UserCourseAccess.query.with_entities(UserCourseAccess.course_id).filter_by(user_id=current_user_id).all()
            # allowed_course_ids = [str(row[0]) for row in user_course_ids_query]
            allowed_course_ids = [row[0] for row in user_course_ids_query if row[0] is not None] # <<<--- 直接使用 UUID 对象，并过滤 None (如果有的话)


            if not allowed_course_ids: # 如果用户没有任何课程权限
                return jsonify([]) # 返回空列表

            # 将 UUID 列表转换为适合 IN 子句的格式
            # psycopg2 需要元组或列表作为参数
            base_query += " WHERE c.id = ANY(%s)"
            params.append(allowed_course_ids) # 直接传递列表

        base_query += """
            GROUP BY c.id, c.course_name, c.age_group, c.description, c.created_at, c.updated_at
            ORDER BY c.created_at DESC
        """
        
        cur.execute(base_query, tuple(params) if params else None) # 将列表转为元组（如果非空）
        courses = cur.fetchall()
        return jsonify(courses)
    except Exception as e:
        current_app.logger.error(f"Error in get_courses: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
    finally:
        if cur: cur.close()
        if conn: conn.close()

@app.route('/api/courses', methods=['POST'])
def create_course():
    # print("开始创建课程")
    data = request.get_json()
    if not data or 'course_name' not in data:
        return jsonify({'error': 'Missing required fields'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('''
            INSERT INTO trainingcourse (
                course_name,
                age_group,
                description
            ) VALUES (%s, %s, %s)
            RETURNING id, course_name, age_group, description, created_at, updated_at
        ''', (
            data['course_name'],
            data.get('age_group', ''),
            data.get('description', '')
        ))
        new_course = cur.fetchone()
        # print("创建课程结果：", new_course)
        conn.commit()
        return jsonify(new_course)
    except Exception as e:
        conn.rollback()
        print('Error in create_course:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses/<course_id>', methods=['GET'])
def get_course(course_id):
    # print("开始获取课程详情，课程ID：", course_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('''
            SELECT 
                c.id,
                c.course_name,
                c.age_group,
                c.description,
                c.created_at,
                c.updated_at,
                COUNT(DISTINCT kp.id) as total_points,
                COUNT(DISTINCT q.id) as total_questions
            FROM trainingcourse c
            LEFT JOIN knowledgepoint kp ON c.id = kp.course_id
            LEFT JOIN question q ON kp.id = q.knowledge_point_id
            WHERE c.id = %s
            GROUP BY c.id, c.course_name, c.age_group, c.description, c.created_at, c.updated_at
        ''', (course_id,))
        course = cur.fetchone()
        # print("SQL查询结果：", course)
        if course is None:
            return jsonify({'error': 'Course not found'}), 404
        return jsonify(course)
    except Exception as e:
        print('Error in get_course:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses/<course_id>/check-deleteable', methods=['GET'])
def check_course_deleteable(course_id):
    # print("检查课程是否可删除，课程ID：", course_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查是否有关联的知识点
        cur.execute('SELECT COUNT(*) FROM knowledgepoint WHERE course_id = %s', (course_id,))
        knowledge_point_count = cur.fetchone()['count']
        
        if knowledge_point_count > 0:
            return jsonify({'deleteable': False, 'message': '该课程包含知识点，无法删除'})
        
        return jsonify({'deleteable': True})
    except Exception as e:
        print('Error in check_course_deleteable:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses/<course_id>', methods=['DELETE'])
def delete_course(course_id):
    # print("开始删除课程，课程ID：", course_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查是否有关联的知识点
        cur.execute('SELECT COUNT(*) FROM knowledgepoint WHERE course_id = %s', (course_id,))
        knowledge_point_count = cur.fetchone()['count']
        
        if knowledge_point_count > 0:
            return jsonify({'error': '该课程包含知识点，无法删除'}), 400

        # 删除课程
        cur.execute('DELETE FROM trainingcourse WHERE id = %s RETURNING id', (course_id,))
        deleted_course = cur.fetchone()
        if not deleted_course:
            return jsonify({'error': '课程不存在'}), 404

        conn.commit()
        return jsonify({'message': '课程删除成功'})
    except Exception as e:
        conn.rollback()
        print('Error in delete_course:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses/<course_id>/knowledge_points', methods=['GET'])
def get_course_knowledge_points(course_id):
    # print("开始获取课程知识点，课程ID：", course_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('''
            SELECT
                kp.id,
                kp.point_name,
                kp.description,
                kp.created_at,
                kp.updated_at,
                COUNT(q.id) AS question_count,
                SUM(CASE WHEN q.question_type = '单选题' THEN 1 ELSE 0 END) AS single_count,
                SUM(CASE WHEN q.question_type = '多选题' THEN 1 ELSE 0 END) AS multiple_count
                -- 如果需要, 还可以计算问答题数量
                -- , SUM(CASE WHEN q.question_type = '问答' THEN 1 ELSE 0 END) AS qa_count
            FROM knowledgepoint kp
            LEFT JOIN question q ON q.knowledge_point_id = kp.id
            WHERE kp.course_id = %s  -- 占位符, 实际使用时需要替换为具体的 course_id
            GROUP BY kp.id, kp.point_name, kp.description, kp.created_at, kp.updated_at
            ORDER BY kp.created_at DESC;
        ''', (course_id,))
        points = cur.fetchall()
        # print("SQL查询结果：", points)
        return jsonify(points)
    except Exception as e:
        print("Error in get_course_knowledge_points:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/knowledge-points', methods=['POST'])
def create_knowledge_point():
    # print("开始创建知识点")
    data = request.json
    # print("创建数据：", data)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查必需字段
        required_fields = ['point_name', 'course_id']
        for field in required_fields:
            if field not in data:
                raise ValueError(f"Missing required field: {field}")

        # 插入新知识点
        cur.execute('''
            INSERT INTO knowledgepoint (
                point_name,
                course_id,
                description
            ) VALUES (%s, %s, %s)
            RETURNING id, point_name, course_id, description, created_at, updated_at
        ''', (
            data['point_name'],
            data['course_id'],
            data.get('description', '')
        ))
        point = cur.fetchone()
        # print("创建知识点结果：", point)
        
        conn.commit()
        return jsonify(point)
    except ValueError as e:
        conn.rollback()
        # print(f"Validation error: {str(e)}")
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        conn.rollback()
        print(f"Error creating knowledge point: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/knowledge-points', methods=['GET'])
def get_knowledge_points():
    # print("开始获取知识点列表")
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    point_name = request.args.get('point_name', '')
    course_id = request.args.get('course_id', '')
    offset = (page - 1) * per_page
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 构建WHERE条件
        where_conditions = []
        params = []
        
        if point_name:
            where_conditions.append("kp.point_name ILIKE %s")
            params.append(f'%{point_name}%')
            
        if course_id:
            where_conditions.append("kp.course_id = %s")
            params.append(course_id)
            
        where_clause = " AND ".join(where_conditions) if where_conditions else "TRUE"
        
        # 获取总记录数
        count_sql = f'SELECT COUNT(*) FROM knowledgepoint kp WHERE {where_clause}'
        cur.execute(count_sql, params)
        total = cur.fetchone()['count']
        
        # 获取分页数据
        query = f'''
            SELECT 
                kp.id,
                kp.point_name,
                kp.description,
                kp.course_id,
                tc.course_name,
                kp.created_at,
                kp.updated_at,
                COUNT(q.id) as question_count
            FROM knowledgepoint kp
            LEFT JOIN trainingcourse tc ON kp.course_id = tc.id
            LEFT JOIN question q ON q.knowledge_point_id = kp.id
            WHERE {where_clause}
            GROUP BY kp.id, kp.point_name, kp.description, kp.course_id, tc.course_name, kp.created_at, kp.updated_at
            ORDER BY kp.created_at DESC
            LIMIT %s OFFSET %s
        '''
        
        # 计算偏移量
        offset = (page - 1) * per_page
        
        # 添加分页参数
        params.extend([per_page, offset])
        cur.execute(query, params)
        knowledge_points = cur.fetchall()
        
        return jsonify({
            'items': knowledge_points,
            'total': total,
            'page': page,
            'per_page': per_page,
            'total_pages': (total + per_page - 1) // per_page
        })
    except Exception as e:
        print("Error in get_knowledge_points:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/knowledge_points/<point_id>', methods=['GET'])
def get_knowledge_point(point_id):
    # print("开始获取知识点详情，知识点ID：", point_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('''
            SELECT 
                kp.id,
                kp.point_name,
                kp.description,
                kp.created_at,
                kp.updated_at,
                COUNT(q.id) as total_questions
            FROM knowledgepoint kp
            LEFT JOIN question q ON kp.id = q.knowledge_point_id
            WHERE kp.id = %s
            GROUP BY kp.id, kp.point_name, kp.description, kp.created_at, kp.updated_at
        ''', (point_id,))
        point = cur.fetchone()
        # print("SQL查询结果：", point)
        if point is None:
            return jsonify({'error': 'Knowledge point not found'}), 404
        return jsonify(point)
    except Exception as e:
        print("Error in get_knowledge_point:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/knowledge_points/<point_id>', methods=['PUT'])
def update_knowledge_point(point_id):
    # print("开始更新知识点，知识点ID：", point_id)
    data = request.json
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查知识点是否存在
        cur.execute('SELECT id FROM knowledgepoint WHERE id = %s', (point_id,))
        if not cur.fetchone():
            return jsonify({'error': '知识点不存在'}), 404

        # 更新知识点信息
        cur.execute('''
            UPDATE knowledgepoint 
            SET point_name = %s,
                course_id = %s
            WHERE id = %s
            RETURNING id, point_name, course_id
        ''', (data['point_name'], data['course_id'], point_id))
        updated_point = cur.fetchone()
        conn.commit()
        return jsonify(updated_point)
    except Exception as e:
        conn.rollback()
        print("Error in update_knowledge_point:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/knowledge_points/<point_id>', methods=['DELETE'])
def delete_knowledge_point(point_id):
    print("开始删除知识点，知识点ID：", point_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查是否有关联的考题
        cur.execute('SELECT COUNT(*) FROM question WHERE knowledge_point_id = %s', (point_id,))
        question_count = cur.fetchone()['count']
        if question_count > 0:
            return jsonify({'error': '该知识点下有关联的考题，无法删除'}), 400

        # 删除知识点
        cur.execute('DELETE FROM knowledgepoint WHERE id = %s RETURNING id', (point_id,))
        deleted_point = cur.fetchone()
        if not deleted_point:
            return jsonify({'error': '知识点不存在'}), 404

        conn.commit()
        return jsonify({'message': '知识点删除成功'})
    except Exception as e:
        conn.rollback()
        print("Error in delete_knowledge_point:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/knowledge_points/<point_id>/questions', methods=['GET'])
def get_knowledge_point_questions(point_id):
    print("开始获取知识点题目，知识点ID：", point_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取题目信息，按创建时间降序排序，再按ID升序排序
        cur.execute('''
            SELECT 
                q.id,
                q.question_type,
                q.question_text,
                q.knowledge_point_id,
                kp.course_id,
                json_agg(json_build_object(
                    'id', o.id,
                    'content', o.option_text,
                    'is_correct', o.is_correct
                )) as options
            FROM question q
            LEFT JOIN answer a ON q.id = a.question_id
            LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            LEFT JOIN option o ON q.id = o.question_id
            WHERE q.knowledge_point_id = %s
            GROUP BY q.id, q.question_type, q.question_text, q.knowledge_point_id, kp.course_id
            ORDER BY q.created_at DESC, q.id ASC
        ''', (point_id,))
        questions = cur.fetchall()
        # print("SQL查询结果：", questions)
        
        # 获取每个题目的选项，按id排序
        for question in questions:
            cur.execute('''
                SELECT id, option_text, is_correct
                FROM option
                WHERE question_id = %s
                ORDER BY id ASC
            ''', (question['id'],))
            question['options'] = cur.fetchall()
            
            # 获取课程下所有知识点（用于编辑时选择）
            cur.execute('''
                SELECT id, point_name
                FROM knowledgepoint
                WHERE course_id = %s
                ORDER BY created_at DESC
            ''', (question['course_id'],))
            question['available_knowledge_points'] = cur.fetchall()
            
        return jsonify(questions)
    except Exception as e:
        print("Error in get_knowledge_point_questions:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/questions/<question_id>', methods=['GET'])
def get_question(question_id):
    print("开始获取题目详情，题目ID：", question_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取题目基本信息
        cur.execute('''
            SELECT 
                q.id,
                q.question_type,
                q.question_text,
                q.difficulty,
                q.knowledge_point_id,
                q.created_at,
                q.updated_at,
                a.answer_text,
                a.explanation,
                a.source,
                kp.course_id
            FROM question q
            LEFT JOIN answer a ON q.id = a.question_id
            LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            WHERE q.id = %s
        ''', (question_id,))
        question = cur.fetchone()
        # print("SQL查询结果：", question)
        
        if question is None:
            return jsonify({'error': '题目不存在'}), 404
            
        # 获取题目选项
        cur.execute('''
            SELECT id, option_text, is_correct
            FROM option
            WHERE question_id = %s
            ORDER BY id ASC
        ''', (question_id,))
        question['options'] = cur.fetchall()
        
        # 获取课程下所有知识点（用于编辑时选择）
        cur.execute('''
            SELECT id, point_name
            FROM knowledgepoint
            WHERE course_id = %s
            ORDER BY created_at DESC
        ''', (question['course_id'],))
        question['available_knowledge_points'] = cur.fetchall()
        
        return jsonify(question)
    except Exception as e:
        print("Error in get_question:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/questions/<question_id>', methods=['PUT'])
def update_question(question_id):
    print("开始更新题目，题目ID：", question_id)
    data = request.json
    # print("更新数据：", data)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查题目是否存在
        check_sql = 'SELECT id FROM question WHERE id = %s::uuid'
        # print("执行检查题目SQL：", check_sql)
        # print("参数：", (question_id,))
        cur.execute(check_sql, (question_id,))
        if not cur.fetchone():
            return jsonify({'error': 'Question not found'}), 404

        # 更新题目基本信息
        update_question_sql = '''
            UPDATE question 
            SET question_text = %s,
                question_type = %s,
                difficulty = %s,
                knowledge_point_id = %s
            WHERE id = %s::uuid
            RETURNING id, question_text, question_type, difficulty, knowledge_point_id
        '''
        update_question_params = (
            data['question_text'],
            data['question_type'],
            data.get('difficulty', 3),
            data['knowledge_point_id'],
            question_id
        )
        # print("执行更新题目SQL：", update_question_sql)
        # print("参数：", update_question_params)
        cur.execute(update_question_sql, update_question_params)
        question = cur.fetchone()
        # print("更新题目结果：", question)

        # 更新答案信息
        update_answer_sql = '''
            UPDATE answer 
            SET answer_text = %s,
                explanation = %s,
                source = %s
            WHERE question_id = %s::uuid
            RETURNING answer_text, explanation, source
        '''
        update_answer_params = (
            data.get('answer_text', ''),
            data.get('explanation', ''),
            data.get('source', ''),
            question_id
        )
        # print("执行更新答案SQL：", update_answer_sql)
        # print("参数：", update_answer_params)
        cur.execute(update_answer_sql, update_answer_params)
        answer = cur.fetchone()
        if answer:
            question.update(answer)

        # 删除旧选项
        cur.execute('DELETE FROM option WHERE question_id = %s::uuid', (question_id,))
        
        # 插入新选项
        question['options'] = []
        if 'options' in data and isinstance(data['options'], list):
            for option in data['options']:
                if not isinstance(option, dict) or 'option_text' not in option:
                    continue
                cur.execute('''
                    INSERT INTO option (
                        question_id,
                        option_text,
                        is_correct
                    ) VALUES (%s, %s, %s)
                    RETURNING id, option_text, is_correct
                ''', (
                    question_id,
                    option['option_text'],
                    option.get('is_correct', False)
                ))
                question['options'].append(cur.fetchone())

        conn.commit()
        return jsonify(question)
    except Exception as e:
        conn.rollback()
        print(f"Error updating question: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/questions', methods=['POST'])
def create_question():
    print("开始创建题目")
    data = request.json
    # print("创建数据：", data)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查必需字段
        required_fields = ['question_text', 'question_type', 'knowledge_point_id']
        for field in required_fields:
            if field not in data:
                raise ValueError(f"Missing required field: {field}")

        # 插入新题目
        cur.execute('''
            INSERT INTO question (
                question_text,
                question_type,
                difficulty,
                knowledge_point_id
            ) VALUES (%s, %s, %s, %s)
            RETURNING id, question_text, question_type, difficulty, knowledge_point_id
        ''', (
            data['question_text'],
            data['question_type'],
            data.get('difficulty', 3),
            data['knowledge_point_id']
        ))
        question = cur.fetchone()
        # print("创建题目结果：", question)
        
        # 插入答案信息
        cur.execute('''
            INSERT INTO answer (
                question_id,
                answer_text,
                explanation,
                source
            ) VALUES (%s, %s, %s, %s)
            RETURNING answer_text, explanation, source
        ''', (
            question['id'],
            data.get('answer_text', ''),
            data.get('explanation', ''),
            data.get('source', '')
        ))
        answer = cur.fetchone()
        question.update(answer)
        
        # 插入选项
        if 'options' in data and isinstance(data['options'], list):
            question['options'] = []
            for option in data['options']:
                if not isinstance(option, dict) or 'option_text' not in option:
                    continue
                cur.execute('''
                    INSERT INTO option (
                        question_id,
                        option_text,
                        is_correct
                    ) VALUES (%s, %s, %s)
                    RETURNING id, option_text, is_correct
                ''', (
                    question['id'],
                    option['option_text'],
                    option.get('is_correct', False)
                ))
                question['options'].append(cur.fetchone())
            # print("创建选项结果：", question['options'])
        else:
            question['options'] = []
        
        conn.commit()
        return jsonify(question), 201
    except ValueError as e:
        conn.rollback()
        print(f"Validation error: {str(e)}")
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        conn.rollback()
        print(f"Error creating question: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/questions/<question_id>/check-usage', methods=['GET'])
def check_question_usage(question_id):
    print("检查题目使用状态，题目ID：", question_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查题目是否被试卷引用
        cur.execute("""
            SELECT COUNT(*) > 0 as is_used
            FROM exampaperquestion
            WHERE question_id = %s
        """, (question_id,))
        result = cur.fetchone()
        return jsonify({
            'is_used_in_exam': result['is_used'] if result else False
        })
    except Exception as e:
        print("Error in check_question_usage:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/questions/<question_id>', methods=['DELETE'])
def delete_question(question_id):
    print("开始删除题目，题目ID：", question_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查题目是否被试卷引用
        cur.execute("""
            SELECT COUNT(*) > 0 as is_used
            FROM exampaperquestion
            WHERE question_id = %s
        """, (question_id,))
        result = cur.fetchone()
        if result and result['is_used']:
            return jsonify({'error': '该题目已被试卷引用，无法删除'}), 400

        # 首先删除题目的选项
        cur.execute('DELETE FROM option WHERE question_id = %s', (question_id,))
        
        # 删除题目的答案
        cur.execute('DELETE FROM answer WHERE question_id = %s', (question_id,))
        
        # 最后删除题目本身
        cur.execute('DELETE FROM question WHERE id = %s RETURNING id', (question_id,))
        deleted = cur.fetchone()
        
        if deleted is None:
            return jsonify({'error': 'Question not found'}), 404
            
        conn.commit()
        return jsonify({'message': 'Question deleted successfully', 'id': question_id})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/users', methods=['GET'])
def get_users():
    log.debug("开始获取用户列表")
    
    # 获取分页参数
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    search = request.args.get('search', '')
    sort_by = request.args.get('sort_by', 'created_at')
    sort_order = request.args.get('sort_order', 'desc')
    
    # 验证排序字段
    valid_sort_fields = ['username', 'phone_number', 'role', 'created_at', 'evaluation_count']
    if sort_by not in valid_sort_fields:
        sort_by = 'created_at'
    
    # 验证排序顺序
    sort_order = sort_order.upper()
    if sort_order not in ['ASC', 'DESC']:
        sort_order = 'DESC'
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 构建WHERE条件
        where_conditions = []
        params = []
        
        if search:
            where_conditions.append("(u.username ILIKE %s OR u.phone_number ILIKE %s)")
            params.extend([f'%{search}%', f'%{search}%'])
        
        where_clause = " AND ".join(where_conditions) if where_conditions else "TRUE"
        
        # 获取总记录数
        count_sql = f'''
            SELECT COUNT(*) 
            FROM "user" u
            WHERE {where_clause}
        '''
        cur.execute(count_sql, params)
        total = cur.fetchone()['count']
        
        # 构建排序条件
        order_clause = f"{sort_by} {sort_order}"
        if sort_by == 'evaluation_count':
            order_clause = f"COUNT(DISTINCT e.id) {sort_order}, u.created_at DESC"
        
        # 获取分页数据
        query = f'''
            SELECT
                u.id,
                u.username,
                u.phone_number,
                u.role,
                u.email,
                u.status,
                u.created_at,
                u.updated_at,
                COUNT(DISTINCT e.id) as evaluation_count,
                ARRAY_AGG(DISTINCT eu.username) FILTER (WHERE eu.username IS NOT NULL) as evaluator_names,
                MAX(e.evaluation_time) AS last_evaluation_time
            FROM "user" u
            LEFT JOIN evaluation e ON u.id = e.evaluated_user_id
            LEFT JOIN "user" eu ON e.evaluator_user_id = eu.id
            WHERE {where_clause}
            GROUP BY u.id, u.username, u.phone_number, u.role, u.email, u.status, u.created_at, u.updated_at
            ORDER BY {order_clause}
            LIMIT %s OFFSET %s
        '''
        
        # 计算偏移量
        offset = (page - 1) * per_page
        
        # 添加分页参数
        params.extend([per_page, offset])
        cur.execute(query, params)
        users = cur.fetchall()
        
        return jsonify({
            'items': users,
            'total': total,
            'page': page,
            'per_page': per_page,
            'total_pages': (total + per_page - 1) // per_page
        })
    except Exception as e:
        print('Error in get_users:', str(e))
        log.exception('Error in get_users:')
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/users', methods=['POST'])
def create_user():
    print("开始创建用户")
    data = request.get_json()
    log.debug(f"Received data: {data}")
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'error': 'Missing required fields'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查用户名是否已存在
        cur.execute('SELECT id FROM "user" WHERE username = %s', (data['username'],))
        if cur.fetchone():
            log.debug(f"Username {data['username']} already exists")
            return jsonify({'error': 'Username already exists'}), 400

        # 创建新用户
        cur.execute('''
            INSERT INTO "user" (
                username,
                password,
                phone_number,
                role,
                email,
                status
            ) VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, username, phone_number, role, email, status, created_at, updated_at
        ''', (
            data['username'],
            generate_password_hash(data['password']),
            data.get('phone_number', ''),
            data.get('role', 'student'),
            data.get('email', ''),
            data.get('status', 'active')
        ))
        new_user = cur.fetchone()
        conn.commit()
        log.debug(f"Created new user: {new_user}")
        return jsonify(new_user)
    except Exception as e:
        conn.rollback()
        log.debug(f"Error in create_user: {str(e)}")
        print('Error in create_user:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/users/<user_id>', methods=['PUT'])
def update_user(user_id):
    print("开始更新用户，用户ID：", user_id)
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    print("更新数据：", data)
    log.debug(f"开始更新用户:{data}")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 构建更新字段
        update_fields = []
        params = []
        if 'username' in data and data['username']:
            # print("更新用户名")
            update_fields.append('username = %s')
            params.append(data['username'])
        if 'password' in data and data['password']:
            # print("更新密码")
            log.debug("更新密码")
            update_fields.append('password = %s')
            params.append(generate_password_hash(data['password']))
        if 'phone_number' in data and data['phone_number']:
            update_fields.append('phone_number = %s')
            params.append(data['phone_number'])
        if 'role' in data and data['role']:
            update_fields.append('role = %s')
            params.append(data['role'])
        if 'email' in data and data['email']:
            update_fields.append('email = %s')
            params.append(data['email'])
        if 'status' in data and data['status']:
            # print("更新状态")
            update_fields.append('status = %s')
            params.append(data['status'])

        if not update_fields:
            return jsonify({'error': 'No fields to update'}), 400

        # 添加用户ID到参数列表
        params.append(user_id)

        # 执行更新
        query = f'''
            UPDATE "user"
            SET {', '.join(update_fields)}
            WHERE id = %s
            RETURNING id, username, phone_number, role, email, status, created_at, updated_at
        '''
        cur.execute(query, params)
        updated_user = cur.fetchone()

        if updated_user is None:
            return jsonify({'error': 'User not found'}), 404

        conn.commit()
        return jsonify(updated_user)
    except Exception as e:
        conn.rollback()
        print('Error in update_user:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/users/<user_id>/details', methods=['GET'])
def get_user_detail(user_id):
    from .api.user_details import get_user_details
    return get_user_details(user_id)

@app.route('/api/evaluation-items', methods=['GET'])
def get_evaluation_items_route():
    return get_evaluation_items()

@app.route('/api/evaluation/structure', methods=['GET'])
def get_evaluation_structure():
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # 获取是否客户可见参数
        client_visible_param = request.args.get('client_visible')
        # 检查参数值是否为 'true' (忽略大小写)
        filter_by_visibility = client_visible_param and client_visible_param.lower() == 'true'
        # 1. 获取 Aspects (不再需要 allow_manual_input)
        cur.execute("""
            SELECT id, aspect_name, description, created_at, sort_order
            FROM evaluation_aspect
            ORDER BY sort_order ASC, created_at DESC
        """)
        aspects = cur.fetchall()

        # 2. 获取 Categories (需要 allow_manual_input)
        cur.execute("""
            SELECT id, category_name, description, aspect_id, created_at, sort_order, allow_manual_input -- *** 包含 allow_manual_input ***
            FROM evaluation_category
            ORDER BY sort_order ASC, created_at DESC
        """)
        categories = cur.fetchall()

        # 3. 动态构建获取 Items 的 SQL 查询
        base_item_sql = """
            SELECT id, item_name, description, category_id, is_visible_to_client, created_at, sort_order
            FROM evaluation_item
        """
        where_clauses = []
        sql_params = []

        # 如果需要根据可见性过滤
        if filter_by_visibility:
            where_clauses.append("is_visible_to_client = %s")
            sql_params.append(True)
            print("Filtering evaluation items by visibility: TRUE") # 添加日志
        else:
            print("Not filtering evaluation items by visibility.") # 添加日志


        # -- 这里可以添加其他潜在的 WHERE 条件 --
        # 例如: if some_other_filter:
        #           where_clauses.append("some_column = %s")
        #           sql_params.append(some_value)

        where_sql = ""
        if where_clauses:
            where_sql = "WHERE " + " AND ".join(where_clauses)

        order_by_sql = "ORDER BY sort_order ASC, created_at DESC"

        final_item_sql = f"{base_item_sql} {where_sql} {order_by_sql}"

        # print("Executing item SQL:", cur.mogrify(final_item_sql, sql_params).decode('utf-8')) # 打印最终执行的 SQL (调试用)

        cur.execute(final_item_sql, sql_params)
        items = cur.fetchall()
        # print(f"Fetched {len(items)} evaluation items.") # 添加日志，查看获取了多少条目

        # 4. 构建层级结构
        structure = []
        # *** 修改 category_map 以包含 allow_manual_input ***
        category_map = {str(cat['id']): {**cat, 'allow_manual_input': cat['allow_manual_input'], 'items': []} for cat in categories}
        item_map = {}
        # ... (填充 item_map 的逻辑不变) ...
        for item in items:
            cat_id_str = str(item['category_id'])
            if cat_id_str not in item_map:
                item_map[cat_id_str] = []
            aspect_id_for_item = None
            if cat_id_str in category_map:
                 aspect_id_for_item = str(category_map[cat_id_str]['aspect_id'])
            item_map[cat_id_str].append({
                'id': str(item['id']), 'name': item['item_name'], 'description': item['description'],
                'type': 'item', 'category_id': cat_id_str, 'aspect_id': aspect_id_for_item,
                'is_visible_to_client': item['is_visible_to_client'], 'sort_order': item.get('sort_order', 0)
            })
        for category_id, category_items in item_map.items():
            if category_id in category_map:
                category_map[category_id]['items'] = sorted(category_items, key=lambda x: x.get('sort_order', 0))


        for aspect in aspects:
            aspect_data = {
                'id': str(aspect['id']), 'name': aspect['aspect_name'], 'description': aspect['description'],
                'type': 'aspect', 'sort_order': aspect.get('sort_order', 0),
                # *** 移除 allow_manual_input ***
                'children': []
            }

            aspect_categories_sorted = []
            for category in categories:
                if str(category['aspect_id']) == str(aspect['id']):
                    processed_category = category_map.get(str(category['id']))
                    if processed_category:
                        category_data = {
                            'id': str(processed_category['id']), 'name': processed_category['category_name'],
                            'description': processed_category['description'], 'type': 'category',
                            'aspect_id': str(aspect['id']),
                            'allow_manual_input': processed_category['allow_manual_input'], # *** 添加 allow_manual_input ***
                            'sort_order': processed_category.get('sort_order', 0),
                            'children': processed_category.get('items', [])
                        }
                        aspect_categories_sorted.append(category_data)

            aspect_data['children'] = sorted(aspect_categories_sorted, key=lambda x: x.get('sort_order', 0))
            structure.append(aspect_data)

        structure.sort(key=lambda x: x.get('sort_order', 0))

        return jsonify(structure)

    except Exception as e:
        print('Error in get_evaluation_structure:', str(e))
        traceback.print_exc()
        return jsonify({'error': '获取评价结构失败: ' + str(e)}), 500
    finally:
        if cur: cur.close()
        if conn: conn.close()

@app.route('/api/users/<user_id>/evaluations', methods=['GET'])
def get_user_evaluations_route(user_id):
    # *** 假设 get_user_evaluations 函数已移至 evaluation.py 并已修改 ***
    from backend.api.evaluation import get_user_evaluations
    return get_user_evaluations(user_id)

@app.route('/api/user-evaluation/<user_id>', methods=['POST'])
def create_user_evaluation_route(user_id):
    data = request.get_json()
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            INSERT INTO evaluation 
            (evaluator_id, evaluated_user_id, evaluation_items, scores, comments)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
        """, (data['evaluator_id'], user_id, data['evaluation_items'], 
              data['scores'], data['comments']))
        evaluation_id = cur.fetchone()['id']
        conn.commit()
        return jsonify({'id': evaluation_id, 'message': '评价提交成功'})
    except Exception as e:
        conn.rollback()
        print('Error in create_user_evaluation:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/users/<user_id>', methods=['DELETE'])
def delete_user(user_id):
    print("开始删除用户，用户ID：", user_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('DELETE FROM "user" WHERE id = %s RETURNING id', (user_id,))
        deleted = cur.fetchone()

        if deleted is None:
            return jsonify({'error': 'User not found'}), 404

        conn.commit()
        return jsonify({'message': 'User deleted successfully', 'id': user_id})
    except Exception as e:
        conn.rollback()
        print('Error in delete_user:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses/<course_id>', methods=['PUT'])
def update_course(course_id):
    print("开始更新课程，课程ID：", course_id)
    data = request.get_json()
    if not data or 'course_name' not in data:
        return jsonify({'error': 'Missing required fields'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查课程是否存在
        cur.execute('SELECT id FROM trainingcourse WHERE id = %s', (course_id,))
        if not cur.fetchone():
            return jsonify({'error': 'Course not found'}), 404

        # 更新课程信息
        cur.execute('''
            UPDATE trainingcourse
            SET course_name = %s,
                age_group = %s,
                description = %s
            WHERE id = %s
            RETURNING id, course_name, age_group, description, created_at, updated_at
        ''', (
            data['course_name'],
            data.get('age_group', ''),
            data.get('description', ''),
            course_id
        ))
        updated_course = cur.fetchone()
        conn.commit()
        return jsonify(updated_course)
    except Exception as e:
        conn.rollback()
        print('Error in update_course:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exampapers', methods=['GET'])
def get_exampapers():
    print("开始获取考卷列表")
    search = request.args.get('search', '')
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT 
                ep.id,
                ep.title,
                ep.description,
                ep.created_at,
                array_agg(DISTINCT tc.course_name) as course_names
            FROM exampaper ep
            LEFT JOIN exampapercourse epc ON ep.id = epc.exam_paper_id
            LEFT JOIN trainingcourse tc ON epc.course_id = tc.id
            WHERE 
                CASE 
                    WHEN %s != '' THEN 
                        ep.title ILIKE '%%' || %s || '%%' OR 
                        ep.description ILIKE '%%' || %s || '%%'
                    ELSE TRUE
                END
            GROUP BY 
                ep.id, ep.title, ep.description, ep.created_at
            ORDER BY ep.created_at DESC
        """, (search, search, search))
        
        records = cur.fetchall()
        result = []
        for record in records:
            exam_paper = {
                'id': record['id'],
                'title': record['title'],
                'description': record['description'],
                'created_at': record['created_at'].isoformat() if record['created_at'] else None,
                'course_names': [course for course in record['course_names'] if course is not None] if record['course_names'] else []
            }
            result.append(exam_paper)
            
        # print("API Response:", result)
        return jsonify(result)
    except Exception as e:
        print(f"Error in get_exampapers: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams', methods=['GET'])
def get_exams():
    print("开始获取考试列表")
    search = request.args.get('search', '')
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT 
                ep.id,
                ep.title,
                ep.description,
                ep.created_at,
                array_agg(DISTINCT tc.course_name) as course_names,
                COUNT(DISTINCT q.id) as question_count,
                COUNT(DISTINCT CASE WHEN q.question_type = '单选题' THEN q.id END) as single_count,
                COUNT(DISTINCT CASE WHEN q.question_type = '多选题' THEN q.id END) as multiple_count
            FROM exampaper ep
            LEFT JOIN exampapercourse epc ON ep.id = epc.exam_paper_id
            LEFT JOIN trainingcourse tc ON epc.course_id = tc.id
            LEFT JOIN exampaperquestion epq ON ep.id = epq.exam_paper_id
            LEFT JOIN question q ON epq.question_id = q.id
            WHERE 
                CASE 
                    WHEN %s != '' THEN 
                        ep.title ILIKE '%%' || %s || '%%' OR 
                        ep.description ILIKE '%%' || %s || '%%'
                    ELSE TRUE
                END
            GROUP BY 
                ep.id, ep.title, ep.description, ep.created_at
            ORDER BY ep.created_at DESC
        """, (search, search, search))
        
        records = cur.fetchall()
        result = []
        for record in records:
            exam_record = {
                'id': record['id'],
                'title': record['title'],
                'description': record['description'],
                'created_at': record['created_at'].isoformat() if record['created_at'] else None,
                'course_names': [course for course in record['course_names'] if course is not None] if record['course_names'] else [],
                'question_count': record['question_count'],
                'single_count': record['single_count'],
                'multiple_count': record['multiple_count']
            }
            result.append(exam_record)
            
        # print("API Response:", result)
        return jsonify(result)
    except Exception as e:
        print(f"Error in get_exams: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams', methods=['POST'])
def create_exam():
    print("开始创建考试")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        data = request.get_json()
        # print("创建数据：", data)
        
        title = data.get('title')
        description = data.get('description', '')
        course_ids = data.get('course_ids', [])  # 从前端直接接收课程ID列表
        point_ids = data.get('point_ids', [])
        single_count = data.get('single_count', 0)
        multiple_count = data.get('multiple_count', 0)

        if not title:
            return jsonify({'error': '考卷标题不能为空'}), 400
        if not course_ids:
            return jsonify({'error': '请选择至少一个课程'}), 400
        if not point_ids:
            return jsonify({'error': '请选择至少一个知识点'}), 400
        if single_count == 0 and multiple_count == 0:
            return jsonify({'error': '请设置要抽取的题目数量'}), 400

        # print(f"Creating exam with {len(course_ids)} courses and {len(point_ids)} knowledge points")
        # print(f"Requesting {single_count} single choice and {multiple_count} multiple choice questions")

        # 创建考卷
        cur.execute('''
            INSERT INTO exampaper (title, description)
            VALUES (%s, %s)
            RETURNING id
        ''', (title, description))
        exam_id = cur.fetchone()['id']
        print(f"Created exam with ID: {exam_id}")

        # 创建试卷和课程的关联
        for course_id in course_ids:
            cur.execute('''
                INSERT INTO exampapercourse (exam_paper_id, course_id)
                VALUES (%s, %s)
            ''', (exam_id, course_id))
        print(f"Associated exam with courses: {course_ids}")

        # 检查每种题型是否有足够的题目
        if single_count > 0:
            cur.execute(f'''
                SELECT COUNT(*) as count
                FROM question q
                WHERE q.knowledge_point_id IN (SELECT id::uuid FROM unnest(ARRAY[{point_ids}]) AS id)
                AND q.question_type = '单选题'
            ''')
            available_single = cur.fetchone()['count']
            # print(f"Available single choice questions: {available_single}")
            if available_single < single_count:
                conn.rollback()
                return jsonify({'error': f'单选题数量不足，只有 {available_single} 道题可用'}), 400

        if multiple_count > 0:
            cur.execute(f'''
                SELECT COUNT(*) as count
                FROM question q
                WHERE q.knowledge_point_id IN (SELECT id::uuid FROM unnest(ARRAY[{point_ids}]) AS id)
                AND q.question_type = '多选题'
            ''')
            available_multiple = cur.fetchone()['count']
            # print(f"Available multiple choice questions: {available_multiple}")
            if available_multiple < multiple_count:
                conn.rollback()
                return jsonify({'error': f'多选题数量不足，只有 {available_multiple} 道题可用'}), 400

        # 从选定的知识点中随机抽取题目
        if single_count > 0:
            cur.execute(f'''
                INSERT INTO exampaperquestion (exam_paper_id, question_id)
                SELECT %s, q.id
                FROM question q
                WHERE q.knowledge_point_id IN (SELECT id::uuid FROM unnest(ARRAY[{point_ids}]) AS id)
                AND q.question_type = '单选题'
                ORDER BY RANDOM()
                LIMIT %s
            ''', (exam_id, single_count))

        if multiple_count > 0:
            cur.execute(f'''
                INSERT INTO exampaperquestion (exam_paper_id, question_id)
                SELECT %s, q.id
                FROM question q
                WHERE q.knowledge_point_id IN (SELECT id::uuid FROM unnest(ARRAY[{point_ids}]) AS id)
                AND q.question_type = '多选题'
                ORDER BY RANDOM()
                LIMIT %s
            ''', (exam_id, multiple_count))

        conn.commit()
        print(f"Successfully created exam with ID: {exam_id}")
        return jsonify({'id': exam_id})
    except Exception as e:
        conn.rollback()
        print('Error in create_exam:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams/<exam_id>', methods=['GET'])
def get_exam(exam_id):
    print("开始获取考试详情，考试ID：", exam_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取考卷基本信息
        cur.execute('''
            SELECT 
                ep.id,
                ep.title,
                ep.description,
                ep.created_at,
                ep.updated_at
            FROM exampaper ep
            WHERE ep.id = %s
        ''', (exam_id,))
        exam = cur.fetchone()
        # print("SQL查询结果：", exam)
        if not exam:
            return jsonify({'error': 'Exam not found'}), 404

        # 获取试卷中的所有题目及其选项
        cur.execute('''
            WITH option_numbers AS (
                SELECT 
                    id,
                    question_id,
                    option_text,
                    is_correct,
                    (ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id) - 1)::integer as option_index
                FROM option
            )
            SELECT 
                q.id,
                q.question_type,
                q.question_text,
                a.explanation,
                kp.id as knowledge_point_id,
                kp.point_name as knowledge_point_name,
                tc.course_name,
                array_agg(json_build_object(
                    'id', o.id,
                    'option_text', o.option_text,
                    'index', o.option_index,
                    'is_correct', o.is_correct
                ) ORDER BY o.option_index) as options
            FROM exampaperquestion epq
            JOIN question q ON epq.question_id = q.id
            LEFT JOIN option_numbers o ON q.id = o.question_id
            LEFT JOIN answer a ON q.id = a.question_id
            LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            LEFT JOIN trainingcourse tc ON kp.course_id = tc.id
            WHERE epq.exam_paper_id = %s
            GROUP BY q.id, q.question_type, q.question_text, a.explanation, kp.id, kp.point_name, tc.course_name, epq.created_at
            ORDER BY epq.created_at ASC
        ''', (exam_id,))
        
        questions = cur.fetchall()
        exam['questions'] = [dict(q) for q in questions]
        # print("SQL查询结果：==========>", exam)
        return jsonify(exam)
    except Exception as e:
        print('Error in get_exam:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams/<exam_id>/detail', methods=['GET'])
def get_exam_detail(exam_id):
    print("开始获取考试详情（包含课程信息），考试ID：", exam_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取试卷基本信息和相关课程
        cur.execute('''
            WITH exam_courses AS (
                SELECT DISTINCT
                    ep.id as exam_id,
                    array_agg(DISTINCT tc.course_name) as course_names
                FROM exampaper ep
                JOIN exampapercourse epc ON ep.id = epc.exam_paper_id
                JOIN trainingcourse tc ON epc.course_id = tc.id
                WHERE ep.id = %s
                GROUP BY ep.id
            )
            SELECT 
                e.id,
                e.title,
                e.description,
                e.created_at,
                COALESCE(ec.course_names, ARRAY[]::text[]) as course_names
            FROM exampaper e
            LEFT JOIN exam_courses ec ON e.id = ec.exam_id
            WHERE e.id = %s
            GROUP BY e.id, e.title, e.description, e.created_at, ec.course_names
        ''', (exam_id, exam_id))
        exam = cur.fetchone()
        # print("SQL查询结果：", exam)
        
        if not exam:
            return jsonify({'error': '试卷不存在'}), 404

        # 获取试卷中的所有题目及其选项
        cur.execute('''
            WITH option_numbers AS (
                SELECT 
                    id,
                    question_id,
                    option_text,
                    is_correct,
                    (ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id) - 1)::integer as option_index
                FROM option
            )
            SELECT 
                q.id,
                q.question_type,
                q.question_text,
                a.explanation,
                kp.id as knowledge_point_id,
                kp.point_name as knowledge_point_name,
                tc.course_name,
                array_agg(json_build_object(
                    'id', o.id,
                    'option_text', o.option_text,
                    'index', o.option_index,
                    'is_correct', o.is_correct
                ) ORDER BY o.option_index) as options
            FROM exampaperquestion epq
            JOIN question q ON epq.question_id = q.id
            LEFT JOIN option_numbers o ON q.id = o.question_id
            LEFT JOIN answer a ON q.id = a.question_id
            LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            LEFT JOIN trainingcourse tc ON kp.course_id = tc.id
            WHERE epq.exam_paper_id = %s
            GROUP BY q.id, q.question_type, q.question_text, a.explanation, kp.id, kp.point_name, tc.course_name, epq.created_at
            ORDER BY epq.created_at ASC
        ''', (exam_id,))
        
        questions = cur.fetchall()
        exam['questions'] = [dict(q) for q in questions]
        
        return jsonify(exam)
    except Exception as e:
        print('Error in get_exam_record_detail:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams/<exam_id>', methods=['PUT'])
def update_exam(exam_id):
    print("开始更新考试，考试ID：", exam_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        data = request.json
        title = data.get('title')
        description = data.get('description', '')
        course_ids = data.get('course_ids', [])
        
        if not title:
            return jsonify({'error': '考卷标题不能为空'}), 400
            
        if not course_ids:
            return jsonify({'error': '请选择至少一个课程'}), 400
            
        # 更新考卷基本信息
        cur.execute('''
            UPDATE exampaper
            SET title = %s, description = %s
            WHERE id = %s
        ''', (title, description, exam_id))
        
        # 删除旧的课程关联
        cur.execute('''
            DELETE FROM exampapercourse
            WHERE exam_paper_id = %s
        ''', (exam_id,))
        
        # 添加新的课程关联
        for course_id in course_ids:
            cur.execute('''
                INSERT INTO exampapercourse (exam_paper_id, course_id)
                VALUES (%s, %s)
            ''', (exam_id, course_id))
            
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        print('Error in update_exam:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams/<exam_id>/take', methods=['GET'])
def get_exam_for_taking(exam_id):
    print("首先，开始获取考试题目，考试ID：", exam_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取考卷基本信息
        cur.execute('''
            SELECT 
                e.id,
                e.title,
                e.description,
                e.created_at,
                json_agg(json_build_object(
                    'id', tc.id,
                    'name', tc.course_name
                )) as courses
            FROM exampaper e
            LEFT JOIN exampapercourse epc ON e.id = epc.exam_paper_id
            LEFT JOIN trainingcourse tc ON epc.course_id = tc.id
            WHERE e.id = %s
            GROUP BY e.id, e.title, e.description, e.created_at
        ''', (exam_id,))
        exam = cur.fetchone()

        if not exam:
            return jsonify({'error': 'Exam not found'}), 404

        # 获取考卷中的题目（不包含正确答案）
        cur.execute('''
            SELECT 
                q.id,
                q.question_type,
                q.question_text,
                q.knowledge_point_id,
                kp.course_id,
                epq.id as exam_paper_question_id,
                json_agg(
                    json_build_object(
                        'id', o.id,
                        'content', o.option_text,
                        'is_correct', o.is_correct
                    ) ORDER BY o.id
                ) as options
            FROM exampaperquestion epq
            JOIN question q ON epq.question_id = q.id
            LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            LEFT JOIN option o ON q.id = o.question_id
            WHERE epq.exam_paper_id = %s
            GROUP BY 
                q.id,
                q.question_type,
                q.question_text,
                q.knowledge_point_id,
                kp.course_id,
                epq.id
            ORDER BY epq.created_at ASC
        ''', (exam_id,))
        
        questions = cur.fetchall()
        # print(questions)
        # 按题型分组
        grouped_questions = {
            'single': [],
            'multiple': []
        }
        
        for q in questions:
            if q['question_type'] == '单选题':
                grouped_questions['single'].append(q)
            elif q['question_type'] == '多选题':
                grouped_questions['multiple'].append(q)
        # print(grouped_questions)
        return jsonify({
            'exam': exam,
            'questions': grouped_questions
        })
        
    except Exception as e:
        print('Error in get_exam_for_taking:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()



@app.route('/api/exams/<exam_id>/submit', methods=['POST'])
def submit_exam_answer(exam_id):
    logger = logging.getLogger(__name__)
    logger.info(f"Starting exam submission for exam_id: {exam_id}")
    # print(exam_id)
    conn = None
    cur = None
    data = request.json
    user_id_from_request = data.get('user_id') # 从请求中获取 user_id
    user_uuid_for_log = None
    if user_id_from_request:
        try:
            user_uuid_for_log = uuid.UUID(user_id_from_request)
        except ValueError:
            logger.warning(f"提交考试时，请求中的user_id '{user_id_from_request}' 格式无效。")
    try:
        # Input validation
        if not exam_id:
            raise ValueError("Exam ID is required")
        user_id = data.get('user_id')
        answers = data.get('answers', [])
        
        if not user_id:
            raise ValueError("User ID is required")
        if not answers:
            raise ValueError("No answers provided")
            
        # Validate exam_id and user_id are valid UUIDs
        try:
            exam_uuid = str(uuid.UUID(exam_id))
            user_uuid = str(uuid.UUID(user_id))
        except ValueError as e:
            logger.error(f"Invalid UUID format: {str(e)}")
            return jsonify({'error': 'Invalid exam ID or user ID format'}), 400
            
        # Establish database connection
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # 获取用户信息
        cur.execute('''
            SELECT username, phone_number
            FROM "user"
            WHERE id = %s
        ''', (user_uuid,))
        user_info = cur.fetchone()
        if not user_info:
            raise ValueError(f"User with ID {user_id} not found")

        # 获取考试开始时间（从临时答案表中获取第一次保存的时间）
        cur.execute('''
            SELECT MIN(created_at) as start_time
            FROM temp_answer_record
            WHERE exam_paper_id = %s AND user_id = %s
        ''', (exam_uuid, user_uuid))
        start_time_record = cur.fetchone()
        start_time = start_time_record['start_time'] if start_time_record and start_time_record['start_time'] else dt.datetime.now()

        # 获取当前时间作为提交时间
        submit_time = dt.datetime.now()

        # Verify exam exists and is active
        cur.execute('''
            SELECT id, title FROM exampaper WHERE id = %s
        ''', (exam_uuid,))
        exam = cur.fetchone()
        if not exam:
            raise ValueError(f"Exam with ID {exam_id} not found")

        results = []
        kp_coreects = []
        total_score = 0

        
        # 插入 Exam 表
        cur.execute('''
            INSERT INTO exam (
                exam_paper_id,
                user_id,
                total_score,
                single_choice_count,
                multiple_choice_count,
                created_at
            ) VALUES (%s, %s, 0, 0, 0, NOW())
            RETURNING id;
        ''', (exam_uuid, user_uuid))
        # 此处返回的是 此次参与考试的id
        exam_take_id = cur.fetchone()['id'] 

        # print("answer====",answers)
       
        for answer in answers:
            question_id = answer.get('question_id')
            selected_options = answer.get('selected_options', [])
            
            if not question_id:
                logger.warning("Skipping answer with missing question_id")
                continue
                
            # Validate question_id UUID
            try:
                question_id = str(uuid.UUID(question_id))
            except ValueError:
                logger.warning(f"Invalid question_id UUID format: {question_id}")
                continue

            # Validate selected_options
            try:
                selected_options = [str(uuid.UUID(opt)) for opt in selected_options]
            except ValueError as e:
                logger.error(f"Invalid UUID in selected_options: {str(e)}")
                continue

            # Get question info and correct answers
            cur.execute('''
                WITH option_with_index AS (
                    SELECT
                        id,
                        question_id,
                        option_text,
                        is_correct,
                        chr(65 + (ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id) - 1)::integer) AS option_char
                    FROM option
                    WHERE question_id = %s
                ),
                correct_options AS (
                  SELECT
                        question_id,
                        array_agg(id) as correct_option_ids,
                        array_agg(option_char) AS correct_answer_chars
                    FROM option_with_index
                    WHERE is_correct
                    GROUP BY question_id
                )
                SELECT
                    q.id,
                    q.question_type,
                    q.question_text,
                    a.explanation,
                    co.correct_answer_chars,
                    co.correct_option_ids,
                    kp.point_name as knowledge_point_name,   -- 添加知识点名称
                    json_agg(
                        json_build_object(
                            'id', owi.id,
                            'content', owi.option_text,
                            'is_correct', owi.is_correct,
                            'char', owi.option_char
                        ) ORDER BY owi.option_char
                    ) AS options
                FROM question q
                LEFT JOIN answer a ON q.id = a.question_id
                LEFT JOIN option_with_index owi ON q.id = owi.question_id
                LEFT JOIN correct_options co ON q.id = co.question_id
                LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id  -- 直接 JOIN knowledge_point 表
                WHERE q.id = %s
                GROUP BY q.id, q.question_type, q.question_text, a.explanation, co.correct_answer_chars, co.correct_option_ids, kp.point_name;
            ''', (question_id, question_id))
            
            question_info = cur.fetchone()

            # print("question_info:",question_info)
            if not question_info:
                logger.warning(f"No question info found for question_id: {question_id}")
                continue

            # Calculate score
            is_correct = False
            score = 0

            if question_info['question_type'] == '单选题':
                # Ensure correct_option_ids are strings
                correct_option_ids = []
                for opt in question_info['correct_option_ids']:
                    if isinstance(opt, uuid.UUID):
                        correct_option_ids.append(str(opt))
                    else:
                        correct_option_ids.append(str(uuid.UUID(opt)))
                
                # Convert selected option to string
                selected_option_str = ""
                if selected_options:
                    if isinstance(selected_options[0], uuid.UUID):
                        selected_option_str = str(selected_options[0])
                    else:
                        selected_option_str = str(uuid.UUID(selected_options[0]))
                        
                is_correct = len(selected_options) == 1 and selected_option_str in correct_option_ids
                score = 1 if is_correct else 0
            elif question_info['question_type'] == '多选题':
                # Handle correct_option_ids
                if isinstance(question_info['correct_option_ids'], str):
                    correct_options = question_info['correct_option_ids'].strip('{}').split(',')
                    correct_options = [str(uuid.UUID(opt.strip())) for opt in correct_options if opt.strip()]
                else:
                    correct_options = []
                    for opt in question_info['correct_option_ids']:
                        if isinstance(opt, uuid.UUID):
                            correct_options.append(str(opt))
                        else:
                            correct_options.append(str(uuid.UUID(opt)))

                # Handle selected_options
                selected_options_str = []
                for opt in selected_options:
                    if isinstance(opt, uuid.UUID):
                        selected_options_str.append(str(opt))
                    else:
                        selected_options_str.append(str(uuid.UUID(opt)))
                
                selected_set = set(selected_options_str)
                correct_set = set(correct_options)
                
                is_correct = selected_set == correct_set
                score = 2 if is_correct else 0

            # Record answer
            try:
                # Convert selected_options to PostgreSQL array literal
                if not isinstance(selected_options, list):
                    selected_options = [selected_options]

                # Ensure all options are valid UUID strings
                selected_options_array = []
                for opt in selected_options:
                    if isinstance(opt, uuid.UUID):
                        selected_options_array.append(str(opt))
                    else:
                        selected_options_array.append(str(uuid.UUID(opt)))

                selected_options_literal = '{' + ','.join(selected_options_array) + '}'
                cur.execute('''
                    INSERT INTO answerrecord (
                        exam_paper_id,
                        exam_id,
                        question_id,
                        selected_option_ids,
                        user_id,
                        score,
                        created_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, NOW())
                    RETURNING id;
                ''', (exam_uuid, exam_take_id, question_id, selected_options_literal, user_uuid, score))
                
                answer_record_id = cur.fetchone()['id']


                
                # 构建结果对象
                result = {
                    'id': question_id,
                    'question_text': question_info['question_text'],
                    'question_type': question_info['question_type'],
                    'knowledge_point_name': question_info['knowledge_point_name'],
                    'selected_option_ids': selected_options,
                    'options': question_info['options'],
                    'score': score,
                    'is_correct': is_correct,
                    'explanation': question_info['explanation']
                }
                kp_coreect = {
                    'knowledge_point_name': question_info.get('knowledge_point_name', '未知知识点'),
                    'if_get': '已掌握' if is_correct else '未掌握' # Python 的三元条件表达式
                }
                
                results.append(result)
                kp_coreects.append(kp_coreect)
                total_score += score
                
            except Exception as e:
                logger.error(f"Error recording answer: {str(e)}")
                conn.rollback()
                continue

        # Commit the transaction
        conn.commit()

        # AI根据考试结果对知识点掌握情况进行汇总
        from backend.api.ai_generate import merge_kp_name
        # merge_kp_result = merge_kp_name(kp_coreects)
        merge_kp_result = merge_kp_name(kp_coreects, user_id=user_uuid_for_log) # 传递 user_id
        merge_kp_result_json = json.dumps(merge_kp_result, ensure_ascii=False)
        

        insert_exam_knowledge_points(exam_take_id,total_score,merge_kp_result_json)

        # 在返回结果中添加用户信息和考试时间信息
        response_data = {
            'exam_id': exam_id,
            'user_id': user_id,
            'username': user_info['username'],
            'phone_number': user_info['phone_number'],
            'start_time': start_time.isoformat() if start_time else None,
            'submit_time': submit_time.isoformat(),
            'total_score': total_score,
            'merge_kp_result': merge_kp_result,
            'questions': results
        }
        
        return jsonify(response_data)
    except ValueError as e:
        if conn:
            conn.rollback()
        logger.error(f"Validation error in submit_exam_answer: {str(e)}")
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Error in submit_exam_answer: {str(e)}")
        return jsonify({'error': 'An internal server error occurred'}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

@app.route('/api/exams/<exam_id>', methods=['DELETE'])
def delete_exam(exam_id):
    try:
        # Validate exam_id is a valid UUID
        try:
            uuid.UUID(exam_id)
        except ValueError:
            return jsonify({'error': 'Invalid exam ID format'}), 400

        with get_db_connection() as conn:
            with conn.cursor() as cur:
                # First check if exam exists
                cur.execute("SELECT id FROM exampaper WHERE id = %s", (exam_id,))
                if cur.fetchone() is None:
                    return jsonify({'error': 'Exam not found'}), 404

                # Delete all answer records for this exam
                cur.execute("DELETE FROM answerrecord WHERE exam_paper_id = %s", (exam_id,))
                
                # Delete the exam paper
                cur.execute("DELETE FROM exampaper WHERE id = %s", (exam_id,))
                
                conn.commit()

        return jsonify({'message': 'Exam deleted successfully'}), 200

    except Exception as e:
        app.logger.error(f"Error deleting exam: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/users/login', methods=['POST'])
def login_or_register_user():
    data = request.get_json()
    phone_number = data.get('phone_number')
    username = data.get('username', '')

    # print("Received data====>:", data)

    if not phone_number:
        return jsonify({'error': '手机号不能为空'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 先查找是否存在该手机号的用户
        cur.execute('SELECT * FROM "user" WHERE phone_number = %s', (phone_number,))
        existing_user = cur.fetchone()
        print("Existing user:", existing_user)
    
        if existing_user:
            # 如果用户已存在，直接返回用户信息
            # 生成访问令牌
            # access_token = create_access_token(identity=existing_user['id'])
            access_token = create_token_with_role(existing_user['id'], existing_user['role'])
            return jsonify({
                'access_token': access_token,
                'user': {
                    'id': existing_user['id'],
                    'username': existing_user['username'],
                    'phone_number': existing_user['phone_number'],
                    'role': existing_user['role']
                }
            })
            
        
        # 如果用户不存在且没有提供用户名，返回404
        if not username:
            return jsonify({'error': 'user_not_found'}), 404
        print("到这里了")
        # 如果用户不存在且提供了用户名，创建新用户
        password = "123"
        cur.execute(
            'INSERT INTO "user" (username, phone_number,password) VALUES (%s, %s, %s) RETURNING id, username, phone_number, role',
            (username, phone_number,password)
        )
        new_user = cur.fetchone()
        conn.commit()
        # 生成访问令牌
        # access_token = create_access_token(identity=new_user['id'])
        access_token = create_token_with_role(new_user['id'], new_user['role'])
        
        return jsonify({
            'access_token': access_token,
                'user': {
                    'id': new_user['id'],
                    'username': new_user['username'],
                    'phone_number': new_user['phone_number'],
                    'role': new_user['role']
                }
        })

    except psycopg2.Error as e:
        conn.rollback()
        print('Error in login_or_register_user:', str(e))
        return jsonify({'error': '登录或注册失败'}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exam-records', methods=['GET'])
@jwt_required()
def get_exam_records():
    log.debug("开始获取考试记录列表")
    try:
        # 获取当前用户信息
        current_user_id = get_jwt_identity()
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # 获取用户角色
        cur.execute('SELECT "role" FROM "user" WHERE id = %s', (current_user_id,))
        user_role = cur.fetchone()['role']
        cur.close()
        
        search = request.args.get('search', '')

        query = """
            WITH ExamPaperQuestionCounts AS (
                SELECT
                    epq.exam_paper_id,
                    COUNT(DISTINCT epq.question_id) AS total_questions,
                    COUNT(DISTINCT CASE WHEN q.question_type = '单选题' THEN epq.question_id END) AS single_choice_total,
                    COUNT(DISTINCT CASE WHEN q.question_type = '多选题' THEN epq.question_id END) AS multi_choice_total
                FROM exampaperquestion epq
                JOIN question q ON epq.question_id = q.id
                GROUP BY epq.exam_paper_id
            )
            SELECT
                ep.id AS exam_paper_id,
                ep.title AS exam_title,
                ep.description AS exam_description,
                ar.user_id,
                ar.created_at AS exam_time,
                SUM(ar.score) AS total_score,
                SUM(CASE WHEN ar.score > 0 THEN 1 ELSE 0 END) AS correct_count,  -- 直接在主查询中计算
                epqc.total_questions,
                CASE
                    WHEN epqc.total_questions = 0 THEN 0.00
                    ELSE ROUND((CAST(SUM(CASE WHEN ar.score > 0 THEN 1 ELSE 0 END) AS DECIMAL) / epqc.total_questions) * 100, 2)
                END AS accuracy_rate,
                u.username AS user_name,
                u.phone_number,
                array_agg(DISTINCT tc.course_name) AS course_names,
                epqc.single_choice_total,
                SUM(CASE WHEN q.question_type = '单选题' AND ar.score = 1 THEN 1 ELSE 0 END) AS single_choice_correct,
                COALESCE(epqc.single_choice_total, 0) - SUM(CASE WHEN q.question_type = '单选题' AND ar.score = 1 THEN 1 ELSE 0 END) AS single_choice_incorrect,
                epqc.multi_choice_total,
                SUM(CASE WHEN q.question_type = '多选题' AND ar.score = 2 THEN 1 ELSE 0 END) AS multi_choice_correct,
                COALESCE(epqc.multi_choice_total, 0) - SUM(CASE WHEN q.question_type = '多选题' AND ar.score = 2 THEN 1 ELSE 0 END) AS multi_choice_incorrect,
                ar.exam_id AS exam_id
            FROM answerrecord ar
            JOIN exampaper ep ON ar.exam_paper_id = ep.id
            JOIN "user" u ON ar.user_id = u.id
            LEFT JOIN exampapercourse epc ON ep.id = epc.exam_paper_id
            LEFT JOIN trainingcourse tc ON epc.course_id = tc.id
            JOIN ExamPaperQuestionCounts epqc ON ep.id = epqc.exam_paper_id
            JOIN question q ON q.id = ar.question_id  -- 移动到这里
            WHERE
                CASE
                    WHEN %s != '' THEN
                        u.username ILIKE '%%' || %s || '%%' OR
                        u.phone_number ILIKE '%%' || %s || '%%'
                    ELSE TRUE
                END
                AND CASE
                    WHEN %s != 'admin' THEN ar.user_id = %s
                    ELSE TRUE
                END
            GROUP BY
                ep.id,
                ep.title,
                ep.description,
                ar.user_id,
                ar.exam_id,
                ar.created_at,  -- 加入到 GROUP BY
                u.username,
                u.phone_number,
                epqc.total_questions,
                epqc.single_choice_total,
                epqc.multi_choice_total
            ORDER BY ar.created_at DESC;
        """

        conn = get_db_connection()
        cur = conn.cursor()
        try:
            cur.execute(query, (search, search, search, user_role, current_user_id))
            records = cur.fetchall()

            result = []
            for record in records:
                exam_record = {
                    'exam_paper_id': record[0],
                    'exam_title': record[1],
                    'exam_description': record[2],
                    'user_id': record[3],
                    'exam_time': record[4].isoformat() if record[4] else None,
                    'total_score': float(record[5]) if record[5] is not None else 0.0,
                    'correct_count': record[6],
                    'total_questions': record[7],
                    'accuracy_rate': record[8]/100,
                    'user_name': record[9],
                    'phone_number': record[10],
                    'courses': record[11] if record[11] else [],
                    'single_choice_total': record[12],
                    'single_choice_correct': record[13],
                    'single_choice_incorrect': record[14],
                    'multi_choice_total': record[15],
                    'multi_choice_correct': record[16],
                    'multi_choice_incorrect': record[17],
                    'exam_id': record[18],
                }
                result.append(exam_record)

            return jsonify(result)
        finally:
            cur.close()
            conn.close()

    except Exception as e:
        print(f"Error in get_exam_records: {str(e)}")
        log.debug(f"Error in get_exam_records: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/questions', methods=['GET'])
def get_questions():
    print("开始获取题目列表")
    title = request.args.get('title', '')
    knowledge_point = request.args.get('knowledgePoint', '')
    course = request.args.get('course', '')
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 20))

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        conditions = []
        params = []

        if title:
            conditions.append("q.question_text ILIKE %s")
            params.append(f'%{title}%')

        if knowledge_point:
            conditions.append("kp.id = %s")
            params.append(knowledge_point)

        if course:
            conditions.append("tc.id = %s")
            params.append(course)

        where_clause = " AND ".join(conditions) if conditions else "TRUE"

        # 获取总记录数
        count_query = """
            SELECT COUNT(DISTINCT q.id)
            FROM question q
            LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            LEFT JOIN trainingcourse tc ON kp.course_id = tc.id
            WHERE """
        count_query += where_clause

        cur.execute(count_query, params)
        total = cur.fetchone()['count']

        # 获取分页数据
        query = """
            SELECT DISTINCT
                q.id,
                q.question_text,
                q.question_type,
                q.difficulty,
                q.created_at,
                q.updated_at,
                kp.id as knowledge_point_id,
                kp.point_name as knowledge_point_name,
                tc.id as course_id,
                tc.course_name,
                a.answer_text,
                a.explanation,
                a.source
            FROM question q
            LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            LEFT JOIN trainingcourse tc ON kp.course_id = tc.id
            LEFT JOIN answer a ON q.id = a.question_id
            WHERE """

        query += where_clause
        query += " ORDER BY q.created_at DESC, q.id ASC"
        query += " LIMIT %s OFFSET %s"

        # 添加分页参数
        params.extend([per_page, (page - 1) * per_page])

        cur.execute(query, params)
        questions = cur.fetchall()

        # 获取每个题目的选项
        for question in questions:
            cur.execute('''
                SELECT id, option_text, is_correct
                FROM option
                WHERE question_id = %s
                ORDER BY id ASC
            ''', (question['id'],))
            question['options'] = cur.fetchall()
        # print("API Response:questions", questions)
        return jsonify({
            'data': questions,
            'total': total,
            'page': page,
            'per_page': per_page,
            'total_pages': (total + per_page - 1) // per_page
        })
    except Exception as e:
        print("Error in get_questions:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# 自动保存答题进度的路由
@app.route('/api/exams/<exam_id>/temp-answers', methods=['POST'])
def save_temp_answer_route(exam_id):
    data = request.json
    user_id = data.get('user_id')
    question_id = data.get('question_id')
    selected_options = data.get('selected_options', [])
    
    return save_temp_answer(exam_id, user_id, question_id, selected_options)

@app.route('/api/exams/<exam_id>/temp-answers/<user_id>', methods=['GET'])
def get_temp_answers_route(exam_id, user_id):
    return get_temp_answers(exam_id, user_id)

@app.route('/api/exams/<exam_id>/temp-answers/<user_id>/submit', methods=['POST'])
def mark_temp_answers_submitted_route(exam_id, user_id):
    return mark_temp_answers_submitted(exam_id, user_id)

@app.route('/api/exam-records/<exam_id>/<user_id>', methods=['GET'])
def get_exam_record_detail(exam_id, user_id):
    print("开始获取考试记录详情，考试ID：", exam_id, "用户ID：", user_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        exam_time = request.args.get('exam_time')
        if not exam_time:
            return jsonify({'error': 'exam_time is required'}), 400
            
        # print("收到的考试时间：", exam_time)
        try:
            exam_time = exam_time.replace(' ', 'T')
            exam_time = exam_time.replace('Z', '+00:00')
            if '+' in exam_time and ':' not in exam_time.split('+')[1]:
                parts = exam_time.split('+')
                exam_time = f"{parts[0]}+{parts[1][:2]}:{parts[1][2:]}"
            # print("转换后的考试时间：", exam_time)
        except Exception as e:
            print("时间格式转换错误：", str(e))
            return jsonify({'error': '无效的时间格式'}), 400

        # 获取考试基本信息
        base_query = '''
            SELECT 
                e.id as exam_paper_id,
                e.title as exam_title,
                e.description as exam_description,
                u.id as user_id,
                u.username,
                u.phone_number,
                to_char(ar.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"TZH:TZM"') as exam_time,
                ROUND(CAST(AVG(ar.score)::float / COUNT(*) * 100 as numeric), 2) as total_score,
                COUNT(*) OVER (PARTITION BY e.id, u.id) as attempt_number,
                COALESCE(
                    (
                        SELECT jsonb_agg(jsonb_build_object(
                            'id', tc.id,
                            'name', tc.course_name
                        ))
                        FROM exampapercourse epc2
                        JOIN trainingcourse tc ON epc2.course_id = tc.id
                        WHERE epc2.exam_paper_id = e.id
                    ),
                    '[]'::jsonb
                ) as courses
            FROM answerrecord ar
            JOIN exampaper e ON ar.exam_paper_id = e.id
            JOIN "user" u ON ar.user_id = u.id
            WHERE ar.user_id = %s
            AND e.id = %s
            AND ar.created_at >= %s::timestamp with time zone
            AND ar.created_at < (%s::timestamp with time zone + INTERVAL '1 second')
            GROUP BY e.id, e.title, e.description, u.id, u.username, u.phone_number, ar.created_at
        '''
        
        cur.execute(base_query, [user_id, exam_id, exam_time, exam_time])
        exam_info = cur.fetchone()

        if not exam_info:
            return jsonify({'error': 'Exam record not found'}), 404

        # 获取答题详情
        detail_query = '''
            WITH option_numbers AS (
                SELECT 
                    id,
                    question_id,
                    ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id) - 1 as option_index
                FROM option
            ),
            debug_info AS (
                SELECT 
                    q.id,
                    q.question_text,
                    q.question_type,
                    a.explanation,
                    ar.selected_option_ids,
                    array_agg(o.id) FILTER (WHERE o.is_correct) as correct_option_ids,
                    array_length(ar.selected_option_ids, 1) as selected_length,
                    array_length(array_agg(o.id) FILTER (WHERE o.is_correct), 1) as correct_length,
                    CASE 
                        WHEN q.question_type = '单选题' THEN
                            CASE 
                                WHEN array_length(ar.selected_option_ids, 1) = 1 AND 
                                     ar.selected_option_ids = array_agg(o.id) FILTER (WHERE o.is_correct)
                                THEN true 
                                ELSE false 
                            END
                        ELSE
                            CASE 
                                WHEN ar.selected_option_ids @> array_agg(o.id) FILTER (WHERE o.is_correct) AND
                                     array_length(ar.selected_option_ids, 1) = array_length(array_agg(o.id) FILTER (WHERE o.is_correct), 1)
                                THEN true 
                                ELSE false 
                            END
                    END as is_correct,
                    json_agg(
                        json_build_object(
                            'id', o.id,
                            'text', replace(o.option_text, E'\\u2103', '°C'),
                            'is_correct', o.is_correct,
                            'char', CASE 
                                WHEN opt_num.option_index < 26 THEN 
                                    chr(65 + CAST(opt_num.option_index AS INTEGER))
                                ELSE 
                                    CAST(opt_num.option_index + 1 AS TEXT)
                            END
                        ) ORDER BY opt_num.option_index
                    ) as options,
                    c.course_name,
                    kp.point_name as knowledge_point,
                    MIN(epq.created_at) as question_order
                FROM question q
                JOIN exampaperquestion epq ON q.id = epq.question_id
                JOIN answerrecord ar ON epq.exam_paper_id = ar.exam_paper_id AND q.id = ar.question_id
                JOIN option o ON q.id = o.question_id
                JOIN option_numbers opt_num ON o.id = opt_num.id
                JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
                JOIN trainingcourse c ON kp.course_id = c.id
                LEFT JOIN answer a ON q.id = a.question_id
                WHERE ar.user_id = %s
                AND epq.exam_paper_id = %s
                AND ar.created_at >= %s::timestamp with time zone
                AND ar.created_at < (%s::timestamp with time zone + INTERVAL '1 second')
                GROUP BY q.id, q.question_text, q.question_type, a.explanation, ar.selected_option_ids, c.course_name, kp.point_name
            )
            SELECT 
                *,
                json_build_object(
                    'question_text', question_text,
                    'question_type', question_type,
                    'selected_option_ids', selected_option_ids,
                    'correct_option_ids', correct_option_ids,
                    'selected_length', selected_length,
                    'correct_length', correct_length,
                    'is_correct', is_correct
                ) as debug_output
            FROM debug_info
            ORDER BY question_order;
        '''
        
        detail_params = [user_id, exam_id, exam_time, exam_time]
        cur.execute(detail_query, detail_params)
        questions = cur.fetchall()
        
        # 合并考试信息和题目信息
        response_data = dict(exam_info)
        response_data['questions'] = questions
        
        return jsonify(response_data)
    except Exception as e:
        print('Error in get_exam_record_detail:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses/knowledge-points', methods=['GET'])
def get_courses_knowledge_points():
    print("开始获取课程知识点列表")
    course_ids = request.args.get('course_ids', '')
    if not course_ids:
        return jsonify({'error': '课程ID不能为空'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        course_id_list = course_ids.split(',')
        # print("Fetching knowledge points for courses:", course_id_list)
        
        query = "WITH questioncounts AS (SELECT q.knowledge_point_id, SUM(CASE WHEN q.question_type = '单选题' THEN 1 ELSE 0 END) as single_count, SUM(CASE WHEN q.question_type = '多选题' THEN 1 ELSE 0 END) as multiple_count FROM question q GROUP BY q.knowledge_point_id) SELECT kp.id, kp.point_name as name, kp.course_id, COALESCE(qc.single_count, 0)::integer as single_count, COALESCE(qc.multiple_count, 0)::integer as multiple_count FROM knowledgepoint kp LEFT JOIN questioncounts qc ON kp.id = qc.knowledge_point_id WHERE kp.course_id::text = ANY(%s) ORDER BY kp.point_name"
        
        cur.execute(query, (course_id_list,))
        points = cur.fetchall()
        print("SQL query executed successfully")
        # print("Knowledge points found:", len(points))
        # print("First point example:", points[0] if points else "No points found")
        return jsonify(points)
    except Exception as e:
        print('Error in get_courses_knowledge_points:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams/<exam_id>', methods=['PATCH'])
def patch_exam(exam_id):
    print("开始更新考卷基本信息，考卷ID：", exam_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        data = request.json
        title = data.get('title')
        description = data.get('description', '')
        
        if not title:
            return jsonify({'error': '考卷标题不能为空'}), 400
            
        # 检查考卷是否存在
        cur.execute('SELECT id FROM exampaper WHERE id = %s', (exam_id,))
        if not cur.fetchone():
            return jsonify({'error': '考卷不存在'}), 404
            
        # 更新考卷基本信息
        cur.execute('''
            UPDATE exampaper
            SET title = %s,
                description = %s,
                updated_at = NOW()
            WHERE id = %s
            RETURNING id, title, description, updated_at
        ''', (title, description, exam_id))
        
        updated_exam = cur.fetchone()
        conn.commit()
        return jsonify(updated_exam)
    except Exception as e:
        conn.rollback()
        print('Error in patch_exam:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/evaluation/<evaluation_id>', methods=['GET'])
def get_evaluation_detail(evaluation_id):
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # --- 第 1 步: 获取评价主信息和层级评分结构 ---
        # (这里的 SQL 假设是您原来用于构建层级结构的 SQL，可能很复杂)
        # 我们需要确保这个 SQL 能正确获取 evaluation 主信息 和 aspects/categories/items/scores
        # 为了演示，这里使用一个简化的方式，先获取主信息，再获取层级结构
        sql_main = """
            SELECT
                e.id,
                e.evaluation_time,
                e.additional_comments,
                COALESCE(u1.username, c.first_name) AS evaluator_name,
                COALESCE(u1.role, c.title) AS evaluator_title,
                CASE
                    WHEN e.evaluator_user_id IS NOT NULL THEN 'internal'
                    WHEN e.evaluator_customer_id IS NOT NULL THEN 'client'
                    ELSE 'unknown'
                END AS evaluation_type,
                COALESCE(AVG(ed.score), 0.0) AS average_score
            FROM evaluation AS e
            LEFT JOIN evaluation_detail AS ed ON e.id = ed.evaluation_id
            LEFT JOIN "user" AS u1 ON e.evaluator_user_id = u1.id
            LEFT JOIN customer AS c ON e.evaluator_customer_id = c.id
            WHERE e.id = %s
            GROUP BY e.id, e.evaluation_time, e.additional_comments, evaluator_name, evaluator_title, evaluation_type
        """
        params_main = (evaluation_id,)
        print(f"--- Executing SQL for main evaluation info ---")
        print(f"SQL: {sql_main}")
        print(f"Params: {params_main}")
        cur.execute(sql_main, params_main)
        evaluation_main = cur.fetchone()
        print(f"Main info fetched: {evaluation_main}")

        if not evaluation_main:
            return jsonify({'error': '未找到评价记录'}), 404

        # --- Step 2: Fetch data in separate queries ---

        # Step 2.1: Fetch base structure (Aspects and Categories relevant to this evaluation)
        # Relevant categories are those containing items with scores OR those with manual input for this evaluation.
        cur.execute("""
            SELECT DISTINCT
                ea.id as aspect_id, ea.aspect_name, ea.sort_order as aspect_sort_order,
                ec.id as category_id, ec.category_name, ec.allow_manual_input, ec.sort_order as category_sort_order
            FROM evaluation_aspect ea
            JOIN evaluation_category ec ON ea.id = ec.aspect_id
            WHERE ec.id IN (
                SELECT DISTINCT ei.category_id
                FROM evaluation_item ei
                JOIN evaluation_detail ed ON ei.id = ed.item_id
                WHERE ed.evaluation_id = %s AND ed.score IS NOT NULL
            ) OR ec.id IN (
                SELECT DISTINCT emi.category_id
                FROM evaluation_manual_input emi
                WHERE emi.evaluation_id = %s
            )
            ORDER BY aspect_sort_order, category_sort_order
        """, (evaluation_id, evaluation_id))
        structure_rows = cur.fetchall()

        # Step 2.2: Fetch only scored items for this evaluation
        cur.execute("""
            SELECT ei.category_id, ei.id as item_id, ei.item_name, ei.description as item_description, ed.score
            FROM evaluation_item ei
            JOIN evaluation_detail ed ON ei.id = ed.item_id
            WHERE ed.evaluation_id = %s AND ed.score IS NOT NULL
            ORDER BY ei.sort_order
        """, (evaluation_id,))
        scored_items_rows = cur.fetchall()
        # Group scored items by category_id for easier lookup
        scored_items_by_category = {}
        for item_row in scored_items_rows:
            cat_id = str(item_row['category_id'])
            if cat_id not in scored_items_by_category:
                scored_items_by_category[cat_id] = []
            scored_items_by_category[cat_id].append({
                "id": str(item_row['item_id']),
                "name": item_row['item_name'],
                "description": item_row['item_description'],
                "average_score": item_row['score']
            })

        # Step 2.3: Fetch manual inputs for this evaluation
        cur.execute("""
            SELECT category_id, manual_input
            FROM evaluation_manual_input
            WHERE evaluation_id = %s
        """, (evaluation_id,))
        manual_inputs_raw = cur.fetchall()
        # Group manual inputs by category_id
        manual_inputs_for_category = {str(row['category_id']): row['manual_input'] for row in manual_inputs_raw}

        # Step 2.4: Build the final hierarchical structure in Python
        final_aspects_map = {}
        for row in structure_rows:
            aspect_id = str(row['aspect_id'])
            category_id = str(row['category_id'])

            # Initialize aspect if not present
            if aspect_id not in final_aspects_map:
                final_aspects_map[aspect_id] = {
                    "id": aspect_id,
                    "name": row['aspect_name'],
                    "sort_order": row['aspect_sort_order'],
                    "categories": {}
                }

            # Initialize category if not present within the aspect
            if category_id not in final_aspects_map[aspect_id]['categories']:
                 # Get scored items for this category (defaults to empty list if none)
                items_for_this_category = scored_items_by_category.get(category_id, [])
                 # Calculate average score for the category based *only* on scored items
                valid_scores = [item['average_score'] for item in items_for_this_category]
                avg_score = sum(valid_scores) / len(valid_scores) if valid_scores else 0.0

                final_aspects_map[aspect_id]['categories'][category_id] = {
                    "id": category_id,
                    "name": row['category_name'],
                    "allow_manual_input": row['allow_manual_input'],
                    "sort_order": row['category_sort_order'],
                    "items": items_for_this_category, # Assign the list of scored items
                    "manual_input": manual_inputs_for_category.get(category_id), # Assign manual input
                    "average_score": avg_score
                }

        # Step 2.5: Convert map to list and calculate overall aspect average scores
        aspects_list = []
        for aspect_id, aspect_data in final_aspects_map.items():
            # Convert categories dict to sorted list
            categories_list = sorted(list(aspect_data['categories'].values()), key=lambda x: x.get('sort_order', 0))
            aspect_data['categories'] = categories_list

            # Calculate aspect average score based on the scored items within its categories
            all_aspect_scores = [item['average_score'] for cat in categories_list for item in cat['items']]
            aspect_data['average_score'] = sum(all_aspect_scores) / len(all_aspect_scores) if all_aspect_scores else 0.0
            aspects_list.append(aspect_data)

        # --- Step 3: Combine main info with processed structure and return ---
        result = {
            # **evaluation_main, # Merge main evaluation info
            "aspects": sorted(aspects_list, key=lambda x: x.get('sort_order', 0)) # Add the processed aspects list
        }

        return jsonify(result)

    except Exception as e:
        print(f"Error in get_evaluation_detail: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
    finally:
        if cur: cur.close()
        if conn: conn.close()

# --- 修改 POST /api/evaluation 路由 ---
@app.route('/api/evaluation', methods=['POST'])
def create_evaluation_route():
    data = request.get_json()
    print("--- Received Evaluation Data ---") # 打印请求体
    print(data)
    print("-------------------------------")

    # 验证基础数据
    if not data or 'evaluated_user_id' not in data or \
       ('item_scores' not in data and 'category_manual_inputs' not in data): # *** 使用 category_manual_inputs ***
        print("Validation Error: Missing required data")
        return jsonify({'error': '缺少必要的评价数据'}), 400

    evaluated_user_id = data['evaluated_user_id']
    evaluation_type = data.get('evaluation_type', 'internal')
    additional_comments = data.get('additional_comments', '')
    item_scores = data.get('item_scores', [])
    category_manual_inputs = data.get('category_manual_inputs', {}) # *** 获取 category 手动输入 ***

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        print("Database connection obtained.")
        # 使用事务确保原子性
        with conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                print("Transaction started.")

                evaluator_user_id = None
                evaluator_customer_id = None

                # 处理评价者信息
                if evaluation_type == 'internal':
                    evaluator_user_id = data.get('evaluator_user_id')
                    if not evaluator_user_id:
                        print("Validation Error: Missing evaluator_user_id for internal evaluation.")
                        return jsonify({'error': '内部评价需要评价者用户ID'}), 400
                    print(f"Internal evaluation by user: {evaluator_user_id}")
                elif evaluation_type == 'client':
                    client_name = data.get('client_name')
                    if not client_name:
                         print("Validation Error: Missing client_name for client evaluation.")
                         return jsonify({'error': '客户评价需要客户姓名'}), 400
                    # 创建客户记录 (如果需要创建)
                    cur.execute("""
                        INSERT INTO customer (first_name, title) VALUES (%s, %s) RETURNING id
                    """, (client_name, data.get('client_title', '')))
                    evaluator_customer_id = cur.fetchone()['id']
                    print(f"Client evaluation, created/found customer: {evaluator_customer_id}")
                else:
                    print(f"Validation Error: Invalid evaluation_type: {evaluation_type}")
                    return jsonify({'error': '无效的评价类型'}), 400

                # 1. 插入 evaluation 主记录
                print("Inserting into evaluation table...")
                sql_evaluation = """
                    INSERT INTO evaluation
                    (evaluated_user_id, evaluator_user_id, evaluator_customer_id, additional_comments, evaluation_time, updated_at)
                    VALUES (%s, %s, %s, %s, NOW(), NOW())
                    RETURNING id
                """
                params_evaluation = (evaluated_user_id, evaluator_user_id, evaluator_customer_id, additional_comments)
                print(f"  SQL: {sql_evaluation}")
                print(f"  Params: {params_evaluation}")
                cur.execute(sql_evaluation, params_evaluation)
                evaluation_id = cur.fetchone()['id']
                print(f"Inserted evaluation record with ID: {evaluation_id}")

                # 2. 插入 item scores 到 evaluation_detail
                if item_scores:
                    print("Processing item scores...")
                    values_str_detail = []
                    params_detail = []
                    for score_data in item_scores:
                        score_val = score_data.get('score')
                        item_id = score_data.get('item_id')
                        if item_id is not None and score_val is not None and score_val != '':
                             try:
                                score_int = int(score_val)
                                print(f"  Adding item score: item_id={item_id}, score={score_int}")
                                values_str_detail.append("(%s, %s, %s)")
                                params_detail.extend([evaluation_id, item_id, score_int])
                             except (ValueError, TypeError):
                                 print(f"  Skipping invalid score for item {item_id}: {score_val}")
                                 continue
                        else:
                            print(f"  Skipping empty score for item {item_id}")

                    if params_detail:
                        sql_detail = "INSERT INTO evaluation_detail (evaluation_id, item_id, score) VALUES " + ", ".join(values_str_detail)
                        # *** 打印最终的 SQL 和 参数 ***
                        print(f"  Executing SQL for evaluation_detail:")
                        print(f"    SQL: {sql_detail}")
                        print(f"    Params: {tuple(params_detail)}")
                        cur.execute(sql_detail, tuple(params_detail))
                        print(f"  Inserted {len(values_str_detail)} item score(s).")
                    else:
                        print("  No valid item scores to insert.")
                else:
                    print("No item scores provided.")

                # 3. 插入 category manual inputs 到 evaluation_manual_input
                if category_manual_inputs: # *** 检查 category_manual_inputs ***
                    print("Processing category manual inputs...")
                    allowed_category_ids = set() # *** 重命名变量 ***
                    print("  Fetching allowed category IDs...")
                    cur.execute("SELECT id FROM evaluation_category WHERE allow_manual_input = TRUE")
                    fetched_allowed_ids = cur.fetchall()
                    for row in fetched_allowed_ids:
                        allowed_category_ids.add(str(row['id']))
                    print(f"  Allowed category IDs: {allowed_category_ids}")

                    values_str_manual = []
                    params_manual = []
                    for category_id, input_data in category_manual_inputs.items(): # *** 确认是 category_id ***
                        category_id_str = str(category_id)
                        is_allowed = category_id_str in allowed_category_ids
                        print(f"  Processing category_id: {category_id_str}, Allowed: {is_allowed}, Input: {input_data}")

                        # *** 处理输入可能是单个字符串或字符串列表 ***
                        input_list = []
                        if isinstance(input_data, str): # 如果前端只传单个字符串
                             input_list = [input_data]
                        elif isinstance(input_data, list): # 如果前端传列表 (为未来多条评论做准备)
                             input_list = input_data
                        else:
                             print(f"  Skipping invalid input type for category {category_id_str}")
                             continue

                        if is_allowed:
                            for manual_input in input_list:
                                if manual_input and manual_input.strip():
                                    print(f"    Adding manual input: '{manual_input.strip()}'")
                                    values_str_manual.append("(%s, %s, %s)")
                                    params_manual.extend([evaluation_id, category_id, manual_input.strip()]) # *** 使用 category_id ***
                                else:
                                    print(f"    Skipping empty manual input.")
                        else:
                            print(f"    Skipping category {category_id_str} as manual input is not allowed.")


                    if params_manual:
                        sql_manual = "INSERT INTO evaluation_manual_input (evaluation_id, category_id, manual_input) VALUES " + ", ".join(values_str_manual)
                        # *** 打印最终的 SQL 和 参数 ***
                        print(f"  Executing SQL for evaluation_manual_input:")
                        print(f"    SQL: {sql_manual}")
                        print(f"    Params: {tuple(params_manual)}")
                        cur.execute(sql_manual, tuple(params_manual))
                        print(f"  Inserted {len(values_str_manual)} manual input(s).")
                    else:
                        print("  No valid manual inputs to insert.")
                else:
                    print("No category manual inputs provided.")

        print("Transaction committed.")
        # conn.commit() # 由 with conn 处理
        return jsonify({'success': True, 'message': '评价提交成功', 'id': evaluation_id}), 201

    except Exception as e:
        # if conn: conn.rollback() # 由 with conn 处理
        print(f'Error in create_evaluation_route: {str(e)}') # 打印简洁错误
        traceback.print_exc() # 打印完整堆栈
        return jsonify({'error': '评价提交失败: ' + str(e)}), 500
    finally:
        # if conn: conn.close() # 由 with conn 处理
        print("Finishing create_evaluation_route.")
        pass

@app.route('/api/evaluation/<evaluation_id>', methods=['PUT'])
def update_evaluation_route(evaluation_id):
    data = request.get_json()
    if not data:
        return jsonify({'error': '缺少必要的评价数据'}), 400

    print("--- Received Update Evaluation Data ---") # 打印请求体
    print(data)
    print("---------------------------------------")

    try:
        result =  update_evaluation(evaluation_id, data)
        return result # 直接返回 update_evaluation 的结果 (可能是成功消息或错误)

    except Exception as e:
        # if conn: conn.rollback() # 由 with conn 处理
        print(f'Error in update_evaluation_route: {str(e)}')
        traceback.print_exc()
        return jsonify({'error': '评价更新失败: ' + str(e)}), 500
    finally:
        # if conn: conn.close() # 由 with conn 处理
        pass

@app.route('/api/evaluation/<evaluation_id>', methods=['DELETE'])
def delete_evaluation_route(evaluation_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查评价是否存在
        cur.execute('SELECT id FROM evaluation WHERE id = %s', (evaluation_id,))
        if not cur.fetchone():
            return jsonify({'error': '评价记录不存在'}), 404

        # 删除评价详情记录
        cur.execute('DELETE FROM evaluation_detail WHERE evaluation_id = %s', (evaluation_id,))
        
        # 删除评价主记录
        cur.execute('DELETE FROM evaluation WHERE id = %s', (evaluation_id,))
        
        conn.commit()
        return jsonify({'message': '评价删除成功'})
    except Exception as e:
        conn.rollback()
        print('Error in delete_evaluation:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/users/sync', methods=['POST'])
def user_sync_api():
    """用户数据同步API，供其他业务系统调用"""
    return sync_user()

@app.route('/api/ai-generate', methods=['POST'])
@jwt_required() # <--- 这个装饰器是关键
def ai_generate_route():
    current_user_id_str = get_jwt_identity() 
    current_user_id_for_log = None
    if current_user_id_str:
        try:
            current_user_id_for_log = uuid.UUID(current_user_id_str) 
        except ValueError:
            current_app.logger.warning(f"无法将JWT identity '{current_user_id_str}' 转换为UUID")
    try:
        data = request.get_json()
        print('后端接收到的AI评价数据:', data)
        # log.debug('后端接收到的AI评价数据:', data)
        if not data or 'evaluations' not in data:
            return jsonify({'error': '缺少评价数据'}), 400

        # 从evaluations对象中提取evaluated_user_id
        evaluated_user_id = data['evaluations'].get('evaluated_user_id')
        if not evaluated_user_id:
            return jsonify({'error': '缺少用户ID'}), 400

        from backend.api.ai_generate import generate
        # result = generate(data['evaluations'])
        result = generate(data['evaluations'], user_id=current_user_id_for_log) # 传递 user_id

        
        # 将AI生成的结果保存到user_profile表
        if result:
            # print('AI生成结果，准备写入数据库:', result)
            # log.debug('AI生成结果，准备写入数据库:', result)
            conn = get_db_connection()
            cur = conn.cursor(cursor_factory=RealDictCursor)
            try:
                # 检查是否已存在用户记录
                # 将Python字典转换为JSON字符串
                import json
                profile_data = json.dumps(result)
                
                cur.execute("""
                    INSERT INTO user_profile (user_id, profile_data)
                    VALUES (%s, %s)
                    ON CONFLICT (user_id)
                    DO UPDATE SET profile_data = %s
                    RETURNING user_id
                """, (evaluated_user_id, profile_data, profile_data))
                
                conn.commit()
                # print('AI生成结果已保存到user_profile')
                return jsonify(result)
            except Exception as db_error:
                conn.rollback()
                print('Error saving to user_profile:', str(db_error))
                log.debug('Error saving to user_profile:', str(db_error))
                return jsonify({'error': '保存用户资料失败'}), 500
            finally:
                cur.close()
                conn.close()
        return jsonify({'error': 'AI生成结果为空'}), 500
    except Exception as e:
        print('Error in ai_generate:', str(e))
        log.debug('Error in ai_generate:', str(e))
        return jsonify({'error': str(e)}), 500

@app.route('/api/user-exams/knowledge-point-summary/<exam_id>', methods=['GET'])
def get_knowledge_point_summary(exam_id):
    print("exam_id===",exam_id)
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        query = """
            SELECT knowledge_point_summary from exam WHERE id = %s
        """
        cur.execute(query, (exam_id,))
        records = cur.fetchall()
        return jsonify(records)
    except Exception as e:
        raise
    else:
        pass
    finally:
        pass





@app.route('/api/user-exams/employee-profile/<user_id>', methods=['GET'])
# @jwt_required()
def get_user_exams(user_id):
    print("开始获取用户考试记录，用户ID：", user_id)
    try:
        # 获取当前用户信息
        # current_user_id = get_jwt_identity()
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # # 获取用户角色
        # cur.execute('SELECT "role" FROM "user" WHERE id = %s', (current_user_id,))
        # user_role = cur.fetchone()['role']
        
        # # 如果不是管理员且不是查询自己的记录，则返回权限错误
        # if user_role != 'admin' and str(current_user_id) != user_id:
        #     return jsonify({'error': '没有权限访问其他用户的考试记录'}), 403

        query = """
            WITH ExamPaperQuestionCounts AS (
                SELECT
                    epq.exam_paper_id,
                    COUNT(DISTINCT epq.question_id) AS total_questions,
                    COUNT(DISTINCT CASE WHEN q.question_type = '单选题' THEN epq.question_id END) AS single_choice_total,
                    COUNT(DISTINCT CASE WHEN q.question_type = '多选题' THEN epq.question_id END) AS multi_choice_total
                FROM exampaperquestion epq
                JOIN question q ON epq.question_id = q.id
                GROUP BY epq.exam_paper_id
            )
            SELECT DISTINCT
                ep.id as exam_paper_id,
                ep.title as exam_title,
                ep.description as exam_description,
                ar.exam_id as exam_id,
                ar.created_at as exam_time,
                SUM(ar.score) AS total_score,
                SUM(CASE WHEN ar.score > 0 THEN 1 ELSE 0 END) AS correct_count,
                epqc.total_questions,
                CASE
                    WHEN epqc.total_questions = 0 THEN 0.00
                    ELSE ROUND((CAST(SUM(CASE WHEN ar.score > 0 THEN 1 ELSE 0 END) AS DECIMAL) / epqc.total_questions) * 100, 2)
                END AS accuracy_rate,
                array_agg(DISTINCT tc.course_name) as course_names,
                epqc.single_choice_total,
                SUM(CASE WHEN q.question_type = '单选题' AND ar.score = 1 THEN 1 ELSE 0 END) AS single_choice_correct,
                COALESCE(epqc.single_choice_total, 0) - SUM(CASE WHEN q.question_type = '单选题' AND ar.score = 1 THEN 1 ELSE 0 END) AS single_choice_incorrect,
                epqc.multi_choice_total,
                SUM(CASE WHEN q.question_type = '多选题' AND ar.score = 2 THEN 1 ELSE 0 END) AS multi_choice_correct,
                COALESCE(epqc.multi_choice_total, 0) - SUM(CASE WHEN q.question_type = '多选题' AND ar.score = 2 THEN 1 ELSE 0 END) AS multi_choice_incorrect
            FROM answerrecord ar
            JOIN exampaper ep ON ar.exam_paper_id = ep.id
            JOIN question q ON q.id = ar.question_id
            LEFT JOIN exampapercourse epc ON ep.id = epc.exam_paper_id
            LEFT JOIN trainingcourse tc ON epc.course_id = tc.id
            JOIN ExamPaperQuestionCounts epqc ON ep.id = epqc.exam_paper_id
            WHERE ar.user_id = %s
            GROUP BY ep.id, ep.title, ep.description, ar.created_at, epqc.total_questions, epqc.single_choice_total, epqc.multi_choice_total, ar.exam_id
            ORDER BY ar.created_at DESC
        """
        


        cur.execute(query, (user_id,))
        records = cur.fetchall()
        
        result = []
        for record in records:
            exam_record = {
                'exam_paper_id': record['exam_paper_id'],
                'exam_id': record['exam_id'],
                'exam_title': record['exam_title'],
                'exam_description': record['exam_description'],
                'exam_time': record['exam_time'].isoformat() if record['exam_time'] else None,
                'total_score': float(record['total_score']) if record['total_score'] is not None else 0.0,
                'correct_count': record['correct_count'],
                'total_questions': record['total_questions'],
                'accuracy_rate': float(record['accuracy_rate'])/100 if record['accuracy_rate'] is not None else 0.0,
                'course_names': [course for course in record['course_names'] if course is not None],
                'single_choice': {
                    'total': record['single_choice_total'],
                    'correct': record['single_choice_correct'],
                    'incorrect': record['single_choice_incorrect']
                },
                'multi_choice': {
                    'total': record['multi_choice_total'],
                    'correct': record['multi_choice_correct'],
                    'incorrect': record['multi_choice_incorrect']
                }
            }
            result.append(exam_record)
            
        return jsonify(result)
    except Exception as e:
        print('Error in get_user_exams:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/avatars/<string:filename>', methods=['GET'])
# 这个路由通常不需要认证，因为头像是公开展示的
# @jwt_required(optional=True)
def serve_avatar_data(filename):
    """
    从后端数据目录服务用户头像文件
    """
    avatar_folder = get_avatar_folder()
    user_avatar_path = os.path.join(avatar_folder, filename)
    try:
        # 安全检查：确保请求的文件名格式正确，防止路径遍历攻击
        # 这里的检查是基于您的文件名约定 "<user_id>-avatar.jpg"
        if not filename.endswith('-avatar.jpg'):
             return jsonify({'error': '无效的文件名格式'}), 400
        # 1. 检查特定用户头像文件是否存在
        if os.path.exists(user_avatar_path):
            # 如果文件存在，服务它
            current_app.logger.info(f"Serving avatar: {filename}")
            # send_from_directory 会处理文件的读取和发送，
            # 如果过程中发生其他文件系统错误，它会抛出异常，被下面的 Exception 捕获
            return send_from_directory(avatar_folder, filename, as_attachment=False, mimetype='image/jpeg')
        else:
            # 2. 如果文件不存在，快速返回 404
            current_app.logger.info(f"Avatar not found: {filename}. Returning 404.")
            return jsonify({'error': 'Avatar not found'}), 404 # Explicitly return 404

    except FileNotFoundError:
        # 如果文件不存在，返回默认头像或404
        # 你可以在这里返回一个默认头像图片文件
        # 例如: return send_from_directory(app.static_folder, 'default-avatar.jpg'), 404
        # 为了简单，这里先返回一个JSON错误
        print(f"头像文件未找到: {os.path.join(AVATAR_DATA_FOLDER, filename)}")
        return jsonify({'error': '头像未找到'}), 404
    except Exception as e:
        print(f"Error serving avatar data: {str(e)}")
        return jsonify({'error': f'服务头像失败: {str(e)}'}), 500

# 获取 TTS 音频文件的存储基路径的函数
def get_tts_audio_storage_path():
    return current_app.config.get('TTS_AUDIO_STORAGE_PATH', os.path.join(current_app.root_path, 'static', 'tts_audio'))
@app.route('/media/tts_audio/<path:filepath>') # 使用一个新的基础路径，例如 /media/tts_audio
@jwt_required(optional=True) # 可选：如果需要认证才能访问音频
def serve_tts_audio(filepath):
    # 安全性：严格控制 filepath，防止路径遍历
    # filepath 应该是 TtsAudio.file_path 中存储的相对路径
    # 例如：<uuid:training_content_id>/<uuid:sentence_id>/sentence_v1_timestamp.wav
    
    storage_base_path = get_tts_audio_storage_path()
    
    # 进一步的路径安全检查 (非常重要)
    # 确保 filepath 不包含 '..' 等可能导致目录遍历的字符
    # normpath 会处理 '..' 但不能完全防止恶意输入
    safe_path = os.path.normpath(filepath)
    if '..' in safe_path or safe_path.startswith('/'): # 检查是否尝试跳出允许的目录
        current_app.logger.warning(f"潜在的路径遍历尝试: {filepath}")
        return jsonify({'error': '无效的文件路径'}), 400

    full_path_to_file = os.path.join(storage_base_path, safe_path)
    
    # 再次确认文件在预期的目录下 (额外的安全层)
    if not full_path_to_file.startswith(os.path.abspath(storage_base_path)):
        current_app.logger.warning(f"路径遍历攻击检测: 请求路径 {full_path_to_file} 超出基础路径 {storage_base_path}")
        return jsonify({'error': '非法文件访问'}), 403

    if not os.path.exists(full_path_to_file):
        current_app.logger.warning(f"请求的音频文件未找到: {full_path_to_file}")
        return jsonify({'error': '文件未找到'}), 404
        
    try:
        # send_from_directory 会自动处理 Content-Type
        # directory 参数应该是文件的父目录，filename 是文件名
        directory = os.path.dirname(full_path_to_file)
        filename = os.path.basename(full_path_to_file)
        current_app.logger.info(f"Serving audio file: directory='{directory}', filename='{filename}'")
        return send_from_directory(directory, filename, as_attachment=False) # as_attachment=False 表示浏览器直接播放
    except Exception as e:
        current_app.logger.error(f"服务音频文件 {filepath} 时出错: {e}", exc_info=True)
        return jsonify({'error': '服务文件时出错'}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
