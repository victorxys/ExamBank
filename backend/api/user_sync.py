from flask import jsonify, request
from backend.db import get_db_connection
from psycopg2.extras import RealDictCursor
import logging
import os

# from backend.app import generate_password_hash
from backend.security_utils import generate_password_hash  # <--- 添加这行


from backend.api.download_avatars import download_and_convert_avatar
from pypinyin import pinyin, Style

log = logging.getLogger(__name__)
AVATAR_DATA_FOLDER_SYNC = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "avatars"
)


import uuid

def sync_user():
    """
    同步用户数据API
    接收其他业务系统传递的用户信息，并创建或更新 user 和 service_personnel 表。
    必须参数：myms_user_id, phone_number, username, id_card
    可选参数：avatar, role, email, status, address
    """
    print("开始同步用户数据")
    data = request.get_json()
    log.debug(f"Received user sync data: {data}")

    if "email" not in data or data["email"] == "":
        data["email"] = f"{data['phone_number']}@mengyimengsao.com"
        log.debug(f"Default email set for user {data['myms_user_id']}: {data['email']}")

    required_fields = ["myms_user_id", "phone_number", "username", "id_card"]
    for field in required_fields:
        if field not in data:
            return jsonify({"error": f"Missing required field: {field}"}), 400

    username = data["username"]
    try:
        pinyin_full = "".join(p[0] for p in pinyin(username, style=Style.NORMAL))
        pinyin_initials = "".join(p[0] for p in pinyin(username, style=Style.FIRST_LETTER))
        name_pinyin_final = f"{pinyin_full} {pinyin_initials}"
    except Exception:
        name_pinyin_final = None

    id_card = data.get("id_card")
    if len(id_card) < 6:
        return jsonify({"error": "Invalid ID card number"}), 400
    password = id_card[-6:]

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            'SELECT id FROM "user" WHERE myms_user_id = %s OR phone_number = %s',
            (data["myms_user_id"], data["phone_number"]),
        )
        existing_user = cur.fetchone()
        
        synced_user = None
        if existing_user:
            update_fields = [
                "username = %s", "phone_number = %s", "myms_user_id = %s",
                "password = %s", "name_pinyin = %s", "id_card_number = %s"
            ]
            params = [
                data["username"], data["phone_number"], data["myms_user_id"],
                generate_password_hash(password), name_pinyin_final, id_card
            ]
            if "avatar" in data:
                update_fields.append("avatar = %s")
                params.append(data["avatar"])
            if "role" in data:
                update_fields.append("role = %s")
                params.append(data["role"])
            if "email" in data:
                update_fields.append("email = %s")
                params.append(data["email"])
            if "status" in data:
                update_fields.append("status = %s")
                params.append(data["status"])
            params.append(existing_user["id"])
            query = f'UPDATE "user" SET {", ".join(update_fields)} WHERE id = %s RETURNING *'
            cur.execute(query, params)
            synced_user = cur.fetchone()
            log.debug(f"Updated existing user: {synced_user}")
        else:
            cur.execute(
                """
                INSERT INTO "user" (username, password, phone_number, myms_user_id, avatar, role, email, status, name_pinyin, id_card_number)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *
                """,
                (
                    data["username"], generate_password_hash(password), data["phone_number"],
                    data["myms_user_id"], data.get("avatar", ""), data.get("role", "student"),
                    data.get("email", ""), data.get("status", "active"), name_pinyin_final, id_card
                ),
            )
            synced_user = cur.fetchone()
            log.debug(f"Created new user through sync: {synced_user}")

        # --- ServicePersonnel Sync Logic ---
        if synced_user and synced_user.get("role") == "student":
            sp_id = None
            # 1. De-duplication by id_card_number
            cur.execute('SELECT id FROM service_personnel WHERE id_card_number = %s', (id_card,))
            existing_sp = cur.fetchone()
            if existing_sp:
                sp_id = existing_sp['id']
                log.debug(f"Found existing ServicePersonnel by id_card: {sp_id}")

            # 2. De-duplication by phone_number
            if not sp_id:
                cur.execute('SELECT id FROM service_personnel WHERE phone_number = %s', (data[ 'phone_number'],))
                existing_sp = cur.fetchone()
                if existing_sp:
                    sp_id = existing_sp['id']
                    log.debug(f"Found existing ServicePersonnel by phone_number: {sp_id}")

            # 3. De-duplication by name
            if not sp_id:
                cur.execute('SELECT id FROM service_personnel WHERE name = %s', (data['username' ],))
                existing_sp = cur.fetchone()
                if existing_sp:
                    sp_id = existing_sp['id']
                    log.debug(f"Found existing ServicePersonnel by name: {sp_id}")

            is_active = data.get('status', 'active') == 'active'
            address = data.get("address") # 获取地址字段

            if sp_id:
                log.debug(f"Updating ServicePersonnel record with id: {sp_id}")
                cur.execute(
                    """
                    UPDATE service_personnel
                    SET name = %s, name_pinyin = %s, phone_number = %s, id_card_number = %s, is_active = %s, user_id = %s, address = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (data['username'], name_pinyin_final, data['phone_number'], id_card, is_active, synced_user['id'], address, sp_id)
                )
            else:
                log.debug("Creating new ServicePersonnel record")
                new_sp_id = uuid.uuid4()
                cur.execute(
                    """
                    INSERT INTO service_personnel (id, name, name_pinyin, phone_number, id_card_number, is_active, user_id, address)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (new_sp_id, data['username'], name_pinyin_final, data['phone_number'], id_card, is_active, synced_user['id'], address)
                )
        # --- End of ServicePersonnel Sync Logic ---

        conn.commit()

        if "avatar" in data and data["avatar"]:
            try:
                output_dir = AVATAR_DATA_FOLDER_SYNC
                os.makedirs(output_dir, exist_ok=True)
                output_path = os.path.join(output_dir, f"{synced_user['id']}-avatar.jpg")
                log.info(f"Downloading avatar for user {synced_user['id']} from {data['avatar']} ")
                if download_and_convert_avatar(data['avatar'], output_path):
                    log.info(f"Avatar downloaded and converted successfully for user {synced_user['id']}")
                else:
                    log.warning(f"Failed to download avatar for user {synced_user['id']}")
            except Exception as e:
                log.error(f"Error downloading avatar for user {synced_user['id']}: {str(e)}")

        message = "User updated successfully" if existing_user else "User created successfully"
        return jsonify({"message": message, "user": synced_user})
    except Exception as e:
        conn.rollback()
        log.exception(f"Error in sync_user: {str(e)}")
        print("Error in sync_user:", str(e))
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()