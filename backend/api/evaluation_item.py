# backend/api/evaluation_item.py
from flask import Blueprint, jsonify, request
from psycopg2.extras import RealDictCursor
from ..db import get_db_connection
from psycopg2.extras import register_uuid

register_uuid()

# 重命名蓝图以避免与 evaluation_visibility 中的函数名冲突
bp = Blueprint(
    "evaluation_item_api", __name__, url_prefix="/api/evaluation_item"
)  # 修改蓝图名称

# GET / 和 POST / 保持不变 (除了蓝图名称)


@bp.route("/", methods=["GET"])
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
                ei.category_id, -- 添加 category_id
                ec.category_name,
                ea.aspect_name
            FROM evaluation_item ei
            JOIN evaluation_category ec ON ei.category_id = ec.id
            JOIN evaluation_aspect ea ON ec.aspect_id = ea.id
            ORDER BY ea.created_at DESC, ec.created_at DESC, ei.created_at DESC
        """)
        items = cur.fetchall()
        return jsonify(items)
    except Exception as e:
        print("Error in get_evaluation_items:", str(e))
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@bp.route("/", methods=["POST"])
def create_evaluation_item():
    data = request.get_json()
    print("Received data for creating item:", data)  # 添加日志
    if (
        not data
        or "item_name" not in data
        or not data["item_name"].strip()
        or "category_id" not in data
    ):
        return jsonify({"error": "Item name and category_id are required"}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查 category_id 是否有效 (可选但推荐)
        cur.execute(
            "SELECT id FROM evaluation_category WHERE id = %s", (data["category_id"],)
        )
        if not cur.fetchone():
            return jsonify({"error": "Invalid category_id"}), 400

        cur.execute(
            """
            INSERT INTO evaluation_item
                (category_id, item_name, description, is_visible_to_client)
            VALUES (%s, %s, %s, %s)
            RETURNING id, item_name, description, category_id, is_visible_to_client, created_at
        """,
            (
                data["category_id"],
                data["item_name"].strip(),
                data.get("description", "").strip(),
                data.get("is_visible_to_client", False),  # 提供默认值
            ),
        )
        item = cur.fetchone()
        conn.commit()
        print("Successfully created item:", item)  # 添加日志
        return jsonify(item), 201
    except Exception as e:
        conn.rollback()
        print("Error in create_evaluation_item:", str(e))
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()


# PUT /<uuid:item_id> 保持不变 (除了蓝图名称)
@bp.route("/<uuid:item_id>", methods=["PUT"])
def update_evaluation_item(item_id):
    data = request.get_json()
    if (
        not data
        or "item_name" not in data
        or not data["item_name"].strip()
        or "category_id" not in data
    ):
        return jsonify({"error": "Item name and category_id are required"}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)  # 使用 RealDictCursor 获取字典结果
    try:
        # 检查 category_id 是否有效 (可选但推荐)
        cur.execute(
            "SELECT id FROM evaluation_category WHERE id = %s", (data["category_id"],)
        )
        if not cur.fetchone():
            return jsonify({"error": "Invalid category_id"}), 400

        cur.execute(
            """
            UPDATE evaluation_item
            SET
                category_id = %s,
                item_name = %s,
                description = %s,
                is_visible_to_client = %s,
                updated_at = NOW()
            WHERE id = %s
            RETURNING id, item_name, description, category_id, is_visible_to_client, created_at, updated_at
        """,
            (
                data["category_id"],
                data["item_name"].strip(),
                data.get("description", "").strip(),
                data.get("is_visible_to_client", False),
                item_id,
            ),
        )
        updated_item = cur.fetchone()
        if not updated_item:
            return jsonify({"error": "Item not found"}), 404
        conn.commit()
        return jsonify(updated_item)
    except Exception as e:
        conn.rollback()
        print("Error in update_evaluation_item:", str(e))
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()


@bp.route("/<uuid:item_id>", methods=["DELETE"])
def delete_evaluation_item(item_id):
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # 检查是否有评价详情或自评详情依赖
        cur.execute(
            "SELECT COUNT(*) FROM evaluation_detail WHERE item_id = %s", (item_id,)
        )
        eval_detail_count = cur.fetchone()[0]
        cur.execute(
            "SELECT COUNT(*) FROM employee_self_evaluation_detail WHERE item_id = %s",
            (item_id,),
        )
        self_eval_detail_count = cur.fetchone()[0]

        if eval_detail_count > 0 or self_eval_detail_count > 0:
            return jsonify({"error": "无法删除：该评价项已被评价记录使用"}), 400

        cur.execute(
            "DELETE FROM evaluation_item WHERE id = %s RETURNING id", (item_id,)
        )
        deleted_item = cur.fetchone()
        if not deleted_item:
            return jsonify({"error": "Item not found"}), 404
        conn.commit()
        return jsonify({"success": True, "message": "评价项删除成功"})
    except Exception as e:
        conn.rollback()
        print("Error in delete_evaluation_item:", str(e))
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()
