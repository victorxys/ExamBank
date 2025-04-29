# backend/api/user_profile.py
from flask import jsonify
from backend.db import get_db_connection # 导入的是新的上下文管理器版本
from psycopg2.extras import RealDictCursor
from flask import request
from flask_jwt_extended import verify_jwt_in_request
import time
import logging # 添加 logging

log = logging.getLogger(__name__) # 获取 logger 实例



def get_user_profile(user_id):
    start_total_time = time.time() # 记录函数开始时间
    log.debug(f"开始处理 get_user_profile for user_id: {user_id}") # 使用 logger


    # 检查是否为公开访问模式
    public_mode = request.args.get('public') == 'true'
    if not public_mode:
        try:
            verify_jwt_in_request()
        except Exception as jwt_error:
             log.warning(f"JWT 验证失败 for user_id {user_id}: {str(jwt_error)}")
             return jsonify({'error': '未授权或Token无效'}), 401
    
    try:
        # --- 计时开始：获取连接 ---
        start_conn_time = time.time()
        conn = get_db_connection() 
        end_conn_time = time.time()
        connection_time_ms = (end_conn_time - start_conn_time) * 1000
        print(f"--- DB Connection time: {connection_time_ms:.2f} ms ---")
        # --- 计时结束：获取连接 ---

        # --- 计时开始：执行查询 ---
        start_query_time = time.time()
        cur = conn.cursor(cursor_factory=RealDictCursor) 
        # 查询用户详细信息和头像
        cur.execute("""
            SELECT 
                up.profile_data,
                u.avatar,
                u.myms_user_id
            FROM user_profile up
            LEFT JOIN "user" u ON u.id = up.user_id
            WHERE up.user_id = %s
        """, (user_id,))
        result = cur.fetchone()
        
        end_query_time = time.time()
        query_time_ms = (end_query_time - start_query_time) * 1000
        print(f"--- DB Query execution time: {query_time_ms:.2f} ms ---")
         # --- 计时结束：执行查询 ---
        
        if not result:
            return jsonify({'error': '未找到用户详细信息'}), 404
 
        # --- 计时开始：数据处理 ---
        start_processing_time = time.time()
        # 构建返回数据
        response_data = {}
        response_data.update(result['profile_data'])
        # 从avatar文件夹获取头像
        avatar_path = f"data/avatar/{user_id}-avatar.jpg"
        # src={`${API_BASE_URL}/avatars/${userId}-avatar.jpg`}
        response_data['avatar'] = avatar_path
        if result['myms_user_id']:
            response_data['employee_show_url'] = f"https://www.mengyimengsao.com/employee_show.php?id={result['myms_user_id']}"
        
        end_processing_time = time.time()
        processing_time_ms = (end_processing_time - start_processing_time) * 1000
        print(f"--- Data processing time: {processing_time_ms:.2f} ms ---")
        # --- 计时结束：数据处理 ---    
        return jsonify(response_data), 200
    except Exception as e:
        print('Error in get_user_profile:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()
        end_total_time = time.time() # 记录函数结束时间
        total_time_ms = (end_total_time - start_total_time) * 1000
        print(f"--- Total get_user_profile function time: {total_time_ms:.2f} ms ---")