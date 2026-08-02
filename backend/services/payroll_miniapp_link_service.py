"""客户小程序工资单 URL Link 生成（与财务详情「复制链接」同源）。"""

from __future__ import annotations

import time
import urllib.parse
import uuid
from typing import Any, Optional

import requests
from flask import current_app

from backend.models import EmployeePayroll, db
from backend.utils.miniapp_config import get_miniapp_credentials, miniapp_credential_status

_MINIAPP_PAYROLL_ACCESS_TOKEN_CACHE = {
    "appid": "",
    "access_token": "",
    "expires_at": 0,
}

PAYROLL_MINIAPP_PATH = "pages/payroll-due/index"
CUSTOMER_MINIAPP_LINK_LABEL = "客户小程序工资单（点击打开）:"


def ensure_payroll_customer_share_token(payroll: EmployeePayroll) -> str:
    if not payroll:
        return ""
    if getattr(payroll, "customer_share_token", None):
        return payroll.customer_share_token
    while True:
        token = str(uuid.uuid4())
        exists = EmployeePayroll.query.filter_by(customer_share_token=token).first()
        if not exists:
            payroll.customer_share_token = token
            return token


def miniapp_payroll_access_token(config: Optional[dict] = None) -> str:
    now = time.time()
    appid, secret = get_miniapp_credentials((config or {}).get("appid"))
    if (
        _MINIAPP_PAYROLL_ACCESS_TOKEN_CACHE["appid"] == appid
        and _MINIAPP_PAYROLL_ACCESS_TOKEN_CACHE["access_token"]
        and _MINIAPP_PAYROLL_ACCESS_TOKEN_CACHE["expires_at"] > now + 60
    ):
        return _MINIAPP_PAYROLL_ACCESS_TOKEN_CACHE["access_token"]

    if not appid or not secret:
        missing = []
        if not appid:
            missing.append("WECHAT_MINIAPP_APPID")
        if not secret:
            missing.append("WECHAT_MINIAPP_SECRET")
        raise RuntimeError(f"未配置 {'/'.join(missing)}")

    response = requests.get(
        "https://api.weixin.qq.com/cgi-bin/token",
        params={
            "grant_type": "client_credential",
            "appid": appid,
            "secret": secret,
        },
        timeout=(3, 8),
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("errcode"):
        raise RuntimeError(payload.get("errmsg") or "获取小程序 access_token 失败")
    access_token = payload.get("access_token")
    if not access_token:
        raise RuntimeError("微信未返回小程序 access_token")

    _MINIAPP_PAYROLL_ACCESS_TOKEN_CACHE["appid"] = appid
    _MINIAPP_PAYROLL_ACCESS_TOKEN_CACHE["access_token"] = access_token
    _MINIAPP_PAYROLL_ACCESS_TOKEN_CACHE["expires_at"] = now + int(
        payload.get("expires_in") or 7200
    )
    return access_token


def payroll_miniapp_query(payroll: EmployeePayroll, share_token: str) -> dict:
    return {
        "shareToken": share_token,
        "payrollId": str(payroll.id),
        "contractId": str(payroll.contract_id),
        "year": payroll.year,
        "month": payroll.month,
        "source": "billing",
    }


def generate_payroll_miniapp_url_link(
    payroll: EmployeePayroll, share_token: str, config: Optional[dict]
) -> tuple[str, str]:
    access_token = miniapp_payroll_access_token(config)
    path = PAYROLL_MINIAPP_PATH
    query = urllib.parse.urlencode(payroll_miniapp_query(payroll, share_token))
    expire_days = max(1, min(int((config or {}).get("expire_days") or 30), 30))
    expire_time = int(time.time()) + expire_days * 24 * 60 * 60
    payload = {
        "path": path,
        "query": query,
        "is_expire": True,
        "expire_type": 0,
        "expire_time": expire_time,
        "env_version": (config or {}).get("env_version") or "release",
    }
    response = requests.post(
        f"https://api.weixin.qq.com/wxa/generate_urllink?access_token={access_token}",
        json=payload,
        timeout=(3, 8),
    )
    response.raise_for_status()
    data = response.json()
    if data.get("errcode"):
        raise RuntimeError(data.get("errmsg") or "生成小程序链接失败")
    url_link = data.get("url_link")
    if not url_link:
        raise RuntimeError("微信未返回小程序 URL Link")
    return url_link, f"{path}?{query}"


def build_payroll_miniapp_link_payload(
    payroll: EmployeePayroll,
    *,
    commit: bool = False,
) -> dict[str, Any]:
    """
    构建与 GET /payrolls/<id>/miniapp-link 一致的结果结构。
    commit=True 时会提交 share_token 等变更。
    """
    from backend.api.setting_api import get_or_create_miniapp_signing_config

    if not payroll:
        return {
            "success": False,
            "miniapp_url": "",
            "miniapp_path": "",
            "miniapp_error": "工资单不存在",
            "enabled": False,
        }

    if payroll.is_substitute_payroll:
        return {
            "success": False,
            "payroll_id": str(payroll.id),
            "miniapp_url": "",
            "miniapp_path": "",
            "miniapp_error": "替班工资单暂不支持生成客户小程序确认链接",
            "enabled": False,
        }

    config = get_or_create_miniapp_signing_config().value or {}
    share_token = ensure_payroll_customer_share_token(payroll)
    miniapp_path = (
        f"{PAYROLL_MINIAPP_PATH}?"
        f"{urllib.parse.urlencode(payroll_miniapp_query(payroll, share_token))}"
    )
    result: dict[str, Any] = {
        "success": True,
        "payroll_id": str(payroll.id),
        "contract_id": str(payroll.contract_id),
        "year": payroll.year,
        "month": payroll.month,
        "cycle_start_date": payroll.cycle_start_date.isoformat()
        if payroll.cycle_start_date
        else None,
        "cycle_end_date": payroll.cycle_end_date.isoformat()
        if payroll.cycle_end_date
        else None,
        "share_token": share_token,
        "miniapp_path": miniapp_path,
        "miniapp_url": "",
        "miniapp_error": "",
        "enabled": bool(config.get("enabled")),
        "env_version": config.get("env_version") or "release",
        "diagnostics": miniapp_credential_status(config.get("appid")),
        "title": (
            f"{payroll.contract.customer_name if payroll.contract else '客户'} "
            f"{payroll.year}年{payroll.month}月应付劳务费"
        ),
    }

    try:
        if not config.get("enabled"):
            result["miniapp_error"] = "小程序 URL Link 未启用，请在小程序签署配置中开启。"
            result["success"] = False
        else:
            miniapp_url, generated_path = generate_payroll_miniapp_url_link(
                payroll, share_token, config
            )
            result["miniapp_url"] = miniapp_url
            result["miniapp_path"] = generated_path or miniapp_path
    except Exception as exc:
        current_app.logger.warning(
            "生成工资单小程序 URL Link 失败 payroll_id=%s error=%s",
            getattr(payroll, "id", None),
            exc,
        )
        result["miniapp_error"] = str(exc)
        result["success"] = False

    if commit:
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            raise

    return result


def format_customer_miniapp_link_block(miniapp_url: str) -> str:
    url = (miniapp_url or "").strip()
    if not url:
        return ""
    return f"{CUSTOMER_MINIAPP_LINK_LABEL}\n{url}"


def extract_https_urls(text: str) -> list[str]:
    """从文案中提取 https URL（按出现顺序去重）。"""
    import re

    if not text:
        return []
    # 去掉常见尾部标点
    found = re.findall(r"https://[^\s<>\"']+", text)
    cleaned: list[str] = []
    seen = set()
    for raw in found:
        url = raw.rstrip(").,;，。；」』】")
        if url and url not in seen:
            seen.add(url)
            cleaned.append(url)
    return cleaned


def ensure_urls_preserved_in_text(source_text: str, target_text: str) -> str:
    """
    若 source 中的 https 链接在 target 中缺失，则追加到 target 末尾。
    用于 AI 美化后兜底，保证客户仍能点击打开小程序。
    """
    source_urls = extract_https_urls(source_text or "")
    if not source_urls:
        return target_text or ""

    result = target_text or ""
    missing = [u for u in source_urls if u not in result]
    if not missing:
        return result

    blocks = []
    for url in missing:
        blocks.append(format_customer_miniapp_link_block(url))
    suffix = "\n\n".join(blocks)
    if result.strip():
        return result.rstrip() + "\n\n" + suffix
    return suffix
