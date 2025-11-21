from flask import Blueprint, jsonify, request
from backend.extensions import db
from backend.models import DynamicForm
from sqlalchemy.exc import IntegrityError
from flask_jwt_extended import jwt_required, get_jwt_identity
import uuid

dynamic_form_bp = Blueprint('dynamic_form_api', __name__, url_prefix='/api/dynamic_forms')

@dynamic_form_bp.route('/', methods=['GET', 'POST'])
@jwt_required()
def manage_dynamic_forms():
    """
    获取所有动态表单的列表或创建一个新的动态表单。
    """
    if request.method == 'POST':
        data = request.get_json()
        if not data or 'name' not in data:
            return jsonify({'message': 'Missing required fields'}), 400

        new_form = DynamicForm(
            name=data['name'],
            description=data.get('description', ''),
            form_type=data.get('form_type', 'QUESTIONNAIRE'),
            surveyjs_schema=data.get('surveyjs_schema', {}),
            passing_score=data.get('passing_score'),
            exam_duration=data.get('exam_duration'),
            folder_id=data.get('folder_id')
        )
        try:
            db.session.add(new_form)
            db.session.commit()
            return jsonify({
                'message': 'DynamicForm created successfully',
                'id': str(new_form.id),
                'form_token': new_form.form_token
            }), 201
        except IntegrityError:
            db.session.rollback()
            return jsonify({'message': 'Form with this name or token already exists'}), 409
        except Exception as e:
            db.session.rollback()
            return jsonify({'message': 'An error occurred', 'error': str(e)}), 500

    # GET request logic
    forms = DynamicForm.query.all()
    return jsonify([
        {
            'id': str(form.id),
            'name': form.name,
            'form_token': form.form_token,
            'description': form.description,
            'form_type': form.form_type,
            'created_at': form.created_at.isoformat(),
            'updated_at': form.updated_at.isoformat(),
            'submission_count': form.form_data_records.count(),
            'folder_id': str(form.folder_id) if form.folder_id else None
        } for form in forms
    ]), 200

@dynamic_form_bp.route('/<string:form_token>', methods=['GET'])
def get_dynamic_form_by_token(form_token):
    """
    根据 form_token 获取单个表单的定义（包含 SurveyJS schema）。
    同时解析嵌套表单的元数据。
    """
    form = DynamicForm.query.filter_by(form_token=form_token).first()
    if not form:
        return jsonify({'message': 'DynamicForm not found'}), 404
    
    # 构建 associated_form_meta 用于动态解析嵌套表单
    associated_form_meta = {}
    
    if form.jinshuju_schema and 'fields' in form.jinshuju_schema:
        for field_wrapper in form.jinshuju_schema['fields']:
            for field_id, field_def in field_wrapper.items():
                # 检查是否是 form_association 类型
                if field_def.get('type') == 'form_association':
                    associated_token = field_def.get('associated_form_token')
                    display_fields = field_def.get('display_field_settings', [])
                    
                    if associated_token and display_fields:
                        # 获取关联表单的 schema
                        associated_form = DynamicForm.query.filter_by(form_token=associated_token).first()
                        
                        if associated_form and associated_form.jinshuju_schema:
                            # 构建字段映射
                            field_meta = {}
                            
                            for assoc_field_wrapper in associated_form.jinshuju_schema.get('fields', []):
                                for assoc_field_id, assoc_field_def in assoc_field_wrapper.items():
                                    # 检查是否在 display_field_settings 中
                                    if any(df.get('api_code') == assoc_field_id for df in display_fields):
                                        field_meta[assoc_field_id] = {
                                            'label': assoc_field_def.get('label', ''),
                                            'type': assoc_field_def.get('type', '')
                                        }
                            
                            # 存储到 associated_form_meta
                            associated_form_meta[field_id] = {
                                'associated_token': associated_token,
                                'fields': field_meta
                            }
    
    return jsonify({
        'id': str(form.id),
        'name': form.name,
        'form_token': form.form_token,
        'description': form.description,
        'form_type': form.form_type,
        'surveyjs_schema': form.surveyjs_schema,
        'jinshuju_schema': form.jinshuju_schema,
        'sync_mapping': form.sync_mapping,
        'associated_form_meta': associated_form_meta,  # 新增：嵌套表单元数据
        'folder_id': str(form.folder_id) if form.folder_id else None,
        'created_at': form.created_at.isoformat(),
        'updated_at': form.updated_at.isoformat(),
    }), 200

@dynamic_form_bp.route('/<uuid:form_id>', methods=['PATCH'])
@jwt_required()
def update_dynamic_form(form_id):
    """
    更新一个动态表单。
    """
    form = db.session.get(DynamicForm, form_id)
    if not form:
        return jsonify({'message': 'DynamicForm not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'message': 'No input data provided'}), 400

    form.surveyjs_schema = data.get('surveyjs_schema', form.surveyjs_schema)
    form.form_type = data.get('form_type', form.form_type)
    form.passing_score = data.get('passing_score', form.passing_score)
    form.exam_duration = data.get('exam_duration', form.exam_duration)
    
    if 'name' in data:
        form.name = data['name']
    if 'description' in data:
        form.description = data['description']
    if 'folder_id' in data:
        form.folder_id = data['folder_id']

    try:
        db.session.commit()
        return jsonify({'message': 'DynamicForm updated successfully'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'message': 'An error occurred while updating the form', 'error': str(e)}), 500


# TODO: Add POST, PUT, DELETE routes for managing dynamic forms if needed.
# For now, we assume forms are migrated and read-only.
