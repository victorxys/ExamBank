# backend/api/evaluation_aspect.py
from flask import Blueprint, jsonify, request
from psycopg2.extras import RealDictCursor

try:
    from ..db import get_db_connection
except ImportError:
    from backend.db import get_db_connection
from psycopg2.extras import register_uuid

register_uuid()

bp = Blueprint("evaluation_aspect", __name__, url_prefix="/api/evaluation_aspects")


@bp.route("/", methods=["GET"])
def get_aspects():
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # *** 查询包含 allow_manual_input ***
        cur.execute("""
            SELECT id, aspect_name, description, created_at, sort_order
            FROM evaluation_aspect
            ORDER BY sort_order ASC, created_at DESC
        """)
        aspects = cur.fetchall()
        return jsonify(aspects)
    except Exception as e:
        print(f"Error in get_aspects: {str(e)}")
        import traceback

        traceback.print_exc()
        return jsonify({"error": "获取评价方面失败: " + str(e)}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@bp.route("/", methods=["POST"])
def create_aspect():
    data = request.get_json()
    if not data or "aspect_name" not in data or not data["aspect_name"].strip():
        return jsonify({"error": "Aspect name is required"}), 400

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # *** 插入时包含 allow_manual_input，从 data 中获取，提供默认值 False ***
        cur.execute(
            """
            INSERT INTO evaluation_aspect (aspect_name, description)
            VALUES (%s, %s)
            RETURNING id, aspect_name, description, created_at, sort_order
            """,
            (
                data["aspect_name"].strip(),
                data.get("description", "").strip(),
            ),
        )
        new_aspect = cur.fetchone()
        conn.commit()
        return jsonify(new_aspect), 201
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error in create_aspect: {str(e)}")
        import traceback

        traceback.print_exc()
        return jsonify({"error": "创建评价方面失败: " + str(e)}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


@bp.route("/<uuid:aspect_id>", methods=["PUT"])
def update_aspect(aspect_id):
    data = request.get_json()
    if not data or "aspect_name" not in data or not data["aspect_name"].strip():
        return jsonify({"error": "Aspect name is required"}), 400

    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # *** 更新时包含 allow_manual_input ***
        cur.execute(
            """
            UPDATE evaluation_aspect
            SET aspect_name = %s, description = %s, updated_at = NOW()
            WHERE id = %s
            RETURNING id, aspect_name, description, created_at, updated_at, sort_order
            """,
            (
                data["aspect_name"].strip(),
                data.get("description", "").strip(),
                aspect_id,
            ),
        )
        updated_aspect = cur.fetchone()
        if not updated_aspect:
            return jsonify({"error": "Aspect not found"}), 404
        conn.commit()
        return jsonify(updated_aspect)
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error in update_aspect: {str(e)}")
        import traceback

        traceback.print_exc()
        return jsonify({"error": "更新评价方面失败: " + str(e)}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()


# DELETE 接口不需要修改 allow_manual_input，保持不变
@bp.route("/<uuid:aspect_id>", methods=["DELETE"])
def delete_aspect(aspect_id):
    # ... (之前的 DELETE 代码保持不变) ...
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM evaluation_category WHERE aspect_id = %s",
            (aspect_id,),
        )
        category_count = cur.fetchone()[0]
        if category_count > 0:
            return jsonify({"error": "无法删除：该方面下存在评价类别"}), 400
        cur.execute(
            "DELETE FROM evaluation_aspect WHERE id = %s RETURNING id", (aspect_id,)
        )
        deleted_aspect = cur.fetchone()
        if not deleted_aspect:
            return jsonify({"error": "Aspect not found"}), 404
        conn.commit()
        return jsonify({"success": True, "message": "评价方面删除成功"})
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"Error in delete_aspect: {str(e)}")
        import traceback

        traceback.print_exc()
        return jsonify({"error": "删除评价方面失败: " + str(e)}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()
