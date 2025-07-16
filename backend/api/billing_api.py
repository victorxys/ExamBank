# backend/api/billing_api.py (添加考勤录入API)

from flask import Blueprint, jsonify, current_app, request
from flask_jwt_extended import jwt_required
from sqlalchemy import or_, case, and_, func
from sqlalchemy.orm import with_polymorphic, attributes
from sqlalchemy.exc import IntegrityError
from flask_jwt_extended import get_jwt_identity


from datetime import date, timedelta
from datetime import datetime
import decimal
D = decimal.Decimal

# --- 新增 AttendanceRecord 的导入 ---
from backend.models import (
    db, BaseContract, User, ServicePersonnel, NannyContract, MaternityNurseContract, 
    AttendanceRecord, CustomerBill, EmployeePayroll, FinancialAdjustment,FinancialActivityLog
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


def _get_billing_details_internal(contract_id, year, month):
    """
    一个内部辅助函数，用于获取指定合同和月份的完整财务详情。
    严格按照最终确认的业务逻辑和前端展示需求进行数据组装。
    """
    current_app.logger.info(f"--- [DETAILS START] 开始获取详情 for {contract_id} / {year}-{month} ---")

    # 1. 查询基础对象
    contract = db.session.query(with_polymorphic(BaseContract, "*")).filter(BaseContract.id == contract_id).first()
    if not contract:
        current_app.logger.error(f"[DETAILS] 合同 {contract_id} 未找到。")
        return None

    customer_bill = CustomerBill.query.filter_by(contract_id=contract_id, year=year, month=month).first()
    employee_payroll = EmployeePayroll.query.filter_by(contract_id=contract_id, year=year, month=month).first()
    
    # **核心修正 1**: 查询所有关联的财务调整项
    customer_adjustments = []
    employee_adjustments = []
    if customer_bill:
        customer_adjustments = FinancialAdjustment.query.filter_by(customer_bill_id=customer_bill.id).all()
    if employee_payroll:
        employee_adjustments = FinancialAdjustment.query.filter_by(employee_payroll_id=employee_payroll.id).all()

    # 2. 初始化返回的字典结构
    customer_bill_details = {}
    employee_payroll_details = {}
    
    # 3. 填充客户账单详情
    if isinstance(contract, MaternityNurseContract):
        # 合同基础信息
        customer_bill_details['级别'] = str(contract.employee_level or 0)
        customer_bill_details['定金'] = str(contract.deposit_amount or 0)
        customer_bill_details['客交保证金'] = str(contract.security_deposit_paid or 0)
        
        # 劳务时间段计算
        active_cycle_start, active_cycle_end = None, None
        if contract.actual_onboarding_date:
            # ... (此部分时间段计算逻辑保持不变)
            first_day_of_month = date(year, month, 1)
            last_day_of_month = (first_day_of_month.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
            cycle_start = contract.actual_onboarding_date
            while cycle_start <= (contract.end_date or last_day_of_month):
                cycle_end = cycle_start + timedelta(days=25)
                if cycle_start <= last_day_of_month and cycle_end >= first_day_of_month:
                    active_cycle_start, active_cycle_end = cycle_start, cycle_end
                    break
                cycle_start = cycle_end + timedelta(days=1)
        customer_bill_details['劳务时间段'] = f"{active_cycle_start.isoformat() if active_cycle_start else 'N/A'} ~ {active_cycle_end.isoformat() if active_cycle_end else 'N/A'}"
        
        # 根据是否存在账单记录来填充
        if customer_bill:
            calc = customer_bill.calculation_details or {}
            payment = customer_bill.payment_details or {}
            invoice = calc.get('invoice_details', {})
            customer_bill_details['id'] = str(customer_bill.id)
            
            # 本期输入
            customer_bill_details['加班天数'] = calc.get('overtime_days', '0')
            customer_bill_details['出勤总天数'] = f"{calc.get('total_days_worked', 'N/A')}天"
            # 费用明细
            customer_bill_details['管理费率'] = f"{int(D(calc.get('management_fee_rate', 0)) * 100)}%"
            customer_bill_details['管理费'] = calc.get('management_fee', '0.00')
            customer_bill_details['基本劳务费'] = calc.get('base_labor_payout_for_employee', '0.00')
            customer_bill_details['加班工资'] = calc.get('overtime_payout', '0.00')
            
            # **核心修正 2**: 动态填充财务调整项
            # 先用0初始化，再用数据库中的真实值覆盖
            customer_bill_details['优惠'] = calc.get('discount', '0.00')
            customer_bill_details['客增加款'] = calc.get('customer_increase', '0.00')
            customer_bill_details['退客户款'] = calc.get('customer_decrease', '0.00')
            

            # 最终结算
            customer_bill_details['客应付款'] = str(customer_bill.total_payable)
            # **核心修正 3**: 读取结算和发票详情
            customer_bill_details['是否打款'] = '是' if customer_bill.is_paid else '否'
            customer_bill_details['打款时间及渠道'] = f"{payment.get('payment_date', '') or '—'} / {payment.get('payment_channel', '') or '—'}" if customer_bill.is_paid else "—"

            

            if not invoice.get('needed'):
                customer_bill_details['发票记录'] = '无需开票'
            else:
                customer_bill_details['发票记录'] = '已开票' if invoice.get('issued') else '待开票'
                inv_num = payment.get('invoice_number') or '未录入'
                inv_date = payment.get('invoice_date') or '未录入'
                inv_amount = payment.get('invoice_amount') or '未录入'
                customer_bill_details['发票记录'] = f"已开票 (开票金额: {inv_amount},发票号: {inv_num}, 日期: {inv_date})"
        else:
            # 如果没有账单记录，填充“待计算”
            customer_bill_details.update({
                '加班天数': '0', '出勤总天数': '待计算',
                '管理费率': '待计算', '管理费': '待计算',
                '基本劳务费': '待计算', '加班工资': '待计算',
                '优惠': str(contract.discount_amount or 0),
                '客增加款': "0.00", '退客户款': "0.00",
                '客应付款': '待计算', '是否打款': '否',
                '打款时间及渠道': "—", '发票记录': "—"
            })

    # 4. 填充员工薪酬详情
    if employee_payroll:
        calc = employee_payroll.calculation_details or {}
        payout = employee_payroll.payout_details or {}
        employee_payroll_details['id'] = str(employee_payroll.id)

        
        employee_payroll_details['萌嫂保证金(工资)'] = calc.get('base_labor_payout_for_employee', '0.00')
        employee_payroll_details['加班费'] = calc.get('overtime_payout', '0.00')
        employee_payroll_details['5%奖励'] = "0.00"
        
        employee_payroll_details['萌嫂增款'] = calc.get('employee_increase', '0.00')
        employee_payroll_details['萌嫂增款'] = calc.get('employee_increase', '0.00')

        employee_payroll_details['萌嫂应领款'] = str(employee_payroll.final_payout)
        employee_payroll_details['是否领款'] = '是' if employee_payroll.is_paid else '否'
        employee_payroll_details['领款时间及渠道'] = f"{payout.get('date', '') or '—'} / {payout.get('channel', '') or '—'}" if employee_payroll.is_paid else "—"
        employee_payroll_details['实际领款'] = "—"
        employee_payroll_details['萌嫂结余'] = "0.00"
        employee_payroll_details['备注'] = "—"
    else:
        # 如果没有薪酬记录，填充“待计算”
        employee_payroll_details.update({
            '萌嫂保证金(工资)': "待计算", '加班费': "待计算", '5%奖励': "待计算",
            '萌嫂增款': "0.00", '减萌嫂款': "0.00",
            '萌嫂应领款': "待计算", '是否领款': '否',
            '领款时间及渠道': "—", '实际领款': "—", '萌嫂结余': "0.00", '备注': "—"
        })
        
    # 5. 填充考勤详情 (用于前端输入框回显)
    # 这个逻辑是独立的，只为了填充考勤输入框
    attendance_record = AttendanceRecord.query.filter_by(contract_id=contract_id, cycle_start_date=active_cycle_start).first()
    attendance_details = {'overtime_days': attendance_record.overtime_days if attendance_record else 0}

    current_app.logger.info(f"--- [DETAILS END] 获取详情结束 ---")
    # **核心修正**: 返回完整的发票详情，供前端编辑框使用
    invoice_details_for_edit = {}
    if customer_bill and customer_bill.payment_details:
        invoice_details_for_edit = {
            "number": customer_bill.payment_details.get('invoice_number', ''),
            "amount": customer_bill.payment_details.get('invoice_amount', ''),
            "date": customer_bill.payment_details.get('invoice_date', None),
        }
    
    return {
        'attendance': attendance_details,
        'customer_bill_details': customer_bill_details,
        'employee_payroll_details': employee_payroll_details,
        'adjustments': [
            {
                "id": str(adj.id), "adjustment_type": adj.adjustment_type.name, 
                "amount": str(adj.amount), "description": adj.description
            } for adj in customer_adjustments + employee_adjustments
        ],
        "invoice_details": invoice_details_for_edit
    }

    # 6. **核心修正 4**: 返回从数据库查询到的调整项列表
    return {
        'attendance': attendance_details,
        'customer_bill_details': customer_bill_details,
        'employee_payroll_details': employee_payroll_details,
        'adjustments': [
            {
                "id": str(adj.id), "adjustment_type": adj.adjustment_type.name, 
                "amount": str(adj.amount), "description": adj.description
            } for adj in customer_adjustments + employee_adjustments
        ],
        "invoice_details": invoice_details_for_edit
    }

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
        
        latest_details = _get_billing_details_internal(contract_id, billing_year, billing_month)
        
        return jsonify({
            'message': f"{msg}，账单已自动重算。",
            'latest_details': latest_details
        })

    except Exception as e:
        current_app.logger.error(f"保存考勤记录失败: {e}", exc_info=True)
        return jsonify({'error': '服务器内部错误'}), 500

@billing_bp.route('/contracts', methods=['GET'])
@admin_required
def get_contracts():
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 10, type=int)
        search_term = request.args.get('search', '').strip()
        contract_type = request.args.get('type', '')
        status = request.args.get('status', '')
        billing_month_str = request.args.get('billing_month')

        # **新增**: 获取支付状态筛选参数
        payment_status = request.args.get('payment_status', '') # e.g., 'paid', 'unpaid'
        payout_status = request.args.get('payout_status', '')   # e.g., 'paid', 'unpaid'

        if not billing_month_str:
            return jsonify({'error': '必须提供账单月份 (billing_month) 参数'}), 400
        
        billing_year, billing_month = map(int, billing_month_str.split('-'))
        first_day_of_month = date(billing_year, billing_month, 1)
        next_month_first_day = (first_day_of_month.replace(day=28) + timedelta(days=4)).replace(day=1)
        last_day_of_month = next_month_first_day - timedelta(days=1)
        
        # --- 核心修正：构建一个能够处理两种合同类型的查询 ---
        
        # 1. 查询所有符合基础条件的合同 (类型, 状态, 搜索)
        base_query = BaseContract.query.join(User, BaseContract.user_id == User.id, isouter=True) \
            .join(ServicePersonnel, BaseContract.service_personnel_id == ServicePersonnel.id, isouter=True)

        if status:
            base_query = base_query.filter(BaseContract.status == status)
        if contract_type:
            base_query = base_query.filter(BaseContract.type == contract_type)
        if search_term:
            base_query = base_query.filter(
                db.or_(
                    BaseContract.customer_name.ilike(f'%{search_term}%'),
                    User.username.ilike(f'%{search_term}%'),
                    ServicePersonnel.name.ilike(f'%{search_term}%')
                )
            )
        base_query = base_query.filter(CustomerBill.year == billing_year, CustomerBill.month == billing_month)
        all_candidate_contracts = base_query.all()
        
        # 2. 在 Python 中进行精细的日期过滤
        valid_contract_ids = []
        for contract in all_candidate_contracts:
            # 育儿嫂合同的逻辑：生命周期与本月有重叠
            if contract.type == 'nanny':
                # 合同开始日在本月之后，或结束日在本月之前，则排除
                if (contract.start_date and contract.start_date > last_day_of_month) or \
                   (contract.end_date and contract.end_date < first_day_of_month):
                    continue
                valid_contract_ids.append(contract.id)
            
            # 月嫂合同的逻辑：26天周期结束日落于本月
            elif contract.type == 'maternity_nurse':
                if not contract.actual_onboarding_date:
                    continue
                
                cycle_start = contract.actual_onboarding_date
                while cycle_start <= (contract.end_date or last_day_of_month):
                    cycle_end = cycle_start + timedelta(days=25)
                    if cycle_end.year == billing_year and cycle_end.month == billing_month:
                        valid_contract_ids.append(contract.id)
                        break
                    if cycle_end > last_day_of_month:
                        break
                    cycle_start = cycle_end + timedelta(days=1)

        # 3. 使用筛选出的ID列表进行最终的分页查询
        final_query = BaseContract.query.filter(BaseContract.id.in_(valid_contract_ids)).order_by(BaseContract.start_date.desc())
        
        paginated_contracts = final_query.paginate(page=page, per_page=per_page, error_out=False)
        
        # 4. 构建最终的结果列表
        results = []
        for contract in paginated_contracts.items:
            employee_name = (contract.user.username if contract.user else contract.service_personnel.name if contract.service_personnel else '未知员工')
            
            # 单独查询对应的 bill 和 payroll
            bill = CustomerBill.query.filter_by(contract_id=contract.id, year=billing_year, month=billing_month).first()
            payroll = EmployeePayroll.query.filter_by(contract_id=contract.id, year=billing_year, month=billing_month).first()
            
            # 计算 active_cycle_start 和 active_cycle_end
            active_cycle_start, active_cycle_end = None, None
            if contract.type == 'maternity_nurse' and contract.actual_onboarding_date:
                cycle_start = contract.actual_onboarding_date
                while cycle_start <= (contract.end_date or last_day_of_month):
                    cycle_end = cycle_start + timedelta(days=25)
                    if cycle_end.year == billing_year and cycle_end.month == billing_month:
                        active_cycle_start = cycle_start
                        active_cycle_end = cycle_end
                        break
                    if cycle_end > last_day_of_month:
                        break
                    cycle_start = cycle_end + timedelta(days=1)
            
            results.append({
                'id': str(contract.id),
                'bill_id': str(bill.id), # **新增**: 返回 bill.id，以便管理操作
                'customer_name': contract.customer_name,
                'employee_name': employee_name,
                'contract_type_label': '育儿嫂' if contract.type == 'nanny' else '月嫂',
                'contract_type_value': contract.type,
                'status': contract.status,
                'employee_level': contract.employee_level,
                'start_date': contract.start_date.isoformat() if contract.start_date else None,
                'end_date': contract.end_date.isoformat() if contract.end_date else None,
                'provisional_start_date': contract.provisional_start_date.isoformat() if hasattr(contract, 'provisional_start_date') and contract.provisional_start_date else None,
                'active_cycle_start': active_cycle_start.isoformat() if active_cycle_start else None,
                'active_cycle_end': active_cycle_end.isoformat() if active_cycle_end else None,
                'current_month_payable': str(bill.total_payable) if bill else '待计算'
            })
            
        return jsonify({
            'items': results, 'total': paginated_contracts.total, 'page': paginated_contracts.page,
            'per_page': paginated_contracts.per_page, 'pages': paginated_contracts.pages
        })
    except Exception as e:
        current_app.logger.error(f"获取合同列表失败: {e}", exc_info=True)
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
    # 这个视图函数现在非常简洁
    contract_id, year, month = request.args.get('contract_id'), request.args.get('year', type=int), request.args.get('month', type=int)
    if not all([contract_id, year, month]):
        return jsonify({'error': '缺少参数'}), 400
    try:
        details = _get_billing_details_internal(contract_id, year, month)
        if details is None:
            return jsonify({'error': '合同未找到'}), 404
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
    contract = BaseContract.query.get(str(contract_id))
    if not contract:
        return jsonify({'error': '合同未找到'}), 404
        
    data = request.get_json()
    if not data:
        return jsonify({'error': '缺少更新数据'}), 400

    try:
        # 我们目前只处理 actual_onboarding_date 的更新
        if 'actual_onboarding_date' in data:
            new_onboarding_date_str = data['actual_onboarding_date']
            new_onboarding_date = datetime.strptime(new_onboarding_date_str, '%Y-%m-%d').date()
            if new_onboarding_date:
                # 确保是MaternityNurseContract才有这个字段
                if isinstance(contract, MaternityNurseContract):
                    contract.actual_onboarding_date = new_onboarding_date
                    date_difference = new_onboarding_date - contract.provisional_start_date
                    new_expected_offboarding_date = contract.end_date + date_difference
                    contract.expected_offboarding_date = new_expected_offboarding_date
                    current_app.logger.info(
                        f"合同 {contract_id} 上户日更新为 {new_onboarding_date} (与预产期差 {date_difference.days} 天)，"
                        f"预计下户日期推算为 {new_expected_offboarding_date}。"
                    )
                else:
                    return jsonify({'error': '只有月嫂合同才能设置实际上户日期'}), 400
            else:
                 if isinstance(contract, MaternityNurseContract):
                    contract.actual_onboarding_date = None
                    
        # 未来可以在这里添加对其他字段的更新
        # if 'status' in data:
        #     contract.status = data['status']
            
        db.session.commit()
        return jsonify({'message': '合同信息更新成功'})
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新合同 {contract_id} 失败: {e}", exc_info=True)
        return jsonify({'error': '更新合同失败，服务器内部错误'}), 500
    

@billing_bp.route('/batch-update', methods=['POST'])
@admin_required
def batch_update_billing_details():
    data = request.get_json()
    current_app.logger.info(f"[BATCH-UPDATE-0] 收到批量更新请求: {data}")
    required_fields = ['contract_id', 'billing_year', 'billing_month', 'overtime_days', 'adjustments', 'settlement_status', 'cycle_start_date', 'cycle_end_date']
    if not all(field in data for field in required_fields):
        return jsonify({'error': '请求体中缺少必要字段'}), 400

    try:
        contract_id = data['contract_id']
        billing_year = data['billing_year']
        billing_month = data['billing_month']
        
        # --- 1. 更新或创建考勤记录 ---
        cycle_start = datetime.strptime(data['cycle_start_date'], '%Y-%m-%d').date()
        cycle_end = datetime.strptime(data['cycle_end_date'], '%Y-%m-%d').date()
        overtime_days = data['overtime_days']

        

        contract = db.session.get(BaseContract, contract_id)
        if not contract:
            return jsonify({'error': '合同未找到'}), 404

        # **核心修正**: 检查考勤记录是否存在，如果不存在则创建
        attendance_record = AttendanceRecord.query.filter_by(contract_id=contract_id, cycle_start_date=cycle_start).first()
        if not attendance_record:
            current_app.logger.info(f"未找到合同 {contract_id} 在周期 {cycle_start} 的考勤记录，将创建新的记录。")
            employee_id = contract.user_id or contract.service_personnel_id
            if not employee_id:
                return jsonify({'error': '合同未关联员工，无法创建考勤'}), 400
            attendance_record = AttendanceRecord(
                employee_id=employee_id,
                contract_id=contract_id,
                cycle_start_date=cycle_start,
                cycle_end_date=cycle_end
            )
            db.session.add(attendance_record)

        # 现在可以安全地更新 overtime_days
        attendance_record.overtime_days = overtime_days
        attendance_record.total_days_worked = 26 + overtime_days
        attendance_record.statutory_holiday_days = 0 # 清理旧数据
        
        current_app.logger.info(f"[BATCH-UPDATE-0.01] 考勤记录查询结果: {attendance_record.overtime_days}")

        bill = CustomerBill.query.filter_by(contract_id=contract_id, year=billing_year, month=billing_month).first()
        

        payroll = EmployeePayroll.query.filter_by(contract_id=contract_id, year=billing_year, month=billing_month).first()
        

        # --- 2. 获取或创建账单/薪酬单 ---
       
        if not bill:
            bill = CustomerBill(
                contract_id=contract_id,
                year=billing_year,
                month=billing_month,
                customer_name=contract.customer_name,
                total_payable=0,
                is_paid=False,
                payment_details={}, # 提供默认空字典
                calculation_details={} # **核心修正**: 提供默认空字典
            )
            db.session.add(bill)
        
        
        if not payroll:
            employee_id = contract.user_id or contract.service_personnel_id
            if not employee_id:
                return jsonify({'error': '合同未关联员工'}), 400
            payroll = EmployeePayroll(
                contract_id=contract_id,
                year=billing_year,
                month=billing_month,
                employee_id=employee_id,
                final_payout=0,
                is_paid=False,
                payout_details={}, # 提供默认空字典
                calculation_details={} # **核心修正**: 提供默认空字典
            )
            db.session.add(payroll)

        
        if not attendance_record:
            employee_id = contract.user_id or contract.service_personnel_id
            if not employee_id:
                return jsonify({'error': '合同未关联员工'}), 400
            attendance_record = AttendanceRecord(
                employee_id=employee_id, contract_id=contract_id,
                cycle_start_date=cycle_start, cycle_end_date=cycle_end
            )
            db.session.add(attendance_record)

        old_overtime = attendance_record.overtime_days if attendance_record else 0
        old_settlement = {
            'customer_is_paid': bill.is_paid,
            'employee_is_paid': payroll.is_paid,
            'customer_payment_date': (bill.payment_details or {}).get('payment_date', None),
            'employee_payout_date': (payroll.payout_details or {}).get('date', None),
            'customer_payment_channel': (bill.payment_details or {}).get('payment_channel', None),
            'employee_payout_channel': (payroll.payout_details or {}).get('channel', None),
            'invoice_number': (bill.payment_details or {}).get('invoice_number', None),
            'invoice_amount': (bill.payment_details or {}).get('invoice_amount', None),
            'invoice_date': (bill.payment_details or {}).get('invoice_date', None),
            'invoice_needed': (bill.payment_details or {}).get('invoice_needed', False),
            'invoice_issued': (bill.payment_details or {}).get('invoice_issued', False)
        }
        # 财务调整项旧状态 (构建一个易于查找的字典)
        old_adjustments_query = FinancialAdjustment.query.filter(
            (FinancialAdjustment.customer_bill_id == bill.id) | 
            (FinancialAdjustment.employee_payroll_id == payroll.id)
        ).all()
        old_adjustments_map = {str(adj.id): adj for adj in old_adjustments_query}
        current_app.logger.info(f"[BATCH-UPDATE] 数据库中找到 {len(old_adjustments_map)} 条旧的财务调整项。")

        new_overtime = data['overtime_days']
        current_app.logger.info(f"[BATCH-UPDATE-0.1] 准备更新加班天数: {old_overtime} -> {new_overtime}")
        if old_overtime != new_overtime:
            _log_activity(bill, payroll, f"修改加班天数", {'from': old_overtime, 'to': new_overtime})

        # 获取新的加班天数
        attendance_record.overtime_days = overtime_days
        attendance_record.statutory_holiday_days = 0
        attendance_record.total_days_worked = 26 + overtime_days
        current_app.logger.info(f"[BATCH-UPDATE-0.1] 考勤记录更新: {attendance_record.overtime_days} 加班天数")

        

        

        # 马上 flush，确保 bill 和 payroll 获得 ID，以便关联
        db.session.flush()

        
        # 获取旧的财务调整项，用于比较
        old_adjustments = {f"{adj.adjustment_type.name}_{adj.description}": adj.amount for adj in FinancialAdjustment.query.filter_by(customer_bill_id=bill.id).all()}
   
        
        # --- 3. 处理财务调整项 ---
        adjustments_data = data.get('adjustments', [])
        new_adjustments_map = {adj['id']: adj for adj in adjustments_data if 'temp' not in str(adj.get('id', ''))}
        current_app.logger.info(f"[BATCH-UPDATE-3.1] 准备前台传过来的待处理财务调整项: {new_adjustments_map} ")
        current_app.logger.info(f"[BATCH-UPDATE-3.2] 旧的数据库中已有的财务调整项: {old_adjustments_map.items()}")
         # 找出被删除的项
        for old_id_str, old_adj in old_adjustments_map.items():
            if old_id_str not in new_adjustments_map:
                _log_activity(bill, payroll, action=f"删除了财务调整: {old_adj.description}", details={"amount": str(old_adj.amount),"type": old_adj.adjustment_type.name
            })
        current_app.logger.info(f"[BATCH-UPDATE-3.5] 找到 {adjustments_data} 条旧的财务调整项。")
        # 找出新增或修改的项
        for adj in adjustments_data:
            adj_id_str = str(adj.get('id'))
            if adj_id_str.startswith('temp_'):
                 _log_activity(bill, payroll, action=f"新增了财务调整: {adj.get('description')}", details={'amount': adj.get('amount'), 'type': adj.get('adjustment_type')})
            elif adj_id_str in old_adjustments_map:
                old_adj = old_adjustments_map[adj_id_str]
                # 注意：前端传来的 amount 是字符串，需要转换为 Decimal 再比较
                if old_adj.amount != D(adj.get('amount')) or old_adj.description != adj.get('description'):
                     _log_activity(bill, payroll, action=f"修改了财务调整: {adj.get('description')}", details={"from": str(old_adj.amount), "to": adj.get('amount')})

        current_app.logger.info(f"[BATCH-UPDATE-1] 准备处理 {len(adjustments_data)} 条财务调整项。")

        FinancialAdjustment.query.filter(
            (FinancialAdjustment.customer_bill_id == bill.id) | 
            (FinancialAdjustment.employee_payroll_id == payroll.id)
        ).delete(synchronize_session=False)
        
        for adj in adjustments_data:
            adj_type_str = adj.get('adjustment_type')
            if adj_type_str not in AdjustmentType._member_names_:
                continue
            description = adj.get('description', '')
            current_app.logger.info(f"[BATCH-UPDATE-2] 正在创建调整项: Type={adj_type_str}, Amount={adj.get('amount')}, Description='{description}'")

            amount = D(adj.get('amount', 0))
            

            new_adjustment = FinancialAdjustment(
                adjustment_type=AdjustmentType[adj_type_str],
                amount=D(adj.get('amount', 0)),
                description=description,
                date=date(billing_year, billing_month, 1)
            )
            if 'CUSTOMER' in adj_type_str:
                new_adjustment.customer_bill_id = bill.id
            elif 'EMPLOYEE' in adj_type_str:
                new_adjustment.employee_payroll_id = payroll.id
            db.session.add(new_adjustment)

        # --- 4. 触发账单重算 ---
        # 引擎会读取最新的考勤和财务调整项（因为它们在同一个会话中）
        current_app.logger.info("[BATCH-UPDATE-3] 调用 BillingEngine 进行重算...")
        engine = BillingEngine()
        engine.calculate_for_month(
            year=billing_year, 
            month=billing_month, 
            contract_id=contract_id, 
            force_recalculate=True
        )
        current_app.logger.info("[BATCH-UPDATE-4] BillingEngine 重算完成。")

        
        # --- 5. 在重算之后，再更新结算和发票状态 (核心修正：顺序调整) ---
        settlement_status = data.get('settlement_status', {})
        invoice_details_from_frontend = settlement_status.get('invoice_details', {})
        current_app.logger.info(f"[BATCH-UPDATE-5-0] 准备更新结算状态: {settlement_status}")
    

        current_app.logger.info(f"[BATCH-UPDATE-5] 准备更新结算状态: {settlement_status}")
        current_app.logger.info(f"[BATCH-UPDATE-6] 准备更新发票详情: {invoice_details_from_frontend}")

        # 客户打款状态日志记录
        
        new_customer_paid = settlement_status.get('customer_is_paid', False)
        new_payment_date_str = settlement_status.get('customer_payment_date')
        new_payment_date = new_payment_date_str.split('T')[0] if new_payment_date_str else None
        new_payment_channel = settlement_status.get('customer_payment_channel', '')

        has_payment_change = False
        log_details = {}
        
        # 1. 比较打款状态的变化
        if old_settlement['customer_is_paid'] != new_customer_paid:
            has_payment_change = True
            log_details['是否打款'] = {"from": "未打款", "to": "已打款"} if new_customer_paid else {"from": "已打款", "to": "未打款"}

        # 2. 比较打款日期的变化
        if old_settlement['customer_payment_date'] != new_payment_date:
            has_payment_change = True
            log_details['打款日期'] = {"from": old_settlement['customer_payment_date'], "to": new_payment_date}

        # 3. 比较打款渠道的变化
        if old_settlement['customer_payment_channel'] != new_payment_channel:
            has_payment_change = True
            log_details['打款渠道'] = {"from": old_settlement['customer_payment_channel'], "to": new_payment_channel}

        # 4. 如果有任何变化，则记录一条聚合日志
        if has_payment_change:
            # 动态生成 action 文本
            action_text = "更新了客户打款状态"
            if 'status' in log_details:
                action_text = "标记客户为【已打款】" if new_customer_paid else "将客户标记为【未打款】"
            
            _log_activity(bill, None, action_text, log_details)
        
        # 为了安全，重新从会话中获取最新的 bill 和 payroll 对象
        # 虽然在同一个事务中可能不是必须的，但这是最保险的做法
        final_bill = db.session.get(CustomerBill, bill.id)
        final_payroll = db.session.get(EmployeePayroll, payroll.id)




        
        # 发票状态日志记录
        invoice_details_from_frontend = settlement_status.get('invoice_details', {})
        new_invoice_needed = settlement_status.get('invoice_needed', False)
        new_invoice_issued = settlement_status.get('invoice_issued', False)
        new_invoice_number = invoice_details_from_frontend.get('number', '')
        new_invoice_amount = invoice_details_from_frontend.get('amount', '')
        new_invoice_date = invoice_details_from_frontend.get('date')
        
        has_invoice_change = False
        invoice_log_details = {}

        if old_settlement['invoice_needed'] != new_invoice_needed:
            has_invoice_change = True
            invoice_log_details['需求状态'] = {"from": "不需要" if not old_settlement['invoice_needed'] else "需要", "to": "需要" if new_invoice_needed else "不需要"}
        
        if old_settlement['invoice_issued'] != new_invoice_issued:
            has_invoice_change = True
            invoice_log_details['开具状态'] = {"from": "未开" if not old_settlement['invoice_issued'] else "已开", "to": "已开" if new_invoice_issued else "未开"}
        
        if old_settlement['invoice_number'] != new_invoice_number:
            has_invoice_change = True
            invoice_log_details['发票号'] = {"from": old_settlement['invoice_number'], "to": new_invoice_number}

        if old_settlement['invoice_amount'] != new_invoice_amount:
            has_invoice_change = True
            invoice_log_details['金额'] = {"from": old_settlement['invoice_amount'], "to": new_invoice_amount}

        if old_settlement['invoice_date'] != new_invoice_date:
            has_invoice_change = True
            invoice_log_details['日期'] = {"from": old_settlement['invoice_date'], "to": new_invoice_date}

        if has_invoice_change:
            _log_activity(final_bill, None, "更新了发票信息", invoice_log_details)
        
        
        

        final_bill.is_paid = settlement_status.get('customer_is_paid', False)
        payment_date_str = settlement_status.get('customer_payment_date')

        # **核心修正**: 将所有状态存入 payment_details
        if final_bill.payment_details is None:
            final_bill.payment_details = {}
            
        # final_bill.payment_details['payment_date'] = payment_date_str.split('T')[0] if payment_date_str else None
        # final_bill.payment_details['payment_channel'] = settlement_status.get('customer_payment_channel')

        # final_bill.payment_details['payment_date'] = bill.payment_details['payment_date'] if bill.payment_details['payment_date'] else None
        final_bill.payment_details['payment_date'] = payment_date_str.split('T')[0] if payment_date_str else None
        final_bill.payment_details['payment_channel'] = settlement_status.get('customer_payment_channel')
        
        
        final_bill.payment_details['invoice_needed'] = new_invoice_needed
        final_bill.payment_details['invoice_issued'] = new_invoice_issued
        final_bill.payment_details['invoice_number'] = invoice_details_from_frontend.get('number')
        final_bill.payment_details['invoice_amount'] = invoice_details_from_frontend.get('amount')
        final_bill.payment_details['invoice_date'] = invoice_details_from_frontend.get('date')

        
        attributes.flag_modified(final_bill, "payment_details")
        current_app.logger.info(f"[BATCH-UPDATE-7] 更新后的结算详情: {final_bill.payment_details}")



        # 员工领款状态及日志
        # **核心修正**: 聚合员工领款相关的日志记录
        new_employee_paid = settlement_status.get('employee_is_paid', False)
        new_payout_date_str = settlement_status.get('employee_payout_date')
        new_payout_date = new_payout_date_str.split('T')[0] if new_payout_date_str else None
        new_payout_channel = settlement_status.get('employee_payout_channel', '')
        
        has_payout_change = False
        payout_log_details = {}

        if old_settlement['employee_is_paid'] != new_employee_paid:
            has_payout_change = True
            payout_log_details['员工是否领款'] = {"from": "未领款", "to": "已领款"} if new_employee_paid else {"from": "已领款", "to": "未领款"}
        if old_settlement['employee_payout_date'] != new_payout_date:
            has_payout_change = True
            payout_log_details['员工领款日期'] = {"from": old_settlement['employee_payout_date'], "to": new_payout_date}
        if old_settlement['employee_payout_channel'] != new_payout_channel:
            has_payout_change = True
            payout_log_details['员工领款渠道'] = {"from": old_settlement['employee_payout_channel'], "to": new_payout_channel}
            
        if has_payout_change:
            action_text = "更新了员工领款状态"
            if 'status' in payout_log_details:
                action_text = "标记员工为【已领款】" if new_employee_paid else "将员工标记为【未领款】"
            _log_activity(None, final_payroll, action_text, payout_log_details)

        final_payroll.is_paid = new_employee_paid
        if final_payroll.payout_details is None: final_payroll.payout_details = {}
        final_payroll.payout_details['date'] = new_payout_date
        final_payroll.payout_details['channel'] = new_payout_channel
        attributes.flag_modified(final_payroll, "payout_details")
        


       # 如果 calculation_details 是 None, 初始化为空字典
        if final_bill.calculation_details is None:
            final_bill.calculation_details = {}
            
        # 确保 invoice_details 子字典存在
        if 'invoice_details' not in final_bill.calculation_details:
            final_bill.calculation_details['invoice_details'] = {}
            
        # 更新所有发票相关字段
        final_bill.calculation_details['invoice_details']['needed'] = settlement_status.get('invoice_needed', False)
        final_bill.calculation_details['invoice_details']['issued'] = settlement_status.get('invoice_issued', False)
        # 从前端传来的专用对象中获取详细信息
        final_bill.calculation_details['invoice_details']['number'] = invoice_details_from_frontend.get('number')
        final_bill.calculation_details['invoice_details']['amount'] = invoice_details_from_frontend.get('amount')
        final_bill.calculation_details['invoice_details']['date'] = invoice_details_from_frontend.get('date')
        
        attributes.flag_modified(final_bill, "calculation_details")
        
        # --- 6. 提交所有更改 ---
        db.session.commit()
        current_app.logger.info("--- [BATCH-UPDATE END] 所有更改已成功提交到数据库。 ---")

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"批量更新失败: {e}", exc_info=True)
        return jsonify({'error': '服务器内部错误'}), 500

    # --- 7. 获取并返回最新详情 ---
    latest_details = _get_billing_details_internal(contract_id, billing_year, billing_month)
    return jsonify({
        'message': '所有更改已保存并成功重算！',
        'latest_details': latest_details
    })


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

# backend/api/billing_api.py (最终的、正确的查询构建方式)

@billing_bp.route('/contracts-list', methods=['GET'])
@admin_required
def get_all_contracts():
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 10, type=int)
        search_term = request.args.get('search', '').strip()
        contract_type = request.args.get('type', '')
        status = request.args.get('status', '') # 默认获取所有状态

        # **核心修正**: 采用最标准的 with_polymorphic 查询方式
        
        # 1. 定义多态查询的主体
        contracts_poly = with_polymorphic(BaseContract, [NannyContract, MaternityNurseContract])
        
        # 2. 从这个多态主体开始构建查询
        query = db.session.query(contracts_poly)

        # 3. 应用 eager loading 选项
        query = query.options(
            db.joinedload(contracts_poly.user),
            db.joinedload(contracts_poly.service_personnel)
        )
        
        # 4. 构建连接，用于筛选 (注意：现在要从多态对象上访问 join)
        query = query.join(User, contracts_poly.user_id == User.id, isouter=True) \
                     .join(ServicePersonnel, contracts_poly.service_personnel_id == ServicePersonnel.id, isouter=True)

        # 5. 应用所有筛选条件
        if status:
            query = query.filter(contracts_poly.status == status)
        if contract_type:
            query = query.filter(contracts_poly.type == contract_type)
        if search_term:
            query = query.filter(
                db.or_(
                    contracts_poly.customer_name.ilike(f'%{search_term}%'),
                    User.username.ilike(f'%{search_term}%'),
                    ServicePersonnel.name.ilike(f'%{search_term}%')
                )
            )

        # 6. 应用排序
        query = query.order_by(contracts_poly.provisional_start_date.desc())
        
        # 7. 执行分页
        paginated_contracts = query.paginate(page=page, per_page=per_page, error_out=False)
        
        # 8. 组装返回结果
        results = []
        for contract in paginated_contracts.items:
            employee_name = (contract.user.username if contract.user else contract.service_personnel.name if contract.service_personnel else '未知员工')
            
            actual_onboarding_date = getattr(contract, 'actual_onboarding_date', None)
            provisional_start_date = getattr(contract, 'provisional_start_date', None)

            results.append({
                'id': str(contract.id),
                'customer_name': contract.customer_name,
                'employee_name': employee_name,
                'contract_type_label': '育儿嫂' if contract.type == 'nanny' else '月嫂',
                'contract_type_value': contract.type,
                'status': contract.status,
                'employee_level': contract.employee_level,
                'start_date': contract.start_date.isoformat() if contract.start_date else None,
                'end_date': contract.end_date.isoformat() if contract.end_date else None,
                'actual_onboarding_date': actual_onboarding_date.isoformat() if actual_onboarding_date else None,
                'provisional_start_date': provisional_start_date.isoformat() if provisional_start_date else None,
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
        engine = BillingEngine()
        
        cycle_start = contract.actual_onboarding_date
        processed_months = set() # 用于跟踪已经处理过的月份
        cycle_count = 0
        
        current_app.logger.info(f"[API] 准备进入循环，预计下户日期为: {contract.expected_offboarding_date}")

        # **核心修正**: 循环所有周期
        while cycle_start <= contract.expected_offboarding_date:
            
            # 确定当前周期的结束日
            if (cycle_start + timedelta(days=25)) <= contract.expected_offboarding_date:
                cycle_end = cycle_start + timedelta(days=25)
            else:
                cycle_end = contract.expected_offboarding_date

            settlement_month_key = (cycle_end.year, cycle_end.month)
            
            current_app.logger.info(f"[API] 正在为周期 {cycle_start} ~ {cycle_end} (结算月: {settlement_month_key}) 调用计算引擎...")
            
            # **核心修正**: 每次都独立调用引擎，引擎内部会处理 commit
            engine.calculate_for_month(
                year=settlement_month_key[0], 
                month=settlement_month_key[1], 
                contract_id=contract.id, 
                force_recalculate=True
            )
            
            processed_months.add(settlement_month_key)
            cycle_start = cycle_end + timedelta(days=1)
        # **调试日志**: 检查循环是否会提前结束
        if cycle_end == contract.expected_offboarding_date:
                current_app.logger.info(f"[API LOOP-{cycle_count}] 已到达预计下户日期，这将是最后一次循环。")
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
    bills = CustomerBill.query.filter_by(contract_id=contract_id).order_by(CustomerBill.year, CustomerBill.month).all()
    
    results = []
    for bill in bills:
        calc = bill.calculation_details or {}
        results.append({
            'id': str(bill.id),
            'billing_period': f"{bill.year}-{str(bill.month).zfill(2)}",
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
        # 使用 with_polymorphic 来加载所有子类字段
        query = db.session.query(with_polymorphic(BaseContract, "*"))
        contract = query.filter(BaseContract.id == contract_id).first()

        if not contract:
            return jsonify({'error': '合同未找到'}), 404
            
        # 组装基础信息
        employee_name = (contract.user.username if contract.user else contract.service_personnel.name if contract.service_personnel else '未知员工')
        
        # **核心修正**: 只访问模型中真实存在的字段
        result = {
            'id': str(contract.id),
            'customer_name': contract.customer_name,
            'contact_person': contract.contact_person, # 存在
            # 'contact_phone': contract.contact_phone, # 不存在，已移除
            # 'service_address': contract.service_address, # 不存在，已移除
            'employee_name': employee_name,
            'employee_level': contract.employee_level,
            'status': contract.status,
            'start_date': contract.start_date.isoformat() if contract.start_date else None,
            'end_date': contract.end_date.isoformat() if contract.end_date else None,
            'created_at': contract.created_at.isoformat(),
            'contract_type': contract.type,
            'notes': contract.notes, # 增加了备注字段
        }
        
        # 根据合同类型，添加子类特有的字段
        if contract.type == 'maternity_nurse':
            result.update({
                'deposit_amount': str(contract.deposit_amount or 0),
                'management_fee_rate': str(contract.management_fee_rate or 0),
                'provisional_start_date': contract.provisional_start_date.isoformat() if contract.provisional_start_date else None,
                'actual_onboarding_date': contract.actual_onboarding_date.isoformat() if contract.actual_onboarding_date else None,
                'security_deposit_paid': str(contract.security_deposit_paid or 0),
                'discount_amount': str(contract.discount_amount or 0),
                'management_fee_amount': str(contract.management_fee_amount or 0), # 增加了从金数据同步的管理费金额
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