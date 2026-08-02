from flask import Blueprint, jsonify, request
from backend.models import SystemSetting, LlmApiKey, db
import logging
from datetime import datetime
from backend.utils.miniapp_config import get_miniapp_credentials, miniapp_credential_status
from backend.services.dify_beautify_service import (
    DEFAULT_BILL_BEAUTIFY_CONFIG,
    get_or_create_bill_beautify_config,
)

logger = logging.getLogger(__name__)

setting_api_bp = Blueprint('setting_api', __name__, url_prefix='/api/settings')

RESET_LAST_RUN_DATE = "2000-01-01"
RESET_LAST_RUN_AT = ""
RESETTABLE_REMINDER_FIELDS = {"enabled", "advance_days", "day_of_month", "start_day", "end_day", "time", "contract_created_after", "contract_end_after", "trial_end_after"}

DEFAULT_CONTRACT_CREATED_AFTER = "2026-06-01"
DEFAULT_CONTRACT_END_AFTER = "2026-06-01"
DEFAULT_TRIAL_END_AFTER = "2026-06-01"
DEFAULT_MINIAPP_SIGNING_CONFIG = {
    "enabled": False,
    "env_version": "release",
    "expire_days": 30,
    "contract_sign_path": "pages/contract-sign/index",
    "fallback_to_web": True,
}


def normalize_wechat_touser(value):
    if not value:
        return ""
    stripped = str(value).strip()
    if stripped == "@all":
        return stripped
    return "|".join(part.strip() for part in stripped.split("|") if part.strip())

DEFAULT_NOTIFICATION_CONFIG = {
    "reminders": {
        "contract_expiry": {
            "enabled": True,
            "advance_days": 30,
            "time": "09:00",
            "contract_end_after": DEFAULT_CONTRACT_END_AFTER,
            "notify_users": "",
            "last_run_date": RESET_LAST_RUN_DATE,
            "last_run_at": RESET_LAST_RUN_AT
        },
        "trial_expiry": {
            "enabled": True,
            "advance_days": 1,
            "time": "09:00",
            "trial_end_after": DEFAULT_TRIAL_END_AFTER,
            "notify_users": "",
            "last_run_date": RESET_LAST_RUN_DATE,
            "last_run_at": RESET_LAST_RUN_AT
        },
        "pregnancy": {
            "enabled": True,
            "advance_days": 7,
            "time": "09:00",
            "contract_created_after": DEFAULT_CONTRACT_CREATED_AFTER,
            "notify_users": "",
            "last_run_date": RESET_LAST_RUN_DATE,
            "last_run_at": RESET_LAST_RUN_AT
        },
        "attendance": {
            "enabled": True,
            "day_of_month": 1,
            "time": "09:00",
            "notify_users": "",
            "last_run_date": RESET_LAST_RUN_DATE,
            "last_run_at": RESET_LAST_RUN_AT
        },
        "monthly_management_fee": {
            "enabled": True,
            "start_day": 1,
            "end_day": 5,
            "time": "09:00",
            "notify_users": "",
            "last_run_date": RESET_LAST_RUN_DATE,
            "last_run_at": RESET_LAST_RUN_AT
        },
        "insurance_expiry": {
            "enabled": True,
            "advance_days": 30,
            "time": "09:00",
            "notify_users": "",
            "last_run_date": RESET_LAST_RUN_DATE,
            "last_run_at": RESET_LAST_RUN_AT
        },
        "physical_exam_expiry": {
            "enabled": True,
            "advance_days": 30,
            "time": "09:00",
            "notify_users": "",
            "last_run_date": RESET_LAST_RUN_DATE,
            "last_run_at": RESET_LAST_RUN_AT
        },
        "debt": {
            "enabled": True,
            "advance_days": 3,
            "time": "09:00",
            "notify_users": "",
            "last_run_date": RESET_LAST_RUN_DATE,
            "last_run_at": RESET_LAST_RUN_AT
        },
        "onboarding": {
            "enabled": True,
            "advance_days": 1,
            "time": "09:00",
            "contract_created_after": DEFAULT_CONTRACT_CREATED_AFTER,
            "notify_users": "",
            "last_run_date": RESET_LAST_RUN_DATE,
            "last_run_at": RESET_LAST_RUN_AT
        },
        "sign_event": {
            "enabled": True,
            "notify_users": ""
        }
    }
}


def migrate_old_config(old_val):
    """Backward compatibility logic to migrate 'switches' format to 'reminders' format."""
    import copy
    new_config = copy.deepcopy(DEFAULT_NOTIFICATION_CONFIG)
    legacy_notify_users = old_val.get("notify_users", "")
    if "switches" in old_val:
        daily_time = old_val.get("daily_reminder_time", "09:00")
        global_last_run = old_val.get("last_run_date", RESET_LAST_RUN_DATE)
        for key, enabled in old_val["switches"].items():
            if key in new_config["reminders"]:
                new_config["reminders"][key]["enabled"] = enabled
                new_config["reminders"][key]["notify_users"] = legacy_notify_users
                if "time" in new_config["reminders"][key]:
                    new_config["reminders"][key]["time"] = daily_time
                if "last_run_date" in new_config["reminders"][key]:
                    new_config["reminders"][key]["last_run_date"] = global_last_run
    elif "reminders" in old_val:
        # Merge if it's already the new format but missing keys
        for key, val in old_val["reminders"].items():
            if key in new_config["reminders"]:
                for sub_k, sub_v in val.items():
                    new_config["reminders"][key][sub_k] = sub_v
        contract_expiry = new_config["reminders"].get("contract_expiry", {})
        if not contract_expiry.get("contract_end_after") and contract_expiry.get("contract_created_after"):
            contract_expiry["contract_end_after"] = contract_expiry["contract_created_after"]
        trial_expiry = new_config["reminders"].get("trial_expiry", {})
        if not trial_expiry.get("trial_end_after") and trial_expiry.get("contract_created_after"):
            trial_expiry["trial_end_after"] = trial_expiry["contract_created_after"]
    if legacy_notify_users:
        for reminder in new_config["reminders"].values():
            if not reminder.get("notify_users"):
                reminder["notify_users"] = legacy_notify_users
    for reminder in new_config["reminders"].values():
        if "last_run_date" in reminder and "last_run_at" not in reminder:
            reminder["last_run_at"] = RESET_LAST_RUN_AT
    return new_config

def get_or_create_notification_config():
    config = SystemSetting.query.get('notification_config')
    if not config:
        config = SystemSetting(
            id='notification_config',
            value=DEFAULT_NOTIFICATION_CONFIG,
            description="全局通知配置"
        )
        db.session.add(config)
        db.session.commit()
    else:
        # Migrate dynamically if needed
        migrated_val = migrate_old_config(config.value)
        if migrated_val != config.value:
            from sqlalchemy.orm.attributes import flag_modified
            config.value = migrated_val
            flag_modified(config, 'value')
            db.session.commit()
    return config


def get_or_create_miniapp_signing_config():
    config = SystemSetting.query.get('miniapp_signing_config')
    env_appid, _ = get_miniapp_credentials()
    if not config:
        config = SystemSetting(
            id='miniapp_signing_config',
            value={
                **DEFAULT_MINIAPP_SIGNING_CONFIG,
                "appid": env_appid,
            },
            description="小程序签署入口配置"
        )
        db.session.add(config)
        db.session.commit()
        return config

    current_val = {**DEFAULT_MINIAPP_SIGNING_CONFIG, **(config.value or {})}
    if not current_val.get("appid"):
        current_val["appid"] = env_appid
    if current_val != config.value:
        from sqlalchemy.orm.attributes import flag_modified
        config.value = current_val
        flag_modified(config, 'value')
        db.session.commit()
    return config


@setting_api_bp.route('/miniapp-signing', methods=['GET'])
def get_miniapp_signing_config():
    try:
        config = get_or_create_miniapp_signing_config()
        data = config.value or {}
        return jsonify({
            "status": "success",
            "data": data,
            "diagnostics": miniapp_credential_status(data.get("appid")),
        }), 200
    except Exception as e:
        logger.error(f"Error getting miniapp signing config: {e}")
        return jsonify({"status": "error", "message": "Failed to load config"}), 500


@setting_api_bp.route('/miniapp-signing', methods=['PUT'])
def update_miniapp_signing_config():
    try:
        data = request.json or {}
        config = get_or_create_miniapp_signing_config()

        current_val = {**DEFAULT_MINIAPP_SIGNING_CONFIG, **(config.value or {})}
        allowed_fields = {
            "enabled",
            "appid",
            "env_version",
            "expire_days",
            "contract_sign_path",
            "fallback_to_web",
        }
        for field in allowed_fields:
            if field in data:
                current_val[field] = data[field]

        current_val["enabled"] = bool(current_val.get("enabled"))
        current_val["fallback_to_web"] = bool(current_val.get("fallback_to_web", True))
        current_val["appid"] = str(current_val.get("appid") or "").strip()
        current_val["env_version"] = (
            current_val.get("env_version")
            if current_val.get("env_version") in ("release", "trial", "develop")
            else "release"
        )
        try:
            current_val["expire_days"] = max(1, min(int(current_val.get("expire_days") or 30), 30))
        except (TypeError, ValueError):
            current_val["expire_days"] = 30
        path = str(current_val.get("contract_sign_path") or DEFAULT_MINIAPP_SIGNING_CONFIG["contract_sign_path"]).strip()
        current_val["contract_sign_path"] = path.lstrip("/")

        config.value = current_val
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(config, 'value')
        db.session.commit()

        return jsonify({
            "status": "success",
            "message": "Miniapp signing config updated",
            "data": config.value,
            "diagnostics": miniapp_credential_status(config.value.get("appid")),
        }), 200
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error updating miniapp signing config: {e}")
        return jsonify({"status": "error", "message": "Failed to update config"}), 500

@setting_api_bp.route('/notification', methods=['GET'])
def get_notification_config():
    try:
        config = get_or_create_notification_config()
        return jsonify({
            "status": "success",
            "data": config.value
        }), 200
    except Exception as e:
        logger.error(f"Error getting notification config: {e}")
        return jsonify({"status": "error", "message": "Failed to load config"}), 500


def _reminder_schedule_changed(existing_reminder, incoming_reminder):
    for field in RESETTABLE_REMINDER_FIELDS:
        if field in incoming_reminder and existing_reminder.get(field) != incoming_reminder.get(field):
            return True
    return False


@setting_api_bp.route('/notification', methods=['PUT'])
def update_notification_config():
    try:
        data = request.json
        if not data:
            return jsonify({"status": "error", "message": "Invalid payload"}), 400
            
        config = get_or_create_notification_config()
        
        import copy
        current_val = copy.deepcopy(config.value)
        
        if "reminders" in data:
            if "reminders" not in current_val:
                current_val["reminders"] = {}
                
            for k, v_dict in data["reminders"].items():
                if k not in current_val["reminders"]:
                    current_val["reminders"][k] = {}
                if "notify_users" in v_dict:
                    v_dict["notify_users"] = normalize_wechat_touser(v_dict.get("notify_users"))
                should_reset_last_run = _reminder_schedule_changed(
                    current_val["reminders"][k],
                    v_dict
                )
                for sub_k, sub_v in v_dict.items():
                    current_val["reminders"][k][sub_k] = sub_v
                if should_reset_last_run and "last_run_date" in current_val["reminders"][k]:
                    current_val["reminders"][k]["last_run_date"] = RESET_LAST_RUN_DATE
                    current_val["reminders"][k]["last_run_at"] = RESET_LAST_RUN_AT
                
        config.value = current_val
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(config, 'value')
        db.session.commit()
        
        return jsonify({
            "status": "success",
            "message": "Notification config updated",
            "data": config.value
        }), 200
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error updating notification config: {e}")
        return jsonify({"status": "error", "message": "Failed to update config"}), 500


@setting_api_bp.route('/notification/reminders/<reminder_key>/reset', methods=['POST'])
def reset_notification_reminder_last_run(reminder_key):
    try:
        config = get_or_create_notification_config()

        import copy
        current_val = copy.deepcopy(config.value)
        reminder = current_val.get("reminders", {}).get(reminder_key)
        if not reminder:
            return jsonify({"status": "error", "message": "Unknown reminder"}), 404
        if "last_run_date" not in reminder:
            return jsonify({"status": "error", "message": "This reminder has no send state to reset"}), 400

        reminder["last_run_date"] = RESET_LAST_RUN_DATE
        reminder["last_run_at"] = RESET_LAST_RUN_AT
        config.value = current_val
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(config, 'value')
        db.session.commit()

        return jsonify({
            "status": "success",
            "message": "Reminder send state reset",
            "data": config.value
        }), 200
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error resetting notification reminder state: {e}")
        return jsonify({"status": "error", "message": "Failed to reset reminder state"}), 500


# --- 账单美化 (Dify) 配置 ---
@setting_api_bp.route('/bill-beautify', methods=['GET'])
def get_bill_beautify_config():
    try:
        config = get_or_create_bill_beautify_config()
        api_keys = (
            LlmApiKey.query.order_by(LlmApiKey.provider, LlmApiKey.key_name).all()
        )
        key_options = [
            {
                "key_name": k.key_name,
                "provider": k.provider,
                "status": k.status,
            }
            for k in api_keys
        ]
        return jsonify({
            "status": "success",
            "data": config.value or {},
            "defaults": DEFAULT_BILL_BEAUTIFY_CONFIG,
            "api_key_options": key_options,
        }), 200
    except Exception as e:
        logger.error(f"Error getting bill beautify config: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Failed to load config"}), 500


@setting_api_bp.route('/bill-beautify', methods=['PUT'])
def update_bill_beautify_config():
    try:
        data = request.json or {}
        config = get_or_create_bill_beautify_config()
        current_val = {**DEFAULT_BILL_BEAUTIFY_CONFIG, **(config.value or {})}

        allowed_fields = {
            "api_base_url",
            "api_key_name",
            "app_mode",
            "timeout_seconds",
            "enabled",
            "input_variable",
        }
        for field in allowed_fields:
            if field in data:
                current_val[field] = data[field]

        current_val["enabled"] = bool(current_val.get("enabled", True))
        api_base_url = str(
            current_val.get("api_base_url") or DEFAULT_BILL_BEAUTIFY_CONFIG["api_base_url"]
        ).strip().rstrip("/")
        # 与调用侧一致：HTTP 升级为 HTTPS，避免 301 后 POST 变 GET
        if api_base_url.startswith("http://"):
            api_base_url = "https://" + api_base_url[len("http://") :]
        current_val["api_base_url"] = api_base_url
        current_val["api_key_name"] = str(current_val.get("api_key_name") or "").strip()
        current_val["input_variable"] = str(
            current_val.get("input_variable")
            or DEFAULT_BILL_BEAUTIFY_CONFIG["input_variable"]
        ).strip() or "query"

        app_mode = str(current_val.get("app_mode") or "advanced-chat").strip().lower()
        allowed_modes = {
            "advanced-chat",
            "chat",
            "chatflow",
            "workflow",
            "completion",
            "text-generation",
        }
        if app_mode not in allowed_modes:
            return jsonify({
                "status": "error",
                "message": f"不支持的 app_mode: {app_mode}",
            }), 400
        # chat / chatflow 统一存为 advanced-chat，调用逻辑兼容
        if app_mode in ("chat", "chatflow"):
            app_mode = "advanced-chat"
        if app_mode == "text-generation":
            app_mode = "completion"
        current_val["app_mode"] = app_mode

        try:
            timeout = int(current_val.get("timeout_seconds") or 180)
            current_val["timeout_seconds"] = max(30, min(timeout, 600))
        except (TypeError, ValueError):
            current_val["timeout_seconds"] = 180

        if not current_val["api_key_name"]:
            return jsonify({"status": "error", "message": "api_key_name 不能为空"}), 400

        key_exists = LlmApiKey.query.filter_by(
            key_name=current_val["api_key_name"]
        ).first()
        if not key_exists:
            return jsonify({
                "status": "error",
                "message": f"API Key 不存在: {current_val['api_key_name']}，请先在 LLM 管理中创建",
            }), 400

        config.value = current_val
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(config, "value")
        db.session.commit()

        return jsonify({
            "status": "success",
            "message": "账单美化配置已更新",
            "data": config.value,
        }), 200
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error updating bill beautify config: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Failed to update config"}), 500
