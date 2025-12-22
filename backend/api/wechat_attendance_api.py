"""
微信公众号考勤API
处理微信公众号中的"我的考勤"功能
"""
from flask import Blueprint, jsonify, request, current_app
from backend.models import db, ServicePersonnel, AttendanceForm, BaseContract
from backend.api.attendance_form_api import find_consecutive_contracts, form_to_dict, calculate_last_month_cycle
import uuid
from datetime import datetime, date
import os

wechat_attendance_bp = Blueprint('wechat_attendance_api', __name__, url_prefix='/api/wechat-attendance')

@wechat_attendance_bp.route('/verify-employee', methods=['POST'])
def verify_employee():
    """
    验证员工身份信息
    接收微信openid、姓名、身份证号，验证后关联账户
    """
    try:
        data = request.get_json()
        openid = data.get('openid')
        name = data.get('name')
        id_card_number = data.get('id_card_number')
        
        if not openid or not name or not id_card_number:
            return jsonify({
                "success": False,
                "error": "缺少必要参数：openid、姓名、身份证号"
            }), 400
        
        # 1. 检查该openid是否已经关联了员工
        existing_employee = ServicePersonnel.query.filter_by(wechat_openid=openid).first()
        if existing_employee:
            return jsonify({
                "success": True,
                "message": "该微信账号已关联员工",
                "employee": {
                    "id": str(existing_employee.id),
                    "name": existing_employee.name,
                    "phone_number": existing_employee.phone_number
                }
            })
        
        # 2. 根据姓名和身份证号查找员工（不限制is_active，先找到再判断状态）
        employee = ServicePersonnel.query.filter(
            ServicePersonnel.name == name,
            ServicePersonnel.id_card_number == id_card_number
        ).first()
        
        if not employee:
            return jsonify({
                "success": False,
                "error": "未找到匹配的员工信息，请检查姓名和身份证号是否正确"
            }), 404
        
        # 检查员工是否激活
        if not employee.is_active:
            return jsonify({
                "success": False,
                "error": "您的账号当前未激活，无法使用考勤系统，请联系公司管理人员"
            }), 403
        
        # 3. 检查该员工是否已经关联了其他微信账号
        if employee.wechat_openid and employee.wechat_openid != openid:
            return jsonify({
                "success": False,
                "error": "该员工已关联其他微信账号，如需更换请联系管理员"
            }), 400
        
        # 4. 关联微信openid
        employee.wechat_openid = openid
        db.session.commit()
        
        current_app.logger.info(f"员工 {employee.name} (ID: {employee.id}) 成功关联微信openid: {openid}")
        
        return jsonify({
            "success": True,
            "message": "身份验证成功，微信账号已关联",
            "employee": {
                "id": str(employee.id),
                "name": employee.name,
                "phone_number": employee.phone_number
            }
        })
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"验证员工身份失败: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": "服务器内部错误"
        }), 500

@wechat_attendance_bp.route('/my-attendance', methods=['GET'])
def get_my_attendance():
    """
    获取我的考勤信息
    根据微信openid获取员工的考勤表列表
    """
    try:
        openid = request.args.get('openid')
        year = request.args.get('year', type=int)
        month = request.args.get('month', type=int)
        
        if not openid:
            return jsonify({
                "success": False,
                "error": "缺少openid参数"
            }), 400
        
        # 1. 根据openid查找员工
        employee = ServicePersonnel.query.filter_by(wechat_openid=openid).first()
        if not employee:
            return jsonify({
                "success": False,
                "error": "未找到关联的员工信息，请先进行身份验证",
                "need_verify": True
            }), 404
        
        # 2. 确定查询的年月
        if year and month:
            from calendar import monthrange
            last_day = monthrange(year, month)[1]
            cycle_start = date(year, month, 1)
            cycle_end = date(year, month, last_day)
        else:
            cycle_start, cycle_end = calculate_last_month_cycle()
            year = cycle_start.year
            month = cycle_start.month
        
        # 3. 查找该员工在指定月份的所有合同
        contracts = BaseContract.query.filter(
            BaseContract.service_personnel_id == employee.id,
            BaseContract.status.in_(['active', 'terminated', 'finished', 'completed']),
            BaseContract.start_date <= cycle_end,
            BaseContract.end_date >= cycle_start
        ).all()
        
        if not contracts:
            return jsonify({
                "success": True,
                "message": f"{year}年{month}月没有有效合同",
                "employee_name": employee.name,
                "attendance_forms": []
            })
        
        # 4. 按家庭ID分组合同
        family_groups = {}
        for contract in contracts:
            if contract.family_id:
                family_key = f"family_{contract.family_id}"
            else:
                family_key = f"customer_{contract.customer_name}"
            
            if family_key not in family_groups:
                family_groups[family_key] = []
            family_groups[family_key].append(contract)
        
        # 5. 为每个家庭组生成或查找考勤表
        attendance_forms = []
        frontend_base_url = os.getenv('FRONTEND_BASE_URL', 'http://localhost:5175')
        
        for family_key, family_contracts in family_groups.items():
            # 选择主合同（优先active，否则选最新的）
            primary_contract = next(
                (c for c in family_contracts if c.status == 'active'), 
                max(family_contracts, key=lambda x: x.start_date)
            )
            
            # 查找该员工在该月份该合同的考勤表
            existing_form = AttendanceForm.query.filter(
                AttendanceForm.employee_id == employee.id,
                AttendanceForm.cycle_start_date == cycle_start,
                AttendanceForm.contract_id == primary_contract.id
            ).first()
            
            if not existing_form:
                # 创建新的考勤表 - 使用员工ID作为 access_token（固定，不包含年月）
                signature_token = str(uuid.uuid4())
                
                existing_form = AttendanceForm(
                    employee_id=employee.id,
                    contract_id=primary_contract.id,
                    cycle_start_date=cycle_start,
                    cycle_end_date=cycle_end,
                    employee_access_token=str(employee.id),
                    customer_signature_token=signature_token,
                    status='draft'
                )
                db.session.add(existing_form)
                db.session.flush()
            
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
            
            # 生成考勤填写链接（使用现有的考勤填写页面）
            attendance_url = f"{frontend_base_url}/attendance-fill/{existing_form.employee_access_token}"
            
            # 生成客户签署链接
            client_sign_url = None
            if existing_form.customer_signature_token and existing_form.status == 'employee_confirmed':
                client_sign_url = f"{frontend_base_url}/attendance-sign/{existing_form.customer_signature_token}"
            
            attendance_forms.append({
                "form_id": str(existing_form.id),
                "form_token": existing_form.employee_access_token,
                "contract_id": str(primary_contract.id),
                "family_customers": family_customers,
                "service_period": f"{service_start.strftime('%Y-%m-%d')} 至 {service_end.strftime('%Y-%m-%d')}",
                "status": existing_form.status,
                "status_text": get_status_text(existing_form.status),
                "attendance_url": attendance_url,
                "client_sign_url": client_sign_url,
                "customer_signed_at": existing_form.customer_signed_at.strftime('%Y-%m-%d %H:%M') if existing_form.customer_signed_at else None
            })
        
        db.session.commit()
        
        return jsonify({
            "success": True,
            "employee_name": employee.name,
            "year": year,
            "month": month,
            "attendance_forms": attendance_forms
        })
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"获取考勤信息失败: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": "服务器内部错误"
        }), 500

@wechat_attendance_bp.route('/attendance-form/<form_token>', methods=['GET'])
def get_attendance_form_for_wechat(form_token):
    """
    获取考勤表详情（微信端专用）
    返回适合微信端显示的考勤表数据
    """
    try:
        # 查找考勤表
        form = AttendanceForm.query.filter_by(employee_access_token=form_token).first()
        if not form:
            return jsonify({
                "success": False,
                "error": "考勤表不存在"
            }), 404
        
        # 获取合并后的服务期间
        cycle_start = form.cycle_start_date.date() if isinstance(form.cycle_start_date, datetime) else form.cycle_start_date
        cycle_end = form.cycle_end_date.date() if isinstance(form.cycle_end_date, datetime) else form.cycle_end_date
        
        _, effective_start, effective_end = find_consecutive_contracts(form.employee_id, cycle_start, cycle_end)
        
        # 获取完整的考勤表数据
        form_data = form_to_dict(form, effective_start, effective_end)
        
        # 为微信端添加额外信息
        form_data.update({
            "success": True,
            "is_wechat_access": True,
            "can_edit": form.status in ['draft', 'employee_confirmed'],
            "status_text": get_status_text(form.status)
        })
        
        return jsonify(form_data)
        
    except Exception as e:
        current_app.logger.error(f"获取微信考勤表失败: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": "服务器内部错误"
        }), 500

def get_status_text(status):
    """获取状态的中文描述"""
    status_map = {
        'draft': '草稿',
        'employee_confirmed': '员工已确认，等待客户签署',
        'customer_signed': '客户已签署',
        'synced': '已同步到系统'
    }
    return status_map.get(status, status)

@wechat_attendance_bp.route('/oauth-callback', methods=['GET'])
def oauth_callback():
    """
    微信OAuth回调处理
    用code换取openid
    """
    try:
        code = request.args.get('code')
        
        if not code:
            return jsonify({
                "success": False,
                "error": "缺少code参数"
            }), 400
        
        # 从环境变量获取微信配置
        app_id = os.environ.get('WECHAT_APP_ID')
        app_secret = os.environ.get('WECHAT_APP_SECRET')
        
        if not app_id or not app_secret:
            current_app.logger.error("微信配置缺失: WECHAT_APP_ID 或 WECHAT_APP_SECRET")
            return jsonify({
                "success": False,
                "error": "服务器配置错误"
            }), 500
        
        # 调用微信API获取access_token和openid
        import requests
        wx_url = f"https://api.weixin.qq.com/sns/oauth2/access_token?appid={app_id}&secret={app_secret}&code={code}&grant_type=authorization_code"
        
        response = requests.get(wx_url, timeout=10)
        data = response.json()
        
        if 'errcode' in data:
            current_app.logger.error(f"微信OAuth失败: {data}")
            return jsonify({
                "success": False,
                "error": f"微信授权失败: {data.get('errmsg', '未知错误')}"
            }), 400
        
        openid = data.get('openid')
        if not openid:
            return jsonify({
                "success": False,
                "error": "未能获取openid"
            }), 400
        
        current_app.logger.info(f"微信OAuth成功，获取到openid: {openid[:8]}...")
        
        return jsonify({
            "success": True,
            "openid": openid
        })
        
    except Exception as e:
        current_app.logger.error(f"OAuth回调处理失败: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": "服务器内部错误"
        }), 500

@wechat_attendance_bp.route('/employee-info', methods=['GET'])
def get_employee_info():
    """
    根据openid获取员工基本信息
    返回员工信息（包括is_active状态），由前端决定如何处理
    """
    try:
        openid = request.args.get('openid')
        
        if not openid:
            return jsonify({
                "success": False,
                "error": "缺少openid参数"
            }), 400
        
        employee = ServicePersonnel.query.filter_by(wechat_openid=openid).first()
        if not employee:
            return jsonify({
                "success": False,
                "error": "未找到关联的员工信息",
                "need_verify": True
            }), 404
        
        # 返回员工信息，包括is_active状态，让前端处理
        return jsonify({
            "success": True,
            "employee": {
                "id": str(employee.id),
                "name": employee.name,
                "phone_number": employee.phone_number,
                "is_active": employee.is_active
            }
        })
        
    except Exception as e:
        current_app.logger.error(f"获取员工信息失败: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "error": "服务器内部错误"
        }), 500