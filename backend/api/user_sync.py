from flask import jsonify, request
from backend.db import get_db_connection
from psycopg2.extras import RealDictCursor
import logging
import os

# from backend.app import generate_password_hash
from backend.security_utils import generate_password_hash  # <--- 添加这行


from backend.api.download_avatars import download_and_convert_avatar

log = logging.getLogger(__name__)
AVATAR_DATA_FOLDER_SYNC = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "avatars"
)


def sync_user():
    """

    同步用户数据API
    接收其他业务系统传递的用户信息，并创建用户
    必须参数：myms_user_id, phone_number, username, id_card
    可选参数：avatar, role, email, status
    """
    print("开始同步用户数据")
    data = request.get_json()
    log.debug(f"Received user sync data: {data}")

    # 配置默认邮箱
    if "email" not in data or data["email"] == "":
        data["email"] = f"{data['phone_number']}@mengyimengsao.com"
        log.debug(f"Default email set for user {data['myms_user_id']}: {data['email']}")

    # 验证必要字段
    required_fields = ["myms_user_id", "phone_number", "username", "id_card"]
    for field in required_fields:
        if field not in data:
            return jsonify({"error": f"Missing required field: {field}"}), 400

    # 从身份证号提取后6位作为密码
    id_card = data.get("id_card")
    if len(id_card) < 6:
        return jsonify({"error": "Invalid ID card number"}), 400

    password = id_card[-6:]

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查用户是否已存在（通过myms_user_id或phone_number）
        cur.execute(
            'SELECT id FROM "user" WHERE myms_user_id = %s OR phone_number = %s',
            (data["myms_user_id"], data["phone_number"]),
        )
        existing_user = cur.fetchone()

        if existing_user:
            # 如果用户已存在，更新用户信息
            update_fields = [
                "username = %s",
                "phone_number = %s",
                "myms_user_id = %s",
                "password = %s",
            ]
            params = [
                data["username"],
                data["phone_number"],
                data["myms_user_id"],
                generate_password_hash(password),
            ]

            # 可选字段
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

            # 添加用户ID到参数列表
            params.append(existing_user["id"])

            # 执行更新
            query = f"""
                UPDATE "user"
                SET {", ".join(update_fields)}
                WHERE id = %s
                RETURNING id, username, phone_number, myms_user_id, role, email, status, created_at, updated_at
            """
            cur.execute(query, params)
            updated_user = cur.fetchone()
            conn.commit()
            log.debug(f"Updated existing user: {updated_user}")

            # 如果有头像URL，下载并转换头像
            if "avatar" in data and data["avatar"]:
                try:
                    # 确保输出目录存在
                    # output_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                    #                         'frontend', 'public', 'avatar')
                    output_dir = AVATAR_DATA_FOLDER_SYNC  # <-- 使用新的后端数据目录变量
                    os.makedirs(output_dir, exist_ok=True)  # 确保新目录存在

                    output_path = os.path.join(
                        output_dir, f"{existing_user['id']}-avatar.jpg"
                    )
                    log.info(
                        f"Downloading avatar for user {existing_user['id']} from {data['avatar']}"
                    )

                    if download_and_convert_avatar(data["avatar"], output_path):
                        log.info(
                            f"Avatar downloaded and converted successfully for user {existing_user['id']}"
                        )
                    else:
                        log.warning(
                            f"Failed to download avatar for user {existing_user['id']}"
                        )
                except Exception as e:
                    log.error(
                        f"Error downloading avatar for user {existing_user['id']}: {str(e)}"
                    )

            return jsonify(
                {"message": "User updated successfully", "user": updated_user}
            )

        # 创建新用户
        cur.execute(
            """
            INSERT INTO "user" (
                username,
                password,
                phone_number,
                myms_user_id,
                avatar,
                role,
                email,
                status
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, username, phone_number, myms_user_id, role, email, status, created_at, updated_at
        """,
            (
                data["username"],
                generate_password_hash(password),
                data["phone_number"],
                data["myms_user_id"],
                data.get("avatar", ""),
                data.get("role", "student"),
                data.get("email", ""),
                data.get("status", "active"),
            ),
        )
        new_user = cur.fetchone()
        conn.commit()
        log.debug(f"Created new user through sync: {new_user}")

        # 如果有头像URL，下载并转换头像
        if "avatar" in data and data["avatar"]:
            try:
                # 确保输出目录存在

                output_dir = AVATAR_DATA_FOLDER_SYNC
                os.makedirs(output_dir, exist_ok=True)

                output_path = os.path.join(output_dir, f"{new_user['id']}-avatar.jpg")
                log.info(
                    f"Downloading avatar for new user {new_user['id']} from {data['avatar']}"
                )

                if download_and_convert_avatar(data["avatar"], output_path):
                    log.info(
                        f"Avatar downloaded and converted successfully for new user {new_user['id']}"
                    )
                else:
                    log.warning(
                        f"Failed to download avatar for new user {new_user['id']}"
                    )
            except Exception as e:
                log.error(
                    f"Error downloading avatar for new user {new_user['id']}: {str(e)}"
                )

        return jsonify({"message": "User created successfully", "user": new_user})
    except Exception as e:
        conn.rollback()
        log.exception(f"Error in sync_user: {str(e)}")
        print("Error in sync_user:", str(e))
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()
