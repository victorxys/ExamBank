# backend/api/evaluation_category.py
from flask import Blueprint, jsonify, request
from psycopg2.extras import RealDictCursor

try:
    from ..db import get_db_connection
except ImportError:
    from backend.db import get_db_connection
from psycopg2.extras import register_uuid
import traceback  # 导入 traceback

register_uuid()
bp = Blueprint("evaluation_category", __name__, url_prefix="/api/evaluation_categories")


# --- GET / (获取所有类别) ---
@bp.route("/", methods=["GET"])
def get_all_categories():
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # *** 查询包含 allow_manual_input ***
        cur.execute("""
            SELECT
                c.id, c.category_name, c.description, c.aspect_id, a.aspect_name,
                c.created_at, c.sort_order, c.allow_manual_input
            FROM evaluation_category c
            JOIN evaluation_aspect a ON c.aspect_id = a.id
            ORDER BY a.sort_order, a.created_at, c.sort_order, c.created_at DESC
        """)
        categories = cur.fetchall()
        return jsonify(categories)
    except Exception as e:
        print(f"Error in get_all_categories: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": "获取所有类别失败: " + str(e)}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# --- GET /by_aspect/<uuid:aspect_id> (获取特定方面下的类别) ---
@bp.route("/by_aspect/<uuid:aspect_id>", methods=["GET"])
def get_categories_by_aspect(aspect_id):
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # *** 查询包含 allow_manual_input ***
        cur.execute(
            """
            SELECT id, category_name, description, aspect_id, created_at, sort_order, allow_manual_input
            FROM evaluation_category
            WHERE aspect_id = %s
            ORDER BY sort_order ASC, created_at DESC
            """,
            (aspect_id,),
        )
        categories = cur.fetchall()
        return jsonify(categories)
    except Exception as e:
        print(f"Error in get_categories_by_aspect: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": "获取方面下类别失败: " + str(e)}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# --- POST / (创建类别) ---
@bp.route("/", methods=["POST"])
def create_category():
    data = request.get_json()
    if (
        not data
        or "category_name" not in data
        or not data["category_name"].strip()
        or "aspect_id" not in data
    ):
        return jsonify({"error": "Category name and aspect_id are required"}), 400

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # *** 插入时包含 allow_manual_input ***
        cur.execute(
            """
            INSERT INTO evaluation_category (category_name, aspect_id, description, allow_manual_input)
            VALUES (%s, %s, %s, %s)
            RETURNING id, category_name, description, aspect_id, created_at, sort_order, allow_manual_input
            """,
            (
                data["category_name"].strip(),
                data["aspect_id"],
                data.get("description", "").strip(),
                data.get(
                    "allow_manual_input", False
                ),  # 获取 allow_manual_input，默认为 False
            ),
        )
        new_category = cur.fetchone()
        conn.commit()
        return jsonify(new_category), 201
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error in create_category: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": "创建类别失败: " + str(e)}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# --- PUT /<uuid:category_id> (更新类别) ---
@bp.route("/<uuid:category_id>", methods=["PUT"])
def update_category(category_id):
    data = request.get_json()
    # 更新时，allow_manual_input 是可选的，但如果提供了就必须更新
    if (
        not data
        or "category_name" not in data
        or not data["category_name"].strip()
        or "aspect_id" not in data
    ):
        return jsonify({"error": "Category name and aspect_id are required"}), 400

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # *** 更新时包含 allow_manual_input ***
        # 注意: 如果前端可能只发送部分字段，这个 SQL 需要调整
        # 但目前前端的编辑对话框会包含所有字段
        cur.execute(
            """
            UPDATE evaluation_category
            SET category_name = %s, aspect_id = %s, description = %s, allow_manual_input = %s, updated_at = NOW()
            WHERE id = %s
            RETURNING id, category_name, description, aspect_id, created_at, updated_at, sort_order, allow_manual_input
            """,
            (
                data["category_name"].strip(),
                data["aspect_id"],
                data.get("description", "").strip(),
                data.get("allow_manual_input", False),  # 获取 allow_manual_input
                category_id,
            ),
        )
        updated_category = cur.fetchone()
        if not updated_category:
            return jsonify({"error": "Category not found"}), 404
        conn.commit()
        return jsonify(updated_category)
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error in update_category: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": "更新类别失败: " + str(e)}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# --- DELETE /<uuid:category_id> (删除类别) ---
@bp.route("/<uuid:category_id>", methods=["DELETE"])
def delete_category(category_id):
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        # 检查是否有子项目依赖
        cur.execute(
            "SELECT COUNT(*) FROM evaluation_item WHERE category_id = %s",
            (category_id,),
        )
        item_count = cur.fetchone()[0]
        if item_count > 0:
            return jsonify({"error": "无法删除：该类别下存在评价项"}), 400

        # 检查是否有手动输入依赖 (如果需要保留历史数据，则不应级联删除)
        # cur.execute("SELECT COUNT(*) FROM evaluation_manual_input WHERE category_id = %s", (category_id,))
        # manual_input_count = cur.fetchone()[0]
        # if manual_input_count > 0:
        #    return jsonify({'error': '无法删除：该类别下存在手动评价记录'}), 400

        cur.execute(
            "DELETE FROM evaluation_category WHERE id = %s RETURNING id", (category_id,)
        )
        deleted_category = cur.fetchone()
        if not deleted_category:
            return jsonify({"error": "Category not found"}), 404
        conn.commit()
        return jsonify({"success": True, "message": "评价类别删除成功"})
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error in delete_category: {str(e)}")
        traceback.print_exc()
        return jsonify({"error": "删除类别失败: " + str(e)}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()
