from flask import jsonify
from backend.db import get_db_connection
from psycopg2.extras import RealDictCursor

def get_user_profile(user_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 查询用户详细信息
        cur.execute(
            'SELECT profile_data FROM user_profile WHERE user_id = %s',
            (user_id,)
        )
        profile = cur.fetchone()
        
        if not profile:
            return jsonify({'error': '未找到用户详细信息'}), 404
            
        return jsonify(profile['profile_data']), 200
    except Exception as e:
        print('Error in get_user_profile:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()