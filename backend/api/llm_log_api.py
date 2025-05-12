# backend/api/llm_log_api.py
from flask import Blueprint, request, jsonify, current_app
from backend.models import LlmCallLog, db
from flask_jwt_extended import jwt_required, get_jwt
import uuid

llm_log_bp = Blueprint('llm_log', __name__, url_prefix='/api/llm-logs')

# 辅助函数检查管理员角色 (可以从 llm_config_api.py 导入或重新定义)
def admin_required(fn):
    @jwt_required()
    def wrapper(*args, **kwargs):
        claims = get_jwt()
        if claims.get('role') != 'admin':
            return jsonify(msg="管理员权限不足"), 403
        return fn(*args, **kwargs)
    wrapper.__name__ = fn.__name__
    return wrapper

@llm_log_bp.route('', methods=['GET'])
@admin_required
def get_llm_call_logs():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    function_name_filter = request.args.get('function_name', None)
    status_filter = request.args.get('status', None)
    model_id_filter = request.args.get('model_id', None)
    prompt_id_filter = request.args.get('prompt_id', None)
    user_id_filter = request.args.get('user_id', None)
    
    query = LlmCallLog.query
    if function_name_filter:
        query = query.filter(LlmCallLog.function_name.ilike(f'%{function_name_filter}%'))
    if status_filter:
        query = query.filter(LlmCallLog.status == status_filter)
    if model_id_filter:
        try:
            query = query.filter(LlmCallLog.llm_model_id == uuid.UUID(model_id_filter))
        except ValueError:
            return jsonify({'error': '无效的模型ID格式'}), 400
    if prompt_id_filter:
        try:
            query = query.filter(LlmCallLog.llm_prompt_id == uuid.UUID(prompt_id_filter))
        except ValueError:
            return jsonify({'error': '无效的提示词ID格式'}), 400
    if user_id_filter:
        try:
            query = query.filter(LlmCallLog.user_id == uuid.UUID(user_id_filter))
        except ValueError:
            return jsonify({'error': '无效的用户ID格式'}), 400
        
    try:
        logs_pagination = query.order_by(LlmCallLog.timestamp.desc()).paginate(page=page, per_page=per_page, error_out=False)
        logs = logs_pagination.items
        
        return jsonify({
            'items': [{
                'id': str(log.id),
                'timestamp': log.timestamp.isoformat() if log.timestamp else None,
                'function_name': log.function_name,
                'model_name': log.llm_model_log_ref.model_name if log.llm_model_log_ref else 'N/A',
                'prompt_name': log.llm_prompt_log_ref.prompt_name if log.llm_prompt_log_ref else 'N/A',
                'prompt_version': log.llm_prompt_log_ref.version if log.llm_prompt_log_ref else 'N/A',
                'api_key_name': log.api_key_name,
                'status': log.status,
                'duration_ms': log.duration_ms,
                'user_username': log.user_ref.username if log.user_ref else 'N/A'
            } for log in logs],
            'total': logs_pagination.total,
            'page': logs_pagination.page,
            'per_page': logs_pagination.per_page,
            'pages': logs_pagination.pages
        })
    except Exception as e:
        current_app.logger.error(f"获取LLM调用日志失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@llm_log_bp.route('/<uuid:log_id>', methods=['GET'])
@admin_required
def get_llm_call_log_detail(log_id):
    log = LlmCallLog.query.get(str(log_id))
    if not log:
        return jsonify({'error': '日志未找到'}), 404
    try:
        return jsonify({
            'id': str(log.id),
            'timestamp': log.timestamp.isoformat() if log.timestamp else None,
            'function_name': log.function_name,
            'model_name': log.llm_model_log_ref.model_name if log.llm_model_log_ref else 'N/A',
            'model_identifier': log.llm_model_log_ref.model_identifier if log.llm_model_log_ref else 'N/A',
            'prompt_name': log.llm_prompt_log_ref.prompt_name if log.llm_prompt_log_ref else 'N/A',
            'prompt_identifier': log.llm_prompt_log_ref.prompt_identifier if log.llm_prompt_log_ref else 'N/A',
            'prompt_version': log.llm_prompt_log_ref.version if log.llm_prompt_log_ref else 'N/A',
            'prompt_template': log.llm_prompt_log_ref.prompt_template if log.llm_prompt_log_ref else 'N/A', # 包含模板内容
            'api_key_name': log.api_key_name,
            'input_data': log.input_data, 
            'output_data': log.output_data,
            'parsed_output_data': log.parsed_output_data,
            'status': log.status,
            'error_message': log.error_message,
            'duration_ms': log.duration_ms,
            'user_id': str(log.user_id) if log.user_id else None,
            'user_username': log.user_ref.username if log.user_ref else 'N/A'
        })
    except Exception as e:
        current_app.logger.error(f"获取LLM调用日志详情失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500