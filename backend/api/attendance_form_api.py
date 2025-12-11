from flask import Blueprint, jsonify, request, current_app, render_template, make_response
from backend.models import db, AttendanceForm, BaseContract, ServicePersonnel, AttendanceRecord
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

def find_consecutive_contracts(employee_id, cycle_start, cycle_end):
    """
    查找指定周期内，同一员工同一家庭的连续合同链（支持家庭合并）
    返回: (primary_contract, effective_start_date, effective_end_date)
    primary_contract: 用于关联考勤表的合同（通常是最新的那个）
    """
    current_app.logger.info(f"🔍 查找员工 {employee_id} 在周期 {cycle_start} 到 {cycle_end} 的合同")
    
    # 1. 查找该员工在周期内所有活跃或已终止/完成的合同
    # 只要合同时间段与考勤周期有交集即可
    contracts = BaseContract.query.filter(
        BaseContract.service_personnel_id == employee_id,
        BaseContract.status.in_(['active', 'terminated', 'finished', 'completed']),
        BaseContract.start_date <= cycle_end,
        BaseContract.end_date >= cycle_start
    ).order_by(BaseContract.start_date.desc()).all()

    current_app.logger.info(f"📋 找到 {len(contracts)} 个符合条件的合同")
    for c in contracts:
        current_app.logger.info(f"  - 合同 {c.id}: {c.start_date} 到 {c.end_date}, family_id={c.family_id}, status={c.status}")

    if not contracts:
        return None, None, None

    # 2. 找到最新的合同作为"主合同" (primary_contract)
    # 优先选 active 的，如果没有 active 则选最近的一个
    primary_contract = next((c for c in contracts if c.status == 'active'), contracts[0])
    current_app.logger.info(f"🎯 选择主合同: {primary_contract.id}, family_id={primary_contract.family_id}")
    
    # 3. 【家庭合并逻辑】找到与主合同属于同一家庭的所有合同
    # 优先使用family_id，如果没有则使用customer_id或customer_name
    family_contracts = []
    
    if primary_contract.family_id:
        # 优先：如果主合同有family_id，按family_id合并
        family_contracts = [
            c for c in contracts 
            if c.family_id == primary_contract.family_id
        ]
        current_app.logger.info(f"按family_id合并: {primary_contract.family_id}, 找到 {len(family_contracts)} 个合同")
    elif primary_contract.customer_id:
        # 回退1：按customer_id合并
        family_contracts = [
            c for c in contracts 
            if c.customer_id == primary_contract.customer_id
        ]
        current_app.logger.info(f"按customer_id合并: {primary_contract.customer_id}, 找到 {len(family_contracts)} 个合同")
    else:
        # 回退2：按customer_name合并
        family_contracts = [
            c for c in contracts 
            if c.customer_name == primary_contract.customer_name 
        ]
        current_app.logger.info(f"按customer_name合并: {primary_contract.customer_name}, 找到 {len(family_contracts)} 个合同")

    # 4. 计算有效日期范围 (合并这些合同的时间段)
    # 取最早的开始时间和最晚的结束时间
    effective_start = min(c.start_date for c in family_contracts)
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
    1. 通过考勤表ID直接查找（UUID格式）
    2. 通过 employee_access_token 查找
    3. 通过员工ID + 年月参数查找
    """
    try:
        # 1. 首先尝试通过考勤表ID直接查找
        try:
            form_id = uuid.UUID(employee_token)
            existing_form = AttendanceForm.query.get(form_id)
            if existing_form:
                # 直接使用考勤表关联的合同日期，而不是查找所有合同
                contract = existing_form.contract
                effective_start = contract.start_date if contract else None
                effective_end = contract.end_date if contract else None
                result = form_to_dict(existing_form, effective_start, effective_end)
                return jsonify(result)
        except ValueError:
            pass
        
        # 2. 尝试通过 employee_access_token 直接查找考勤表
        existing_form = AttendanceForm.query.filter_by(
            employee_access_token=employee_token
        ).first()
        
        if existing_form:
            # 直接使用考勤表关联的合同日期
            contract = existing_form.contract
            effective_start = contract.start_date if contract else None
            effective_end = contract.end_date if contract else None
            result = form_to_dict(existing_form, effective_start, effective_end)
            return jsonify(result)
        
        # 3. 尝试解析 token 获取员工ID
        parts = employee_token.split('_')
        if len(parts) >= 1:
            employee_id_str = parts[0]
        else:
            return jsonify({"error": "无效的访问令牌"}), 404
        
        # 读取 year/month 参数，或从 token 中解析
        year = request.args.get('year', type=int)
        month = request.args.get('month', type=int)
        
        # 如果 token 中包含年月信息，优先使用
        if len(parts) >= 3:
            try:
                year = int(parts[1])
                month = int(parts[2])
            except ValueError:
                pass
        
        print(f"[DEBUG] Received year={year}, month={month}")
        
        if year and month:
            from calendar import monthrange
            last_day = monthrange(year, month)[1]
            cycle_start = date(year, month, 1)
            cycle_end = date(year, month, last_day)
        else:
            cycle_start, cycle_end = calculate_last_month_cycle()
        
        # 4. 查找员工
        employee = None
        try:
            employee_id = uuid.UUID(employee_id_str)
            employee = ServicePersonnel.query.get(employee_id)
        except ValueError:
            pass
            
        if not employee:
            return jsonify({"error": "无效的访问令牌"}), 404

        # 3. 查找合同 (支持连续合同合并)
        contract, effective_start, effective_end = find_consecutive_contracts(employee.id, cycle_start, cycle_end)
        
        if not contract:
            return jsonify({"error": "未找到该员工的合同"}), 404
        
        # 4. 检查是否已经存在该员工该周期的表单 (按 employee_id 查询，更可靠)
        existing_form = AttendanceForm.query.filter_by(
            employee_id=employee.id,
            cycle_start_date=cycle_start
        ).first()
        
        if existing_form:
            # 更新合同 ID（可能合同续签了，或者变成了新合同）
            if existing_form.contract_id != contract.id:
                existing_form.contract_id = contract.id
                db.session.commit()
            
            # 重新计算有效日期范围，确保家庭合并逻辑生效
            result = form_to_dict(existing_form, effective_start, effective_end)
            return jsonify(result)

        # 5. 创建新表单 - 使用唯一的 access_token（加上月份信息）
        unique_token = f"{employee_token}_{cycle_start.year}_{cycle_start.month:02d}"
        new_form = AttendanceForm(
            contract_id=contract.id,
            employee_id=employee.id,
            cycle_start_date=cycle_start,
            cycle_end_date=cycle_end,
            employee_access_token=unique_token,
            form_data={},
            status='draft'
        )
        db.session.add(new_form)
        db.session.commit()
        
        result = form_to_dict(new_form, effective_start, effective_end)
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
            
        # 直接使用考勤表关联的合同日期，而不是查找所有合同
        contract = form.contract
        effective_start = contract.start_date if contract else None
        effective_end = contract.end_date if contract else None

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
        } if family_customers else None
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
        # 注意：对于已终止合同，使用 termination_date 作为结束时间
        contracts = BaseContract.query.filter(
            BaseContract.status.in_(['active', 'terminated', 'finished', 'completed']),
            BaseContract.start_date <= month_end,
            or_(
                # 情况1: 没有终止日期，使用 end_date 判断
                and_(BaseContract.termination_date.is_(None), BaseContract.end_date >= month_start),
                # 情况2: 有终止日期，使用 termination_date 判断
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
            
            # Generate access link - use fixed employee URL without year/month parameters
            access_link = f"{frontend_base_url}/attendance/{employee.id}"
            
            item = {
                "employee_id": str(employee.id),
                "employee_name": employee.name,
                "customer_name": primary_contract.customer_name,
                # Show merged date range
                "contract_start_date": min_start_date.isoformat() if min_start_date else None,
                "contract_end_date": max_end_date.isoformat() if max_end_date else None,
                "form_status": form_status,
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
    
    # 计算请假天数
    for key in ['rest_records', 'leave_records', 'paid_leave_records']:
        for record in data.get(key, []):
            hours = (record.get('hours', 0)) + (record.get('minutes', 0) / 60)
            total_leave += hours / 24
            
    # 计算加班天数
    for record in data.get('overtime_records', []):
        hours = (record.get('hours', 0)) + (record.get('minutes', 0) / 60)
        total_overtime += hours / 24
        
    # 计算总天数 (简单计算，不扣除周末，因为前端逻辑比较复杂，这里简化处理或需完全复刻前端逻辑)
    # 为了准确，我们应该遍历每一天判断是否禁用
    # 这里简化：总天数 - 请假 - 加班 (前端逻辑是 validDays - leave - overtime)
    # 假设 validDays 是当月所有天数 (不考虑合同外的日期，因为 PDF 是针对考勤表的，考勤表应该只包含合同期内)
    # 实际上 form.cycle_start_date 和 end_date 已经限定了范围
    
    days_count = (end_date - start_date).days + 1
    total_work = days_count - total_leave - total_overtime
    
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
        # 这里需要根据家庭ID来分组考勤表
        
        # 1. 先找到该员工在该月份的所有合同
        contracts = BaseContract.query.filter(
            BaseContract.service_personnel_id == employee_id,
            BaseContract.status.in_(['active', 'terminated', 'finished', 'completed']),
            BaseContract.start_date <= cycle_end,
            BaseContract.end_date >= cycle_start
        ).all()
        
        if not contracts:
            return jsonify({
                "redirect_type": "none",
                "employee_name": employee.name,
                "message": "该月份没有有效合同"
            })
        
        # 2. 按家庭ID分组合同，但如果没有family_id则按customer_name分组
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
            # 选择主合同（最新的active合同，或最新的合同）
            primary_contract = next(
                (c for c in family_contracts if c.status == 'active'), 
                max(family_contracts, key=lambda x: x.start_date)
            )
            
            # 查找该员工在该月份该合同的考勤表
            # 对于不同客户/家庭，需要创建不同的考勤表
            existing_form = AttendanceForm.query.filter(
                AttendanceForm.employee_id == employee_id,
                AttendanceForm.cycle_start_date == cycle_start,
                AttendanceForm.contract_id == primary_contract.id
            ).first()
            
            if not existing_form:
                # 创建新的考勤表
                # employee_access_token 需要唯一，所以包含年月和合同ID信息
                access_token = f"{employee_id}_{cycle_start.year}_{cycle_start.month:02d}_{primary_contract.id}"
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
                db.session.flush()  # 获取ID但不提交
                existing_form = new_form
            
            # 收集家庭客户名称
            family_customers = []
            customer_names_seen = set()
            for contract in family_contracts:
                if contract.customer_name and contract.customer_name not in customer_names_seen:
                    family_customers.append(contract.customer_name)
                    customer_names_seen.add(contract.customer_name)
            
            # 计算服务期间
            service_start = min(c.start_date for c in family_contracts)
            service_end = max(c.end_date for c in family_contracts)
            
            attendance_forms.append({
                "form_id": str(existing_form.id),  # 考勤表唯一ID
                "form_token": existing_form.employee_access_token,  # 用于API调用的token
                "contract_id": str(primary_contract.id),  # 合同ID
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
                    "form_token": attendance_forms[0]["form_token"]  # 使用考勤表的access_token
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