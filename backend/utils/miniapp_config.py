import os
from pathlib import Path

from dotenv import dotenv_values
from flask import current_app, has_app_context


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DOTENV_PATHS = (
    PROJECT_ROOT / ".env",
    PROJECT_ROOT / "backend" / ".env",
)


def _first_nonempty(*values):
    for value in values:
        if value is None:
            continue
        stripped = str(value).strip()
        if stripped:
            return stripped
    return ""


def _dotenv_value(key):
    for dotenv_path in DOTENV_PATHS:
        if not dotenv_path.exists():
            continue
        value = dotenv_values(dotenv_path).get(key)
        if value:
            return str(value).strip()
    return ""


def get_miniapp_credentials(appid_override=None):
    config_appid = ""
    config_secret = ""
    if has_app_context():
        config_appid = current_app.config.get("WECHAT_MINIAPP_APPID", "")
        config_secret = current_app.config.get("WECHAT_MINIAPP_SECRET", "")

    appid = _first_nonempty(
        appid_override,
        config_appid,
        os.environ.get("WECHAT_MINIAPP_APPID"),
        _dotenv_value("WECHAT_MINIAPP_APPID"),
    )
    secret = _first_nonempty(
        config_secret,
        os.environ.get("WECHAT_MINIAPP_SECRET"),
        _dotenv_value("WECHAT_MINIAPP_SECRET"),
    )
    return appid, secret


def miniapp_credential_status(appid_override=None):
    appid, secret = get_miniapp_credentials(appid_override)
    return {
        "appid_configured": bool(appid),
        "secret_configured": bool(secret),
    }
