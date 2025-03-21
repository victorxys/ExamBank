from flask import jsonify
from psycopg2.extras import RealDictCursor
from ..db import get_db_connection
import logging

def get_user_details(user_id):
    logging.info(f'Fetching user details for user_id: {user_id}')
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT 
                id,
                username,
                phone_number,
                role,
                status,
                created_at,
                updated_at
            FROM "user"
            WHERE id = %s
        """, (user_id,))
        user = cur.fetchone()
        
        if user is None:
            logging.warning(f'User not found with id: {user_id}')
            return jsonify({'error': '用户不存在'}), 404
            
        logging.info(f'Successfully retrieved user details for user_id: {user_id}')
        return jsonify({
            'id': user['id'],
            'username': user['username'],
            'phone_number': user['phone_number'],
            'role': user['role'],
            'status': user['status']
        })
    except Exception as e:
        logging.error(f'Error in get_user_details for user_id {user_id}: {str(e)}')
        return jsonify({'error': f'获取用户信息失败: {str(e)}'}), 500
    finally:
        cur.close()
        conn.close()