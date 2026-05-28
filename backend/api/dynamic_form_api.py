from flask import Blueprint, jsonify, request
from backend.extensions import db
from backend.models import DynamicForm, UserFavoriteForm
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

        # 检查是否传入了 form_token，如果未传入则自动生成一个唯一的 token
        form_token = data.get('form_token')
        if not form_token:
            while True:
                # 生成一个 8 位的唯一 UUID 前缀
                form_token = uuid.uuid4().hex[:8]
                # 检查是否已存在，防止极低概率的哈希冲突
                if not DynamicForm.query.filter_by(form_token=form_token).first():
                    break

        new_form = DynamicForm(
            name=data['name'],
            form_token=form_token,  # 传入自动生成或显式指定的 token
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

    # --- 自动、无感记录最近访问时间 ---
    try:
        from flask_jwt_extended import verify_jwt_in_request
        verify_jwt_in_request(optional=True)
        current_user_id = get_jwt_identity()
        if current_user_id:
            fav = UserFavoriteForm.query.filter_by(user_id=current_user_id, form_id=form.id).first()
            if fav:
                fav.last_accessed_at = db.func.now()
            else:
                new_fav = UserFavoriteForm(
                    user_id=current_user_id,
                    form_id=form.id,
                    is_pinned=False
                )
                db.session.add(new_fav)
            db.session.commit()
    except Exception as e:
        db.session.rollback()
        import logging
        logging.getLogger(__name__).error(f"自动记录表单访问失败: {e}")
    
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
    import logging
    import json
    from sqlalchemy.orm.attributes import flag_modified
    logger = logging.getLogger(__name__)
    
    form = db.session.get(DynamicForm, form_id)
    if not form:
        return jsonify({'message': 'DynamicForm not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'message': 'No input data provided'}), 400

    # 详细调试日志
    logger.info(f"[PATCH form] ========== 开始更新表单 ==========")
    logger.info(f"[PATCH form] form_id={form_id}")
    logger.info(f"[PATCH form] Received keys: {list(data.keys())}")
    
    if 'surveyjs_schema' in data:
        new_schema = data['surveyjs_schema']
        old_schema = form.surveyjs_schema or {}
        
        logger.info(f"[PATCH form] === 新 Schema ===")
        logger.info(f"[PATCH form] 新 title: {new_schema.get('title')}")
        logger.info(f"[PATCH form] 新 description: {new_schema.get('description')}")
        
        new_pages = new_schema.get('pages', [])
        logger.info(f"[PATCH form] 新 pages 数量: {len(new_pages)}")
        for i, page in enumerate(new_pages):
            elements = page.get('elements', [])
            logger.info(f"[PATCH form] 新 Page {i}: elements 数量={len(elements)}")
            for j, el in enumerate(elements[:3]):  # 只显示前3个
                logger.info(f"[PATCH form]   Element {j}: name={el.get('name')}, type={el.get('type')}")
        
        logger.info(f"[PATCH form] === 旧 Schema ===")
        logger.info(f"[PATCH form] 旧 title: {old_schema.get('title')}")
        logger.info(f"[PATCH form] 旧 description: {old_schema.get('description')}")
        
        old_pages = old_schema.get('pages', [])
        logger.info(f"[PATCH form] 旧 pages 数量: {len(old_pages)}")
        for i, page in enumerate(old_pages):
            elements = page.get('elements', [])
            logger.info(f"[PATCH form] 旧 Page {i}: elements 数量={len(elements)}")
    else:
        logger.warning(f"[PATCH form] surveyjs_schema NOT in request data!")

    # 更新 JSONB 字段并标记为已修改
    if 'surveyjs_schema' in data:
        form.surveyjs_schema = data['surveyjs_schema']
        flag_modified(form, 'surveyjs_schema')  # 关键：通知 SQLAlchemy JSONB 字段已变化
        logger.info(f"[PATCH form] surveyjs_schema 已赋值并标记为 modified")
    
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
        logger.info(f"[PATCH form] ========== 保存成功 ==========")
        
        # 验证保存后的数据
        db.session.refresh(form)
        saved_schema = form.surveyjs_schema or {}
        logger.info(f"[PATCH form] === 验证保存后的 Schema ===")
        logger.info(f"[PATCH form] 保存后 title: {saved_schema.get('title')}")
        logger.info(f"[PATCH form] 保存后 pages 数量: {len(saved_schema.get('pages', []))}")
        
        return jsonify({'message': 'DynamicForm updated successfully'}), 200
    except Exception as e:
        db.session.rollback()
        logger.error(f"[PATCH form] Error saving form: {e}")
        return jsonify({'message': 'An error occurred while updating the form', 'error': str(e)}), 500


# TODO: Add POST, PUT, DELETE routes for managing dynamic forms if needed.
# For now, we assume forms are migrated and read-only.

@dynamic_form_bp.route('/<string:form_token>/data/<uuid:data_id>', methods=['GET'])
@jwt_required()
def get_form_data_by_token_and_id(form_token, data_id):
    """
    根据 form_token 和 data_id 获取单条表单提交的数据。
    """
    from backend.models import DynamicFormData
    from sqlalchemy.orm import joinedload

    # Verify form exists
    form = DynamicForm.query.filter_by(form_token=form_token).first()
    if not form:
        return jsonify({'message': 'DynamicForm not found'}), 404

    form_data = DynamicFormData.query.options(
        joinedload(DynamicFormData.dynamic_form)
    ).filter_by(id=data_id, form_id=form.id).first()
    
    if not form_data:
        return jsonify({'message': 'Form data not found'}), 404

    # --- 基础数据序列化 ---
    response_data = {
        'id': str(form_data.id),
        'form_id': str(form_data.form_id),
        'form_data': form_data.data, # Note: Frontend expects 'form_data' key based on previous code
        'user_id': str(form_data.user_id) if form_data.user_id else None,
        'score': form_data.score,
        'result_details': form_data.result_details,
        'created_at': form_data.created_at.isoformat(),
        'updated_at': form_data.updated_at.isoformat(),
    }

    return jsonify(response_data), 200


@dynamic_form_bp.route('/favorites', methods=['GET'])
@jwt_required()
def get_user_favorites():
    """
    获取当前登录用户的所有常用表单（区分置顶项与最近使用项）。
    """
    current_user_id = get_jwt_identity()

    # 1. 置顶项：is_pinned == True
    pinned_favorites = db.session.query(DynamicForm, UserFavoriteForm.is_pinned, UserFavoriteForm.last_accessed_at).join(
        UserFavoriteForm, UserFavoriteForm.form_id == DynamicForm.id
    ).filter(
        UserFavoriteForm.user_id == current_user_id,
        UserFavoriteForm.is_pinned == True
    ).all()

    # 2. 最近使用：is_pinned == False 且有最近访问时间，按最近访问倒序前 5 项
    recent_favorites = db.session.query(DynamicForm, UserFavoriteForm.is_pinned, UserFavoriteForm.last_accessed_at).join(
        UserFavoriteForm, UserFavoriteForm.form_id == DynamicForm.id
    ).filter(
        UserFavoriteForm.user_id == current_user_id,
        UserFavoriteForm.is_pinned == False,
        UserFavoriteForm.last_accessed_at.isnot(None)
    ).order_by(
        UserFavoriteForm.last_accessed_at.desc()
    ).limit(5).all()
    
    def serialize_form(form, is_pinned, last_accessed_at):
        return {
            'id': str(form.id),
            'name': form.name,
            'form_token': form.form_token,
            'description': form.description,
            'form_type': form.form_type,
            'folder_id': str(form.folder_id) if form.folder_id else None,
            'is_pinned': is_pinned,
            'last_accessed_at': last_accessed_at.isoformat() if last_accessed_at else None
        }

    return jsonify({
        'pinned': [serialize_form(f, pin, lat) for f, pin, lat in pinned_favorites],
        'recent': [serialize_form(f, pin, lat) for f, pin, lat in recent_favorites]
    }), 200


@dynamic_form_bp.route('/favorites/toggle', methods=['POST'])
@jwt_required()
def toggle_favorite():
    """
    原子化切换表单的置顶 (is_pinned) 状态。
    """
    current_user_id = get_jwt_identity()
    data = request.get_json() or {}
    form_id = data.get('form_id')
    if not form_id:
        return jsonify({'message': 'Missing form_id'}), 400
        
    fav = UserFavoriteForm.query.filter_by(user_id=current_user_id, form_id=form_id).first()
    if fav:
        if fav.is_pinned:
            # 如果曾经被访问过（即 last_accessed_at 不为空），我们仅仅是取消置顶，退回“最近访问”队列
            if fav.last_accessed_at:
                fav.is_pinned = False
                db.session.commit()
                return jsonify({'status': 'unpinned', 'message': '已取消置顶'}), 200
            else:
                # 否则，纯手动置顶，直接物理删除关联
                db.session.delete(fav)
                db.session.commit()
                return jsonify({'status': 'removed', 'message': '已取消收藏'}), 200
        else:
            # 如果是在“最近访问”中，直接升级为置顶
            fav.is_pinned = True
            db.session.commit()
            return jsonify({'status': 'pinned', 'message': '已置顶表单'}), 200
    else:
        # 原本没有任何关联，直接创建并置顶
        new_fav = UserFavoriteForm(user_id=current_user_id, form_id=form_id, is_pinned=True)
        db.session.add(new_fav)
        db.session.commit()
        return jsonify({'status': 'pinned', 'message': '已置顶表单'}), 201


