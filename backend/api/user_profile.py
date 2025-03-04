from flask import jsonify
from backend.db import get_db_connection
from psycopg2.extras import RealDictCursor

from flask import request

def get_user_profile(user_id):
    # 检查是否为公开访问模式
    public_mode = request.args.get('public') == 'true'
    if not public_mode:
        # 非公开访问模式需要JWT验证
        from flask_jwt_extended import verify_jwt_in_request
        verify_jwt_in_request()
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
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
        
        if not result:
            return jsonify({'error': '未找到用户详细信息'}), 404

        # 构建返回数据
        response_data = {}
        response_data.update(result['profile_data'])
        response_data['avatar'] = result['avatar']
        if result['myms_user_id']:
            response_data['employee_show_url'] = f"https://www.mengyimengsao.com/employee_show.php?id={result['myms_user_id']}"
            
        return jsonify(response_data), 200
    except Exception as e:
        print('Error in get_user_profile:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()