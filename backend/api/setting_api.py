from flask import Blueprint, jsonify, request
from backend.models import SystemSetting, db
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

setting_api_bp = Blueprint('setting_api', __name__, url_prefix='/api/settings')

DEFAULT_NOTIFICATION_CONFIG = {
    "reminders": {
        "contract_expiry": {
            "enabled": True,
            "advance_days": 30,
            "time": "09:00",
            "last_run_date": "2000-01-01"
        },
        "trial_expiry": {
            "enabled": True,
            "advance_days": 1,
            "time": "09:00",
            "last_run_date": "2000-01-01"
        },
        "pregnancy": {
            "enabled": True,
            "advance_days": 7,
            "time": "09:00",
            "last_run_date": "2000-01-01"
        },
        "attendance": {
            "enabled": True,
            "day_of_month": 1,
            "time": "09:00",
            "last_run_date": "2000-01-01"
        },
        "insurance_expiry": {
            "enabled": True,
            "advance_days": 30,
            "time": "09:00",
            "last_run_date": "2000-01-01"
        },
        "physical_exam_expiry": {
            "enabled": True,
            "advance_days": 30,
            "time": "09:00",
            "last_run_date": "2000-01-01"
        },
        "debt": {
            "enabled": True,
            "advance_days": 3,
            "time": "09:00",
            "last_run_date": "2000-01-01"
        },
        "onboarding": {
            "enabled": True,
            "advance_days": 1,
            "time": "09:00",
            "last_run_date": "2000-01-01"
        },
        "sign_event": {
            "enabled": True
        }
    }
}


def migrate_old_config(old_val):
    """Backward compatibility logic to migrate 'switches' format to 'reminders' format."""
    import copy
    new_config = copy.deepcopy(DEFAULT_NOTIFICATION_CONFIG)
    if "switches" in old_val:
        daily_time = old_val.get("daily_reminder_time", "09:00")
        global_last_run = old_val.get("last_run_date", "2000-01-01")
        for key, enabled in old_val["switches"].items():
            if key in new_config["reminders"]:
                new_config["reminders"][key]["enabled"] = enabled
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
                for sub_k, sub_v in v_dict.items():
                    current_val["reminders"][k][sub_k] = sub_v
                
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


