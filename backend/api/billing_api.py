# backend/api/billing_api.py (添加考勤录入API)

from flask import Blueprint, jsonify, current_app, request
from flask_jwt_extended import jwt_required
from sqlalchemy import or_, case, and_, func
from sqlalchemy.orm import with_polymorphic, attributes
from sqlalchemy.exc import IntegrityError

from datetime import date, timedelta
from datetime import datetime
import decimal
D = decimal.Decimal

# --- 新增 AttendanceRecord 的导入 ---
from backend.models import (
    db, BaseContract, User, ServicePersonnel, NannyContract, MaternityNurseContract, 
    AttendanceRecord, CustomerBill, EmployeePayroll, FinancialAdjustment
)
from backend.tasks import sync_all_contracts_task, calculate_monthly_billing_task # 导入新任务
from backend.services.billing_engine import BillingEngine
from backend.models import FinancialAdjustment, AdjustmentType

billing_bp = Blueprint('billing_api', __name__, url_prefix='/api/billing')

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
            customer_bill_details['打款时间及渠道'] = f"{payment.get('date', '') or '—'} / {payment.get('channel', '') or '—'}" if customer_bill.is_paid else "—"

            

            if not invoice.get('needed'):
                customer_bill_details['发票记录'] = '无需开票'
            else:
                customer_bill_details['发票记录'] = '已开票' if invoice.get('issued') else '待开票'
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
        "invoice_details": calc.get('invoice_details', {}) if customer_bill else {}
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
    """
    手动触发指定月份的账单计算后台任务。
    请求体: { "year": 2025, "month": 7 }
    """
    data = request.get_json()
    if not data or 'year' not in data or 'month' not in data:
        return jsonify({'error': '请提供 year 和 month'}), 400
    
    try:
        year = int(data['year'])
        month = int(data['month'])
        task = calculate_monthly_billing_task.delay(year, month)
        current_app.logger.info(f"手动触发 {year}-{month} 的账单计算任务，Task ID: {task.id}")
        return jsonify({
            'message': f'已为 {year}-{month} 提交账单计算任务。',
            'task_id': task.id
        }), 202
    except (ValueError, TypeError):
        return jsonify({'error': 'year 和 month 必须是有效的数字'}), 400
    except Exception as e:
        current_app.logger.error(f"提交账单计算任务失败: {e}", exc_info=True)
        return jsonify({'error': '提交后台任务时发生错误'}), 500
    




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

        if not billing_month_str:
            return jsonify({'error': '必须提供账单月份 (billing_month) 参数'}), 400
        
        billing_year, billing_month = map(int, billing_month_str.split('-'))
        first_day_of_month = date(billing_year, billing_month, 1)
        next_month_first_day = (first_day_of_month.replace(day=28) + timedelta(days=4)).replace(day=1)
        last_day_of_month = next_month_first_day - timedelta(days=1)
        
        contracts_polymorphic = with_polymorphic(BaseContract, [NannyContract, MaternityNurseContract])
        
        # --- 核心修正：这是一个纯粹的合同查询，不再关联账单 ---
        query = db.session.query(contracts_polymorphic)

        start_date_col = case(
            (
                BaseContract.type == 'maternity_nurse', 
                func.coalesce(
                    MaternityNurseContract.actual_onboarding_date, 
                    MaternityNurseContract.provisional_start_date
                )
            ),
            (BaseContract.type == 'nanny', NannyContract.start_date),
            else_=None
        )
        end_date_col = BaseContract.end_date

        # 应用日期筛选
        query = query.filter(
            start_date_col != None,
            start_date_col <= last_day_of_month,
            or_(
                end_date_col == None,
                end_date_col >= first_day_of_month
            )
        )
        
        if contract_type: query = query.filter(BaseContract.type == contract_type)
        if status: query = query.filter(BaseContract.status == status)
        else: query = query.filter(BaseContract.status == 'active')

        if search_term:
            query = query.join(User, BaseContract.user_id == User.id, isouter=True)\
                         .join(ServicePersonnel, BaseContract.service_personnel_id == ServicePersonnel.id, isouter=True)\
                         .filter(or_(
                             BaseContract.customer_name.ilike(f'%{search_term}%'),
                             User.username.ilike(f'%{search_term}%'),
                             ServicePersonnel.name.ilike(f'%{search_term}%')
                         ))
        
        query = query.order_by(start_date_col.desc().nullslast(), BaseContract.created_at.desc())
        
        paginated_contracts = query.paginate(page=page, per_page=per_page, error_out=False)
        results = []
        for contract in paginated_contracts.items:
            employee_name = (contract.user.username if contract.user else contract.service_personnel.name if contract.service_personnel else '未知员工')
            # +++ 新增：为月嫂合同计算当前账单月的服务周期 +++
            active_cycle_start, active_cycle_end = None, None
            if contract.type == 'maternity_nurse' and contract.actual_onboarding_date:
                cycle_start = contract.actual_onboarding_date
                # 确保 contract.end_date 不为 None
                contract_end = contract.end_date or last_day_of_month 
                while cycle_start <= contract_end:
                    cycle_end = cycle_start + timedelta(days=25)
                    # 使用与引擎相同的重叠逻辑
                    if cycle_start <= last_day_of_month and cycle_end >= first_day_of_month:
                        active_cycle_start = cycle_start
                        active_cycle_end = cycle_end
                        break
                    cycle_start = cycle_end + timedelta(days=1)
            # +++++++++++++++++++++++++++++++++++++++++++++++
            results.append({
                'id': str(contract.id), 'customer_name': contract.customer_name,
                'employee_name': employee_name, 
                'contract_type_label': '育儿嫂' if contract.type == 'nanny' else '月嫂',
                'contract_type_value': contract.type, # 增加一个原始值方便前端判断
                'status': contract.status, 
                'employee_level': contract.employee_level,
                'start_date': contract.start_date.isoformat() if contract.start_date else None,
                'end_date': contract.end_date.isoformat() if contract.end_date else None,
                # --- 月嫂专用日期 (之前遗漏的) ---
                'provisional_start_date': contract.provisional_start_date.isoformat() if hasattr(contract, 'provisional_start_date') and contract.provisional_start_date else None,
                'actual_onboarding_date': contract.actual_onboarding_date.isoformat() if hasattr(contract, 'actual_onboarding_date') and contract.actual_onboarding_date else None,
                # +++ 新增返回字段 +++
                'active_cycle_start': active_cycle_start.isoformat() if active_cycle_start else None,
                'active_cycle_end': active_cycle_end.isoformat() if active_cycle_end else None,
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
            date_str = data['actual_onboarding_date']
            if date_str:
                # 确保是MaternityNurseContract才有这个字段
                if isinstance(contract, MaternityNurseContract):
                    contract.actual_onboarding_date = datetime.strptime(date_str, '%Y-%m-%d').date()
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

        attendance_record = AttendanceRecord.query.filter_by(contract_id=contract_id, cycle_start_date=cycle_start).first()
        if not attendance_record:
            employee_id = contract.user_id or contract.service_personnel_id
            if not employee_id:
                return jsonify({'error': '合同未关联员工'}), 400
            attendance_record = AttendanceRecord(
                employee_id=employee_id, contract_id=contract_id,
                cycle_start_date=cycle_start, cycle_end_date=cycle_end
            )
            db.session.add(attendance_record)
        attendance_record.overtime_days = overtime_days
        attendance_record.statutory_holiday_days = 0
        attendance_record.total_days_worked = 26 + overtime_days

        # --- 2. 获取或创建账单/薪酬单 ---
        bill = CustomerBill.query.filter_by(contract_id=contract_id, year=billing_year, month=billing_month).first()
        if not bill:
            bill = CustomerBill(contract_id=contract_id, year=billing_year, month=billing_month, customer_name=contract.customer_name, total_payable=0, calculation_details={})
            db.session.add(bill)
        
        payroll = EmployeePayroll.query.filter_by(contract_id=contract_id, year=billing_year, month=billing_month).first()
        if not payroll:
            employee_id = contract.user_id or contract.service_personnel_id
            payroll = EmployeePayroll(contract_id=contract_id, year=billing_year, month=billing_month, employee_id=employee_id, final_payout=0, calculation_details={})
            db.session.add(payroll)

        # 马上 flush，确保 bill 和 payroll 获得 ID，以便关联
        db.session.flush()

        # --- 3. 处理财务调整项 ---
        adjustments_data = data.get('adjustments', [])
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

            new_adjustment = FinancialAdjustment(
                adjustment_type=AdjustmentType[adj_type_str],
                amount=D(adj.get('amount', 0)),
                description=adj.get('description', ''),
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
        engine.calculate_for_month(billing_year, billing_month)
        current_app.logger.info("[BATCH-UPDATE-4] BillingEngine 重算完成。")

        
        # --- 5. 在重算之后，再更新结算和发票状态 (核心修正：顺序调整) ---
        settlement_status = data.get('settlement_status', {})
        invoice_details_from_frontend = settlement_status.get('invoice_details', {})

        current_app.logger.info(f"[BATCH-UPDATE-5] 准备更新结算状态: {settlement_status}")
        current_app.logger.info(f"[BATCH-UPDATE-6] 准备更新发票详情: {invoice_details_from_frontend}")
        
        # 为了安全，重新从会话中获取最新的 bill 和 payroll 对象
        # 虽然在同一个事务中可能不是必须的，但这是最保险的做法
        final_bill = db.session.get(CustomerBill, bill.id)
        final_payroll = db.session.get(EmployeePayroll, payroll.id)

        final_bill.is_paid = settlement_status.get('customer_is_paid', False)
        payment_date_str = settlement_status.get('customer_payment_date')

        # **核心修正**: 将所有状态存入 payment_details
        if final_bill.payment_details is None:
            final_bill.payment_details = {}
            
        final_bill.payment_details['payment_date'] = payment_date_str.split('T')[0] if payment_date_str else None
        final_bill.payment_details['payment_channel'] = settlement_status.get('customer_payment_channel')
        
        final_bill.payment_details['invoice_needed'] = settlement_status.get('invoice_needed', False)
        final_bill.payment_details['invoice_issued'] = settlement_status.get('invoice_issued', False)
        final_bill.payment_details['invoice_number'] = invoice_details_from_frontend.get('number')
        final_bill.payment_details['invoice_amount'] = invoice_details_from_frontend.get('amount')
        final_bill.payment_details['invoice_date'] = invoice_details_from_frontend.get('date')
        
        attributes.flag_modified(final_bill, "payment_details")

        
        attributes.flag_modified(final_bill, "payment_details")

        final_payroll.is_paid = settlement_status.get('employee_is_paid', False)
        payout_date_str = settlement_status.get('employee_payout_date')
        final_payroll.payout_details = {
            "date": payout_date_str.split('T')[0] if payout_date_str else None,
            "channel": settlement_status.get('employee_payout_channel'),
        }
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