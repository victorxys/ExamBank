from backend.models import db, AttendanceForm, AttendanceRecord, BaseContract
from backend.services.billing_engine import BillingEngine
from datetime import datetime, date
import calendar
from decimal import Decimal, ROUND_HALF_UP
from flask import current_app

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
        # 查找所有该合同的考勤表，按时间正序（找最早的上户记录）
        forms = AttendanceForm.query.filter_by(
            employee_id=employee_id,
            contract_id=contract_id
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
                        'onboarding_time': onboarding_time
                    }
        
        current_app.logger.warning(f"[GET_ONBOARDING] 未找到合同 {contract_id} 的上户记录")
        return {
            'has_onboarding': False,
            'onboarding_date': None,
            'onboarding_time': None
        }
        
    except Exception as e:
        current_app.logger.error(f"获取上户时间信息失败: {e}", exc_info=True)
        return {
            'has_onboarding': False,
            'onboarding_date': None,
            'onboarding_time': None
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
        
        # 上户日实际出勤（上户时间到24:00）
        onboarding_day_work = 24 - onboarding_hours
        
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
        
    data = form.form_data
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
    
    # 【新增】上户/下户特殊处理
    onboarding_records = data.get('onboarding_records', [])
    offboarding_records = data.get('offboarding_records', [])
    
    # 上户天数：上户当月，上户日不计入出勤天数（扣除整天）
    # 注意：这里改为按整天扣除，而不是按小时计算
    onboarding_days = Decimal(len(onboarding_records))  # 每条上户记录扣除1整天
    
    # 下户天数：下户当月，下户日计作出勤
    # 需要根据上户时间和下户时间计算下户日的实际出勤
    offboarding_days = Decimal(0)
    offboarding_day_work = Decimal(0)  # 下户日的实际出勤天数
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
            # 计算下户日的实际出勤天数
            offboarding_day_work = calculate_offboarding_work_days(
                onboarding_info['onboarding_time'],
                offboarding_date,
                offboarding_time
            )
            
            current_app.logger.info(f"[ATTENDANCE_SYNC] 下户月计算 - 上户时间:{onboarding_info['onboarding_time']}, 下户时间:{offboarding_time}, 下户日出勤:{offboarding_day_work}天")
        else:
            # 如果没有上户时间信息，下户日按1整天计算
            offboarding_day_work = Decimal('1')
            current_app.logger.warning(f"[ATTENDANCE_SYNC] 未找到上户时间信息，下户日按1整天计算")
    
    current_app.logger.info(f"[ATTENDANCE_SYNC] 计算结果 - 休息:{rest_days}, 请假:{leave_days}, 带薪休假:{paid_leave_days}, 加班:{overtime_days}, 出京:{out_of_beijing_days}, 出境:{out_of_country_days}, 上户:{onboarding_days}, 下户日出勤:{offboarding_day_work}")
    
    # 3. 计算总出勤天数
    # 逻辑: 合同有效天数 - 休息天数 - 请假天数
    # 注意: 带薪休假算做出勤? 
    # 需求文档: "total_days_worked: 出勤天数(含带薪休假、出京、出境)"
    # 所以: Total = ValidDays - Rest - Leave
    
    # 【关键修复】使用合同的有效日期范围，而不是整个考勤周期
    contract = form.contract
    if contract:
        # 计算合同在当月的有效天数
        cycle_start = form.cycle_start_date.date() if isinstance(form.cycle_start_date, datetime) else form.cycle_start_date
        cycle_end = form.cycle_end_date.date() if isinstance(form.cycle_end_date, datetime) else form.cycle_end_date
        
        # 合同开始日期（如果在当月之后，使用合同开始日期）
        contract_start = contract.start_date.date() if isinstance(contract.start_date, datetime) else contract.start_date
        effective_start = max(cycle_start, contract_start)
        
        # 合同结束日期（如果在当月之前，使用合同结束日期）
        contract_end = contract.end_date.date() if isinstance(contract.end_date, datetime) else contract.end_date
        # 如果合同已终止，使用终止日期
        if contract.termination_date:
            termination_date = contract.termination_date.date() if isinstance(contract.termination_date, datetime) else contract.termination_date
            contract_end = min(contract_end, termination_date)
        effective_end = min(cycle_end, contract_end)
        
        # 计算有效天数（基础劳务天数）
        base_work_days = (effective_end - effective_start).days + 1
        current_app.logger.info(f"[ATTENDANCE_SYNC] 合同有效期: {effective_start} 到 {effective_end}, 基础劳务天数: {base_work_days}")
    else:
        # 如果没有合同信息，回退到使用考勤周期
        base_work_days = (form.cycle_end_date.date() - form.cycle_start_date.date()).days + 1
        current_app.logger.warning(f"[ATTENDANCE_SYNC] 未找到合同信息，使用考勤周期天数: {base_work_days}")
    
    # 出勤天数 = 基础劳务天数 - 休息天数 - 请假天数 - 上户天数
    # 【新增】上户不计算出勤天数，下户计算出勤天数
    # 【下户月特殊处理】如果有下户记录，需要调整
    if offboarding_records and offboarding_day_work > 0:
        # 下户月计算逻辑：
        # offboarding_day_work = 上户日实际出勤(24-上户时间) + 下户日实际出勤(下户时间)
        # 基础天数已经包含了下户日作为完整1天
        # 需要：减去下户日多算的部分，加上上户日补回的部分
        # 调整 = offboarding_day_work - 1（因为下户日已经算了1天，实际应该是 offboarding_day_work 天）
        # 但 offboarding_day_work 包含了上户日补回，所以：
        # 总出勤 = 基础天数 - 1（下户日） + offboarding_day_work
        total_days_worked = Decimal(base_work_days) - rest_days - leave_days - onboarding_days - Decimal('1') + offboarding_day_work
        current_app.logger.info(f"[ATTENDANCE_SYNC] 下户月调整 - 基础:{base_work_days}, 上户日+下户日出勤:{offboarding_day_work}, 调整后出勤:{total_days_worked}")
    else:
        total_days_worked = Decimal(base_work_days) - rest_days - leave_days - onboarding_days
    
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
    
    current_app.logger.info(f"[ATTENDANCE_SYNC] 准备触发账单重算: contract_id={form.contract_id}, year={year}, month={month}, 出勤天数={total_days_worked}")
    
    # 注意: calculate_for_month 是同步还是异步? 
    # 如果是耗时操作，建议异步。但在 sync_service 中，我们可能希望立即看到结果?
    # 之前的 billing_api 是用 task.delay()。
    # 这里我们直接调用 Engine? 或者调用 Task?
    # 为了简化，直接调用 Engine，因为这是由用户提交触发的单一操作。
    try:
        engine = BillingEngine()
        # 【关键修复】传入出勤天数（合同有效天数 - 休息 - 请假）
        # billing_engine 中的 actual_work_days_override 用于设置 base_work_days（基本劳务天数）
        # 基本劳务天数 = 出勤天数（不含加班），加班天数通过 AttendanceRecord.overtime_days 单独计算
        engine.calculate_for_month(
            year, 
            month, 
            contract_id=form.contract_id, 
            force_recalculate=True,
            actual_work_days_override=float(total_days_worked)  # 传入出勤天数（合同有效天数 - 休息 - 请假）
        )
        # 【关键修复】显式提交事务，确保账单更新保存到数据库
        db.session.commit()
        current_app.logger.info(f"[ATTENDANCE_SYNC] 账单重算完成并已提交，使用出勤天数: {total_days_worked}")
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"[ATTENDANCE_SYNC] 账单重算失败: {str(e)}", exc_info=True)
        # 不抛出异常，因为考勤数据已经保存成功
        # 用户可以手动触发重算
