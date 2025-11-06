from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required
from backend.models import db, User, Customer, ServicePersonnel, EmployeeSalaryHistory
from sqlalchemy import or_

user_api = Blueprint("user_api", __name__)


@user_api.route("/api/users/search", methods=["GET"])
@jwt_required()
def search_users():
    search_term = request.args.get("q", "").strip()
    if not search_term:
        return jsonify([])

    # 移除搜索词中的空格，以匹配数据库中存储的无空格拼音
    pinyin_search_term = search_term.replace(" ", "")

    current_app.logger.info(
        f"--- [UserSearch] Original Term: '{search_term}', Pinyin Term: '{pinyin_search_term}' ---"
    )

    query = User.query.filter(
        or_(
            User.username.ilike(f"%{search_term}%"),
            User.name_pinyin.ilike(f"%{pinyin_search_term}%"),
        )
    ).limit(10)

    # --- 增加SQL查询日志 ---
    try:
        # 使用 str(query) 可以获取到 SQLAlchemy 生成的 SQL 语句
        current_app.logger.info(
            f"[UserSearch] Executing SQL: {str(query.statement.compile(compile_kwargs={'literal_binds': True}))}"
        )
    except Exception as e:
        current_app.logger.error(f"[UserSearch] Error compiling SQL query: {e}")
    # -----------------------

    users = query.all()

    current_app.logger.info(f"[UserSearch] Query found {len(users)} user(s).")

    return jsonify(
        [
            {"id": str(u.id), "name": u.username, "name_pinyin": u.name_pinyin}
            for u in users
        ]
    )


@user_api.route("/api/contract-parties/search", methods=["GET"])
@jwt_required()
def search_contract_parties():
    """
    根据角色（客户或服务人员）和搜索词，模糊搜索用于合同的签约方。
    URL 参数:
        search: 搜索词 (姓名或拼音)
        role: 'customer' 或 'service_personnel'
    """
    search_term = request.args.get("search", "").strip()
    role = request.args.get("role", "").strip()

    if not search_term or not role:
        return jsonify([])

    pinyin_search_term = search_term.replace(" ", "")
    current_app.logger.info(
        f"--- [ContractPartySearch] Role: '{role}', Term: '{search_term}', Pinyin Term: '{pinyin_search_term}' ---"
    )

    results = []
    if role == 'customer':
        query = Customer.query.filter(
            or_(
                Customer.name.ilike(f"%{search_term}%"),
                Customer.name_pinyin.ilike(f"%{pinyin_search_term}%"),
            )
        ).limit(10)
        customers = query.all()
        results = [
            {
                "id": str(c.id),
                "name": c.name,
                "phone_number": c.phone_number,
                "id_card_number": c.id_card_number,
                "address": c.address,
            }
            for c in customers
        ]
        current_app.logger.info(f"[ContractPartySearch] Found {len(results)} customer(s).")

    elif role == 'service_personnel':
        # --- 核心修改：使用模型中已有的 current_salary 属性 ---
        query = ServicePersonnel.query.filter(
            or_(
                ServicePersonnel.name.ilike(f"%{search_term}%"),
                ServicePersonnel.name_pinyin.ilike(f"%{pinyin_search_term}%"),
            )
        ).limit(10)
        
        personnel = query.all()
        
        results = []
        for p in personnel:
            latest_salary = None
            # p.current_salary 是一个 hybrid_property, 它会触发一次查询
            salary_record = p.current_salary
            if salary_record:
                latest_salary = float(salary_record.base_salary)

            results.append({
                "id": str(p.id),
                "name": p.name,
                "phone_number": p.phone_number,
                "id_card_number": p.id_card_number,
                "address": p.address,
                "latest_salary": latest_salary
            })
        
        current_app.logger.info(f"[ContractPartySearch] Found {len(results)} service personnel.")

    return jsonify(results)
