from flask import Blueprint, jsonify, request
from psycopg2.extras import RealDictCursor
from ..db import get_db_connection
from psycopg2.extras import RealDictCursor, register_uuid  # 导入 register_uuid
import uuid  # 导入 uuid 模块
import json
register_uuid()

bp = Blueprint('evaluation_item', __name__)

@bp.route('/', methods=['GET'])
def get_evaluation_items():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT 
                ei.id,
                ei.item_name,
                ei.description,
                ei.is_visible_to_client,
                ec.category_name,
                ea.aspect_name
            FROM evaluation_item ei
            JOIN evaluation_category ec ON ei.category_id = ec.id
            JOIN evaluation_aspect ea ON ec.aspect_id = ea.id
            ORDER BY ei.created_at DESC
        """)
        items = cur.fetchall()
        return jsonify(items)
    except Exception as e:
        print('Error in get_evaluation_items:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@bp.route('/', methods=['POST'])
def create_evaluation_item():
    data = request.get_json()
    print('data:', data)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            INSERT INTO evaluation_item 
                (category_id, item_name, description, is_visible_to_client)
            VALUES (%s, %s, %s, %s)
            RETURNING id
        """, (data['category_id'], data['item_name'], data['description'], data['is_visible_to_client']))
        item_id = cur.fetchone()['id']
        conn.commit()
        return jsonify({'id': item_id}), 201
    except Exception as e:
        conn.rollback()
        print('Error in create_evaluation_item:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@bp.route('/<uuid:item_id>', methods=['PUT'])
def update_evaluation_item(item_id):
    data = request.get_json()
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            UPDATE evaluation_item
            SET 
                category_id = %s,
                item_name = %s,
                description = %s,
                is_visible_to_client = %s
            WHERE id = %s
        """, (data['category_id'], data['item_name'], data['description'], data['is_visible_to_client'], item_id))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        print('Error in update_evaluation_item:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@bp.route('/<uuid:item_id>', methods=['DELETE'])
def delete_evaluation_item(item_id):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            DELETE FROM evaluation_item
            WHERE id = %s
        """, (item_id,))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        print('Error in delete_evaluation_item:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()