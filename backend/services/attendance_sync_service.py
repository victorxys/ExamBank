from backend.models import db, AttendanceForm, AttendanceRecord, BaseContract
from backend.services.billing_engine import BillingEngine
from datetime import datetime, date
from copy import deepcopy
import calendar
from decimal import Decimal, ROUND_HALF_UP
from flask import current_app


def _parse_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(str(value)).date()


def _attendance_contract_end_date(contract):
    if not contract:
        return None
    is_monthly = bool(getattr(contract, 'is_monthly_auto_renew', False))
    if is_monthly and contract.status in ('active', 'pending'):
        return None
    if contract.status == 'terminated' and getattr(contract, 'termination_date', None):
        return _parse_date(contract.termination_date)
    return _parse_date(contract.end_date) if getattr(contract, 'end_date', None) else None


def _record_hours(record):
    hours = record.get("hours", 0) or 0
    minutes = record.get("minutes", 0) or 0
    return Decimal(str(hours)) + Decimal(str(minutes)) / Decimal(60)


def _time_to_minutes(time_value):
    if not time_value:
        return None
    try:
        hour, minute = map(int, str(time_value).split(":"))
    except (TypeError, ValueError):
        return None
    total = hour * 60 + minute
    if total < 0 or total > 24 * 60:
        return None
    return total


def _onboarding_time_from_data(data):
    for record in data.get("onboarding_records") or []:
        onboarding_time = record.get("startTime")
        if onboarding_time:
            return onboarding_time
    return None


def _onboarding_days_to_exclude(data, cycle_start, cycle_end):
    """上户月不把上户当天计入基础出勤天数。"""
    dates = set()
    for record in data.get("onboarding_records") or []:
        raw_date = record.get("date")
        if not raw_date:
            continue
        try:
            onboarding_date = _parse_date(raw_date)
        except (TypeError, ValueError):
            continue
        if cycle_start <= onboarding_date <= cycle_end:
            dates.add(onboarding_date)
    return Decimal(len(dates))


def _contract_valid_days_for_cycle(form, cycle_start, cycle_end):
    contract = getattr(form, "contract", None)
    if not contract:
        return Decimal((cycle_end - cycle_start).days + 1)

    raw_start = getattr(contract, "actual_onboarding_date", None) or contract.start_date
    contract_start = _parse_date(raw_start)
    effective_start = max(cycle_start, contract_start)

    contract_end = _attendance_contract_end_date(contract)
    effective_end = min(cycle_end, contract_end) if contract_end else cycle_end
    if effective_end < effective_start:
        return Decimal(0)
    return Decimal((effective_end - effective_start).days + 1)


def _offboarding_adjustment_days(data, onboarding_time):
    offboarding_time = None
    for record in data.get("offboarding_records") or []:
        if record.get("endTime"):
            offboarding_time = record.get("endTime")
            break

    onboarding_minutes = _time_to_minutes(onboarding_time)
    offboarding_minutes = _time_to_minutes(offboarding_time)
    if onboarding_minutes is None or offboarding_minutes is None:
        return Decimal(0)

    combined_minutes = Decimal(24 * 60 - onboarding_minutes + offboarding_minutes)
    return combined_minutes / Decimal(24 * 60) - Decimal("1")


def _is_full_day_overtime(record):
    return (
        record.get("type") == "overtime"
        and (record.get("daysOffset") or 0) == 0
        and record.get("startTime") == "00:00"
        and record.get("endTime") == "24:00"
        and _record_hours(record) >= Decimal("23.99")
    )


def _is_statutory_holiday(target_date):
    # 目前自动补齐只需要避免把 5/1、5/2 这类法定假日加班误识别为月末补齐。
    fixed_holidays = {(1, 1), (5, 1), (5, 2), (5, 3), (10, 1), (10, 2), (10, 3)}
    return (target_date.month, target_date.day) in fixed_holidays


def _calculate_records_days(records):
    total_days = Decimal(0)
    for record in records or []:
        total_days += _record_hours(record) / Decimal(24)
    return total_days


def normalize_auto_overtime_form_data(form):
    """
    规范化自动补齐加班数据，避免历史表把月末补齐块按整天入库导致工资多算。
    返回 (normalized_data, changed)。
    """
    data = deepcopy(form.form_data or {})
    overtime_records = data.get("overtime_records") or []
    if not overtime_records:
        return data, False

    cycle_start = _parse_date(form.cycle_start_date)
    cycle_end = _parse_date(form.cycle_end_date)
    month_days = [
        date.fromordinal(day_ordinal)
        for day_ordinal in range(cycle_start.toordinal(), cycle_end.toordinal() + 1)
    ]

    overtime_by_date = {}
    for record in overtime_records:
        record_date = record.get("date")
        if record_date and _is_full_day_overtime(record):
            overtime_by_date[record_date] = record

    legacy_auto_dates = []
    for day in reversed(month_days):
        day_str = day.isoformat()
        if day_str in overtime_by_date and not _is_statutory_holiday(day):
            legacy_auto_dates.append(day_str)
        else:
            break

    existing_auto_records = [r for r in overtime_records if r.get("is_auto")]
    if not legacy_auto_dates and not existing_auto_records:
        return data, False

    rest_days = _calculate_records_days(data.get("rest_records", []))
    leave_days = _calculate_records_days(data.get("leave_records", []))
    total_leave_days = rest_days + leave_days

    manual_normal_overtime_days = Decimal(0)
    legacy_auto_date_set = set(legacy_auto_dates)
    for record in overtime_records:
        if record.get("is_auto") or record.get("date") in legacy_auto_date_set:
            continue
        record_date = _parse_date(record.get("date"))
        if not _is_statutory_holiday(record_date):
            manual_normal_overtime_days += _record_hours(record) / Decimal(24)

    valid_days_count = _contract_valid_days_for_cycle(form, cycle_start, cycle_end)
    onboarding_days = _onboarding_days_to_exclude(data, cycle_start, cycle_end)
    onboarding_time = _onboarding_time_from_data(data)
    if not onboarding_time:
        onboarding_info = get_onboarding_time_for_contract(form.employee_id, form.contract_id)
        if onboarding_info.get("has_onboarding"):
            onboarding_time = onboarding_info.get("onboarding_time")
    offboarding_adjustment = _offboarding_adjustment_days(data, onboarding_time)
    total_work_days_before_cap = valid_days_count - onboarding_days + offboarding_adjustment - total_leave_days
    auto_overtime_days = total_work_days_before_cap - Decimal("26") - manual_normal_overtime_days
    if auto_overtime_days <= 0:
        auto_overtime_days = Decimal(0)

    # 对没有 is_auto 标记的历史数据，只做“降噪/等量规范化”，绝不自动增加加班天数。
    # 否则可能把真实手填的月末加班误判为自动补齐。
    legacy_auto_days = Decimal(len(legacy_auto_dates))
    if legacy_auto_dates and not existing_auto_records and auto_overtime_days > legacy_auto_days:
        return data, False

    auto_minutes = int((auto_overtime_days * Decimal(24) * Decimal(60)).to_integral_value(rounding=ROUND_HALF_UP))
    auto_hours = auto_minutes // 60
    auto_remaining_minutes = auto_minutes % 60

    normalized_overtime = [
        r for r in overtime_records
        if not r.get("is_auto") and r.get("date") not in legacy_auto_date_set
    ]

    if auto_minutes > 0:
        auto_dates = sorted(legacy_auto_dates)
        if not auto_dates and existing_auto_records:
            first_auto = min(existing_auto_records, key=lambda r: r.get("date", "9999-99-99"))
            first_date = _parse_date(first_auto.get("date"))
            days_offset = int(existing_auto_records[0].get("daysOffset") or 0)
            auto_dates = [
                date.fromordinal(day_ordinal).isoformat()
                for day_ordinal in range(first_date.toordinal(), first_date.toordinal() + days_offset + 1)
            ]
        if auto_dates:
            max_minutes = len(auto_dates) * 24 * 60
            missing_minutes_on_first_day = max(0, max_minutes - auto_minutes)
            start_hour = missing_minutes_on_first_day // 60
            start_minute = missing_minutes_on_first_day % 60
            normalized_overtime.append({
                "date": auto_dates[0],
                "type": "overtime",
                "startTime": f"{start_hour:02d}:{start_minute:02d}",
                "endTime": "24:00",
                "hours": auto_hours,
                "minutes": auto_remaining_minutes,
                "daysOffset": len(auto_dates) - 1,
                "is_auto": True
            })

    normalized_overtime.sort(key=lambda r: r.get("date", ""))
    data["overtime_records"] = normalized_overtime
    return data, data != (form.form_data or {})

def get_onboarding_time_for_contract(employee_id, contract_id):
    """
    获取合同的上户时间信息
    查找所有该合同的考勤表，找到上户记录
    
    返回: {
        'has_onboarding': True/False,
        'onboarding_date': '2024-12-29',
        'onboarding_time': '09:00',
    }
    """
    try:
        contract = BaseContract.query.get(contract_id)
        contract_ids = [contract_id]
        if contract:
            query = BaseContract.query.filter(
                BaseContract.service_personnel_id == employee_id,
                BaseContract.status.in_(['active', 'pending', 'terminated', 'finished', 'completed'])
            )
            if contract.family_id:
                query = query.filter(BaseContract.family_id == contract.family_id)
            elif contract.customer_name:
                query = query.filter(BaseContract.customer_name == contract.customer_name)
            elif contract.customer_id:
                query = query.filter(BaseContract.customer_id == contract.customer_id)
            else:
                query = query.filter(BaseContract.id == contract_id)
            related_contracts = query.all()
            contract_ids = [c.id for c in related_contracts] or [contract_id]

        # 查找当前合同及同客户/家庭历史合同的考勤表，按时间正序（找最早的上户记录）
        forms = AttendanceForm.query.filter(
            AttendanceForm.employee_id == employee_id,
            AttendanceForm.contract_id.in_(contract_ids)
        ).order_by(AttendanceForm.cycle_start_date.asc()).all()
        
        current_app.logger.info(f"[GET_ONBOARDING] 查找合同 {contract_id} 的考勤表，找到 {len(forms)} 条记录")
        
        for form in forms:
            if not form.form_data:
                current_app.logger.info(f"[GET_ONBOARDING] 考勤表 {form.id} 没有 form_data")
                continue
            
            onboarding_records = form.form_data.get('onboarding_records', [])
            current_app.logger.info(f"[GET_ONBOARDING] 考勤表 {form.id} ({form.cycle_start_date}) 有 {len(onboarding_records)} 条上户记录")
            
            if onboarding_records:
                # 取第一条上户记录
                record = onboarding_records[0]
                onboarding_date = record.get('date')
                onboarding_time = record.get('startTime')  # 上户时间存储在 startTime 中
                
                current_app.logger.info(f"[GET_ONBOARDING] 找到上户记录: 日期={onboarding_date}, 时间={onboarding_time}")
                
                if onboarding_date and onboarding_time:
                    return {
                        'has_onboarding': True,
                        'onboarding_date': onboarding_date,
                        'onboarding_time': onboarding_time,
                        'contract_id': str(form.contract_id),
                        'form_id': str(form.id),
                        'customer_signature_token': form.customer_signature_token
                    }
        
        current_app.logger.warning(f"[GET_ONBOARDING] 未找到合同 {contract_id} 的上户记录")
        return {
            'has_onboarding': False,
            'onboarding_date': None,
            'onboarding_time': None,
            'contract_id': None,
            'form_id': None,
            'customer_signature_token': None
        }
        
    except Exception as e:
        current_app.logger.error(f"获取上户时间信息失败: {e}", exc_info=True)
        return {
            'has_onboarding': False,
            'onboarding_date': None,
            'onboarding_time': None,
            'contract_id': None,
            'form_id': None,
            'customer_signature_token': None
        }


def calculate_offboarding_work_days(onboarding_time, offboarding_date, offboarding_time):
    """
    计算下户月需要额外加上的出勤天数（上户日补回 + 下户日出勤）
    
    计算逻辑：
    - 上户当月：上户日被扣除整天，但实际有出勤（上户时间~24:00）
    - 下户当月：下户日有出勤（00:00~下户时间）
    - 这两部分需要合并计算，加到下户月的出勤中
    
    例如：上户时间 09:00，下户时间 10:00
    - 上户日实际出勤 = 24 - 9 = 15小时
    - 下户日实际出勤 = 10小时
    - 合计 = 15 + 10 = 25小时 = 25/24 ≈ 1.042天
    
    返回: Decimal 类型的额外天数（保留3位小数）
    """
    try:
        # 解析上户时间
        onboarding_hour, onboarding_minute = map(int, onboarding_time.split(':'))
        onboarding_hours = onboarding_hour + onboarding_minute / 60
        
        # 解析下户时间
        offboarding_hour, offboarding_minute = map(int, offboarding_time.split(':'))
        offboarding_hours = offboarding_hour + offboarding_minute / 60
        
        # 上户日不计入首月基础出勤，剩余小时在下户月与下户当天合并计算。
        onboarding_day_work = max(0, 24 - onboarding_hours)
        
        # 下户日实际出勤（00:00到下户时间）
        offboarding_day_work = offboarding_hours
        
        # 合计额外天数
        total_extra_hours = onboarding_day_work + offboarding_day_work
        total_extra_days = Decimal(str(total_extra_hours)) / Decimal('24')
        
        # 保留3位小数
        total_extra_days = total_extra_days.quantize(Decimal('0.001'), rounding=ROUND_HALF_UP)
        
        return total_extra_days
        
    except Exception as e:
        current_app.logger.error(f"计算上户/下户额外天数失败: {e}", exc_info=True)
        return Decimal('1')  # 出错时默认算1天

def sync_attendance_to_record(attendance_form_id):
    """
    将考勤表数据同步到 AttendanceRecord
    并触发工资单重算
    """
    current_app.logger.info(f"[ATTENDANCE_SYNC] 开始同步考勤表 ID: {attendance_form_id}")
    
    form = AttendanceForm.query.get(attendance_form_id)
    if not form:
        current_app.logger.error(f"[ATTENDANCE_SYNC] AttendanceForm {attendance_form_id} not found")
        raise ValueError(f"AttendanceForm {attendance_form_id} not found")
        
    data, normalized = normalize_auto_overtime_form_data(form)
    if normalized:
        form.form_data = data
        current_app.logger.info(f"[ATTENDANCE_SYNC] 已规范化自动补齐加班数据: form_id={form.id}")
    current_app.logger.debug(f"[ATTENDANCE_SYNC] 表单数据: {data}")
    
    # 1. 辅助函数: 将小时分钟转换为天数 (8小时制? 还是24小时? 通常考勤按工作日计算)
    # 假设: 
    # - 休息、请假、加班等输入的是小时数
    # - 这里的转换规则需要明确: 
    #   - 如果是"天"，则直接使用
    #   - 如果是"小时"，需要除以标准工作时长(例如8小时)
    #   - 但根据需求文档，前端输入的是时长(小时:分钟)
    #   - 之前的 AttendanceRecord.overtime_days 是 Numeric(10, 3)
    #   - 我们假设标准工作日为 8 小时? 或者 24 小时?
    #   - 育儿嫂/月嫂通常是 24 小时住家，但计算工资时可能按"天"算。
    #   - 之前的逻辑: overtime_days = int(data["overtime_days"]) (直接是天数)
    #   - 新前端: 输入小时:分钟
    #   - 让我们假设一天是 24 小时 (对于住家保姆) 或者 8 小时 (对于白班)
    #   - 这是一个业务规则问题。根据之前的 BillingEngine，似乎没有明确的小时转换。
    #   - 让我们查看 requirement_document.md 中的描述: "休息日期选择 + 时长输入"
    #   - 既然是"天数"，那我们应该把小时转换为天。
    #   - 对于住家保姆，通常一天就是一天。休息半天?
    #   - 让我们假设 24 小时为 1 天 (简化计算，或者根据合同类型?)
    #   - 实际上，如果用户输入的是"天数"，那就更好了。
    #   - 让我们假设前端传来的数据结构中包含 hours 和 minutes，我们需要转换为 days。
    #   - 规则: days = hours / 24 + minutes / 1440 (如果是住家)
    #   - 或者 days = hours / 8 (如果是白班)
    #   - 鉴于系统主要是月嫂/育儿嫂，通常是住家，所以 24 小时制可能更合理，或者直接让用户输入"天数"。
    #   - 但前端需求说 "时长输入"。
    #   - 让我们暂定: 1天 = 24小时。
    
    def calculate_days(records):
        total_days = Decimal(0)
        if not records:
            return total_days
        for r in records:
            # r 结构: {date: '...', hours: 24, minutes: 0}
            h = r.get('hours', 0)
            m = r.get('minutes', 0)
            
            # 兼容两种数据格式：
            # 1. 旧格式：hours 是小数（如 10.5），minutes 也有值（如 30）- 此时 hours 已包含分钟
            # 2. 新格式：hours 是整数（如 10），minutes 是余数（如 30）
            # 检测方式：如果 hours 有小数部分，说明是旧格式
            if isinstance(h, float) and h % 1 != 0:
                # 旧格式：hours 已经是完整的小时数（包含小数），忽略 minutes
                total_hours = Decimal(str(h))
            else:
                # 新格式：hours 是整数，minutes 是余数分钟
                total_hours = Decimal(str(h)) + Decimal(str(m)) / Decimal(60)
            
            # 转换为天数（24小时 = 1天）
            days = total_hours / Decimal(24)
            total_days += days
        return total_days

    # 2. 计算各项天数
    rest_days = calculate_days(data.get('rest_records', []))
    leave_days = calculate_days(data.get('leave_records', []))
    overtime_days = calculate_days(data.get('overtime_records', []))
    out_of_beijing_days = calculate_days(data.get('out_of_beijing_records', []))  # 修复：使用正确的键名
    out_of_country_days = calculate_days(data.get('out_of_country_records', []))  # 修复：使用正确的键名
    paid_leave_days = calculate_days(data.get('paid_leave_records', []))
    
    cycle_start = _parse_date(form.cycle_start_date)
    cycle_end = _parse_date(form.cycle_end_date)

    # 【新增】上户/下户特殊处理
    onboarding_records = data.get('onboarding_records', [])
    offboarding_records = data.get('offboarding_records', [])
    
    # 上户月不把上户当天计入基础出勤；该日剩余小时留到下户月合并计算。
    onboarding_days = _onboarding_days_to_exclude(data, cycle_start, cycle_end)
    
    # 下户月需要把首月上户日剩余小时与下户日已工作小时合并计算。
    offboarding_days = Decimal(0)
    offboarding_day_work = Decimal(0)  # 上户日剩余小时 + 下户日已工作小时折算出的天数
    onboarding_time_info = None
    offboarding_time_info = None
    
    # 【统一逻辑】始终使用 get_onboarding_time_for_contract 查找合同的第一条上户记录
    # 不管是上户月还是下户月，都显示合同的上户时间信息
    onboarding_info = get_onboarding_time_for_contract(form.employee_id, form.contract_id)
    current_app.logger.info(f"[ATTENDANCE_SYNC] 查找上户时间 - 员工:{form.employee_id}, 合同:{form.contract_id}, 结果:{onboarding_info}")
    
    if onboarding_info['has_onboarding']:
        onboarding_time_info = {
            'date': onboarding_info['onboarding_date'],
            'time': onboarding_info['onboarding_time']
        }
        current_app.logger.info(f"[ATTENDANCE_SYNC] 设置上户时间信息: {onboarding_time_info}")
    
    if offboarding_records:
        # 获取下户记录信息
        offboarding_record = offboarding_records[0]
        offboarding_date = offboarding_record.get('date')
        offboarding_time = offboarding_record.get('endTime')  # 下户时间存储在 endTime 中
        
        if offboarding_date and offboarding_time:
            offboarding_time_info = {
                'date': offboarding_date,
                'time': offboarding_time
            }
        
        if onboarding_info['has_onboarding'] and offboarding_time:
            # 计算上户日剩余小时 + 下户日已工作小时折算出的天数
            offboarding_day_work = calculate_offboarding_work_days(
                onboarding_info['onboarding_time'],
                offboarding_date,
                offboarding_time
            )
            
            current_app.logger.info(f"[ATTENDANCE_SYNC] 下户月计算 - 上户时间:{onboarding_info['onboarding_time']}, 下户时间:{offboarding_time}, 合并出勤:{offboarding_day_work}天")
        else:
            # 如果没有上户时间信息，下户日按1整天计算
            offboarding_day_work = Decimal('1')
            current_app.logger.warning(f"[ATTENDANCE_SYNC] 未找到上户时间信息，下户日按1整天计算")
    
    current_app.logger.info(f"[ATTENDANCE_SYNC] 计算结果 - 休息:{rest_days}, 请假:{leave_days}, 带薪休假:{paid_leave_days}, 加班:{overtime_days}, 出京:{out_of_beijing_days}, 出境:{out_of_country_days}, 上户扣除:{onboarding_days}, 合并出勤:{offboarding_day_work}")
    
    # 3. 计算总出勤天数
    # 逻辑: 合同有效天数 - 休息天数 - 请假天数
    # 注意: 带薪休假算做出勤? 
    # 需求文档: "total_days_worked: 出勤天数(含带薪休假、出京、出境)"
    # 所以: Total = ValidDays - Rest - Leave
    
    # 【关键修复】使用合同的有效日期范围，而不是整个考勤周期
    contract = form.contract
    if contract:
        # 合同开始日期（如果有实际上户日，优先使用实际上户日）
        raw_contract_start = getattr(contract, 'actual_onboarding_date', None) or contract.start_date
        contract_start = raw_contract_start.date() if isinstance(raw_contract_start, datetime) else raw_contract_start
        effective_start = max(cycle_start, contract_start)
        
        contract_end = _attendance_contract_end_date(contract)
                
        if contract_end:
            effective_end = max(effective_start, min(cycle_end, contract_end))  # 防止 contract_end 在 effective_start 之前导致负数
        else:
            effective_end = cycle_end

        
        # 计算有效天数（基础劳务天数）
        base_work_days = (effective_end - effective_start).days + 1
        current_app.logger.info(f"[ATTENDANCE_SYNC] 合同有效期: {effective_start} 到 {effective_end}, 基础劳务天数: {base_work_days}")
    else:
        # 如果没有合同信息，回退到使用考勤周期
        base_work_days = (cycle_end - cycle_start).days + 1
        current_app.logger.warning(f"[ATTENDANCE_SYNC] 未找到合同信息，使用考勤周期天数: {base_work_days}")
    
    # 出勤天数 = 基础劳务天数 - 休息天数 - 请假天数 - 上户日 + 末月小时合并调整
    if offboarding_records and offboarding_day_work > 0:
        # offboarding_day_work = (上户日 24:00-上户时间) + (下户日 00:00-下户时间)
        # 基础天数已包含下户日 1 天，因此先减 1 天再加回合并小时。
        total_days_worked = Decimal(base_work_days) - rest_days - leave_days - onboarding_days - Decimal('1') + offboarding_day_work
        current_app.logger.info(f"[ATTENDANCE_SYNC] 下户月调整 - 基础:{base_work_days}, 上户日+下户日出勤:{offboarding_day_work}, 调整后出勤:{total_days_worked}")
    else:
        total_days_worked = Decimal(base_work_days) - rest_days - leave_days - onboarding_days
    
    # 【关键修复】基础劳务天数（出勤天数）单月最高不超过26天
    # 超过的部分在前端会被自动转换为 overtime_days 加班，防止在计算账单时被计算两遍
    if total_days_worked > Decimal('26'):
        total_days_worked = Decimal('26')

    
    # 保留3位小数
    total_days_worked = total_days_worked.quantize(Decimal('0.001'), rounding=ROUND_HALF_UP)
    
    current_app.logger.info(f"[ATTENDANCE_SYNC] 基础劳务天数:{base_work_days}, 休息:{rest_days}, 请假:{leave_days}, 上户:{onboarding_days}, 总出勤天数:{total_days_worked}")
    
    # 4. 创建或更新 AttendanceRecord
    attendance = AttendanceRecord.query.filter_by(
        contract_id=form.contract_id,
        cycle_start_date=form.cycle_start_date
    ).first()
    
    if not attendance:
        current_app.logger.info(f"[ATTENDANCE_SYNC] 创建新的 AttendanceRecord")
        attendance = AttendanceRecord(
            employee_id=form.employee_id,
            contract_id=form.contract_id,
            cycle_start_date=form.cycle_start_date,
            cycle_end_date=form.cycle_end_date
        )
        db.session.add(attendance)
    else:
        current_app.logger.info(f"[ATTENDANCE_SYNC] 更新现有 AttendanceRecord ID: {attendance.id}")
    
    # 更新字段
    attendance.total_days_worked = total_days_worked
    attendance.overtime_days = overtime_days
    attendance.out_of_beijing_days = out_of_beijing_days
    attendance.out_of_country_days = out_of_country_days
    attendance.attendance_form_id = form.id
    
    # 构造 attendance_details 用于显示
    details = {
        "rest_days": float(rest_days),
        "leave_days": float(leave_days),
        "paid_leave_days": float(paid_leave_days),
        "overtime_days": float(overtime_days),
        "out_of_beijing_days": float(out_of_beijing_days),
        "out_of_country_days": float(out_of_country_days),
        "onboarding_days": float(onboarding_days),
        "offboarding_day_work": float(offboarding_day_work),  # 下户日实际出勤天数
        "raw_data": data
    }
    
    # 【新增】如果有上户/下户时间信息，添加到details中用于显示
    if onboarding_time_info:
        details["onboarding_time_info"] = onboarding_time_info
    if offboarding_time_info:
        details["offboarding_time_info"] = offboarding_time_info
    
    attendance.attendance_details = details
    
    db.session.commit()
    current_app.logger.info(f"[ATTENDANCE_SYNC] AttendanceRecord 已保存")
    
    # 5. 更新 AttendanceForm 状态
    form.synced_to_attendance = True
    form.attendance_record_id = attendance.id
    form.status = 'synced'
    db.session.commit()
    current_app.logger.info(f"[ATTENDANCE_SYNC] AttendanceForm 状态已更新为 synced")
    
    # 6. 触发工资单重算
    # BillingEngine.calculate_for_month 需要 year, month
    year = form.cycle_start_date.year
    month = form.cycle_start_date.month
    
    current_app.logger.info(f"[ATTENDANCE_SYNC] 准备触发账单重算: contract_id={form.contract_id}, year={year}, month={month}, 出勤天数={total_days_worked}天")
    
    # 注意: calculate_for_month 是同步还是异步? 
    # 如果是耗时操作，建议异步。但在 sync_service 中，我们可能希望立即看到结果?
    # 之前的 billing_api 是用 task.delay()。
    # 这里我们直接调用 Engine? 或者调用 Task?
    # 为了简化，直接调用 Engine，因为这是由用户提交触发的单一操作。
    try:
        engine = BillingEngine()
        # 【关键修复】传入出勤天数（合同有效天数 - 休息 - 请假 - 上户 + 下户调整）
        # billing_engine 中的 actual_work_days_override 用于设置 base_work_days（基本劳务天数）
        # 基本劳务天数 = 出勤天数（不含加班），加班天数通过 AttendanceRecord.overtime_days 单独计算
        engine.calculate_for_month(
            year, 
            month, 
            contract_id=form.contract_id, 
            force_recalculate=True,
            actual_work_days_override=float(total_days_worked)  # 传入出勤天数（从考勤表计算）
        )
        # 【关键修复】显式提交事务，确保账单更新保存到数据库
        db.session.commit()
        current_app.logger.info(f"[ATTENDANCE_SYNC] 账单重算完成并已提交，使用出勤天数: {total_days_worked}天")

        try:
            from backend.services.renewal_sync_service import sync_renewal_after_attendance_confirmation

            sync_renewal_after_attendance_confirmation(form.id)
            db.session.commit()
        except Exception as renewal_sync_error:
            db.session.rollback()
            current_app.logger.error(
                f"[ATTENDANCE_SYNC] 续签考勤/工资转移同步失败: {renewal_sync_error}",
                exc_info=True,
            )
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"[ATTENDANCE_SYNC] 账单重算失败: {str(e)}", exc_info=True)
        # 不抛出异常，因为考勤数据已经保存成功
        # 用户可以手动触发重算
