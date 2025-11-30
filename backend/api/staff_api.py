# backend/api/staff_api.py
from flask import Blueprint, jsonify, request
from backend.models import ServicePersonnel, EmployeeSalaryHistory, BaseContract, DynamicFormData, DynamicForm
from backend.extensions import db
from sqlalchemy.orm import joinedload
from sqlalchemy import or_, func as sql_func
from datetime import datetime
import logging

staff_api = Blueprint('staff_api', __name__, url_prefix='/api/staff')

@staff_api.route('/employees', methods=['GET'])
def get_employees():
    """
    获取所有服务人员的列表，支持分页、搜索、筛选和排序。
    """
    # 1. 获取查询参数
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    search = request.args.get('search', '')
    status = request.args.get('status', 'all') # 'all', 'active', 'inactive'
    sort_by = request.args.get('sort_by', 'created_at')
    sort_order = request.args.get('sort_order', 'desc')

    # 2. 构建基础查询
    query = ServicePersonnel.query

    # 3. 应用筛选
    if status != 'all':
        is_active_status = status == 'active'
        query = query.filter(ServicePersonnel.is_active == is_active_status)


    # 4. 应用搜索
    if search:
        search_term = f"%{search}%"
        pinyin_search_term = f"%{search.replace(' ', '')}%"
        query = query.filter(
            or_(
                ServicePersonnel.name.ilike(search_term),
                ServicePersonnel.phone_number.ilike(search_term),
                ServicePersonnel.name_pinyin.ilike(pinyin_search_term)
            )
        )

    # 5. 应用排序
    if hasattr(ServicePersonnel, sort_by):
        column = getattr(ServicePersonnel, sort_by)
        if sort_order == 'desc':
            query = query.order_by(column.desc())
        else:
            query = query.order_by(column.asc())
    else:
        query = query.order_by(ServicePersonnel.created_at.desc())

    # Add logging right before pagination
    logging.basicConfig(level=logging.DEBUG)
    logging.debug(f"SQLAlchemy Query: {str(query.statement.compile(compile_kwargs={'literal_binds': True}))}")

    # 6. 执行分页查询
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    employees = pagination.items
    total = pagination.total

    # 7. 序列化结果
    result = {
        "items": [
            {
                "id": str(emp.id),
                "name": emp.name,
                "phone_number": emp.phone_number,
                "is_active": emp.is_active,
                "created_at": emp.created_at.isoformat() if emp.created_at else None,
            } for emp in employees
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": pagination.pages
    }
    
    return jsonify(result)

@staff_api.route('/employees/<uuid:employee_id>', methods=['GET'])
def get_employee_details(employee_id):
    """
    获取单个服务人员的详细信息，包括其完整的薪资历史和关联合同背景。
    """
    employee = ServicePersonnel.query.get_or_404(str(employee_id))

    # 1. 高效查询：预加载所有需要的关联数据，避免N+1查询
    # 按生效日期升序排序，为下一步计算"原月薪"做准备
    history_records = (
        EmployeeSalaryHistory.query
        .options(
            joinedload(EmployeeSalaryHistory.contract)
            .joinedload(BaseContract.customer)
        )
        .filter_by(employee_id=employee.id)
        .order_by(EmployeeSalaryHistory.effective_date.asc())
        .all()
    )

    # 2. 在业务逻辑中处理和计算
    processed_history = []
    for i, record in enumerate(history_records):
        previous_salary = history_records[i-1].base_salary if i > 0 else None
        
        contract = record.contract
        customer = contract.customer if contract else None

        processed_history.append({
            "id": str(record.id),
            "previous_salary": str(previous_salary) if previous_salary is not None else None,
            "new_salary": str(record.base_salary),
            "effective_date": record.effective_date.isoformat(),
            "customer_name": (customer.name if customer else contract.customer_name) if contract else None,
            "contract_start_date": contract.start_date.isoformat() if contract and contract.start_date else None,
            "contract_end_date": contract.end_date.isoformat() if contract and contract.end_date else None,
            "customer_address": customer.address if customer else None,
            "contract_notes": contract.notes if contract else None,
            "contract_id": str(contract.id) if contract else None,
            "contract_type": contract.type if contract else None 
        })

    # 3. 为每条薪资历史记录查找对应的下户总结
    # 优先使用contract_id匹配,如果没有则回退到员工姓名+客户姓名匹配
    EXIT_SUMMARY_FORM_TOKEN = "wWVDjd"
    exit_form = DynamicForm.query.filter_by(form_token=EXIT_SUMMARY_FORM_TOKEN).first()
    
    if exit_form:
        for history_item in processed_history:
            contract_id = history_item.get("contract_id")
            exit_summary = None
            
            # 优先级1: 通过contract_id精确匹配
            if contract_id:
                exit_summary = DynamicFormData.query.filter(
                    DynamicFormData.form_id == exit_form.id,
                    DynamicFormData.contract_id == contract_id
                ).order_by(DynamicFormData.created_at.desc()).first()
            
            # 优先级2: 如果没有contract_id或未找到,回退到姓名匹配(向后兼容)
            if not exit_summary and history_item.get("customer_name"):
                employee_name_clean = employee.name.replace(" ", "")
                customer_name_clean = history_item["customer_name"].replace(" ", "")
                
                exit_summary = DynamicFormData.query.filter(
                    DynamicFormData.form_id == exit_form.id,
                    sql_func.replace(DynamicFormData.data["field_1"].astext, ' ', '') == employee_name_clean,
                    sql_func.replace(DynamicFormData.data["field_2"].astext, ' ', '') == customer_name_clean
                ).order_by(DynamicFormData.created_at.desc()).first()
            
            # 添加下户总结数据到历史记录
            if exit_summary:
                history_item["exit_summary"] = {
                    "id": str(exit_summary.id),
                    "learned": exit_summary.data.get("field_23", ""),
                    "improved": exit_summary.data.get("field_22", ""),
                    "exit_date": exit_summary.data.get("field_3", ""),
                    "form_token": EXIT_SUMMARY_FORM_TOKEN,
                    "matched_by": "contract_id" if exit_summary.contract_id else "name"
                }

    # 4. 返回给前端时，按日期降序，方便展示
    processed_history.reverse()

    # 5. Fetch additional data from Dynamic Forms (Entry Form & Exit Summary)
    ENTRY_FORM_TOKEN = "N0Il9H"
    entry_form_data = {}
    exit_summary_data = {}
    
    try:
        # Fetch Entry Form Data by phone number
        entry_form = DynamicForm.query.filter_by(form_token=ENTRY_FORM_TOKEN).first()
        if entry_form:
            entry_data_record = DynamicFormData.query.filter(
                DynamicFormData.form_id == entry_form.id,
                DynamicFormData.data['field_2'].astext == employee.phone_number
            ).order_by(DynamicFormData.created_at.desc()).first()
            
            if entry_data_record:
                entry_data = entry_data_record.data
                # field_5 is photo (attachment type, array of URLs)
                photo_field = entry_data.get("field_5")
                photo_url = photo_field[0] if isinstance(photo_field, list) and len(photo_field) > 0 else photo_field
                
                entry_form_data = {
                    "form_id": str(entry_data_record.id),
                    "form_token": ENTRY_FORM_TOKEN,
                    "zodiac": entry_data.get("field_33", ""),  # 生肖
                    "education": entry_data.get("field_23", ""),  # 学历
                    "height": entry_data.get("field_27", ""),  # 身高(厘米)
                    "weight": entry_data.get("field_28", ""),  # 体重(公斤)
                    "join_date": entry_data.get("field_24", ""),  # 加入公司时间
                    "photo": photo_url,  # 入职时照片或生活照一张
                }
        
        # Fetch Exit Summary Data by employee name
        if exit_form:
            exit_data_record = DynamicFormData.query.filter(
                DynamicFormData.form_id == exit_form.id,
                DynamicFormData.data['field_1'].astext == employee.name
            ).order_by(DynamicFormData.created_at.desc()).first()
            
            if exit_data_record:
                exit_data = exit_data_record.data
                exit_summary_data = {
                    "form_id": str(exit_data_record.id),
                    "form_token": EXIT_SUMMARY_FORM_TOKEN,
                    "id": str(exit_data_record.id),
                    "summary": exit_data.get("field_23", ""),
                    "customer_name": exit_data.get("field_2", ""),
                    "exit_date": exit_data.get("field_3", ""),
                }
    except Exception as e:
        logging.error(f"Error fetching form data for employee {employee_id}: {str(e)}", exc_info=True)

    result = {
        "id": str(employee.id),
        "name": employee.name,
        "phone_number": employee.phone_number,
        "id_card_number": employee.id_card_number,
        "address": employee.address,
        "is_active": employee.is_active,
        "salary_history": processed_history,
        "entry_form_data": entry_form_data,
        "exit_summary_data": exit_summary_data,
    }

    return jsonify(result)


@staff_api.route('/employees/<uuid:employee_id>/contracts', methods=['GET'])
def get_employee_contracts(employee_id):
    """
    获取员工的所有合同列表，按开始日期降序排列(最新的在前)。
    用于在下户总结表单中选择合同。
    """
    # 1. 验证员工存在
    employee = ServicePersonnel.query.get(employee_id)
    if not employee:
        return jsonify({"error": "Employee not found"}), 404
    
    # 2. 查询员工的所有合同
    contracts = BaseContract.query.options(
        joinedload(BaseContract.customer)
    ).filter_by(
        service_personnel_id=employee_id
    ).order_by(
        BaseContract.start_date.desc()  # 最新的合同在前
    ).all()
    
    # 3. 构建响应
    contract_list = []
    for contract in contracts:
        customer_name = contract.customer.name if contract.customer else contract.customer_name
        
        contract_list.append({
            "id": str(contract.id),
            "customer_name": customer_name,
            "type": contract.type,
            "start_date": contract.start_date.date().isoformat() if contract.start_date else None,
            "end_date": contract.end_date.date().isoformat() if contract.end_date else None,
            "status": contract.status if hasattr(contract, 'status') else None,
        })
    
    return jsonify({
        "employee_id": str(employee_id),
        "employee_name": employee.name,
        "contracts": contract_list,
        "total": len(contract_list)
    })


# 合同类型到职位的映射
CONTRACT_TYPE_TO_POSITION = {
    'nanny': '育儿嫂',
    'maternity_nurse': '月嫂',
    'nanny_trial': '育儿嫂',
    'external_substitution': '育儿嫂'
}

# 合同类型中文显示名称
CONTRACT_TYPE_DISPLAY = {
    'nanny': '育儿嫂合同',
    'maternity_nurse': '月嫂合同',
    'nanny_trial': '育儿嫂试岗合同',
    'external_substitution': '外部代班合同'
}


@staff_api.route('/employees/by-name/<string:name>/latest-contract', methods=['GET'])
def get_latest_contract_by_name(name):
    """
    根据员工姓名获取最新的活跃合同
    用于下户总结表单的自动填充
    
    查找条件:
    - 员工姓名匹配
    - 合同开始日期 < 当前日期 (排除未上户的合同)
    - 按开始日期降序排序,取第一条
    
    返回:
    - 员工信息
    - 合同详情
    - 自动填充数据(field_2, field_3, field_14)
    """
    # 1. 查找员工
    employee = ServicePersonnel.query.filter_by(name=name).first()
    if not employee:
        return jsonify({"error": "未找到该员工"}), 404
    
    # 2. 查找最新的活跃合同
    today = datetime.now().date()
    contract = BaseContract.query.filter(
        BaseContract.service_personnel_id == employee.id,
        BaseContract.start_date < today  # 开始日期必须小于今天
    ).order_by(BaseContract.start_date.desc()).first()
    
    if not contract:
        return jsonify({"error": "未找到该员工的活跃合同"}), 404
    
    # 3. 获取客户名称
    customer_name = ""
    if hasattr(contract, 'customer') and contract.customer:
        customer_name = contract.customer.name
    elif hasattr(contract, 'customer_name'):
        customer_name = contract.customer_name
    
    # 4. 确定结束日期
    # 优先使用termination_date,其次end_date,最后用今天
    end_date = None
    if hasattr(contract, 'termination_date') and contract.termination_date:
        end_date = contract.termination_date
    elif contract.end_date:
        end_date = contract.end_date
    else:
        end_date = today
    
    # 5. 格式化日期范围 (YYYY年MM月DD日～YYYY年MM月DD日)
    # 使用手动格式化以确保跨平台兼容性
    if contract.start_date:
        start_date_str = f"{contract.start_date.year}年{contract.start_date.month}月{contract.start_date.day}日"
    else:
        start_date_str = ""
    
    if end_date:
        end_date_str = f"{end_date.year}年{end_date.month}月{end_date.day}日"
    else:
        end_date_str = ""
    
    formatted_date_range = f"{start_date_str}～{end_date_str}"
    
    # 6. 获取合同类型显示名称和职位
    type_display = CONTRACT_TYPE_DISPLAY.get(contract.type, contract.type)
    position = CONTRACT_TYPE_TO_POSITION.get(contract.type, "")
    
    # 7. 判断是否为月签
    is_monthly_auto_renew = hasattr(contract, 'is_monthly_auto_renew') and contract.is_monthly_auto_renew
    
    # 8. 构建响应
    response = {
        "employee": {
            "id": str(employee.id),
            "name": employee.name
        },
        "contract": {
            "id": str(contract.id),
            "type": contract.type,
            "type_display": type_display,
            "customer_name": customer_name,
            "start_date": contract.start_date.isoformat() if contract.start_date else None,
            "end_date": contract.end_date.isoformat() if contract.end_date else None,
            "termination_date": contract.termination_date.isoformat() if hasattr(contract, 'termination_date') and contract.termination_date else None,
            "is_monthly_auto_renew": is_monthly_auto_renew,
            "suggested_end_date": end_date.isoformat() if end_date else None,
            "formatted_date_range": formatted_date_range
        },
        "auto_fill_data": {
            "field_2": customer_name,  # 服务的客户姓名
            "field_3": formatted_date_range,  # 上户和下户时间
            "field_14": position  # 在户上的职位
        }
    }
    
    return jsonify(response)


@staff_api.route('/create-from-form/<uuid:data_id>', methods=['POST'])
def create_staff_from_form(data_id):
    """
    从动态表单数据创建或更新员工信息。
    
    Args:
        data_id: DynamicFormData 的 UUID
        
    Returns:
        JSON response with success message and employee ID
    """
    try:
        # 1. 查询表单数据
        form_data = DynamicFormData.query.get(str(data_id))
        if not form_data:
            return jsonify({"error": "表单数据不存在"}), 404
        
        # 2. 提取表单字段
        data = form_data.data
        if not data:
            return jsonify({"error": "表单数据为空"}), 400
        
        # 3. 映射字段（支持多种格式）
        # 格式1: Jinshuju field_X 格式（萌嫂入职登记表使用此格式）
        # 格式2: 中文字段名
        # 格式3: 英文字段名
        
        # 姓名: field_1 或 "姓名" 或 "name"
        name = data.get("field_1") or data.get("姓名") or data.get("name")
        
        # 手机号: field_2 或 "手机号" 或 "phone_number" 或 "联系电话"
        phone_number = (
            data.get("field_2") or 
            data.get("手机号") or 
            data.get("phone_number") or 
            data.get("联系电话")
        )
        
        # 身份证号: field_93 或 "身份证号" 或 "id_card_number" 或 "身份证号码"
        id_card_number = (
            data.get("field_93") or 
            data.get("身份证号") or 
            data.get("id_card_number") or 
            data.get("身份证号码")
        )
        
        # 地址: field_3 或 "现居住地址" 或 "address" 或 "住址"
        address = (
            data.get("field_3") or 
            data.get("现居住地址") or 
            data.get("address") or 
            data.get("住址")
        )
        
        # 确保手机号是字符串格式（可能是数字）
        if phone_number and not isinstance(phone_number, str):
            phone_number = str(phone_number)
        
        # 4. 验证必填字段
        if not name:
            return jsonify({"error": "缺少必填字段：姓名"}), 400
        if not phone_number:
            return jsonify({"error": "缺少必填字段：手机号"}), 400
        
        # 5. 检查是否已存在（根据手机号）
        existing_employee = ServicePersonnel.query.filter_by(phone_number=phone_number).first()
        
        if existing_employee:
            # 更新现有员工信息
            existing_employee.name = name
            if id_card_number:
                existing_employee.id_card_number = id_card_number
            if address:
                existing_employee.address = address
            
            db.session.commit()
            
            return jsonify({
                "message": "员工信息已更新",
                "id": str(existing_employee.id),
                "name": existing_employee.name
            }), 200
        else:
            # 创建新员工
            new_employee = ServicePersonnel(
                name=name,
                phone_number=phone_number,
                id_card_number=id_card_number,
                address=address,
                is_active=True
            )
            
            db.session.add(new_employee)
            db.session.commit()
            
            return jsonify({
                "message": "员工信息创建成功",
                "id": str(new_employee.id),
                "name": new_employee.name
            }), 201
            
    except Exception as e:
        db.session.rollback()
        logging.error(f"创建员工失败: {str(e)}", exc_info=True)
        return jsonify({"error": f"创建员工失败: {str(e)}"}), 500
