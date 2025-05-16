# backend/api/tts_api.py

from flask import Blueprint, request, jsonify, current_app
from backend.models import db, TrainingCourse, TrainingContent, TtsScript, TtsSentence, TtsAudio, LlmPrompt, User
# 假设您已经将 @admin_required 放在了 security_utils.py 或者您希望从其他地方导入
# from backend.security_utils import admin_required 
# 如果还没有，我们可以先简单地使用 @jwt_required()，并后续根据需要替换或增强
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
import uuid
import os
from backend.api.ai_generate import transform_text_with_llm, log_llm_call # 确保也导入 log_llm_call
import requests
import json
from celery_worker import celery_app as celery_app_instance

from backend.tasks import generate_single_sentence_audio_async # 导入新的Celery任务
from backend.tasks import batch_generate_audio_task # <--- 新增导入

# from backend.tasks import generate_merged_audio_async # 导入新的Celery任务``
from backend.tasks import trigger_tts_refine_async # 导入新的Celery任务
from celery.result import AsyncResult # 可以显式导入 AsyncResult
from sqlalchemy import func, or_ # 导入 SQLAlchemy 的函数和操作符



tts_bp = Blueprint('tts', __name__, url_prefix='/api/tts')

# 辅助函数检查管理员角色 (您可以将其移至 security_utils.py)
def admin_required(fn):
    @jwt_required()
    def wrapper(*args, **kwargs):
        claims = get_jwt()
        if claims.get('role') != 'admin':
            return jsonify(msg="管理员权限不足"), 403
        return fn(*args, **kwargs)
    wrapper.__name__ = fn.__name__ # 保留原函数名，方便调试
    return wrapper

# --- 培训内容管理 (TrainingContent) ---

@tts_bp.route('/training-contents', methods=['POST'])
@jwt_required() # 允许登录用户创建，如果需要管理员，则替换为 @admin_required
def create_training_content():
    """
    上传新的培训内容并与课程关联。
    请求体: {
        "course_id": "uuid_string",
        "content_name": "string",
        "original_content": "string (大量文本)",
        "llm_oral_prompt_id": "uuid_string (可选)",
        "llm_refine_prompt_id": "uuid_string (可选)"
    }
    """
    data = request.get_json()
    current_user_id_str = get_jwt_identity()

    required_fields = ['course_id', 'content_name', 'original_content']
    if not all(field in data and data[field] for field in required_fields):
        return jsonify({'error': '缺少必要字段: course_id, content_name, original_content'}), 400

    try:
        # 验证 UUID 格式
        try:
            course_uuid = uuid.UUID(data['course_id'])
            current_user_uuid = uuid.UUID(current_user_id_str)
            llm_oral_prompt_uuid = uuid.UUID(data.get('llm_oral_prompt_id')) if data.get('llm_oral_prompt_id') else None
            llm_refine_prompt_uuid = uuid.UUID(data.get('llm_refine_prompt_id')) if data.get('llm_refine_prompt_id') else None
        except ValueError:
            return jsonify({'error': '无效的ID格式'}), 400

        course = TrainingCourse.query.get(str(course_uuid))
        if not course:
            return jsonify({'error': '指定的课程不存在'}), 404
        
        uploader = User.query.get(str(current_user_uuid))
        if not uploader:
             return jsonify({'error': '上传用户不存在'}), 404 # 理论上JWT有效，用户应该存在

        if llm_oral_prompt_uuid and not LlmPrompt.query.get(str(llm_oral_prompt_uuid)):
            return jsonify({'error': '指定的口语化处理LLM Prompt不存在'}), 404
        
        if llm_refine_prompt_uuid and not LlmPrompt.query.get(str(llm_refine_prompt_uuid)):
            return jsonify({'error': '指定的修订refine脚本LLM Prompt不存在'}), 404

        new_content = TrainingContent(
            course_id=str(course_uuid), # 存储为字符串或UUID对象均可，SQLAlchemy会处理
            content_name=data['content_name'],
            original_content=data['original_content'],
            status='pending_oral_script', 
            uploaded_by_user_id=str(current_user_uuid),
            llm_oral_prompt_id=str(llm_oral_prompt_uuid) if llm_oral_prompt_uuid else None,
            llm_refine_prompt_id=str(llm_refine_prompt_uuid) if llm_refine_prompt_uuid else None
        )
        db.session.add(new_content)
        db.session.commit()
        
        current_app.logger.info(f"用户 {current_user_id_str} 创建了培训内容 {new_content.id} ({new_content.content_name})")

        return jsonify({
            'id': str(new_content.id), # 返回 UUID 字符串
            'message': '培训内容上传成功，等待处理。'
        }), 201
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"创建培训内容失败: {e}", exc_info=True)
        return jsonify({'error': '创建培训内容时发生服务器错误: ' + str(e)}), 500

@tts_bp.route('/training-contents/by-course/<uuid:course_id>', methods=['GET'])
@jwt_required() 
def get_training_contents_by_course(course_id):
    """获取指定课程下的所有培训内容列表"""
    try:
        # 验证 course_id
        course = TrainingCourse.query.get(str(course_id))
        if not course:
            return jsonify({'error': '指定的课程不存在'}), 404
            
        contents = TrainingContent.query.filter_by(course_id=str(course_id)).order_by(TrainingContent.created_at.desc()).all()
        return jsonify([{
            'id': str(content.id),
            'content_name': content.content_name,
            'status': content.status,
            'created_at': content.created_at.isoformat() if content.created_at else None,
            'updated_at': content.updated_at.isoformat() if content.updated_at else None,
            'uploader_username': content.uploader.username if content.uploader else 'N/A'
        } for content in contents])
    except Exception as e:
        current_app.logger.error(f"获取课程 {course_id} 的培训内容失败: {e}", exc_info=True)
        return jsonify({'error': '获取培训内容列表时发生服务器错误: ' + str(e)}), 500

@tts_bp.route('/training-contents/<uuid:content_id>', methods=['GET'])
@jwt_required()
def get_training_content_detail(content_id):
    current_app.logger.info(f"--- get_training_content_detail CALLED for content_id: {content_id} ---") # 1. 确认函数被调用
    try:
        content = TrainingContent.query.get(str(content_id))
        if not content:
            current_app.logger.warning(f"TrainingContent with ID {content_id} not found.")
            return jsonify({'error': '培训内容未找到'}), 404
        # --- 关键的调试步骤：强制刷新对象 ---
       
        current_app.logger.info(f"获取到 TrainingContent 对象: {content.id}, 尝试从数据库刷新...")
        db.session.refresh(content)
        current_app.logger.info(f"使 content.tts_scripts 关系过期...")
        db.session.expire(content, ['tts_scripts']) # 显式使 tts_scripts 关系过期
        current_app.logger.info(f"TrainingContent 对象 {content.id} 及其 tts_scripts 关系已处理。")
        # --- 调试步骤结束 ---

        current_app.logger.info(f"Found TrainingContent: {content.id}, status: {content.status}") # 2. 确认内容找到

        scripts_data = []
        # 3. 仔细检查这里的循环和属性访问
        for script in content.tts_scripts.order_by(TtsScript.script_type, TtsScript.version.desc()).all():
            # current_app.logger.debug(f"Processing script: ID {script.id}, Type {script.script_type}, Version {script.version}")
            script_info = {
                'id': str(script.id),
                'script_type': script.script_type,
                'version': script.version,
                'content': script.content,
                'created_at': script.created_at.isoformat() if script.created_at else None,
                'content_preview': script.content[:200] + ('...' if len(script.content) > 200 else ''),
                'llm_call_log_id': str(script.llm_call_log_id) if script.llm_call_log_id else None,
                'source_script_id': str(script.source_script_id) if script.source_script_id else None
            }
            scripts_data.append(script_info)
        
        current_app.logger.info(f"Processed {len(scripts_data)} scripts.") # 4. 确认脚本处理数量

        sentences_data = []
        current_app.logger.info(f"--- 开始直接查询 TtsScript 表获取最新的 final_tts_script for content_id: {content.id} ---")
        # --- 直接从 TtsScript 表查询最新的 final_tts_script ---
        latest_final_script = TtsScript.query.filter_by(
            training_content_id=content.id,  # 直接使用 content.id 作为过滤条件
            script_type='final_tts_script'
        ).order_by(TtsScript.version.desc()).first()
        # --- 直接查询结束 ---
        if latest_final_script:
            current_app.logger.info(
                f"[API_GET_SENTENCES_V3] (直接查询得到) 使用的 final_tts_script: ID={latest_final_script.id}, "
                f"Version={latest_final_script.version}, CreatedAt={latest_final_script.created_at}"
            )
            # ... (后续获取句子的逻辑使用这个 directly_queried_latest_script) ...
            db_sentences = latest_final_script.tts_sentences.order_by(TtsSentence.order_index).all() # 这里仍然可以用关系
            current_app.logger.info(
                f"[API_GET_SENTENCES_V3] (直接查询得到) 为脚本 ID {latest_final_script.id} 从数据库查询到 {len(db_sentences)} 个句子。"
            )
            for sentence in latest_final_script.tts_sentences.order_by(TtsSentence.order_index).all():
                # current_app.logger.debug(f"Processing sentence: ID {sentence.id}, Order {sentence.order_index}")
                latest_audio = sentence.audios.filter_by(is_latest_for_sentence=True).order_by(TtsAudio.created_at.desc()).first()
                # current_app.logger.debug(f"Latest audio for sentence {sentence.id}: {latest_audio.id if latest_audio else 'None'}")
                sentences_data.append({
                    'id': str(sentence.id),
                    'text': sentence.sentence_text,
                    'order_index': sentence.order_index,
                    'audio_status': sentence.audio_status,
                    'latest_audio_url': latest_audio.file_path if latest_audio else None, 
                    'latest_audio_id': str(latest_audio.id) if latest_audio else None,
                    'audio_duration_ms': latest_audio.duration_ms if latest_audio else None,
                })
        
        current_app.logger.info(f"Processed {len(sentences_data)} sentences.") # 6. 确认句子处理数量

        merged_audio_info = None
        # 注意：`content.merged_audios` 是一个 relationship，需要调用 .all() 或 .first()
        latest_merged_audio_query = content.merged_audios.filter_by(is_latest_for_content=True).order_by(TtsAudio.created_at.desc())
        # current_app.logger.debug(f"Merged audio query: {str(latest_merged_audio_query)}")
        latest_merged_audio = latest_merged_audio_query.first()
        # current_app.logger.info(f"Latest merged audio: {latest_merged_audio.id if latest_merged_audio else 'None'}") # 7. 确认合并语音

        if latest_merged_audio:
            merged_audio_info = {
                'id': str(latest_merged_audio.id),
                'file_path': latest_merged_audio.file_path,
                'duration_ms': latest_merged_audio.duration_ms,
                'file_size_bytes': latest_merged_audio.file_size_bytes,
                'created_at': latest_merged_audio.created_at.isoformat() if latest_merged_audio.created_at else None,
                'version': latest_merged_audio.version
            }

        response_payload = {
            'id': str(content.id),
            'content_name': content.content_name,
            'original_content': content.original_content,
            'original_content_preview': content.original_content[:500] + ('...' if len(content.original_content) > 500 else ''),
            'status': content.status,
            'created_at': content.created_at.isoformat() if content.created_at else None,
            'uploader_username': content.uploader.username if content.uploader else 'N/A',
            'llm_oral_prompt_name': content.llm_oral_prompt.prompt_name if content.llm_oral_prompt else None, # 8. 检查关联对象是否存在
            'llm_refine_prompt_name': content.llm_refine_prompt.prompt_name if content.llm_refine_prompt else None, # 8. 检查关联对象是否存在
            'scripts': scripts_data,
            'final_script_sentences': sentences_data,
            'latest_merged_audio': merged_audio_info
        }
        current_app.logger.info(f"Successfully prepared response for content {content_id}.") # 9. 确认响应准备完毕
        return jsonify(response_payload)
        
    except Exception as e:
        current_app.logger.error(f"获取培训内容 {content_id} 详情失败: {e}", exc_info=True) # 10. 捕获并记录详细错误
        return jsonify({'error': '获取培训内容详情时发生服务器内部错误: ' + str(e)}), 500

@tts_bp.route('/training-contents/<uuid:content_id>/original', methods=['GET'])
@jwt_required() # 或 @admin_required
def get_original_training_content(content_id):
    """获取培训内容的完整原始文本"""
    content = TrainingContent.query.get(str(content_id))
    if not content:
        return jsonify({'error': '培训内容未找到'}), 404
    return jsonify({'id': str(content.id), 'original_content': content.original_content})


@tts_bp.route('/training-contents/<uuid:content_id>', methods=['PUT'])
@admin_required # 更新通常需要更高权限
def update_training_content(content_id):
    """更新培训内容信息（名称、关联的Prompt等，不包括原始文本）"""
    data = request.get_json()
    content = TrainingContent.query.get(str(content_id))
    if not content:
        return jsonify({'error': '培训内容未找到'}), 404

    try:
        updated_fields = []
        if 'content_name' in data and data['content_name'].strip():
            content.content_name = data['content_name'].strip()
            updated_fields.append('名称')
        # 原始文本通常不在此接口更新，若需更新，应有特定流程，例如重新上传或版本管理
        # if 'original_content' in data:
        #     content.original_content = data['original_content']
        #     updated_fields.append('原始文本')

        if 'llm_oral_prompt_id' in data:
            if data['llm_oral_prompt_id']:
                try:
                    prompt_uuid = uuid.UUID(data['llm_oral_prompt_id'])
                    if not LlmPrompt.query.get(str(prompt_uuid)):
                        return jsonify({'error': '指定的口语化处理LLM Prompt不存在'}), 400
                    content.llm_oral_prompt_id = str(prompt_uuid)
                except ValueError:
                     return jsonify({'error': '口语化Prompt ID格式无效'}), 400
            else: # 如果传来空字符串或null，则清空
                content.llm_oral_prompt_id = None
            updated_fields.append('口语化Prompt')

        if 'llm_refine_prompt_id' in data:
            if data['llm_refine_prompt_id']:
                try:
                    prompt_uuid = uuid.UUID(data['llm_refine_prompt_id'])
                    if not LlmPrompt.query.get(str(prompt_uuid)):
                        return jsonify({'error': '指定的修订refine脚本LLM Prompt不存在'}), 400
                    content.llm_refine_prompt_id = str(prompt_uuid)
                except ValueError:
                     return jsonify({'error': '修订Prompt ID格式无效'}), 400
            else:
                content.llm_refine_prompt_id = None
            updated_fields.append('修订Prompt')

        if not updated_fields:
            return jsonify({'message': '没有提供可更新的字段'}), 400

        db.session.commit()
        current_app.logger.info(f"培训内容 {content_id} 的 {', '.join(updated_fields)} 已更新")
        return jsonify({'message': '培训内容更新成功', 'id': str(content.id)})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新培训内容 {content_id} 失败: {e}", exc_info=True)
        return jsonify({'error': '更新培训内容时发生服务器错误: ' + str(e)}), 500


@tts_bp.route('/training-contents/<uuid:content_id>', methods=['DELETE'])
@admin_required 
def delete_training_content(content_id):
    """删除培训内容及其所有相关数据"""
    content = TrainingContent.query.get(str(content_id))
    if not content:
        return jsonify({'error': '培训内容未找到'}), 404
    try:
        # 注意：模型中定义的 cascade delete 会自动处理 TtsScript, TtsSentence, TtsAudio 的删除
        # 如果 TtsAudio.file_path 对应的是物理文件，需要在这里或异步任务中添加删除物理文件的逻辑
        # 示例：
        # for script in content.tts_scripts:
        #     for sentence in script.tts_sentences:
        #         for audio in sentence.audios:
        #             # delete_physical_file(audio.file_path) # 实现这个函数
        #             pass
        # for merged_audio in content.merged_audios:
        #     # delete_physical_file(merged_audio.file_path)
        #     pass
        
        content_name_for_log = content.content_name
        db.session.delete(content)
        db.session.commit()
        current_app.logger.info(f"培训内容 {content_id} ({content_name_for_log}) 已被删除")
        return jsonify({'message': '培训内容及其关联数据删除成功'})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"删除培训内容 {content_id} 失败: {e}", exc_info=True)
        return jsonify({'error': '删除培训内容时发生服务器错误: ' + str(e)}), 500


# --- TTS 脚本 (TtsScript) 的基础 API ---
@tts_bp.route('/scripts/<uuid:script_id>', methods=['GET'])
@jwt_required()
def get_script_content(script_id):
    """获取特定脚本的完整内容"""
    try:
        script = TtsScript.query.get(str(script_id))
        if not script:
            return jsonify({'error': '脚本未找到'}), 404
        return jsonify({
            'id': str(script.id),
            'script_type': script.script_type,
            'content': script.content,
            'version': script.version,
            'training_content_id': str(script.training_content_id)
        })
    except Exception as e:
        current_app.logger.error(f"获取脚本 {script_id} 内容失败: {e}", exc_info=True)
        return jsonify({'error': '获取脚本内容时发生服务器错误: ' + str(e)}), 500

# PUT /api/tts/scripts/<script_id> (手动更新 final_tts_script 内容的 API) 将在第2步细化
@tts_bp.route('/scripts/<uuid:script_id>', methods=['PUT'])
@admin_required
def update_script_content_route(script_id): # Renamed to avoid conflict with get_script_content
    data = request.get_json()
    script = TtsScript.query.get(str(script_id))
    if not script: return jsonify({'error': '脚本未找到'}), 404
    
    new_content = data.get('content')
    if new_content is None or not isinstance(new_content, str):
        return jsonify({'error': '脚本内容 (content) 缺失或格式不正确'}), 400
    
    new_content_stripped = new_content.strip()
    if not new_content_stripped:
        return jsonify({'error': '脚本内容不能为空'}), 400

    try:
        if script.content == new_content_stripped:
            return jsonify({'message': '脚本内容未改变', 'id': str(script.id)}), 200

        script.content = new_content_stripped
        script.version += 1 # 更新版本号
        script.updated_at = func.now() # SQLAlchemy会自动处理 onupdate, 但显式设置也没问题

        # 如果是 final_tts_script 被修改，需要特殊处理
        if script.script_type == 'final_tts_script':
            current_app.logger.info(f"最终TTS脚本 {script.id} 内容被手动更新，版本升至 {script.version}.")
            # 1. 删除旧的句子和它们关联的语音（包括物理文件）
            old_sentences = TtsSentence.query.filter_by(tts_script_id=script.id).all()
            for old_sentence in old_sentences:
                audios_to_delete = TtsAudio.query.filter_by(tts_sentence_id=old_sentence.id).all()
                for audio_record in audios_to_delete:
                    # TODO: 实际物理文件删除
                    current_app.logger.warning(f"TODO: 物理删除文件 {audio_record.file_path} for audio {audio_record.id} due to final script update.")
                    db.session.delete(audio_record)
                db.session.delete(old_sentence)
            
            # 2. 更新 TrainingContent 状态，以便前端或后续流程知道需要重新拆分句子
            if script.training_content:
                script.training_content.status = 'pending_sentence_split' # 或更明确的状态
                current_app.logger.info(f"内容 {script.training_content_id} 状态更新为 {script.training_content.status}，因最终脚本被编辑。")

        db.session.commit()
        return jsonify({'message': '脚本更新成功', 'id': str(script.id), 'new_version': script.version})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新脚本 {script_id} 失败: {e}", exc_info=True)
        return jsonify({'error': f'更新脚本时发生服务器错误: {str(e)}'}), 500

# --- TTS 句子 (TtsSentence) 的基础 API ---
@tts_bp.route('/sentences/<uuid:sentence_id>', methods=['PUT'])
@admin_required
def update_sentence_text(sentence_id):
    data = request.get_json()
    sentence = TtsSentence.query.get(str(sentence_id))
    if not sentence:
        return jsonify({'error': '句子未找到'}), 404
    
    # 检查 sentence_text 是否存在且为字符串
    sentence_text_value = data.get('sentence_text') # 使用 .get() 避免 KeyError

    if sentence_text_value is None:
        return jsonify({'error': '缺少句子内容 (sentence_text is missing)'}), 400
    
    if not isinstance(sentence_text_value, str):
        current_app.logger.error(f"更新句子 {sentence_id} 失败: sentence_text 期望是字符串，实际得到类型 {type(sentence_text_value)}，值为: {sentence_text_value}")
        return jsonify({'error': f'句子内容格式错误 (sentence_text should be a string, got {type(sentence_text_value).__name__})'}), 400
        
    new_text_stripped = sentence_text_value.strip()

    if not new_text_stripped: # 检查 strip 之后是否为空
        return jsonify({'error': '句子内容不能为空 (sentence_text cannot be empty after stripping)'}), 400
    
    try:
        original_text = sentence.sentence_text
        
        if original_text != new_text_stripped:
            sentence.sentence_text = new_text_stripped
            sentence.audio_status = 'pending_regeneration'
            sentence.updated_at = func.now()

            # 标记旧语音为非最新 (确保事务性)
            TtsAudio.query.filter_by(tts_sentence_id=sentence.id, is_latest_for_sentence=True).update({'is_latest_for_sentence': False}, synchronize_session=False) # 添加 synchronize_session=False
            
            db.session.commit()
            return jsonify({'message': '句子更新成功，语音状态已重置为待重新生成', 'id': str(sentence.id)}) # 确保返回 str(uuid)
        else:
            return jsonify({'message': '句子内容未改变', 'id': str(sentence.id)}), 200
            
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新句子 {sentence_id} 失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# --- TTS 音频 (TtsAudio) 的基础 API ---
@tts_bp.route('/audios/by-content/<uuid:content_id>', methods=['GET'])
@jwt_required()
def get_audios_by_content(content_id):
    """
    获取指定培训内容的所有音频文件信息。
    查询参数:
    - type: 'sentence_audio' | 'merged_audio' (可选, 默认为所有)
    - sentence_id: uuid_string (可选, 当 type=sentence_audio 时，筛选特定句子的音频)
    - latest_only: 'true' | 'false' (可选, 默认为 false, 'true'时只返回最新版本)
    """
    try:
        audio_type_filter = request.args.get('type')
        sentence_id_filter = request.args.get('sentence_id')
        latest_only_filter = request.args.get('latest_only', 'false').lower() == 'true'

        query = TtsAudio.query.filter_by(training_content_id=str(content_id))

        if audio_type_filter:
            query = query.filter_by(audio_type=audio_type_filter)
        
        if audio_type_filter == 'sentence_audio' and sentence_id_filter:
            query = query.filter_by(tts_sentence_id=str(sentence_id_filter))
        
        if latest_only_filter:
            if audio_type_filter == 'sentence_audio':
                query = query.filter_by(is_latest_for_sentence=True)
            elif audio_type_filter == 'merged_audio':
                query = query.filter_by(is_latest_for_content=True)
            # 如果没有指定 audio_type 但要求 latest_only，可能需要更复杂的逻辑或分别查询

        audios = query.order_by(TtsAudio.created_at.desc()).all()
        
        # TODO: 实现 StorageService 来获取可访问的 URL
        def get_accessible_url(file_path):
            # 这是一个占位符，你需要实现它
            # 例如: return f"{current_app.config['S3_BUCKET_URL']}/{file_path}"
            # 或 f"{current_app.config['STATIC_AUDIO_URL']}/{file_path}"
            # 暂时直接返回路径，前端处理
            if file_path and not file_path.startswith(('http://', 'https://')):
                 # 假设 TTS_AUDIO_BASE_URL 是 /static/tts_audio 或类似
                 # 并且 Flask 配置了静态文件服务
                 # 或者这个URL应该指向一个专门的下载API，如 /api/tts/audios/<audio_id>/download
                 # 为简单起见，暂时返回原始路径，前端需要知道如何处理
                 # 更推荐的方式是API返回完整的可访问URL
                 return os.path.join(current_app.config.get('TTS_AUDIO_BASE_URL_FOR_API', '/static/tts_audio'), file_path).replace("\\","/") # 保证路径分隔符
            return file_path


        return jsonify([{
            'id': str(audio.id),
            'audio_type': audio.audio_type,
            'sentence_id': str(audio.tts_sentence_id) if audio.tts_sentence_id else None,
            'file_path': audio.file_path, # 前端需要根据这个路径和配置的基础URL来构建可播放链接
            'url': get_accessible_url(audio.file_path), # 将来这里可以是完整的URL
            'duration_ms': audio.duration_ms,
            'file_size_bytes': audio.file_size_bytes,
            'tts_engine': audio.tts_engine,
            'voice_name': audio.voice_name,
            'version': audio.version,
            'is_latest': audio.is_latest_for_sentence if audio.audio_type == 'sentence_audio' else audio.is_latest_for_content,
            'created_at': audio.created_at.isoformat() if audio.created_at else None,
        } for audio in audios])

    except Exception as e:
        current_app.logger.error(f"获取培训内容 {content_id} 的音频失败: {e}", exc_info=True)
        return jsonify({'error': '获取音频列表时发生服务器错误: ' + str(e)}), 500


@tts_bp.route('/audios/<uuid:audio_id>', methods=['DELETE'])
@admin_required
def delete_audio_file_route(audio_id):
    """删除指定的TTS语音文件记录及其物理文件"""
    audio = TtsAudio.query.get(str(audio_id))
    if not audio:
        return jsonify({'error': '语音文件记录未找到'}), 404
    
    try:
        file_path_to_delete = audio.file_path # 记录路径以供物理删除
        audio_id_for_log = str(audio.id)

        # TODO: 实现 StorageService.delete_file(file_path_to_delete)
        # 假设删除成功，或者如果文件不存在也不抛出错误
        # physical_delete_success = storage_service.delete_file(file_path_to_delete)
        # if not physical_delete_success:
        #     current_app.logger.warning(f"物理文件 {file_path_to_delete} 删除失败或不存在，但仍会删除数据库记录。")
        
        db.session.delete(audio)
        db.session.commit()
        current_app.logger.info(f"TTS音频记录 {audio_id_for_log} 及其关联文件 {file_path_to_delete} (如果存在) 已被删除。")
        return jsonify({'message': '语音文件删除成功'})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"删除语音文件 {audio_id} 失败: {e}", exc_info=True)
        return jsonify({'error': '删除语音文件时发生服务器错误: ' + str(e)}), 500

# --- TTS 脚本处理 API (骨架实现) ---

def _create_new_script_version(source_script_id, training_content_id, new_script_type, new_content, llm_log_id=None):
    """
    辅助函数：创建或更新脚本。
    如果同类型脚本已存在，则创建新版本。
    """
    latest_same_type_script = TtsScript.query.filter_by(
        training_content_id=training_content_id,
        script_type=new_script_type
    ).order_by(TtsScript.version.desc()).first()

    new_version = 1
    if latest_same_type_script:
        new_version = latest_same_type_script.version + 1
    
    new_script = TtsScript(
        training_content_id=training_content_id,
        script_type=new_script_type,
        content=new_content,
        version=new_version,
        llm_call_log_id=llm_log_id, # 如果是LLM生成的，记录其调用日志
        source_script_id=source_script_id # 指向其来源脚本
    )
    db.session.add(new_script)
    return new_script

@tts_bp.route('/scripts/<uuid:content_id>/generate-oral-script', methods=['POST'])
@admin_required
def generate_oral_script_route(content_id):
    current_user_id_str = get_jwt_identity()
    current_user_uuid = uuid.UUID(current_user_id_str) if current_user_id_str else None

    content = TrainingContent.query.get(str(content_id))
    if not content:
        return jsonify({'error': '培训内容未找到'}), 404
    
    prompt_identifier_oral = "TRAINING_TO_ORAL_SCRIPT" # 假设这是您在 LlmPrompt 表中配置的标识符
    # 也可以从 content.llm_oral_prompt_id 获取，如果前端允许用户选择
    if content.llm_oral_prompt_id:
        prompt_obj = LlmPrompt.query.get(str(content.llm_oral_prompt_id))
        if prompt_obj:
            prompt_identifier_oral = prompt_obj.prompt_identifier
            current_app.logger.info(f"使用用户为内容 {content_id} 指定的口语化Prompt: {prompt_obj.prompt_name} ({prompt_identifier_oral})")
        else:
            current_app.logger.warning(f"内容 {content_id} 指定的口语化Prompt ID {content.llm_oral_prompt_id} 无效, 将使用默认Prompt: {prompt_identifier_oral}")
    else:
        current_app.logger.info(f"内容 {content_id} 未指定口语化Prompt, 使用默认Prompt: {prompt_identifier_oral}")


    try:
        # 确保有一个 original_text 类型的脚本作为源
        original_text_script = TtsScript.query.filter_by(
            training_content_id=content.id,
            script_type='original_text'
        ).first() # 通常只有一个原始版本，或者取最新的

        if not original_text_script:
            original_text_script = TtsScript(
                training_content_id=content.id,
                script_type='original_text',
                content=content.original_content,
                version=1
            )
            db.session.add(original_text_script)
            db.session.flush() # 获取ID

        oral_script_content = transform_text_with_llm(
            input_text=content.original_content,
            prompt_identifier=prompt_identifier_oral,
            user_id=current_user_uuid
        )
        
        # LLM 调用成功后，transform_text_with_llm 内部已记录日志
        # 我们需要获取该日志的ID来关联到 TtsScript
        # 假设 log_llm_call 返回了 log_id，或者我们需要查询最新的一个相关日志
        # 为简化，暂时不直接关联llm_call_log_id，但实际应该关联
        
        new_oral_script = _create_new_script_version(
            source_script_id=original_text_script.id,
            training_content_id=content.id,
            new_script_type='oral_script',
            new_content=oral_script_content
            # llm_log_id=retrieved_llm_log_id 
        )
        
        content.status = 'pending_tts_refine'
        db.session.commit()
        
        current_app.logger.info(f"口播脚本 (ID: {new_oral_script.id}) 已为内容 {content_id} 生成。")
        return jsonify({
            'message': '口播脚本已成功生成。',
            'oral_script_id': str(new_oral_script.id),
            'next_step': 'TTS Refine'
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"生成口播脚本失败 for content {content_id}: {e}", exc_info=True)
        # 确保错误信息是字符串
        error_message_str = str(e)
        if hasattr(e, 'response') and hasattr(e.response, 'data') and 'error' in e.response.data:
            error_message_str = e.response.data['error']
        elif hasattr(e, 'message'):
             error_message_str = e.message

        return jsonify({'error': '生成口播脚本时发生错误: ' + error_message_str}), 500

# 异步处理
@tts_bp.route('/scripts/<uuid:oral_script_id>/tts-refine', methods=['POST'])
@admin_required
def tts_refine_script_route(oral_script_id):
    oral_script = TtsScript.query.get(str(oral_script_id))
    if not oral_script or oral_script.script_type != 'oral_script':
        return jsonify({'error': '无效的口播脚本ID或类型不匹配'}), 400
    
    training_content = oral_script.training_content
    if not training_content:
         return jsonify({'error': '找不到关联的培训内容'}), 404

    try:
        # 更新状态为“正在处理中”
        training_content.status = 'processing_tts_refine' # 或者一个更具体的异步状态
        db.session.commit()

        # 调用异步任务
        task = trigger_tts_refine_async.delay(str(oral_script.id))
        
        current_app.logger.info(f"TTS Refine 异步任务已启动 (Task ID: {task.id}) for oral_script {oral_script_id}")
        return jsonify({
            'message': 'TTS Refine 任务已成功提交处理。',
            'task_id': task.id, # 返回任务ID给前端
            'status_polling_url': f'/api/tts/task-status/{task.id}' # 示例：告知前端轮询地址
        }), 202 # HTTP 202 Accepted

    except Exception as e:
        db.session.rollback()
        # 如果在提交任务前就出错，状态可能需要回滚或标记为错误
        training_content.status = 'error_submitting_tts_refine'
        db.session.commit()
        current_app.logger.error(f"提交 TTS Refine 任务失败 for oral_script {oral_script_id}: {e}", exc_info=True)
        return jsonify({'error': '提交 TTS Refine 任务时发生服务器错误: ' + str(e)}), 500

@tts_bp.route('/scripts/<uuid:refined_script_id>/llm-refine', methods=['POST'])
@admin_required
def llm_refine_script_route(refined_script_id):
    current_user_id_str = get_jwt_identity()
    current_user_uuid = uuid.UUID(current_user_id_str) if current_user_id_str else None

    tts_refined_script = TtsScript.query.get(str(refined_script_id))
    if not tts_refined_script or tts_refined_script.script_type != 'tts_refined_script':
        return jsonify({'error': '无效的TTS Refine脚本ID或类型不匹配'}), 400
    
    training_content = tts_refined_script.training_content
    if not training_content:
         return jsonify({'error': '找不到关联的培训内容'}), 404
         
    # +++++ 获取作为参考的 oral_script +++++
    # 假设 oral_script 是 tts_refined_script 的直接源头
    # 或者，如果 oral_script 总是 training_content 下最新的 oral_script
    source_oral_script = None
    if tts_refined_script.source_script_id:
        temp_source = TtsScript.query.get(str(tts_refined_script.source_script_id))
        if temp_source and temp_source.script_type == 'oral_script':
            source_oral_script = temp_source
    
    if not source_oral_script:
        # 如果 tts_refined_script 没有直接的 oral_script 源，
        # 尝试从 training_content 查找最新的 oral_script
        source_oral_script = TtsScript.query.filter_by(
            training_content_id=training_content.id,
            script_type='oral_script'
        ).order_by(TtsScript.version.desc()).first()

    if not source_oral_script:
        current_app.logger.error(f"LLM最终修订失败：找不到有效的 oral_script 作为参考 for tts_refined_script {refined_script_id}")
        return jsonify({'error': '找不到用于参考的口播脚本 (oral_script)'}), 400
    
    oral_script_content_for_reference = source_oral_script.content
    # ++++++++++++++++++++++++++++++++++++++
         
    prompt_identifier_final_refine = "TTS_SCRIPT_FINAL_REFINE" 
    if training_content.llm_refine_prompt_id:
        prompt_obj = LlmPrompt.query.get(str(training_content.llm_refine_prompt_id))
        if prompt_obj:
            prompt_identifier_final_refine = prompt_obj.prompt_identifier
            current_app.logger.info(f"使用用户为内容 {training_content.id} 指定的LLM最终修订Prompt: {prompt_obj.prompt_name} ({prompt_identifier_final_refine})")
        else:
            current_app.logger.warning(f"内容 {training_content.id} 指定的LLM最终修订Prompt ID {training_content.llm_refine_prompt_id} 无效, 将使用默认Prompt: {prompt_identifier_final_refine}")
    else:
         current_app.logger.info(f"内容 {training_content.id} 未指定LLM最终修订Prompt, 使用默认Prompt: {prompt_identifier_final_refine}")

    try:
        final_tts_script_content_or_obj = transform_text_with_llm( # 注意这里接收的可能是对象或字符串
            input_text=tts_refined_script.content,
            prompt_identifier=prompt_identifier_final_refine,
            reference_text=oral_script_content_for_reference, # <--- 传递参考文本
            user_id=current_user_uuid
        )
        
        final_content_str = ""
        if isinstance(final_tts_script_content_or_obj, dict) and 'revised_text' in final_tts_script_content_or_obj:
            # 如果 LLM 配置为返回包含修订文本的JSON对象
            final_content_str = final_tts_script_content_or_obj['revised_text']
        elif isinstance(final_tts_script_content_or_obj, str):
            final_content_str = final_tts_script_content_or_obj
        else:
            current_app.logger.error(f"LLM最终修订返回了非预期的格式: {type(final_tts_script_content_or_obj)}")
            raise Exception("LLM最终修订返回格式不正确")

        if not final_content_str.strip():
            current_app.logger.warning(f"LLM最终修订脚本为空 for tts_refined_script {refined_script_id}")
            # 可以选择是报错还是创建一个空的final script
            # raise Exception("LLM最终修订脚本内容为空")

        new_final_script = _create_new_script_version(
            source_script_id=tts_refined_script.id,
            training_content_id=training_content.id,
            new_script_type='final_tts_script',
            new_content=final_content_str 
        )
        
        training_content.status = 'pending_sentence_split'
        db.session.commit()

        current_app.logger.info(f"最终TTS脚本 (ID: {new_final_script.id}) 已为TTS Refine脚本 {refined_script_id} 生成。")
        return jsonify({
            'message': 'LLM最终修订脚本已成功生成。',
            'final_tts_script_id': str(new_final_script.id),
            'next_step': 'Split Sentences'
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"LLM最终修订脚本失败 for tts_refined_script {refined_script_id}: {e}", exc_info=True)
        error_message_str = str(e)
        if hasattr(e, 'response') and hasattr(e.response, 'data') and 'error' in e.response.data:
            error_message_str = e.response.data['error']
        elif hasattr(e, 'message'):
             error_message_str = e.message
        return jsonify({'error': 'LLM最终修订脚本时发生错误: ' + error_message_str}), 500


@tts_bp.route('/scripts/<uuid:source_final_script_id>/split-sentences', methods=['POST'])
@admin_required
def split_script_into_sentences_route(source_final_script_id):
    source_final_script_id_str = str(source_final_script_id)
    current_app.logger.info(f"开始为源 final_script_id: {source_final_script_id_str} 执行句子重新拆分并创建新版本。")

    source_final_script = TtsScript.query.get(source_final_script_id_str)
    if not source_final_script or source_final_script.script_type != 'final_tts_script':
        current_app.logger.warning(f"句子拆分失败：无效的源 final_script_id {source_final_script_id_str} 或脚本类型不匹配 ({source_final_script.script_type if source_final_script else 'None'})。")
        return jsonify({'error': '无效的源最终TTS脚本ID或类型不匹配'}), 400
        
    training_content = source_final_script.training_content
    if not training_content:
         current_app.logger.error(f"句子拆分失败：源脚本 {source_final_script_id_str} 找不到关联的培训内容。")
         return jsonify({'error': '找不到关联的培训内容'}), 404

    try:
        current_app.logger.info(f"开始处理源脚本 ID: {source_final_script.id}, Version: {source_final_script.version} 的内容拆分。")
        
        # 1. 获取当前 TrainingContent 下 'final_tts_script' 的最大版本号
        current_max_version_obj = db.session.query(func.max(TtsScript.version)).filter_by(
            training_content_id=training_content.id,
            script_type='final_tts_script'
        ).one_or_none() # 使用 one_or_none() 获取结果，它可能为 (None,) 或 (max_version,)
        
        current_max_version = 0
        if current_max_version_obj and current_max_version_obj[0] is not None:
            current_max_version = current_max_version_obj[0]
        
        new_version_number = current_max_version + 1
        current_app.logger.info(f"当前内容 {training_content.id} 的 final_tts_script 最大版本号为: {current_max_version}. 新版本将是: {new_version_number}")

        # 2. 创建一个新的 TtsScript 记录作为新版本
        new_final_script = TtsScript(
            training_content_id=training_content.id,
            script_type='final_tts_script',
            content=source_final_script.content, # 内容与源脚本相同
            version=new_version_number,
            source_script_id=source_final_script.id # 记录源脚本
        )
        db.session.add(new_final_script)
        db.session.flush() # 立即执行插入以获取 new_final_script.id
        current_app.logger.info(f"已创建新的 final_tts_script 记录: ID={new_final_script.id}, Version={new_final_script.version}")

        # 3. 拆分句子 (使用新脚本的内容，这里与源脚本内容一样)
        sentences_text_list = [s.strip() for s in new_final_script.content.split('\n') if s.strip()]
        if not sentences_text_list:
            sentences_text_list = [s.strip() + '。' for s in new_final_script.content.split('。') if s.strip()]
        
        if not sentences_text_list:
             current_app.logger.warning(f"新脚本 {new_final_script.id} 内容为空或无法拆分出任何句子。")
             # 即使无法拆分，新版本的脚本也已创建，这里可以选择是回滚还是保留空句子脚本
             # 为了简单，这里我们允许创建一个没有句子的新版本脚本，但实际可能需要更复杂的处理
             # db.session.rollback() # 如果不希望创建没有句子的脚本版本，可以回滚
             # return jsonify({'error': '脚本内容为空或无法拆分句子，未创建新版本。'}), 400
        
        created_sentences_count = 0
        for index, text in enumerate(sentences_text_list):
            new_sentence = TtsSentence(
                tts_script_id=new_final_script.id, # <--- 关联到新创建的脚本 ID
                sentence_text=text,
                order_index=index,
                audio_status='pending_generation'
            )
            db.session.add(new_sentence)
            created_sentences_count += 1
        
        training_content.status = 'pending_audio_generation' # 更新培训内容状态
        db.session.commit()
        
        current_app.logger.info(
            f"为新脚本 ID {new_final_script.id} (Version {new_final_script.version}) 成功创建了 {created_sentences_count} 个句子。"
            f"TrainingContent status 更新为 {training_content.status}。"
        )
        return jsonify({
            'message': f'脚本成功重新拆分为 {created_sentences_count} 个句子，并创建了新的最终脚本版本 (v{new_final_script.version})。',
            'new_final_tts_script_id': str(new_final_script.id), # 返回新脚本的ID
            'new_version': new_final_script.version,
            'num_sentences': created_sentences_count,
            'next_step': 'Batch Generate Audio or Single Sentence Generate'
        }), 201 # 201 Created，因为创建了新资源

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"为源脚本 {source_final_script_id_str} 重新拆分并创建新版本失败: {e}", exc_info=True)
        return jsonify({'error': '重新拆分脚本并创建新版本时发生服务器错误: ' + str(e)}), 500

# 异步任务状态查询
@tts_bp.route('/task-status/<task_id>', methods=['GET'])
@jwt_required()
def get_task_status(task_id):
    # 直接使用导入的 celery_app_instance，而不是 celery.current_app (除非你特别配置了 current_app)
    task = celery_app_instance.AsyncResult(task_id)
    
    response_data = {
        'task_id': task_id,
        'status': task.status,
        'result': None,
        'meta': {}, 
        'error_message': None,
        'error_type': None
    }

    task_info_dict = task.info if isinstance(task.info, dict) else {}

    # 1. 基础填充 meta (所有状态通用)
    if task_info_dict:
        response_data['meta'] = task_info_dict.copy()

    # 2. 特定状态的处理
    if task.status == 'SUCCESS':
        response_data['result'] = task.result
        if isinstance(task.result, dict):
            # 合并 result 中的最终计数到 meta
            final_counts = {
                'message': task.result.get('message', response_data['meta'].get('message', '任务成功完成')),
                'total_in_batch': task.result.get('total_in_batch', task.result.get('total', response_data['meta'].get('total_in_batch', 0))),
                'processed_in_batch': task.result.get('processed_in_batch', response_data['meta'].get('processed_in_batch', (task.result.get('succeeded', 0) + task.result.get('failed', 0)))),
                'succeeded_in_batch': task.result.get('succeeded_in_batch', task.result.get('succeeded', response_data['meta'].get('succeeded_in_batch', 0))),
                'failed_in_batch': task.result.get('failed_in_batch', task.result.get('failed', response_data['meta'].get('failed_in_batch', 0))),
            }
            response_data['meta'].update(final_counts)
            if task.result.get('status') in ['Error', 'FAILURE']:
                response_data['status'] = 'FAILURE'
                response_data['error_message'] = task.result.get('message', '任务执行返回错误状态')
        elif 'message' not in response_data['meta']: # 如果 result 不是字典，但 meta 中没有消息
            response_data['meta']['message'] = '任务成功完成'
            
    elif task.status == 'FAILURE':
        response_data['error_message'] = str(task.result)
        if hasattr(task.result, '__class__'):
            response_data['error_type'] = task.result.__class__.__name__
        # meta 中可能已经包含了 task.info 的内容，这里可以补充 error message
        if 'message' not in response_data['meta'] and response_data['error_message']:
            response_data['meta']['message'] = response_data['error_message']
        elif 'message' not in response_data['meta']:
            response_data['meta']['message'] = '任务失败'

    # 对于 PROGRESS, PENDING, STARTED 等状态, task.info 应该就是我们需要的 meta
    # 如果这些状态下 task_info_dict 为空，或者缺少 message，再进行补充
    elif not response_data['meta'].get('message'):
        if task.status == 'PROGRESS':
            total = response_data['meta'].get('total_in_batch', response_data['meta'].get('total', 0))
            processed = response_data['meta'].get('processed_in_batch', response_data['meta'].get('current', 0))
            if total > 0:
                response_data['meta']['message'] = f"正在处理: {processed}/{total}"
            else:
                response_data['meta']['message'] = "正在初始化..."
        elif task.status == 'PENDING' or task.status == 'STARTED':
            response_data['meta']['message'] = '任务正在等待或刚开始...'
        else:
            response_data['meta']['message'] = f'任务状态: {task.status}'

    # 确保所有前端期望的键在 meta 中都有默认值，以防万一
    default_keys_for_meta = {
        'total_in_batch': 0, 'processed_in_batch': 0, 'succeeded_in_batch': 0, 
        'failed_in_batch': 0, 'current_sentence_text': None, 'message': '状态加载中...',
        'last_processed_sentence_id': None, 'last_processed_sentence_status': None,
        'current_sentence_id': None # 从日志看，这个字段在PROGRESS时是有的
    }
    for key, default_val in default_keys_for_meta.items():
        if key not in response_data['meta'] or response_data['meta'][key] is None:
             # 仅当 meta 中确实没有这个 key，或者值为 None 时才设置默认值
             # 避免用默认值覆盖掉从 task.info 中获取到的有效值（比如 0）
            if response_data['meta'].get(key) is None:
                 response_data['meta'][key] = default_val
    
    # current_app.logger.debug(f"API Task status response for {task_id}: {response_data}")
    return jsonify(response_data)

@tts_bp.route('/sentences/<uuid:sentence_id>/generate-audio', methods=['POST'])
@admin_required # 或 @jwt_required()
def generate_sentence_audio_route(sentence_id):
    """为单个句子异步生成TTS语音"""
    sentence = TtsSentence.query.get(str(sentence_id))
    if not sentence:
        return jsonify({'error': '句子未找到'}), 404

    try:
        # (可选) 获取前端可能传递的特定TTS引擎参数
        # tts_engine_params = request.get_json() if request.is_json else {}
        tts_engine_params = request.json or {} # 更简洁

        # 更新句子状态为处理中
        sentence.audio_status = 'processing_request' # 或 'queued'
        db.session.commit()

        # 调用异步任务
        task = generate_single_sentence_audio_async.delay(str(sentence.id), tts_engine_params)
        
        current_app.logger.info(f"单句语音生成异步任务已启动 (Task ID: {task.id}) for sentence {sentence_id}")
        return jsonify({
            'message': '单句语音生成任务已成功提交处理。',
            'task_id': task.id,
            'status_polling_url': f'/api/tts/task-status/{task.id}' 
        }), 202

    except Exception as e:
        db.session.rollback()
        if sentence: # 如果在提交任务前出错，回滚状态
             sentence.audio_status = 'error_submission'
             db.session.commit()
        current_app.logger.error(f"提交单句语音生成任务失败 for sentence {sentence_id}: {e}", exc_info=True)
        return jsonify({'error': '提交单句语音生成任务时发生服务器错误: ' + str(e)}), 500
    
@tts_bp.route('/training-contents/<uuid:content_id>/batch-generate-audio', methods=['POST'])
@admin_required
def batch_generate_audio_for_content_route(content_id):
    # ... (获取 content 和 latest_final_script) ...
    content = TrainingContent.query.get(str(content_id))
    if not content: return jsonify({'error': '培训内容未找到'}), 404
    # --- 修改：直接从 TtsScript 表查询最新的 final_tts_script ---
    current_app.logger.info(f"开始直接查询 TtsScript 表以获取最新的 final_tts_script for content_id: {content.id}")
    latest_final_script = TtsScript.query.filter_by(
        training_content_id=content.id,  # 使用 content.id 进行过滤
        script_type='final_tts_script'
    ).order_by(TtsScript.version.desc()).first()
    # --- 修改结束 ---
    # latest_final_script = content.tts_scripts.filter_by(script_type='final_tts_script').order_by(TtsScript.version.desc()).first()
    if not latest_final_script: return jsonify({'error': '未找到该内容的最终TTS脚本'}), 400

    # 只检查是否有需要处理的，具体列表由Celery任务自己查，避免数据不一致
    has_sentences_to_process = TtsSentence.query.filter(
        TtsSentence.tts_script_id == latest_final_script.id,
        or_(
            TtsSentence.audio_status == 'pending_generation',
            TtsSentence.audio_status == 'error_generation',
            TtsSentence.audio_status == 'pending_regeneration',
            TtsSentence.audio_status == 'error_submission',
            TtsSentence.audio_status == 'error_polling',
            TtsSentence.audio_status == 'processing_request' # API可能已标记
        )
    ).first()

    if not has_sentences_to_process:
        return jsonify({'message': '所有句子的语音都已生成或正在生成中。'}), 200
    
    try:
        # 将所有符合条件的句子的状态更新为 'queued' 或 'processing_request'
        # 这样前端下次刷新时能看到这些句子正在排队或准备处理
        TtsSentence.query.filter(
            TtsSentence.tts_script_id == latest_final_script.id,
             or_(
                TtsSentence.audio_status == 'pending_generation',
                TtsSentence.audio_status == 'error_generation',
                TtsSentence.audio_status == 'pending_regeneration',
                TtsSentence.audio_status == 'error_submission',
                TtsSentence.audio_status == 'error_polling'
            )
        ).update({'audio_status': 'processing_request'}, synchronize_session=False)

        content.status = 'audio_processing_queued' # 标记内容正在处理
        db.session.commit()

        task = batch_generate_audio_task.delay(str(latest_final_script.id))
        current_app.logger.info(f"批量语音生成任务已提交到 Celery，任务ID: {task.id}，处理脚本ID: {latest_final_script.id}")
        return jsonify({'message': '批量语音生成任务已成功提交，正在后台处理。', 'task_id': task.id, 'initial_status_set_to': 'processing_request'}), 202
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"提交批量语音生成任务失败 (内容ID: {content_id}): {e}", exc_info=True)
        return jsonify({'error': f'提交批量语音生成任务失败: {str(e)}'}), 500
    
@tts_bp.route('/sentences/<uuid:sentence_id>', methods=['DELETE'])
@admin_required
def delete_sentence_route(sentence_id):
    sentence_id_str = str(sentence_id)
    sentence = TtsSentence.query.get(sentence_id_str)
    if not sentence:
        return jsonify({'error': '句子未找到'}), 404

    try:
        # 1. 找到所有关联的语音文件记录
        audios_to_delete = TtsAudio.query.filter_by(tts_sentence_id=sentence_id_str).all()
        audio_paths_to_delete_physically = []

        for audio_record in audios_to_delete:
            # 假设 file_path 存储的是需要删除的文件的标识符或相对路径
            # 例如：'course_abc/content_xyz/sentence_audio_xyz.mp3'
            if audio_record.file_path: # 确保有路径才尝试删除
                audio_paths_to_delete_physically.append(audio_record.file_path)
            db.session.delete(audio_record)
        
        db.session.delete(sentence)
        db.session.commit() # 先提交数据库更改，确保记录被删除

        # 2. 删除物理文件 (如果数据库操作成功)
        # 这里的 StorageService 是一个假设的例子，你需要根据你的实际存储实现
        # from ..services.storage_service import StorageService # 假设的导入
        # storage_service = StorageService() 
        # for path in audio_paths_to_delete_physically:
        #     try:
        #         # storage_service.delete_file(path) # 调用删除物理文件的方法
        #         current_app.logger.info(f"拟删除物理语音文件 (需实现): {path}") # 替换为实际删除
        #     except Exception as e_file:
        #         current_app.logger.error(f"删除物理语音文件失败 {path}: {e_file}")
        #         # 这里可以考虑是否要记录这个失败，但数据库记录已删除

        # 临时日志，提示需要实现物理删除
        if audio_paths_to_delete_physically:
            current_app.logger.warning(f"TODO: 实现物理删除以下文件: {audio_paths_to_delete_physically}")


        current_app.logger.info(f"句子 {sentence_id_str} 及其数据库中的语音记录已删除。")
        return jsonify({'message': '句子及其关联语音记录已成功删除。请确保物理文件也已处理。'})
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"删除句子 {sentence_id_str} 失败: {e}", exc_info=True)
        return jsonify({'error': f'删除句子失败: {str(e)}'}), 500
    

@tts_bp.route('/training-contents/<uuid:content_id>/original-content', methods=['PUT'])
@admin_required # 通常编辑原文需要管理员权限
def update_training_content_original_text(content_id):
    """专门更新培训内容的原始文本"""
    data = request.get_json()
    content = TrainingContent.query.get(str(content_id))
    if not content:
        return jsonify({'error': '培训内容未找到'}), 404

    new_original_content = data.get('original_content')
    if new_original_content is None: # 检查是否提供了 original_content
        return jsonify({'error': '缺少 original_content 字段'}), 400
    
    if not isinstance(new_original_content, str):
        return jsonify({'error': 'original_content 必须是字符串'}), 400

    # 考虑原始文本是否允许为空，如果不能为空，添加 strip() 和空值检查
    # new_original_content_stripped = new_original_content.strip()
    # if not new_original_content_stripped:
    #     return jsonify({'error': '原始培训内容不能为空'}), 400

    try:
        if content.original_content != new_original_content:
            content.original_content = new_original_content
            # 当原始文本被修改时，可能需要重置后续所有脚本的状态，
            # 或者至少将 TrainingContent 的状态更新为一个表示需要重新处理的状态，
            # 例如 'pending_oral_script'，并可能需要删除或标记旧的衍生脚本为过时。
            # 这是一个重要的业务逻辑决策。
            # 简单处理：仅更新文本，并可能重置状态。
            content.status = 'pending_oral_script' # 示例：重置状态以便重新生成口播稿
            
            # 可选：更彻底的清理 - 删除所有已生成的脚本和句子
            # TtsScript.query.filter_by(training_content_id=content.id).delete(synchronize_session=False)
            # TtsSentence 和 TtsAudio 会因为级联删除而被处理 (如果模型配置了)

            db.session.commit()
            current_app.logger.info(f"培训内容 {content_id} 的原始文本已更新。状态重置为 {content.status}。")
            return jsonify({'message': '原始培训内容更新成功，后续处理流程可能需要重新执行。', 'id': str(content.id)})
        else:
            return jsonify({'message': '原始培训内容未发生改变。', 'id': str(content.id)}), 200
            
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新培训内容 {content_id} 的原始文本失败: {e}", exc_info=True)
        return jsonify({'error': '更新原始培训内容时发生服务器错误: ' + str(e)}), 500