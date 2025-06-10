# backend/tasks.py
import logging
import os
import re
import uuid
from datetime import datetime
import requests
from pydub import AudioSegment
from pydub.exceptions import CouldntDecodeError
import sys # <<< 新增
from io import StringIO # <<< 新增
import contextlib # <<< 新增
import time # <<< 新增
from celery.utils.log import get_task_logger # 使用 Celery 的 logger



from celery_worker import celery_app
from flask import current_app
from sqlalchemy import or_, func
import sqlalchemy as sa
from werkzeug.utils import secure_filename

import fitz  # PyMuPDF 库的导入名是 fitz

from backend.extensions import db
from backend.models import TrainingContent, TtsScript, TtsSentence, TtsAudio, MergedAudioSegment, UserProfile, Exam, VideoSynthesis, CourseResource
from backend.api.ai_generate import generate_video_script # 导入新函数

# 合成视频
from pdf2image import convert_from_path
from moviepy.editor import ImageClip, AudioFileClip, concatenate_videoclips
from PIL import Image # <<<--- 关键：导入Pillow的Image模块
import numpy as np
import threading






# 导入需要异步执行的LLM函数和TTS相关的外部客户端
from backend.api.ai_generate import (
    transform_text_with_llm
)
from gradio_client import Client as GradioClient

logger = logging.getLogger(__name__)

# --- 辅助函数：创建Flask应用上下文 ---
def create_flask_app_for_task():
    from backend.app import app as flask_app_instance
    return flask_app_instance

# 新增：格式化毫秒为SRT时间戳的辅助函数
def format_ms_to_srt_time(ms):
    if not isinstance(ms, (int, float)) or ms < 0:
        return '00:00:00,000'
    total_seconds = int(ms / 1000)
    milliseconds = int(ms % 1000)
    hours = int(total_seconds / 3600)
    minutes = int((total_seconds % 3600) / 60)
    seconds = int(total_seconds % 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"

# ==============================================================================
# SECTION 1: 通用异步LLM任务处理器
# (用于处理文本生成、总结等无复杂I/O的LLM调用)
# ==============================================================================

# 1.1: 注册可被异步调用的LLM函数
LLM_FUNCTION_REGISTRY = {
    'transform_text_with_llm': transform_text_with_llm
}

# 1.2: 注册异步任务成功后的回调函数
def _handle_oral_script_result(result, context):
    """处理“生成口播稿”任务的结果。"""
    training_content_id = context.get('training_content_id')
    source_script_id = context.get('source_script_id')
    
    if not training_content_id or not source_script_id:
        raise ValueError("缺少 training_content_id 或 source_script_id 上下文信息")

    content = TrainingContent.query.get(training_content_id)
    if not content:
        raise ValueError(f"TrainingContent with id {training_content_id} not found.")

    latest_oral_script = TtsScript.query.filter_by(
        training_content_id=training_content_id,
        script_type='oral_script'
    ).order_by(TtsScript.version.desc()).first()
    new_version = (latest_oral_script.version + 1) if latest_oral_script else 1

    new_script = TtsScript(
        training_content_id=training_content_id,
        script_type='oral_script',
        content=result,
        version=new_version,
        source_script_id=source_script_id
    )
    db.session.add(new_script)
    content.status = 'pending_tts_refine'
    logger.info(f"口播稿已生成并保存，内容 {training_content_id} 状态更新为 pending_tts_refine。")

def _handle_employee_summary_result(result, context):
    """处理“员工总结”任务的结果。"""
    user_id = context.get('user_id')
    if not user_id:
        raise ValueError("缺少 user_id 上下文信息")

    profile = UserProfile.query.get(user_id)
    if profile:
        profile.profile_data = result
    else:
        profile = UserProfile(user_id=user_id, profile_data=result)
        db.session.add(profile)
    logger.info(f"AI生成的员工总结已为用户 {user_id} 保存/更新。")

def _handle_kp_summary_result(result, context):
    """处理“知识点总结”任务的结果。"""
    exam_take_id = context.get('exam_take_id')
    total_score = context.get('total_score') # 从上下文中获取总分
    if not exam_take_id:
        raise ValueError("缺少 exam_take_id 上下文信息")

    exam_record = Exam.query.get(exam_take_id)
    if not exam_record:
        raise ValueError(f"Exam record with id {exam_take_id} not found.")
        
    exam_record.knowledge_point_summary = result
    if total_score is not None:
        exam_record.total_score = total_score # 同时更新总分
    logger.info(f"AI生成的知识点总结已为考试记录 {exam_take_id} 保存。")

def _handle_final_refine_result(result, context):
    """处理 LLM 最终修订任务的结果。"""
    training_content_id = context.get('training_content_id')
    source_script_id = context.get('source_script_id')

    if not training_content_id or not source_script_id:
        raise ValueError("缺少 handle_final_refine_result 的上下文信息")

    content = TrainingContent.query.get(training_content_id)
    if not content:
        raise ValueError(f"TrainingContent {training_content_id} not found.")

    final_content_str = ""
    if isinstance(result, dict) and 'revised_text' in result:
        final_content_str = result['revised_text']
    elif isinstance(result, str):
        final_content_str = result
    else:
        # 如果格式不符合预期，也记录下来，但不要让任务崩溃
        logger.warning(f"LLM最终修订返回了非预期的格式: {type(result)}")
        final_content_str = str(result) # 尽力保存为字符串

    if not final_content_str.strip():
        logger.warning(f"LLM最终修订脚本为空 for content {training_content_id}")
        content.status = 'error_llm_final_refine' # 标记一个特定的错误状态
        return # 不创建空脚本，直接返回

    latest_final_script = TtsScript.query.filter_by(
        training_content_id=training_content_id,
        script_type='final_tts_script'
    ).order_by(TtsScript.version.desc()).first()
    new_version = (latest_final_script.version + 1) if latest_final_script else 1

    new_script = TtsScript(
        training_content_id=training_content_id,
        script_type='final_tts_script',
        content=final_content_str,
        version=new_version,
        source_script_id=source_script_id
    )
    db.session.add(new_script)
    content.status = 'pending_sentence_split'
    logger.info(f"最终TTS脚本已生成 (ID: {new_script.id})，内容 {training_content_id} 状态更新为 pending_sentence_split。")

CALLBACK_REGISTRY = {
    'handle_oral_script': _handle_oral_script_result,
    'handle_employee_summary': _handle_employee_summary_result,
    'handle_kp_summary': _handle_kp_summary_result,
    'handle_final_refine': _handle_final_refine_result,
}

# 1.3: 通用LLM任务执行器
@celery_app.task(bind=True, name='tasks.run_llm_function_async', max_retries=2, default_retry_delay=60)
def run_llm_function_async(self, llm_function_identifier, callback_identifier, context, *args, **kwargs):
    app = create_flask_app_for_task()
    with app.app_context():
        llm_function = LLM_FUNCTION_REGISTRY.get(llm_function_identifier)
        callback_function = CALLBACK_REGISTRY.get(callback_identifier)

        if not llm_function or not callback_function:
            error_msg = f"未找到标识符为 '{llm_function_identifier}' 或 '{callback_identifier}' 的注册函数。"
            logger.error(error_msg)
            self.update_state(state='FAILURE', meta={'error': error_msg})
            return {'status': 'Error', 'message': error_msg}

        try:
            logger.info(f"任务 {self.request.id}: 开始执行 LLM 函数 '{llm_function_identifier}'...")
            self.update_state(state='PROGRESS', meta={'message': f'正在调用LLM ({llm_function_identifier})...', 'context': context})

            llm_result = llm_function(*args, **kwargs)
            logger.info(f"任务 {self.request.id}: LLM 函数 '{llm_function_identifier}' 执行成功。")
            self.update_state(state='PROGRESS', meta={'message': 'LLM调用成功，正在处理结果...', 'context': context})

            callback_function(llm_result, context)
            
            db.session.commit()
            logger.info(f"任务 {self.request.id}: 回调 '{callback_identifier}' 执行完毕，数据已提交。")
            return {'status': 'Success', 'message': '任务成功完成', 'result_preview':llm_result}
            # return {'status': 'Success', 'message': '任务成功完成', 'result_preview': str(llm_result)[:100] + '...'}
        except Exception as e:
            db.session.rollback()
            logger.error(f"任务 {self.request.id} 在执行 '{llm_function_identifier}' 或回调 '{callback_identifier}' 时失败: {e}", exc_info=True)
            try:
                # 触发Celery的重试机制
                self.retry(exc=e)
            except self.MaxRetriesExceededError:
                logger.error(f"任务 {self.request.id} 已达到最大重试次数，不再重试。")
                # 可在此处添加最终失败处理逻辑，例如更新数据库状态
            raise e

# ==============================================================================
# SECTION 2: 专用的TTS和文件处理异步任务
# (这些任务涉及复杂I/O和多步骤流程，保留专用任务更清晰)
# ==============================================================================

# 2.1: TTS相关辅助函数 (从您原有的tasks.py中保留)
def _save_audio_file(audio_binary_content, training_content_id_str, sentence_id_str, version):
    app = create_flask_app_for_task()
    with app.app_context():
        storage_base_path = app.config.get('TTS_AUDIO_STORAGE_PATH', os.path.join(app.root_path, 'static', 'tts_audio'))
        relative_dir = os.path.join(str(training_content_id_str), str(sentence_id_str))
        full_dir_path = os.path.join(storage_base_path, relative_dir)
        os.makedirs(full_dir_path, exist_ok=True)
        
        timestamp_str = datetime.now().strftime("%Y%m%d%H%M%S%f")
        file_name = f"sentence_v{version}_{timestamp_str}.wav"
        full_file_path = os.path.join(full_dir_path, file_name)
        relative_file_path = os.path.join(relative_dir, file_name)

        try:
            with open(full_file_path, 'wb') as f:
                f.write(audio_binary_content)
            logger.info(f"音频文件已保存到: {full_file_path}")
            return relative_file_path, os.path.getsize(full_file_path)
        except Exception as e:
            logger.error(f"保存音频文件失败 {full_file_path}: {e}", exc_info=True)
            raise

def _save_merged_audio_file(audio_segment_obj, training_content_id_str, version_number):
    app = create_flask_app_for_task()
    with app.app_context():
        storage_base_path = app.config.get('TTS_AUDIO_STORAGE_PATH', os.path.join(app.root_path, 'static', 'tts_audio'))
        relative_dir = str(training_content_id_str)
        full_dir_path = os.path.join(storage_base_path, relative_dir)
        os.makedirs(full_dir_path, exist_ok=True)
        
        timestamp_str = datetime.now().strftime("%Y%m%d%H%M%S%f")
        file_name = f"merged_audio_v{version_number}_{timestamp_str}.mp3"
        full_file_path = os.path.join(full_dir_path, file_name)
        relative_file_path = os.path.join(relative_dir, file_name)

        try:
            audio_segment_obj.export(full_file_path, format="mp3")
            logger.info(f"合并的音频文件已保存: {full_file_path}")
            return relative_file_path, os.path.getsize(full_file_path)
        except Exception as e:
            logger.error(f"保存合并的音频文件失败 {full_file_path}: {e}", exc_info=True)
            raise

# 2.2: 你的专用TTS任务 (保留并确保它们能正确运行)
def _create_new_script_version_task(source_script_id, training_content_id, new_script_type, new_content, llm_log_id=None):
    # 这个函数与 tts_api.py 中的类似，但它在 Celery 任务中运行，需要自己的数据库会话管理
    # 注意：Celery 任务中不能直接依赖 Flask 的请求上下文 (request, g)
    # 但可以通过 app_context() 访问数据库和 current_app.config
    app = create_flask_app_for_task()
    with app.app_context():
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
            llm_call_log_id=llm_log_id,
            source_script_id=source_script_id
        )
        db.session.add(new_script)
        # 注意：commit 需要在任务的末尾，或者在一个更大的事务单元中
        # db.session.commit() # 通常在任务成功完成后提交
        return new_script # 返回创建的对象，但不立即提交

@celery_app.task(bind=True, name='tasks.trigger_tts_refine_async')
def trigger_tts_refine_async(self, oral_script_id_str):
    app = create_flask_app_for_task()
    with app.app_context():
        oral_script = TtsScript.query.get(oral_script_id_str)
        if not oral_script or oral_script.script_type != 'oral_script':
            # ... (错误处理)
            return {'status': 'Error', 'message': '无效的脚本ID'}

        training_content = oral_script.training_content
        if not training_content:
            # ... (错误处理)
            return {'status': 'Error', 'message': '找不到关联内容'}
        
        try:
            tts_service_base_url = app.config.get('TTS_SERVICE_BASE_URL', "http://test.mengyimengsao.com:37860/")
            gradio_tts_client = GradioClient(tts_service_base_url)
            
            job = gradio_tts_client.predict(
                text_file=oral_script.content, oral=2, laugh=0, bk=4,
                temperature=0.1, top_P=0.7, top_K=20, api_name="/generate_refine"
            )
            
            refined_content = None
            if hasattr(job, 'result'): refined_content = job.result()
            elif isinstance(job, tuple) and len(job) > 0: refined_content = job[0]
            elif isinstance(job, str): refined_content = job
            else: raise Exception("Gradio TTS API 返回格式未知")


            if not isinstance(refined_content, str) or not refined_content.strip():
                raise Exception("Gradio TTS API 未返回有效的文本结果或结果为空")

            latest_refined = TtsScript.query.filter_by(
                training_content_id=training_content.id,
                script_type='tts_refined_script'
            ).order_by(TtsScript.version.desc()).first()
            new_version = (latest_refined.version + 1) if latest_refined else 1

            new_refined_script = TtsScript(
                training_content_id=training_content.id,
                script_type='tts_refined_script',
                content=refined_content,
                version=new_version,
                source_script_id=oral_script.id
            )

            training_content.status = 'pending_llm_final_refine'
            db.session.add(new_refined_script)
            db.session.commit()

            logger.info(f"TTS Refine脚本已生成 (ID: {new_refined_script.id})")
            return {'status': 'Success', 'new_script_id': str(new_refined_script.id)}

        except Exception as e:
            logger.error(f"TTS Refine Task 失败 for script {oral_script_id_str}: {e}", exc_info=True)
            training_content.status = 'error_tts_refine'
            db.session.commit()
            self.update_state(state='FAILURE', meta={'exc_type': type(e).__name__, 'exc_message': str(e)})
            return {'status': 'Error', 'message': str(e)}

@celery_app.task(bind=True, name='tasks.generate_single_sentence_audio_async', max_retries=2)
def generate_single_sentence_audio_async(self, sentence_id_str, pt_file_path_relative=None, tts_engine_params=None):
    app = create_flask_app_for_task()
    with app.app_context():
        sentence = TtsSentence.query.get(sentence_id_str)
        if not sentence:
            logger.error(f"GenerateAudio Task: 句子 {sentence_id_str} 未找到。")
            self.update_state(state='FAILURE', meta={'exc_type': 'ValueError', 'exc_message': '句子未找到'})
            return {'status': 'Error', 'message': '句子未找到'}

        training_content = sentence.tts_script.training_content # 获取关联的 TrainingContent

        try:
            sentence.audio_status = 'generating'
            db.session.commit()

            tts_service_base_url = app.config.get('TTS_SERVICE_BASE_URL', "http://test.mengyimengsao.com:37860/")
            gradio_tts_client = GradioClient(tts_service_base_url, hf_token=None) # 确保 hf_token 正确或为 None
            
            logger.info(f"GenerateAudio Task: 向 Gradio TTS 服务 API '/generate_tts_audio' 发送请求 for sentence {sentence_id_str}")
            
            # 从 tts_engine_params 或默认值构建 predict 的参数
            # 这些参数应该可以从 LlmPrompt 的元数据或系统配置中获取，或者前端传递
            # 以下是基于您提供的示例的默认值
            default_params = {
                "num_seeds": 1, "seed": 1029, "speed": 5, "oral": 2, "laugh": 0,
                "bk": 4, "min_length": 80, "batch_size": 3, "temperature": 0.1,
                "top_P": 0.7, "top_K": 20, "roleid": "1", "refine_text": True, "pt_file": None
            }
            
            actual_params = {**default_params, **(tts_engine_params or {})}

            # --- 核心修改：根据传入的参数构造文件对象 ---
            if pt_file_path_relative:
                pt_folder = os.path.join(app.root_path, 'static', 'tts_pt')
                absolute_pt_file_path = os.path.join(pt_folder, pt_file_path_relative)
                
                if os.path.exists(absolute_pt_file_path):
                    logger.info(f"[SingleAudioTask] 使用指定的音色文件: {absolute_pt_file_path}")
                    actual_params['pt_file'] = {
                        "path": absolute_pt_file_path,
                        "meta": {"_type": "gradio.FileData"}
                    }
                else:
                    logger.warning(f"[SingleAudioTask] 指定的音色文件不存在: {absolute_pt_file_path}，将使用默认音色。")
            else:
                 logger.info(f"[SingleAudioTask] 未指定音色文件，使用默认音色。")

            job_result = gradio_tts_client.predict(
                text_file=sentence.sentence_text,
                **actual_params,
                api_name="/generate_tts_audio"
            )
            
            # 处理 Gradio 返回的音频结果
            # Gradio 对于音频输出通常会返回一个包含文件路径的字典或直接是文件路径字符串
            # { "name": "path/to/output.wav", "data": null, "is_file": true } 或只是 "path/to/output.wav"
            # 如果它返回的是服务器上的临时文件路径，我们需要读取它。
            # 如果它返回的是 base64 编码的音频，需要解码。
            # 这里假设它返回一个包含本地文件路径的字典或字符串。
            
            audio_file_path_from_gradio = None
            if isinstance(job_result, dict) and job_result.get("name") and job_result.get("is_file"):
                audio_file_path_from_gradio = job_result["name"]
            elif isinstance(job_result, str): # 如果直接返回路径
                audio_file_path_from_gradio = job_result
            elif isinstance(job_result, tuple) and len(job_result) > 0 and isinstance(job_result[0], (dict, str)):
                 # 如果输出是元组的第一个元素
                first_output = job_result[0]
                if isinstance(first_output, dict) and first_output.get("name") and first_output.get("is_file"):
                     audio_file_path_from_gradio = first_output["name"]
                elif isinstance(first_output, str):
                     audio_file_path_from_gradio = first_output


            if not audio_file_path_from_gradio:
                logger.error(f"Gradio TTS API /generate_tts_audio 未返回有效的音频文件路径。原始 job_result: {job_result}")
                raise Exception("Gradio TTS API 未返回音频文件路径")

            logger.info(f"GenerateAudio Task: Gradio TTS API 响应成功，音频文件路径: {audio_file_path_from_gradio}")

            # 读取 Gradio 服务生成的音频文件内容 (假设它是一个临时文件路径)
            # 注意：这里假设 Gradio 服务和 Celery worker 可以访问同一个文件系统，或者 audio_file_path_from_gradio 是一个可下载的 URL
            # 如果 Gradio 服务在另一台机器上，您可能需要通过 HTTP 下载这个文件，或者 Gradio Client 提供了下载方法
            audio_binary_content = None
            if os.path.exists(audio_file_path_from_gradio): # 如果是本地路径
                with open(audio_file_path_from_gradio, 'rb') as af:
                    audio_binary_content = af.read()
            elif audio_file_path_from_gradio.startswith('http'): # 如果是 URL
                response = requests.get(audio_file_path_from_gradio, timeout=60)
                response.raise_for_status()
                audio_binary_content = response.content
            else: # 尝试使用 gradio_file 打开 (如果它是 Gradio FileData 对象)
                try:
                    # 假设 audio_file_path_from_gradio 可能是一个可以被 gradio_file 处理的结构
                    # 这部分可能需要根据 gradio_client 返回的具体内容调整
                    # 如果 gradio_client.predict 返回的是 FileData 对象，可以直接用
                    if isinstance(job_result, tuple) and len(job_result) > 0 and hasattr(job_result[0], 'path'):
                        with open(job_result[0].path, 'rb') as af:
                             audio_binary_content = af.read()
                    else: # 最后尝试直接作为路径处理，如果它是相对路径，可能需要配置基础路径
                        logger.warning(f"无法直接访问 Gradio 音频路径 {audio_file_path_from_gradio}，尝试拼接。")
                        # 这里可能需要一个配置项来指定 Gradio 输出文件的基础目录
                        # 这是一个复杂的点，取决于您的 Gradio 服务如何提供文件
                        raise Exception("无法确定如何读取Gradio生成的音频文件")

                except Exception as e_file:
                    logger.error(f"无法读取Gradio生成的音频文件 {audio_file_path_from_gradio}: {e_file}")
                    raise

            if not audio_binary_content:
                raise Exception("未能获取音频文件内容")

            # 将旧的该句子的最新语音标记为非最新
            TtsAudio.query.filter_by(tts_sentence_id=sentence.id, is_latest_for_sentence=True).update({'is_latest_for_sentence': False})

            # 保存音频文件并创建 TtsAudio 记录
            new_version = 1
            latest_audio_for_sentence = TtsAudio.query.filter_by(tts_sentence_id=sentence.id).order_by(TtsAudio.version.desc()).first()
            if latest_audio_for_sentence:
                new_version = latest_audio_for_sentence.version + 1
            
            relative_path, file_size = _save_audio_file(audio_binary_content, training_content.id, sentence.id, new_version)

            new_audio_record = TtsAudio(
                tts_sentence_id=sentence.id,
                training_content_id=training_content.id, # 也关联到 TrainingContent
                audio_type='sentence_audio',
                file_path=relative_path,
                file_size_bytes=file_size,
                # duration_ms=... # 如果 Gradio 返回时长，可以在这里记录
                tts_engine="GradioTTS_TestMengyimengsao", # 或从配置读取
                voice_name=actual_params.get("roleid", "default"), # 示例
                generation_params=actual_params,
                version=new_version,
                is_latest_for_sentence=True
            )
            db.session.add(new_audio_record)
            sentence.audio_status = 'generated'
            db.session.commit()

            logger.info(f"GenerateAudio Task: 句子 {sentence_id_str} 的音频 (ID: {new_audio_record.id}) 已成功生成并保存。")
            return {'status': 'Success', 'audio_id': str(new_audio_record.id), 'file_path': relative_path}

        except Exception as e:
            logger.error(f"GenerateAudio Task: Exception for sentence {sentence_id_str}: {e}", exc_info=True)
            if sentence: # 确保 sentence 对象存在
                sentence.audio_status = 'error_generation'
                db.session.commit()
            self.update_state(state='FAILURE', meta={'exc_type': type(e).__name__, 'exc_message': str(e)})
            return {'status': 'Error', 'message': '生成单句语音时发生服务器错误: ' + str(e)}
        
# --- 新增：批量语音生成任务 ---
# backend/tasks.py
# ... (imports as before) ...

# backend/tasks.py
# ... (imports) ...

@celery_app.task(bind=True, name='tasks.batch_generate_audio_task', max_retries=1)
def batch_generate_audio_task(self, final_script_id_str, pt_file_path_relative):
    # print(f"Batch task ID=========: {self.request.id}")
    app = create_flask_app_for_task()
    with app.app_context():
        final_script_id = uuid.UUID(final_script_id_str)
        logger.info(f"[BatchTask:{self.request.id}] 开始处理批量语音生成，脚本ID: {final_script_id}")

        script = TtsScript.query.get(final_script_id)
        if not script or script.script_type != 'final_tts_script':
            meta_error = {'error': '脚本未找到或类型不正确', 'total_in_batch': 0, 'processed_in_batch': 0, 'succeeded_in_batch': 0, 'failed_in_batch': 0}
            self.update_state(state='FAILURE', meta=meta_error)
            return {'status': 'Error', 'message': '脚本未找到或类型不正确', **meta_error}

        training_content = script.training_content
        if not training_content:
            meta_error = {'error': '脚本没有关联的培训内容', 'total_in_batch': 0, 'processed_in_batch': 0, 'succeeded_in_batch': 0, 'failed_in_batch': 0}
            self.update_state(state='FAILURE', meta=meta_error)
            return {'status': 'Error', 'message': '脚本没有关联的培训内容', **meta_error}
        
        if training_content.status != 'generating_audio':
            training_content.status = 'generating_audio' # 标记整体状态
            # db.session.commit() # 可以在循环开始前提交一次，或在任务开始时就更新

        sentences_to_process = TtsSentence.query.filter(
            TtsSentence.tts_script_id == final_script_id,
            sa.or_( # 使用 SQLAlchemy 的 or_
                TtsSentence.audio_status == 'pending_generation',
                TtsSentence.audio_status == 'error_generation',
                TtsSentence.audio_status == 'pending_regeneration',
                TtsSentence.audio_status == 'error_submission',
                TtsSentence.audio_status == 'error_polling',
                TtsSentence.audio_status == 'processing_request', # 也可以加入处理中但超时的
                TtsSentence.audio_status == 'queued'
            )
        ).order_by(TtsSentence.order_index).all()
        
        initially_to_process_count = len(sentences_to_process)

        if initially_to_process_count == 0:
            logger.info(f"[BatchTask:{self.request.id}] 脚本 {final_script_id} 没有需要生成语音的句子。")
            all_sentences_in_script = script.tts_sentences.all()
            all_generated = all(s.audio_status == 'generated' for s in all_sentences_in_script)
            if all_generated and all_sentences_in_script:
                 training_content.status = 'audio_generation_complete'
            elif all_sentences_in_script:
                 training_content.status = 'partial_audio_generated' # 或保持 generating_audio 直到用户手动确认
            else:
                 training_content.status = 'audio_generation_complete' 
            db.session.commit()
            meta_no_sentences = {
                'total_in_batch': 0, 'processed_in_batch': 0, 
                'succeeded_in_batch': 0, 'failed_in_batch': 0, 
                'message': '没有需要处理的句子。'
            }
            self.update_state(state='SUCCESS', meta=meta_no_sentences)
            return {'status': 'Success', **meta_no_sentences} # 返回包含计数的字典

        processed_count = 0
        successful_generations = 0
        failed_generations = 0
        
        initial_meta = {
            'total_in_batch': initially_to_process_count,
            'processed_in_batch': 0,
            'succeeded_in_batch': 0,
            'failed_in_batch': 0,
            'message': f'初始化任务：准备处理 {initially_to_process_count} 个句子...'
        }
        self.update_state(state='PROGRESS', meta=initial_meta)
        # logger.debug(f"[BatchTask:{self.request.id}] Initial meta sent: {initial_meta}")
        # chattts-seed_9716speed_3oral_2laugh_0break_42025-05-15_155558
        gradio_tts_client = GradioClient(app.config.get('TTS_SERVICE_BASE_URL', "http://test.mengyimengsao.com:37860/"), hf_token=app.config.get('GRADIO_HF_TOKEN', None))
        default_tts_params = {
           "num_seeds": 1, "seed": 1029, "speed": 2, "oral": 2, "laugh": 0,
            "bk": 6, "min_length": 80, "batch_size": 6, "temperature": 0.1,
            "top_P": 0.7, "top_K": 20, "roleid": "1", "refine_text": True, "pt_file": None
        }

        # --- 核心修改：根据传入的参数构造文件对象 ---
        pt_file_to_use_obj = None
        if pt_file_path_relative:
            pt_folder = os.path.join(app.root_path, 'static', 'tts_pt')
            absolute_pt_file_path = os.path.join(pt_folder, pt_file_path_relative)

            if os.path.exists(absolute_pt_file_path):
                logger.info(f"[BatchTask:{self.request.id}] 使用指定的音色文件: {absolute_pt_file_path}")
                pt_file_to_use_obj = {
                    "path": absolute_pt_file_path,
                    "meta": {"_type": "gradio.FileData"}
                }
            else:
                logger.warning(f"[BatchTask:{self.request.id}] 指定的音色文件不存在: {absolute_pt_file_path}，将使用默认音色。")
        else:
            logger.info(f"[BatchTask:{self.request.id}] 未指定音色文件，使用默认音色。")
        # -------------------------
        

        for index, sentence in enumerate(sentences_to_process):
            sentence_id_str = str(sentence.id)
            sentence.audio_status = 'generating' # 标记单个句子开始生成
            db.session.commit() 
            # logger.info(f"[BatchTask:{self.request.id}] ({processed_count + 1}/{initially_to_process_count}) 开始为句子ID {sentence_id_str} 生成语音...")

            current_sentence_processed_status = 'error_generation' # 默认为失败

            try:
                actual_params = {**default_tts_params} 
                if pt_file_to_use_obj:
                    actual_params['pt_file'] = pt_file_to_use_obj
                job_result = gradio_tts_client.predict(
                    text_file=sentence.sentence_text,
                    **actual_params,
                    api_name="/generate_tts_audio"
                )
                
                audio_file_path_from_gradio = None
                # ... (Gradio 结果解析逻辑，同上次) ...
                if isinstance(job_result, dict) and job_result.get("name") and job_result.get("is_file"):
                    audio_file_path_from_gradio = job_result["name"]
                elif isinstance(job_result, str):
                    audio_file_path_from_gradio = job_result
                elif isinstance(job_result, tuple) and len(job_result) > 0:
                    first_output = job_result[0]
                    if isinstance(first_output, dict) and first_output.get("name") and first_output.get("is_file"):
                        audio_file_path_from_gradio = first_output["name"]
                    elif isinstance(first_output, str):
                        audio_file_path_from_gradio = first_output

                if not audio_file_path_from_gradio:
                    raise Exception(f"Gradio TTS API 未返回音频文件路径. Result: {job_result}")

                audio_binary_content = None
                # ... (文件读取逻辑，同上次) ...
                if os.path.exists(audio_file_path_from_gradio):
                    with open(audio_file_path_from_gradio, 'rb') as af: audio_binary_content = af.read()
                elif audio_file_path_from_gradio.startswith('http'):
                    response = requests.get(audio_file_path_from_gradio, timeout=60); response.raise_for_status(); audio_binary_content = response.content
                else:
                    if isinstance(job_result, tuple) and len(job_result) > 0 and hasattr(job_result[0], 'path') and os.path.exists(job_result[0].path):
                        with open(job_result[0].path, 'rb') as af: audio_binary_content = af.read()
                    else: raise Exception(f"无法读取或文件不存在: {audio_file_path_from_gradio}")
                if not audio_binary_content: raise Exception("未能获取音频内容")
                
                # --- 核心修改：在创建 Audio 记录前，确保更新旧记录的 is_latest_for_sentence ---
                TtsAudio.query.filter_by(tts_sentence_id=sentence.id, is_latest_for_sentence=True).update({'is_latest_for_sentence': False})
                # --- 结束核心修改 ---

                new_version = 1
                latest_audio = TtsAudio.query.filter_by(tts_sentence_id=sentence.id).order_by(TtsAudio.version.desc()).first()
                if latest_audio: new_version = latest_audio.version + 1
                
                relative_path, file_size = _save_audio_file(audio_binary_content, training_content.id, sentence.id, new_version)
                
                new_audio_record = TtsAudio(
                    tts_sentence_id=sentence.id,
                    training_content_id=training_content.id,
                    audio_type='sentence_audio',
                    file_path=relative_path,
                    file_size_bytes=file_size,
                    tts_engine="GradioTTS_Mengyimengsao_Batch", # 区分一下引擎来源
                    voice_name=actual_params.get("roleid", "default"),
                    generation_params=actual_params,
                    version=new_version,
                    is_latest_for_sentence=True # 新生成的自然是最新
                )
                db.session.add(new_audio_record)
                current_sentence_processed_status = 'generated' # 标记成功
                successful_generations += 1
                # logger.info(f"[BatchTask:{self.request.id}] 句子 {sentence_id_str} 语音成功。")
                
            except Exception as e_sent:
                # current_sentence_processed_status 保持 'error_generation'
                failed_generations += 1
                logger.error(f"[BatchTask:{self.request.id}] 处理句子 {sentence_id_str} 失败: {e_sent}", exc_info=True)
            
            sentence.audio_status = current_sentence_processed_status # 更新数据库中句子的最终状态
            db.session.commit() 
            processed_count += 1
            
            
            # **简化 meta，只包含 Celery 能可靠更新的字段 和 整体计数**
            current_meta_for_celery = {
                'current': processed_count, # Celery 倾向于使用 current/total
                'total': initially_to_process_count,
                # 仍然尝试传递这些，看是否能被 API 读取到
                'total_in_batch': initially_to_process_count,
                'processed_in_batch': processed_count,
                'succeeded_in_batch': successful_generations,
                'failed_in_batch': failed_generations,
                'current_sentence_id': str(sentence.id), # 这个似乎能被传递
                'message': f'已处理 {processed_count}/{initially_to_process_count}' # 简洁的消息
            }
            # print(f"[BatchTask============》:{self.request.id}] Updating Celery task state with meta: {current_meta_for_celery}")
            self.update_state(state='PROGRESS', meta=current_meta_for_celery)
            updated_task_info_in_celery = self.AsyncResult(self.request.id).info
            # print(f"[BatchTask=========》:{self.request.id}] Meta immediately after update_state in Celery: {updated_task_info_in_celery}")
        
        
        # 任务结束
        all_sentences_in_script = script.tts_sentences.order_by(TtsSentence.order_index).all()
        # all_succeeded = all(s.audio_status == 'generated' for s in all_processed_sentences if s in sentences_to_process) # 只检查本次处理的
        
        final_message_summary = ""
        if failed_generations == 0 and successful_generations == initially_to_process_count:
            training_content.status = 'audio_generation_complete' 
            final_task_status_celery = 'SUCCESS'
            final_message_summary = f"所有 {initially_to_process_count} 个句子的语音已成功生成。"
        elif successful_generations > 0:
            training_content.status = 'partial_audio_generation_error' # 部分成功，部分失败
            final_task_status_celery = 'SUCCESS' # 任务本身算成功完成（但有部分内容失败）
            final_message_summary = f"{successful_generations} 个句子语音生成成功，{failed_generations} 个失败。"
        else: # 所有都失败了
            training_content.status = 'audio_generation_failed'
            final_task_status_celery = 'FAILURE'
            final_message_summary = f"所有尝试处理的 {initially_to_process_count} 个句子的语音生成均失败。"
        
        db.session.commit()
        # logger.info(f"[BatchTask:{self.request.id}] {final_message_summary}")

        final_meta_for_celery = {
            'total_in_batch': initially_to_process_count,
            'processed_in_batch': processed_count,
            'succeeded_in_batch': successful_generations,
            'failed_in_batch': failed_generations,
            'message': final_message_summary
        }
        self.update_state(state=final_task_status_celery, meta=final_meta_for_celery)
        
        return { 
            'status': final_task_status_celery, 
            **final_meta_for_celery # 直接展开 final_meta_for_celery
        }

@celery_app.task(bind=True, name='tasks.merge_all_audios_for_content', max_retries=1)
def merge_all_audios_for_content(self, training_content_id_str):
    app = create_flask_app_for_task()
    with app.app_context():
        task_id = self.request.id
        logger.info(f"[MergeTask:{task_id}] ------------------------------------------")
        logger.info(f"[MergeTask:{task_id}] 开始音频合并任务 for TrainingContent ID: {training_content_id_str}")
        
        content = TrainingContent.query.get(training_content_id_str)
        if not content:
            logger.error(f"[MergeTask:{task_id}] TrainingContent {training_content_id_str} not found.")
            self.update_state(state='FAILURE', meta={'error': 'Content not found'})
            return {'status': 'Error', 'message': 'TrainingContent not found'}

        latest_final_script = TtsScript.query.filter_by(
            training_content_id=content.id,
            script_type='final_tts_script'
        ).order_by(TtsScript.version.desc()).first()

        if not latest_final_script:
            logger.warning(f"[MergeTask:{task_id}] No final_tts_script found for content {content.id}.")
            content.status = 'merge_failed_no_script'
            db.session.commit()
            self.update_state(state='FAILURE', meta={'error': 'No final script'})
            return {'status': 'Error', 'message': 'No final script found'}

        sentences_in_order = latest_final_script.tts_sentences.order_by(TtsSentence.order_index).all()
        if not sentences_in_order:
            logger.warning(f"[MergeTask:{task_id}] No sentences in final_tts_script {latest_final_script.id}.")
            content.status = 'merge_failed_no_sentences'
            db.session.commit()
            self.update_state(state='SUCCESS', meta={'message': 'No sentences to merge', 'total_segments': 0}) # Success, as nothing to do
            return {'status': 'Success', 'message': 'No sentences to merge', 'total_segments': 0}

        all_audios_generated = True
        sentence_audio_paths = []
        sentence_audio_objects = [] # To store {sentence, audio_record, pydub_segment}

        self.update_state(state='PROGRESS', meta={
            'current_step': 'checking_sentence_audios',
            'total_sentences': len(sentences_in_order),
            'checked_sentences': 0,
            'message': 'Checking sentence audio files...'
        })

        for i, sentence_obj in enumerate(sentences_in_order):
            latest_audio_for_sentence = TtsAudio.query.filter_by(
                tts_sentence_id=sentence_obj.id,
                is_latest_for_sentence=True,
                audio_type='sentence_audio' # Ensure it's a sentence audio
            ).order_by(TtsAudio.created_at.desc()).first()

            if not latest_audio_for_sentence or sentence_obj.audio_status != 'generated':
                all_audios_generated = False
                logger.error(f"[MergeTask:{task_id}] Sentence {sentence_obj.id} (Order: {sentence_obj.order_index}) audio not generated or not found. Status: {sentence_obj.audio_status}")
                content.status = 'merge_failed_audio_missing'
                db.session.commit()
                self.update_state(state='FAILURE', meta={'error': f'Audio for sentence order {sentence_obj.order_index + 1} is not ready.'})
                return {'status': 'Error', 'message': f'Audio for sentence (Order: {sentence_obj.order_index + 1}) "{sentence_obj.sentence_text[:30]}..." is not ready.'}
            
            # Construct full path to the audio file
            storage_base_path = app.config.get('TTS_AUDIO_STORAGE_PATH', os.path.join(app.root_path, 'static', 'tts_audio'))
            audio_full_path = os.path.join(storage_base_path, latest_audio_for_sentence.file_path)
            
            if not os.path.exists(audio_full_path):
                all_audios_generated = False
                logger.error(f"[MergeTask:{task_id}] Audio file {audio_full_path} for sentence {sentence_obj.id} not found on disk.")
                content.status = 'merge_failed_file_missing'
                db.session.commit()
                self.update_state(state='FAILURE', meta={'error': f'Audio file for sentence order {sentence_obj.order_index + 1} missing on disk.'})
                return {'status': 'Error', 'message': f'Audio file for sentence (Order: {sentence_obj.order_index + 1}) missing on disk.'}

            sentence_audio_paths.append(audio_full_path)
            sentence_audio_objects.append({
                'sentence_id': str(sentence_obj.id),
                'order_index': sentence_obj.order_index,
                'text_ref': sentence_obj.sentence_text,
                'audio_record': latest_audio_for_sentence, # Keep the DB record for duration etc.
                'file_path': audio_full_path
            })
            self.update_state(state='PROGRESS', meta={
                'current_step': 'checking_sentence_audios',
                'total_sentences': len(sentences_in_order),
                'checked_sentences': i + 1,
                'message': f'Checked audio for sentence {i+1}/{len(sentences_in_order)}'
            })

        if not all_audios_generated: # Should have been caught above, but as a safeguard
            return # Already handled

        logger.info(f"[MergeTask:{task_id}] All {len(sentence_audio_paths)} sentence audios are ready for merging.")
        content.status = 'merging_audio'
        db.session.commit()

        merged_sound = None
        current_total_duration_ms = 0
        new_segments_data = []

        self.update_state(state='PROGRESS', meta={
            'current_step': 'merging_files',
            'total_sentences': len(sentence_audio_objects),
            'merged_count': 0,
            'message': 'Starting audio file concatenation...'
        })

        try:
            for i, audio_info in enumerate(sentence_audio_objects):
                try:
                    # pydub will infer format from extension, or you can specify format
                    segment_sound = AudioSegment.from_file(audio_info['file_path'])
                except CouldntDecodeError:
                    logger.error(f"[MergeTask:{task_id}] Could not decode audio file: {audio_info['file_path']}. Skipping or failing.")
                    content.status = f'merge_failed_decode_error_sent_{audio_info["order_index"]+1}'
                    db.session.commit()
                    self.update_state(state='FAILURE', meta={'error': f'Could not decode audio for sentence order {audio_info["order_index"] + 1}'})
                    return {'status': 'Error', 'message': f'Error decoding audio for sentence {audio_info["order_index"] + 1}'}


                segment_duration_ms = len(segment_sound) # Duration in milliseconds

                start_time_ms = current_total_duration_ms
                end_time_ms = current_total_duration_ms + segment_duration_ms

                new_segments_data.append({
                    'tts_sentence_id': audio_info['sentence_id'],
                    'original_order_index': audio_info['order_index'],
                    'original_sentence_text_ref': audio_info['text_ref'],
                    'start_ms': start_time_ms,
                    'end_ms': end_time_ms,
                    'duration_ms': segment_duration_ms
                })

                if merged_sound is None:
                    merged_sound = segment_sound
                else:
                    merged_sound = merged_sound + segment_sound
                
                current_total_duration_ms = end_time_ms
                
                self.update_state(state='PROGRESS', meta={
                    'current_step': 'merging_files',
                    'total_sentences': len(sentence_audio_objects),
                    'merged_count': i + 1,
                    'message': f'Merged sentence {i+1}/{len(sentence_audio_objects)}. Current duration: {current_total_duration_ms / 1000:.2f}s'
                })

            if merged_sound is None:
                logger.warning(f"[MergeTask:{task_id}] No audio segments were actually merged (e.g., empty list).")
                content.status = 'merge_failed_no_segments_processed'
                db.session.commit()
                self.update_state(state='SUCCESS', meta={'message': 'No audio segments to merge.'})
                return {'status': 'Success', 'message': 'No audio segments processed.'}

            # Mark previous merged audios for this content as not latest
            TtsAudio.query.filter_by(
                training_content_id=content.id,
                audio_type='merged_audio',
                is_latest_for_content=True
            ).update({'is_latest_for_content': False})

            # Determine new version for the merged audio
            latest_merged_version_obj = TtsAudio.query.with_entities(func.max(TtsAudio.version)).filter_by(
                training_content_id=content.id, audio_type='merged_audio'
            ).scalar()
            new_merged_version = (latest_merged_version_obj or 0) + 1

            # Save the merged audio file
            # 1. 保存合并后的音频文件 (这部分逻辑不变)
            logger.info(f"[MergeTask:{task_id}] 准备保存合并后的音频文件...")
            merged_relative_path, merged_file_size = _save_merged_audio_file(merged_sound, content.id, new_merged_version)
            logger.info(f"[MergeTask:{task_id}] 合并音频已保存，相对路径: {merged_relative_path}")

            # 2. 生成SRT文件内容
            srt_content_lines = []
            logger.info(f"[MergeTask:{task_id}] 正在生成SRT内容...")
            for i, segment_data in enumerate(new_segments_data):
                srt_content_lines.append(str(i + 1))
                start_time_srt = format_ms_to_srt_time(segment_data['start_ms'])
                end_time_srt = format_ms_to_srt_time(segment_data['end_ms'])
                srt_content_lines.append(f"{start_time_srt} --> {end_time_srt}")
                # 使用 segment 中记录的文本引用
                srt_content_lines.append(segment_data['original_sentence_text_ref'] or '')
                srt_content_lines.append('') # 每个字幕块后的空行
            
            srt_content = "\n".join(srt_content_lines)
            logger.info(f"[MergeTask:{task_id}] SRT内容已生成，共 {len(new_segments_data)} 条字幕。")


            # 3. 准备写入 .txt 文件
            storage_base_path = app.config.get('TTS_AUDIO_STORAGE_PATH')
            if not storage_base_path:
                raise ValueError("配置错误: TTS_AUDIO_STORAGE_PATH 未设置。")

            srt_txt_relative_path = os.path.splitext(merged_relative_path)[0] + '.txt'
            srt_txt_full_path = os.path.join(storage_base_path, srt_txt_relative_path)
            
            logger.info(f"[MergeTask:{task_id}] 准备将SRT内容写入TXT文件。")
            logger.info(f"[MergeTask:{task_id}]   - 基础存储路径: {storage_base_path}")
            logger.info(f"[MergeTask:{task_id}]   - 最终完整路径: {srt_txt_full_path}")

            # 确保目标目录存在
            srt_txt_dir = os.path.dirname(srt_txt_full_path)
            if not os.path.exists(srt_txt_dir):
                logger.info(f"[MergeTask:{task_id}] 目标目录不存在，正在创建: {srt_txt_dir}")
                os.makedirs(srt_txt_dir, exist_ok=True)
            
            # 写入文件
            try:
                with open(srt_txt_full_path, 'w', encoding='utf-8') as f:
                    f.write(srt_content)
                logger.info(f"[MergeTask:{task_id}] 成功！TXT字幕文件已写入磁盘。")
                
                # 验证文件是否真的创建成功
                if not os.path.exists(srt_txt_full_path):
                     logger.error(f"[MergeTask:{task_id}] 严重错误：文件写入后，os.path.exists() 检查失败！路径: {srt_txt_full_path}")
                else:
                     logger.info(f"[MergeTask:{task_id}] os.path.exists() 确认文件已在磁盘上。")
                     
            except (IOError, OSError) as e_write:
                logger.error(f"[MergeTask:{task_id}] 写入TXT文件时发生IO错误: {e_write}", exc_info=True)
                raise  # 将异常重新抛出，让外层 aiohttp.hdrs.TEcatch 块处理

            # Create TtsAudio record for the new merged file
            new_merged_audio_record = TtsAudio(
                training_content_id=content.id,
                audio_type='merged_audio',
                file_path=merged_relative_path,
                duration_ms=current_total_duration_ms,
                file_size_bytes=merged_file_size,
                tts_engine="SystemMerge", # Or a more descriptive name
                version=new_merged_version,
                is_latest_for_content=True
            )
            db.session.add(new_merged_audio_record)
            db.session.flush() # Get the ID for new_merged_audio_record

            # Create MergedAudioSegment records
            for seg_data in new_segments_data:
                segment_entry = MergedAudioSegment(
                    merged_audio_id=new_merged_audio_record.id,
                    **seg_data
                )
                db.session.add(segment_entry)
            
            content.status = 'audio_merge_complete'
            db.session.commit()

            logger.info(f"[MergeTask:{task_id}] Audio merge successful for content {content.id}. New merged audio ID: {new_merged_audio_record.id}")
            self.update_state(state='SUCCESS', meta={
                'message': 'Audio merge successful!',
                'merged_audio_id': str(new_merged_audio_record.id),
                'total_duration_ms': current_total_duration_ms,
                'total_segments': len(new_segments_data)
            })
            return {
                'status': 'Success',
                'message': 'Audio merge successful!',
                'merged_audio_id': str(new_merged_audio_record.id),
                'total_duration_ms': current_total_duration_ms,
                'num_segments': len(new_segments_data)
            }

        except Exception as e:
            db.session.rollback()
            logger.error(f"[MergeTask:{task_id}] Error during audio merging process for {content.id}: {e}", exc_info=True)
            content.status = 'merge_failed_exception'
            db.session.commit()
            self.update_state(state='FAILURE', meta={'error': str(e), 'exc_type': type(e).__name__})
            return {'status': 'Error', 'message': f'Merging process failed: {str(e)}'}

@celery_app.task(bind=True, name='tasks.analyze_video_script_task')
def analyze_video_script_task(self, synthesis_id_str):
    app = create_flask_app_for_task()
    with app.app_context():
        synthesis_task = VideoSynthesis.query.get(synthesis_id_str)
        if not synthesis_task:
            # ... 错误处理
            return {'status': 'Error', 'message': '任务记录未找到'}

        try:
            # 1. 获取输入内容
            # 假设 srt_file_path 和 ppt_pdf_path 存储的是服务器上的完整路径
            with open(synthesis_task.srt_file_path, 'r', encoding='utf-8') as f:
                srt_content = f.read()
            
            pdf_summary = extract_text_from_pdf(synthesis_task.ppt_pdf_path)

            # 2. 调用新的专用LLM函数
            video_script_json = generate_video_script(
                srt_content=srt_content,
                pdf_summary=pdf_summary,
                prompt_identifier='VIDEO_SCRIPT_GENERATION', # 使用新的Prompt标识符
                user_id=synthesis_task.training_content.uploaded_by_user_id # 传递用户ID
            )
            
            # 3. 更新数据库
            synthesis_task.video_script_json = video_script_json
            synthesis_task.status = 'analysis_complete'
            db.session.commit()
            
            return {'status': 'Success', 'synthesis_id': synthesis_id_str}

        except Exception as e:
            db.session.rollback()
            synthesis_task.status = 'error_analysis'
            db.session.commit()
            logger.error(f"视频脚本分析任务失败 (ID: {synthesis_id_str}): {e}", exc_info=True)
            self.update_state(state='FAILURE', meta={'exc_type': type(e).__name__, 'exc_message': str(e)})
            return {'status': 'Error', 'message': str(e)}

# --- 新增：PDF 解析辅助函数 ---
def extract_text_from_pdf(pdf_path: str) -> str:
    """
    从PDF文件中提取每页的主要文本内容，生成一个带页码的文本大纲。
    这个大纲将作为输入给LLM。
    """
    summary_lines = []
    try:
        doc = fitz.open(pdf_path)
        summary_lines.append(f"PDF文件共有 {len(doc)} 页。")
        
        for page_num, page in enumerate(doc):
            # 提取文本块，并按位置排序，这有助于保持阅读顺序
            blocks = page.get_text("blocks")
            blocks.sort(key=lambda b: (b[1], b[0])) # 按 y, x 坐标排序
            
            page_text = "\n".join([block[4].strip() for block in blocks if block[4].strip()])
            
            # 为了给LLM更简洁的输入，我们可以只取每页的前N个字符作为摘要
            # 或者，您可以实现更复杂的逻辑，比如提取标题、要点等
            # 这里我们采用简化但有效的方式：提供页码和清理后的文本
            if page_text:
                summary_lines.append(f"\n--- 第 {page_num + 1} 页 内容开始 ---")
                summary_lines.append(page_text)
                summary_lines.append(f"--- 第 {page_num + 1} 页 内容结束 ---")

        doc.close()
        return "\n".join(summary_lines)
    except Exception as e:
        logger.error(f"解析PDF文件失败: {pdf_path}, 错误: {e}", exc_info=True)
        # 即使解析失败，也返回一个错误信息，而不是让任务崩溃
        return f"错误：无法解析PDF文件 '{os.path.basename(pdf_path)}'。"


# # <<<--- 新增：用于解析 FFMPEG 进度的 Logger 和 Handler ---<<<
# # 创建一个线程局部变量来存储当前任务实例 self
# task_self = threading.local()
# class CeleryProgressHandler(logging.Handler):
#     """一个自定义的日志处理器，用于捕获和解析 ffmpeg 的进度，并更新 Celery 任务状态。"""
#     def __init__(self):
#         super().__init__()
#         # 正则表达式用于匹配 tqdm/ffmpeg 的进度行，例如: "frame= 123 ..." 或 "  2%|..."
#         # 我们主要关注百分比
#         self.percent_regex = re.compile(r"(\d+)\%")

#     def emit(self, record):
#         if not hasattr(task_self, 'instance') or task_self.instance is None:
#             return

#         msg = self.format(record)
#         match = self.percent_regex.search(msg)
#         if match:
#             percent = int(match.group(1))
            
#             # 使用 self.instance 来调用 update_state
#             task_self.instance.update_state(
#                 state='PROGRESS',
#                 meta={
#                     'current_step': 'encoding_video',
#                     'progress': percent,
#                     'message': f'视频编码中... {percent}%'
#                 }
#             )

# def get_moviepy_logger():
#     """创建一个配置了自定义处理器的 logger 供 moviepy 使用。"""
#     moviepy_logger = logging.getLogger("moviepy_progress")
#     moviepy_logger.setLevel(logging.INFO)
#     # 清除可能存在的旧handler，防止重复打印
#     if moviepy_logger.hasHandlers():
#         moviepy_logger.handlers.clear()
#     moviepy_logger.addHandler(CeleryProgressHandler())
#     return moviepy_logger
# ----------------------------------------------------->>>

task_context = threading.local()
# --- 新增：自定义日志处理器，用于解析 FFMPEG 进度 ---
class CeleryProgressLogger:
    """
    一个更健壮的自定义日志处理器，用于捕获 moviepy/ffmpeg 的进度
    并更新 Celery 任务状态。
    """
    def __init__(self, task, total_duration):
        self.task = task
        self.total_duration = total_duration
        self.logger = get_task_logger(__name__)
        self.duration_regex = re.compile(r"time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})")
        self.last_update_time = 0
        self.last_progress = 0

    def __call__(self, *args, **kwargs):
        # 这个 __call__ 方法保持不变
        line = None
        if 'message' in kwargs:
            line = kwargs['message']
            mapped_progress = self.last_progress
            if 'writing audio' in line.lower(): mapped_progress = 46 # 音频写入阶段
            elif 'building video' in line.lower(): mapped_progress = 48 # 视频构建阶段
            self.task.update_state(
                state='PROGRESS',
                meta={'current_step': 'encoding_video', 'progress': mapped_progress, 'message': line}
            )
            return
        elif len(args) >= 2 and args[0] == 'bar':
            line = args[1]
        
        if not line: return

        current_time = time.time()
        if current_time - self.last_update_time < 1: return

        match = self.duration_regex.search(line)
        if match and self.total_duration > 0:
            try:
                hours, minutes, seconds, hundredths = map(int, match.groups())
                processed_seconds = hours * 3600 + minutes * 60 + seconds + hundredths / 100.0
                percent = (processed_seconds / self.total_duration) * 100
                mapped_progress = 50 + int((percent / 100) * 45)
                self.last_progress = mapped_progress
                self.task.update_state(
                    state='PROGRESS',
                    meta={'current_step': 'encoding_video', 'progress': min(mapped_progress, 95), 'message': f'视频编码合成中... {int(percent)}%'}
                )
                self.last_update_time = current_time
            except Exception as e:
                self.logger.warning(f"解析 FFMPEG 进度行失败: {line} - 错误: {e}")

    def bars_callback(self, bar, attr, value, old_value=None):
        pass

    # --- 新增：实现 iter_bar 方法 ---
    def iter_bar(self, **kwargs):
        """
        终极版 iter_bar，可以处理 moviepy 的多种调用方式：
        - logger.iter_bar(chunk=..., total=...)  (用于音频)
        - logger.iter_bar(t=...)                 (用于视频)
        """
        # 判断是音频迭代还是视频迭代
        iterable = kwargs.get('chunk') or kwargs.get('t')
        if iterable is None:
            # 如果没有可迭代的对象，直接返回一个空迭代器，避免崩溃
            return
        
        total = kwargs.get('total', len(iterable))
        
        for i, elt in enumerate(iterable):
            yield elt
            
            # 限制更新频率
            current_time = time.time()
            if current_time - self.last_update_time < 1:
                continue

            if total > 0:
                percent = (i + 1) / total * 100
                
                # 根据迭代的参数名判断是音频还是视频阶段
                if 'chunk' in kwargs: # 音频处理
                    mapped_progress = 45 + int((percent / 100) * 5) # 映射到 45-50%
                    message = f'步骤 4.5: 正在处理音频... {int(percent)}%'
                else: # 视频处理 (t in kwargs)
                    mapped_progress = 50 + int((percent / 100) * 45) # 映射到 50-95%
                    message = f'视频编码合成中... {int(percent)}%'

                self.last_progress = mapped_progress
                self.task.update_state(
                    state='PROGRESS',
                    meta={
                        'current_step': 'encoding_video', # 统一阶段名
                        'progress': min(mapped_progress, 95),
                        'message': message
                    }
                )
                self.last_update_time = current_time

# --- 视频合成任务 ---<<<
@celery_app.task(bind=True, name='tasks.synthesize_video_task')
def synthesize_video_task(self, synthesis_id_str):
    task_context.task_instance = self # 存储任务实例供 logger 使用
    app = create_flask_app_for_task()
    with app.app_context():
        task_id = self.request.id
        logger.info(f"[VideoSynthTask:{task_id}] ------------------------------------------")
        logger.info(f"[VideoSynthTask:{task_id}] 开始视频合成任务 for Synthesis ID: {synthesis_id_str}")
        
        synthesis_task = VideoSynthesis.query.get(synthesis_id_str)
        if not synthesis_task:
            logger.error(f"[VideoSynthTask:{task_id}] 任务记录未找到。")
            return {'status': 'Error', 'message': '任务记录未找到'}

        try:
            # 1. 准备素材路径
            self.update_state(state='PROGRESS', meta={'current_step': 'prepare_assets', 'progress': 0, 'message': '步骤 1: 准备素材...'})
            pdf_path = synthesis_task.ppt_pdf_path
            audio_path = os.path.join(
                app.config.get('TTS_AUDIO_STORAGE_PATH'),
                synthesis_task.merged_audio.file_path
            )
            video_scripts = synthesis_task.video_script_json.get('video_scripts', [])
            logger.info(f"[VideoSynthTask:{task_id}]   - PDF路径: {pdf_path}")
            logger.info(f"[VideoSynthTask:{task_id}]   - 音频路径: {audio_path}")
            
            if not os.path.exists(pdf_path) or not os.path.exists(audio_path):
                raise FileNotFoundError("PDF或音频素材文件不存在。")

            # 2. 将PDF转换为图片
            logger.info(f"[VideoSynthTask:{task_id}] 步骤 2: 将PDF转换为图片...")
            self.update_state(state='PROGRESS', meta={'current_step': 'pdf_conversion', 'progress': 10, 'message': '步骤 2: 正在将PDF转换为图片...'})
            

            pdf_images_dir = os.path.join(os.path.dirname(pdf_path), 'images')
            os.makedirs(pdf_images_dir, exist_ok=True)
            images = convert_from_path(pdf_path, output_folder=pdf_images_dir, fmt='png', output_file='slide_')
            
            def get_page_number_from_filename(filename):
                """使用正则表达式从文件名中安全地提取页码。"""
                # 匹配 'slide_' 之后的一串或多串由连字符连接的数字中的第一个数字
                # 例如，从 'slide_0001-01.png' 中匹配到 '0001'
                match = re.search(r'slide_(\d+)', os.path.basename(filename))
                if match:
                    return int(match.group(1))
                # 如果上面的正则没匹配到，尝试一个更宽松的，只找数字
                match_fallback = re.search(r'(\d+)', os.path.basename(filename))
                if match_fallback:
                    return int(match_fallback.group(1))
                # 如果完全找不到数字，返回一个极大值，让它排在最后，避免排序崩溃
                return float('inf')

            # 使用新的、更健壮的 key 函数进行排序
            image_paths = sorted([img.filename for img in images], key=get_page_number_from_filename)
            
            # image_paths = sorted([img.filename for img in images], key=lambda x: int(os.path.basename(x).split('_')[1].split('.')[0]))
            logger.info(f"[VideoSynthTask:{task_id}] 已成功转换 {len(image_paths)} 页PDF。")
            self.update_state(state='PROGRESS', meta={'current_step': 'pdf_conversion', 'message': f'已成功转换 {len(image_paths)} 页PDF。'})
            
            
            # 3. 加载音频
            self.update_state(state='PROGRESS', meta={'current_step': 'clips_creation', 'progress': 20, 'message': '步骤 3: 正在创建视频剪辑...'})
            audio_clip = AudioFileClip(audio_path)
            
            # 4. 创建视频剪辑
            clips = []
            # 使用第一张图片来确定视频的初始尺寸
            first_image_path = image_paths[0]
            with Image.open(first_image_path) as img:
                initial_width, initial_height = img.size

            
            # 确保视频尺寸的宽和高都是偶数
            width = initial_width if initial_width % 2 == 0 else initial_width - 1
            height = initial_height if initial_height % 2 == 0 else initial_height - 1
            video_size = (width, height)
            
            if (width != initial_width) or (height != initial_height):
                logger.warning(
                    f"[VideoSynthTask:{self.request.id}] 视频尺寸已从 "
                    f"({initial_width}x{initial_height}) 调整为 ({width}x{height}) 以满足编码器要求。"
                )
            else:
                logger.info(f"[VideoSynthTask:{self.request.id}] 视频标准尺寸确定为: {video_size}")
            
            self.update_state(state='PROGRESS', meta={'current_step': 'audio_loading', 'message': '步骤 3: 正在加载音频...'})

            for script_item in video_scripts:
                ppt_page_num = script_item['ppt_page']
                time_range_str = script_item['time_range']
                
                # 解析时间范围
                start_str, end_str = [t.strip() for t in time_range_str.split('~')]
                start_seconds = sum(x * float(t) for x, t in zip([3600, 60, 1], start_str.replace(',', '.').split(':')))
                end_seconds = sum(x * float(t) for x, t in zip([3600, 60, 1], end_str.replace(',', '.').split(':')))
                duration = end_seconds - start_seconds
                
                if duration <= 0: continue

                image_path_index = ppt_page_num - 1
                if 0 <= image_path_index < len(image_paths):
                    img_path = image_paths[image_path_index]
                    logger.debug(f"[VideoSynthTask:{task_id}]   - 处理剪辑: 页码 {ppt_page_num}, 路径 {img_path}, 时长 {duration}s")
                    
                    # <<<--- 关键修改：预处理图片 ---<<<
                    # 1. 用Pillow打开图片
                    with Image.open(img_path) as pil_img:
                        # 2. 确保它是RGB格式 (移除alpha通道)
                        rgb_img = pil_img.convert('RGB')
                        # 3. 将Pillow图像对象转换为Numpy数组
                        img_array = np.array(rgb_img)
                    
                    # 4. 使用处理后的Numpy数组创建ImageClip
                    clip = ImageClip(img_array).set_duration(duration)
                    
                    # 5. (可选但推荐) 确保每个剪辑的尺寸都与标准尺寸一致
                    if clip.size != video_size:
                        clip = clip.resize(video_size)
                    # ----------------------------------->>>
                    
                    clips.append(clip)
            
            if not clips:
                raise ValueError("没有有效的视频剪辑可以拼接。")

            logger.info(f"[VideoSynthTask:{task_id}] 正在拼接 {len(clips)} 个视频剪辑...")
            self.update_state(state='PROGRESS', meta={'current_step': 'concatenation', 'progress': 40, 'message': f'正在拼接 {len(clips)} 个视频剪辑...'})
            

            final_video = concatenate_videoclips(clips, method="compose").set_audio(audio_clip)
            
            # --- 调试代码 ---
            IS_DEBUG_MODE = True 
            DEBUG_DURATION_SECONDS = 4
            final_video_to_write = final_video.subclip(0, DEBUG_DURATION_SECONDS) if IS_DEBUG_MODE else final_video
            # --------------

            self.update_state(state='PROGRESS', meta={'current_step': 'set_audio', 'message': '正在设置音频...'})
            # final_video = final_video.set_audio(audio_clip)
            
            # 5. 保存最终视频文件
            self.update_state(state='PROGRESS', meta={'current_step': 'encoding_video', 'progress': 50, 'message': '步骤 5: 开始视频编码...'})
            video_output_dir = os.path.join(current_app.instance_path, 'uploads', 'course_resources', str(synthesis_task.training_content.course_id))
            os.makedirs(video_output_dir, exist_ok=True)
            video_filename = f"{uuid.uuid4().hex}_{secure_filename(synthesis_task.training_content.content_name)}.mp4"
            video_save_path = os.path.join(video_output_dir, video_filename)
            
            buffersize = 2000 # 这是 moviepy 的默认值之一
            nbytes = 2 # 16-bit audio
            audio_fps = audio_clip.fps
            total_audio_chunks = int(audio_clip.duration * audio_fps / buffersize) + 1
            
            # 实例化 logger，但不需要手动计算音频块数，让 moviepy 在内部处理
            custom_logger = CeleryProgressLogger(self, final_video_to_write.duration)
            
            # 执行写入，移除 buffersize 参数
            final_video_to_write.write_videofile(
                video_save_path, 
                codec='libx264', 
                audio_codec='aac',
                threads=4, 
                fps=24,
                preset='medium',
                logger=custom_logger,
                ffmpeg_params=['-pix_fmt', 'yuv420p']
                # <<<--- 移除 'buffersize=buffersize' 参数 ---<<<
            )

            logger.info(f"[VideoSynthTask:{task_id}] 视频文件写入成功！")
            # --- 进度捕获逻辑结束 ---<<<
            # ----------------------------------------------------->>>

            logger.info(f"[VideoSynthTask:{self.request.id}] 视频文件写入成功！")
            
            # 6. 在 CourseResource 表中创建记录
            self.update_state(state='PROGRESS', meta={'current_step': 'saving_to_db', 'progress': 98, 'message': '步骤 6: 正在保存记录到数据库...'})
            course_id_str = str(synthesis_task.training_content.course_id)
            relative_file_path = os.path.join('uploads', 'course_resources', course_id_str, video_filename)

            new_resource = CourseResource(
                course_id=synthesis_task.training_content.course_id,
                name=f"{synthesis_task.training_content.content_name} (视频)",
                description=f"由 '{synthesis_task.training_content.content_name}' 内容自动合成的视频。",
                file_path=relative_file_path,
                file_type='video',
                mime_type='video/mp4',
                size_bytes=os.path.getsize(video_save_path),
                # duration_seconds=float(final_video.duration),
                duration_seconds=float(final_video_to_write.duration), 

                uploaded_by_user_id=synthesis_task.training_content.uploaded_by_user_id
            )
            db.session.add(new_resource)
            db.session.flush() # 获取新资源的ID

            # 7. 更新 VideoSynthesis 任务状态
            synthesis_task.status = 'complete'
            synthesis_task.generated_resource_id = new_resource.id
            db.session.commit()
            
            logger.info(f"[VideoSynthTask:{task_id}] 视频合成成功！新的资源ID: {new_resource.id}")
            return {'status': 'Success', 'resource_id': str(new_resource.id)}

        except Exception as e:
            db.session.rollback()
            synthesis_task.status = 'analysis_complete'
            db.session.commit()
            logger.error(f"视频合成任务失败 (ID: {synthesis_id_str}): {e}", exc_info=True)
            self.update_state(state='FAILURE', meta={'exc_type': type(e).__name__, 'exc_message': str(e)})
            return {'status': 'Error', 'message': str(e)}