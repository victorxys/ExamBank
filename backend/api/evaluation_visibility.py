from flask import Blueprint, request, jsonify
from backend.db import get_db_connection

bp = Blueprint("evaluation_visibility", __name__)


@bp.route("/evaluation/visibility", methods=["PUT"])
def update_visibility():
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        data = request.get_json()
        visibility_settings = data.get("visibilitySettings", {})

        # 开始事务
        for item_id, is_visible in visibility_settings.items():
            # 更新评价项的可见性状态
            cur.execute(
                "UPDATE evaluation_item SET is_visible_to_client = %s WHERE id = %s",
                (is_visible, item_id),
            )

        conn.commit()
        return jsonify({"message": "可见性设置已更新", "success": True}), 200

    except Exception as e:
        # 回滚事务并记录错误
        conn.rollback()
        print(f"Error updating visibility settings: {str(e)}")
        return jsonify({"error": "更新可见性设置失败", "message": str(e)}), 500
    finally:
        cur.close()
        conn.close()
