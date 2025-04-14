# backend/api/evaluation_category.py
from flask import Blueprint, jsonify, request
from psycopg2.extras import RealDictCursor
import uuid
from ..db import get_db_connection
from psycopg2.extras import register_uuid
register_uuid()

bp = Blueprint('evaluation_category', __name__, 
url_prefix='/api/evaluation_categories')

# 获取所有类别（较少用）
@bp.route('/', methods=['GET'])
def get_all_categories():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 可以 JOIN aspect 表获取更多信息
        cur.execute("""
        SELECT c.id, c.category_name, c.description, c.aspect_id, a.aspect_name, c.created_at
            FROM evaluation_category c
            JOIN evaluation_aspect a ON c.aspect_id = a.id
            ORDER BY a.created_at, c.created_at DESC
        """)
        categories = cur.fetchall()
        return jsonify(categories)
    except Exception as e:
        print(f"Error in get_all_categories: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# 获取特定方面下的类别（更常用）
@bp.route('/by_aspect/<uuid:aspect_id>', methods=['GET'])
def get_categories_by_aspect(aspect_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "SELECT id, category_name, description, aspect_id, created_at, sort_order FROM evaluation_category WHERE aspect_id = %s ORDER BY sort_order ASC, created_at DESC",
            (aspect_id,)
        )
        categories = cur.fetchall()
        return jsonify(categories)
    except Exception as e:
        print(f"Error in get_categories_by_aspect: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@bp.route('/', methods=['POST'])
def create_category():
    data = request.get_json()
    if not data or 'category_name' not in data or not data['category_name'].strip() or 'aspect_id' not in data:
        return jsonify({'error': 'Category name and aspect_id are required'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "INSERT INTO evaluation_category (category_name, aspect_id, description) VALUES (%s, %s, %s) RETURNING id, category_name, description, aspect_id, created_at",
            (data['category_name'].strip(), data['aspect_id'], 
data.get('description', '').strip())
        )
        new_category = cur.fetchone()
        conn.commit()
        return jsonify(new_category), 201
    except Exception as e:
        conn.rollback()
        print(f"Error in create_category: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@bp.route('/<uuid:category_id>', methods=['PUT'])
def update_category(category_id):
    data = request.get_json()
    if not data or 'category_name' not in data or not data['category_name'].strip() or 'aspect_id' not in data:
        return jsonify({'error': 'Category name and aspect_id are required'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            "UPDATE evaluation_category SET category_name = %s, aspect_id = %s, description = %s, updated_at = NOW() WHERE id = %s RETURNING id, category_name, description, aspect_id, created_at, updated_at",
            (data['category_name'].strip(), data['aspect_id'], data.get('description', '').strip(), category_id)
        )
        updated_category = cur.fetchone()
        if not updated_category:
            return jsonify({'error': 'Category not found'}), 404
        conn.commit()
        return jsonify(updated_category)
    except Exception as e:
        conn.rollback()
        print(f"Error in update_category: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@bp.route('/<uuid:category_id>', methods=['DELETE'])
def delete_category(category_id):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # 检查是否有子项目依赖
        cur.execute("SELECT COUNT(*) FROM evaluation_item WHERE category_id = %s", (category_id,))
        item_count = cur.fetchone()[0]
        if item_count > 0:
            return jsonify({'error': '无法删除：该类别下存在评价项'}), 400

        cur.execute("DELETE FROM evaluation_category WHERE id = %s RETURNING id", (category_id,))
        deleted_category = cur.fetchone()
        if not deleted_category:
            return jsonify({'error': 'Category not found'}), 404
        conn.commit()
        return jsonify({'success': True, 'message': '评价类别删除成功'})
    except Exception as e:
        conn.rollback()
        print(f"Error in delete_category: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()
