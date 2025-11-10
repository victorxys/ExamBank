# backend/api/staff_api.py
from flask import Blueprint, jsonify, request
from backend.models import ServicePersonnel, EmployeeSalaryHistory, BaseContract, Customer
from sqlalchemy.orm import joinedload
from sqlalchemy import or_
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
        # 默认排序
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
    # 按生效日期升序排序，为下一步计算“原月薪”做准备
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
            "contract_id": str(contract.id) if contract else None
        })

    # 3. 返回给前端时，按日期降序，方便展示
    processed_history.reverse()

    result = {
        "id": str(employee.id),
        "name": employee.name,
        "phone_number": employee.phone_number,
        "id_card_number": employee.id_card_number,
        "address": employee.address,
        "is_active": employee.is_active,
        "salary_history": processed_history
    }

    return jsonify(result)
