# backend/api/evaluation_order.py
from flask import Blueprint, jsonify, request
from psycopg2.extras import RealDictCursor
import uuid
from ..db import get_db_connection
from psycopg2.extras import register_uuid
register_uuid()

bp = Blueprint('evaluation_order', __name__, url_prefix='/api/evaluation/order')

@bp.route('/', methods=['PUT'])
def update_order():
    data = request.get_json()
    level = data.get('level') # 'aspect', 'category', 'item'
    ordered_ids = data.get('orderedIds') # ID 列表，按新顺序排列
    parent_id = data.get('parentId') # 对于 category 和 item，需要父级 ID

    if not level or not ordered_ids or not isinstance(ordered_ids, list):
        return jsonify({'error': 'Missing level or orderedIds'}), 400
    if level != 'aspect' and not parent_id:
         return jsonify({'error': 'Missing parentId for category/item ordering'}), 400

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        table_name = ""
        parent_column = ""
        if level == 'aspect':
            table_name = "evaluation_aspect"
        elif level == 'category':
            table_name = "evaluation_category"
            parent_column = "aspect_id"
        elif level == 'item':
            table_name = "evaluation_item"
            parent_column = "category_id"
        else:
            return jsonify({'error': 'Invalid level'}), 400

        # 使用事务确保原子性
        with conn: # psycopg2 的连接对象可以用作上下文管理器
            with conn.cursor() as cur: # 使用嵌套的游标上下文
                for index, item_id in enumerate(ordered_ids):
                    sql = f"UPDATE {table_name} SET sort_order = %s WHERE id = %s"
                    params = [index, item_id]
                    # 如果不是 aspect 级别，需要确保更新的是正确的父级下的项
                    # 这增加了安全性，防止跨父级更新排序
                    # if parent_column:
                    #    sql += f" AND {parent_column} = %s"
                    #    params.append(parent_id)

                    cur.execute(sql, tuple(params)) # 将列表转为元组

        # conn.commit() # 上下文管理器会自动处理提交或回滚
        return jsonify({'success': True, 'message': f'{level} order updated successfully'})

    except Exception as e:
        # if conn: conn.rollback() # 上下文管理器会自动处理
        print(f"Error updating {level} order: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'更新 {level} 排序失败: ' + str(e)}), 500
    finally:
         # 连接由 with 语句管理，不需要手动关闭游标和连接
        pass # conn 和 cur 会在 with 块结束时自动关闭