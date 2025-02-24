from flask import jsonify
from psycopg2.extras import RealDictCursor
from ..db import get_db_connection

def get_user_details(user_id):
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
            return jsonify({'error': '用户不存在'}), 404
            
        return jsonify({
            'id': user['id'],
            'username': user['username'],
            'phone_number': user['phone_number'],
            'role': user['role'],
            'status': user['status']
        })
    except Exception as e:
        print('Error in get_user_details:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()