from datetime import date, datetime, timedelta
import calendar
import os
import re
import time
import uuid
from urllib.parse import urljoin

import requests
from flask import Blueprint, Response, current_app, jsonify, request
from sqlalchemy import or_
from sqlalchemy.orm import joinedload
from sqlalchemy.orm.attributes import flag_modified
from werkzeug.security import check_password_hash

from backend.models import (
    AttendanceForm,
    AttendanceRecord,
    BaseContract,
    ContractSignature,
    Customer,
    CustomerWechatAccount,
    EmployeeWechatAccount,
    MiniappContractAccess,
    MiniappDebugAccess,
    MiniappContractEvaluation,
    MiniappContractExitSummary,
    NannyContract,
    ServicePersonnel,
    SigningStatus,
    User,
    UserWechatAccount,
    db,
)
from backend.api.attendance_form_api import (
    filter_contracts_for_cycle,
    find_consecutive_contracts,
    form_to_dict,
    get_attendance_contract_end_date,
    has_following_contract,
    is_continuous_service,
    ensure_confirmed_auto_overtime_for_response,
    resolve_effective_attendance_window_for_contract,
)
from backend.api.contract_api import _build_signing_messages_payload, handle_signing_page_action
from backend.services.attendance_sync_service import normalize_auto_overtime_form_data
from backend.utils.miniapp_config import get_miniapp_credentials


miniapp_bp = Blueprint("miniapp_api", __name__, url_prefix="/api/miniapp")


ACTIVE_CONTRACT_STATUSES = ("active", "pending", "trial_active")
HISTORY_CONTRACT_STATUSES = ("finished", "completed", "terminated", "trial_succeeded")
_HOLIDAY_CACHE = {}
_HOLIDAY_CACHE_SECONDS = 24 * 60 * 60
FALLBACK_HOLIDAYS = {
    2025: {
        "01-01": {"holiday": True, "name": "元旦", "wage": 3},
        "01-28": {"holiday": True, "name": "春节", "wage": 3},
        "01-29": {"holiday": True, "name": "春节", "wage": 3},
        "01-30": {"holiday": True, "name": "春节", "wage": 3},
        "01-31": {"holiday": True, "name": "春节", "wage": 3},
        "04-04": {"holiday": True, "name": "清明节", "wage": 3},
        "05-01": {"holiday": True, "name": "劳动节", "wage": 3},
        "05-02": {"holiday": True, "name": "劳动节", "wage": 3},
        "05-31": {"holiday": True, "name": "端午节", "wage": 3},
        "10-01": {"holiday": True, "name": "国庆节", "wage": 3},
        "10-02": {"holiday": True, "name": "国庆节", "wage": 3},
        "10-03": {"holiday": True, "name": "国庆节", "wage": 3},
        "10-06": {"holiday": True, "name": "中秋节", "wage": 3},
        "01-26": {"holiday": False, "name": "春节调休", "wage": 1},
        "02-08": {"holiday": False, "name": "春节调休", "wage": 1},
        "04-27": {"holiday": False, "name": "劳动节调休", "wage": 1},
        "09-28": {"holiday": False, "name": "国庆节、中秋节调休", "wage": 1},
        "10-11": {"holiday": False, "name": "国庆节、中秋节调休", "wage": 1},
    },
    2026: {
        "01-01": {"holiday": True, "name": "元旦", "wage": 3},
        "02-16": {"holiday": True, "name": "春节", "wage": 3},
        "02-17": {"holiday": True, "name": "春节", "wage": 3},
        "02-18": {"holiday": True, "name": "春节", "wage": 3},
        "02-19": {"holiday": True, "name": "春节", "wage": 3},
        "04-05": {"holiday": True, "name": "清明节", "wage": 3},
        "05-01": {"holiday": True, "name": "劳动节", "wage": 3},
        "05-02": {"holiday": True, "name": "劳动节", "wage": 3},
        "06-19": {"holiday": True, "name": "端午节", "wage": 3},
        "09-25": {"holiday": True, "name": "中秋节", "wage": 3},
        "10-01": {"holiday": True, "name": "国庆节", "wage": 3},
        "10-02": {"holiday": True, "name": "国庆节", "wage": 3},
        "10-03": {"holiday": True, "name": "国庆节", "wage": 3},
        "01-04": {"holiday": False, "name": "元旦调休", "wage": 1},
        "02-14": {"holiday": False, "name": "春节调休", "wage": 1},
        "02-28": {"holiday": False, "name": "春节调休", "wage": 1},
        "05-09": {"holiday": False, "name": "劳动节调休", "wage": 1},
        "09-20": {"holiday": False, "name": "国庆节调休", "wage": 1},
        "10-10": {"holiday": False, "name": "国庆节调休", "wage": 1},
    },
}

MINIAPP_ICON_SVGS = {
    "contract_sign": """<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-pen-line-icon lucide-file-pen-line"><path d="M14.364 13.634a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506l4.013-4.009a1 1 0 0 0-3.004-3.004z"/><path d="M14.487 7.858A1 1 0 0 1 14 7V2"/><path d="M20 19.645V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l2.516 2.516"/><path d="M8 18h1"/></svg>""",
    
    "attendance_fill": """<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>""",
    "evaluation": """<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 14.7 9l6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.9l6-.9L12 3.5Z"/><path d="M4 21h16"/></svg>""",
    "ayi_search": """<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="4"/><path d="M2 21a8 8 0 0 1 12.4-6.7"/><circle cx="18" cy="18" r="3"/><path d="m21 21-1.5-1.5"/></svg>""",
    "contract_search": """<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8l6 6v6"/><circle cx="17" cy="17" r="3"/><path d="m21 21-1.9-1.9"/></svg>""",
}

MYMS_AYI_SEARCH_PARAMS = {
    "search",
    "type",
    "city",
    "shegnxiao",
    "shengxiao",
    "xingzuo",
    "education",
    "age",
    "pay_rate",
    "hobbies",
    "page",
    "per_page",
    "hot",
}


@miniapp_bp.route("/icons/<string:icon_key>.svg", methods=["GET"])
def miniapp_icon(icon_key):
    svg = MINIAPP_ICON_SVGS.get(icon_key)
    if not svg:
        return jsonify({"success": False, "error": "图标不存在"}), 404

    response = Response(svg, mimetype="image/svg+xml")
    response.headers["Cache-Control"] = "public, max-age=86400"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def _myms_api_base_url():
    base_url = (
        current_app.config.get("MYMS_API_BASE_URL")
        or os.environ.get("MYMS_API_BASE_URL")
        or "http://localhost:8080/myms/wp-json/myms/v1"
    )
    return str(base_url).rstrip("/") + "/"


def _myms_api_headers():
    token = (current_app.config.get("MYMS_API_TOKEN") or os.environ.get("MYMS_API_TOKEN") or "").strip()
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}


def _request_myms_api(path, params=None):
    url = urljoin(_myms_api_base_url(), path.lstrip("/"))
    try:
        response = requests.get(url, params=params or {}, headers=_myms_api_headers(), timeout=8)
    except requests.RequestException as exc:
        current_app.logger.warning("myms api request failed: %s", exc)
        return None, jsonify({"success": False, "error": "阿姨资料服务暂时不可用"}), 502

    try:
        payload = response.json()
    except ValueError:
        current_app.logger.warning("myms api returned non-json response status=%s url=%s", response.status_code, url)
        return None, jsonify({"success": False, "error": "阿姨资料服务返回异常"}), 502

    if response.status_code >= 400:
        error = payload.get("message") or payload.get("error") or "阿姨资料加载失败"
        return None, jsonify({"success": False, "error": error}), response.status_code

    return payload, None, None


def _ensure_staff_ayi_access():
    account, error = _ensure_staff_access("仅后台运营或管理员可搜索阿姨资料")
    if error:
        return None, error
    return account, None


def _ensure_staff_access(error_message="仅后台运营或管理员可访问"):
    account = _get_staff_account()
    if not account:
        return None, (jsonify({"success": False, "error": error_message}), 403)
    account.last_login_at = _now()
    db.session.commit()
    return account, None


@miniapp_bp.route("/ayi/options", methods=["GET"])
def miniapp_ayi_options():
    _, error = _ensure_staff_ayi_access()
    if error:
        return error
    payload, error_response, status_code = _request_myms_api("ayi/options")
    if error_response:
        return error_response, status_code
    return jsonify(payload)


@miniapp_bp.route("/ayi/search", methods=["GET"])
def miniapp_ayi_search():
    _, error = _ensure_staff_ayi_access()
    if error:
        return error
    params = {
        key: value
        for key, value in request.args.items()
        if key in MYMS_AYI_SEARCH_PARAMS and value not in (None, "")
    }
    payload, error_response, status_code = _request_myms_api("ayi/search", params=params)
    if error_response:
        return error_response, status_code
    return jsonify(payload)


@miniapp_bp.route("/ayi/<int:employee_id>", methods=["GET"])
def miniapp_ayi_detail(employee_id):
    payload, error_response, status_code = _request_myms_api(f"ayi/{employee_id}")
    if error_response:
        return error_response, status_code
    return jsonify(payload)


class _DebugEmployeeAccount:
    def __init__(self, debug_access, employee):
        self.id = debug_access.id
        self.mini_openid = debug_access.debugger_openid
        self.employee_id = debug_access.target_id
        self.employee = employee
        self.bind_method = "debug_access"
        self.last_login_at = debug_access.last_used_at
        self.debug_access = debug_access
        self.is_debug_access = True


class _DebugCustomerAccount:
    def __init__(self, debug_access, customer):
        self.id = debug_access.id
        self.mini_openid = debug_access.debugger_openid
        self.customer_id = debug_access.target_id
        self.customer = customer
        self.bind_method = "debug_access"
        self.last_login_at = debug_access.last_used_at
        self.debug_access = debug_access
        self.is_debug_access = True


def _now():
    return datetime.now()


def _iso(value):
    return value.isoformat() if value else None


def _holiday_cache_get(year):
    cached = _HOLIDAY_CACHE.get(year)
    if not cached:
        return None
    if time.time() - cached["timestamp"] > _HOLIDAY_CACHE_SECONDS:
        _HOLIDAY_CACHE.pop(year, None)
        return None
    return cached["data"]


def _holiday_cache_set(year, data):
    _HOLIDAY_CACHE[year] = {"timestamp": time.time(), "data": data}


def _merge_holiday_fallback(year, holidays):
    return {
        **FALLBACK_HOLIDAYS.get(year, {}),
        **(holidays or {}),
    }


def _as_midnight(value):
    if isinstance(value, datetime):
        return value
    return datetime.combine(value, datetime.min.time())


def _date_part(value):
    if not value:
        return None
    return value.date() if isinstance(value, datetime) else value


def _contract_effective_status(contract):
    raw_status = contract.status
    today = date.today()
    termination_date = _date_part(contract.termination_date)
    start_date = _date_part(contract.start_date)
    end_date = _date_part(contract.end_date)
    is_monthly_auto_renew = bool(getattr(contract, "is_monthly_auto_renew", False))

    if raw_status == "terminated" or (termination_date and termination_date <= today):
        return "terminated"
    if is_monthly_auto_renew and raw_status in ACTIVE_CONTRACT_STATUSES:
        return "active"
    if raw_status in ACTIVE_CONTRACT_STATUSES and end_date and end_date < today:
        return "finished"
    if raw_status == "pending" and start_date and start_date <= today:
        return "active"
    return raw_status


def _is_active_contract(contract):
    return _contract_effective_status(contract) in ACTIVE_CONTRACT_STATUSES


def _employee_has_signed_contract(contract):
    return _signing_status_value(contract) in {
        SigningStatus.EMPLOYEE_SIGNED.value,
        SigningStatus.SIGNED.value,
        SigningStatus.NOT_REQUIRED.value,
    }


def _is_employee_active_contract(contract):
    return _is_active_contract(contract) and _employee_has_signed_contract(contract)


def _is_history_contract(contract):
    return _contract_effective_status(contract) in HISTORY_CONTRACT_STATUSES


def _is_contract_ready_for_customer_evaluation(contract):
    return _signing_status_value(contract) in {
        SigningStatus.SIGNED.value,
        SigningStatus.NOT_REQUIRED.value,
    }


def _normalize_openid(openid):
    return (openid or "").strip()


def _normalize_phone(phone_number):
    digits = re.sub(r"\D", "", phone_number or "")
    if len(digits) == 13 and digits.startswith("86"):
        return digits[2:]
    if len(digits) == 15 and digits.startswith("0086"):
        return digits[4:]
    return digits


def _normalize_customer_name(name):
    normalized = re.sub(r"\s+", "", name or "")
    for suffix in ("先生", "女士", "小姐", "老师", "阿姨", "叔叔"):
        if normalized.endswith(suffix) and len(normalized) > len(suffix):
            return normalized[: -len(suffix)]
    return normalized


def _customer_name_matches(registered_name, submitted_name):
    registered = _normalize_customer_name(registered_name)
    submitted = _normalize_customer_name(submitted_name)
    if not registered or not submitted:
        return False
    return registered == submitted or registered.startswith(submitted) or submitted.startswith(registered)


def _id_card_last4_matches(id_card_number, id_card_last4):
    return bool(id_card_number and id_card_last4 and str(id_card_number).upper().endswith(id_card_last4.upper()))


def _id_card_last6_matches(id_card_number, id_card_last6):
    return bool(id_card_number and id_card_last6 and str(id_card_number).upper().endswith(id_card_last6.upper()))


def _parse_date(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _employee_payload(employee):
    if not employee:
        return None
    return {
        "id": str(employee.id),
        "name": employee.name,
        "phone_number": employee.phone_number,
        "is_active": employee.is_active,
    }


@miniapp_bp.route("/holidays/<int:year>", methods=["GET"])
def miniapp_holidays(year):
    current_year = date.today().year
    if year < current_year - 3 or year > current_year + 2:
        return jsonify({"success": False, "error": "节假日年份超出可查询范围"}), 400

    cached = _holiday_cache_get(year)
    if cached is not None:
        return jsonify({"success": True, "year": year, "holidays": cached, "cached": True})

    try:
        response = requests.get(
            f"https://timor.tech/api/holiday/year/{year}",
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0.0.0 Safari/537.36"
                ),
                "Accept": "application/json,text/plain,*/*",
            },
            timeout=8,
        )
        response.raise_for_status()
        payload = response.json()
        holidays = payload.get("holiday") if payload.get("code") == 0 else None
        if not isinstance(holidays, dict):
            holidays = {}
        holidays = _merge_holiday_fallback(year, holidays)
        _holiday_cache_set(year, holidays)
        return jsonify({"success": True, "year": year, "holidays": holidays, "cached": False})
    except Exception as exc:
        current_app.logger.warning("miniapp holiday fetch failed for %s: %s", year, exc)
        holidays = _merge_holiday_fallback(year, {})
        _holiday_cache_set(year, holidays)
        return jsonify({"success": True, "year": year, "holidays": holidays, "cached": False, "warning": "使用内置节假日数据"})


def _get_openid_from_request():
    return _normalize_openid(
        request.headers.get("X-Miniapp-Openid")
        or request.args.get("openid")
        or (request.get_json(silent=True) or {}).get("openid")
    )


def _get_account(openid=None):
    openid = _normalize_openid(openid) or _get_openid_from_request()
    if not openid:
        return None
    account = CustomerWechatAccount.query.filter_by(mini_openid=openid).first()
    if account:
        return account

    debug_access = _get_active_debug_access(openid, "customer")
    if not debug_access:
        return None
    customer = Customer.query.get(debug_access.target_id)
    if not customer:
        return None
    return _DebugCustomerAccount(debug_access, customer)


def _get_employee_account(openid=None):
    openid = _normalize_openid(openid) or _get_openid_from_request()
    if not openid:
        return None
    account = EmployeeWechatAccount.query.filter_by(mini_openid=openid).first()
    if account:
        return account

    debug_access = _get_active_debug_access(openid, "employee")
    if not debug_access:
        return None
    employee = ServicePersonnel.query.get(debug_access.target_id)
    if not employee:
        return None
    return _DebugEmployeeAccount(debug_access, employee)


def _is_staff_user(user):
    if not user:
        return False
    return user.role in ("admin", "teacher", "管理员") and getattr(user, "status", "active") == "active"


def _staff_user_payload(user):
    if not user:
        return None
    return {
        "id": str(user.id),
        "username": user.username,
        "phone_number": user.phone_number,
        "role": user.role,
        "can_access_ayi_profiles": _is_staff_user(user),
    }


def _get_staff_account(openid=None):
    openid = _normalize_openid(openid) or _get_openid_from_request()
    if not openid:
        return None
    account = UserWechatAccount.query.filter_by(mini_openid=openid).first()
    if account and _is_staff_user(account.user):
        return account
    return None


def _bind_staff_openid(user_id, openid, unionid=None, phone_number=None, bind_method="phone_id_card_verify"):
    openid = _normalize_openid(openid)
    if not user_id or not openid:
        return None

    account = UserWechatAccount.query.filter_by(mini_openid=openid).first()
    if account:
        account.user_id = user_id
        account.unionid = unionid or account.unionid
        account.phone_number = phone_number or account.phone_number
        account.bind_method = bind_method or account.bind_method
        account.verified_at = account.verified_at or _now()
        account.last_login_at = _now()
        return account

    account = UserWechatAccount(
        user_id=user_id,
        mini_openid=openid,
        unionid=unionid,
        phone_number=phone_number,
        bind_method=bind_method,
        verified_at=_now(),
        last_login_at=_now(),
    )
    db.session.add(account)
    return account


def _get_active_debug_access(openid, role=None):
    openid = _normalize_openid(openid)
    if not openid:
        return None
    query = MiniappDebugAccess.query.filter(
        MiniappDebugAccess.debugger_openid == openid,
        MiniappDebugAccess.enabled.is_(True),
        MiniappDebugAccess.expires_at > _now(),
    )
    if role:
        query = query.filter(MiniappDebugAccess.role == role)
    return query.order_by(MiniappDebugAccess.expires_at.desc(), MiniappDebugAccess.created_at.desc()).first()


def _touch_debug_access(account):
    debug_access = getattr(account, "debug_access", None)
    if debug_access:
        debug_access.last_used_at = _now()


def _bind_customer_openid(customer_id, openid, unionid=None, phone_number=None, bind_method="contract_sign"):
    openid = _normalize_openid(openid)
    if not customer_id or not openid:
        return None

    account = CustomerWechatAccount.query.filter_by(mini_openid=openid).first()
    if account:
        account.customer_id = customer_id
        account.unionid = unionid or account.unionid
        account.phone_number = phone_number or account.phone_number
        account.bind_method = bind_method or account.bind_method
        account.verified_at = account.verified_at or _now()
        account.last_login_at = _now()
        return account

    account = CustomerWechatAccount(
        customer_id=customer_id,
        mini_openid=openid,
        unionid=unionid,
        phone_number=phone_number,
        bind_method=bind_method,
        verified_at=_now(),
        last_login_at=_now(),
    )
    db.session.add(account)
    return account


def _bind_employee_openid(employee_id, openid, unionid=None, phone_number=None, bind_method="phone_id_card_verify"):
    openid = _normalize_openid(openid)
    if not employee_id or not openid:
        return None

    account = EmployeeWechatAccount.query.filter_by(mini_openid=openid).first()
    if account:
        account.employee_id = employee_id
        account.unionid = unionid or account.unionid
        account.phone_number = phone_number or account.phone_number
        account.bind_method = bind_method or account.bind_method
        account.verified_at = account.verified_at or _now()
        account.last_login_at = _now()
        return account

    account = EmployeeWechatAccount(
        employee_id=employee_id,
        mini_openid=openid,
        unionid=unionid,
        phone_number=phone_number,
        bind_method=bind_method,
        verified_at=_now(),
        last_login_at=_now(),
    )
    db.session.add(account)
    return account


def _exchange_code_for_session(code):
    appid, secret = get_miniapp_credentials()
    if not appid or not secret:
        raise RuntimeError("未配置 WECHAT_MINIAPP_APPID/WECHAT_MINIAPP_SECRET")

    params = {
        "appid": appid,
        "secret": secret,
        "js_code": code,
        "grant_type": "authorization_code",
    }
    last_error = None
    max_attempts = 3
    for attempt in range(max_attempts):
        try:
            response = requests.get(
                "https://api.weixin.qq.com/sns/jscode2session",
                params=params,
                timeout=(3, 8),
            )
            response.raise_for_status()
            payload = response.json()
            break
        except ValueError as exc:
            raise RuntimeError("微信登录响应解析失败，请稍后重试") from exc
        except requests.exceptions.RequestException as exc:
            last_error = exc
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            current_app.logger.warning(
                "微信 jscode2session 请求失败 attempt=%s/%s error=%s status=%s",
                attempt + 1,
                max_attempts,
                exc.__class__.__name__,
                status_code,
            )
            if attempt < max_attempts - 1:
                time.sleep(0.3 * (attempt + 1))
    else:
        raise RuntimeError("微信登录服务暂时不可用，请稍后重试")

    if payload.get("errcode"):
        raise RuntimeError(payload.get("errmsg") or "微信登录失败")
    return payload


def _allow_mock_login():
    return (
        current_app.config.get("DEBUG")
        or current_app.config.get("TESTING")
        or os.environ.get("FLASK_ENV") == "development"
        or os.environ.get("MINIAPP_ALLOW_MOCK_LOGIN", "true").lower() == "true"
    )


def _contract_type_label(contract):
    labels = {
        "nanny": "育儿嫂合同",
        "maternity_nurse": "月嫂合同",
        "nanny_trial": "育儿嫂试工合同",
        "external_substitution": "外部替班合同",
    }
    return labels.get(contract.type, contract.type)


def _contract_type_label_from_value(contract_type):
    labels = {
        "nanny": "育儿嫂合同",
        "maternity_nurse": "月嫂合同",
        "nanny_trial": "育儿嫂试工合同",
        "external_substitution": "外部替班合同",
    }
    return labels.get(contract_type, contract_type or "服务合同")


def _signing_status_value(contract):
    if not contract.signing_status:
        return None
    return contract.signing_status.value if hasattr(contract.signing_status, "value") else str(contract.signing_status)


def _customer_info_payload(contract):
    customer = contract.customer if contract else None
    if not customer and contract and contract.customer_id:
        customer = Customer.query.get(contract.customer_id)
    if not customer:
        return {
            "name": contract.customer_name if contract else "",
            "phone_number": "",
            "id_card_number": "",
            "address": "",
        }
    return {
        "id": str(customer.id),
        "name": customer.name or (contract.customer_name if contract else "") or "",
        "phone_number": customer.phone_number or "",
        "id_card_number": customer.id_card_number or "",
        "address": customer.address or "",
    }


def _employee_info_payload(contract):
    employee = contract.service_personnel if contract else None
    if not employee:
        return {
            "name": "",
            "phone_number": "",
            "id_card_number": "",
            "address": "",
        }
    return {
        "id": str(employee.id),
        "name": employee.name or "",
        "phone_number": employee.phone_number or "",
        "id_card_number": employee.id_card_number or "",
        "address": employee.address or "",
    }


def _contract_summary(contract, include_customer_token=False, include_employee_token=False):
    customer = contract.customer
    employee = contract.service_personnel
    data = {
        "id": str(contract.id),
        "type": contract.type,
        "type_label": _contract_type_label(contract),
        "customer_id": str(contract.customer_id) if contract.customer_id else None,
        "customer_name": customer.name if customer else contract.customer_name,
        "employee_id": str(contract.service_personnel_id) if contract.service_personnel_id else None,
        "employee_name": employee.name if employee else None,
        "raw_status": contract.status,
        "status": _contract_effective_status(contract),
        "signing_status": _signing_status_value(contract),
        "start_date": _iso(contract.start_date),
        "end_date": _iso(contract.end_date),
        "termination_date": _iso(contract.termination_date),
        "is_monthly_auto_renew": bool(getattr(contract, "is_monthly_auto_renew", False)),
        "employee_level": str(contract.employee_level) if contract.employee_level is not None else "",
        "security_deposit_paid": str(contract.security_deposit_paid) if contract.security_deposit_paid is not None else "",
        "deposit_amount": str(contract.deposit_amount) if getattr(contract, "deposit_amount", None) is not None else "",
        "introduction_fee": str(contract.introduction_fee) if contract.introduction_fee is not None else "",
        "management_fee_amount": str(contract.management_fee_amount) if contract.management_fee_amount is not None else "",
        "service_type": contract.service_type,
        "customer_info": _customer_info_payload(contract),
        "employee_info": _employee_info_payload(contract),
    }
    if include_customer_token:
        data["customer_signing_token"] = contract.customer_signing_token
    if include_employee_token:
        data["employee_signing_token"] = contract.employee_signing_token
    return data


def _contract_detail(contract):
    data = _contract_summary(contract)
    customer_sig = ContractSignature.query.filter_by(contract_id=contract.id, signature_type="customer").first()
    employee_sig = ContractSignature.query.filter_by(contract_id=contract.id, signature_type="employee").first()
    evaluations = (
        MiniappContractEvaluation.query.filter_by(contract_id=contract.id)
        .order_by(MiniappContractEvaluation.created_at.desc())
        .all()
    )
    attendance_forms = (
        AttendanceForm.query.options(joinedload(AttendanceForm.contract).joinedload(BaseContract.service_personnel))
        .filter(AttendanceForm.contract_id == contract.id)
        .order_by(AttendanceForm.cycle_start_date.desc())
        .all()
    )
    exit_summary = _latest_exit_summary(contract.id)
    data.update(
        {
            "service_content": contract.service_content,
            "attachment_content": contract.attachment_content,
            "notes": contract.notes,
            "template_content": contract.template.content if contract.template else "",
            "customer_signature_url": f"/api/contracts/signatures/{customer_sig.id}/image" if customer_sig else None,
            "employee_signature_url": f"/api/contracts/signatures/{employee_sig.id}/image" if employee_sig else None,
            "evaluation_count": len(evaluations),
            "evaluations": [_evaluation_payload(evaluation) for evaluation in evaluations],
            "attendance_forms": [_attendance_summary(form) for form in attendance_forms],
            "has_exit_summary": bool(exit_summary),
            "exit_summary": _exit_summary_payload(exit_summary) if exit_summary else None,
        }
    )
    return data


def _evaluation_payload(evaluation):
    if not evaluation:
        return None
    return {
        "id": str(evaluation.id),
        "contract_id": str(evaluation.contract_id),
        "employee_id": str(evaluation.employee_id) if evaluation.employee_id else None,
        "customer_id": str(evaluation.customer_id) if evaluation.customer_id else None,
        "rating": evaluation.rating,
        "tags": evaluation.tags or [],
        "comment": evaluation.comment or "",
        "created_at": _iso(evaluation.created_at),
        "updated_at": _iso(evaluation.updated_at),
    }


def _exit_summary_payload(record):
    if not record:
        return None
    data = record.data or {}
    return {
        "id": str(record.id),
        "contract_id": str(record.contract_id) if record.contract_id else None,
        "employee_id": str(record.employee_id) if record.employee_id else None,
        "customer_id": str(record.customer_id) if record.customer_id else None,
        "data": data,
        "exit_date": record.exit_date.isoformat() if record.exit_date else data.get("field_3") or data.get("exit_date") or "",
        "learned": record.learned or data.get("field_23") or data.get("learned") or "",
        "improved": record.improved or data.get("field_22") or data.get("improved") or "",
        "created_at": _iso(record.created_at),
        "updated_at": _iso(record.updated_at),
    }


def _latest_exit_summary(contract_id):
    return (
        MiniappContractExitSummary.query.filter(MiniappContractExitSummary.contract_id == contract_id)
        .order_by(MiniappContractExitSummary.created_at.desc())
        .first()
    )


def _date_only(value):
    if not value:
        return None
    return value.date() if hasattr(value, "date") else value


def _parse_record_date(value):
    if not value:
        return None
    if hasattr(value, "date"):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _record_hours(record):
    if not isinstance(record, dict):
        return 0
    try:
        hours = float(record.get("hours") or 0)
        minutes = float(record.get("minutes") or 0)
    except (TypeError, ValueError):
        hours = 0
        minutes = 0
    if hours or minutes:
        return hours + minutes / 60

    try:
        days_offset = int(record.get("daysOffset") or 0)
    except (TypeError, ValueError):
        days_offset = 0
    return max(1, days_offset + 1) * 24


def _record_covers_day(record, day):
    start = _parse_record_date((record or {}).get("date"))
    if not start or not day:
        return False
    try:
        days_offset = int((record or {}).get("daysOffset") or 0)
    except (TypeError, ValueError):
        days_offset = 0
    end = start + timedelta(days=max(0, days_offset))
    return start <= day <= end


def _record_days_in_range(record, start, end):
    record_start = _parse_record_date((record or {}).get("date"))
    if not record_start or not start or not end:
        return 0
    try:
        days_offset = int((record or {}).get("daysOffset") or 0)
    except (TypeError, ValueError):
        days_offset = 0
    record_end = record_start + timedelta(days=max(0, days_offset))
    actual_start = max(record_start, start)
    actual_end = min(record_end, end)
    if actual_start > end or actual_end < start:
        return 0
    return (actual_end - actual_start).days + 1


def _record_hours_in_range(record, start, end):
    days = _record_days_in_range(record, start, end)
    if days <= 0:
        return 0
    try:
        days_offset = int((record or {}).get("daysOffset") or 0)
    except (TypeError, ValueError):
        days_offset = 0
    total_span = max(1, days_offset + 1)
    return _record_hours(record) * (days / total_span)


def _format_attendance_amount(days=None, hours=None):
    if hours is not None:
        value = float(hours or 0)
        if abs(value) < 0.001:
            return "0"
        if value < 24:
            return f"{value:g}h"
        days = value / 24
    value = float(days or 0)
    if abs(value) < 0.001:
        return "0"
    if abs(value - round(value)) < 0.001:
        return str(int(round(value)))
    return f"{value:.1f}".rstrip("0").rstrip(".")


def _format_attendance_result_amount(days):
    value = float(days or 0)
    if abs(value) < 0.001:
        return "0"
    if abs(value - round(value)) < 0.001:
        return str(int(round(value)))
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _is_attendance_day_disabled(day, contract_info):
    if not contract_info:
        return False
    start = _parse_record_date(contract_info.get("start_date"))
    if start and day < start:
        return True
    if contract_info.get("is_monthly_auto_renew") and contract_info.get("status") == "active":
        return False
    end_source = contract_info.get("end_date")
    if (
        contract_info.get("is_monthly_auto_renew")
        and contract_info.get("status") == "terminated"
        and contract_info.get("termination_date")
    ):
        end_source = contract_info.get("termination_date")
    end = _parse_record_date(end_source)
    return bool(end and day > end)


def _attendance_preview(form, payload=None):
    form_data = form.form_data or {}
    rest_records = form_data.get("rest_records", []) or []
    leave_records = form_data.get("leave_records", []) or []
    paid_leave_records = form_data.get("paid_leave_records", []) or []
    overtime_records = form_data.get("overtime_records", []) or []
    start = _date_only(form.cycle_start_date)
    end = _date_only(form.cycle_end_date)
    contract_info = (payload or {}).get("contract_info") or {}
    valid_days = []
    current = start
    while current and end and current <= end:
        if not _is_attendance_day_disabled(current, contract_info):
            valid_days.append(current)
        current += timedelta(days=1)
    valid_start = valid_days[0] if valid_days else start
    valid_end = valid_days[-1] if valid_days else end
    holiday_records = rest_records + leave_records + paid_leave_records
    leave_hours = sum(_record_hours_in_range(record, valid_start, valid_end) for record in holiday_records)
    overtime_hours = sum(_record_hours_in_range(record, valid_start, valid_end) for record in overtime_records)
    leave_days = leave_hours / 24
    overtime_days = overtime_hours / 24
    work_days = max(0, len(valid_days) - leave_days)
    work_days = min(26, work_days)

    days = []
    current = start
    while current and end and current <= end:
        tone = "normal"
        label = "出勤"
        disabled = _is_attendance_day_disabled(current, contract_info)
        if disabled:
            tone = "disabled"
            label = ""
        elif any(_record_covers_day(record, current) for record in holiday_records):
            tone = "rest"
            label = "休假"
        if not disabled and any(_record_covers_day(record, current) for record in overtime_records):
            tone = "overtime"
            label = "加班"
        days.append(
            {
                "date": current.isoformat(),
                "day": current.day,
                "tone": tone,
                "label": label,
                "disabled": disabled,
            }
        )
        current += timedelta(days=1)

    return {
        "work_days": work_days,
        "work_days_text": _format_attendance_result_amount(work_days),
        "leave_days": leave_days,
        "leave_days_text": _format_attendance_result_amount(leave_days),
        "overtime_hours": overtime_hours,
        "overtime_days": overtime_days,
        "overtime_text": _format_attendance_result_amount(overtime_days),
        "effective_start_date": contract_info.get("start_date"),
        "effective_end_date": contract_info.get("end_date"),
        "calendar_days": days,
    }


def _attendance_record_stats(form):
    record = form.attendance_record
    if not record:
        record = AttendanceRecord.query.filter_by(
            contract_id=form.contract_id,
            cycle_start_date=form.cycle_start_date,
        ).first()
    if not record:
        return None

    details = record.attendance_details or {}
    rest_days = float(details.get("rest_days") or 0)
    leave_days = float(details.get("leave_days") or 0)
    paid_leave_days = float(details.get("paid_leave_days") or 0)
    leave_total = rest_days + leave_days + paid_leave_days
    if details.get("overtime_days") is not None:
        overtime_days = float(details.get("overtime_days") or 0)
    else:
        overtime_days = float(record.overtime_days or 0)
    work_days = float(record.total_days_worked or 0)

    return {
        "work_days": work_days,
        "work_days_text": _format_attendance_result_amount(work_days),
        "leave_days": leave_total,
        "leave_days_text": _format_attendance_result_amount(leave_total),
        "overtime_days": overtime_days,
        "overtime_hours": overtime_days * 24,
        "overtime_text": _format_attendance_result_amount(overtime_days),
        "source": "attendance_record",
    }


def _attendance_summary(form):
    contract = form.contract
    employee = contract.service_personnel if contract else None
    form_data = form.form_data or {}
    rest_records = form_data.get("rest_records", []) or []
    leave_records = form_data.get("leave_records", []) or []
    overtime_records = form_data.get("overtime_records", []) or []
    paid_leave_records = form_data.get("paid_leave_records", []) or []
    cycle_start = _date_only(form.cycle_start_date)
    cycle_end = _date_only(form.cycle_end_date)
    payload = None
    normalized_payload = {}
    if cycle_start and cycle_end:
        _, effective_start, effective_end = find_consecutive_contracts(form.employee_id, cycle_start, cycle_end)
        payload = form_to_dict(form, effective_start, effective_end)
        if effective_end is None and payload.get("contract_info"):
            payload["contract_info"]["status"] = "active"
            payload["contract_info"]["is_monthly_auto_renew"] = True
        normalized_payload = payload or {}
    preview_stats = _attendance_preview(form, payload)
    record_stats = _attendance_record_stats(form)
    return {
        "id": str(form.id),
        "contract_id": str(form.contract_id),
        "employee_id": str(form.employee_id),
        "employee_name": employee.name if employee else "",
        "customer_name": contract.customer_name if contract else "",
        "year": form.cycle_start_date.year if form.cycle_start_date else None,
        "month": form.cycle_start_date.month if form.cycle_start_date else None,
        "cycle_start_date": _iso(form.cycle_start_date),
        "cycle_end_date": _iso(form.cycle_end_date),
        "form_data": normalized_payload.get("form_data") or form.form_data or {},
        "contract_info": normalized_payload.get("contract_info") or {},
        "actual_year": normalized_payload.get("actual_year") or (form.cycle_start_date.year if form.cycle_start_date else None),
        "actual_month": normalized_payload.get("actual_month") or (form.cycle_start_date.month if form.cycle_start_date else None),
        "onboarding_time_info": normalized_payload.get("onboarding_time_info"),
        "previous_month_continuation": normalized_payload.get("previous_month_continuation"),
        "status": form.status,
        "customer_signed_at": _iso(form.customer_signed_at),
        "customer_signature_token": form.customer_signature_token,
        "stats": {
            "rest_count": len(rest_records),
            "leave_count": len(leave_records),
            "overtime_count": len(overtime_records),
            "paid_leave_count": len(paid_leave_records),
            **(record_stats or {}),
            **preview_stats,
        },
    }


def _format_miniapp_contract_signing_payload(payload):
    contract_type = payload.get("type")
    return {
        "success": True,
        "contract": {
            "id": payload.get("contract_id"),
            "role": payload.get("role"),
            "type": contract_type,
            "type_label": _contract_type_label_from_value(contract_type),
            "customer_name": payload.get("customer_name") or (payload.get("customer_info") or {}).get("name"),
            "employee_name": payload.get("employee_name") or (payload.get("employee_info") or {}).get("name"),
            "signing_status": payload.get("signing_status"),
            "start_date": payload.get("start_date"),
            "end_date": payload.get("end_date"),
            "employee_level": payload.get("employee_level"),
            "security_deposit_paid": payload.get("security_deposit_paid"),
            "deposit_amount": payload.get("deposit_amount"),
            "introduction_fee": payload.get("introduction_fee"),
            "management_fee_amount": payload.get("management_fee_amount"),
            "service_type": payload.get("service_type"),
            "service_content": payload.get("service_content"),
            "attachment_content": payload.get("attachment_content"),
            "notes": payload.get("notes"),
            "template_content": payload.get("template_content"),
            "customer_info": payload.get("customer_info") or {},
            "employee_info": payload.get("employee_info") or {},
            "customer_signature": payload.get("customer_signature"),
            "employee_signature": payload.get("employee_signature"),
        },
    }


def _ensure_customer_account():
    account = _get_account()
    if not account:
        return None, (jsonify({"success": False, "error": "客户未绑定小程序身份"}), 401)
    account.last_login_at = _now()
    return account, None


def _get_contract_accesses(openid=None):
    openid = _normalize_openid(openid) or _get_openid_from_request()
    if not openid:
        return []
    return MiniappContractAccess.query.filter_by(mini_openid=openid).all()


def _grant_contract_access(contract, openid, relation_type, source_token=None, verified_phone=None):
    openid = _normalize_openid(openid)
    if not contract or not getattr(contract, "id", None) or not openid:
        return None

    access = MiniappContractAccess.query.filter_by(
        mini_openid=openid,
        contract_id=contract.id,
        relation_type=relation_type,
    ).first()
    if not access:
        access = MiniappContractAccess(
            mini_openid=openid,
            contract_id=contract.id,
            relation_type=relation_type,
        )
        db.session.add(access)

    access.customer_id = contract.customer_id or access.customer_id
    access.source_token = source_token or access.source_token
    access.verified_phone = verified_phone or access.verified_phone
    access.verified_at = access.verified_at or _now()
    access.last_used_at = _now()
    return access


def _contract_access_ids(openid=None):
    return {access.contract_id for access in _get_contract_accesses(openid)}


def _openid_has_contract_access(contract_id, openid=None):
    openid = _normalize_openid(openid) or _get_openid_from_request()
    if not openid or not contract_id:
        return False
    return (
        MiniappContractAccess.query.filter_by(
            mini_openid=openid,
            contract_id=contract_id,
        ).first()
        is not None
    )


def _dedupe_contracts(contracts):
    seen = set()
    result = []
    for contract in contracts:
        if not contract or contract.id in seen:
            continue
        seen.add(contract.id)
        result.append(contract)
    return result


def _contracts_for_customer_openid(openid=None, customer_id=None):
    openid = _normalize_openid(openid) or _get_openid_from_request()
    contracts = []

    if customer_id:
        contracts.extend(_customer_contract_query(customer_id).all())

    access_ids = _contract_access_ids(openid)
    if access_ids:
        contracts.extend(
            BaseContract.query.options(
                joinedload(BaseContract.customer),
                joinedload(BaseContract.service_personnel),
            ).filter(BaseContract.id.in_(access_ids)).all()
        )

    return _dedupe_contracts(contracts)


def _contract_visible_to_customer_openid(contract_id, openid=None, customer_id=None):
    openid = _normalize_openid(openid) or _get_openid_from_request()
    query = BaseContract.query.options(
        joinedload(BaseContract.customer),
        joinedload(BaseContract.service_personnel),
    ).filter(BaseContract.id == contract_id)
    contract = query.first()
    if not contract:
        return None
    if customer_id and contract.customer_id == customer_id:
        return contract
    if contract.id in _contract_access_ids(openid):
        return contract
    return None


def _customer_account_can_access_contract(account, contract):
    return bool(account and contract and account.customer_id and account.customer_id == contract.customer_id)


def _contract_customer_phone(contract):
    if not contract:
        return ""
    if contract.customer and contract.customer.phone_number:
        return _normalize_phone(contract.customer.phone_number)
    if contract.customer_id:
        customer = Customer.query.get(contract.customer_id)
        if customer and customer.phone_number:
            return _normalize_phone(customer.phone_number)
    return ""


def _contract_phone_matches(contract, phone_number):
    expected = _contract_customer_phone(contract)
    submitted = _normalize_phone(phone_number)
    return bool(expected and submitted and expected == submitted)


def _customer_sign_info_from_contract(contract):
    customer = contract.customer if contract else None
    if not customer and contract and contract.customer_id:
        customer = Customer.query.get(contract.customer_id)
    if not customer:
        return None
    return {
        "name": customer.name or contract.customer_name or "",
        "phone_number": customer.phone_number or "",
        "id_card_number": customer.id_card_number or "",
        "address": customer.address or "",
    }


def _attendance_sign_auth_state(form, openid=None):
    openid = _normalize_openid(openid) or _get_openid_from_request()
    contract = form.contract if form else None
    employee_account = _get_employee_account(openid) if openid else None
    account = _get_account(openid) if openid else None
    already_signed = form and form.status in ("customer_signed", "synced")
    has_contract_access = bool(contract and _openid_has_contract_access(contract.id, openid))
    has_customer_access = _customer_account_can_access_contract(account, contract)
    blocked_by_employee = bool(employee_account and not already_signed)
    authenticated = bool(already_signed or has_contract_access or has_customer_access or not blocked_by_employee)
    return {
        "authenticated": authenticated,
        "requires_phone_auth": False,
        "blocked_by_employee": blocked_by_employee,
        "phone_hint": "",
    }


def _grant_attendance_sign_access(form, openid=None, source_token=None):
    openid = _normalize_openid(openid) or _get_openid_from_request()
    if not openid or not form or not form.contract:
        return None
    if _get_employee_account(openid):
        return None
    # 考勤确认人可能不是合同签署人，只授权当前考勤对应的这一份合同，
    # 不绑定 CustomerWechatAccount，避免看到该客户名下的其他合同。
    return _grant_contract_access(
        form.contract,
        openid,
        "attendance_signer",
        source_token=source_token or form.customer_signature_token,
    )


def _ensure_employee_account():
    account = _get_employee_account()
    if not account:
        return None, (jsonify({"success": False, "error": "服务人员未绑定小程序身份"}), 401)
    account.last_login_at = _now()
    _touch_debug_access(account)
    return account, None


def _customer_contract_query(customer_id):
    return BaseContract.query.options(
        joinedload(BaseContract.customer),
        joinedload(BaseContract.service_personnel),
    ).filter(BaseContract.customer_id == customer_id)


def _employee_contract_query(employee_id):
    return BaseContract.query.options(
        joinedload(BaseContract.customer),
        joinedload(BaseContract.service_personnel),
    ).filter(BaseContract.service_personnel_id == employee_id)


def _default_attendance_cycle():
    today = date.today()
    first_day = today.replace(day=1)
    previous_month_end = first_day.fromordinal(first_day.toordinal() - 1)
    return date(previous_month_end.year, previous_month_end.month, 1), previous_month_end


def _get_or_create_employee_attendance_forms(employee, year=None, month=None):
    if year and month:
        cycle_start = date(year, month, 1)
        cycle_end = date(year, month, calendar.monthrange(year, month)[1])
    else:
        cycle_start, cycle_end = _default_attendance_cycle()
    contracts = filter_contracts_for_cycle(employee.id, cycle_start, cycle_end)
    if not contracts and not (year and month):
        current_month_start = date.today().replace(day=1)
        current_month_end = date(
            current_month_start.year,
            current_month_start.month,
            calendar.monthrange(current_month_start.year, current_month_start.month)[1],
        )
        contracts = filter_contracts_for_cycle(employee.id, current_month_start, current_month_end)
        if contracts:
            cycle_start, cycle_end = current_month_start, current_month_end

    family_groups = {}
    for contract in contracts:
        family_key = f"family_{contract.family_id}" if contract.family_id else f"customer_{contract.customer_name}"
        family_groups.setdefault(family_key, []).append(contract)

    cycle_start_dt = _as_midnight(cycle_start)
    cycle_end_dt = _as_midnight(cycle_end)
    next_cycle_start_dt = cycle_start_dt + timedelta(days=1)

    forms = []
    for family_contracts in family_groups.values():
        primary_contract = next(
            (item for item in family_contracts if item.status == "active"),
            max(family_contracts, key=lambda item: item.start_date),
        )
        form = AttendanceForm.query.filter(
            AttendanceForm.employee_id == employee.id,
            AttendanceForm.cycle_start_date >= cycle_start_dt,
            AttendanceForm.cycle_start_date < next_cycle_start_dt,
            AttendanceForm.contract_id == primary_contract.id,
        ).first()
        if not form:
            form = AttendanceForm(
                employee_id=employee.id,
                contract_id=primary_contract.id,
                cycle_start_date=cycle_start_dt,
                cycle_end_date=cycle_end_dt,
                employee_access_token=str(employee.id),
                customer_signature_token=str(uuid.uuid4()),
                form_data={},
                status="draft",
            )
            db.session.add(form)
            db.session.flush()
        forms.append(form)
    return forms


@miniapp_bp.route("/auth/login", methods=["POST"])
def miniapp_login():
    data = request.get_json(silent=True) or {}
    code = data.get("code")
    mock_openid = data.get("mock_openid") or data.get("openid")
    unionid = data.get("unionid")

    try:
        if mock_openid and _allow_mock_login():
            session = {"openid": mock_openid, "unionid": unionid}
        elif code:
            session = _exchange_code_for_session(code)
        else:
            return jsonify({"success": False, "error": "缺少微信登录 code"}), 400

        openid = session.get("openid")
        account = _get_account(openid)
        employee_account = _get_employee_account(openid)
        staff_account = _get_staff_account(openid)
        contract_accesses = _get_contract_accesses(openid)
        has_contract_access = bool(contract_accesses)
        roles = []
        if account or has_contract_access:
            roles.append("customer")
        if employee_account:
            roles.append("employee")
        if staff_account:
            roles.append("staff")
        requires_role_select = len(roles) > 1
        default_role = ""
        if not requires_role_select:
            if staff_account:
                default_role = "staff"
            elif employee_account:
                default_role = "employee"
            elif account or has_contract_access:
                default_role = "customer"
        needs_employee_bind = not account and not employee_account and not staff_account and not has_contract_access
        if account:
            account.last_login_at = _now()
        if employee_account:
            employee_account.last_login_at = _now()
        if staff_account:
            staff_account.last_login_at = _now()
        _touch_debug_access(account)
        _touch_debug_access(employee_account)
        for access in contract_accesses:
            access.last_used_at = _now()
        if account or employee_account or staff_account or contract_accesses:
            db.session.commit()

        debug_accesses = [
            getattr(item, "debug_access", None)
            for item in (account, employee_account)
            if getattr(item, "debug_access", None)
        ]

        return jsonify(
            {
                "success": True,
                "openid": openid,
                "unionid": session.get("unionid"),
                "debug_mode": bool(debug_accesses),
                "debug_access": {
                    "id": str(debug_accesses[0].id),
                    "role": debug_accesses[0].role,
                    "target_type": debug_accesses[0].target_type,
                    "target_id": str(debug_accesses[0].target_id),
                    "expires_at": _iso(debug_accesses[0].expires_at),
                    "reason": debug_accesses[0].reason or "",
                }
                if debug_accesses
                else None,
                "bound": bool(account),
                "employee_bound": bool(employee_account),
                "staff_bound": bool(staff_account),
                "roles": roles,
                "default_role": default_role,
                "requires_role_select": requires_role_select,
                "needs_employee_bind": needs_employee_bind,
                "can_access_ayi_profiles": bool(staff_account),
                "contract_access_count": len(contract_accesses),
                "has_customer_access": bool(account or has_contract_access),
                "customer": {
                    "id": str(account.customer.id),
                    "name": account.customer.name,
                    "phone_number": account.customer.phone_number,
                }
                if account and account.customer
                else None,
                "employee": _employee_payload(employee_account.employee)
                if employee_account and employee_account.employee
                else None,
                "staff_user": _staff_user_payload(staff_account.user)
                if staff_account and staff_account.user
                else None,
            }
        )
    except Exception as e:
        current_app.logger.error(f"小程序登录失败: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@miniapp_bp.route("/auth/bind-phone", methods=["POST"])
def bind_customer_by_phone():
    data = request.get_json(silent=True) or {}
    openid = _normalize_openid(data.get("openid") or request.headers.get("X-Miniapp-Openid"))
    name = (data.get("name") or "").strip()
    phone_number = _normalize_phone(data.get("phone_number"))
    id_card_last4 = (data.get("id_card_last4") or "").strip()

    if not openid or not name or not phone_number:
        return jsonify({"success": False, "error": "缺少 openid、姓名或手机号"}), 400

    candidates = Customer.query.filter(Customer.phone_number == phone_number).all()
    if not candidates:
        candidates = [
            customer
            for customer in Customer.query.filter(Customer.phone_number.isnot(None)).all()
            if _normalize_phone(customer.phone_number) == phone_number
        ]

    customer = next((item for item in candidates if _customer_name_matches(item.name, name)), None)
    if not customer and id_card_last4:
        customer = next((item for item in candidates if _id_card_last4_matches(item.id_card_number, id_card_last4)), None)

    if customer and id_card_last4 and not _id_card_last4_matches(customer.id_card_number, id_card_last4):
        return jsonify({"success": False, "error": "身份证后四位不匹配，请检查后重试"}), 200

    if not customer:
        payload = {"success": False, "error": "未找到匹配客户，请联系运营确认登记信息"}
        if _allow_mock_login() and candidates:
            payload["debug_candidates"] = [
                {
                    "name": item.name,
                    "phone_number": item.phone_number,
                    "id_card_last4": str(item.id_card_number)[-4:] if item.id_card_number else "",
                }
                for item in candidates[:3]
            ]
        return jsonify(payload), 200

    account = _bind_customer_openid(customer.id, openid, data.get("unionid"), phone_number, "phone_verify")
    db.session.commit()
    return jsonify(
        {
            "success": True,
            "customer": {"id": str(customer.id), "name": customer.name, "phone_number": customer.phone_number},
            "account_id": str(account.id),
        }
    )


@miniapp_bp.route("/auth/bind-employee", methods=["POST"])
def bind_employee_by_phone():
    data = request.get_json(silent=True) or {}
    openid = _normalize_openid(data.get("openid") or request.headers.get("X-Miniapp-Openid"))
    phone_number = _normalize_phone(data.get("phone_number"))
    id_card_last6 = (data.get("id_card_last6") or "").strip()
    password = (data.get("password") or "").strip()

    if not openid or not phone_number or (not id_card_last6 and not password):
        return jsonify({"success": False, "error": "缺少 openid、手机号或验证信息"}), 400

    candidates = ServicePersonnel.query.filter(ServicePersonnel.phone_number == phone_number).all()
    if not candidates:
        candidates = [
            employee
            for employee in ServicePersonnel.query.filter(ServicePersonnel.phone_number.isnot(None)).all()
            if _normalize_phone(employee.phone_number) == phone_number
        ]

    employee = next((item for item in candidates if id_card_last6 and _id_card_last6_matches(item.id_card_number, id_card_last6)), None)
    if employee:
        if not employee.is_active:
            return jsonify({"success": False, "error": "该服务人员当前未激活，请联系运营处理"}), 200

        existing = EmployeeWechatAccount.query.filter(
            EmployeeWechatAccount.employee_id == employee.id,
            EmployeeWechatAccount.mini_openid != openid,
        ).first()
        if existing:
            return jsonify({"success": False, "error": "该服务人员已绑定其他微信，如需更换请联系管理员"}), 200

        account = _bind_employee_openid(employee.id, openid, data.get("unionid"), phone_number, "phone_id_card_verify")
        db.session.commit()
        return jsonify(
            {
                "success": True,
                "role": "employee",
                "employee": _employee_payload(employee),
                "account_id": str(account.id),
            }
        )

    if password:
        user_candidates = User.query.filter(User.phone_number == phone_number).all()
        if not user_candidates:
            user_candidates = [
                user
                for user in User.query.filter(User.phone_number.isnot(None)).all()
                if _normalize_phone(user.phone_number) == phone_number
            ]
        staff_user = next(
            (
                user
                for user in user_candidates
                if _is_staff_user(user) and check_password_hash(user.password, password)
            ),
            None,
        )
        if staff_user:
            account = _bind_staff_openid(staff_user.id, openid, data.get("unionid"), phone_number, "phone_password_verify")
            db.session.commit()
            return jsonify(
                {
                    "success": True,
                    "role": "staff",
                    "staff_user": _staff_user_payload(staff_user),
                    "account_id": str(account.id),
                    "can_access_ayi_profiles": True,
                }
            )

    payload = {"success": False, "error": "未找到匹配服务人员，或后台用户密码不正确"}
    if _allow_mock_login() and candidates:
        payload["debug_candidates"] = [
            {
                "name": item.name,
                "phone_number": item.phone_number,
                "id_card_last6": str(item.id_card_number)[-6:] if item.id_card_number else "",
            }
            for item in candidates[:3]
        ]
    return jsonify(payload), 200


@miniapp_bp.route("/contracts/sign/<string:token>", methods=["GET", "POST"])
def miniapp_contract_sign(token):
    if request.method == "GET":
        response = handle_signing_page_action(token)
        if isinstance(response, tuple):
            flask_response, status_code = response[0], response[1]
        else:
            flask_response = response
            status_code = getattr(flask_response, "status_code", 200)
        if status_code >= 400:
            return response
        return jsonify(_format_miniapp_contract_signing_payload(flask_response.get_json() or {})), status_code

    openid = _get_openid_from_request()
    customer_contract = BaseContract.query.filter_by(customer_signing_token=token).first()
    employee_contract = None if customer_contract else BaseContract.query.filter_by(employee_signing_token=token).first()
    if openid and customer_contract and _get_employee_account(openid):
        return jsonify({"success": False, "error": "员工账号不能代客户签署合同，请分享给客户本人签署"}), 403
    if customer_contract:
        data = request.get_json(silent=True) or {}
        if not data.get("customer_info"):
            customer_info = _customer_sign_info_from_contract(customer_contract)
            if not customer_info or not all(customer_info.get(field) for field in ("name", "phone_number", "id_card_number", "address")):
                return jsonify({"success": False, "error": "合同甲方档案信息不完整，请联系运营补全后再签署"}), 400
            data["customer_info"] = customer_info
            request._cached_json = (data, data)
    if employee_contract:
        if _get_account(openid):
            return jsonify({"success": False, "error": "客户账号不能代服务人员签署合同，请由服务人员本人签署"}), 403

    response = handle_signing_page_action(token)
    flask_response = response[0] if isinstance(response, tuple) else response
    status_code = response[1] if isinstance(response, tuple) and len(response) > 1 else getattr(flask_response, "status_code", 200)
    if status_code >= 400:
        return response

    contract = customer_contract
    if openid and contract and contract.customer_id:
        _grant_contract_access(contract, openid, "contract_signer", source_token=token)
        _bind_customer_openid(contract.customer_id, openid, bind_method="contract_sign")
    else:
        contract = employee_contract
        if openid and contract and contract.service_personnel_id:
            _bind_employee_openid(contract.service_personnel_id, openid, bind_method="contract_sign")
    if openid and contract:
        db.session.commit()
    return flask_response


@miniapp_bp.route("/customer/overview", methods=["GET"])
def customer_overview():
    openid = _get_openid_from_request()
    account = _get_account(openid)
    customer_id = account.customer_id if account else None
    contracts = sorted(
        _contracts_for_customer_openid(openid, customer_id),
        key=lambda item: item.start_date or datetime.min,
        reverse=True,
    )
    contract_ids = [contract.id for contract in contracts]
    active_contracts = [c for c in contracts if _is_active_contract(c)]
    history_contracts = [c for c in contracts if _is_history_contract(c)]

    pending_contracts = [
        c for c in contracts
        if c.signing_status in (SigningStatus.UNSIGNED, SigningStatus.EMPLOYEE_SIGNED)
        and c.customer_signing_token
        and not _is_history_contract(c)
    ]
    pending_attendance = []
    if contract_ids:
        pending_attendance = (
            AttendanceForm.query.options(joinedload(AttendanceForm.contract).joinedload(BaseContract.service_personnel))
            .filter(
                AttendanceForm.contract_id.in_(contract_ids),
                AttendanceForm.status == "employee_confirmed",
                AttendanceForm.customer_signature_token.isnot(None),
            )
            .order_by(AttendanceForm.cycle_start_date.desc())
            .all()
        )
    evaluated_contract_ids = set()
    if openid and contract_ids:
        evaluated_contract_ids = {
            item.contract_id
            for item in MiniappContractEvaluation.query.filter(
                MiniappContractEvaluation.mini_openid == openid,
                MiniappContractEvaluation.contract_id.in_(contract_ids),
            ).all()
        }
    pending_evaluations = [
        contract for contract in history_contracts
        if contract.id not in evaluated_contract_ids
        and contract.service_personnel_id
        and _is_contract_ready_for_customer_evaluation(contract)
    ]

    if account:
        account.last_login_at = _now()
    db.session.commit()
    display_customer_name = account.customer.name if account and account.customer else ""
    display_customer_phone = account.customer.phone_number if account and account.customer else ""
    if not display_customer_name and contracts:
        display_customer_name = contracts[0].customer_name or ""
    return jsonify(
        {
            "success": True,
            "customer": {
                "id": str(account.customer.id) if account and account.customer else None,
                "name": display_customer_name or "客户",
                "phone_number": display_customer_phone,
                "auto_discovered": not bool(account),
            },
            "todos": {
                "contracts": [_contract_summary(c, include_customer_token=True) for c in pending_contracts],
                "attendance_forms": [_attendance_summary(f) for f in pending_attendance],
                "evaluations": [_contract_summary(c) for c in pending_evaluations],
            },
            "recent_contracts": [_contract_summary(c) for c in contracts[:1]],
            "active_contracts": [_contract_summary(c) for c in active_contracts],
            "history_contracts": [_contract_summary(c) for c in history_contracts],
        }
    )


@miniapp_bp.route("/customer/contracts", methods=["GET"])
def customer_contracts():
    openid = _get_openid_from_request()
    account = _get_account(openid)
    status_group = request.args.get("status_group", "all")
    contracts = sorted(
        _contracts_for_customer_openid(openid, account.customer_id if account else None),
        key=lambda item: item.start_date or datetime.min,
        reverse=True,
    )
    if status_group == "active":
        contracts = [contract for contract in contracts if _is_active_contract(contract)]
    elif status_group == "history":
        contracts = [contract for contract in contracts if _is_history_contract(contract)]

    db.session.commit()
    return jsonify({"success": True, "contracts": [_contract_summary(c) for c in contracts]})


@miniapp_bp.route("/customer/contracts/<uuid:contract_id>", methods=["GET"])
def customer_contract_detail(contract_id):
    openid = _get_openid_from_request()
    account = _get_account(openid)
    contract = _contract_visible_to_customer_openid(contract_id, openid, account.customer_id if account else None)
    db.session.commit()
    if not contract:
        return jsonify({"success": False, "error": "合同不存在或无权访问"}), 404
    data = _contract_detail(contract)
    data["customer_signing_token"] = contract.customer_signing_token
    return jsonify({"success": True, "contract": data})


@miniapp_bp.route("/customer/attendance", methods=["GET"])
def customer_attendance_forms():
    openid = _get_openid_from_request()
    account = _get_account(openid)
    contracts = _contracts_for_customer_openid(openid, account.customer_id if account else None)
    contract_ids = [contract.id for contract in contracts]
    if not contract_ids:
        db.session.commit()
        return jsonify({"success": True, "attendance_forms": []})

    status = request.args.get("status")
    query = (
        AttendanceForm.query.options(joinedload(AttendanceForm.contract).joinedload(BaseContract.service_personnel))
        .filter(AttendanceForm.contract_id.in_(contract_ids))
    )
    if status:
        query = query.filter(AttendanceForm.status == status)

    forms = query.order_by(AttendanceForm.cycle_start_date.desc()).all()
    db.session.commit()
    return jsonify({"success": True, "attendance_forms": [_attendance_summary(f) for f in forms]})


@miniapp_bp.route("/customer/contracts/<uuid:contract_id>/evaluation", methods=["GET", "POST"])
def customer_contract_evaluation(contract_id):
    openid = _get_openid_from_request()
    if not openid:
        return jsonify({"success": False, "error": "请先完成微信登录"}), 401

    if _get_employee_account(openid):
        return jsonify({"success": False, "error": "员工账号不能填写客户评价，请分享给客户本人"}), 403

    account = _get_account(openid)
    contract = _contract_visible_to_customer_openid(contract_id, openid, account.customer_id if account else None)
    if not contract:
        contract = BaseContract.query.options(
            joinedload(BaseContract.customer),
            joinedload(BaseContract.service_personnel),
        ).filter(BaseContract.id == contract_id).first()
    if not contract:
        return jsonify({"success": False, "error": "合同不存在"}), 404

    evaluation = MiniappContractEvaluation.query.filter_by(
        mini_openid=openid,
        contract_id=contract.id,
    ).first()

    if request.method == "GET":
        return jsonify({"success": True, "evaluation": _evaluation_payload(evaluation), "contract": _contract_summary(contract)})

    data = request.get_json(silent=True) or {}
    try:
        rating = int(data.get("rating") or 0)
    except (TypeError, ValueError):
        rating = 0
    if rating < 1 or rating > 5:
        return jsonify({"success": False, "error": "请选择 1-5 星评价"}), 400

    tags = data.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    comment = (data.get("comment") or "").strip()

    if not evaluation:
        evaluation = MiniappContractEvaluation(
            mini_openid=openid,
            contract_id=contract.id,
        )
        db.session.add(evaluation)

    evaluation.customer_id = contract.customer_id
    evaluation.employee_id = contract.service_personnel_id
    evaluation.rating = rating
    evaluation.tags = tags[:12]
    evaluation.comment = comment
    evaluation.source_token = data.get("source_token") or evaluation.source_token
    _grant_contract_access(contract, openid, "evaluation_submitter", source_token=data.get("source_token"))
    db.session.commit()
    return jsonify({"success": True, "evaluation": _evaluation_payload(evaluation)})


@miniapp_bp.route("/customer/evaluations", methods=["GET"])
def customer_evaluations():
    openid = _get_openid_from_request()
    account = _get_account(openid)
    contracts = _contracts_for_customer_openid(openid, account.customer_id if account else None)
    contract_ids = [contract.id for contract in contracts]
    if not contract_ids:
        return jsonify({"success": True, "evaluations": []})

    evaluations = (
        MiniappContractEvaluation.query.filter(MiniappContractEvaluation.contract_id.in_(contract_ids))
        .order_by(MiniappContractEvaluation.created_at.desc())
        .all()
    )
    return jsonify({"success": True, "evaluations": [_evaluation_payload(item) for item in evaluations]})


def _staff_contract_query():
    return BaseContract.query.options(
        joinedload(BaseContract.customer),
        joinedload(BaseContract.service_personnel),
    )


def _staff_contract_card(contract):
    return _contract_summary(
        contract,
        include_customer_token=bool(contract.customer_signing_token),
        include_employee_token=bool(contract.employee_signing_token),
    )


def _staff_contract_expiring_query(query):
    today = datetime.now()
    deadline = today + timedelta(days=15)
    return query.filter(
        BaseContract.type == "nanny",
        BaseContract.status.notin_(("finished", "completed", "terminated")),
        BaseContract.end_date >= today,
        BaseContract.end_date <= deadline,
        or_(
            NannyContract.is_monthly_auto_renew.is_(False),
            NannyContract.is_monthly_auto_renew.is_(None),
        ),
    )


def _apply_staff_contract_stat_filter(query, stat_filter):
    if stat_filter == "customer_pending":
        return query.filter(BaseContract.signing_status.in_([
            SigningStatus.UNSIGNED,
            SigningStatus.EMPLOYEE_SIGNED,
        ]))
    if stat_filter == "employee_pending":
        return query.filter(BaseContract.signing_status.in_([
            SigningStatus.UNSIGNED,
            SigningStatus.CUSTOMER_SIGNED,
        ]))
    if stat_filter == "expiring":
        return _staff_contract_expiring_query(query)
    return query


def _staff_contract_stats(query):
    return {
        "all": query.order_by(None).count(),
        "customerPending": _apply_staff_contract_stat_filter(query, "customer_pending").order_by(None).count(),
        "employeePending": _apply_staff_contract_stat_filter(query, "employee_pending").order_by(None).count(),
        "expiring": _staff_contract_expiring_query(query).order_by(None).count(),
    }


@miniapp_bp.route("/staff/contracts", methods=["GET"])
def staff_contracts():
    _, error = _ensure_staff_access("仅后台运营或管理员可查看合同")
    if error:
        return error

    search = (request.args.get("search") or "").strip()
    contract_type = (request.args.get("type") or "").strip()
    signing_status = (request.args.get("signing_status") or "").strip()
    status = (request.args.get("status") or "").strip()
    stat_filter = (request.args.get("stat_filter") or "").strip()
    page = max(1, request.args.get("page", 1, type=int) or 1)
    per_page = min(max(1, request.args.get("per_page", 10, type=int) or 10), 50)

    query = _staff_contract_query()

    if search:
        pinyin_search = search.replace(" ", "")
        query = query.outerjoin(ServicePersonnel, BaseContract.service_personnel_id == ServicePersonnel.id)
        query = query.filter(
            or_(
                BaseContract.customer_name.ilike(f"%{search}%"),
                BaseContract.customer_name_pinyin.ilike(f"%{pinyin_search}%"),
                ServicePersonnel.name.ilike(f"%{search}%"),
                ServicePersonnel.name_pinyin.ilike(f"%{pinyin_search}%"),
            )
        )

    if contract_type in ("nanny", "maternity_nurse", "nanny_trial", "external_substitution"):
        query = query.filter(BaseContract.type == contract_type)

    if signing_status:
        query = query.filter(BaseContract.signing_status == signing_status)

    if status:
        query = query.filter(BaseContract.status == status)

    stats = _staff_contract_stats(query)
    query = _apply_staff_contract_stat_filter(query, stat_filter)

    paginated = query.order_by(BaseContract.created_at.desc()).paginate(
        page=page,
        per_page=per_page,
        error_out=False,
    )
    db.session.commit()
    return jsonify(
        {
            "success": True,
            "contracts": [_staff_contract_card(contract) for contract in paginated.items],
            "total": paginated.total,
            "page": paginated.page,
            "pages": paginated.pages,
            "per_page": paginated.per_page,
            "stats": stats,
        }
    )


@miniapp_bp.route("/staff/contracts/<uuid:contract_id>", methods=["GET"])
def staff_contract_detail(contract_id):
    _, error = _ensure_staff_access("仅后台运营或管理员可查看合同")
    if error:
        return error

    contract = _staff_contract_query().filter(BaseContract.id == contract_id).first()
    db.session.commit()
    if not contract:
        return jsonify({"success": False, "error": "合同不存在"}), 404

    data = _contract_detail(contract)
    data["customer_signing_token"] = contract.customer_signing_token
    data["employee_signing_token"] = contract.employee_signing_token
    return jsonify({"success": True, "contract": data})


@miniapp_bp.route("/staff/contracts/<uuid:contract_id>/signing-messages", methods=["GET"])
def staff_contract_signing_messages(contract_id):
    _, error = _ensure_staff_access("仅后台运营或管理员可查看签约信息")
    if error:
        return error

    try:
        payload = _build_signing_messages_payload(str(contract_id))
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 404
    except RuntimeError as exc:
        return jsonify({"success": False, "error": str(exc)}), 500
    except Exception as exc:
        current_app.logger.error("小程序生成签约信息失败 contract_id=%s error=%s", contract_id, exc, exc_info=True)
        return jsonify({"success": False, "error": "签约信息生成失败"}), 500
    return jsonify({"success": True, **payload})


@miniapp_bp.route("/employee/overview", methods=["GET"])
def employee_overview():
    account, error_response = _ensure_employee_account()
    if error_response:
        return error_response

    employee = account.employee
    contracts = _employee_contract_query(employee.id).order_by(BaseContract.start_date.desc()).all()
    pending_contracts = [
        contract
        for contract in contracts
        if contract.signing_status in (SigningStatus.UNSIGNED, SigningStatus.CUSTOMER_SIGNED)
        and contract.employee_signing_token
        and not _is_history_contract(contract)
    ]
    active_contracts = [contract for contract in contracts if _is_employee_active_contract(contract)]
    history_contracts = [contract for contract in contracts if _is_history_contract(contract)]
    attendance_forms = _get_or_create_employee_attendance_forms(employee)

    db.session.commit()
    return jsonify(
        {
            "success": True,
            "employee": _employee_payload(employee),
            "todos": {
                "contracts": [_contract_summary(contract, include_employee_token=True) for contract in pending_contracts],
                "attendance_forms": [_attendance_summary(form) for form in attendance_forms if form.status in ("draft", "employee_confirmed")],
            },
            "recent_contracts": [_contract_summary(contract) for contract in contracts[:1]],
            "active_contracts": [_contract_summary(contract) for contract in active_contracts],
            "history_contracts": [_contract_summary(contract) for contract in history_contracts],
        }
    )


@miniapp_bp.route("/employee/contracts", methods=["GET"])
def employee_contracts():
    account, error_response = _ensure_employee_account()
    if error_response:
        return error_response

    status_group = request.args.get("status_group", "all")
    contracts = _employee_contract_query(account.employee_id).order_by(BaseContract.start_date.desc()).all()
    if status_group == "active":
        contracts = [contract for contract in contracts if _is_employee_active_contract(contract)]
    elif status_group == "history":
        contracts = [contract for contract in contracts if _is_history_contract(contract)]

    db.session.commit()
    return jsonify({"success": True, "contracts": [_contract_summary(contract) for contract in contracts]})


@miniapp_bp.route("/employee/contracts/<uuid:contract_id>", methods=["GET"])
def employee_contract_detail(contract_id):
    account, error_response = _ensure_employee_account()
    if error_response:
        return error_response

    contract = _employee_contract_query(account.employee_id).filter(BaseContract.id == contract_id).first()
    db.session.commit()
    if not contract:
        return jsonify({"success": False, "error": "合同不存在或无权访问"}), 404
    data = _contract_detail(contract)
    data["customer_signing_token"] = contract.customer_signing_token
    data["employee_signing_token"] = contract.employee_signing_token
    return jsonify({"success": True, "contract": data})


@miniapp_bp.route("/employee/contracts/<uuid:contract_id>/exit-summary", methods=["GET", "POST"])
def employee_exit_summary(contract_id):
    account, error_response = _ensure_employee_account()
    if error_response:
        return error_response

    contract = _employee_contract_query(account.employee_id).filter(BaseContract.id == contract_id).first()
    if not contract:
        return jsonify({"success": False, "error": "合同不存在或无权访问"}), 404

    summary = _latest_exit_summary(contract.id)
    if request.method == "GET":
        return jsonify({"success": True, "summary": _exit_summary_payload(summary), "contract": _contract_summary(contract)})

    data = request.get_json(silent=True) or {}
    payload = data.get("data") or {}
    if not isinstance(payload, dict):
        payload = {}

    learned = (data.get("learned") or payload.get("field_23") or "").strip()
    improved = (data.get("improved") or payload.get("field_22") or "").strip()
    exit_date = (data.get("exit_date") or payload.get("field_3") or "").strip()
    customer_name = contract.customer.name if contract.customer else contract.customer_name

    if not learned and not improved:
        return jsonify({"success": False, "error": "请填写下户总结内容"}), 400

    normalized_data = {
        **payload,
        "field_1": payload.get("field_1") or account.employee.name,
        "field_2": payload.get("field_2") or customer_name,
        "field_3": exit_date,
        "field_22": improved,
        "field_23": learned,
        "employee_id": str(account.employee_id),
        "contract_id": str(contract.id),
    }
    parsed_exit_date = _parse_date(exit_date)

    if not summary:
        summary = MiniappContractExitSummary(
            contract_id=contract.id,
            employee_id=account.employee_id,
            customer_id=contract.customer_id,
            mini_openid=account.mini_openid,
        )
        db.session.add(summary)
    summary.employee_id = account.employee_id
    summary.customer_id = contract.customer_id
    summary.mini_openid = account.mini_openid
    summary.exit_date = parsed_exit_date
    summary.learned = learned
    summary.improved = improved
    summary.data = normalized_data

    db.session.commit()
    return jsonify({"success": True, "summary": _exit_summary_payload(summary)})


@miniapp_bp.route("/employee/attendance", methods=["GET"])
def employee_attendance_forms():
    account, error_response = _ensure_employee_account()
    if error_response:
        return error_response

    year = request.args.get("year", type=int)
    month = request.args.get("month", type=int)
    if (year and not month) or (month and not year):
        return jsonify({"success": False, "error": "year/month 必须同时提供"}), 400

    forms = _get_or_create_employee_attendance_forms(account.employee, year=year, month=month)
    db.session.commit()
    return jsonify({"success": True, "attendance_forms": [_attendance_summary(form) for form in forms]})


@miniapp_bp.route("/employee/attendance/<uuid:form_id>", methods=["GET"])
def employee_attendance_detail(form_id):
    account, error_response = _ensure_employee_account()
    if error_response:
        return error_response

    form = AttendanceForm.query.options(joinedload(AttendanceForm.contract)).filter(
        AttendanceForm.id == form_id,
        AttendanceForm.employee_id == account.employee_id,
    ).first()
    if not form:
        return jsonify({"success": False, "error": "考勤表不存在或无权访问"}), 404
    ensure_confirmed_auto_overtime_for_response(form)

    cycle_start = form.cycle_start_date.date() if hasattr(form.cycle_start_date, "date") else form.cycle_start_date
    cycle_end = form.cycle_end_date.date() if hasattr(form.cycle_end_date, "date") else form.cycle_end_date
    effective_start, effective_end = resolve_effective_attendance_window_for_contract(
        form.employee_id,
        cycle_start,
        cycle_end,
        form.contract,
    )
    return jsonify({"success": True, "attendance_form": form_to_dict(form, effective_start, effective_end)})


@miniapp_bp.route("/employee/attendance/by-token/<string:employee_token>", methods=["GET"])
def employee_attendance_detail_by_token(employee_token):
    account, error_response = _ensure_employee_account()
    if error_response:
        return error_response

    token_employee_id = None
    try:
        token_uuid = uuid.UUID(employee_token.split("_")[0])
        token_employee_id = token_uuid
    except ValueError:
        token_uuid = None

    if token_uuid and token_uuid != account.employee_id:
        form = AttendanceForm.query.filter(
            AttendanceForm.id == token_uuid,
            AttendanceForm.employee_id == account.employee_id,
        ).first()
        if not form:
            return jsonify({"success": False, "error": "考勤表不存在或无权访问"}), 404
    elif token_employee_id and token_employee_id != account.employee_id:
        return jsonify({"success": False, "error": "无权访问该服务人员考勤"}), 403

    from backend.api.attendance_form_api import get_attendance_form_by_token

    response = get_attendance_form_by_token(employee_token)
    flask_response = response[0] if isinstance(response, tuple) else response
    status_code = response[1] if isinstance(response, tuple) and len(response) > 1 else getattr(flask_response, "status_code", 200)
    payload = flask_response.get_json(silent=True) or {}
    if status_code >= 400:
        return jsonify({"success": False, "error": payload.get("error") or "考勤表加载失败"}), status_code
    return jsonify({"success": True, "attendance_form": payload})


@miniapp_bp.route("/employee/attendance/<uuid:form_id>", methods=["PUT"])
def employee_attendance_update(form_id):
    account, error_response = _ensure_employee_account()
    if error_response:
        return error_response

    form = AttendanceForm.query.filter(
        AttendanceForm.id == form_id,
        AttendanceForm.employee_id == account.employee_id,
    ).first()
    if not form:
        return jsonify({"success": False, "error": "考勤表不存在或无权访问"}), 404
    if form.status in ("customer_signed", "synced"):
        return jsonify({"success": False, "error": "考勤表已由客户签署，无法修改"}), 400

    data = request.get_json(silent=True) or {}
    form_data = data.get("form_data")
    action = data.get("action")
    should_apply_auto = action == "confirm" or form.status == "employee_confirmed"
    if form_data is not None:
        form.form_data = form_data or {}
        if should_apply_auto:
            normalized_form_data, normalized = normalize_auto_overtime_form_data(
                form,
                allow_create_missing_auto=True,
            )
            if normalized:
                form.form_data = normalized_form_data
        else:
            form.form_data["overtime_records"] = [
                item for item in (form.form_data.get("overtime_records") or [])
                if not item.get("is_auto")
            ]
        flag_modified(form, "form_data")

    if action == "confirm":
        if form_data is None:
            normalized_form_data, normalized = normalize_auto_overtime_form_data(
                form,
                allow_create_missing_auto=True,
            )
            if normalized:
                form.form_data = normalized_form_data
                flag_modified(form, "form_data")

        validation_errors = []
        contract = BaseContract.query.get(form.contract_id)
        cycle_start = form.cycle_start_date.date() if isinstance(form.cycle_start_date, datetime) else form.cycle_start_date
        cycle_end = form.cycle_end_date.date() if isinstance(form.cycle_end_date, datetime) else form.cycle_end_date

        contract_start = None
        if contract and contract.start_date:
            contract_start = contract.start_date.date() if isinstance(contract.start_date, datetime) else contract.start_date

        current_form_data = form.form_data or {}
        if contract_start and cycle_start <= contract_start <= cycle_end and not is_continuous_service(contract):
            onboarding_record = next(
                (item for item in current_form_data.get("onboarding_records", []) if item.get("date") == contract_start.isoformat()),
                None,
            )
            if not onboarding_record:
                validation_errors.append(f"合同开始日 {contract_start.strftime('%m月%d日')} 需要填写「上户」记录")
            elif not onboarding_record.get("startTime") or not onboarding_record.get("endTime"):
                validation_errors.append(f"上户日 {contract_start.strftime('%m月%d日')} 的具体时间未填写")

        contract_end_date = get_attendance_contract_end_date(contract)

        if contract_end_date and cycle_start <= contract_end_date <= cycle_end and not has_following_contract(contract):
            offboarding_record = next(
                (item for item in current_form_data.get("offboarding_records", []) if item.get("date") == contract_end_date.isoformat()),
                None,
            )
            if not offboarding_record:
                validation_errors.append(f"合同结束日 {contract_end_date.strftime('%m月%d日')} 需要填写「下户」记录")
            elif not offboarding_record.get("startTime") or not offboarding_record.get("endTime"):
                validation_errors.append(f"下户日 {contract_end_date.strftime('%m月%d日')} 的具体时间未填写")

        if validation_errors:
            return jsonify({"success": False, "error": "；".join(validation_errors)}), 400

        form.status = "employee_confirmed"
        if not form.customer_signature_token:
            form.customer_signature_token = str(uuid.uuid4())

    db.session.commit()
    cycle_start = form.cycle_start_date.date() if isinstance(form.cycle_start_date, datetime) else form.cycle_start_date
    cycle_end = form.cycle_end_date.date() if isinstance(form.cycle_end_date, datetime) else form.cycle_end_date
    _, effective_start, effective_end = find_consecutive_contracts(form.employee_id, cycle_start, cycle_end)
    result = form_to_dict(form, effective_start, effective_end)
    result["actual_year"] = cycle_start.year
    result["actual_month"] = cycle_start.month
    if effective_end is None and result.get("contract_info"):
        result["contract_info"]["status"] = "active"
        result["contract_info"]["is_monthly_auto_renew"] = True
    return jsonify({"success": True, "attendance_form": result})


@miniapp_bp.route("/attendance/sign/<string:signature_token>", methods=["GET"])
def miniapp_attendance_sign_detail(signature_token):
    form = AttendanceForm.query.filter_by(customer_signature_token=signature_token).first()
    if not form:
        return jsonify({"success": False, "error": "无效的签署链接"}), 404
    access = _grant_attendance_sign_access(form, source_token=signature_token)

    year = request.args.get("year", type=int)
    month = request.args.get("month", type=int)
    contract_id_param = request.args.get("contractId", type=str)
    if year and month:
        from backend.api.attendance_form_api import get_attendance_form_by_token

        employee_token = str(form.employee_id)
        with current_app.test_request_context(
            f"/api/attendance-forms/by-token/{employee_token}",
            query_string={
                "year": year,
                "month": month,
                "contractId": contract_id_param or str(form.contract_id),
            },
        ):
            response = get_attendance_form_by_token(employee_token)
        flask_response = response[0] if isinstance(response, tuple) else response
        status_code = response[1] if isinstance(response, tuple) and len(response) > 1 else getattr(flask_response, "status_code", 200)
        payload = flask_response.get_json(silent=True) or {}
        if status_code >= 400:
            return jsonify({"success": False, "error": payload.get("error") or "考勤表加载失败"}), status_code
        if access:
            db.session.commit()
        return jsonify(
            {
                "success": True,
                "attendance_form": payload,
                "auth": _attendance_sign_auth_state(form),
            }
        )

    cycle_start = form.cycle_start_date.date() if hasattr(form.cycle_start_date, "date") else form.cycle_start_date
    cycle_end = form.cycle_end_date.date() if hasattr(form.cycle_end_date, "date") else form.cycle_end_date
    ensure_confirmed_auto_overtime_for_response(form)
    _, effective_start, effective_end = find_consecutive_contracts(form.employee_id, cycle_start, cycle_end)
    result = form_to_dict(form, effective_start, effective_end)
    if access:
        db.session.commit()
    return jsonify(
        {
            "success": True,
            "attendance_form": result,
            "auth": _attendance_sign_auth_state(form),
        }
    )


@miniapp_bp.route("/attendance/sign/<string:signature_token>/auth", methods=["POST"])
def miniapp_attendance_sign_auth(signature_token):
    form = AttendanceForm.query.options(joinedload(AttendanceForm.contract).joinedload(BaseContract.customer)).filter_by(
        customer_signature_token=signature_token
    ).first()
    if not form:
        return jsonify({"success": False, "error": "无效的签署链接"}), 404

    openid = _get_openid_from_request()
    if not openid:
        return jsonify({"success": False, "error": "请先完成微信登录"}), 401
    if _get_employee_account(openid):
        return jsonify({"success": False, "error": "员工账号不能代客户签署考勤，请分享给客户本人确认"}), 403

    state = _attendance_sign_auth_state(form, openid)
    if state["authenticated"]:
        return jsonify({"success": True, "auth": state})

    _grant_attendance_sign_access(form, openid, signature_token)
    db.session.commit()
    return jsonify({"success": True, "auth": _attendance_sign_auth_state(form, openid)})


@miniapp_bp.route("/attendance/sign/<string:signature_token>", methods=["POST"])
def miniapp_attendance_sign_submit(signature_token):
    from backend.api.attendance_form_api import submit_customer_signature

    openid = _get_openid_from_request()
    if not openid:
        return jsonify({"success": False, "error": "请先完成微信登录"}), 401

    employee_account = _get_employee_account(openid) if openid else None
    if employee_account:
        return jsonify({"success": False, "error": "员工账号不能代客户签署考勤，请分享给客户本人确认"}), 403

    form = AttendanceForm.query.options(joinedload(AttendanceForm.contract).joinedload(BaseContract.customer)).filter_by(
        customer_signature_token=signature_token
    ).first()
    if not form:
        return jsonify({"success": False, "error": "无效的签署链接"}), 404
    if form.status not in ("customer_signed", "synced") and form.contract:
        _grant_attendance_sign_access(form, openid, signature_token)
        db.session.flush()

    response = submit_customer_signature(signature_token)
    flask_response = response[0] if isinstance(response, tuple) else response
    status_code = response[1] if isinstance(response, tuple) and len(response) > 1 else getattr(flask_response, "status_code", 200)
    if status_code >= 400:
        return response

    if openid and form and form.contract:
        _grant_attendance_sign_access(form, openid, signature_token)
        db.session.commit()
    return flask_response


@miniapp_bp.route("/dev/bind-contract-token", methods=["POST"])
def dev_bind_by_contract_token():
    if not _allow_mock_login():
        return jsonify({"success": False, "error": "仅开发环境可用"}), 403

    data = request.get_json(silent=True) or {}
    openid = _normalize_openid(data.get("openid"))
    token = data.get("token")
    if not openid or not token:
        return jsonify({"success": False, "error": "缺少 openid 或 token"}), 400

    contract = BaseContract.query.filter(
        or_(BaseContract.customer_signing_token == token, BaseContract.employee_signing_token == token)
    ).first()
    if not contract:
        return jsonify({"success": False, "error": "未找到可绑定合同"}), 404

    if contract.employee_signing_token == token:
        if not contract.service_personnel_id:
            return jsonify({"success": False, "error": "合同未关联服务人员，无法绑定员工身份"}), 404
        account = _bind_employee_openid(contract.service_personnel_id, openid, bind_method="dev_mock")
        db.session.commit()
        return jsonify(
            {
                "success": True,
                "account_id": str(account.id),
                "employee_id": str(contract.service_personnel_id),
                "role": "employee",
            }
        )

    if not contract.customer_id:
        return jsonify({"success": False, "error": "合同未关联客户，无法绑定客户身份"}), 404

    account = _bind_customer_openid(contract.customer_id, openid, bind_method="dev_mock")
    db.session.commit()
    return jsonify({"success": True, "account_id": str(account.id), "customer_id": str(contract.customer_id), "role": "customer"})
