"""
月嫂考勤周期工具。

月嫂为 26 天结算制：
- 首期从「实际上户日期」起算：上户日 + 26 天（共 27 个自然日）
  其中上户日不算出勤，故首期满勤出勤仍为 26 天
- 非首期：每期 26 个自然日（起点 + 25 天）
- 下一期从上一期结束日次日开始（不重叠）
- 不参与育儿嫂「超过 26 天自动补齐加班」逻辑
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from typing import Iterable, List, Optional, Tuple

MATERNITY_CYCLE_DAYS = 26
# 首期：cycle_start + 26 → 27 个自然日（含上户日）
# 非首期：cycle_start + 25 → 26 个自然日
MATERNITY_FIRST_CYCLE_OFFSET_DAYS = 26
MATERNITY_FOLLOWING_CYCLE_OFFSET_DAYS = 25
MATERNITY_CONTRACT_TYPES = frozenset(
    {
        "maternity_nurse",
        "月嫂合同",
        "月嫂正式合同",
    }
)


def shift_maternity_contract_dates_from_onboarding(
    contract,
    onboarding_value,
    *,
    creation_snapshot: Optional[dict] = None,
) -> dict:
    """按合同创建时的预产期至结束日周期，平移月嫂合同结束日期。"""
    if not is_maternity_contract(contract):
        raise ValueError("仅月嫂合同可按实际上户日期调整合同周期")

    onboarding_date = _to_date(onboarding_value)
    if not onboarding_date:
        raise ValueError("实际上户日期无效")

    creation_snapshot = creation_snapshot or {}
    original_start = _to_date(
        creation_snapshot.get("provisional_start_date")
        or getattr(contract, "provisional_start_date", None)
    )
    original_end = _to_date(
        creation_snapshot.get("end_date") or getattr(contract, "end_date", None)
    )
    if not original_start or not original_end or original_end < original_start:
        raise ValueError("合同缺少有效的创建时预产期或合同结束日期")

    duration_days = (original_end - original_start).days
    adjusted_end = onboarding_date + timedelta(days=duration_days)
    onboarding_time = (
        onboarding_value.time()
        if isinstance(onboarding_value, datetime)
        else datetime.min.time()
    )

    contract.actual_onboarding_date = datetime.combine(onboarding_date, onboarding_time)
    contract.end_date = datetime.combine(adjusted_end, datetime.min.time())
    contract.expected_offboarding_date = datetime.combine(adjusted_end, datetime.min.time())

    return {
        "original_provisional_start_date": original_start,
        "original_end_date": original_end,
        "duration_days": duration_days,
        "actual_onboarding_date": onboarding_date,
        "adjusted_end_date": adjusted_end,
    }


def _to_date(value) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def is_maternity_contract(contract) -> bool:
    if not contract:
        return False
    contract_type = getattr(contract, "type", None)
    return contract_type in MATERNITY_CONTRACT_TYPES


def get_maternity_service_start(contract) -> Optional[date]:
    """首期考勤起点：优先实际上户日，缺失则返回 None（需用户确认上户日）。"""
    if not contract:
        return None
    return _to_date(getattr(contract, "actual_onboarding_date", None))


def get_maternity_service_end(contract) -> Optional[date]:
    """服务终点：终止日 > 预计下户日 > 合同结束日。"""
    if not contract:
        return None
    if getattr(contract, "status", None) == "terminated" and getattr(
        contract, "termination_date", None
    ):
        return _to_date(contract.termination_date)
    return _to_date(
        getattr(contract, "expected_offboarding_date", None)
        or getattr(contract, "end_date", None)
    )


def iter_maternity_attendance_cycles(
    contract,
) -> Iterable[Tuple[date, date]]:
    """
    生成合同全部考勤周期 (cycle_start, cycle_end)。

    规则：
    - 起点 = actual_onboarding_date
    - 首期：cycle_end = start + 26 天（27 个自然日，上户日不算出勤）
    - 非首期：cycle_end = cycle_start + 25 天（26 个自然日）
    - 下一期 = cycle_end + 1 day
    - 最后一期截断到 service_end
    """
    start = get_maternity_service_start(contract)
    end = get_maternity_service_end(contract)
    if not start or not end or end < start:
        return

    cycle_start = start
    is_first = True
    while cycle_start <= end:
        offset = (
            MATERNITY_FIRST_CYCLE_OFFSET_DAYS
            if is_first
            else MATERNITY_FOLLOWING_CYCLE_OFFSET_DAYS
        )
        cycle_end = min(cycle_start + timedelta(days=offset), end)
        yield cycle_start, cycle_end
        if cycle_end >= end:
            break
        cycle_start = cycle_end + timedelta(days=1)
        is_first = False


def list_maternity_attendance_cycles(contract) -> List[Tuple[date, date]]:
    return list(iter_maternity_attendance_cycles(contract))


def maternity_cycles_overlapping_month(
    contract, year: int, month: int
) -> List[Tuple[date, date]]:
    """返回与指定自然月有交集的 26 天考勤周期列表。"""
    last_day = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, last_day)
    result = []
    for cycle_start, cycle_end in iter_maternity_attendance_cycles(contract):
        if cycle_start <= month_end and cycle_end >= month_start:
            result.append((cycle_start, cycle_end))
    return result


def find_maternity_cycle_for_reference(
    contract, ref_date: Optional[date] = None
) -> Optional[Tuple[date, date]]:
    """
    按参考日选择考勤周期：
    - 落在某期内 → 该期
    - 早于首期 → 首期
    - 晚于末期 → 末期
    - 默认用今天
    """
    cycles = list_maternity_attendance_cycles(contract)
    if not cycles:
        return None
    if ref_date is None:
        ref_date = date.today()

    for cycle_start, cycle_end in cycles:
        if cycle_start <= ref_date <= cycle_end:
            return cycle_start, cycle_end

    if ref_date < cycles[0][0]:
        return cycles[0]
    return cycles[-1]


def pick_default_maternity_cycle_for_month(
    contract, year: int, month: int
) -> Optional[Tuple[date, date]]:
    """
    为「按自然月进入」选择默认周期：
    优先与该月有交集且尚未完成的周期；否则取与该月有交集的最后一期。
    此处只返回日期，表单状态由调用方判断。
    """
    overlapping = maternity_cycles_overlapping_month(contract, year, month)
    if overlapping:
        return overlapping[-1]
    # 该月无交集时，退回参考日所在周期
    try:
        ref = date(year, month, min(15, calendar.monthrange(year, month)[1]))
    except ValueError:
        ref = date.today()
    return find_maternity_cycle_for_reference(contract, ref)


def is_first_maternity_cycle(contract, cycle_start) -> bool:
    start = get_maternity_service_start(contract)
    cycle_start = _to_date(cycle_start)
    return bool(start and cycle_start and start == cycle_start)


def is_last_maternity_cycle(contract, cycle_end) -> bool:
    end = get_maternity_service_end(contract)
    cycle_end = _to_date(cycle_end)
    return bool(end and cycle_end and end == cycle_end)


def maternity_onboarding_required_payload(contract) -> dict:
    """无实际上户日时，返回前端引导选择上户日的载荷。"""
    start = _to_date(getattr(contract, "start_date", None))
    end = get_maternity_service_end(contract)
    provisional = _to_date(getattr(contract, "provisional_start_date", None))
    return {
        "error": "maternity_onboarding_date_required",
        "message": "月嫂合同尚未确认实际上户日期，请先选择上户日后再填报考勤。",
        "contract_id": str(contract.id) if contract else None,
        "customer_name": getattr(contract, "customer_name", None),
        "contract_start_date": start.isoformat() if start else None,
        "contract_end_date": end.isoformat() if end else None,
        "provisional_start_date": provisional.isoformat() if provisional else None,
        "suggested_onboarding_date": (
            provisional.isoformat()
            if provisional
            else (start.isoformat() if start else None)
        ),
        "is_maternity": True,
    }
