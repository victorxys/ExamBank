from flask import Blueprint, jsonify, request, current_app
from backend.extensions import db
from backend.models import DynamicFormData, DynamicForm, ServicePersonnel, BaseContract
from sqlalchemy.orm import joinedload
from flask_jwt_extended import jwt_required, get_current_user
import json
import uuid
import base64
import re
import os
import time
from io import BytesIO
from backend.services.exam_service import _calculate_exam_score

# R2 配置
import boto3
from botocore.client import Config

dynamic_form_data_bp = Blueprint('dynamic_form_data_api', __name__, url_prefix='/api/form-data')


def _get_r2_client():
    """获取 R2 客户端"""
    CF_ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID")
    R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID")
    R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")
    R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME")
    
    if not all([CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME]):
        return None, None
    
    client = boto3.client(
        's3',
        endpoint_url=f'https://{CF_ACCOUNT_ID}.r2.cloudflarestorage.com',
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=Config(signature_version='s3v4')
    )
    return client, R2_BUCKET_NAME


def _upload_signature_to_r2(base64_data, form_token, field_name, data_id):
    """
    将 base64 签名数据上传到 R2，返回图片 URL。
    """
    if not base64_data or not base64_data.startswith('data:image'):
        return base64_data  # 不是 base64 图片数据，原样返回
    
    try:
        # 解析 base64 数据
        # 格式: data:image/png;base64,iVBORw0KGgo...
        match = re.match(r'data:image/(\w+);base64,(.+)', base64_data)
        if not match:
            current_app.logger.warning(f"Invalid base64 image format for {field_name}")
            return base64_data
        
        image_format = match.group(1)  # png, jpeg, etc.
        image_data = base64.b64decode(match.group(2))
        
        # 获取 R2 客户端
        s3, bucket_name = _get_r2_client()
        if not s3:
            current_app.logger.error("R2 client not configured, cannot upload signature")
            return base64_data
        
        # 生成文件名: form_token/data_id/field_name/timestamp_signature.png
        timestamp = time.time()
        filename = f"{form_token}/{data_id}/{field_name}/{form_token}_{field_name}_{timestamp}_signature.{image_format}"
        
        # 上传到 R2
        s3.put_object(
            Bucket=bucket_name,
            Key=filename,
            Body=BytesIO(image_data),
            ContentType=f'image/{image_format}'
        )
        
        # 返回公开 URL
        PUBLIC_DOMAIN = os.environ.get("PUBLIC_DOMAIN", "https://img.mengyimengsao.com")
        url = f"{PUBLIC_DOMAIN}/{filename}"
        current_app.logger.info(f"Signature uploaded to R2: {url}")
        return url
        
    except Exception as e:
        current_app.logger.error(f"Error uploading signature to R2: {e}", exc_info=True)
        return base64_data  # 上传失败，返回原始数据


def _process_signaturepad_fields(form_data_content, surveyjs_schema, form_token, data_id):
    """
    处理表单数据中的 signaturepad 字段，将 base64 数据上传到 R2。
    返回处理后的表单数据。
    """
    if not surveyjs_schema or 'pages' not in surveyjs_schema:
        return form_data_content
    
    # 找出所有 signaturepad 类型的字段
    signaturepad_fields = set()
    for page in surveyjs_schema.get('pages', []):
        for element in page.get('elements', []):
            if element.get('type') == 'signaturepad':
                signaturepad_fields.add(element.get('name'))
    
    if not signaturepad_fields:
        return form_data_content
    
    # 处理每个 signaturepad 字段
    processed_data = dict(form_data_content)
    for field_name in signaturepad_fields:
        if field_name in processed_data:
            value = processed_data[field_name]
            if value and isinstance(value, str) and value.startswith('data:image'):
                # 上传到 R2 并替换为 URL
                processed_data[field_name] = _upload_signature_to_r2(
                    value, form_token, field_name, data_id
                )
    
    return processed_data

def get_model_by_name(model_name):
    """安全地根据模型名称字符串获取模型类。"""
    # 在这里维护一个安全的模型名称到类的映射
    model_map = {
        'ServicePersonnel': ServicePersonnel,
        'BaseContract': BaseContract,
        # 根据需要添加更多模型
    }
    return model_map.get(model_name)

def _process_sync_mapping(form_data_instance, dynamic_form_instance, current_user):
    """
    处理动态表单的同步映射逻辑，根据配置创建或更新关联模型的记录。
    """
    sync_mapping = dynamic_form_instance.sync_mapping
    if not sync_mapping:
        return

    for target_model_name, config in sync_mapping.items():
        TargetModel = get_model_by_name(config.get('model'))
        if not TargetModel:
            print(f"Warning: Sync mapping target model '{config.get('model')}' not found in model map.")
            continue
        
        mappings_list = config.get('mappings', [])

        # 尝试通过 form_data_instance 上的外键找到关联记录
        target_record = None
        if target_model_name == 'ServicePersonnel' and form_data_instance.service_personnel_id:
            target_record = db.session.query(TargetModel).get(form_data_instance.service_personnel_id)
        elif target_model_name == 'User' and form_data_instance.user_id:
            target_record = db.session.query(TargetModel).get(form_data_instance.user_id)
        
        # 如果没有通过外键找到，尝试通过 lookup_field 查找
        if not target_record:
            lookup_field_name = config.get('lookup_field')
            lookup_form_field = None
            for m in mappings_list:
                if m.get('target_field') == lookup_field_name:
                    lookup_form_field = m.get('form_field')
                    break
            
            if lookup_field_name and lookup_form_field:
                lookup_value = form_data_instance.data.get(lookup_form_field)
                if lookup_value:
                    filter_attr = getattr(TargetModel, lookup_field_name, None)
                    if filter_attr:
                        target_record = db.session.query(TargetModel).filter(filter_attr == lookup_value).first()
                    else:
                        print(f"Warning: Lookup field '{lookup_field_name}' not found in model '{target_model_name}'.")

        # 准备数据
        data_to_update = {}
        for mapping in mappings_list:
            form_field = mapping['form_field']
            target_field = mapping['target_field']
            transform = mapping.get('transform')
            
            value = form_data_instance.data.get(form_field)
            
            if value is not None:
                if transform == 'str':
                    value = str(value)
                elif transform == 'int':
                    try:
                        value = int(value)
                    except (ValueError, TypeError):
                        value = None # 或者抛出错误
                # 可以添加更多转换类型
                
                data_to_update[target_field] = value
        
        if target_record:
            # 更新现有记录
            for key, value in data_to_update.items():
                setattr(target_record, key, value)
            db.session.add(target_record) # 标记为更新
        else:
            # 创建新记录
            if data_to_update: # 确保有数据才创建
                target_record = TargetModel(**data_to_update)
                db.session.add(target_record)
                db.session.flush() # 刷新会话以获取新记录的ID
            else:
                print(f"Warning: No data to create new '{target_model_name}' record.")
                continue
        
        # 如果是 ServicePersonnel 或 User，更新 form_data_instance 上的外键
        if target_model_name == 'ServicePersonnel' and hasattr(target_record, 'id'):
            form_data_instance.service_personnel_id = target_record.id
        elif target_model_name == 'User' and hasattr(target_record, 'id'):
            form_data_instance.user_id = target_record.id

@dynamic_form_data_bp.route('/list/<uuid:form_id>', methods=['GET'])
@jwt_required()
def get_form_data_list_by_form_id(form_id):
    """
    根据 form_id 获取所有提交的表单数据列表。
    """
    form_data_entries = DynamicFormData.query.filter_by(form_id=form_id).all()
    
    return jsonify([
        {
            'id': str(entry.id),
            'form_id': str(entry.form_id),
            'user_id': str(entry.user_id) if entry.user_id else None,
            'data': entry.data,
            'score': entry.score, # 添加 score 字段
            'created_at': entry.created_at.isoformat(),
            'updated_at': entry.updated_at.isoformat(),
        } for entry in form_data_entries
    ]), 200

@dynamic_form_data_bp.route('/<uuid:data_id>', methods=['GET'])
@jwt_required()
def get_form_data_by_id(data_id):
    """
    根据 ID 获取单条表单提交的数据，包含分数、结果详情和表单结构。
    """
    form_data = DynamicFormData.query.options(
        joinedload(DynamicFormData.dynamic_form)
    ).get(data_id)
    
    if not form_data:
        return jsonify({'message': 'Form data not found'}), 404

    # --- 基础数据序列化 ---
    response_data = {
        'id': str(form_data.id),
        'form_id': str(form_data.form_id),
        'data': form_data.data,
        'user_id': str(form_data.user_id) if form_data.user_id else None,
        'score': form_data.score,
        'result_details': form_data.result_details,
        'dynamic_form': {
            'name': form_data.dynamic_form.name,
            'surveyjs_schema': form_data.dynamic_form.surveyjs_schema,
            'jinshuju_schema': form_data.dynamic_form.jinshuju_schema,
        },
        'created_at': form_data.created_at.isoformat(),
        'updated_at': form_data.updated_at.isoformat(),
        'resolved_associations': {} # 用于存放聚合的关联数据
    }

    # --- 处理 record_association 逻辑 ---
    form_schema = form_data.dynamic_form.surveyjs_schema
    
    if not form_schema or 'pages' not in form_schema or not form_schema['pages']:
        return jsonify(response_data), 200

    all_elements = [elem for page in form_schema.get('pages', []) for elem in page.get('elements', [])]

    for element in all_elements:
        if element.get('type') == 'record_association':
            question_name = element.get('name')
            association_config = element.get('association_config', {})
            target_model_name = association_config.get('target_model')
            
            associated_record_id = form_data.data.get(question_name)

            if not target_model_name or not associated_record_id:
                continue

            TargetModel = get_model_by_name(target_model_name)
            if not TargetModel:
                print(f"Warning: Target model '{target_model_name}' not found in model map.")
                continue

            associated_record = db.session.query(TargetModel).get(associated_record_id)
            
            if associated_record:
                if hasattr(associated_record, 'to_dict'):
                    response_data['resolved_associations'][question_name] = associated_record.to_dict()
                else:
                    response_data['resolved_associations'][question_name] = {'id': str(associated_record.id)}

    return jsonify(response_data), 200

@dynamic_form_data_bp.route('/submit/<uuid:form_id>', methods=['POST'])
@jwt_required(optional=True)
def submit_form_data(form_id):
    """
    提交新的表单数据。如果表单是考试类型，则自动评分。
    支持匿名提交。
    """
    current_user = get_current_user()
    # if not current_user:
    #     return jsonify({'message': 'Unauthorized'}), 401

    form_data_json = request.get_json()
    if not form_data_json or 'data' not in form_data_json:
        return jsonify({'message': 'Missing form data in request body'}), 400
    
    form_data_content = form_data_json['data']

    dynamic_form = DynamicForm.query.get(form_id)
    if not dynamic_form:
        return jsonify({'message': 'DynamicForm not found'}), 404

    score = None
    result_details = None

    # 如果是考试，则计算分数
    if dynamic_form.form_type == 'EXAM':
        score, result_details = _calculate_exam_score(
            dynamic_form.surveyjs_schema,
            form_data_content
        )

    try:
        # 先生成 data_id 用于签名文件路径
        data_id = str(uuid.uuid4())
        
        # 处理 signaturepad 字段，将 base64 上传到 R2
        processed_data = _process_signaturepad_fields(
            form_data_content,
            dynamic_form.surveyjs_schema,
            dynamic_form.form_token,
            data_id
        )
        
        new_form_data = DynamicFormData(
            id=uuid.UUID(data_id),
            form_id=form_id,
            user_id=current_user.id if current_user else None,
            data=processed_data,
            score=score,
            result_details=result_details
        )
        db.session.add(new_form_data)
        db.session.flush()

        _process_sync_mapping(new_form_data, dynamic_form, current_user)
        
        db.session.commit()
            
        response = {
            'message': 'Form data submitted successfully',
            'id': str(new_form_data.id)
        }
        if score is not None:
            response['score'] = score

        return jsonify(response), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error submitting form data: {e}", exc_info=True)
        return jsonify({'message': 'Error submitting form data', 'error': str(e)}), 500

@dynamic_form_data_bp.route('/<uuid:data_id>', methods=['PATCH'])
@jwt_required()
def update_form_data(data_id):
    """
    更新现有表单数据。如果表单是考试类型，则自动重新评分。
    """
    current_user = get_current_user()
    if not current_user:
        return jsonify({'message': 'Unauthorized'}), 401

    form_data_json = request.get_json()
    if not form_data_json or 'data' not in form_data_json:
        return jsonify({'message': 'Missing form data in request body'}), 400
    
    updated_data_content = form_data_json['data']

    form_data = DynamicFormData.query.options(
        joinedload(DynamicFormData.dynamic_form)
    ).get(data_id)
    
    if not form_data:
        return jsonify({'message': 'Form data not found'}), 404

    try:
        # 处理 signaturepad 字段，将 base64 上传到 R2
        processed_data = _process_signaturepad_fields(
            updated_data_content,
            form_data.dynamic_form.surveyjs_schema,
            form_data.dynamic_form.form_token,
            str(data_id)
        )
        
        # 更新基础数据
        form_data.data = processed_data
        form_data.updated_at = db.func.now()

        # 如果是考试，则重新计算分数
        if form_data.dynamic_form.form_type == 'EXAM':
            score, result_details = _calculate_exam_score(
                form_data.dynamic_form.surveyjs_schema,
                processed_data
            )
            form_data.score = score
            form_data.result_details = result_details

        # 处理同步映射逻辑
        _process_sync_mapping(form_data, form_data.dynamic_form, current_user)
        
        db.session.commit()
            
        response = {
            'message': 'Form data updated successfully',
            'id': str(form_data.id)
        }
        if form_data.score is not None:
            response['score'] = form_data.score

        return jsonify(response), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error updating form data: {e}", exc_info=True)
        return jsonify({'message': 'Error updating form data', 'error': str(e)}), 500

@dynamic_form_data_bp.route('/<uuid:data_id>', methods=['DELETE'])
@jwt_required()
def delete_form_data(data_id):
    """
    删除指定的表单数据记录。
    """
    current_user = get_current_user()
    if not current_user:
        return jsonify({'message': 'Unauthorized'}), 401

    form_data = DynamicFormData.query.get(data_id)
    
    if not form_data:
        return jsonify({'message': 'Form data not found'}), 404

    try:
        db.session.delete(form_data)
        db.session.commit()
        
        return jsonify({'message': 'Form data deleted successfully'}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error deleting form data: {e}", exc_info=True)
        return jsonify({'message': 'Error deleting form data', 'error': str(e)}), 500
