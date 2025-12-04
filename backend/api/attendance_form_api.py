from flask import Blueprint, jsonify, request, current_app
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

@attendance_form_bp.route('/by-token/<employee_token>', methods=['GET'])
def get_attendance_form_by_token(employee_token):
    """
    根据员工访问令牌获取考勤表
    如果当月考勤表不存在，则自动创建
    """
    try:
        # 1. 尝试查找已存在的考勤表
        form = AttendanceForm.query.filter_by(employee_access_token=employee_token).first()
        
        if form:
            return jsonify(form_to_dict(form))
            
        # 2. 如果不存在，尝试根据token查找员工
        # 假设 token 是 employee_id (在实际生产中应该是加密的或者专门的token字段)
        # 这里为了简化，我们先假设 token 就是 employee_id 或者我们需要在 ServicePersonnel 中添加 token 字段
        # 根据之前的分析，我们先尝试用 token 作为 id 查找
        employee = None
        try:
            employee_id = uuid.UUID(employee_token)
            employee = ServicePersonnel.query.get(employee_id)
        except ValueError:
            # 如果不是UUID，可能是其他格式的token，这里暂时不支持，或者需要查询 ServicePersonnel 的 token 字段
            pass
            
        if not employee:
             # 尝试在 ServicePersonnel 中查找 (如果添加了 access_token 字段)
             # employee = ServicePersonnel.query.filter_by(access_token=employee_token).first()
             return jsonify({"error": "无效的访问令牌"}), 404

        # 3. 查找活跃合同 (如果有多个，取开始日期最新的一个)
        active_contract = BaseContract.query.filter(
            BaseContract.service_personnel_id == employee.id,
            BaseContract.status == 'active'
        ).order_by(BaseContract.start_date.desc()).first()
        
        if not active_contract:
            return jsonify({"error": "未找到该员工的活跃合同"}), 404
            
        # 4. 确定考勤周期 (默认上个月)
        cycle_start, cycle_end = calculate_last_month_cycle()
        
        # 检查是否已经存在该周期的表单 (防止重复创建)
        existing_form = AttendanceForm.query.filter_by(
            contract_id=active_contract.id,
            cycle_start_date=cycle_start
        ).first()
        
        if existing_form:
            # 如果存在但 token 不匹配(可能是旧 token)，更新 token? 
            # 或者直接返回现有表单 (需要更新 employee_access_token 吗? 假设 token 是员工维度的，应该是一样的)
            if existing_form.employee_access_token != employee_token:
                existing_form.employee_access_token = employee_token
                db.session.commit()
            return jsonify(form_to_dict(existing_form))

        # 5. 创建新表单
        new_form = AttendanceForm(
            contract_id=active_contract.id,
            employee_id=employee.id,
            cycle_start_date=cycle_start,
            cycle_end_date=cycle_end,
            employee_access_token=employee_token,
            form_data={},
            status='draft'
        )
        db.session.add(new_form)
        db.session.commit()
        
        return jsonify(form_to_dict(new_form))

    except Exception as e:
        current_app.logger.error(f"获取考勤表失败: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误"}), 500

@attendance_form_bp.route('/by-token/<employee_token>', methods=['PUT'])
def update_attendance_form(employee_token):
    """更新考勤表数据"""
    try:
        form = AttendanceForm.query.filter_by(employee_access_token=employee_token).first()
        if not form:
            return jsonify({"error": "考勤表不存在"}), 404
            
        # 只有在客户签署后或已同步后才禁止修改
        if form.status in ['customer_signed', 'synced']:
            return jsonify({"error": "考勤表已签署，无法修改"}), 400
            
        data = request.get_json()
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
        return jsonify(form_to_dict(form))
        
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
            
        return jsonify(form_to_dict(form))
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

def form_to_dict(form):
    # 生成客户签署链接
    client_sign_url = None
    if form.customer_signature_token:
        # 使用环境变量或默认值构建前端 URL
        frontend_url = os.getenv('FRONTEND_URL', 'http://localhost:5175')
        client_sign_url = f"{frontend_url}/attendance-sign/{form.customer_signature_token}"
    
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
        "created_at": form.created_at.isoformat(),
        "contract_info": {
            "customer_name": form.contract.customer_name if form.contract else "",
            "employee_name": form.contract.service_personnel.name if form.contract and form.contract.service_personnel else "",
            # 可以添加更多合同信息
        }
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
        
        # 查找所有活跃合同，且合同有效期与指定月份有交集
        contracts = BaseContract.query.filter(
            BaseContract.status == 'active',
            BaseContract.start_date <= month_end,
            BaseContract.end_date >= month_start
        ).order_by(BaseContract.service_personnel_id).all()
        
        result_items = []
        frontend_base_url = os.getenv('FRONTEND_BASE_URL', 'http://localhost:5175')
        
        for contract in contracts:
            if not contract.service_personnel:
                continue
                
            employee = contract.service_personnel
            
            # 查找该员工在指定月份的考勤表
            form = AttendanceForm.query.filter(
                AttendanceForm.contract_id == contract.id,
                AttendanceForm.cycle_start_date <= month_end,
                AttendanceForm.cycle_end_date >= month_start
            ).first()
            
            # 确定状态
            if not form:
                form_status = "not_created"
                form_id = None
                customer_signed_at = None
                employee_access_token = employee.id  # 使用员工ID作为token
            else:
                if form.customer_signed_at:
                    form_status = "signed"
                elif form.status == 'confirmed':
                    form_status = "confirmed"
                else:
                    form_status = "draft"
                form_id = str(form.id)
                customer_signed_at = form.customer_signed_at.isoformat() if form.customer_signed_at else None
                employee_access_token = form.employee_access_token
            
            # 生成访问链接
            access_link = f"{frontend_base_url}/attendance-form/{employee_access_token}"
            
            item = {
                "employee_id": str(employee.id),
                "employee_name": employee.name,
                "customer_name": contract.customer_name,
                "contract_start_date": contract.start_date.isoformat() if contract.start_date else None,
                "contract_end_date": contract.end_date.isoformat() if contract.end_date else None,
                "form_status": form_status,
                "employee_access_token": str(employee_access_token),
                "access_link": access_link,
                "form_id": form_id,
                "customer_signed_at": customer_signed_at,
                "contract_id": str(contract.id)
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

