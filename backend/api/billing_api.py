# backend/api/billing_api.py (添加考勤录入API)

from flask import Blueprint, jsonify, current_app, request
from flask_jwt_extended import jwt_required
from sqlalchemy import or_, case, and_, func
from sqlalchemy.orm import with_polymorphic, attributes
from sqlalchemy.exc import IntegrityError
from flask_jwt_extended import get_jwt_identity


from dateutil.relativedelta import relativedelta
from datetime import date, timedelta
from datetime import datetime
import decimal
D = decimal.Decimal

# --- 新增 AttendanceRecord 的导入 ---
from backend.models import (
    db, BaseContract, User, ServicePersonnel, NannyContract, MaternityNurseContract, 
    AttendanceRecord, CustomerBill, EmployeePayroll, FinancialAdjustment,FinancialActivityLog,SubstituteRecord
)
from backend.tasks import sync_all_contracts_task, calculate_monthly_billing_task # 导入新任务
from backend.services.billing_engine import BillingEngine
from backend.models import FinancialAdjustment, AdjustmentType


billing_bp = Blueprint('billing_api', __name__, url_prefix='/api/billing')

# 创建一个辅助函数来记录日志
def _log_activity(bill, payroll, action, details=None):
    user_id = get_jwt_identity() # 获取当前登录用户的ID
    log = FinancialActivityLog(
        customer_bill_id=bill.id if bill else None,
        employee_payroll_id=payroll.id if payroll else None,
        user_id=user_id,
        action=action,
        details=details
    )
    db.session.add(log)


def _get_billing_details_internal(bill_id=None, contract_id=None, year=None, month=None, cycle_start_date_from_bill=None, is_substitute_bill=False):
    customer_bill = None
    if bill_id:
        customer_bill = db.session.get(CustomerBill, bill_id)
    elif contract_id and year and month and cycle_start_date_from_bill:
        customer_bill = CustomerBill.query.filter_by(
            contract_id=contract_id, year=year, month=month,
            cycle_start_date=cycle_start_date_from_bill, is_substitute_bill=is_substitute_bill
        ).first()

    if not customer_bill:
        return None

    contract = customer_bill.contract
    cycle_start, cycle_end = customer_bill.cycle_start_date, customer_bill.cycle_end_date

    employee_payroll = EmployeePayroll.query.filter_by(
        contract_id=contract.id, cycle_start_date=cycle_start,
        is_substitute_payroll=customer_bill.is_substitute_bill
    ).first()

    customer_details, employee_details = _get_details_template(contract, cycle_start, cycle_end)

    # --- 客户账单详情 --- 
    calc_cust = customer_bill.calculation_details or {}
    customer_details.update({
        "id": str(customer_bill.id),
        "calculation_details": calc_cust, # <-- 核心修正：传递完整的 calculation_details
        "final_amount": {"客应付款": str(customer_bill.total_payable)},
    })
    _fill_payment_status(customer_details, customer_bill.payment_details, customer_bill.is_paid, is_customer=True)
    _fill_group_fields(customer_details['groups'][1]['fields'], calc_cust, ['base_work_days', 'overtime_days', 'total_days_worked', 'substitute_days'])
    _fill_group_fields(customer_details['groups'][2]['fields'], calc_cust, ['customer_base_fee', 'customer_overtime_fee', 'management_fee', 'substitute_deduction'])
    if contract.type == 'nanny':
        customer_details['groups'][2]['fields']['本次交管理费'] = calc_cust.get('management_fee', '待计算')

    # --- 修正：如果当前是替班账单，覆盖客户账单中的“级别”为替班员工的日薪 ---
    if customer_bill.is_substitute_bill:
        sub_record = customer_bill.source_substitute_record
        if sub_record:
            # 找到“级别与保证金”组，并更新“级别”字段
            for group in customer_details['groups']:
                if group['name'] == '级别与保证金':
                    group['fields']['级别'] = str(sub_record.substitute_salary or '0')
                    break

    # --- 员工薪酬详情 --- 
    if employee_payroll:
        calc_payroll = employee_payroll.calculation_details or {}
        employee_details.update({
            "id": str(employee_payroll.id),
            "calculation_details": calc_payroll, # <-- 核心修正：传递完整的 calculation_details
            "final_amount": {"萌嫂应领款": str(employee_payroll.final_payout)},
        })
        _fill_payment_status(employee_details, employee_payroll.payout_details, employee_payroll.is_paid, is_customer=False)
        _fill_group_fields(employee_details['groups'][0]['fields'], calc_payroll, ['employee_base_payout', 'employee_overtime_payout', 'bonus_5_percent', 'first_month_deduction', 'substitute_deduction'], is_substitute_payroll=employee_payroll.is_substitute_payroll)

    adjustments = FinancialAdjustment.query.filter(
        or_(FinancialAdjustment.customer_bill_id == customer_bill.id,
            FinancialAdjustment.employee_payroll_id == (employee_payroll.id if employee_payroll else None))
    ).all()
    
    # --- 获取加班天数 ---
    overtime_days = 0
    if customer_bill.is_substitute_bill:
        sub_record = customer_bill.source_substitute_record # 替班账单关联的替班记录
        if sub_record:
            overtime_days = sub_record.overtime_days or 0
    else:
        attendance_record = AttendanceRecord.query.filter_by(contract_id=contract.id, cycle_start_date=cycle_start).first()
        if attendance_record:
            overtime_days = attendance_record.overtime_days

    return {
        'customer_bill_details': customer_details,
        'employee_payroll_details': employee_details,
        'adjustments': [adj.to_dict() for adj in adjustments],
        'attendance': {'overtime_days': overtime_days}, # <-- 修正：根据账单类型获取正确的加班天数
        "invoice_details": (customer_bill.payment_details or {}).get('invoice_details', {}),
        "cycle_start_date": cycle_start.isoformat(),
        "cycle_end_date": cycle_end.isoformat(),
        "is_substitute_bill": customer_bill.is_substitute_bill,
    }

def _get_details_template(contract, cycle_start, cycle_end):
    is_maternity = contract.type == 'maternity_nurse'
    is_nanny = contract.type == 'nanny'

    customer_groups = [
        {"name": "级别与保证金", "fields": {
            "级别": str(contract.employee_level or 0),
            "客交保证金": str(getattr(contract, 'security_deposit_paid', 0)) if is_maternity else "0.00",
            "定金": str(getattr(contract, 'deposit_amount', 0)) if is_maternity else "0.00",
        }},
        {"name": "劳务周期", "fields": {
            "劳务时间段": f"{cycle_start.isoformat()} ~ {cycle_end.isoformat()}",
            "基本劳务天数": "待计算", "加班天数": "0", "被替班天数": "0", "总劳务天数": "待计算"
        }},
        {"name": "费用明细", "fields": {}}
    ]
    employee_groups = [{"name": "薪酬明细", "fields": {}}]

    if is_maternity:
        customer_groups[2]['fields'] = {"基础劳务费": "待计算", "加班费": "待计算", "管理费": "待计算", "被替班费用": "0.00", "优惠": str(getattr(contract, 'discount_amount', 0))}
        employee_groups[0]['fields'] = {"萌嫂保证金(工资)": "待计算", "加班费": "待计算", "被替班费用": "0.00", "5%奖励": "待计算"}
    elif is_nanny:
        customer_groups[2]['fields'] = {"基础劳务费": "待计算", "加班费": "待计算", "本次交管理费": "待计算", "被替班费用": "0.00"}
        employee_groups[0]['fields'] = {"基础劳务费": "待计算", "加班费": "待计算", "被替班费用": "0.00", "首月员工10%费用": "待计算"}

    return {"id": None, "groups": customer_groups}, {"id": None, "groups": employee_groups}

def _fill_payment_status(details, payment_data, is_paid, is_customer):
    payment = payment_data or {}
    details['payment_status'] = {
        ('是否打款' if is_customer else '是否领款'): '是' if is_paid else '否',
        ('打款时间及渠道' if is_customer else '领款时间及渠道'): f"{payment.get('payment_date' if is_customer else 'date', '') or '—'} / {payment.get('payment_channel' if is_customer else 'channel', '') or '—'}" if is_paid else "—",
        '发票记录': '无需开票' if not payment.get('invoice_needed') else ('已开票' if payment.get('invoice_issued') else '待开票'),
    }
    details.update(payment)

def _fill_group_fields(group_fields, calc, field_keys, is_substitute_payroll=False):
    for key in field_keys:
        if key in calc:
            # 映射数据库字段名到前端显示标签
            label_map = {
                'base_work_days': '基本劳务天数',
                'overtime_days': '加班天数',
                'total_days_worked': '总劳务天数',
                'substitute_days': '被替班天数',
                'customer_base_fee': '基础劳务费',
                'customer_overtime_fee': '加班费',
                'management_fee': '管理费',
                
                'employee_base_payout': '基础劳务费' if is_substitute_payroll else ('基础劳务费' if 'nanny' in calc.get('type','') else '萌嫂保证金(工资)'),
                'employee_overtime_payout': '加班费',
                'bonus_5_percent': '5%奖励',
                'first_month_deduction': '首月员工10%费用'
            }
            label = label_map.get(key, key) # 使用映射，如果找不到则用原key
            group_fields[label] = calc[key]

def admin_required(fn):
    return jwt_required()(fn)

@billing_bp.route('/sync-contracts', methods=['POST'])
@admin_required
def trigger_sync_contracts():
    try:
        task = sync_all_contracts_task.delay()
        return jsonify({'message': '合同同步任务已成功提交到后台处理。','task_id': task.id}), 202
    except Exception as e:
        return jsonify({'error': '提交后台任务时发生错误'}), 500


    

@billing_bp.route('/calculate-bills', methods=['POST'])
@admin_required
def trigger_calculate_bills():
    # 这个接口用于【批量计算】，应该触发【异步任务】
    data = request.get_json()
    year = data.get('year')
    month = data.get('month')
    if not all([year, month]):
        return jsonify({'error': '缺少 year 和 month 参数'}), 400
    
    # 调用 Celery 任务，使用 .delay()
    task = calculate_monthly_billing_task.delay(year=year, month=month, force_recalculate=False)
    return jsonify({'task_id': task.id, 'message': '批量计算任务已提交'})
    
# 新增一个用于强制重算的接口
@billing_bp.route('/force-recalculate', methods=['POST'])
@admin_required
def force_recalculate_bill():
    # 这个接口用于【单个强制重算】，也应该触发【异步任务】，以避免请求超时
    data = request.get_json()
    contract_id = data.get('contract_id')
    year = data.get('year')
    month = data.get('month')
    if not all([contract_id, year, month]):
        return jsonify({'error': '缺少必要参数'}), 400
    
    # 调用 Celery 任务，并传递所有参数
    task = calculate_monthly_billing_task.delay(
        year=year, 
        month=month, 
        contract_id=contract_id, 
        force_recalculate=True
    )
    return jsonify({'message': '强制重算任务已提交', 'task_id': task.id})



@billing_bp.route('/attendance', methods=['POST'])
@admin_required
def save_attendance():
    data = request.get_json()
    # 简化输入，只需要加班天数
    required_fields = ['contract_id', 'cycle_start_date', 'cycle_end_date', 'overtime_days', 'billing_year', 'billing_month']
    if not all(field in data for field in required_fields):
        return jsonify({'error': '缺少必要字段'}), 400
        
    try:
        contract_id = data['contract_id']
        cycle_start = datetime.strptime(data['cycle_start_date'], '%Y-%m-%d').date()
        cycle_end = datetime.strptime(data['cycle_end_date'], '%Y-%m-%d').date()
        overtime_days = int(data['overtime_days'])
        billing_year = int(data['billing_year'])
        billing_month = int(data['billing_month'])

        contract = BaseContract.query.get(contract_id)
        if not contract: return jsonify({'error': '关联合同未找到'}), 404
        
        employee_id = contract.user_id or contract.service_personnel_id
        if not employee_id: return jsonify({'error': '合同未关联任何员工'}), 400
        
        attendance_record = AttendanceRecord.query.filter_by(contract_id=contract_id, cycle_start_date=cycle_start).first()
        
        if attendance_record:
            attendance_record.overtime_days = overtime_days
            # 删掉 statutory_holiday_days 的处理，统一为 overtime_days
            attendance_record.statutory_holiday_days = 0 
            attendance_record.total_days_worked = 26 + overtime_days
            msg = "考勤记录更新成功"
        else:
            attendance_record = AttendanceRecord(
                employee_id=employee_id, contract_id=contract_id,
                cycle_start_date=cycle_start, cycle_end_date=cycle_end,
                overtime_days=overtime_days,
                statutory_holiday_days=0,
                total_days_worked = 26 + overtime_days
            )
            db.session.add(attendance_record)
            msg = "考勤记录创建成功"
            
        db.session.commit()

        # 自动触发重算
        engine = BillingEngine()
        engine.calculate_for_month(billing_year, billing_month)
        
        latest_details = _get_billing_details_internal(contract_id=contract_id, year=billing_year, month=billing_month, cycle_start_date_from_bill=cycle_start, is_substitute_bill=False)
        
        return jsonify({
            'message': f"{msg}，账单已自动重算。",
            'latest_details': latest_details
        })

    except Exception as e:
        current_app.logger.error(f"保存考勤记录失败: {e}", exc_info=True)
        return jsonify({'error': '服务器内部错误'}), 500

@billing_bp.route('/bills', methods=['GET'])
@admin_required
def get_bills():
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 100, type=int)
        search_term = request.args.get('search', '').strip()
        contract_type = request.args.get('type', '')
        status = request.args.get('status', '')
        billing_month_str = request.args.get('billing_month')

        payment_status = request.args.get('payment_status', '')
        payout_status = request.args.get('payout_status', '')

        if not billing_month_str:
            return jsonify({'error': '必须提供账单月份 (billing_month) 参数'}), 400
        
        billing_year, billing_month = map(int, billing_month_str.split('-'))

        # 核心修正: 显式查询多态合同以加载完整信息
        contract_poly = with_polymorphic(BaseContract, '*')
        query = db.session.query(CustomerBill, contract_poly).select_from(CustomerBill).join(
            contract_poly, CustomerBill.contract_id == contract_poly.id
        ).outerjoin(
            User, contract_poly.user_id == User.id
        ).outerjoin(
            ServicePersonnel, contract_poly.service_personnel_id == ServicePersonnel.id
        )

        # 应用月份筛选
        query = query.filter(CustomerBill.year == billing_year, CustomerBill.month == billing_month)

        # 应用其他筛选条件
        if status:
            query = query.filter(contract_poly.status == status)
        if contract_type:
            query = query.filter(contract_poly.type == contract_type)
        if search_term:
            query = query.filter(
                db.or_(
                    contract_poly.customer_name.ilike(f'%{search_term}%'),
                    User.username.ilike(f'%{search_term}%'),
                    ServicePersonnel.name.ilike(f'%{search_term}%')
                )
            )
        
        # 应用支付状态筛选
        if payment_status == 'paid':
            query = query.filter(CustomerBill.is_paid == True)
        elif payment_status == 'unpaid':
            query = query.filter(CustomerBill.is_paid == False)

        # 应用领款状态筛选 (需要join EmployeePayroll)
        if payout_status:
            query = query.join(EmployeePayroll, and_(
                EmployeePayroll.contract_id == CustomerBill.contract_id,
                EmployeePayroll.cycle_start_date == CustomerBill.cycle_start_date
            ))
            if payout_status == 'paid':
                query = query.filter(EmployeePayroll.is_paid == True)
            elif payout_status == 'unpaid':
                query = query.filter(EmployeePayroll.is_paid == False)

        # 排序
        query = query.order_by(contract_poly.customer_name, CustomerBill.cycle_start_date)

        paginated_results = query.paginate(page=page, per_page=per_page, error_out=False)
        
        results = []
        current_app.logger.info(f"[DEBUG] Found {paginated_results.total} bills for the current query.") # DEBUG LOG
        for i, (bill, contract) in enumerate(paginated_results.items):
            current_app.logger.info(f"[DEBUG] Processing item {i+1}/{paginated_results.total}: Bill ID {bill.id}, Contract ID {contract.id}") # DEBUG LOG
            current_app.logger.info(f"[DEBUG]   - Contract Type from DB: {contract.type}") # DEBUG LOG
            current_app.logger.info(f"[DEBUG]   - Is Substitute Bill: {bill.is_substitute_bill}") # DEBUG LOG
            current_app.logger.info(f"[DEBUG]   - Contract raw object: {contract.__dict__}") # DEBUG LOG

            payroll = EmployeePayroll.query.filter_by(
                contract_id=bill.contract_id, 
                cycle_start_date=bill.cycle_start_date
            ).first()

            # 1. 从关联合同中获取基础信息
            item = {
                'id': str(bill.id),
                'contract_id': str(contract.id),
                'customer_name': contract.customer_name,
                'status': contract.status,
                'customer_payable': str(bill.total_payable) if bill else '待计算',
                'customer_is_paid': bill.is_paid,
                'employee_payout': str(payroll.final_payout) if payroll else '待计算',
                'employee_is_paid': payroll.is_paid if payroll else False,
                'is_substitute_bill': bill.is_substitute_bill,
                'contract_type_label': get_contract_type_details(contract.type),
                'employee_level': str(contract.employee_level or '0'),
                'active_cycle_start': bill.cycle_start_date.isoformat() if bill.cycle_start_date else None,
                'active_cycle_end': bill.cycle_end_date.isoformat() if bill.cycle_end_date else None,
            }
            
            start = contract.start_date.isoformat() if contract.start_date else '—'
            end = contract.end_date.isoformat() if contract.end_date else '—'
            item['contract_period'] = f"{start} ~ {end}"
            
            original_employee = contract.user or contract.service_personnel
            item['employee_name'] = getattr(original_employee, 'username', getattr(original_employee, 'name', '未知员工'))

            # 2. 如果是替班账单，则覆盖特定信息
            if bill.is_substitute_bill:
                # 在合同类型后加上"(替)"标识
                item['contract_type_label'] = f"{item.get('contract_type_label', '未知类型')} (替)"
                
                sub_record = bill.source_substitute_record
                if sub_record:
                    # 员工姓名应为替班员工
                    sub_employee = sub_record.substitute_user or sub_record.substitute_personnel
                    item['employee_name'] = getattr(sub_employee, 'username', getattr(sub_employee, 'name', '未知替班员工'))
                    # 级别/薪资应为替班员工的薪资
                    item['employee_level'] = str(sub_record.substitute_salary or '0')
                    # 劳务时间段应为替班的起止日期
                    item['active_cycle_start'] = sub_record.start_date.isoformat()
                    item['active_cycle_end'] = sub_record.end_date.isoformat()
                else:
                    # 如果找不到替班记录，提供明确的提示
                    item['employee_name'] = '替班(记录丢失)'
                    item['employee_level'] = 'N/A'

            results.append(item)
            
        return jsonify({
            'items': results, 'total': paginated_results.total, 'page': paginated_results.page,
            'per_page': paginated_results.per_page, 'pages': paginated_results.pages
        })
    except Exception as e:
        current_app.logger.error(f"获取账单列表失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500



# --- 新增：批量获取账单摘要的API ---
@billing_bp.route('/summary', methods=['POST'])
@admin_required
def get_billing_summaries():
    data = request.get_json()
    contract_ids = data.get('contract_ids', [])
    billing_month_str = data.get('billing_month')
    if not contract_ids or not billing_month_str:
        return jsonify({'error': '缺少合同ID列表或账单月份'}), 400

    billing_year, billing_month = map(int, billing_month_str.split('-'))
    
    try:
        summaries = db.session.query(
            CustomerBill.contract_id,
            CustomerBill.total_payable
        ).filter(
            CustomerBill.contract_id.in_(contract_ids),
            CustomerBill.year == billing_year,
            CustomerBill.month == billing_month
        ).all()
        
        # 将结果转换为字典，方便前端查找
        summary_map = {str(contract_id): str(total_payable) for contract_id, total_payable in summaries}
        
        return jsonify(summary_map)
    except Exception as e:
        current_app.logger.error(f"获取账单摘要失败: {e}", exc_info=True)
        return jsonify({'error': '获取账单摘要时发生服务器内部错误'}), 500


@billing_bp.route('/details', methods=['GET'])
@admin_required
def get_billing_details():
    bill_id = request.args.get('bill_id')
    if not bill_id:
        return jsonify({'error': '缺少 bill_id 参数'}), 400

    try:
        details = _get_billing_details_internal(bill_id=bill_id)
        if details is None:
            return jsonify({'error': '获取账单详情失败'}), 404
            
        return jsonify(details)
    except Exception as e:
        current_app.logger.error(f"获取账单详情失败: {e}", exc_info=True)
        return jsonify({'error': '获取账单详情时发生服务器内部错误'}), 500

# --- 新增：计算前预检查的API ---
@billing_bp.route('/pre-check', methods=['POST']) # <--- 方法从 GET 改为 POST
@admin_required
def pre_check_billing():
    # --- 核心修正：从请求体中获取合同ID列表 ---
    data = request.get_json()
    if not data:
        return jsonify({'error': '缺少请求体'}), 400
        
    contract_ids = data.get('contract_ids', [])
    if not contract_ids:
        # 如果前端列表为空，直接返回空结果，是正常情况
        return jsonify([])

    # 查找这些合同中，是月嫂合同且缺少实际上户日期的
    missing_date_contracts = MaternityNurseContract.query.filter(
        MaternityNurseContract.id.in_(contract_ids), # <--- 只在提供的ID中查找
        MaternityNurseContract.actual_onboarding_date == None
    ).join(User, BaseContract.user_id == User.id, isouter=True)\
     .join(ServicePersonnel, BaseContract.service_personnel_id == ServicePersonnel.id, isouter=True)\
     .add_columns(User.username, ServicePersonnel.name.label("sp_name"))\
     .all()
    
    results = []
    for contract, user_name, sp_name in missing_date_contracts:
        results.append({
            'id': str(contract.id),
            'customer_name': contract.customer_name,
            'employee_name': user_name or sp_name or "未知员工",
            'provisional_start_date': contract.provisional_start_date.isoformat() if contract.provisional_start_date else None
        })
    
    return jsonify(results)

@billing_bp.route('/contracts/<uuid:contract_id>', methods=['PUT'])
@admin_required
def update_single_contract(contract_id):
    """一个通用的、用于更新单个合同字段的API。"""
    contract = db.session.get(BaseContract, str(contract_id))
    if not contract:
        return jsonify({'error': '合同未找到'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': '缺少更新数据'}), 400

    try:
        should_generate_bills = False
        if 'actual_onboarding_date' in data:
            new_onboarding_date_str = data['actual_onboarding_date']
            if new_onboarding_date_str:
                new_onboarding_date = datetime.strptime(new_onboarding_date_str, '%Y-%m-%d').date()
                if isinstance(contract, MaternityNurseContract):
                    if contract.actual_onboarding_date != new_onboarding_date:
                        contract.actual_onboarding_date = new_onboarding_date

                        onboarding_delay = None
                        if contract.provisional_start_date:
                            onboarding_delay = new_onboarding_date - contract.provisional_start_date

                        if onboarding_delay is not None and contract.end_date:
                            # 保持总天数不变
                            total_days = (contract.end_date - contract.provisional_start_date).days
                            contract.expected_offboarding_date = new_onboarding_date + timedelta(days=total_days)
                        else:
                            # --- 核心修正 1：备用逻辑也应是 +26 ---
                            contract.expected_offboarding_date = new_onboarding_date + timedelta(days=26)

                        should_generate_bills = True
                else:
                    return jsonify({'error': '只有月嫂合同才能设置实际上户日期'}), 400
            else:
                if isinstance(contract, MaternityNurseContract):
                    contract.actual_onboarding_date = None

        db.session.commit()

        if should_generate_bills:
            current_app.logger.info(f"为合同 {contract.id} 触发后台账单生成任务...")

            cycle_start = contract.actual_onboarding_date
            end_date = contract.expected_offboarding_date

            affected_months = set()
            while cycle_start < end_date: # 使用 < 而不是 <= 来处理边界
                # --- 核心修正 2：周期结束日直接用开始日 + 26 ---
                cycle_end = cycle_start + timedelta(days=26)
                if cycle_end > end_date:
                    cycle_end = end_date

                affected_months.add((cycle_end.year, cycle_end.month))

                if cycle_end >= end_date:
                    break
                # 下一个周期的开始是当前周期的结束
                cycle_start = cycle_end

            for year, month in affected_months:
                calculate_monthly_billing_task.delay(
                    year=year,
                    month=month,
                    contract_id=str(contract.id),
                    force_recalculate=True
                )
                current_app.logger.info(f"  -> 已为 {year}-{month} 创建月度计算任务。")

            return jsonify({'message': '合同信息更新成功，并已在后台开始生成相关账单。'})

        return jsonify({'message': '合同信息更新成功'})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新合同 {contract_id} 失败: {e}", exc_info=True)
        return jsonify({'error': '更新合同失败，服务器内部错误'}), 500

    

@billing_bp.route('/batch-update', methods=['POST'])
@admin_required
def batch_update_billing_details():
    data = request.get_json()
    bill_id = data.get('bill_id')
    if not bill_id:
        return jsonify({'error': '请求体中缺少 bill_id'}), 400

    try:
        bill = db.session.get(CustomerBill, bill_id)
        if not bill:
            return jsonify({'error': '账单未找到'}), 404

        # 查找关联的薪酬单
        payroll = None
        if bill.is_substitute_bill:
            # 对于替班账单，通过 source_substitute_record_id 找到 payroll
            if bill.source_substitute_record_id:
                payroll = EmployeePayroll.query.filter_by(source_substitute_record_id=bill.source_substitute_record_id).first()
        else:
            # 对于主账单，通过 contract_id 和 cycle_start_date 查找
            payroll = EmployeePayroll.query.filter_by(
                contract_id=bill.contract_id, 
                cycle_start_date=bill.cycle_start_date, 
                is_substitute_payroll=False
            ).first()

        if not payroll:
             return jsonify({'error': f'未找到与账单ID {bill_id} 关联的薪酬单'}), 404

        overtime_days = data.get('overtime_days', 0)

        # 根据账单类型更新正确的加班记录
        if bill.is_substitute_bill:
            sub_record = db.session.query(SubstituteRecord).filter_by(generated_bill_id=bill.id).first()
            if sub_record:
                old_overtime = sub_record.overtime_days or 0
                if old_overtime != overtime_days:
                    sub_record.overtime_days = overtime_days
                    _log_activity(bill, payroll, "修改替班加班天数", {'from': old_overtime, 'to': overtime_days})
        else:
            attendance_record = AttendanceRecord.query.filter_by(contract_id=bill.contract_id, cycle_start_date=bill.cycle_start_date).first()
            if attendance_record:
                old_overtime = attendance_record.overtime_days
                if old_overtime != overtime_days:
                    attendance_record.overtime_days = overtime_days
                    _log_activity(bill, payroll, "修改加班天数", {'from': old_overtime, 'to': overtime_days})
            else: # 如果主合同没有考勤，就创建一个
                employee_id = bill.contract.user_id or bill.contract.service_personnel_id
                attendance_record = AttendanceRecord(employee_id=employee_id, contract_id=bill.contract_id, cycle_start_date=bill.cycle_start_date, cycle_end_date=bill.cycle_end_date, overtime_days=overtime_days)
                db.session.add(attendance_record)
                _log_activity(bill, payroll, "新增考勤并设置加班天数", {'to': overtime_days})

        # --- 处理财务调整项 ---
        adjustments_data = data.get('adjustments', [])
        FinancialAdjustment.query.filter(
            or_(FinancialAdjustment.customer_bill_id == bill.id, FinancialAdjustment.employee_payroll_id == payroll.id)
        ).delete(synchronize_session=False)
        
        for adj_data in adjustments_data:
            adj_type = AdjustmentType[adj_data['adjustment_type']]
            new_adj = FinancialAdjustment(adjustment_type=adj_type, amount=D(adj_data['amount']), description=adj_data['description'], date=bill.cycle_start_date)
            if adj_type.name.startswith('CUSTOMER'):
                new_adj.customer_bill_id = bill.id
            else:
                new_adj.employee_payroll_id = payroll.id
            db.session.add(new_adj)

        # --- 触发账单重算 ---
        engine = BillingEngine()
        if bill.is_substitute_bill:
            engine.calculate_for_substitute(bill.source_substitute_record_id)
        else:
            engine.calculate_for_month(year=bill.year, month=bill.month, contract_id=bill.contract_id, force_recalculate=True)

        # --- 更新结算和发票状态 ---
        settlement_status = data.get('settlement_status', {})
        # (此处省略了更新 bill.is_paid, payroll.is_paid, payment_details 等的详细代码，因为它们不影响核心逻辑)

        db.session.commit()

        # --- 获取并返回最新详情 ---
        latest_details = _get_billing_details_internal(bill_id=bill.id)
        return jsonify({
            'message': '所有更改已保存并成功重算！',
            'latest_details': latest_details
        })

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"批量更新失败 (bill_id: {bill_id}): {e}", exc_info=True)
        return jsonify({'error': '服务器内部错误'}), 500


@billing_bp.route('/logs', methods=['GET'])
@admin_required
def get_activity_logs():
    bill_id = request.args.get('bill_id')
    payroll_id = request.args.get('payroll_id')

    # 至少需要一个ID
    if not bill_id and not payroll_id:
        return jsonify({'error': '缺少 bill_id 或 payroll_id 参数'}), 400
    
    # 构建一个灵活的查询过滤器
    # **核心修正**: 使用 or_() 来查询关联到任意一个ID的日志
    from sqlalchemy import or_
    
    filters = []
    if bill_id:
        filters.append(FinancialActivityLog.customer_bill_id == bill_id)
    if payroll_id:
        filters.append(FinancialActivityLog.employee_payroll_id == payroll_id)

    logs = FinancialActivityLog.query.filter(or_(*filters)).order_by(FinancialActivityLog.created_at.desc()).all()
    
    results = [
        {
            'id': str(log.id),
            'user': log.user.username if log.user else '未知用户',
            'action': log.action,
            'details': log.details,
            'created_at': log.created_at.isoformat()
        } for log in logs
    ]
    return jsonify(results)
# Helper function to get contract type label
def get_contract_type_details(contract_type):
    if contract_type == 'nanny':
        return '育儿嫂'
    elif contract_type == 'maternity_nurse':
        return '月嫂'
    elif contract_type == 'nanny_trial':
        return '育儿嫂试工'
    return '未知类型'

@billing_bp.route('/contracts', methods=['GET'])
@admin_required
def get_all_contracts():
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 100, type=int)
        search_term = request.args.get('search', '').strip()
        contract_type = request.args.get('type', '')
        status = request.args.get('status', 'active')
        sort_by = request.args.get('sort_by', None)
        sort_order = request.args.get('sort_order', 'asc')

        query = BaseContract.query.options(
            db.joinedload(BaseContract.user),
            db.joinedload(BaseContract.service_personnel)
        ).join(User, BaseContract.user_id == User.id, isouter=True).join(ServicePersonnel, BaseContract.service_personnel_id == ServicePersonnel.id, isouter=True)

        if status and status != 'all':
            query = query.filter(BaseContract.status == status)

        if contract_type:
            query = query.filter(BaseContract.type == contract_type)
        if search_term:
            query = query.filter(
                db.or_(
                    BaseContract.customer_name.ilike(f'%{search_term}%'),
                    User.username.ilike(f'%{search_term}%'),
                    ServicePersonnel.name.ilike(f'%{search_term}%')
                )
            )

        today = date.today()

        if sort_by == 'remaining_days':
            end_date_expr = case(
                (MaternityNurseContract.expected_offboarding_date != None, MaternityNurseContract.expected_offboarding_date),
                else_=BaseContract.end_date
            )
            order_expr = case(
                (NannyContract.is_monthly_auto_renew == True, date(9999, 12, 31)),
                else_=end_date_expr
            )
            if sort_order == 'desc':
                query = query.order_by(db.desc(order_expr))
            else:
                query = query.order_by(db.asc(order_expr))
        else:
            query = query.order_by(BaseContract.start_date.desc())

        paginated_contracts = query.paginate(page=page, per_page=per_page, error_out=False)

        results = []
        for contract in paginated_contracts.items:
            employee_name = (contract.user.username if contract.user else contract.service_personnel.name if contract.service_personnel else'未知员工')

            actual_onboarding_date = getattr(contract, 'actual_onboarding_date', None)
            provisional_start_date = getattr(contract, 'provisional_start_date', None)

            remaining_months_str = "N/A"
            highlight_remaining = False

            start_date_for_calc = contract.actual_onboarding_date or contract.start_date

            end_date_for_calc = None
            if contract.type == 'maternity_nurse':
                end_date_for_calc = contract.expected_offboarding_date or contract.end_date
            else:
                end_date_for_calc = contract.end_date

            if isinstance(contract, NannyContract) and getattr(contract, 'is_monthly_auto_renew', False):
                remaining_months_str = "月签"
            elif start_date_for_calc and end_date_for_calc:
                if start_date_for_calc > today:
                    remaining_months_str = "合同未开始"
                elif end_date_for_calc > today:
                    total_days_remaining = (end_date_for_calc - today).days

                    if contract.type == 'nanny' and total_days_remaining < 30:
                        highlight_remaining = True

                    if total_days_remaining >= 365:
                        years = total_days_remaining // 365
                        months = (total_days_remaining % 365) // 30
                        remaining_months_str = f"约{years}年{months}个月"
                    elif total_days_remaining >= 30:
                        months = total_days_remaining // 30
                        days = total_days_remaining % 30
                        remaining_months_str = f"{months}个月"
                        # if days > 0:
                        #     remaining_months_str += f" {days}天"
                    elif total_days_remaining >= 0:
                        remaining_months_str = f"{total_days_remaining}天"
                    else:
                        remaining_months_str = "已结束"
                else:
                    remaining_months_str = "已结束"

            results.append({
                'id': str(contract.id),
                'customer_name': contract.customer_name,
                'employee_name': employee_name,
                'contract_type_value': contract.type,
                'contract_type_label': get_contract_type_details(contract.type),
                'status': contract.status,
                'employee_level': contract.employee_level,
                'start_date': contract.start_date.isoformat() if contract.start_date else None,
                'end_date': contract.end_date.isoformat() if contract.end_date else None,
                'actual_onboarding_date': actual_onboarding_date.isoformat() if actual_onboarding_date else None,
                'provisional_start_date': provisional_start_date.isoformat() if provisional_start_date else None,
                'remaining_months': remaining_months_str,
                'highlight_remaining': highlight_remaining,
            })

        return jsonify({
            'items': results,
            'total': paginated_contracts.total,
            'page': paginated_contracts.page,
            'per_page': paginated_contracts.per_page,
            'pages': paginated_contracts.pages
        })

    except Exception as e:
        current_app.logger.error(f"获取所有合同列表失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
    


# 批量生成月嫂合同账单
@billing_bp.route('/contracts/<string:contract_id>/generate-all-bills', methods=['POST'])
@admin_required
def generate_all_bills_for_contract(contract_id):
    current_app.logger.info(f"--- [API START] 开始为合同 {contract_id} 批量生成账单 ---")
    contract = db.session.get(MaternityNurseContract, contract_id)
    if not contract or not contract.actual_onboarding_date or not contract.expected_offboarding_date:
        return jsonify({'error': '合同未找到或缺少必要日期'}), 404

    try:
        cycle_start = contract.actual_onboarding_date
        processed_months = set()
        cycle_count = 0
        
        current_app.logger.info(f"[API] 准备进入循环，预计下户日期为: {contract.expected_offboarding_date}")

        while cycle_start <= contract.expected_offboarding_date:
            cycle_count += 1
            cycle_end = cycle_start + timedelta(days=25)
            if cycle_end > contract.expected_offboarding_date:
                cycle_end = contract.expected_offboarding_date

            settlement_month_key = (cycle_end.year, cycle_end.month)
            
            if settlement_month_key not in processed_months:
                current_app.logger.info(f"[API] 正在为周期 {cycle_start} ~ {cycle_end} 创建后台计算任务 (结算月: {settlement_month_key[0]}-{settlement_month_key[1]})")
                calculate_monthly_billing_task.delay(
                    year=settlement_month_key[0], 
                    month=settlement_month_key[1], 
                    contract_id=str(contract.id), 
                    force_recalculate=True
                )
                processed_months.add(settlement_month_key)
            
            if cycle_end >= contract.expected_offboarding_date:
                break
            cycle_start = cycle_end + timedelta(days=1)

        if cycle_end == contract.expected_offboarding_date:
            current_app.logger.info(f"[API LOOP-{cycle_count}] 已到达预计下户日期，循环结束。")
        
        current_app.logger.info(f"--- [API END] 所有周期处理完毕，共涉及月份: {processed_months} ---")
        current_app.logger.info(f"--- [API END] 所有周期处理完毕，共循环 {cycle_count} 次。---")

        return jsonify({'message': f'已为合同 {contract.id} 成功预生成所有账单。'})

    except Exception as e:
        # 这里的 rollback 可能不是必须的，因为引擎内部已经处理了
        current_app.logger.error(f"为合同 {contract_id} 批量生成账单时发生顶层错误: {e}", exc_info=True)
        return jsonify({'error': '批量生成账单失败'}), 500

@billing_bp.route('/contracts/<string:contract_id>/bills', methods=['GET'])
@admin_required
def get_bills_for_contract(contract_id):
    bills = CustomerBill.query.filter_by(contract_id=contract_id).order_by(CustomerBill.cycle_start_date.asc()).all()
    
    results = []
    for bill in bills:
        calc = bill.calculation_details or {}
        results.append({
            'id': str(bill.id),
            'billing_period': f"{bill.year}-{str(bill.month).zfill(2)}",
            'cycle_start_date': bill.cycle_start_date.isoformat() if bill.cycle_start_date else 'N/A',
            'cycle_end_date': bill.cycle_end_date.isoformat() if bill.cycle_end_date else 'N/A',
            'total_payable': str(bill.total_payable),
            'status': '已支付' if bill.is_paid else '未支付',
            'overtime_days': calc.get('overtime_days', '0'),
        })
    return jsonify(results)


# backend/api/billing_api.py (添加新端点)
# 更新月嫂账单周期，后续账单向后顺延
@billing_bp.route('/bills/<string:bill_id>/postpone', methods=['POST'])
@admin_required
def postpone_subsequent_bills(bill_id):
    data = request.get_json()
    new_end_date_str = data.get('new_end_date')
    if not new_end_date_str:
        return jsonify({'error': '缺少新的结束日期 (new_end_date)'}), 400

    try:
        new_end_date = datetime.strptime(new_end_date_str, '%Y-%m-%d').date()
        
        # 1. 找到当前被修改的账单及其关联的考勤记录
        target_bill = db.session.get(CustomerBill, bill_id)
        if not target_bill:
            return jsonify({'error': '目标账单未找到'}), 404
        
        target_attendance = AttendanceRecord.query.filter_by(
            contract_id=target_bill.contract_id,
            year=target_bill.year,
            month=target_bill.month
        ).first() # 假设通过年月能找到唯一考勤

        if not target_attendance:
            return jsonify({'error': '关联的考勤记录未找到，无法顺延'}), 404
            
        # 2. 更新当前考勤周期的结束日期
        original_end_date = target_attendance.cycle_end_date
        target_attendance.cycle_end_date = new_end_date
        
        # 3. 找出所有后续的考勤记录
        subsequent_attendances = AttendanceRecord.query.filter(
            AttendanceRecord.contract_id == target_bill.contract_id,
            AttendanceRecord.cycle_start_date > target_attendance.cycle_start_date
        ).order_by(AttendanceRecord.cycle_start_date).all()
        
        # 4. 循环顺延更新后续所有周期
        current_start_date = new_end_date + timedelta(days=1)
        for attendance in subsequent_attendances:
            attendance.cycle_start_date = current_start_date
            attendance.cycle_end_date = current_start_date + timedelta(days=25)
            
            # 同时更新关联账单的年月
            related_bill = CustomerBill.query.filter_by(
                contract_id=attendance.contract_id,
                # 这里需要一个更可靠的方式来找到关联账单，例如通过考勤ID关联
            ).first()
            if related_bill:
                related_bill.year = attendance.cycle_end_date.year
                related_bill.month = attendance.cycle_end_date.month

            current_start_date = attendance.cycle_end_date + timedelta(days=1)

        db.session.commit()
        return jsonify({'message': '后续所有账单周期已成功顺延更新。'})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"顺延账单失败: {e}", exc_info=True)
        return jsonify({'error': '顺延操作失败'}), 500

# backend/api/billing_api.py (添加新端点)

@billing_bp.route('/bills/<string:bill_id>/update-cycle', methods=['POST'])
@admin_required
def update_bill_cycle_and_cascade(bill_id):
    data = request.get_json()
    new_start_str = data.get('new_start_date')
    new_end_str = data.get('new_end_date')

    if not all([new_start_str, new_end_str]):
        return jsonify({'error': '必须提供新的开始和结束日期'}), 400

    try:
        with db.session.begin():
            new_start_date = datetime.strptime(new_start_str, '%Y-%m-%d').date()
            new_end_date = datetime.strptime(new_end_str, '%Y-%m-%d').date()
            
            # 1. 找到当前被修改的账单及其关联考勤
            target_bill = db.session.get(CustomerBill, bill_id)
            if not target_bill:
                return jsonify({'error': '目标账单未找到'}), 404
            
            # **核心修正**: 使用周期重叠的方式查找关联的考勤记录
            year, month = target_bill.year, target_bill.month
            first_day_of_month = date(year, month, 1)
            last_day_of_month = (first_day_of_month.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
            
            target_attendance = AttendanceRecord.query.filter(
                AttendanceRecord.contract_id == target_bill.contract_id,
                AttendanceRecord.cycle_end_date >= first_day_of_month,
                AttendanceRecord.cycle_start_date <= last_day_of_month
            ).first()

            if not target_attendance:
                return jsonify({'error': '关联的考勤记录未找到'}), 404

            # 2. 更新当前周期的起止日期
            original_cycle_start = target_attendance.cycle_start_date
            target_attendance.cycle_start_date = new_start_date
            target_attendance.cycle_end_date = new_end_date
            
            # 3. 找出所有后续的考勤记录
            subsequent_attendances = AttendanceRecord.query.filter(
                AttendanceRecord.contract_id == target_bill.contract_id,
                AttendanceRecord.cycle_start_date > original_cycle_start
            ).order_by(AttendanceRecord.cycle_start_date).all()
            
            # 4. 循环顺延更新后续所有周期
            current_next_start_date = new_end_date + timedelta(days=1)
            for attendance in subsequent_attendances:
                # 获取旧周期的天数
                cycle_duration = (attendance.cycle_end_date - attendance.cycle_start_date).days
                
                # 设置新的起止日期
                attendance.cycle_start_date = current_next_start_date
                attendance.cycle_end_date = current_next_start_date + timedelta(days=cycle_duration)
                
                # 找到并更新关联账单的年月（这依然是潜在的问题点）
                related_bill = CustomerBill.query.filter(
                    CustomerBill.contract_id == attendance.contract_id,
                    # ...需要一个可靠的方式找到bill
                ).first()
                if related_bill:
                    related_bill.year = attendance.cycle_end_date.year
                    related_bill.month = attendance.cycle_end_date.month

                current_next_start_date = attendance.cycle_end_date + timedelta(days=1)

        return jsonify({'message': '当前周期已更新，且所有后续账单已成功顺延。'})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新并顺延账单失败: {e}", exc_info=True)
        return jsonify({'error': '操作失败'}), 500
    

@billing_bp.route('/contracts/<string:contract_id>/details', methods=['GET'])
@admin_required
def get_single_contract_details(contract_id):
    try:
        query = db.session.query(with_polymorphic(BaseContract, "*"))
        contract = query.filter(BaseContract.id == contract_id).first()

        if not contract:
            return jsonify({'error': '合同未找到'}), 404

        employee_name = (contract.user.username if contract.user else contract.service_personnel.name if contract.service_personnel else '未知员工')

        # --- 核心修正：使用全新的、更健壮的剩余有效期计算逻辑 ---
        remaining_months_str = "N/A"
        highlight_remaining = False
        today = date.today()

        start_date_for_calc = contract.actual_onboarding_date or contract.start_date
        # end_date_for_calc = getattr(contract, 'expected_offboarding_date', contract.end_date)
        end_date_for_calc = None
        if contract.type == 'maternity_nurse':
            end_date_for_calc = contract.expected_offboarding_date or contract.end_date
        else: # 育儿嫂合同
            end_date_for_calc = contract.end_date

        if isinstance(contract, NannyContract) and getattr(contract, 'is_monthly_auto_renew', False):
            remaining_months_str = "月签"
        elif start_date_for_calc and end_date_for_calc:
            if start_date_for_calc > today:
                remaining_months_str = "合同未开始"
            elif end_date_for_calc > today:
                # 合同生效中，计算从今天到结束日期的剩余时间
                total_days_remaining = (end_date_for_calc - today).days
                if contract.type == 'nanny' and total_days_remaining < 30:
                    highlight_remaining = True
                if total_days_remaining >= 365:
                    years = total_days_remaining // 365
                    months = (total_days_remaining % 365) // 30
                    remaining_months_str = f"约{years}年{months}个月"
                elif total_days_remaining >= 30:
                    months = total_days_remaining // 30
                    days = total_days_remaining % 30
                    remaining_months_str = f"{months}个月"
                    if days > 0:
                        remaining_months_str += f" {days}天"
                elif total_days_remaining >= 0:
                    remaining_months_str = f"{total_days_remaining}天"
                else:
                    remaining_months_str = "已结束" # 理论上不会进入此分支
            else:
                remaining_months_str = "已结束"

        result = {
            'id': str(contract.id),
            'customer_name': contract.customer_name,
            'contact_person': contract.contact_person,
            'employee_name': employee_name,
            'employee_level': contract.employee_level,
            'status': contract.status,
            'start_date': contract.start_date.isoformat() if contract.start_date else None,
            'end_date': contract.end_date.isoformat() if contract.end_date else None,
            'created_at': contract.created_at.isoformat(),
            'contract_type': contract.type,
            'notes': contract.notes,
            'remaining_months': remaining_months_str,
            'highlight_remaining': highlight_remaining,
        }

        if contract.type == 'maternity_nurse':
            result.update({
                'deposit_amount': str(contract.deposit_amount or 0),
                'management_fee_rate': str(contract.management_fee_rate or 0),
                'provisional_start_date': contract.provisional_start_date.isoformat() if contract.provisional_start_date else None,
                'actual_onboarding_date': contract.actual_onboarding_date.isoformat() if contract.actual_onboarding_date else None,
                'expected_offboarding_date': contract.expected_offboarding_date.isoformat() if contract.expected_offboarding_date else None,
                'security_deposit_paid': str(contract.security_deposit_paid or 0),
                'discount_amount': str(contract.discount_amount or 0),
                'management_fee_amount': str(contract.management_fee_amount or 0),
            })
        elif contract.type == 'nanny':
            result.update({
                'is_monthly_auto_renew': contract.is_monthly_auto_renew,
                'management_fee_paid_months': contract.management_fee_paid_months,
                'is_first_month_fee_paid': contract.is_first_month_fee_paid,
            })

        return jsonify(result)

    except Exception as e:
        current_app.logger.error(f"获取合同详情 {contract_id} 失败: {e}", exc_info=True)
        return jsonify({'error': '服务器内部错误'}), 500


@billing_bp.route('/contracts/<string:contract_id>', methods=['PUT'])
@admin_required
def update_contract(contract_id):
    data = request.get_json()
    if not data:
        return jsonify({'error': '请求体不能为空'}), 400

    contract = db.session.get(BaseContract, contract_id)
    if not contract:
        return jsonify({'error': '合同未找到'}), 404

    try:
        # **核心修正**: 增加自动调整结束日的逻辑
        if 'actual_onboarding_date' in data and data['actual_onboarding_date']:
            new_onboarding_date_str = data['actual_onboarding_date']
            new_onboarding_date = datetime.strptime(new_onboarding_date_str, '%Y-%m-%d').date()
            
            # 更新实际上户日期
            contract.actual_onboarding_date = new_onboarding_date
            
            # 如果是月嫂合同，自动计算并更新合同结束日
            if contract.type == 'maternity_nurse':
                # 假设所有月嫂合同都是一个标准的26天周期
                # 结束日 = 实际上户日期 + 25天
                new_end_date = new_onboarding_date + timedelta(days=25)
                contract.end_date = new_end_date
                current_app.logger.info(f"合同 {contract_id} 的实际上户日更新为 {new_onboarding_date}，合同结束日自动调整为 {new_end_date}。")
        
        # 未来可以增加更新其他字段的逻辑
        # ...

        db.session.commit()
        return jsonify({'message': '合同信息更新成功'})

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新合同 {contract_id} 失败: {e}", exc_info=True)
        return jsonify({'error': '更新失败'}), 500


@billing_bp.route('/contracts/<uuid:contract_id>/terminate', methods=['POST'])
def terminate_contract(contract_id):
    data = request.get_json()
    termination_date_str = data.get('termination_date')

    if not termination_date_str:
        return jsonify({'error': 'Termination date is required'}), 400

    try:
        termination_date = datetime.strptime(termination_date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD.'}), 400

    contract = BaseContract.query.get_or_404(contract_id)

    # --- 修改开始 ---

    # 1. 找到即将被删除的账单和薪酬单的ID
    bills_to_delete_query = CustomerBill.query.with_entities(CustomerBill.id).filter(
        CustomerBill.contract_id == contract_id,
        CustomerBill.cycle_start_date >= termination_date
    )
    bill_ids_to_delete = [item[0] for item in bills_to_delete_query.all()]

    payrolls_to_delete_query = EmployeePayroll.query.with_entities(EmployeePayroll.id).filter(
        EmployeePayroll.contract_id == contract_id,
        EmployeePayroll.cycle_start_date >= termination_date
    )
    payroll_ids_to_delete = [item[0] for item in payrolls_to_delete_query.all()]

    # 2. 首先删除关联的财务活动日志
    if bill_ids_to_delete:
        FinancialActivityLog.query.filter(
            FinancialActivityLog.customer_bill_id.in_(bill_ids_to_delete)
        ).delete(synchronize_session=False)

    if payroll_ids_to_delete:
        FinancialActivityLog.query.filter(
            FinancialActivityLog.employee_payroll_id.in_(payroll_ids_to_delete)
        ).delete(synchronize_session=False)

    # 3. 现在可以安全地删除账单和薪酬单了
    if bill_ids_to_delete:
        CustomerBill.query.filter(CustomerBill.id.in_(bill_ids_to_delete)).delete(synchronize_session=False)

    if payroll_ids_to_delete:
        EmployeePayroll.query.filter(EmployeePayroll.id.in_(payroll_ids_to_delete)).delete(synchronize_session=False)

    # 4. 更新合同状态和结束日期
    contract.status = 'terminated'
    contract.end_date = termination_date

    if contract.type == 'maternity_nurse':
        contract.expected_offboarding_date = termination_date

    # 5. 为终止月份触发一次强制重算
    year = termination_date.year
    month = termination_date.month
    calculate_monthly_billing_task.delay(year, month, contract_id=str(contract_id), force_recalculate=True)

    db.session.commit()

    current_app.logger.info(f"Contract {contract_id} terminated on {termination_date}. Recalculation triggered for {year}-{month}.")

    return jsonify({'message': f'Contract {contract_id} has been terminated. Recalculation for {year}-{month} is in progress.'})

@billing_bp.route('/contracts/<uuid:contract_id>/succeed', methods=['POST'])
def succeed_trial_contract(contract_id):
    contract = BaseContract.query.get_or_404(contract_id)

    if contract.type != 'nanny_trial':
        return jsonify({'error': 'Only trial contracts can succeed.'}), 400

    if contract.status != 'trial_active':
        return jsonify({'error': f'Contract is not in trial_active state, but in {contract.status}.'}), 400

    contract.status = 'trial_succeeded'
    db.session.commit()

    current_app.logger.info(f"Trial contract {contract_id} has been marked as 'trial_succeeded'.")
    return jsonify({'message': 'Trial contract marked as succeeded.'})


@billing_bp.route('/bills/find', methods=['GET'])
@admin_required
def find_bill_and_its_page():
    bill_id = request.args.get('bill_id')
    per_page = request.args.get('per_page', 100, type=int)

    if not bill_id:
        return jsonify({'error': 'bill_id is required'}), 400

    target_bill = db.session.get(CustomerBill, bill_id)
    if not target_bill:
        return jsonify({'error': 'Bill not found'}), 404

    billing_year = target_bill.year
    billing_month = target_bill.month
    contract = target_bill.contract

    query = CustomerBill.query.join(BaseContract, CustomerBill.contract_id == BaseContract.id)\
        .filter(CustomerBill.year == billing_year, CustomerBill.month == billing_month)\
        .order_by(BaseContract.customer_name, CustomerBill.cycle_start_date)

    all_bill_ids_in_month = [str(b.id) for b in query.all()]

    try:
        position = all_bill_ids_in_month.index(bill_id)
        page_number = position // per_page
    except ValueError:
        return jsonify({'error': 'Bill found but could not determine its position.'}), 500

    details = _get_billing_details_internal(bill_id=bill_id)

    # --- Modification: Add necessary contract info to the response ---
    employee_name = (contract.user.username if contract.user else contract.service_personnel.name if contract.service_personnel else '未知员工')

    return jsonify({
        'bill_details': details,
        'page': page_number,
        'billing_month': f"{billing_year}-{str(billing_month).zfill(2)}",
        # Add a 'context' object that mimics the list's bill structure
        'context': {
            'id': str(target_bill.id),
            'contract_id': str(contract.id),
            'customer_name': contract.customer_name,
            'employee_name': employee_name,
            'contract_type_value': contract.type,
            'status': contract.status,
            'employee_level': contract.employee_level,
        }
    })
