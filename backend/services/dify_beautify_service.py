"""账单美化：通过 Dify 调用国产大模型。"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Optional
from urllib.parse import urljoin

import httpx
from flask import current_app

from backend.api.ai_generate import (
    create_initial_llm_log,
    get_active_llm_config_internal,
    update_llm_log_result,
)
from backend.models import SystemSetting, db
from backend.services.payroll_miniapp_link_service import ensure_urls_preserved_in_text

SETTING_ID = "bill_beautify_config"

DEFAULT_BILL_BEAUTIFY_CONFIG = {
    # 实际服务强制 HTTPS；若写 http:// 会 301，且部分客户端会把 POST 改成 GET 导致 405
    "api_base_url": "https://ai.mengyimengsao.com/v1",
    "api_key_name": "dify-美化账单api-key",
    # advanced-chat -> /chat-messages；workflow -> /workflows/run；completion -> /completion-messages
    "app_mode": "advanced-chat",
    "timeout_seconds": 180,
    "enabled": True,
    # 发送给 Dify 的 query 中 input 变量名（workflow/completion 可用）
    "input_variable": "query",
}


def get_or_create_bill_beautify_config() -> SystemSetting:
    config = SystemSetting.query.get(SETTING_ID)
    if not config:
        config = SystemSetting(
            id=SETTING_ID,
            value=dict(DEFAULT_BILL_BEAUTIFY_CONFIG),
            description="账单美化（Dify）API 配置",
        )
        db.session.add(config)
        db.session.commit()
        return config

    current_val = {**DEFAULT_BILL_BEAUTIFY_CONFIG, **(config.value or {})}
    if current_val != config.value:
        from sqlalchemy.orm.attributes import flag_modified

        config.value = current_val
        flag_modified(config, "value")
        db.session.commit()
    return config


def _normalize_base_url(base_url: str) -> str:
    url = (base_url or "").strip().rstrip("/")
    if not url:
        raise ValueError("Dify API 地址不能为空")
    # 避免 HTTP->HTTPS 301 把 POST 降成 GET
    if url.startswith("http://"):
        url = "https://" + url[len("http://") :]
    return url


def _build_endpoint(base_url: str, app_mode: str) -> str:
    mode = (app_mode or "advanced-chat").strip().lower()
    base = _normalize_base_url(base_url) + "/"
    if mode in ("workflow", "workflows"):
        return urljoin(base, "workflows/run")
    if mode in ("completion", "text-generation", "text_generator"):
        return urljoin(base, "completion-messages")
    # advanced-chat / chat / chatflow
    return urljoin(base, "chat-messages")


def _build_request_body(
    app_mode: str,
    query_text: str,
    user: str,
    input_variable: str,
) -> dict:
    mode = (app_mode or "advanced-chat").strip().lower()
    var_name = (input_variable or "query").strip() or "query"

    if mode in ("workflow", "workflows"):
        return {
            "inputs": {var_name: query_text},
            "response_mode": "blocking",
            "user": user,
        }
    if mode in ("completion", "text-generation", "text_generator"):
        return {
            "inputs": {var_name: query_text},
            "response_mode": "blocking",
            "user": user,
        }
    # chat / advanced-chat
    return {
        "inputs": {},
        "query": query_text,
        "response_mode": "blocking",
        "user": user,
        "conversation_id": "",
    }


def _extract_text_from_blocking_payload(payload: dict, app_mode: str) -> str:
    if not isinstance(payload, dict):
        return ""

    mode = (app_mode or "advanced-chat").strip().lower()
    if mode in ("workflow", "workflows"):
        data = payload.get("data") or {}
        outputs = data.get("outputs") if isinstance(data, dict) else None
        if isinstance(outputs, dict):
            for key in (
                "result",
                "text",
                "answer",
                "output",
                "company_beautified",
            ):
                if key in outputs and outputs[key]:
                    val = outputs[key]
                    return val if isinstance(val, str) else json.dumps(val, ensure_ascii=False)
            # 若 outputs 本身就是目标 JSON 字段
            if "company_beautified" in outputs or "employee_beautified" in outputs:
                return json.dumps(outputs, ensure_ascii=False)
            # 退回把整个 outputs 序列化
            if outputs:
                return json.dumps(outputs, ensure_ascii=False)
        if data.get("error"):
            raise Exception(f"Dify workflow 失败: {data.get('error')}")
        return ""

    # chat / completion
    answer = payload.get("answer")
    if isinstance(answer, str):
        return answer
    if answer is not None:
        return json.dumps(answer, ensure_ascii=False)
    return ""


def _parse_sse_answer(raw_text: str) -> str:
    """从 Dify SSE 流中拼接 answer / text 片段。"""
    answer_parts: list[str] = []
    final_answer = ""
    workflow_outputs: Optional[dict] = None

    for line in raw_text.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        data_str = line[5:].strip()
        if not data_str or data_str == "[DONE]":
            continue
        try:
            event = json.loads(data_str)
        except json.JSONDecodeError:
            continue

        if not isinstance(event, dict):
            continue

        event_type = event.get("event") or ""
        if event_type in ("message", "agent_message"):
            chunk = event.get("answer") or ""
            if chunk:
                answer_parts.append(chunk)
        elif event_type == "message_end":
            # 有些实现会在 end 时带完整 answer；优先用拼接结果
            pass
        elif event_type == "workflow_finished":
            data = event.get("data") or {}
            if isinstance(data, dict):
                outputs = data.get("outputs")
                if isinstance(outputs, dict):
                    workflow_outputs = outputs
                if data.get("status") == "failed" and data.get("error"):
                    raise Exception(f"Dify workflow 失败: {data.get('error')}")
        elif event_type == "error":
            msg = event.get("message") or event.get("code") or "Dify 流式调用错误"
            raise Exception(str(msg))
        elif event_type == "text_chunk":
            data = event.get("data") or {}
            text = data.get("text") if isinstance(data, dict) else None
            if text:
                answer_parts.append(text)

        # 兼容部分响应直接带 answer 字段
        if not event_type and event.get("answer"):
            final_answer = event["answer"]

    if answer_parts:
        return "".join(answer_parts)
    if final_answer:
        return final_answer
    if workflow_outputs is not None:
        if "company_beautified" in workflow_outputs or "employee_beautified" in workflow_outputs:
            return json.dumps(workflow_outputs, ensure_ascii=False)
        for key in ("result", "text", "answer", "output"):
            if workflow_outputs.get(key):
                val = workflow_outputs[key]
                return val if isinstance(val, str) else json.dumps(val, ensure_ascii=False)
        return json.dumps(workflow_outputs, ensure_ascii=False)
    return ""


def _strip_code_fence(text: str) -> str:
    cleaned = (text or "").strip()
    # 去掉 ```json ... ``` 或 ``` ... ```
    fenced = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```\s*$", cleaned, flags=re.IGNORECASE)
    if fenced:
        return fenced.group(1).strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _fix_common_json_issues(text: str) -> str:
    """修复 LLM 常见非法 JSON：尾逗号、字符串内未转义换行等。"""
    # 去掉对象/数组尾逗号: ,}  ,]
    fixed = re.sub(r",(\s*[}\]])", r"\1", text)

    # 将 JSON 字符串字面量中的真实换行/回车转义为 \n / \r
    # 只处理双引号字符串内部
    out: list[str] = []
    in_string = False
    escape = False
    for ch in fixed:
        if in_string:
            if escape:
                out.append(ch)
                escape = False
            elif ch == "\\":
                out.append(ch)
                escape = True
            elif ch == '"':
                out.append(ch)
                in_string = False
            elif ch == "\n":
                out.append("\\n")
            elif ch == "\r":
                out.append("\\r")
            elif ch == "\t":
                out.append("\\t")
            else:
                out.append(ch)
        else:
            if ch == '"':
                in_string = True
            out.append(ch)
    return "".join(out)


def _extract_field_by_key(text: str, key: str) -> Optional[str]:
    """
    从近似 JSON 文本中按 key 提取字符串值，容忍值内未转义换行。
    匹配 "key": "....." 直到下一个顶层字段或结束花括号。
    """
    # 找到 "key" 后的冒号
    pattern = re.compile(
        rf'"{re.escape(key)}"\s*:\s*',
        flags=re.IGNORECASE,
    )
    m = pattern.search(text)
    if not m:
        return None

    i = m.end()
    n = len(text)
    while i < n and text[i].isspace():
        i += 1
    if i >= n:
        return None

    # 字符串值
    if text[i] == '"':
        i += 1
        chars: list[str] = []
        escape = False
        while i < n:
            ch = text[i]
            if escape:
                # 保留常见转义
                if ch == "n":
                    chars.append("\n")
                elif ch == "r":
                    chars.append("\r")
                elif ch == "t":
                    chars.append("\t")
                elif ch in ('"', "\\", "/"):
                    chars.append(ch)
                elif ch == "u" and i + 4 < n:
                    hexpart = text[i + 1 : i + 5]
                    try:
                        chars.append(chr(int(hexpart, 16)))
                        i += 4
                    except ValueError:
                        chars.append(ch)
                else:
                    chars.append(ch)
                escape = False
                i += 1
                continue
            if ch == "\\":
                escape = True
                i += 1
                continue
            if ch == '"':
                # 可能是真正结束，也可能是正文里的未转义引号。
                # 启发式：看后面是否是 , 或 } 或下一个字段
                j = i + 1
                while j < n and text[j].isspace():
                    j += 1
                if j >= n or text[j] in ",}":
                    return "".join(chars)
                # 正文中的引号，保留
                chars.append(ch)
                i += 1
                continue
            chars.append(ch)
            i += 1
        return "".join(chars)

    # 非字符串：读到逗号/花括号
    start = i
    depth = 0
    while i < n:
        ch = text[i]
        if ch in "{[":
            depth += 1
        elif ch in "}]":
            if depth == 0:
                break
            depth -= 1
        elif ch == "," and depth == 0:
            break
        i += 1
    return text[start:i].strip().strip('"')


def _extract_json_object(text: str) -> dict:
    """从模型返回文本中提取 JSON 对象，尽量兼容脏 JSON。"""
    if not text:
        raise ValueError("Dify 返回内容为空")

    cleaned = _strip_code_fence(text)

    candidates = [cleaned]
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidates.append(cleaned[start : end + 1])

    last_error: Optional[Exception] = None
    for candidate in candidates:
        for variant in (candidate, _fix_common_json_issues(candidate)):
            try:
                data = json.loads(variant)
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError as e:
                last_error = e
                continue

    # 兜底：直接抽取两个目标字段（模型最常返回未转义换行的 JSON）
    company = _extract_field_by_key(cleaned, "company_beautified")
    employee = _extract_field_by_key(cleaned, "employee_beautified")
    if company is None:
        company = _extract_field_by_key(cleaned, "company")
    if employee is None:
        employee = _extract_field_by_key(cleaned, "employee")

    if company is not None or employee is not None:
        return {
            "company_beautified": company or "",
            "employee_beautified": employee or "",
        }

    preview = cleaned[:500].replace("\n", "\\n")
    raise ValueError(
        f"无法从 Dify 响应中解析 JSON"
        f"{f' ({last_error})' if last_error else ''}: {preview}"
    )


def _normalize_beautified_result(data: dict) -> dict:
    company = (
        data.get("company_beautified")
        or data.get("company")
        or data.get("company_summary")
        or ""
    )
    employee = (
        data.get("employee_beautified")
        or data.get("employee")
        or data.get("employee_summary")
        or ""
    )
    if not isinstance(company, str):
        company = str(company or "")
    if not isinstance(employee, str):
        employee = str(employee or "")
    return {
        "company_beautified": company,
        "employee_beautified": employee,
    }


def _extract_customer_employee_pairs(raw_text: str) -> list[tuple[str, str]]:
    """
    从催款原文中解析 (客户, 员工) 对。

    支持：
    - 「客户——员工 (日期)」历史格式
    - 「客户：A / 员工：B」显式标注
    """
    if not raw_text:
        return []

    pairs: list[tuple[str, str]] = []
    seen = set()

    # 显式标注：客户：xx / 员工：yy
    for m in re.finditer(
        r"客户[：:]\s*([^\n/|，,]+?)\s*[/|]\s*员工[：:]\s*([^\n(（]+)",
        raw_text,
    ):
        customer = m.group(1).strip()
        employee = m.group(2).strip()
        key = (customer, employee)
        if customer and employee and customer != employee and key not in seen:
            seen.add(key)
            pairs.append(key)

    # 兼容：姓名A——姓名B (日期
    for m in re.finditer(
        r"(?m)^[ \t]*([^\n—\-]{1,40}?)[ \t]*[—\-]{1,2}[ \t]*([^\n(（]{1,40}?)[ \t]*[(（]",
        raw_text,
    ):
        customer = m.group(1).strip()
        employee = m.group(2).strip()
        # 去掉可能的「客户：」「员工：」前缀
        customer = re.sub(r"^(客户|雇主)[：:\s]*", "", customer).strip()
        employee = re.sub(r"^(员工|阿姨|服务人员)[：:\s]*", "", employee).strip()
        key = (customer, employee)
        if customer and employee and customer != employee and key not in seen:
            seen.add(key)
            pairs.append(key)

    # 工资卡户名兜底：若只有一对客户名，户名常为员工
    if not pairs:
        bank_holders = re.findall(r"(?m)^[ \t]*户名[：:]\s*([^\n]+)", raw_text)
        # 无法可靠配对时不猜
        _ = bank_holders

    return pairs


def correct_employee_payee_names(raw_employee_summary: str, beautified: str) -> str:
    """
    修正员工侧美化文案中把客户名误写成应付对象的问题。

    规则：原始格式为「客户——员工」；「您应付X」「X“劳务费”」中的 X 应为员工名。
    """
    text = beautified or ""
    if not text:
        return text

    pairs = _extract_customer_employee_pairs(raw_employee_summary or "")
    if not pairs:
        return text

    for customer, employee in pairs:
        if not customer or not employee or customer == employee:
            continue

        # 本期小计 / 总计描述
        replacements = [
            (f"您应付{customer}", f"您应付{employee}"),
            (f"应付{customer}", f"应付{employee}"),
            (f"应退给{customer}", f"应退给{employee}"),  # 极少数错误写法
            (f"付给{customer}", f"付给{employee}"),
        ]
        for old, new in replacements:
            if old in text:
                text = text.replace(old, new)

        # 标题：客户“劳务费” → 员工“劳务费”（中英文引号都处理）
        quote_pairs = [
            ("“", "”"),
            ('"', '"'),
            ("「", "」"),
        ]
        for lq, rq in quote_pairs:
            wrong_title = f"{customer}{lq}劳务费{rq}"
            right_title = f"{employee}{lq}劳务费{rq}"
            if wrong_title in text:
                text = text.replace(wrong_title, right_title)
            # 半边损坏写法：客户”劳务费“ / 客户"劳务费"
            for broken in (
                f"{customer}”劳务费“",
                f'{customer}"劳务费"',
                f"{customer}”劳务费”",
                f"{customer}“劳务费“",
            ):
                if broken in text:
                    text = text.replace(broken, right_title)

    return text


def call_dify_chat(
    *,
    api_base_url: str,
    api_key: str,
    app_mode: str,
    query_text: str,
    user: str,
    input_variable: str = "query",
    timeout_seconds: int = 180,
) -> tuple[str, Any]:
    """
    调用 Dify，返回 (原始文本答案, 原始响应对象用于日志)。
    兼容 blocking JSON 与 SSE 流；对 advanced-chat 默认使用 streaming，避免长连接整包超时。
    """
    endpoint = _build_endpoint(api_base_url, app_mode)
    mode = (app_mode or "advanced-chat").strip().lower()
    # 许多自建 Dify 对 chat 会返回 event-stream；直接用 streaming 更稳
    prefer_stream = mode not in ("workflow", "workflows")

    body = _build_request_body(app_mode, query_text, user, input_variable)
    if prefer_stream:
        body["response_mode"] = "streaming"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }

    timeout = httpx.Timeout(
        connect=15.0,
        read=float(timeout_seconds or 180),
        write=30.0,
        pool=15.0,
    )

    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        with client.stream("POST", endpoint, headers=headers, json=body) as response:
            content_type = (response.headers.get("content-type") or "").lower()
            if response.status_code >= 400:
                err_body = response.read().decode("utf-8", errors="replace")
                raise Exception(
                    f"Dify API 调用失败 HTTP {response.status_code}: {err_body[:500]}"
                )

            # SSE 或强制流式
            if (
                prefer_stream
                or "text/event-stream" in content_type
                or "event-stream" in content_type
            ):
                chunks: list[str] = []
                for chunk in response.iter_text():
                    if chunk:
                        chunks.append(chunk)
                raw_text = "".join(chunks)
                answer_text = _parse_sse_answer(raw_text)
                if not answer_text and raw_text.strip().startswith("{"):
                    # 意外返回了 JSON
                    try:
                        payload = json.loads(raw_text)
                        answer_text = _extract_text_from_blocking_payload(
                            payload, app_mode
                        )
                        return answer_text, payload
                    except json.JSONDecodeError:
                        pass
                return answer_text, {
                    "streamed": True,
                    "raw_preview": raw_text[:4000],
                }

            raw_bytes = response.read()
            raw_text = raw_bytes.decode("utf-8", errors="replace")
            try:
                payload = json.loads(raw_text)
            except json.JSONDecodeError as e:
                if raw_text.lstrip().startswith("data:"):
                    answer_text = _parse_sse_answer(raw_text)
                    return answer_text, {
                        "streamed": True,
                        "raw_preview": raw_text[:4000],
                    }
                raise Exception(f"Dify 返回非 JSON 响应: {raw_text[:500]}") from e

            answer_text = _extract_text_from_blocking_payload(payload, app_mode)
            return answer_text, payload


def _render_bank_account(account: dict) -> list[str]:
    if not isinstance(account, dict):
        return []
    lines = []
    if account.get("holder"):
        lines.append(f"户名：{account['holder']}")
    if account.get("account"):
        lines.append(f"帐号：{account['account']}")
    if account.get("bank"):
        lines.append(f"银行：{account['bank']}")
    return lines


def _render_company_fallback(items: list[dict]) -> str:
    blocks = []
    for item in items or []:
        lines = [
            f"{item.get('customer_name', '')}“管理费”",
            f"服务周期: {item.get('service_start', '')} ~ {item.get('service_end', '')}",
        ]
        if item.get("display_mode") == "management_fee_only":
            lines.append(f"应付：{item.get('pending_amount_display', '0.00')}元")
        else:
            for line_item in item.get("line_items") or []:
                name = line_item.get("name") or "费用"
                calculation = line_item.get("calculation") or ""
                lines.append(f"{name}: {calculation}")
            lines.append(f"本次应付：{item.get('pending_amount_display', '0.00')}元")
        bank_lines = _render_bank_account(item.get("bank_account") or {})
        if bank_lines:
            lines.append("")
            lines.extend(bank_lines)
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def _render_employee_fallback(items: list[dict]) -> str:
    blocks = []
    for item in items or []:
        attendance = item.get("attendance") or {}
        rest = attendance.get("rest") or {}
        overtime = attendance.get("overtime") or {}
        attendance_parts = [f"出勤{attendance.get('worked_days_display', '0')}天"]
        for label, detail in (("加班", overtime), ("休息", rest)):
            try:
                total_hours = float(detail.get("total_hours") or 0)
            except (TypeError, ValueError):
                total_hours = 0
            if total_hours <= 0:
                continue
            part = f"{label}{detail.get('duration_display', '')}"
            if detail.get("show_calculation_days"):
                part += f"（{detail.get('calculation_days_display', '0')}天）"
            attendance_parts.append(part)
        lines = [
            f"{item.get('employee_name', '')}“劳务费”",
            f"服务周期: {item.get('service_start', '')} ~ {item.get('service_end', '')}",
            "，".join(attendance_parts),
            (
                f"费用共{item.get('payable_days_display', '0')}天×"
                f"({item.get('salary_base_display', '0')}元÷ 26天) "
                f"={item.get('formula_total_display', '0.00')}元"
            ),
        ]
        lines.append(
            "💰 本次您需支付员工款项: "
            f"{item.get('pending_amount_display', '0.00')}元"
        )
        bank_lines = _render_bank_account(item.get("bank_account") or {})
        if bank_lines:
            lines.append("")
            lines.extend(bank_lines)
        miniapp_url = (item.get("miniapp_url") or "").strip()
        if miniapp_url:
            lines.extend(["", "客户小程序工资单（点击打开）:", miniapp_url])
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def _company_result_is_complete(text: str, items: list[dict]) -> bool:
    if not items:
        return not text.strip()
    if not text.strip():
        return False
    for item in items:
        account = item.get("bank_account") or {}
        required = (
            item.get("customer_name"),
            item.get("service_start"),
            item.get("service_end"),
            account.get("holder"),
            account.get("account"),
            account.get("bank"),
        )
        if not all(str(value) in text for value in required if value):
            return False
        amount = re.escape(str(item.get("pending_amount_display") or ""))
        if amount and not re.search(
            rf"(?:应付|应收|应退|费用总计|本次应付)[^\n]{{0,40}}{amount}\s*元",
            text,
        ):
            return False
    return True


def _employee_result_is_complete(text: str, items: list[dict]) -> bool:
    if not items:
        return not text.strip()
    expected = _render_employee_fallback(items)
    return text.strip() == expected.strip()


def _remove_zero_calculation_lines(text: str) -> str:
    kept_lines = [
        line
        for line in (text or "").splitlines()
        if not re.search(r"=\s*[+-]?0(?:\.0+)?\s*(?:元)?\s*$", line)
    ]
    return "\n".join(kept_lines)


def render_beautify_payload(payload: dict) -> dict:
    """Render the structured bill payload without calling an external model."""
    payload = payload or {}
    return {
        "company_beautified": _remove_zero_calculation_lines(
            _render_company_fallback(payload.get("company_bills") or [])
        ),
        "employee_beautified": _remove_zero_calculation_lines(
            _render_employee_fallback(payload.get("employee_bills") or [])
        ),
    }


def enforce_beautify_payload_contract(parsed: dict, payload: dict) -> dict:
    """Reject incomplete or rounded model text in favor of deterministic output."""
    company_items = payload.get("company_bills") or []
    employee_items = payload.get("employee_bills") or []
    company_text = parsed.get("company_beautified") or ""
    employee_text = parsed.get("employee_beautified") or ""
    result = {
        "company_beautified": (
            company_text
            if _company_result_is_complete(company_text, company_items)
            else _render_company_fallback(company_items)
        ),
        "employee_beautified": (
            employee_text
            if _employee_result_is_complete(employee_text, employee_items)
            else _render_employee_fallback(employee_items)
        ),
    }
    result["company_beautified"] = _remove_zero_calculation_lines(
        result["company_beautified"]
    )
    result["employee_beautified"] = _remove_zero_calculation_lines(
        result["employee_beautified"]
    )
    return result


def beautify_bill_with_dify(
    company_summary: str = "",
    employee_summary: str = "",
    beautify_payload: Optional[dict] = None,
    user_id=None,
) -> dict:
    """
    使用系统配置的 Dify 应用美化账单文案。
    返回 {"company_beautified": str, "employee_beautified": str}
    """
    start_time = time.time()
    config_row = get_or_create_bill_beautify_config()
    config = config_row.value or {}

    if not config.get("enabled", True):
        raise Exception("账单美化功能已禁用，请在系统配置中开启")

    api_key_name = (config.get("api_key_name") or "").strip()
    if not api_key_name:
        raise Exception("未配置账单美化 API Key 名称")

    api_key, resolved_key_name, _model, config_error = get_active_llm_config_internal(
        api_key_name
    )
    if config_error:
        raise Exception(config_error)
    if not api_key:
        raise Exception(f"未能获取 API Key: {api_key_name}")

    if beautify_payload:
        query_text = json.dumps(beautify_payload, ensure_ascii=False, indent=2)
    else:
        query_text = (
            f"【应付公司款项】\n{company_summary or ''}\n\n"
            f"【应付员工款项】\n{employee_summary or ''}"
        )
    user_str = str(user_id) if user_id else "examdb-bill-beautify"

    log_input = {
        "schema_version": (
            beautify_payload.get("schema_version") if beautify_payload else "legacy_text"
        ),
        "company_bill_count": len(beautify_payload.get("company_bills") or []) if beautify_payload else None,
        "employee_bill_count": len(beautify_payload.get("employee_bills") or []) if beautify_payload else None,
        "api_base_url": config.get("api_base_url"),
        "app_mode": config.get("app_mode"),
        "api_key_name": resolved_key_name,
    }
    log_id = create_initial_llm_log(
        "beautify_bill_with_dify",
        None,
        None,
        resolved_key_name,
        log_input,
        user_id,
    )

    try:
        answer_text, raw_payload = call_dify_chat(
            api_base_url=config.get("api_base_url")
            or DEFAULT_BILL_BEAUTIFY_CONFIG["api_base_url"],
            api_key=api_key,
            app_mode=config.get("app_mode") or "advanced-chat",
            query_text=query_text,
            user=user_str,
            input_variable=config.get("input_variable") or "query",
            timeout_seconds=int(config.get("timeout_seconds") or 180),
        )

        try:
            parsed = _normalize_beautified_result(_extract_json_object(answer_text))
        except ValueError:
            if not beautify_payload:
                raise
            current_app.logger.warning(
                "Dify 账单美化返回无法解析，已使用 V2 确定性模板",
                exc_info=True,
            )
            parsed = {"company_beautified": "", "employee_beautified": ""}
        if beautify_payload:
            parsed = enforce_beautify_payload_contract(parsed, beautify_payload)
        else:
            # 旧前端兼容路径：继续处理历史自由文本输入。
            parsed["employee_beautified"] = correct_employee_payee_names(
                employee_summary or "",
                parsed.get("employee_beautified") or "",
            )
            parsed["employee_beautified"] = ensure_urls_preserved_in_text(
                employee_summary or "",
                parsed.get("employee_beautified") or "",
            )
        duration_ms = int((time.time() - start_time) * 1000)
        if log_id:
            update_llm_log_result(
                log_id,
                {
                    "raw_response_preview": (
                        answer_text[:2000] if answer_text else None
                    ),
                    "provider_payload_type": type(raw_payload).__name__,
                },
                parsed,
                "success",
                duration_ms=duration_ms,
            )
        return parsed
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        current_app.logger.error(f"Dify 账单美化失败: {e}", exc_info=True)
        if log_id:
            update_llm_log_result(
                log_id,
                None,
                None,
                "error",
                error_message=str(e),
                duration_ms=duration_ms,
            )
        raise
