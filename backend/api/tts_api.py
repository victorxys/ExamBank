# backend/api/tts_api.py

from flask import Blueprint, request, jsonify, current_app
from backend.models import db, TrainingCourse, TrainingContent, TtsScript, TtsSentence, TtsAudio, LlmPrompt, User, MergedAudioSegment, VideoSynthesis
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
from backend.tasks import merge_all_audios_for_content # Import the new task
from backend.tasks import run_llm_function_async # 导入新的Celery任务
from backend.tasks import synthesize_video_task # <<< 确保从 tasks 导入新任务


# from backend.tasks import generate_merged_audio_async # 导入新的Celery任务``
from backend.tasks import trigger_tts_refine_async # 导入新的Celery任务
from celery.result import AsyncResult # 可以显式导入 AsyncResult
from sqlalchemy import func, or_ # 导入 SQLAlchemy 的函数和操作符
from datetime import datetime




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
                'version': latest_merged_audio.version,
                'segments': [] # Initialize segments array
            }
            # Fetch and add segments
            segments_for_merged = MergedAudioSegment.query.filter_by(
                merged_audio_id=latest_merged_audio.id
            ).order_by(MergedAudioSegment.original_order_index).all()
            
            for seg in segments_for_merged:
                merged_audio_info['segments'].append({
                    'segment_id': str(seg.id),
                    'tts_sentence_id': str(seg.tts_sentence_id) if seg.tts_sentence_id else None,
                    'original_order_index': seg.original_order_index,
                    'original_sentence_text_ref': seg.original_sentence_text_ref,
                    'start_ms': seg.start_ms,
                    'end_ms': seg.end_ms,
                    'duration_ms': seg.duration_ms,
                })

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
    
    prompt_identifier_oral = "TRAINING_TO_ORAL_SCRIPT"
    if content.llm_oral_prompt:
        prompt_identifier_oral = content.llm_oral_prompt.prompt_identifier
        current_app.logger.info(f"使用用户为内容 {content_id} 指定的口语化Prompt: {content.llm_oral_prompt.prompt_name}")

    try:
        # 确保有原始脚本记录
        original_text_script = TtsScript.query.filter_by(
            training_content_id=content.id,
            script_type='original_text'
        ).first()
        if not original_text_script:
            original_text_script = TtsScript(
                training_content_id=content.id,
                script_type='original_text',
                content=content.original_content,
                version=1
            )
            db.session.add(original_text_script)
            db.session.flush()

        # 更新状态为“正在处理中”
        content.status = 'processing_oral_script'
        db.session.commit()
        
        # 触发异步任务
        task = run_llm_function_async.delay(
            llm_function_identifier='transform_text_with_llm',
            callback_identifier='handle_oral_script',
            context={
                'training_content_id': str(content.id),
                'source_script_id': str(original_text_script.id),
                'user_id': str(current_user_uuid) if current_user_uuid else None
            },
            # --- 以下是 transform_text_with_llm 的参数 ---
            input_text=content.original_content,
            prompt_identifier=prompt_identifier_oral,
            user_id=current_user_uuid
        )
        
        current_app.logger.info(f"口播稿生成任务已提交 (Task ID: {task.id}) for content {content_id}")
        return jsonify({
            'message': '口播稿生成任务已成功提交处理。',
            'task_id': task.id,
            'status': 'processing_oral_script'
        }), 202

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"提交口播稿生成任务失败 for content {content_id}: {e}", exc_info=True)
        content.status = 'error_submitting_oral_script'
        db.session.commit()
        return jsonify({'error': '提交任务时发生服务器错误: ' + str(e)}), 500

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
         
    source_oral_script = TtsScript.query.filter_by(
        training_content_id=training_content.id,
        script_type='oral_script'
    ).order_by(TtsScript.version.desc()).first()
    if not source_oral_script:
        return jsonify({'error': '找不到用于参考的口播脚本 (oral_script)'}), 400
    
    prompt_identifier_final_refine = "TTS_SCRIPT_FINAL_REFINE" 
    if training_content.llm_refine_prompt:
        prompt_identifier_final_refine = training_content.llm_refine_prompt.prompt_identifier
        current_app.logger.info(f"使用用户为内容 {training_content.id} 指定的LLM最终修订Prompt: {training_content.llm_refine_prompt.prompt_name}")

    try:
        training_content.status = 'processing_llm_final_refine'
        db.session.commit()

        # 触发异步任务
        task = run_llm_function_async.delay(
            llm_function_identifier='transform_text_with_llm',
            callback_identifier='handle_final_refine',
            context={
                'training_content_id': str(training_content.id),
                'source_script_id': str(tts_refined_script.id),
                'user_id': str(current_user_uuid) if current_user_uuid else None
            },
            # --- 以下是 transform_text_with_llm 的参数 ---
            input_text=tts_refined_script.content,
            prompt_identifier=prompt_identifier_final_refine,
            reference_text=source_oral_script.content,
            user_id=current_user_uuid
        )
        
        current_app.logger.info(f"LLM最终修订任务已提交 (Task ID: {task.id}) for script {refined_script_id}")
        return jsonify({
            'message': 'LLM最终修订任务已成功提交处理。',
            'task_id': task.id,
            'status': 'processing_llm_final_refine'
        }), 202

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"提交LLM最终修订任务失败 for script {refined_script_id}: {e}", exc_info=True)
        training_content.status = 'error_submitting_llm_refine'
        db.session.commit()
        return jsonify({'error': '提交任务时发生服务器错误: ' + str(e)}), 500


# backend/api/tts_api.py -> split_script_into_sentences_route

@tts_bp.route('/scripts/<uuid:source_final_script_id>/split-sentences', methods=['POST'])
@admin_required
def split_script_into_sentences_route(source_final_script_id):
    source_final_script_id_str = str(source_final_script_id)
    current_app.logger.info(f"--- [SplitTask Start] 源 final_script_id: {source_final_script_id_str} ---")

    source_final_script = TtsScript.query.get(source_final_script_id_str)
    if not source_final_script or source_final_script.script_type != 'final_tts_script':
        # ... (返回错误) ...
        current_app.logger.warning(f"[SplitTask Fail] 无效的源脚本 ID 或类型不匹配。")
        return jsonify({'error': '无效的源最终TTS脚本ID或类型不匹配'}), 400
        
    training_content = source_final_script.training_content
    if not training_content:
         # ... (返回错误) ...
         current_app.logger.error(f"[SplitTask Fail] 源脚本 {source_final_script_id_str} 找不到关联的培训内容。")
         return jsonify({'error': '找不到关联的培训内容'}), 404

    try:
        current_app.logger.info(f"[SplitTask] 开始处理源脚本 ID: {source_final_script.id}, Version: {source_final_script.version} 的内容拆分。")
        
        current_training_content_id = training_content.id # 提前获取，避免在循环中反复访问关系

        # 1. 确定新版本号
        current_max_version_obj = db.session.query(func.max(TtsScript.version)).filter_by(
            training_content_id=current_training_content_id, # 使用获取到的ID
            script_type='final_tts_script'
        ).one_or_none()
        current_max_version = current_max_version_obj[0] if current_max_version_obj and current_max_version_obj[0] is not None else 0
        new_version_number = current_max_version + 1
        current_app.logger.info(f"[SplitTask] 内容 {current_training_content_id} 的 final_tts_script 最大版本号为: {current_max_version}. 新版本将是: {new_version_number}")

        # 2. 创建新的 TtsScript 记录
        new_final_script = TtsScript(
            training_content_id=current_training_content_id,
            script_type='final_tts_script',
            content=source_final_script.content,
            version=new_version_number,
            source_script_id=source_final_script.id
        )
        db.session.add(new_final_script)
        current_app.logger.info(f"[SplitTask] 新的 final_tts_script (Version {new_version_number}) 已添加到 session。尝试 flush...")
        
        try:
            db.session.flush() # ⭐ 关键：尝试在这里 flush 以暴露早期问题
            current_app.logger.info(f"[SplitTask] Flush 成功。新脚本内存中 ID: {new_final_script.id} (如果数据库生成了)。")
            if not new_final_script.id: # 对于 UUID，SQLAlchemy 应该在 add 后就能填充，但 flush 是一个检查点
                 current_app.logger.warning(f"[SplitTask] Flush 后 new_final_script 仍然没有 ID (这对于自增ID是正常的，但对于UUID可能意味着问题或延迟填充)。")
        except Exception as e_flush_script:
            db.session.rollback()
            current_app.logger.error(f"[SplitTask Fail] Flush new_final_script 时出错: {e_flush_script}", exc_info=True)
            return jsonify({'error': f'创建新脚本版本时内部错误 (flush script): {str(e_flush_script)}'}), 500

        # 3. 拆分句子并尝试复用语音
        sentences_text_list = [s.strip() for s in new_final_script.content.split('\n') if s.strip()]
        if not sentences_text_list: # 尝试用句号分割作为备选
            sentences_text_list = [s.strip() + '。' for s in new_final_script.content.split('。') if s.strip()] # 保留句号
            if not sentences_text_list and new_final_script.content.strip(): # 如果还有内容但无法分割，则视为一句
                sentences_text_list = [new_final_script.content.strip()]

        if not sentences_text_list:
             current_app.logger.warning(f"[SplitTask] 新脚本 {new_final_script.id if new_final_script.id else '未知ID'} 内容为空或无法拆分出任何句子。")
             # 即使无法拆分，新版本的脚本也已创建。后续可以考虑是否回滚或保留。
             # 为保持简单，这里继续，让它创建一个没有句子的脚本版本。

        created_sentences_count = 0
        reused_audio_count = 0

        for index, new_sentence_text in enumerate(sentences_text_list):
            # ⭐ 将 new_sentence 的创建和 add 推迟到确定其状态之后
            # new_sentence_obj_for_audio = None # 用于 TtsAudio 的关联

            # --- 查找历史语音逻辑 ---
            found_audio_to_reuse = None
            # ... (您的历史语音查找逻辑，确保它不会意外地修改 session 或触发过早的 flush 失败)
            # 假设您的查找逻辑是只读的，并且能正确返回 found_audio_to_reuse 或 None
            historical_final_scripts_query = TtsScript.query.filter(
                TtsScript.training_content_id == current_training_content_id,
                TtsScript.script_type == 'final_tts_script',
                TtsScript.id != new_final_script.id 
            ).order_by(TtsScript.version.desc())

            for old_script in historical_final_scripts_query.all():
                matching_old_sentence = TtsSentence.query.filter(
                    TtsSentence.tts_script_id == old_script.id,
                    TtsSentence.sentence_text == new_sentence_text
                ).first()
                if matching_old_sentence:
                    latest_valid_audio_for_old_sentence = TtsAudio.query.filter(
                        TtsAudio.tts_sentence_id == matching_old_sentence.id,
                        TtsAudio.audio_type == 'sentence_audio',
                        TtsAudio.is_latest_for_sentence == True
                    ).join(TtsSentence, TtsAudio.tts_sentence_id == TtsSentence.id)\
                     .filter(TtsSentence.audio_status == 'generated').order_by(TtsAudio.created_at.desc()).first()
                    if latest_valid_audio_for_old_sentence:
                        found_audio_to_reuse = latest_valid_audio_for_old_sentence
                        break
            # --- 查找结束 ---

            # 创建 TtsSentence 对象
            new_sentence = TtsSentence(
                tts_script_id=new_final_script.id, # 此时 new_final_script.id 应该是有效的 (如果是UUID)
                sentence_text=new_sentence_text,
                order_index=index
            )

            if found_audio_to_reuse:
                new_sentence.audio_status = 'generated'
                db.session.add(new_sentence)
                try:
                    db.session.flush() # Flush new_sentence 以获取其 ID
                    current_app.logger.debug(f"[SplitTask] Sentence flushed, ID: {new_sentence.id}")
                except Exception as e_flush_sent:
                    current_app.logger.error(f"[SplitTask] Flush new_sentence (reused audio) 时出错: {e_flush_sent}", exc_info=True)
                    # 这里如果单个句子 flush 失败，是否要回滚整个操作？这是一个决策点。
                    # 为简单起见，先继续，但标记错误。
                    # db.session.rollback() # 如果要严格，这里应该回滚
                    # return jsonify({'error': f'创建句子时内部错误 (flush sentence): {str(e_flush_sent)}'}), 500
                    new_sentence.audio_status = 'error_creating_sentence_record' # 标记一个错误状态
                    # continue # 或者跳过这个句子的语音记录创建


                if new_sentence.id and new_sentence.audio_status == 'generated': # 确保句子已成功 flush 且状态正确
                    reused_audio_entry = TtsAudio(
                        tts_sentence_id=new_sentence.id, 
                        training_content_id=current_training_content_id,
                        audio_type='sentence_audio',
                        file_path=found_audio_to_reuse.file_path,
                        duration_ms=found_audio_to_reuse.duration_ms,
                        file_size_bytes=found_audio_to_reuse.file_size_bytes,
                        tts_engine="ReusedHistoricalAudio", # 更明确的引擎名
                        voice_name=found_audio_to_reuse.voice_name,
                        generation_params={"reused_from_audio_id": str(found_audio_to_reuse.id), "reused_at": datetime.utcnow().isoformat()},
                        version=1, 
                        is_latest_for_sentence=True
                    )
                    db.session.add(reused_audio_entry)
                    reused_audio_count += 1
                    current_app.logger.info(f"[SplitTask] 句子 (新ID: {new_sentence.id}) '{new_sentence_text[:30]}...' 复用了历史语音 {found_audio_to_reuse.id}")
                elif new_sentence.audio_status != 'error_creating_sentence_record': # 如果句子创建失败，就不尝试关联语音了
                    new_sentence.audio_status = 'pending_generation' # 如果句子创建成功但语音关联失败
                    current_app.logger.warning(f"[SplitTask] 句子 '{new_sentence_text[:30]}...' 未能成功关联复用语音，状态设为 pending_generation。")

            else: # 没有找到可复用的语音
                new_sentence.audio_status = 'pending_generation'
                db.session.add(new_sentence) # 添加到 session
                # 可以选择在这里也 flush 一下，以尽早发现问题
                # try:
                #     db.session.flush()
                # except Exception as e_flush_new_sent:
                #     current_app.logger.error(f"[SplitTask] Flush new_sentence (pending gen) 时出错: {e_flush_new_sent}", exc_info=True)
                #     new_sentence.audio_status = 'error_creating_sentence_record_no_reuse'
            
            created_sentences_count += 1
        
        training_content.status = 'pending_audio_generation' 
        db.session.add(training_content) # 确保状态更新也被加入

        current_app.logger.info(f"[SplitTask] 即将提交所有更改到数据库 (新脚本版本、句子、复用语音记录、内容状态)...")
        db.session.commit() # ⭐ 最终提交
        current_app.logger.info(f"[SplitTask] 数据库提交成功。")
        
        # 在 commit 后再次确认新脚本是否真的写入了
        persisted_script = TtsScript.query.get(new_final_script.id if new_final_script.id else '00000000-0000-0000-0000-000000000000') # 用一个无效UUID避免None错误
        if persisted_script:
            current_app.logger.info(f"[SplitTask] 确认：新脚本 ID {persisted_script.id} (Version {persisted_script.version}) 已成功持久化到数据库。")
        else:
            current_app.logger.error(f"[SplitTask Fail] 严重错误：Commit后，新脚本 ID {new_final_script.id if new_final_script.id else '未知ID'} 在数据库中未找到！事务可能未生效！")
            # 这种情况非常严重，意味着 commit 可能静默失败了
            return jsonify({'error': '拆分脚本后数据未能正确保存，请联系管理员。'}), 500


        current_app.logger.info(
            f"[SplitTask] 为新脚本 ID {new_final_script.id if new_final_script.id else '未知ID'} (Version {new_version_number}) 成功创建了 {created_sentences_count} 个句子。其中 {reused_audio_count} 个句子的语音被成功复用。"
            f"TrainingContent status 更新为 {training_content.status}。"
        )
        return jsonify({
            'message': f'脚本成功重新拆分为 {created_sentences_count} 个句子，并创建了新的最终脚本版本 (v{new_version_number})。其中 {reused_audio_count} 个语音被复用。',
            'new_final_tts_script_id': str(new_final_script.id) if new_final_script.id else None,
            'new_version': new_version_number,
            'num_sentences': created_sentences_count,
            'num_reused_audio': reused_audio_count,
            'next_step': 'Batch Generate Audio or Single Sentence Generate'
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"[SplitTask Fail] 在主 try 块中捕获到异常，已回滚: {e}", exc_info=True)
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
        # --- 确定 PT 文件路径 ---
        # 方案1: 从请求中获取 (如果用户可以选择音色)
        # request_data = request.json or {}
        # pt_file_relative_path_from_request = request_data.get("pt_file")

        # 方案2: 基于某些后端逻辑确定，或使用固定路径
        # 例如，所有内容都使用同一个音色文件
        # 注意：这个路径是相对于 Flask app.instance_path 的
        default_pt_file_relative_path = "seed_1397_restored_emb.pt" 
        
        # 实际使用的 PT 文件路径 (这里简单使用默认值)
        # 您可以根据需要实现更复杂的逻辑来选择 pt_file_relative_path
        pt_file_to_use = default_pt_file_relative_path 
        # -------------------------

        tts_engine_params = request.json or {} # 其他 TTS 参数

        sentence.audio_status = 'processing_request'
        db.session.commit()

        # 将 pt_file_to_use 传递给 Celery 任务
        task = generate_single_sentence_audio_async.delay(
            str(sentence.id), 
            pt_file_path_relative=pt_file_to_use, # <--- 新增参数
            tts_engine_params=tts_engine_params
        )
        
        current_app.logger.info(f"单句语音生成异步任务已启动 (Task ID: {task.id}) for sentence {sentence_id} using PT file: {pt_file_to_use}")
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
        default_pt_file_relative_path = "seed_1397_restored_emb.pt" 
        
        # 实际使用的 PT 文件路径 (这里简单使用默认值)
        # 您可以根据需要实现更复杂的逻辑来选择 pt_file_relative_path
        pt_file_to_use = default_pt_file_relative_path 
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

        task = batch_generate_audio_task.delay(str(latest_final_script.id),pt_file_path_relative=pt_file_to_use)
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

@tts_bp.route('/training-contents/<uuid:content_id>/merge-audio', methods=['POST'])
@admin_required # Or jwt_required()
def merge_content_audio_route(content_id):
    """
    Triggers an asynchronous task to merge all latest sentence audios for a training content.
    """
    content = TrainingContent.query.get(str(content_id))
    if not content:
        return jsonify({'error': '培训内容未找到'}), 404

    # Optional: Basic check if there's a final script, or let the task handle it
    latest_final_script = TtsScript.query.filter_by(
        training_content_id=content.id, script_type='final_tts_script'
    ).order_by(TtsScript.version.desc()).first()
    if not latest_final_script:
        return jsonify({'error': '该内容没有最终脚本可供合并语音。'}), 400
    if not latest_final_script.tts_sentences.first(): # Check if script has any sentences
        return jsonify({'error': '最终脚本中没有句子可供合并。'}), 400

    try:
        # Update content status to indicate merging has been queued/requested
        content.status = 'audio_merge_queued' # Or 'pending_merge'
        db.session.commit()

        task = merge_all_audios_for_content.delay(str(content.id))
        
        current_app.logger.info(f"语音合并任务已提交 (Task ID: {task.id}) for TrainingContent {content_id}")
        return jsonify({
            'message': '语音合并任务已成功提交，正在后台处理。',
            'task_id': task.id,
            'status_polling_url': f'/api/tts/task-status/{task.id}'
        }), 202 # Accepted

    except Exception as e:
        db.session.rollback()
        # Revert status if task submission failed
        # content.status = 'merge_submit_failed' 
        # db.session.commit()
        current_app.logger.error(f"提交语音合并任务失败 for content {content_id}: {e}", exc_info=True)
        return jsonify({'error': f'提交语音合并任务失败: {str(e)}'}), 500

# API to get segments for a merged audio
@tts_bp.route('/audios/<uuid:merged_audio_id>/segments', methods=['GET'])
@jwt_required()
def get_merged_audio_segments_route(merged_audio_id):
    merged_audio_record = TtsAudio.query.get(str(merged_audio_id))
    if not merged_audio_record or merged_audio_record.audio_type != 'merged_audio':
        return jsonify({'error': '指定的合并语音记录未找到或类型不正确'}), 404

    segments = MergedAudioSegment.query.filter_by(merged_audio_id=merged_audio_record.id).order_by(MergedAudioSegment.original_order_index).all()
    
    return jsonify([{
        'id': str(seg.id),
        'tts_sentence_id': str(seg.tts_sentence_id) if seg.tts_sentence_id else None,
        'original_order_index': seg.original_order_index,
        'original_sentence_text_ref': seg.original_sentence_text_ref,
        'start_ms': seg.start_ms,
        'end_ms': seg.end_ms,
        'duration_ms': seg.duration_ms,
        'sentence_current_text': seg.tts_sentence.sentence_text if seg.tts_sentence else None # Get current text if sentence still exists
    } for seg in segments])

@tts_bp.route('/content/<uuid:content_id>/video-synthesis/latest', methods=['GET'])
@jwt_required() # 或者 @admin_required，根据您的权限设计
def get_latest_synthesis_task_for_content(content_id):
    """
    获取指定培训内容最新的一次视频合成任务状态。
    """
    content = TrainingContent.query.get(str(content_id))
    if not content:
        return jsonify({'error': '培训内容未找到'}), 404

    try:
        # 按创建时间降序排序，找到最新的一个任务记录
        latest_task = VideoSynthesis.query.filter_by(
            training_content_id=str(content_id)
        ).order_by(VideoSynthesis.created_at.desc()).first()

        if not latest_task:
            return jsonify(None), 200 # 返回 null 或空对象，表示还没有任务

        # 返回任务的关键信息
        return jsonify({
            'id': str(latest_task.id),
            'status': latest_task.status,
            'video_script_json': latest_task.video_script_json,
            'generated_resource_id': str(latest_task.generated_resource_id) if latest_task.generated_resource_id else None,
            'created_at': latest_task.created_at.isoformat(),
        }), 200

    except Exception as e:
        current_app.logger.error(f"获取最新合成任务失败 for content {content_id}: {e}", exc_info=True)
        return jsonify({'error': '服务器内部错误'}), 500


@tts_bp.route('/content/<uuid:content_id>/video-synthesis/analyze', methods=['POST'])
@jwt_required()
def start_video_synthesis_analysis(content_id):
    """
    接收用户上传的PPT(PDF)和选择的Prompt，创建视频合成任务，并触发异步分析。
    """
    # 1. 验证和获取输入
    if 'ppt_pdf' not in request.files:
        return jsonify({'error': '缺少名为 "ppt_pdf" 的文件部分'}), 400
    
    ppt_file = request.files['ppt_pdf']
    if ppt_file.filename == '':
        return jsonify({'error': '未选择任何文件'}), 400

    prompt_id = request.form.get('prompt_id')
    if not prompt_id:
        return jsonify({'error': '缺少提示词ID (prompt_id)'}), 400

    content = TrainingContent.query.get(str(content_id))
    if not content:
        return jsonify({'error': '指定的培训内容不存在'}), 404
        
    # 2. 定位合并后的音频和对应的字幕文件（.txt）
    latest_merged_audio = content.merged_audios.filter_by(is_latest_for_content=True).order_by(TtsAudio.created_at.desc()).first()
    if not latest_merged_audio:
        return jsonify({'error': '找不到用于分析的合并后音频文件'}), 404
    
    # 构建字幕文件路径 (.txt)
    audio_path_relative = latest_merged_audio.file_path
    srt_txt_path_relative = os.path.splitext(audio_path_relative)[0] + '.txt'
    
    storage_base_path = current_app.config.get('TTS_AUDIO_STORAGE_PATH')
    srt_txt_full_path = os.path.join(storage_base_path, srt_txt_path_relative)

    if not os.path.exists(srt_txt_full_path):
        current_app.logger.error(f"无法找到预期的字幕文件，路径: {srt_txt_full_path}")
        return jsonify({'error': f'找不到对应的字幕文件({srt_txt_path_relative})，请确认第五步已成功生成。'}), 404

    # 3. 保存上传的PDF文件
    from werkzeug.utils import secure_filename
    video_synthesis_dir = os.path.join(current_app.instance_path, 'uploads', 'video_synthesis', str(content_id))
    os.makedirs(video_synthesis_dir, exist_ok=True)
    
    pdf_filename = secure_filename(ppt_file.filename)
    # 使用UUID确保文件名唯一，防止覆盖
    unique_pdf_filename = f"{uuid.uuid4().hex}_{pdf_filename}"
    pdf_save_path = os.path.join(video_synthesis_dir, unique_pdf_filename)
    ppt_file.save(pdf_save_path)
    current_app.logger.info(f"PDF文件已保存至: {pdf_save_path}")

    try:
        # 4. 创建 VideoSynthesis 任务记录
        new_synthesis_task = VideoSynthesis(
            training_content_id=str(content_id),
            merged_audio_id=latest_merged_audio.id,
            srt_file_path=srt_txt_full_path, # 存储 .txt 文件的绝对路径
            ppt_pdf_path=pdf_save_path,     # 存储 PDF 文件的绝对路径
            llm_prompt_id=prompt_id,
            status='analyzing'             # 初始状态
        )
        db.session.add(new_synthesis_task)
        db.session.commit()
        current_app.logger.info(f"已创建视频合成任务记录: {new_synthesis_task.id}")
        
        # 5. 触发异步任务
        from backend.tasks import analyze_video_script_task
        async_task = analyze_video_script_task.delay(str(new_synthesis_task.id))
        current_app.logger.info(f"已触发视频脚本分析的异步任务，Celery Task ID: {async_task.id}")

        # 6. 返回成功响应
        return jsonify({
            'message': '视频分析任务已成功提交，正在后台处理...',
            'synthesis_id': str(new_synthesis_task.id),
            'task_id': async_task.id
        }), 202

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"创建视频分析任务时出错: {e}", exc_info=True)
        return jsonify({'error': '创建任务时发生服务器内部错误'}), 500
    
@tts_bp.route('/synthesis/<uuid:synthesis_id>/synthesize', methods=['POST'])
@jwt_required()
def trigger_video_synthesis(synthesis_id):
    """
    接收用户确认，触发最终的视频合成异步任务。
    """
    synthesis_task = VideoSynthesis.query.get(str(synthesis_id))
    if not synthesis_task:
        return jsonify({'error': '视频合成任务记录未找到'}), 404

    # 验证当前状态是否适合开始合成
    if synthesis_task.status != 'analysis_complete':
        return jsonify({'error': f'任务当前状态为 "{synthesis_task.status}"，无法开始合成。请先完成分析。'}), 400
    
    # 可选：如果前端允许用户修改脚本，可以从请求体中获取并更新
    # data = request.get_json()
    # if data and 'video_scripts' in data:
    #     synthesis_task.video_script_json = data 
    
    try:
        synthesis_task.status = 'synthesizing' # 更新状态为“合成中”
        db.session.commit()
        
        # 触发视频合成的异步任务
        async_task = synthesize_video_task.delay(str(synthesis_task.id))
        current_app.logger.info(f"已触发视频合成异步任务，Celery Task ID: {async_task.id}")
        
        return jsonify({
            'message': '视频合成任务已成功提交，后台正在处理...',
            'synthesis_id': str(synthesis_task.id),
            'task_id': async_task.id
        }), 202

    except Exception as e:
        db.session.rollback()
        # 出错时回滚状态
        synthesis_task.status = 'error_synthesis' # 可以定义一个专用的错误状态
        db.session.commit()
        current_app.logger.error(f"提交视频合成任务时出错: {e}", exc_info=True)
        return jsonify({'error': '提交合成任务时发生服务器内部错误'}), 500

# @tts_bp.route('/synthesis/<uuid:synthesis_id>/reset', methods=['POST'])
# <<<--- 将上面这行暂时注释掉，并用下面这行替换 ---<<<
# @tts_bp.route('/synthesis/reset_test', methods=['POST'])
# ----------------------------------------------------->>>
# @jwt_required()
# <<<--- 同时，函数的参数也需要临时修改 ---<<<
@tts_bp.route('/synthesis/<uuid:synthesis_id>/reset', methods=['POST'])
@jwt_required()
def reset_synthesis_task(synthesis_id):
    """
    重置一个视频合成任务的状态，允许用户重新开始。
    这会清除已有的分析结果和生成的视频资源链接。
    """
    synthesis_task = VideoSynthesis.query.get(str(synthesis_id))
    if not synthesis_task:
        return jsonify({'error': '视频合成任务记录未找到'}), 404

    try:
        # 清理旧的生成结果
        if synthesis_task.generated_resource_id:
            # 可选：在这里可以添加逻辑来删除旧的视频物理文件和CourseResource记录
            # 为了简化，我们暂时只断开链接
            old_resource_id = synthesis_task.generated_resource_id
            synthesis_task.generated_resource_id = None
            current_app.logger.info(f"任务 {synthesis_id} 与旧资源 {old_resource_id} 的关联已解除。")
        
        # 清空分析结果，并将状态重置回初始状态
        synthesis_task.video_script_json = None
        synthesis_task.status = 'idle' # 或者 'pending_analysis'
        
        db.session.commit()
        
        current_app.logger.info(f"视频合成任务 {synthesis_id} 已被重置。")

        # 返回更新后的任务对象，以便前端立即更新UI
        return jsonify({
            'message': '任务状态已重置，您可以重新开始。',
            'updated_task': {
                'id': str(synthesis_task.id),
                'status': synthesis_task.status,
                'video_script_json': None,
                'generated_resource_id': None,
            }
        }), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"重置合成任务 {synthesis_id} 时出错: {e}", exc_info=True)
        return jsonify({'error': '重置任务状态时发生服务器内部错误'}), 500