# backend/api/evaluation_aspect.py
from flask import Blueprint, jsonify, request
from psycopg2.extras import RealDictCursor
import uuid

# 使用相对导入，假设 db.py 在 backend 目录下
from ..db import get_db_connection
# 如果上面的导入失败，尝试绝对导入（取决于你的项目结构和PYTHONPATH设置）
# from backend.db import get_db_connection

# 为 UUID 类型注册适配器 (如果尚未在 app.py 或其他地方完成)
from psycopg2.extras import register_uuid
register_uuid()

bp = Blueprint('evaluation_aspect', __name__, url_prefix='/api/evaluation_aspects')

@bp.route('/', methods=['GET'])
def get_aspects():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # cur.execute("SELECT id, aspect_name, description, created_at FROM evaluation_aspect ORDER BY created_at DESC")
        cur.execute("SELECT id, aspect_name, description, created_at, sort_order FROM evaluation_aspect ORDER BY sort_order ASC, created_at DESC")
        aspects = cur.fetchall()
        return jsonify(aspects)
    except Exception as e:
        print(f"Error in get_aspects: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@bp.route('/', methods=['POST'])
def create_aspect():
    data = request.get_json()
    if not data or 'aspect_name' not in data or not data['aspect_name'].strip():
        return jsonify({'error': 'Aspect name is required'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "INSERT INTO evaluation_aspect (aspect_name, description) VALUES (%s, %s) RETURNING id, aspect_name, description, created_at",
            (data['aspect_name'].strip(), data.get('description', '').strip())
        )
        new_aspect = cur.fetchone()
        conn.commit()
        return jsonify(new_aspect), 201
    except Exception as e:
        conn.rollback()
        print(f"Error in create_aspect: {str(e)}")
        # 检查是否是唯一性约束错误或其他数据库错误
        # if isinstance(e, psycopg2.IntegrityError):
        #     return jsonify({'error': 'Aspect name might already exist or other integrity violation.'}), 409
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@bp.route('/<uuid:aspect_id>', methods=['PUT'])
def update_aspect(aspect_id):
    data = request.get_json()
    if not data or 'aspect_name' not in data or not data['aspect_name'].strip():
        return jsonify({'error': 'Aspect name is required'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "UPDATE evaluation_aspect SET aspect_name = %s, description = %s, updated_at = NOW() WHERE id = %s RETURNING id, aspect_name, description, created_at, updated_at",
            (data['aspect_name'].strip(), data.get('description', '').strip(), aspect_id)
        )
        updated_aspect = cur.fetchone()
        if not updated_aspect:
            return jsonify({'error': 'Aspect not found'}), 404
        conn.commit()
        return jsonify(updated_aspect)
    except Exception as e:
        conn.rollback()
        print(f"Error in update_aspect: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@bp.route('/<uuid:aspect_id>', methods=['DELETE'])
def delete_aspect(aspect_id):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # 检查是否有子类别依赖
        cur.execute("SELECT COUNT(*) FROM evaluation_category WHERE aspect_id = %s", (aspect_id,))
        category_count = cur.fetchone()[0]
        if category_count > 0:
            return jsonify({'error': '无法删除：该方面下存在评价类别'}), 400 # 使用 400 Bad Request 更合适

        # 执行删除
        cur.execute("DELETE FROM evaluation_aspect WHERE id = %s RETURNING id", (aspect_id,))
        deleted_aspect = cur.fetchone()
        if not deleted_aspect:
             return jsonify({'error': 'Aspect not found'}), 404
        conn.commit()
        return jsonify({'success': True, 'message': '评价方面删除成功'})
    except Exception as e:
        conn.rollback()
        print(f"Error in delete_aspect: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()
