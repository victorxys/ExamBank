from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from flask import current_app

from backend.extensions import db
from backend.models import BaseContract, ContractOperationLog


CONTRACT_LOG_FIELDS = (
    "customer_name",
    "service_personnel_id",
    "start_date",
    "end_date",
    "status",
    "termination_date",
    "employee_level",
    "management_fee_amount",
    "management_fee_rate",
    "security_deposit_paid",
    "introduction_fee",
    "is_monthly_auto_renew",
    "requires_signature",
    "signing_status",
    "actual_onboarding_date",
    "expected_offboarding_date",
    "notes",
)


def _json_safe(value):
    if value is None:
        return None
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "value"):
        return value.value
    return str(value) if not isinstance(value, (str, int, float, bool, dict, list)) else value


def snapshot_contract(contract: BaseContract | None, fields=CONTRACT_LOG_FIELDS) -> dict:
    if not contract:
        return {}
    snapshot = {}
    for field in fields:
        if hasattr(contract, field):
            snapshot[field] = _json_safe(getattr(contract, field))
    if getattr(contract, "service_personnel", None):
        snapshot["service_personnel_name"] = contract.service_personnel.name
    return snapshot


def diff_snapshots(before: dict | None, after: dict | None) -> dict:
    before = before or {}
    after = after or {}
    changes = {}
    for key in sorted(set(before) | set(after)):
        if before.get(key) != after.get(key):
            changes[key] = {"from": before.get(key), "to": after.get(key)}
    return changes


def create_contract_operation_log(
    *,
    contract: BaseContract | None = None,
    contract_id=None,
    related_contract: BaseContract | None = None,
    related_contract_id=None,
    user_id=None,
    action: str,
    title: str,
    summary: str | None = None,
    details: dict | None = None,
    changes: dict | None = None,
) -> ContractOperationLog:
    log = ContractOperationLog(
        contract_id=contract.id if contract else contract_id,
        related_contract_id=related_contract.id if related_contract else related_contract_id,
        user_id=user_id,
        action=action,
        title=title,
        summary=summary,
        details=details or {},
        changes=changes or {},
    )
    db.session.add(log)
    current_app.logger.info(
        "记录合同操作日志: contract=%s action=%s title=%s",
        log.contract_id,
        action,
        title,
    )
    return log
