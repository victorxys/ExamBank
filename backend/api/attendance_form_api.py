from flask import Blueprint, jsonify, request, current_app, render_template, make_response
from backend.models import db, AttendanceForm, BaseContract, ServicePersonnel, AttendanceRecord, NannyContract
from backend.services.attendance_sync_service import sync_attendance_to_record
import uuid
from datetime import datetime, date, timedelta
from dateutil.relativedelta import relativedelta
import calendar
import os
 
attendance_form_bp = Blueprint('attendance_form_api', __name__, url_prefix='/api/attendance-forms')

def calculate_last_month_cycle():
    """计算上个月的考勤周期(上月1日到上月最后一日)"""
    today = date.today()
    # 获取上个月的第一天
    last_month_start = (today.replace(day=1) - relativedelta(months=1))
    # 获取上个月的最后一天
    last_month_end = today.replace(day=1) - relativedelta(days=1)
    return last_month_start, last_month_end


def is_continuous_service(contract):
    """
    检查当前合同是否是连续服务（续约合同）
    判断条件：同一员工在同一客户/家庭有前一个合同，且前合同结束日期与当前合同开始日期连续（相差<=1天）
    返回: True 如果是续约/连续服务，False 如果是新上户
    """
    if not contract or not contract.service_personnel_id:
        return False
    
    contract_start = contract.start_date.date() if isinstance(contract.start_date, datetime) else contract.start_date
    if not contract_start:
        return False
    
    # 查找同一员工、同一客户/家庭的其他合同
    query = BaseContract.query.filter(
        BaseContract.service_personnel_id == contract.service_personnel_id,
        BaseContract.id != contract.id,
        BaseContract.status.in_(['active', 'terminated', 'finished', 'completed'])
    )
    
    # 按家庭ID或客户名匹配
    if contract.family_id:
        query = query.filter(BaseContract.family_id == contract.family_id)
    elif contract.customer_name:
        query = query.filter(BaseContract.customer_name == contract.customer_name)
    else:
        return False
    
    previous_contracts = query.all()
    
    for prev in previous_contracts:
        # 获取前合同的结束日期
        prev_end = prev.end_date.date() if isinstance(prev.end_date, datetime) else prev.end_date
        if prev.termination_date:
            prev_end = prev.termination_date.date() if isinstance(prev.termination_date, datetime) else prev.termination_date
        
        if not prev_end:
            continue
        
        # 检查是否连续（前合同结束日期与当前合同开始日期相差<=1天）
        days_gap = (contract_start - prev_end).days
        if 0 <= days_gap <= 1:
            current_app.logger.info(f"检测到续约合同: 前合同 {prev.id} 结束于 {prev_end}, 当前合同开始于 {contract_start}, 间隔 {days_gap} 天")
            return True
    
    return False


def has_following_contract(contract):
    """
    检查当前合同结束后是否有续约合同（连续服务）
    判断条件：同一员工在同一客户/家庭有后续合同，且后续合同开始日期与当前合同结束日期连续（相差<=1天）
    返回: True 如果有续约合同，False 如果是真正的下户
    """
    if not contract or not contract.service_personnel_id:
        return False
    
    # 获取当前合同的结束日期
    contract_end = contract.end_date.date() if isinstance(contract.end_date, datetime) else contract.end_date
    if contract.termination_date:
        contract_end = contract.termination_date.date() if isinstance(contract.termination_date, datetime) else contract.termination_date
    
    if not contract_end:
        return False
    
    # 查找同一员工、同一客户/家庭的其他合同
    query = BaseContract.query.filter(
        BaseContract.service_personnel_id == contract.service_personnel_id,
        BaseContract.id != contract.id,
        BaseContract.status.in_(['active', 'terminated', 'finished', 'completed'])
    )
    
    # 按家庭ID或客户名匹配
    if contract.family_id:
        query = query.filter(BaseContract.family_id == contract.family_id)
    elif contract.customer_name:
        query = query.filter(BaseContract.customer_name == contract.customer_name)
    else:
        return False
    
    following_contracts = query.all()
    
    for following in following_contracts:
        # 获取后续合同的开始日期
        following_start = following.start_date.date() if isinstance(following.start_date, datetime) else following.start_date
        
        if not following_start:
            continue
        
        # 检查是否连续（当前合同结束日期与后续合同开始日期相差<=1天）
        days_gap = (following_start - contract_end).days
        if 0 <= days_gap <= 1:
            current_app.logger.info(f"检测到续约合同: 当前合同 {contract.id} 结束于 {contract_end}, 后续合同 {following.id} 开始于 {following_start}, 间隔 {days_gap} 天")
            return True
    
    return False


def filter_contracts_for_cycle(employee_id, cycle_start, cycle_end):
    """
    统一的合同过滤函数：查找指定周期内有效的合同
    
    过滤规则：
    1. 月签合同（is_monthly_auto_renew=True 且 status='active'）：不检查 end_date
    2. 已终止合同：使用 termination_date 作为实际结束日期
    3. 普通合同：检查 end_date >= cycle_start
    4. 月嫂合同：优先使用 actual_onboarding_date 作为开始日期
    
    返回: 符合条件的合同列表
    """
    # 确保 cycle_start 和 cycle_end 是 date 类型
    if isinstance(cycle_start, datetime):
        cycle_start = cycle_start.date()
    if isinstance(cycle_end, datetime):
        cycle_end = cycle_end.date()
    
    # 先查询所有可能的合同（start_date <= cycle_end）
    # 注意：这里使用 start_date 是为了获取所有可能的合同，后面会根据 actual_onboarding_date 再过滤
    all_contracts = BaseContract.query.filter(
        BaseContract.service_personnel_id == employee_id,
        BaseContract.status.in_(['active', 'terminated', 'finished', 'completed']),
        BaseContract.start_date <= cycle_end
    ).order_by(BaseContract.start_date.desc()).all()
    
    current_app.logger.info(f"[DEBUG] filter_contracts_for_cycle: employee_id={employee_id}, cycle={cycle_start} ~ {cycle_end}")
    current_app.logger.info(f"[DEBUG] 查询到 {len(all_contracts)} 个候选合同")
    for c in all_contracts:
        monthly_flag = getattr(c, 'is_monthly_auto_renew', None)
        current_app.logger.info(f"[DEBUG]   - 合同 {c.id}: type={c.type}, status={c.status}, start={c.start_date}, end={c.end_date}, is_monthly_auto_renew={monthly_flag}")
    
    # 过滤：只保留 end_date >= cycle_start 的合同，或者月签合同（active 状态）
    contracts = []
    for c in all_contracts:
        # 获取实际开始日期（月嫂合同优先使用 actual_onboarding_date）
        actual_start = getattr(c, 'actual_onboarding_date', None)
        if actual_start:
            actual_start = actual_start.date() if isinstance(actual_start, datetime) else actual_start
        else:
            actual_start = c.start_date.date() if isinstance(c.start_date, datetime) else c.start_date
        
        # 如果实际开始日期在周期结束之后，跳过这个合同
        if actual_start > cycle_end:
            current_app.logger.info(f"  - 跳过合同 {c.id}: 实际开始日期 {actual_start} 在周期 {cycle_end} 之后")
            continue
        
        # 检查是否是月签合同（育儿嫂合同）
        is_monthly = False
        if c.type == 'nanny' and c.status == 'active':
            # 使用 getattr 获取 is_monthly_auto_renew 属性，默认为 False
            # 注意：getattr 可能返回 None，需要显式转换为 bool
            monthly_flag = getattr(c, 'is_monthly_auto_renew', None)
            is_monthly = bool(monthly_flag)
            current_app.logger.info(f"  - 合同 {c.id}: type={c.type}, status={c.status}, is_monthly_auto_renew={monthly_flag}, is_monthly={is_monthly}")
        
        # 转换 end_date 为 date 类型
        end_date = c.end_date.date() if isinstance(c.end_date, datetime) else c.end_date
        
        # 对于已终止的合同，使用 termination_date 作为实际结束日期
        if c.status == 'terminated' and c.termination_date:
            actual_end = c.termination_date.date() if isinstance(c.termination_date, datetime) else c.termination_date
        else:
            actual_end = end_date
        
        # 月签合同（active）不检查 end_date
        if is_monthly:
            contracts.append(c)
            current_app.logger.info(f"  - 月签合同 {c.id}: {actual_start} 到 {c.end_date}, 客户={c.customer_name}, status={c.status}")
        # 普通合同检查实际结束日期（考虑 termination_date）
        elif actual_end and actual_end >= cycle_start:
            contracts.append(c)
            current_app.logger.info(f"  - 普通合同 {c.id}: {actual_start} 到 {actual_end}, 客户={c.customer_name}, status={c.status}")
    
    current_app.logger.info(f"📋 找到 {len(contracts)} 个符合条件的合同")
    return contracts


def find_consecutive_contracts(employee_id, cycle_start, cycle_end):
    """
    查找指定周期内，同一员工同一家庭的连续合同链（支持家庭合并）
    返回: (primary_contract, effective_start_date, effective_end_date)
    primary_contract: 用于关联考勤表的合同（通常是最新的那个）
    """
    from sqlalchemy import or_, and_
    
    current_app.logger.info(f"🔍 查找员工 {employee_id} 在周期 {cycle_start} 到 {cycle_end} 的合同")
    
    # 使用统一的合同过滤函数
    contracts = filter_contracts_for_cycle(employee_id, cycle_start, cycle_end)
    for c in contracts:
        current_app.logger.info(f"  - 合同 {c.id}: {c.start_date} 到 {c.end_date}, family_id={c.family_id}, status={c.status}")

    if not contracts:
        return None, None, None

    # 2. 找到最新的合同作为"主合同" (primary_contract)
    # 优先选 active 的，如果没有 active 则选最近的一个
    primary_contract = next((c for c in contracts if c.status == 'active'), contracts[0])
    current_app.logger.info(f"🎯 选择主合同: {primary_contract.id}, family_id={primary_contract.family_id}")
    
    # 3. 【家庭合并逻辑】找到与主合同属于同一家庭的所有合同
    # 优先使用family_id，如果没有则使用customer_name（因为customer_id可能不一致）
    family_contracts = []
    
    if primary_contract.family_id:
        # 优先：如果主合同有family_id，按family_id合并
        family_contracts = [
            c for c in contracts 
            if c.family_id == primary_contract.family_id
        ]
        current_app.logger.info(f"按family_id合并: {primary_contract.family_id}, 找到 {len(family_contracts)} 个合同")
    elif primary_contract.customer_name:
        # 回退：按customer_name合并（因为续签合同的customer_id可能不一致）
        family_contracts = [
            c for c in contracts 
            if c.customer_name == primary_contract.customer_name 
        ]
        current_app.logger.info(f"按customer_name合并: {primary_contract.customer_name}, 找到 {len(family_contracts)} 个合同")
    elif primary_contract.customer_id:
        # 最后回退：按customer_id合并
        family_contracts = [
            c for c in contracts 
            if c.customer_id == primary_contract.customer_id
        ]
        current_app.logger.info(f"按customer_id合并: {primary_contract.customer_id}, 找到 {len(family_contracts)} 个合同")

    # 4. 计算有效日期范围 (合并这些合同的时间段)
    # 取最早的开始时间和最晚的结束时间
    # 对于月嫂合同，优先使用 actual_onboarding_date（实际上户日期）
    def get_effective_start(contract):
        # 如果是月嫂合同且有实际上户日期，使用实际上户日期
        actual_onboarding = getattr(contract, 'actual_onboarding_date', None)
        if actual_onboarding:
            return actual_onboarding
        return contract.start_date
    
    effective_start = min(get_effective_start(c) for c in family_contracts)
    effective_end = max(c.end_date for c in family_contracts)
    
    current_app.logger.info(f"合并后的服务期间: {effective_start} 到 {effective_end}")

    # 如果是自动月签合同，且有终止日期，使用终止日期作为结束边界
    # (针对 primary_contract 判断，或者检查链中是否有 terminated 的)
    # 逻辑：如果链中包含已终止的合同，且该合同是自动月签，我们需要确保 effective_end 不会误导前端
    # 但通常 max(end_date) 已经足够，因为 terminated 合同的 end_date 应该是终止日期
    
    return primary_contract, effective_start, effective_end

@attendance_form_bp.route('/by-token/<employee_token>', methods=['GET'])
def get_attendance_form_by_token(employee_token):
    """
    根据访问令牌获取考勤表
    支持三种查找方式（按优先级）：
    1. 通过考勤表ID直接查找（UUID格式，无年月参数时）
    2. 通过员工ID + 年月参数 + 可选的合同ID查找（有年月参数时）
    3. 通过 employee_access_token 查找（无年月参数时的回退）
    """
    try:
        # 读取 year/month/contractId 参数
        year = request.args.get('year', type=int)
        month = request.args.get('month', type=int)
        contract_id_param = request.args.get('contractId', type=str)
        
        # 尝试解析 token 获取员工ID
        parts = employee_token.split('_')
        employee_id_str = parts[0] if len(parts) >= 1 else employee_token
        
        # 如果 token 中包含年月信息，优先使用
        if len(parts) >= 3:
            try:
                year = int(parts[1])
                month = int(parts[2])
            except ValueError:
                pass
        
        current_app.logger.info(f"[DEBUG] Received year={year}, month={month}, token={employee_token}, contractId={contract_id_param}")
        
        # 初始化 employee 变量
        employee = None
        form_contract = None  # 用于存储通过考勤表找到的合同
        specified_contract = None  # 用于存储通过 contractId 参数指定的合同
        
        # 如果传入了 contractId 参数，先尝试获取指定的合同
        if contract_id_param:
            try:
                specified_contract_id = uuid.UUID(contract_id_param)
                specified_contract = BaseContract.query.get(specified_contract_id)
                if specified_contract:
                    current_app.logger.info(f"[DEBUG] 通过 contractId 参数找到合同: {specified_contract.id}, customer={specified_contract.customer_name}")
            except ValueError:
                current_app.logger.warning(f"[DEBUG] 无效的 contractId 参数: {contract_id_param}")
        
        # 1. 尝试通过考勤表ID直接查找（无论是否有年月参数）
        try:
            form_id = uuid.UUID(employee_token)
            existing_form = AttendanceForm.query.get(form_id)
            if existing_form:
                # 找到了考勤表，获取关联的员工
                employee = existing_form.contract.service_personnel if existing_form.contract else None
                form_contract = existing_form.contract
                
                # 调试日志：打印合同信息
                if form_contract:
                    current_app.logger.info(f"[DEBUG] 通过考勤表找到合同: id={form_contract.id}, type={form_contract.type}, status={form_contract.status}")
                    current_app.logger.info(f"[DEBUG] 合同日期: start={form_contract.start_date}, end={form_contract.end_date}")
                    monthly_flag = getattr(form_contract, 'is_monthly_auto_renew', None)
                    current_app.logger.info(f"[DEBUG] is_monthly_auto_renew={monthly_flag}, hasattr={hasattr(form_contract, 'is_monthly_auto_renew')}")
                
                # 如果没有年月参数，直接返回这个考勤表
                if not year or not month:
                    # 直接使用该考勤表关联的合同日期，不合并其他合同
                    contract = existing_form.contract
                    effective_start = contract.start_date if contract else None
                    effective_end = contract.end_date if contract else None
                    
                    # 对于月签合同，根据状态处理 effective_end
                    if contract and hasattr(contract, 'is_monthly_auto_renew') and contract.is_monthly_auto_renew:
                        if contract.status == 'active':
                            effective_end = None
                        elif contract.status == 'terminated' and contract.termination_date:
                            effective_end = contract.termination_date
                    
                    result = form_to_dict(existing_form, effective_start, effective_end)
                    cycle_start = existing_form.cycle_start_date
                    if isinstance(cycle_start, datetime):
                        cycle_start = cycle_start.date()
                    result['actual_year'] = cycle_start.year
                    result['actual_month'] = cycle_start.month
                    return jsonify(result)
        except ValueError:
            pass
        
        # 2. 如果没有通过考勤表找到员工，尝试通过员工ID查找
        if not employee:
            try:
                employee_id = uuid.UUID(employee_id_str)
                employee = ServicePersonnel.query.get(employee_id)
            except ValueError:
                pass
        
        if not employee:
            return jsonify({"error": "无效的访问令牌"}), 404
        
        # 3. 智能选择默认月份（如果没有传入年月参数）
        if year and month:
            from calendar import monthrange
            last_day = monthrange(year, month)[1]
            cycle_start = date(year, month, 1)
            cycle_end = date(year, month, last_day)
        else:
            # 没有传入年月参数，智能选择默认月份
            # 查找该员工的活跃合同
            active_contracts = BaseContract.query.filter(
                BaseContract.service_personnel_id == employee.id,
                BaseContract.status.in_(['active', 'terminated', 'finished', 'completed'])
            ).order_by(BaseContract.end_date.desc()).all()
            
            today = date.today()
            current_year = today.year
            current_month = today.month
            
            # 计算上个月
            if current_month == 1:
                last_month_year = current_year - 1
                last_month = 12
            else:
                last_month_year = current_year
                last_month = current_month - 1
            
            # 默认使用上个月
            selected_year = last_month_year
            selected_month = last_month
            
            # 检查是否有合同在当月结束（且没有续约合同）
            for contract in active_contracts:
                # 获取合同结束日期（对于已终止合同使用终止日期）
                end_date = contract.termination_date if contract.termination_date else contract.end_date
                if end_date:
                    if end_date.year == current_year and end_date.month == current_month:
                        # 检查是否有续约合同，如果有则不算"当月下户"
                        if not has_following_contract(contract):
                            # 合同在当月结束且没有续约，默认显示当月
                            selected_year = current_year
                            selected_month = current_month
                            current_app.logger.info(f"合同 {contract.id} 在当月结束（无续约），默认显示当月")
                            break
            
            # 检查是否有合同在当月开始（且晚于上个月，且不是续约合同）
            for contract in active_contracts:
                if contract.start_date:
                    if (contract.start_date.year > last_month_year or 
                        (contract.start_date.year == last_month_year and contract.start_date.month > last_month)):
                        # 检查是否是续约合同，如果是则不算"当月上户"
                        if is_continuous_service(contract):
                            current_app.logger.info(f"合同 {contract.id} 是续约合同，不算当月上户")
                            continue
                        # 合同开始月份晚于上个月，使用合同开始月份
                        if (contract.start_date.year < current_year or 
                            (contract.start_date.year == current_year and contract.start_date.month <= current_month)):
                            selected_year = contract.start_date.year
                            selected_month = contract.start_date.month
                            current_app.logger.info(f"合同 {contract.id} 开始于 {selected_year}-{selected_month}（新上户），默认显示该月")
                            break
            
            from calendar import monthrange
            last_day = monthrange(selected_year, selected_month)[1]
            cycle_start = date(selected_year, selected_month, 1)
            cycle_end = date(selected_year, selected_month, last_day)
            
            current_app.logger.info(f"智能选择月份: {selected_year}-{selected_month}")

        # 4. 查找合同
        # 优先级：specified_contract (contractId参数) > form_contract (考勤表关联) > find_consecutive_contracts
        contract = None
        effective_start = None
        effective_end = None
        
        # 优先使用 contractId 参数指定的合同
        target_contract = specified_contract or form_contract
        
        if target_contract:
            # 使用指定的合同，检查该合同是否在请求的周期内有效
            current_app.logger.info(f"[DEBUG] 使用指定的合同: {target_contract.id}, customer={target_contract.customer_name}")
            
            # 获取合同的实际开始日期（月嫂合同优先使用 actual_onboarding_date）
            actual_start = getattr(target_contract, 'actual_onboarding_date', None)
            if actual_start:
                actual_start = actual_start.date() if isinstance(actual_start, datetime) else actual_start
            else:
                actual_start = target_contract.start_date.date() if isinstance(target_contract.start_date, datetime) else target_contract.start_date
            
            # 获取合同的实际结束日期
            is_monthly = getattr(target_contract, 'is_monthly_auto_renew', False) and target_contract.status == 'active'
            if is_monthly:
                # 月签合同（active）没有结束日期限制
                actual_end = None
            elif target_contract.status == 'terminated' and target_contract.termination_date:
                actual_end = target_contract.termination_date.date() if isinstance(target_contract.termination_date, datetime) else target_contract.termination_date
            else:
                actual_end = target_contract.end_date.date() if isinstance(target_contract.end_date, datetime) else target_contract.end_date
            
            # 检查合同是否在请求的周期内有效
            # 条件：actual_start <= cycle_end 且 (is_monthly 或 actual_end >= cycle_start)
            is_valid = actual_start <= cycle_end and (is_monthly or (actual_end and actual_end >= cycle_start))
            
            current_app.logger.info(f"[DEBUG] 合同有效性检查: actual_start={actual_start}, actual_end={actual_end}, is_monthly={is_monthly}, is_valid={is_valid}")
            
            if is_valid:
                contract = target_contract
                effective_start = actual_start
                effective_end = actual_end
                
                # 如果通过 contractId 指定了合同，还需要确保 employee 变量正确设置
                if specified_contract and not employee:
                    employee = specified_contract.service_personnel
        
        # 如果没有通过指定合同找到有效合同，使用原来的逻辑查找
        if not contract:
            contract, effective_start, effective_end = find_consecutive_contracts(employee.id, cycle_start, cycle_end)
        
        if not contract:
            # 查找该员工最早的活跃合同，返回建议的月份
            earliest_contract = BaseContract.query.filter(
                BaseContract.service_personnel_id == employee.id,
                BaseContract.status.in_(['active', 'terminated', 'finished', 'completed'])
            ).order_by(BaseContract.start_date.asc()).first()
            
            if earliest_contract:
                # 转换为 date 类型进行比较
                earliest_start = earliest_contract.start_date.date() if isinstance(earliest_contract.start_date, datetime) else earliest_contract.start_date
                if earliest_start > cycle_end:
                    # 合同开始日期在请求的周期之后，返回建议的月份
                    return jsonify({
                        "error": "未找到该员工的合同",
                        "suggested_year": earliest_contract.start_date.year,
                        "suggested_month": earliest_contract.start_date.month,
                        "contract_start_date": earliest_contract.start_date.isoformat()
                    }), 404
            
            return jsonify({"error": "未找到该员工的合同"}), 404
        
        # 5. 检查是否已经存在该员工该合同该周期的表单
        existing_form = AttendanceForm.query.filter_by(
            employee_id=employee.id,
            contract_id=contract.id,
            cycle_start_date=cycle_start
        ).first()
        
        if existing_form:
            
            # 检查并补充上户/下户记录（如果缺失）
            form_data = existing_form.form_data or {}
            form_data_updated = False
            
            # 确保所有记录类型都存在
            for key in ['rest_records', 'leave_records', 'overtime_records', 'out_of_beijing_records', 
                        'out_of_country_records', 'paid_leave_records', 'onboarding_records', 'offboarding_records']:
                if key not in form_data:
                    form_data[key] = []
            
            # 转换合同日期为 date 类型（如果是 datetime）
            contract_start = contract.start_date.date() if isinstance(contract.start_date, datetime) else contract.start_date
            
            # 检查是否为合同开始月，且缺少上户记录
            # 注意：如果是续约合同（同一客户/家庭的连续服务），则不需要上户记录
            if contract_start and cycle_start <= contract_start <= cycle_end:
                contract_start_str = contract_start.isoformat()
                has_onboarding = any(r.get('date') == contract_start_str for r in form_data.get('onboarding_records', []))
                if not has_onboarding and not is_continuous_service(contract):
                    form_data['onboarding_records'].append({
                        'date': contract_start_str,
                        'type': 'onboarding',
                        'startTime': '',
                        'endTime': '',
                        'hours': 0,
                        'minutes': 0,
                        'daysOffset': 0
                    })
                    form_data_updated = True
                    current_app.logger.info(f"已存在的考勤表补充上户记录: {contract_start}")
            
            # 检查是否为合同结束月，且缺少下户记录
            
            # 检查是否为合同结束月，且缺少下户记录
            contract_end_date = None
            if getattr(contract, 'is_monthly_auto_renew', False) and contract.status == 'terminated' and contract.termination_date:
                contract_end_date = contract.termination_date.date() if isinstance(contract.termination_date, datetime) else contract.termination_date
            elif not getattr(contract, 'is_monthly_auto_renew', False) and contract.end_date:
                contract_end_date = contract.end_date.date() if isinstance(contract.end_date, datetime) else contract.end_date
            
            if contract_end_date and cycle_start <= contract_end_date <= cycle_end:
                contract_end_str = contract_end_date.isoformat()
                has_offboarding = any(r.get('date') == contract_end_str for r in form_data.get('offboarding_records', []))
                if not has_offboarding and not has_following_contract(contract):
                    form_data['offboarding_records'].append({
                        'date': contract_end_str,
                        'type': 'offboarding',
                        'startTime': '',
                        'endTime': '',
                        'hours': 0,
                        'minutes': 0,
                        'daysOffset': 0
                    })
                    form_data_updated = True
                    current_app.logger.info(f"已存在的考勤表补充下户记录: {contract_end_date}")
            
            # 如果有更新，保存到数据库
            if form_data_updated:
                existing_form.form_data = form_data
                db.session.commit()
            
            # 重新计算有效日期范围，确保家庭合并逻辑生效
            result = form_to_dict(existing_form, effective_start, effective_end)
            # 添加实际使用的年月（让前端同步 URL）
            result['actual_year'] = cycle_start.year
            result['actual_month'] = cycle_start.month
            return jsonify(result)

        # 6. 创建新表单 - access_token 使用纯员工ID（固定，不包含年月）
        access_token = str(employee.id)
        
        # 初始化 form_data，根据合同开始/结束日期自动添加"上户"/"下户"记录
        initial_form_data = {
            'rest_records': [],
            'leave_records': [],
            'overtime_records': [],
            'out_of_beijing_records': [],
            'out_of_country_records': [],
            'paid_leave_records': [],
            'onboarding_records': [],
            'offboarding_records': []
        }
        
        # 转换合同日期为 date 类型（如果是 datetime）
        contract_start = contract.start_date.date() if isinstance(contract.start_date, datetime) else contract.start_date
        
        # 判断是否为合同开始月（合同开始日期在当前考勤周期内）
        # 注意：如果是续约合同（同一客户/家庭的连续服务），则不需要上户记录
        if contract_start and cycle_start <= contract_start <= cycle_end:
            if not is_continuous_service(contract):
                # 添加"上户"记录，时间为空（需要用户填写）
                initial_form_data['onboarding_records'].append({
                    'date': contract_start.isoformat(),
                    'type': 'onboarding',
                    'startTime': '',  # 空，需要用户填写
                    'endTime': '',    # 空，需要用户填写
                    'hours': 0,
                    'minutes': 0,
                    'daysOffset': 0
                })
                current_app.logger.info(f"合同开始月，自动添加上户记录: {contract_start}")
            else:
                current_app.logger.info(f"续约合同，跳过上户记录: {contract_start}")
        
        # 判断是否为合同结束月
        # 对于自动月签合同，使用终止日期；否则使用结束日期
        # 注意：如果有续约合同（同一客户/家庭的连续服务），则不需要下户记录
        contract_end_date = None
        if getattr(contract, 'is_monthly_auto_renew', False) and contract.status == 'terminated' and contract.termination_date:
            contract_end_date = contract.termination_date.date() if isinstance(contract.termination_date, datetime) else contract.termination_date
        elif not getattr(contract, 'is_monthly_auto_renew', False) and contract.end_date:
            contract_end_date = contract.end_date.date() if isinstance(contract.end_date, datetime) else contract.end_date
        
        if contract_end_date and cycle_start <= contract_end_date <= cycle_end:
            if not has_following_contract(contract):
                # 添加"下户"记录，时间为空（需要用户填写）
                initial_form_data['offboarding_records'].append({
                    'date': contract_end_date.isoformat(),
                    'type': 'offboarding',
                    'startTime': '',  # 空，需要用户填写
                    'endTime': '',    # 空，需要用户填写
                    'hours': 0,
                    'minutes': 0,
                    'daysOffset': 0
                })
                current_app.logger.info(f"合同结束月，自动添加下户记录: {contract_end_date}")
            else:
                current_app.logger.info(f"有续约合同，跳过下户记录: {contract_end_date}")
        
        new_form = AttendanceForm(
            contract_id=contract.id,
            employee_id=employee.id,
            cycle_start_date=cycle_start,
            cycle_end_date=cycle_end,
            employee_access_token=access_token,
            form_data=initial_form_data,
            status='draft'
        )
        db.session.add(new_form)
        db.session.commit()
        
        result = form_to_dict(new_form, effective_start, effective_end)
        # 添加实际使用的年月（让前端同步 URL）
        result['actual_year'] = cycle_start.year
        result['actual_month'] = cycle_start.month
        return jsonify(result)

    except Exception as e:
        current_app.logger.error(f"获取考勤表失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

@attendance_form_bp.route('/by-token/<employee_token>', methods=['PUT'])
def update_attendance_form(employee_token):
    """更新考勤表数据"""
    try:
        data = request.get_json()
        
        # 优先使用 form_id 查找（支持多月份场景）
        form_id = data.get('form_id')
        if form_id:
            form = AttendanceForm.query.get(form_id)
        else:
            # 兼容旧逻辑：按 token 查找
            form = AttendanceForm.query.filter_by(employee_access_token=employee_token).first()
            
        if not form:
            return jsonify({"error": "考勤表不存在"}), 404
            
        # 只有在客户签署后或已同步后才禁止修改
        if form.status in ['customer_signed', 'synced']:
            return jsonify({"error": "考勤表已签署，无法修改"}), 400
            
        form_data = data.get('form_data')
        
        if form_data:
            form.form_data = form_data
            
        # 如果是提交确认
        action = data.get('action')
        if action == 'confirm':
            # 验证"上户"和"下户"记录的时间是否已填写
            validation_errors = []
            
            # 获取合同信息
            contract = BaseContract.query.get(form.contract_id)
            cycle_start = form.cycle_start_date.date() if isinstance(form.cycle_start_date, datetime) else form.cycle_start_date
            cycle_end = form.cycle_end_date.date() if isinstance(form.cycle_end_date, datetime) else form.cycle_end_date
            
            # 转换合同日期为 date 类型
            contract_start = None
            if contract and contract.start_date:
                contract_start = contract.start_date.date() if isinstance(contract.start_date, datetime) else contract.start_date
            
            # 检查是否为合同开始月
            # 注意：如果是续约合同（同一客户/家庭的连续服务），则不需要上户记录
            if contract_start and cycle_start <= contract_start <= cycle_end:
                # 检查是否是续约合同
                if not is_continuous_service(contract):
                    # 不是续约合同，需要验证上户记录
                    current_form_data = form_data if form_data else form.form_data or {}
                    onboarding_records = current_form_data.get('onboarding_records', [])
                    contract_start_str = contract_start.isoformat()
                    current_app.logger.info(f"[验证] 合同开始日: {contract_start_str}, 上户记录: {onboarding_records}")
                    onboarding_record = next((r for r in onboarding_records if r.get('date') == contract_start_str), None)
                    
                    if not onboarding_record:
                        validation_errors.append(f"合同开始日 {contract_start.strftime('%m月%d日')} 需要填写「上户」记录")
                    elif not onboarding_record.get('startTime') or not onboarding_record.get('endTime'):
                        validation_errors.append(f"上户日 {contract_start.strftime('%m月%d日')} 的具体时间未填写")
                else:
                    current_app.logger.info(f"[验证] 续约合同，跳过上户记录验证: {contract_start}")
            
            # 检查是否为合同结束月
            contract_end_date = None
            if contract:
                if getattr(contract, 'is_monthly_auto_renew', False) and contract.status == 'terminated' and contract.termination_date:
                    contract_end_date = contract.termination_date.date() if isinstance(contract.termination_date, datetime) else contract.termination_date
                elif not getattr(contract, 'is_monthly_auto_renew', False) and contract.end_date:
                    contract_end_date = contract.end_date.date() if isinstance(contract.end_date, datetime) else contract.end_date
            
            if contract_end_date and cycle_start <= contract_end_date <= cycle_end:
                # 检查是否有续约合同
                if not has_following_contract(contract):
                    # 没有续约合同，需要验证下户记录
                    current_form_data = form_data if form_data else form.form_data or {}
                    offboarding_records = current_form_data.get('offboarding_records', [])
                    contract_end_str = contract_end_date.isoformat()
                    offboarding_record = next((r for r in offboarding_records if r.get('date') == contract_end_str), None)
                    
                    if not offboarding_record:
                        validation_errors.append(f"合同结束日 {contract_end_date.strftime('%m月%d日')} 需要填写「下户」记录")
                    elif not offboarding_record.get('startTime') or not offboarding_record.get('endTime'):
                        validation_errors.append(f"下户日 {contract_end_date.strftime('%m月%d日')} 的具体时间未填写")
                else:
                    current_app.logger.info(f"[验证] 有续约合同，跳过下户记录验证: {contract_end_date}")
            
            if validation_errors:
                current_app.logger.info(f"[验证] 验证失败: {validation_errors}")
                return jsonify({"error": "；".join(validation_errors)}), 400
            
            form.status = 'employee_confirmed'
            # 生成客户签署 token（如果还没有）
            if not form.customer_signature_token:
                form.customer_signature_token = str(uuid.uuid4())
        # 如果是普通保存，且当前状态是 employee_confirmed，保持该状态不变
        # 这样员工可以在客户签署前继续修改
                
        db.session.commit()
        
        # 重新计算有效日期范围，以保持前端 contractInfo 正确
        # 注意：这里 cycle_start_date 是 datetime，需要转 date
        cycle_start = form.cycle_start_date.date() if isinstance(form.cycle_start_date, datetime) else form.cycle_start_date
        cycle_end = form.cycle_end_date.date() if isinstance(form.cycle_end_date, datetime) else form.cycle_end_date
        
        _, effective_start, effective_end = find_consecutive_contracts(form.employee_id, cycle_start, cycle_end)
        
        return jsonify(form_to_dict(form, effective_start, effective_end))
        
    except Exception as e:
        current_app.logger.error(f"更新考勤表失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

@attendance_form_bp.route('/sign/<signature_token>', methods=['GET'])
def get_sign_page_data(signature_token):
    """获取客户签署页面数据"""
    try:
        form = AttendanceForm.query.filter_by(customer_signature_token=signature_token).first()
        if not form:
            return jsonify({"error": "无效的签署链接"}), 404
            
        # 调用 find_consecutive_contracts 获取合并后的日期范围
        _, effective_start, effective_end = find_consecutive_contracts(
            form.employee_id,
            form.cycle_start_date,
            form.cycle_end_date
        )

        return jsonify(form_to_dict(form, effective_start, effective_end))
    except Exception as e:
        current_app.logger.error(f"获取签署页面失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

@attendance_form_bp.route('/sign/<signature_token>', methods=['POST'])
def submit_customer_signature(signature_token):
    """提交客户签名"""
    try:
        form = AttendanceForm.query.filter_by(customer_signature_token=signature_token).first()
        if not form:
            return jsonify({"error": "无效的签署链接"}), 404
            
        if form.status == 'customer_signed' or form.status == 'synced':
             return jsonify({"error": "考勤表已签署"}), 400

        data = request.get_json()
        signature_data = data.get('signature_data')
        
        if not signature_data:
            return jsonify({"error": "缺少签名数据"}), 400
            
        # Save to the dedicated column
        form.signature_data = signature_data
        
        form.customer_signed_at = datetime.now()
        form.status = 'customer_signed'
        db.session.commit()
        
        # 触发同步
        try:
            sync_attendance_to_record(form.id)
        except Exception as sync_error:
            current_app.logger.error(f"同步考勤记录失败: {sync_error}", exc_info=True)
            # 注意：这里我们记录错误但不阻断返回，因为签署已经成功
            
        return jsonify({"message": "签署成功", "form": form_to_dict(form)})
        
    except Exception as e:
        current_app.logger.error(f"提交签名失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500


def check_previous_month_out_of_beijing(employee_id, contract_id, current_cycle_start):
    """
    检查上月是否有出京/出境记录延续到本月初
    
    业务场景：员工连续出京跨月
    - 11月5日出京 → 12月31日（12月考勤记录满30天）
    - 1月1日 → 1月15日返京（1月只有15天，但与上月连续，满足30天规则）
    
    返回: {
        'has_continuation': True/False,
        'continuation_type': 'out_of_beijing' | 'out_of_country' | None,
        'previous_end_date': '2024-12-31',  # 上月记录的结束日期
        'total_days_before': 57,  # 上月记录的总天数（用于显示）
    }
    """
    try:
        # 计算上个月的周期
        if isinstance(current_cycle_start, datetime):
            current_cycle_start = current_cycle_start.date()
        
        prev_month_end = current_cycle_start - timedelta(days=1)
        prev_month_start = prev_month_end.replace(day=1)
        
        # 查找上月的考勤表
        prev_form = AttendanceForm.query.filter_by(
            employee_id=employee_id,
            contract_id=contract_id,
            cycle_start_date=prev_month_start
        ).first()
        
        if not prev_form or not prev_form.form_data:
            return {
                'has_continuation': False,
                'continuation_type': None,
                'previous_end_date': None,
                'total_days_before': 0
            }
        
        form_data = prev_form.form_data
        
        # 检查出京记录
        out_of_beijing_records = form_data.get('out_of_beijing_records', [])
        for record in out_of_beijing_records:
            record_date = record.get('date')
            days_offset = record.get('daysOffset', 0)
            if record_date and days_offset >= 0:
                # 计算记录的结束日期
                start_date = datetime.strptime(record_date, '%Y-%m-%d').date()
                end_date = start_date + timedelta(days=days_offset)
                
                # 如果记录的结束日期是上月最后一天，说明延续到本月
                if end_date == prev_month_end:
                    return {
                        'has_continuation': True,
                        'continuation_type': 'out_of_beijing',
                        'previous_end_date': end_date.isoformat(),
                        'previous_start_date': start_date.isoformat(),
                        'total_days_before': days_offset + 1
                    }
        
        # 检查出境记录
        out_of_country_records = form_data.get('out_of_country_records', [])
        for record in out_of_country_records:
            record_date = record.get('date')
            days_offset = record.get('daysOffset', 0)
            if record_date and days_offset >= 0:
                # 计算记录的结束日期
                start_date = datetime.strptime(record_date, '%Y-%m-%d').date()
                end_date = start_date + timedelta(days=days_offset)
                
                # 如果记录的结束日期是上月最后一天，说明延续到本月
                if end_date == prev_month_end:
                    return {
                        'has_continuation': True,
                        'continuation_type': 'out_of_country',
                        'previous_end_date': end_date.isoformat(),
                        'previous_start_date': start_date.isoformat(),
                        'total_days_before': days_offset + 1
                    }
        
        return {
            'has_continuation': False,
            'continuation_type': None,
            'previous_end_date': None,
            'total_days_before': 0
        }
        
    except Exception as e:
        current_app.logger.error(f"检查上月出京/出境延续失败: {e}", exc_info=True)
        return {
            'has_continuation': False,
            'continuation_type': None,
            'previous_end_date': None,
            'total_days_before': 0
        }


def get_onboarding_time_info(employee_id, contract_id, current_cycle_start):
    """
    获取上户时间信息（用于下户时显示参考）
    
    查找逻辑：
    1. 先查找当前月份的考勤表中的上户记录
    2. 如果没有，查找之前月份的考勤表中的上户记录
    
    返回: {
        'has_onboarding': True/False,
        'onboarding_date': '2024-12-29',
        'onboarding_time': '09:00',
    }
    """
    try:
        if isinstance(current_cycle_start, datetime):
            current_cycle_start = current_cycle_start.date()
        
        # 查找所有该合同的考勤表，按时间倒序
        forms = AttendanceForm.query.filter_by(
            employee_id=employee_id,
            contract_id=contract_id
        ).order_by(AttendanceForm.cycle_start_date.desc()).all()
        
        for form in forms:
            if not form.form_data:
                continue
            
            onboarding_records = form.form_data.get('onboarding_records', [])
            if onboarding_records:
                # 取第一条上户记录
                record = onboarding_records[0]
                onboarding_date = record.get('date')
                onboarding_time = record.get('startTime')  # 上户时间存储在 startTime 中
                
                if onboarding_date and onboarding_time:
                    return {
                        'has_onboarding': True,
                        'onboarding_date': onboarding_date,
                        'onboarding_time': onboarding_time
                    }
        
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


def form_to_dict(form, effective_start_date=None, effective_end_date=None):
    # 生成客户签署链接
    client_sign_url = None
    if form.customer_signature_token:
        # 使用环境变量或默认值构建前端 URL（统一使用 FRONTEND_BASE_URL）
        frontend_url = os.getenv('FRONTEND_BASE_URL', 'http://localhost:5175')
        client_sign_url = f"{frontend_url}/attendance-sign/{form.customer_signature_token}"
    
    # 确定合同显示的起止日期
    # 如果传入了 effective_start_date (合并后的开始日期)，则使用它
    # 否则回退到合同本身的 start_date
    display_start_date = effective_start_date if effective_start_date else (form.contract.start_date if form.contract else None)
    display_end_date = effective_end_date if effective_end_date else (form.contract.end_date if form.contract else None)
    
    # 【家庭信息】获取同一家庭的所有客户信息
    family_customers = []
    if form.contract and form.contract.family_id:
        # 查找同一家庭的所有合同
        family_contracts = BaseContract.query.filter_by(
            service_personnel_id=form.employee_id,
            family_id=form.contract.family_id
        ).filter(
            BaseContract.status.in_(['active', 'terminated', 'finished', 'completed']),
            BaseContract.start_date <= form.cycle_end_date,
            BaseContract.end_date >= form.cycle_start_date
        ).all()
        
        # 收集所有客户名称（去重）
        customer_names_seen = set()
        for contract in family_contracts:
            if contract.customer_name and contract.customer_name not in customer_names_seen:
                family_customers.append({
                    "name": contract.customer_name,
                    "contract_id": str(contract.id)
                })
                customer_names_seen.add(contract.customer_name)
    
    # 如果没有家庭信息，使用单个合同的客户信息
    if not family_customers and form.contract:
        family_customers = [{
            "name": form.contract.customer_name,
            "contract_id": str(form.contract_id)
        }]

    return {
        "id": str(form.id),
        "contract_id": str(form.contract_id),
        "employee_id": str(form.employee_id),
        "year": form.cycle_start_date.year if form.cycle_start_date else None,
        "month": form.cycle_start_date.month if form.cycle_start_date else None,
        "cycle_start_date": form.cycle_start_date.isoformat(),
        "cycle_end_date": form.cycle_end_date.isoformat(),
        "form_data": form.form_data,
        "status": form.status,
        "employee_access_token": form.employee_access_token,
        "customer_signature_token": form.customer_signature_token,
        "client_sign_url": client_sign_url,  # 添加客户签署链接
        "customer_signed_at": form.customer_signed_at.isoformat() if form.customer_signed_at else None,
        "signature_data": form.signature_data, # Explicitly include signature_data column
        "created_at": form.created_at.isoformat(),
        "contract_info": {
            "customer_name": form.contract.customer_name if form.contract else "",
            "employee_name": form.contract.service_personnel.name if form.contract and form.contract.service_personnel else "",
            "start_date": display_start_date.isoformat() if display_start_date else None,
            "end_date": display_end_date.isoformat() if display_end_date else None,
            # 合同状态和类型信息（用于判断最后一个月）
            "status": form.contract.status if form.contract else None,
            "type": form.contract.type if form.contract else None,
            "termination_date": form.contract.termination_date.isoformat() if form.contract and form.contract.termination_date else None,
            # 是否为自动月签合同（NannyContract 特有字段）
            "is_monthly_auto_renew": getattr(form.contract, 'is_monthly_auto_renew', False) if form.contract else False,
        },
        # 【家庭信息】
        "family_info": {
            "customers": family_customers
        } if family_customers else None,
        # 【上月出京/出境延续信息】用于判断本月出京/出境是否需要满30天
        "previous_month_continuation": check_previous_month_out_of_beijing(
            form.employee_id, 
            form.contract_id, 
            form.cycle_start_date
        ) if form.cycle_start_date else None,
        # 【上户时间信息】用于下户时显示参考
        "onboarding_time_info": get_onboarding_time_info(
            form.employee_id,
            form.contract_id,
            form.cycle_start_date
        ) if form.cycle_start_date else None
    }

@attendance_form_bp.route('/monthly-list', methods=['GET'])
def get_monthly_attendance_list():
    """
    获取指定月份的考勤列表
    查询参数:
        year: 年份 (必需)
        month: 月份 1-12 (必需)
    """
    try:
        year = request.args.get('year', type=int)
        month = request.args.get('month', type=int)
        
        if not year or not month:
            return jsonify({"error": "年份和月份参数是必需的"}), 400
        
        if month < 1 or month > 12:
            return jsonify({"error": "月份必须在1-12之间"}), 400
        
        # 计算指定月份的起止日期
        month_start = date(year, month, 1)
        # 获取该月的最后一天
        last_day = calendar.monthrange(year, month)[1]
        month_end = date(year, month, last_day)
        
        from sqlalchemy import or_, and_

        # 查找所有活跃、已完成或已终止的合同，且合同有效期与指定月份有交集
        # 注意：
        # 1. 对于已终止合同，使用 termination_date 作为结束时间
        # 2. 对于月签合同（is_monthly_auto_renew=True），如果状态是 active，则忽略 end_date 限制
        contracts = BaseContract.query.filter(
            BaseContract.status.in_(['active', 'terminated', 'finished', 'completed']),
            BaseContract.start_date <= month_end,
            or_(
                # 情况1: 月签合同且状态为 active，不检查 end_date（会自动续约）
                and_(
                    BaseContract.type == 'nanny',
                    NannyContract.is_monthly_auto_renew == True,
                    BaseContract.status == 'active'
                ),
                # 情况2: 没有终止日期，使用 end_date 判断
                and_(BaseContract.termination_date.is_(None), BaseContract.end_date >= month_start),
                # 情况3: 有终止日期，使用 termination_date 判断
                and_(BaseContract.termination_date.isnot(None), BaseContract.termination_date >= month_start)
            )
        ).order_by(BaseContract.service_personnel_id).all()
        
        result_items = []
        frontend_base_url = os.getenv('FRONTEND_BASE_URL', 'http://localhost:5175')
        
        # Group contracts by (employee_id, customer_id) to merge consecutive contracts
        grouped_contracts = {}
        for contract in contracts:
            if not contract.service_personnel:
                continue
            # Use customer_id as key, fallback to customer_name if id is missing (though less reliable)
            key = (contract.service_personnel_id, contract.customer_id or contract.customer_name)
            if key not in grouped_contracts:
                grouped_contracts[key] = []
            grouped_contracts[key].append(contract)

        result_items = []
        frontend_base_url = os.getenv('FRONTEND_BASE_URL', 'http://localhost:5175')
        
        for key, group in grouped_contracts.items():
            # Sort group by start_date
            group.sort(key=lambda c: c.start_date)
            
            # Determine primary contract (prefer active, else latest)
            primary_contract = next((c for c in group if c.status == 'active'), group[-1])
            employee = primary_contract.service_personnel
            
            # Calculate merged date range
            min_start_date = group[0].start_date
            # For end date, use the max of end_date (or termination_date if terminated)
            max_end_date = group[-1].end_date
            if group[-1].status in ['terminated', 'finished'] and group[-1].termination_date:
                 max_end_date = group[-1].termination_date

            # Find attendance form for this specific contract group
            # Look for forms linked to any contract in this group
            contract_ids = [str(c.id) for c in group]
            form = AttendanceForm.query.filter(
                AttendanceForm.employee_id == employee.id,
                AttendanceForm.contract_id.in_(contract_ids),
                AttendanceForm.cycle_start_date <= month_end,
                AttendanceForm.cycle_end_date >= month_start
            ).order_by(AttendanceForm.created_at.desc()).first()
            
            # Determine status and tokens
            if not form:
                form_status = "not_created"
                form_id = None
                customer_signed_at = None
                has_data = False
                # Use primary contract's employee ID as fallback token
                employee_access_token = employee.id 
            else:
                if form.customer_signed_at:
                    form_status = "customer_signed"
                elif form.status in ['confirmed', 'employee_confirmed']:
                    form_status = "confirmed"
                else:
                    form_status = "draft"
                form_id = str(form.id)
                customer_signed_at = form.customer_signed_at.isoformat() if form.customer_signed_at else None
                employee_access_token = form.employee_access_token
                
                # 检查是否有实际的考勤数据（排除自动生成的上户/下户记录）
                has_data = False
                if form.form_data:
                    for key, records in form.form_data.items():
                        if key.endswith('_records') and isinstance(records, list):
                            for record in records:
                                # 上户/下户记录如果没有填写时间，不算有数据
                                if record.get('type') in ['onboarding', 'offboarding']:
                                    if record.get('startTime') or record.get('endTime'):
                                        has_data = True
                                        break
                                else:
                                    # 其他类型的记录都算有数据
                                    has_data = True
                                    break
                        if has_data:
                            break
            
            # Generate access link - use fixed employee URL without year/month parameters
            access_link = f"{frontend_base_url}/attendance/{employee.id}"
            
            item = {
                "employee_id": str(employee.id),
                "employee_name": employee.name,
                "employee_name_pinyin": employee.name_pinyin or "",
                "customer_name": primary_contract.customer_name,
                "customer_name_pinyin": primary_contract.customer_name_pinyin or "",
                # Show merged date range
                "contract_start_date": min_start_date.isoformat() if min_start_date else None,
                "contract_end_date": max_end_date.isoformat() if max_end_date else None,
                "form_status": form_status,
                "has_data": has_data,  # 是否有实际考勤数据
                "employee_access_token": str(employee_access_token),
                "access_link": access_link,
                "form_id": form_id,
                "customer_signed_at": customer_signed_at,
                "contract_id": str(primary_contract.id)
            }
            
            result_items.append(item)
        
        return jsonify({
            "items": result_items,
            "total": len(result_items),
            "year": year,
            "month": month
        })
        
    except Exception as e:
        current_app.logger.error(f"获取月度考勤列表失败: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

from weasyprint import HTML

@attendance_form_bp.route('/download/<form_id>', methods=['GET'])
def download_attendance_pdf(form_id):
    """下载考勤表 PDF"""
    try:
        form = AttendanceForm.query.get(form_id)
        if not form:
            return jsonify({"error": "考勤表不存在"}), 404

        # 准备数据
        contract = BaseContract.query.get(form.contract_id)
        employee = form.contract.service_personnel
        
        # 解析考勤数据
        attendance_data = form.form_data or {}
        
        # 计算统计数据
        stats = _calculate_pdf_stats(attendance_data, form.cycle_start_date, form.cycle_end_date)
        
        # 准备日历数据
        calendar_weeks = _prepare_calendar_data(attendance_data, form.cycle_start_date, form.cycle_end_date)
        
        # 准备特殊记录列表
        special_records = _prepare_special_records(attendance_data)
        
        # 渲染 HTML
        html = render_template(
            'attendance_pdf.html',
            year=form.cycle_start_date.year,
            month=form.cycle_start_date.month,
            customer_name=contract.customer_name,
            employee_name=employee.name,
            total_work_days=stats['work_days'],
            total_leave_days=stats['leave_days'],
            total_overtime_days=stats['overtime_days'],
            calendar_weeks=calendar_weeks,
            special_records=special_records,
            signature_url=form.signature_data.get('image') if form.signature_data and isinstance(form.signature_data, dict) else None,
            signed_at=form.customer_signed_at.strftime('%Y-%m-%d %H:%M') if form.customer_signed_at else None
        )
        
        # 生成 PDF (参考 contract_api.py 的实现)
        pdf = HTML(string=html, base_url=request.url_root).write_pdf()
            
        response = make_response(pdf)
        response.headers['Content-Type'] = 'application/pdf'
        filename = f"attendance_{employee.name}_{form.cycle_start_date.year}_{form.cycle_start_date.month}.pdf"
        # 使用 quote 处理中文文件名
        from urllib.parse import quote
        response.headers['Content-Disposition'] = f'attachment; filename="{quote(filename)}"; filename*=UTF-8\'\'{quote(filename)}'
        
        return response

    except Exception as e:
        current_app.logger.error(f"生成PDF失败: {e}", exc_info=True)
        return jsonify({"error": "生成PDF失败"}), 500

def _calculate_pdf_stats(data, start_date, end_date):
    """计算 PDF 用的统计数据"""
    total_leave = 0
    total_overtime = 0
    
    # 【关键】假期（rest/leave）也算出勤，不需要计算请假天数
    # 这里的 total_leave 只是用于显示，不影响出勤计算
    for key in ['rest_records', 'leave_records']:
        for record in data.get(key, []):
            hours = (record.get('hours', 0)) + (record.get('minutes', 0) / 60)
            total_leave += hours / 24
    
    # 【修复】计算加班天数，区分假期加班和正常加班
    holiday_overtime = 0
    normal_overtime = 0
    
    for record in data.get('overtime_records', []):
        hours = (record.get('hours', 0)) + (record.get('minutes', 0) / 60)
        overtime_days = hours / 24
        
        # 检查该日期是否有休息或请假记录
        overtime_date = record.get('date')
        is_holiday_overtime = False
        
        for key in ['rest_records', 'leave_records']:
            for other_record in data.get(key, []):
                if other_record.get('date') == overtime_date:
                    is_holiday_overtime = True
                    break
            if is_holiday_overtime:
                break
        
        if is_holiday_overtime:
            holiday_overtime += overtime_days
        else:
            normal_overtime += overtime_days
    
    total_overtime = holiday_overtime + normal_overtime
    
    # 【关键修复】计算出勤天数
    # 假期也算出勤，不扣除！只扣除正常加班天数
    # 公式：出勤天数 = 当月总天数 - 正常加班天数
    days_count = (end_date - start_date).days + 1
    total_work = days_count - normal_overtime
    
    return {
        'work_days': total_work,
        'leave_days': total_leave,
        'overtime_days': total_overtime
    }

def _prepare_calendar_data(data, start_date, end_date):
    """准备日历数据结构"""
    import calendar
    
    year = start_date.year
    month = start_date.month
    
    # 获取当月日历矩阵 (0 为填充)
    cal = calendar.monthcalendar(year, month)
    
    weeks = []
    
    # 考勤类型映射
    TYPE_LABELS = {
        'normal': '出勤', 'rest': '休息', 'leave': '请假', 
        'overtime': '加班', 'out_of_beijing': '出京', 
        'out_of_country': '出境', 'paid_leave': '带薪假',
        'onboarding': '上户', 'offboarding': '下户'
    }
    
    for week_row in cal:
        week_data = []
        for day in week_row:
            if day == 0:
                week_data.append(None)
                continue
                
            current_date = date(year, month, day)
            # 检查是否在考勤周期内
            if current_date < start_date.date() or current_date > end_date.date():
                week_data.append(None) # 或者显示为禁用状态
                continue
                
            # 查找当日记录
            record_info = {'type': 'normal', 'label': '出勤', 'duration': ''}
            
            # 遍历数据查找记录 (简化版，未处理跨天的一致性，假设数据结构一致)
            # 前端逻辑是遍历所有 records 判断日期覆盖
            # 这里简化处理：
            found = False
            for key, records in data.items():
                if not key.endswith('_records') or not isinstance(records, list):
                    continue
                    
                record_type = key.replace('_records', '')
                if record_type == 'normal': continue
                
                for rec in records:
                    rec_date = datetime.strptime(rec['date'], '%Y-%m-%d').date()
                    days_offset = int(rec.get('daysOffset', 0))
                    hours = float(rec.get('hours', 0))
                    if days_offset == 0 and hours >= 24:
                        days_offset = int(hours / 24)
                    rec_end_date = rec_date + timedelta(days=days_offset)
                    
                    if rec_date <= current_date <= rec_end_date:
                        record_info['type'] = record_type
                        record_info['label'] = TYPE_LABELS.get(record_type, record_type)
                        
                        if record_type in ['onboarding', 'offboarding']:
                            record_info['duration'] = rec.get('startTime', '')
                        else:
                            # Calculate daily hours
                            if rec_date == rec_end_date:
                                display_hours = float(rec.get('hours', 0))
                            else:
                                start_dt = datetime.strptime(rec.get('startTime', '09:00'), '%H:%M')
                                end_dt = datetime.strptime(rec.get('endTime', '18:00'), '%H:%M')
                                start_hour = start_dt.hour + start_dt.minute / 60.0
                                end_hour = end_dt.hour + end_dt.minute / 60.0
                                
                                if current_date == rec_date:
                                    display_hours = 24.0 - start_hour
                                elif current_date == rec_end_date:
                                    display_hours = end_hour
                                else:
                                    display_hours = 24.0
                            
                            if display_hours >= 24:
                                record_info['duration'] = "24h"
                            else:
                                if display_hours.is_integer():
                                    record_info['duration'] = f"{int(display_hours)}h"
                                else:
                                    record_info['duration'] = f"{display_hours:.1f}h"
                        found = True
                        break
                if found: break
            
            week_data.append({
                'day': day,
                'is_weekend': current_date.weekday() >= 5,
                'record': record_info
            })
        weeks.append(week_data)
        
    return weeks

def _prepare_special_records(data):
    """准备特殊记录列表"""
    records_list = []
    TYPE_LABELS = {
        'normal': '出勤', 'rest': '休息', 'leave': '请假', 
        'overtime': '加班', 'out_of_beijing': '出京', 
        'out_of_country': '出境', 'paid_leave': '带薪假',
        'onboarding': '上户', 'offboarding': '下户'
    }
    
    for key, records in data.items():
        if not key.endswith('_records') or not isinstance(records, list):
            continue
            
        record_type = key.replace('_records', '')
        if record_type == 'normal': continue
        
        for rec in records:
            label = TYPE_LABELS.get(record_type, record_type)
            date_str = rec['date']
            
            # 格式化时间范围
            days_offset = int(rec.get('daysOffset', 0))
            hours = float(rec.get('hours', 0))
            if days_offset == 0 and hours >= 24:
                days_offset = int(hours / 24)
                
            if days_offset > 0:
                end_date = datetime.strptime(date_str, '%Y-%m-%d') + timedelta(days=days_offset)
                time_range = f"{rec.get('startTime', '09:00')} ~ {end_date.month}月{end_date.day}日 {rec.get('endTime', '18:00')}"
            else:
                time_range = f"{rec.get('startTime', '09:00')} ~ {rec.get('endTime', '18:00')}"
                
            hours = float(rec.get('hours', 0))
            minutes = float(rec.get('minutes', 0))
            total_hours = hours + minutes / 60.0
            
            if total_hours >= 24:
                days = total_hours / 24.0
                duration = f"{days:.3f}天"
            else:
                # 保持与前端一致：显示两位小数的小时数
                duration = f"{total_hours:.2f}小时"
                
            # Calculate date details
            date_obj = datetime.strptime(date_str, '%Y-%m-%d')
            day = date_obj.day
            weekday_map = {0: '周一', 1: '周二', 2: '周三', 3: '周四', 4: '周五', 5: '周六', 6: '周日'}
            weekday_str = weekday_map.get(date_obj.weekday(), '')
            formatted_date = f"{date_obj.month}月{date_obj.day}日"
            
            records_list.append({
                'date_str': date_str, # Keep full date string for sorting/display if needed
                'formatted_date': formatted_date,
                'day': day,
                'weekday_str': weekday_str,
                'label': label,
                'type': record_type, # Pass raw type for CSS classes
                'time_range': time_range,
                'duration': duration
            })
            
    # 按日期排序
    records_list.sort(key=lambda x: x['date_str'])
    return records_list

# 智能路由API - 根据员工token返回考勤表选择信息
@attendance_form_bp.route('/<employee_token>', methods=['GET'])
def get_employee_attendance_forms(employee_token):
    """
    智能路由API：根据员工token获取该员工的考勤表列表
    如果只有一个考勤表，返回single类型直接跳转
    如果有多个考勤表，返回multiple类型显示选择页面
    """
    try:
        # 获取年月参数，如果没有提供则使用当前月份
        year = request.args.get('year', type=int)
        month = request.args.get('month', type=int)
        
        if year and month:
            from calendar import monthrange
            last_day = monthrange(year, month)[1]
            cycle_start = date(year, month, 1)
            cycle_end = date(year, month, last_day)
        else:
            # 默认使用上个月（考勤通常是填写上个月的）
            now = date.today()
            from calendar import monthrange
            # 计算上个月
            if now.month == 1:
                last_month_year = now.year - 1
                last_month = 12
            else:
                last_month_year = now.year
                last_month = now.month - 1
            last_day = monthrange(last_month_year, last_month)[1]
            cycle_start = date(last_month_year, last_month, 1)
            cycle_end = date(last_month_year, last_month, last_day)
        
        # 查找员工
        employee = None
        try:
            employee_id = uuid.UUID(employee_token)
            employee = ServicePersonnel.query.get(employee_id)
        except ValueError:
            pass
            
        if not employee:
            return jsonify({"error": "无效的访问令牌"}), 404
        
        # 查找该员工在指定月份的所有考勤表
        # 1. 先找到该员工在该月份的所有合同（使用统一的过滤函数）
        contracts = filter_contracts_for_cycle(employee_id, cycle_start, cycle_end)
        
        if not contracts:
            # 如果上个月没有合同，检查是否有当月开始的合同
            now = date.today()
            current_month_start = date(now.year, now.month, 1)
            current_month_end = date(now.year, now.month, monthrange(now.year, now.month)[1])
            
            current_month_contracts = filter_contracts_for_cycle(employee_id, current_month_start, current_month_end)
            
            if current_month_contracts:
                # 有当月的合同，切换到当月
                cycle_start = current_month_start
                cycle_end = current_month_end
                contracts = current_month_contracts
            else:
                return jsonify({
                    "redirect_type": "none",
                    "employee_name": employee.name,
                    "message": "该月份没有有效合同"
                })
        else:
            # 上个月有合同，但还需要检查是否有合同在当月结束（且没有续约）
            # 如果有合同在当月结束且没有续约，优先显示当月
            now = date.today()
            current_month_start = date(now.year, now.month, 1)
            current_month_end = date(now.year, now.month, monthrange(now.year, now.month)[1])
            
            should_switch_to_current_month = False
            for contract in contracts:
                # 获取合同结束日期（对于已终止合同使用终止日期）
                end_date = contract.termination_date if contract.termination_date else contract.end_date
                if end_date and end_date.year == now.year and end_date.month == now.month:
                    # 检查是否有续约合同，如果有则不算"当月下户"
                    if not has_following_contract(contract):
                        should_switch_to_current_month = True
                        current_app.logger.info(f"合同 {contract.id} 在当月结束（无续约），切换到当月")
                        break
            
            if should_switch_to_current_month:
                # 合同在当月结束且没有续约，切换到当月（使用统一的过滤函数）
                current_month_contracts = filter_contracts_for_cycle(employee_id, current_month_start, current_month_end)
                
                if current_month_contracts:
                    cycle_start = current_month_start
                    cycle_end = current_month_end
                    contracts = current_month_contracts
        
        # 2. 按家庭ID分组合同，同一客户的多个合同（如续签）合并为一个考勤表
        family_groups = {}
        for contract in contracts:
            if contract.family_id:
                family_key = f"family_{contract.family_id}"
            else:
                family_key = f"customer_{contract.customer_name}"
            
            if family_key not in family_groups:
                family_groups[family_key] = []
            family_groups[family_key].append(contract)
        
        # 3. 为每个家庭组生成或查找考勤表
        attendance_forms = []
        
        for family_key, family_contracts in family_groups.items():
            # 选择主合同（优先active，否则选最新的）
            primary_contract = next(
                (c for c in family_contracts if c.status == 'active'), 
                max(family_contracts, key=lambda x: x.start_date)
            )
            
            # 查找该员工在该月份该合同的考勤表
            existing_form = AttendanceForm.query.filter(
                AttendanceForm.employee_id == employee_id,
                AttendanceForm.cycle_start_date == cycle_start,
                AttendanceForm.contract_id == primary_contract.id
            ).first()
            
            if not existing_form:
                # 创建新的考勤表 - access_token 使用纯员工ID（固定，不包含年月）
                access_token = str(employee_id)
                signature_token = str(uuid.uuid4())
                
                new_form = AttendanceForm(
                    employee_id=employee_id,
                    contract_id=primary_contract.id,
                    cycle_start_date=cycle_start,
                    cycle_end_date=cycle_end,
                    employee_access_token=access_token,
                    customer_signature_token=signature_token,
                    status='draft'
                )
                db.session.add(new_form)
                db.session.flush()
                existing_form = new_form
            
            # 收集家庭客户名称
            family_customers = []
            customer_names_seen = set()
            for contract in family_contracts:
                if contract.customer_name and contract.customer_name not in customer_names_seen:
                    family_customers.append(contract.customer_name)
                    customer_names_seen.add(contract.customer_name)
            
            # 计算服务期间（合并所有合同的日期范围）
            service_start = min(c.start_date for c in family_contracts)
            service_end = max(c.end_date for c in family_contracts)
            
            attendance_forms.append({
                "form_id": str(existing_form.id),
                "form_token": existing_form.employee_access_token,
                "contract_id": str(primary_contract.id),
                "family_customers": family_customers,
                "service_period": f"{service_start.isoformat()} to {service_end.isoformat()}",
                "status": existing_form.status,
                "client_sign_url": f"/attendance-sign/{existing_form.customer_signature_token}" if existing_form.customer_signature_token else None
            })
        
        db.session.commit()
        
        # 4. 根据考勤表数量返回不同的响应
        if len(attendance_forms) == 1:
            return jsonify({
                "redirect_type": "single",
                "employee_name": employee.name,
                "data": {
                    # 使用员工ID作为跳转token，不使用考勤表的access_token（可能包含年月）
                    "form_token": str(employee_id),
                    "year": cycle_start.year,
                    "month": cycle_start.month
                }
            })
        elif len(attendance_forms) > 1:
            return jsonify({
                "redirect_type": "multiple",
                "employee_name": employee.name,
                "data": {
                    "forms": attendance_forms
                }
            })
        else:
            return jsonify({
                "redirect_type": "none",
                "employee_name": employee.name,
                "message": "没有找到有效的考勤表"
            })
            
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"获取员工考勤表列表失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

# 新增API端点：获取考勤表详情用于查看
@attendance_form_bp.route('/records/<record_id>/form', methods=['GET'])
def get_attendance_form_by_record(record_id):
    """通过考勤记录ID获取考勤表详情"""
    try:
        # 查找考勤记录
        attendance_record = AttendanceRecord.query.get(record_id)
        if not attendance_record:
            return jsonify({"error": "考勤记录不存在"}), 404
        
        # 查找关联的考勤表
        attendance_form = None
        if attendance_record.attendance_form_id:
            attendance_form = AttendanceForm.query.get(attendance_record.attendance_form_id)
        
        if not attendance_form:
            return jsonify({"error": "未找到关联的考勤表"}), 404
        
        # 获取员工和合同信息
        employee = ServicePersonnel.query.get(attendance_form.employee_id)
        contract = BaseContract.query.get(attendance_form.contract_id)
        
        # 构建返回数据
        form_data = {
            "id": str(attendance_form.id),
            "employee_id": str(attendance_form.employee_id),
            "employee_name": employee.name if employee else "未知员工",
            "contract_id": str(attendance_form.contract_id),
            "customer_name": contract.customer_name if contract else "未知客户",
            "year": attendance_form.cycle_start_date.year if attendance_form.cycle_start_date else None,
            "month": attendance_form.cycle_start_date.month if attendance_form.cycle_start_date else None,
            "cycle_start_date": attendance_form.cycle_start_date.isoformat() if attendance_form.cycle_start_date else None,
            "cycle_end_date": attendance_form.cycle_end_date.isoformat() if attendance_form.cycle_end_date else None,
            "attendance_details": attendance_form.form_data or {},
            "customer_signature": attendance_form.signature_data.get('signature_image') if attendance_form.signature_data else None,
            "submitted_at": attendance_form.customer_signed_at.isoformat() if attendance_form.customer_signed_at else None,
            "is_submitted": attendance_form.status in ['customer_signed', 'synced'],
            "status": attendance_form.status,
            "form_type": "merged" if contract and contract.family_id else "single"
        }
        
        return jsonify(form_data)
        
    except Exception as e:
        current_app.logger.error(f"获取考勤表详情失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

@attendance_form_bp.route('/by-contract', methods=['GET'])
def get_attendance_form_by_contract():
    """通过合同ID和员工ID获取考勤表详情"""
    try:
        contract_id = request.args.get('contract_id')
        employee_id = request.args.get('employee_id')
        cycle_start = request.args.get('cycle_start')
        cycle_end = request.args.get('cycle_end')
        
        if not contract_id or not employee_id:
            return jsonify({"error": "缺少必要参数"}), 400
        
        # 如果提供了周期日期，使用它们；否则使用上个月
        if cycle_start and cycle_end:
            try:
                cycle_start_date = datetime.strptime(cycle_start, '%Y-%m-%d').date()
                cycle_end_date = datetime.strptime(cycle_end, '%Y-%m-%d').date()
            except ValueError:
                return jsonify({"error": "日期格式错误"}), 400
        else:
            cycle_start_date, cycle_end_date = calculate_last_month_cycle()
        
        # 查找考勤表 - 使用cycle_start_date进行查找
        attendance_form = AttendanceForm.query.filter(
            AttendanceForm.employee_id == employee_id,
            AttendanceForm.contract_id == contract_id,
            AttendanceForm.cycle_start_date >= datetime.combine(cycle_start_date, datetime.min.time()),
            AttendanceForm.cycle_start_date < datetime.combine(cycle_start_date + timedelta(days=32), datetime.min.time())
        ).first()
        
        if not attendance_form:
            return jsonify({"error": "未找到考勤表"}), 404
        
        # 获取员工和合同信息
        employee = ServicePersonnel.query.get(employee_id)
        contract = BaseContract.query.get(contract_id)
        
        # 构建返回数据
        form_data = {
            "id": str(attendance_form.id),
            "employee_id": str(attendance_form.employee_id),
            "employee_name": employee.name if employee else "未知员工",
            "contract_id": str(attendance_form.contract_id),
            "customer_name": contract.customer_name if contract else "未知客户",
            "year": attendance_form.cycle_start_date.year if attendance_form.cycle_start_date else None,
            "month": attendance_form.cycle_start_date.month if attendance_form.cycle_start_date else None,
            "cycle_start_date": attendance_form.cycle_start_date.isoformat() if attendance_form.cycle_start_date else None,
            "cycle_end_date": attendance_form.cycle_end_date.isoformat() if attendance_form.cycle_end_date else None,
            "attendance_details": attendance_form.form_data or {},
            "customer_signature": attendance_form.signature_data.get('signature_image') if attendance_form.signature_data else None,
            "submitted_at": attendance_form.customer_signed_at.isoformat() if attendance_form.customer_signed_at else None,
            "is_submitted": attendance_form.status in ['customer_signed', 'synced'],
            "status": attendance_form.status,
            "form_type": "merged" if contract and contract.family_id else "single"
        }
        
        return jsonify(form_data)
        
    except Exception as e:
        current_app.logger.error(f"获取考勤表详情失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500