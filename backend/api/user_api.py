# backend/api/user_api.py
from flask import Blueprint, jsonify, request
from backend.models import db, User
from sqlalchemy import or_

user_bp = Blueprint('user_api', __name__, url_prefix='/api/users')

@user_bp.route('', methods=['GET'])
def get_users():
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 10, type=int)
        sort_by = request.args.get('sort_by', 'created_at')
        sort_order = request.args.get('sort_order', 'desc')
        search_term = request.args.get('search', '').strip()

        query = User.query

        if search_term:
            query = query.filter(
                or_(
                    User.username.ilike(f'%{search_term}%'),
                    User.phone_number.ilike(f'%{search_term}%'),
                    User.email.ilike(f'%{search_term}%')
                )
            )

        if sort_order == 'desc':
            query = query.order_by(getattr(User, sort_by).desc())
        else:
            query = query.order_by(getattr(User, sort_by).asc())

        paginated_users = query.paginate(page=page, per_page=per_page, error_out=False)
        
        results = [
            {
                'id': user.id,
                'username': user.username,
                'phone_number': user.phone_number,
                'email': user.email,
                'role': user.role,
                'status': user.status,
                'created_at': user.created_at.isoformat() if user.created_at else None,
            } for user in paginated_users.items
        ]
        
        return jsonify({
            'items': results,
            'total': paginated_users.total,
            'page': paginated_users.page,
            'per_page': paginated_users.per_page,
            'pages': paginated_users.pages
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500
