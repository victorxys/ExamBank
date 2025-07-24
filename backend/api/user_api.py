from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required
from backend.models import User
from sqlalchemy import or_

user_api = Blueprint('user_api', __name__)

@user_api.route('/api/users/search', methods=['GET'])
@jwt_required()
def search_users():
    search_term = request.args.get('q', '').strip()
    if not search_term:
        return jsonify([])

    # 移除搜索词中的空格，以匹配数据库中存储的无空格拼音
    pinyin_search_term = search_term.replace(' ', '')
    
    current_app.logger.info(f"--- [UserSearch] Original Term: '{search_term}', Pinyin Term: '{pinyin_search_term}' ---")

    query = User.query.filter(
        or_(
            User.username.ilike(f'%{search_term}%'),
            User.name_pinyin.ilike(f'%{pinyin_search_term}%')
        )
    ).limit(10)

    # --- 增加SQL查询日志 ---
    try:
        # 使用 str(query) 可以获取到 SQLAlchemy 生成的 SQL 语句
        current_app.logger.info(f"[UserSearch] Executing SQL: {str(query.statement.compile(compile_kwargs={'literal_binds': True}))}")
    except Exception as e:
        current_app.logger.error(f"[UserSearch] Error compiling SQL query: {e}")
    # -----------------------

    users = query.all()
    
    current_app.logger.info(f"[UserSearch] Query found {len(users)} user(s).")

    return jsonify([{'id': str(u.id), 'name': u.username, 'name_pinyin': u.name_pinyin} for u in users])


