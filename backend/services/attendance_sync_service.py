from backend.models import db, AttendanceForm, AttendanceRecord, BaseContract
from backend.services.billing_engine import BillingEngine
from datetime import datetime, date
import calendar
from decimal import Decimal
from flask import current_app

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
    # 【新增】上户天数（上户不计算出勤天数，下户计算出勤天数）
    onboarding_days = calculate_days(data.get('onboarding_records', []))
    offboarding_days = calculate_days(data.get('offboarding_records', []))
    
    current_app.logger.info(f"[ATTENDANCE_SYNC] 计算结果 - 休息:{rest_days}, 请假:{leave_days}, 带薪休假:{paid_leave_days}, 加班:{overtime_days}, 出京:{out_of_beijing_days}, 出境:{out_of_country_days}, 上户:{onboarding_days}, 下户:{offboarding_days}")
    
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
    total_days_worked = Decimal(base_work_days) - rest_days - leave_days - onboarding_days
    
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
        "offboarding_days": float(offboarding_days),
        "raw_data": data
    }
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
