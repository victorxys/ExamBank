# backend/api/llm_config_api.py
from flask import Blueprint, request, jsonify, current_app
from backend.models import LlmModel, LlmApiKey, LlmPrompt, db
from backend.security_utils import encrypt_data, decrypt_data # 确认路径正确
from sqlalchemy.exc import IntegrityError
from flask_jwt_extended import jwt_required, get_jwt # 用于权限控制
import uuid

llm_config_bp = Blueprint('llm_config', __name__, url_prefix='/api/llm-config')

# 辅助函数检查管理员角色
def admin_required(fn):
    @jwt_required()
    def wrapper(*args, **kwargs):
        claims = get_jwt()
        if claims.get('role') != 'admin':
            return jsonify(msg="管理员权限不足"), 403
        return fn(*args, **kwargs)
    wrapper.__name__ = fn.__name__
    return wrapper

# --- LLM Model Management ---
@llm_config_bp.route('/models', methods=['POST'])
@admin_required
def create_llm_model():
    data = request.get_json()
    if not data or not data.get('model_name') or not data.get('model_identifier') or not data.get('provider'):
        return jsonify({'error': '缺少必要字段: model_name, model_identifier, provider'}), 400
    
    new_model = LlmModel(
        model_name=data['model_name'],
        model_identifier=data['model_identifier'],
        provider=data['provider'],
        description=data.get('description'),
        status=data.get('status', 'active')
    )
    try:
        db.session.add(new_model)
        db.session.commit()
        return jsonify({
            'id': str(new_model.id),
            'model_name': new_model.model_name,
            'model_identifier': new_model.model_identifier,
            'provider': new_model.provider,
            'description': new_model.description,
            'status': new_model.status,
            'created_at': new_model.created_at.isoformat() if new_model.created_at else None
        }), 201
    except IntegrityError as e:
        db.session.rollback()
        error_msg = '创建模型失败，数据库错误'
        if 'uq_llm_model_name' in str(e.orig): error_msg = '模型名称已存在'
        elif 'uq_llm_model_identifier' in str(e.orig): error_msg = '模型标识符已存在'
        current_app.logger.error(f"创建LLM模型失败: {error_msg} - {e}")
        return jsonify({'error': error_msg}), 409
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"创建LLM模型时发生未知错误: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@llm_config_bp.route('/models', methods=['GET'])
@admin_required
def get_llm_models():
    try:
        models = LlmModel.query.order_by(LlmModel.provider, LlmModel.model_name).all()
        return jsonify([{
            'id': str(model.id),
            'model_name': model.model_name,
            'model_identifier': model.model_identifier,
            'provider': model.provider,
            'description': model.description,
            'status': model.status,
            'created_at': model.created_at.isoformat() if model.created_at else None,
            'updated_at': model.updated_at.isoformat() if model.updated_at else None
        } for model in models])
    except Exception as e:
        current_app.logger.error(f"获取LLM模型列表失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@llm_config_bp.route('/models/<uuid:model_id>', methods=['PUT'])
@admin_required
def update_llm_model(model_id):
    model = LlmModel.query.get(str(model_id))
    if not model:
        return jsonify({'error': '模型未找到'}), 404
    
    data = request.get_json()
    if not data:
        return jsonify({'error': '缺少更新数据'}), 400

    # 检查是否有唯一性冲突
    if 'model_name' in data and data['model_name'] != model.model_name:
        if LlmModel.query.filter_by(model_name=data['model_name']).first():
            return jsonify({'error': '模型名称已存在'}), 409
        model.model_name = data['model_name']
    
    if 'model_identifier' in data and data['model_identifier'] != model.model_identifier:
        if LlmModel.query.filter_by(model_identifier=data['model_identifier']).first():
            return jsonify({'error': '模型标识符已存在'}), 409
        model.model_identifier = data['model_identifier']

    model.provider = data.get('provider', model.provider)
    model.description = data.get('description', model.description)
    model.status = data.get('status', model.status)
    
    try:
        db.session.commit()
        return jsonify({
            'id': str(model.id),
            'model_name': model.model_name,
            'model_identifier': model.model_identifier,
            'provider': model.provider,
            'description': model.description,
            'status': model.status,
            'updated_at': model.updated_at.isoformat() if model.updated_at else None
        })
    except Exception as e: # 其他可能的数据库错误
        db.session.rollback()
        current_app.logger.error(f"更新LLM模型失败: {e}", exc_info=True)
        return jsonify({'error': '更新模型失败，数据库错误'}), 500


@llm_config_bp.route('/models/<uuid:model_id>', methods=['DELETE'])
@admin_required
def delete_llm_model(model_id):
    model = LlmModel.query.get(str(model_id))
    if not model:
        return jsonify({'error': '模型未找到'}), 404
    try:
        if model.prompts.first() or model.call_logs.first():
             return jsonify({'error': '无法删除：该模型已被提示词或日志使用'}), 400
        db.session.delete(model)
        db.session.commit()
        return jsonify({'message': '模型删除成功'})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"删除LLM模型失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# --- LLM API Key Management ---
@llm_config_bp.route('/api-keys', methods=['POST'])
@admin_required
def create_llm_api_key():
    data = request.get_json()
    if not data or not data.get('key_name') or not data.get('api_key') or not data.get('provider'):
        return jsonify({'error': '缺少必要字段: key_name, api_key, provider'}), 400
    
    try:
        encrypted_key = encrypt_data(data['api_key'])
        new_api_key = LlmApiKey(
            key_name=data['key_name'],
            api_key_encrypted=encrypted_key,
            provider=data['provider'],
            status=data.get('status', 'active'),
            notes=data.get('notes')
        )
        db.session.add(new_api_key)
        db.session.commit()
        return jsonify({
            'id': str(new_api_key.id),
            'key_name': new_api_key.key_name,
            'provider': new_api_key.provider,
            'status': new_api_key.status,
            'notes': new_api_key.notes,
            'created_at': new_api_key.created_at.isoformat() if new_api_key.created_at else None
        }), 201
    except IntegrityError:
        db.session.rollback()
        current_app.logger.error("创建API Key失败: Key名称已存在", exc_info=True)
        return jsonify({'error': 'API Key 名称已存在'}), 409
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"创建API Key失败: {e}", exc_info=True)
        return jsonify({'error': f'创建API Key失败: {str(e)}'}), 500

@llm_config_bp.route('/api-keys', methods=['GET'])
@admin_required
def get_llm_api_keys():
    try:
        keys = LlmApiKey.query.order_by(LlmApiKey.provider, LlmApiKey.key_name).all()
        return jsonify([{
            'id': str(key.id),
            'key_name': key.key_name,
            'provider': key.provider,
            'status': key.status,
            'notes': key.notes,
            'created_at': key.created_at.isoformat() if key.created_at else None,
            'updated_at': key.updated_at.isoformat() if key.updated_at else None
        } for key in keys])
    except Exception as e:
        current_app.logger.error(f"获取API Keys失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@llm_config_bp.route('/api-keys/<uuid:key_id>', methods=['PUT'])
@admin_required
def update_llm_api_key(key_id):
    api_key_record = LlmApiKey.query.get(str(key_id))
    if not api_key_record:
        return jsonify({'error': 'API Key 未找到'}), 404
    
    data = request.get_json()
    if not data:
        return jsonify({'error': '缺少更新数据'}), 400

    if 'key_name' in data and data['key_name'] != api_key_record.key_name:
        if LlmApiKey.query.filter_by(key_name=data['key_name']).first():
            return jsonify({'error': 'API Key 名称已存在'}), 409
        api_key_record.key_name = data['key_name']
        
    api_key_record.provider = data.get('provider', api_key_record.provider)
    api_key_record.status = data.get('status', api_key_record.status)
    api_key_record.notes = data.get('notes', api_key_record.notes)
    
    if 'api_key' in data and data['api_key']:
        try:
            api_key_record.api_key_encrypted = encrypt_data(data['api_key'])
        except Exception as e:
             current_app.logger.error(f"加密新API Key失败: {e}", exc_info=True)
             return jsonify({'error': f'加密新API Key失败: {str(e)}'}), 500
    
    try:
        db.session.commit()
        return jsonify({
            'id': str(api_key_record.id),
            'key_name': api_key_record.key_name,
            'provider': api_key_record.provider,
            'status': api_key_record.status,
            'notes': api_key_record.notes,
            'updated_at': api_key_record.updated_at.isoformat() if api_key_record.updated_at else None
        })
    except Exception as e: # 其他可能的数据库错误
        db.session.rollback()
        current_app.logger.error(f"更新API Key失败: {e}", exc_info=True)
        return jsonify({'error': '更新API Key失败，数据库错误'}), 500


@llm_config_bp.route('/api-keys/<uuid:key_id>', methods=['DELETE'])
@admin_required
def delete_llm_api_key(key_id):
    api_key_record = LlmApiKey.query.get(str(key_id))
    if not api_key_record:
        return jsonify({'error': 'API Key 未找到'}), 404
    try:
        db.session.delete(api_key_record)
        db.session.commit()
        return jsonify({'message': 'API Key 删除成功'})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"删除API Key失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# --- LLM Prompt Management ---
@llm_config_bp.route('/prompts', methods=['POST'])
@admin_required
def create_llm_prompt():
    data = request.get_json()
    required_fields = ['prompt_name', 'prompt_identifier', 'prompt_template']
    if not data or not all(field in data and data[field] for field in required_fields):
        return jsonify({'error': f'缺少必要字段: {", ".join(required_fields)}'}), 400

    new_prompt = LlmPrompt(
        prompt_name=data['prompt_name'],
        prompt_identifier=data['prompt_identifier'],
        prompt_template=data['prompt_template'],
        model_identifier=data.get('model_identifier') if data.get('model_identifier') else None, # 确保空字符串转为 None
        version=data.get('version', 1),
        status=data.get('status', 'active'),
        description=data.get('description')
    )
    try:
        db.session.add(new_prompt)
        db.session.commit()
        return jsonify({
            'id': str(new_prompt.id),
            'prompt_name': new_prompt.prompt_name,
            'prompt_identifier': new_prompt.prompt_identifier,
            'version': new_prompt.version,
            'status': new_prompt.status,
            'created_at': new_prompt.created_at.isoformat() if new_prompt.created_at else None
        }), 201
    except IntegrityError:
        db.session.rollback()
        current_app.logger.error("创建提示词失败: 具有相同标识符和版本的提示词已存在", exc_info=True)
        return jsonify({'error': '具有相同标识符和版本的提示词已存在'}), 409
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"创建提示词失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@llm_config_bp.route('/prompts', methods=['GET'])
@admin_required
def get_llm_prompts():
    try:
        prompts = LlmPrompt.query.order_by(LlmPrompt.prompt_identifier, LlmPrompt.version.desc(), LlmPrompt.created_at.desc()).all()
        return jsonify([{
            'id': str(prompt.id),
            'prompt_name': prompt.prompt_name,
            'prompt_identifier': prompt.prompt_identifier,
            'prompt_template': prompt.prompt_template,
            'model_identifier': prompt.model_identifier,
            'model_name': prompt.llm_model_ref.model_name if prompt.llm_model_ref else None, # 通过关系获取模型名称
            'version': prompt.version,
            'status': prompt.status,
            'description': prompt.description,
            'created_at': prompt.created_at.isoformat() if prompt.created_at else None,
            'updated_at': prompt.updated_at.isoformat() if prompt.updated_at else None
        } for prompt in prompts])
    except Exception as e:
        current_app.logger.error(f"获取提示词列表失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@llm_config_bp.route('/prompts/<uuid:prompt_id>', methods=['PUT'])
@admin_required
def update_llm_prompt(prompt_id):
    prompt = LlmPrompt.query.get(str(prompt_id))
    if not prompt:
        return jsonify({'error': '提示词未找到'}), 404
    
    data = request.get_json()
    if not data:
        return jsonify({'error': '缺少更新数据'}), 400

    # 检查唯一性约束 prompt_identifier 和 version
    new_identifier = data.get('prompt_identifier', prompt.prompt_identifier)
    new_version = data.get('version', prompt.version)
    if (new_identifier != prompt.prompt_identifier or new_version != prompt.version):
        existing_prompt = LlmPrompt.query.filter_by(prompt_identifier=new_identifier, version=new_version).first()
        if existing_prompt and str(existing_prompt.id) != str(prompt_id):
            return jsonify({'error': '具有相同标识符和版本的提示词已存在'}), 409
    
    prompt.prompt_name = data.get('prompt_name', prompt.prompt_name)
    prompt.prompt_identifier = new_identifier
    prompt.version = new_version
    prompt.prompt_template = data.get('prompt_template', prompt.prompt_template)
    prompt.model_identifier = data.get('model_identifier') if data.get('model_identifier') else None # 确保空字符串转为 None
    prompt.status = data.get('status', prompt.status)
    prompt.description = data.get('description', prompt.description)
    
    try:
        db.session.commit()
        return jsonify({
            'id': str(prompt.id),
            'prompt_name': prompt.prompt_name,
            'prompt_identifier': prompt.prompt_identifier,
            'version': prompt.version,
            'status': prompt.status,
            'updated_at': prompt.updated_at.isoformat() if prompt.updated_at else None
        })
    except Exception as e: # 其他可能的数据库错误
        db.session.rollback()
        current_app.logger.error(f"更新提示词失败: {e}", exc_info=True)
        return jsonify({'error': '更新提示词失败，数据库错误'}), 500


@llm_config_bp.route('/prompts/<uuid:prompt_id>', methods=['DELETE'])
@admin_required
def delete_llm_prompt(prompt_id):
    prompt = LlmPrompt.query.get(str(prompt_id))
    if not prompt:
        return jsonify({'error': '提示词未找到'}), 404
    try:
        if prompt.call_logs.first():
             return jsonify({'error': '无法删除：该提示词已被日志使用'}), 400
        db.session.delete(prompt)
        db.session.commit()
        return jsonify({'message': '提示词删除成功'})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"删除提示词失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500