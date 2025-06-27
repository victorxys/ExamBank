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
import mimetypes # <--- ++++++ 在这里添加导入 ++++++




from celery_worker import celery_app
from flask import current_app
from sqlalchemy import or_, func
import sqlalchemy as sa
from werkzeug.utils import secure_filename




from backend.extensions import db
from backend.models import TrainingContent, TtsScript, TtsSentence, TtsAudio, MergedAudioSegment, UserProfile, Exam, VideoSynthesis, CourseResource
from backend.api.ai_generate import generate_video_script # 导入新函数
from backend.api.ai_generate import generate_audio_with_gemini_tts # 导入新的 Gemini TTS 函数
from backend.api.ai_generate import get_active_llm_config_internal 
from .manager_module import get_next_identity
from .manager_module import reset_all_usage



import httpx # <<<--- 关键：导入httpx库



# 合成视频
import fitz  # PyMuPDF 库的导入名是 fitz
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
def _save_audio_file(audio_binary_content, training_content_id_str, sentence_id_str, version, extension=".wav"):
    app = create_flask_app_for_task()
    with app.app_context():
        storage_base_path = app.config.get('TTS_AUDIO_STORAGE_PATH', os.path.join(app.root_path, 'static', 'tts_audio'))
        relative_dir = os.path.join(str(training_content_id_str), str(sentence_id_str))
        full_dir_path = os.path.join(storage_base_path, relative_dir)
        os.makedirs(full_dir_path, exist_ok=True)
        
        timestamp_str = datetime.now().strftime("%Y%m%d%H%M%S%f")
        file_name = f"sentence_v{version}_{timestamp_str}{extension}" # <--- 使用 extension
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

@celery_app.task(
    bind=True, 
    name='tasks.generate_single_sentence_audio_async',
    # --- 主动限流：告诉Celery，这个类型的任务，每分钟最多只能执行10个 ---
    rate_limit='10/m', # "10/m" 表示每分钟10个。也可以是 "1/s" (每秒1个) 等。
    # 告诉Celery，当遇到httpx.HTTPStatusError时，自动重试
    autoretry_for=(httpx.HTTPStatusError, httpx.ReadTimeout, httpx.ProxyError), 
    # 指数退避策略：第一次重试等1秒，第二次等2秒，第三次等4秒...
    retry_backoff=True, 
    # 最长等待时间不超过1分钟
    retry_backoff_max=60, 
    # 最多重试5次
    max_retries=5,
    # 如果重试5次后依然失败，不要再尝试了
    retry_jitter=True # 防止所有任务在同一时刻重试
)
def generate_single_sentence_audio_async(self, sentence_id_str, tts_engine_identifier="gradio_default", pt_file_path_relative=None, tts_engine_params=None, override_config=None):
# def generate_single_sentence_audio_async(self, sentence_id_str, override_config=None):

    # ... (这个任务的完整实现，如之前调试好的那样，它内部处理 Gradio 和 Gemini TTS 调用) ...
    # 它应该返回类似 {'status': 'Success', 'audio_id': ..., 'file_path': ...}
    # 或者 {'status': 'Error', 'message': ...}
    app = create_flask_app_for_task() # 这里定义 create_flask_app_for_task
    with app.app_context():
        sentence = TtsSentence.query.get(sentence_id_str)
        if not sentence:
            logger.error(f"GenerateAudio Task: 句子 {sentence_id_str} 未找到。")
            self.update_state(state='FAILURE', meta={'exc_type': 'ValueError', 'exc_message': '句子未找到'})
            return {'status': 'Error', 'message': '句子未找到'}

        training_content = sentence.tts_script.training_content
        if not training_content:
            logger.error(f"GenerateAudio Task: 未找到句子 {sentence_id_str} 关联的 training_content。")
            self.update_state(state='FAILURE', meta={'exc_type': 'ValueError', 'exc_message': '未找到关联的培训内容'})
            return {'status': 'Error', 'message': '未找到关联的培训内容'}

        # --- 核心：配置解析逻辑 ---
        final_config = {}
        # 1. 从App配置加载系统默认值
        final_config.update(current_app.config.get('DEFAULT_TTS_CONFIG', {})) # 假设你在app.py中定义了DEFAULT_TTS_CONFIG
        # 2. 从TrainingContent加载全局配置
        if training_content.default_tts_config:
            final_config.update(training_content.default_tts_config)
        # 3. 从TtsSentence加载单句特定配置
        if sentence.tts_config:
            final_config.update(sentence.tts_config)
        # 4. 使用API传入的临时配置覆盖
        if override_config and isinstance(override_config, dict):
            final_config.update(override_config)
        
        logger.info(f"[AudioTask:{self.request.id}] Sentence {sentence_id_str} | Final TTS Config: {final_config}")

        try:
            sentence.audio_status = 'generating'
            db.session.commit()

            audio_binary_content = None
            output_audio_mime_type = "audio/mpeg" 
            actual_generation_params_for_log = {}

            if tts_engine_identifier == "gemini_tts":
                logger.info(f"GenerateAudio Task: Using Gemini TTS for sentence {sentence_id_str}")
                
                # ++++++++++++++++ 集成代理和密钥管理器 (最终版) ++++++++++++++++
                # 1. 从 current_app 获取全局的管理器实例
                # manager = current_app.proxy_key_manager
                # manager = proxy_key_manager

                # # 2. 向管理器请求下一个可用的 "身份"
                # identity = manager.get_next_identity()

                tts_engine = final_config.get('engine', 'gemini') # 默认使用gemini
                text_to_speak = final_config.get('system_prompt', '') + sentence.sentence_text
                identity = get_next_identity() # 代理和密钥轮询
                proxy_url = identity['proxy_url']
                api_key_name = identity['id']
                


            

                logger.info(f"Successfully retrieved identity '{api_key_name}' from manager.")
                # ++++++++++++++++ Celery 内部对照诊断 ++++++++++++++++
                logger.info("--- [诊断开始] 正在执行独立的 httpx 代理测试 ---")
                try:
                    test_url = "https://api.ipify.org?format=json"
                    transport = httpx.HTTPTransport(proxy=proxy_url)
                    mounts = {"all://": transport}
                    with httpx.Client(mounts=mounts, timeout=15.0) as client:
                        logger.info("[诊断] 独立的 httpx.Client 已创建，正在发送请求...")
                        response = client.get(test_url)
                        logger.info(f"[诊断] 独立的 httpx 请求已收到响应，状态码: {response.status_code}")
                        if response.status_code == 200:
                            logger.info(f"✅ [诊断成功] 独立的 httpx 调用{api_key_name}成功！响应: {response.json()}")
                        else:
                            logger.error(f"❌ [诊断失败] 独立的 httpx 调用失败！状态码: {response.status_code}")
                except Exception as e:
                    logger.error(f"❌ [诊断失败] 独立的 httpx 调用{api_key_name}时发生致命错误: {type(e).__name__}: {e}", exc_info=True)
                    # 诊断失败后，可以选择直接返回，不再继续执行
                    # raise e # 或者重新抛出异常，让Celery重试
                logger.info("--- [诊断结束] ---")
                # ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

                
                # 配置Gemini TTS 参数
                # gemini_voice = tts_engine_params.get("voice_name","Kore") 
                # gemini_temp = tts_engine_params.get("temperature", 0.5) 
                # gemini_model_name = tts_engine_params.get("model", "gemini-2.5-pro-preview-tts")
                # gemini_model_name = tts_engine_params.get("model", "gemini-2.5-flash-preview-tts")
                # --- 调用您真正的业务逻辑 ---
                logger.info("--- [业务逻辑开始] 正在调用 generate_audio_with_gemini_tts ---")

                audio_binary_content, output_audio_mime_type = generate_audio_with_gemini_tts(
                    text_to_speak=text_to_speak,
                    api_key=identity['api_key'],
                    model_name=final_config.get('model', 'gemini-2.5-flash-preview-tts'),
                    voice_name=final_config.get('voice_name',"Kore"),
                    temperature=final_config.get('temperature', 0.1),
                    proxy_url=identity['proxy_url']
                )
                final_config['api_key_name_used'] = identity['id'] # 记录使用的key
                logger.info("--- [业务逻辑结束] 调用 generate_audio_with_gemini_tts 成功 ---")

                actual_generation_params_for_log = {
                    "engine": "gemini_tts", 
                    "voice_name": final_config.get('voice_name',"Kore"), 
                    "temperature": final_config.get('temperature', 0.1), 
                    "model": final_config.get('model', 'gemini-2.5-flash-preview-tts'), 
                    "api_key_name": api_key_name, # 记录我们用了哪个Key
                    "proxy_used": proxy_url       # 记录我们用了哪个代理
                }
                # actual_generation_params_for_log = {"engine": "gemini_tts", "voice_name": gemini_voice, "temperature": gemini_temp, "model": gemini_model_name, "api_key_name": gemini_api_key_name}
            
            elif tts_engine_identifier == "gradio_default":
                logger.info(f"GenerateAudio Task: Using Gradio TTS for sentence {sentence_id_str}")
                tts_service_base_url = app.config.get('TTS_SERVICE_BASE_URL', "http://test.mengyimengsao.com:37860/")
                gradio_tts_client = GradioClient(src=tts_service_base_url)
                default_gradio_params = current_app.config['DEFAULT_GRADIO_PARAMS'] # 确保在当前应用上下文中设置
                gradio_predict_params = {**default_gradio_params, **(tts_engine_params or {})}
                
                pt_file_to_send_to_gradio = None
                absolute_pt_file_path_for_log = None
                if pt_file_path_relative:
                    pt_folder = os.path.join(app.root_path, 'static', 'tts_pt')
                    absolute_pt_file_path = os.path.join(pt_folder, pt_file_path_relative)
                    
                    if os.path.exists(absolute_pt_file_path):
                        logger.info(f"[SingleAudioTask] 使用指定的音色文件: {absolute_pt_file_path}")
                        default_gradio_params['pt_file'] = {
                            "path": absolute_pt_file_path,
                            "meta": {"_type": "gradio.FileData"}
                        }
                    else:
                        logger.warning(f"[SingleAudioTask] 指定的音色文件不存在: {absolute_pt_file_path}，将使用默认音色。")
                else:
                    logger.info(f"[SingleAudioTask] 未指定音色文件，使用默认音色。")
                
                job_result = gradio_tts_client.predict(
                    text_file=sentence.sentence_text,
                    **gradio_predict_params,
                    api_name="/generate_tts_audio"
                )
                
                # --- 从 job_result 中提取 audio_binary_content 和 output_audio_mime_type ---
                if isinstance(job_result, tuple) and len(job_result) > 0:
                    output_component = job_result[0]
                    if isinstance(output_component, dict) and output_component.get("is_file") and output_component.get("name"):
                        audio_file_path_from_gradio = output_component["name"]
                        if os.path.exists(audio_file_path_from_gradio):
                            with open(audio_file_path_from_gradio, 'rb') as af:
                                audio_binary_content = af.read()
                        # 尝试从文件名猜测MIME类型，如果Gradio不直接返回
                        output_audio_mime_type = mimetypes.guess_type(audio_file_path_from_gradio)[0] or "audio/wav"
                    elif isinstance(output_component, str) and output_component.startswith("data:audio/"):
                        header, encoded = output_component.split(",", 1)
                        audio_binary_content = base64.b64decode(encoded)
                        output_audio_mime_type = header.split(":")[1].split(";")[0]
                elif isinstance(job_result, str) and os.path.exists(job_result): # 如果直接返回有效路径
                     audio_file_path_from_gradio = job_result
                     with open(audio_file_path_from_gradio, 'rb') as af:
                         audio_binary_content = af.read()
                     output_audio_mime_type = mimetypes.guess_type(audio_file_path_from_gradio)[0] or "audio/wav"

                # --------------------------------------------------------------------
                actual_generation_params_for_log = {
                    **gradio_predict_params, 
                    "engine": "gradio_default", 
                    "pt_file_used": absolute_pt_file_path_for_log
                }
                if "pt_file" in actual_generation_params_for_log and actual_generation_params_for_log["pt_file"] is not None:
                    # 只记录路径，而不是 FileData 对象
                    actual_generation_params_for_log["pt_file_path"] = absolute_pt_file_path_for_log
                    del actual_generation_params_for_log["pt_file"]


            else:
                raise ValueError(f"未知的 TTS 引擎标识符: {tts_engine_identifier}")

            if not audio_binary_content:
                raise Exception("未能从所选的TTS引擎获取有效的音频内容")

            TtsAudio.query.filter_by(tts_sentence_id=sentence.id, is_latest_for_sentence=True).update({'is_latest_for_sentence': False})
            new_version = 1
            latest_audio_for_sentence = TtsAudio.query.filter_by(tts_sentence_id=sentence.id).order_by(TtsAudio.version.desc()).first()
            if latest_audio_for_sentence:
                new_version = latest_audio_for_sentence.version + 1
            
            file_extension = mimetypes.guess_extension(output_audio_mime_type) or ".mp3"
            if output_audio_mime_type == "audio/wav": file_extension = ".wav"
                
            relative_path, file_size = _save_audio_file(audio_binary_content, training_content.id, sentence.id, new_version, file_extension)

            new_audio_record = TtsAudio(
                tts_sentence_id=sentence.id,
                training_content_id=training_content.id,
                audio_type='sentence_audio',
                file_path=relative_path,
                file_size_bytes=file_size,
                tts_engine=tts_engine_identifier,
                voice_name=actual_generation_params_for_log.get("voice_name") or actual_generation_params_for_log.get("roleid") or "default",
                generation_params=final_config,
                version=new_version,
                is_latest_for_sentence=True,
            )
            db.session.add(new_audio_record)
            sentence.audio_status = 'generated'
            db.session.commit()
            logger.info(f"GenerateAudio Task (Engine: {tts_engine_identifier}): 句子 {sentence_id_str} 的音频 (ID: {new_audio_record.id}) 已成功生成并保存。")
            return {'status': 'Success', 'audio_id': str(new_audio_record.id), 'file_path': relative_path, 'mime_type': output_audio_mime_type}

        except Exception as e:
            logger.error(f"GenerateAudio Task: Exception for sentence {sentence_id_str} (Engine: {tts_engine_identifier}): {e}", exc_info=True)
            if sentence: 
                sentence.audio_status = 'error_generation'
                db.session.commit()
            self.update_state(state='FAILURE', meta={'exc_type': type(e).__name__, 'exc_message': str(e)})
            return {'status': 'Error', 'message': f'生成单句语音 ({tts_engine_identifier}) 时发生服务器错误: ' + str(e)}
        


@celery_app.task(bind=True, name='tasks.batch_generate_audio_task', max_retries=1) # 保持原来的 name 或更新
def batch_generate_audio_task(self, final_script_id_str, 
                              tts_engine_identifier="gradio_default", # 新增：TTS 引擎标识符
                              pt_file_path_relative_for_gradio=None, # 新增：用于 Gradio 的 PT 文件路径
                              tts_engine_params_for_all=None):       # 新增：传递给每个子任务的引擎特定参数
    app = create_flask_app_for_task()
    with app.app_context():
        try: # 顶层 try-except 块，用于捕获批量任务本身的初始化错误
            final_script_id = uuid.UUID(final_script_id_str)
            logger.info(f"[BatchTask:{self.request.id}] 开始处理批量语音生成，脚本ID: {final_script_id}, 引擎: {tts_engine_identifier}")

            script = TtsScript.query.get(final_script_id)
            if not script or script.script_type != 'final_tts_script':
                # ... (错误处理和返回不变)
                return {'status': 'Error', 'message': '脚本未找到或类型不正确'}


            training_content = script.training_content
            if not training_content:
                # ... (错误处理和返回不变)
                return {'status': 'Error', 'message': '脚本没有关联的培训内容'}
            
            # 更新 TrainingContent 状态以反映批量任务正在进行
            # training_content.status = f'processing_batch_audio_{tts_engine_identifier}'
            # db.session.commit() # 可以考虑在这里或任务开始时提交一次

            sentences_to_process = TtsSentence.query.filter(
                TtsSentence.tts_script_id == final_script_id,
                sa.or_( # 使用 SQLAlchemy 的 or_
                    TtsSentence.audio_status == 'pending_generation',
                    TtsSentence.audio_status == 'error_generation',
                    TtsSentence.audio_status == 'pending_regeneration',
                    TtsSentence.audio_status == 'error_submission',
                    # TtsSentence.audio_status == 'error_polling', # 轮询错误可能不需要重试
                    # TtsSentence.audio_status == 'processing_request', # 如果任务卡住，可能需要处理
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


            logger.info(f"[BatchTask:{self.request.id}] 将为 {initially_to_process_count} 个句子派发语音生成子任务 (引擎: {tts_engine_identifier})")
            
            
            failed_to_submit_count = 0
            submitted_subtasks_info = [] # 用于存储 {sentence_id: ..., task_id: ...}
            
            # 更新 TrainingContent 状态为正在处理，并记录总数
            training_content.status = f'processing_batch_audio'
            # 可以考虑将总数、已处理数等也存到 TrainingContent 的某个JSON字段，如果需要持久化进度
            db.session.commit()

            # 更新Celery任务的初始meta
            self.update_state(state='PROGRESS', meta={
                'total_sentences': initially_to_process_count,
                'submitted_subtasks': 0,
                'message': f'准备派发 {initially_to_process_count} 个语音生成子任务...'
            })

            for index, sentence in enumerate(sentences_to_process):
                sentence_id_str_for_subtask = str(sentence.id)
                try:
                    sentence.audio_status = 'queued_for_generation' 
                    db.session.commit()

                    pt_file_for_this_subtask = pt_file_path_relative_for_gradio if tts_engine_identifier == "gradio_default" else None
                    
                    sub_task = generate_single_sentence_audio_async.delay(
                        sentence_id_str=sentence_id_str_for_subtask,
                        tts_engine_identifier=tts_engine_identifier,
                        pt_file_path_relative=pt_file_for_this_subtask,
                        tts_engine_params=(tts_engine_params_for_all or {})
                    )
                    submitted_subtasks_info.append({ # <--- 收集子任务信息
                        "sentence_id": sentence_id_str_for_subtask,
                        "task_id": sub_task.id
                    })
                    logger.info(f"[BatchTask:{self.request.id}] ({index + 1}/{initially_to_process_count}) 为句子 {sentence.id} 提交了子任务 {sub_task.id} (引擎: {tts_engine_identifier})")
                    
                    self.update_state(state='PROGRESS', meta={
                        'total_sentences': initially_to_process_count,
                        'submitted_subtasks': len(submitted_subtasks_info),
                        'message': f'已派发 {len(submitted_subtasks_info)}/{initially_to_process_count} 个子任务...'
                    })

                except Exception as e_dispatch:
                    failed_to_submit_count += 1
                    logger.error(f"[BatchTask:{self.request.id}] 提交句子 {sentence.id} 的子任务失败: {e_dispatch}", exc_info=True)
                    sentence.audio_status = 'error_submission' # 标记提交失败
                    db.session.commit()
            
            final_message = f"批量语音生成任务已完成派发。总句子数: {initially_to_process_count}, 成功派发子任务数: {len(submitted_subtasks_info)}, 派发失败数: {failed_to_submit_count}."
            logger.info(f"[BatchTask:{self.request.id}] {final_message}")
            
            # 批量任务本身到这里算“执行完毕”（即所有子任务都已派发）
            # 最终状态由子任务的完成情况和后续轮询 TrainingContent 状态来决定
            # 但我们可以先标记 TrainingContent 的状态
            if failed_to_submit_count > 0 and len(submitted_subtasks_info) == 0:
                training_content.status = 'error_batch_submission_all_failed'
                final_task_status_celery = 'FAILURE'
            elif failed_to_submit_count > 0:
                training_content.status = 'warning_batch_submission_partial_failed'
                final_task_status_celery = 'SUCCESS' # 任务本身完成了派发，但有部分失败
            else:
                training_content.status = 'audio_generation_in_progress' # 或保持 processing_batch_audio
                final_task_status_celery = 'SUCCESS'
            db.session.commit()

            final_meta = {
                'total_sentences': initially_to_process_count,
                'submitted_subtasks': len(submitted_subtasks_info),
                'failed_to_submit': failed_to_submit_count,
                'message': final_message,
                'engine_used': tts_engine_identifier,
                'sub_tasks': submitted_subtasks_info # <--- 在最终 meta 中包含子任务信息
            }
            if failed_to_submit_count > 0 and len(submitted_subtasks_info) == 0:
                final_task_status_celery = 'FAILURE'
            else: # 即使部分派发失败，主任务也算部分成功完成了派发
                final_task_status_celery = 'SUCCESS'

            return {'status': final_task_status_celery, **final_meta}

        except Exception as e_batch_init: # 捕获批量任务初始化或早期错误
            logger.error(f"[BatchTask:{self.request.id}] 批量任务初始化失败: {e_batch_init}", exc_info=True)
            if 'training_content' in locals() and training_content:
                training_content.status = 'error_batch_processing_init'
                db.session.commit()
            self.update_state(state='FAILURE', meta={'error': str(e_batch_init)})
            return {'status': 'Error', 'message': f'批量语音生成任务失败: {str(e_batch_init)}'}

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
            # <<<--- 新增：重置所有相关句子的修改标记 ---<<<
            sentence_ids_in_script = [s.id for s in sentences_in_order]
            if sentence_ids_in_script:
                TtsSentence.query.filter(
                    TtsSentence.id.in_(sentence_ids_in_script)
                ).update({'modified_after_merge': False}, synchronize_session=False)
                logger.info(f"[MergeTask:{task_id}] 已重置 {len(sentence_ids_in_script)} 个句子的 'modified_after_merge' 标记。")
            # ------------------------------------------------->>>

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

            # 3.1 将pdf转为的图片并存储
            logger.info(f"[AnalyzeTask:{self.request.id}] 开始将PDF转换为预览图片...")
            
            # 定义图片存储目录
            # 使用 instance_path 确保路径在项目内，但通常不在版本控制中
            preview_image_dir_name = "preview_images"
            # synthesis_task.ppt_pdf_path 的目录是 instance/uploads/video_synthesis/{content_id}/
            base_dir = os.path.dirname(synthesis_task.ppt_pdf_path) 
            image_storage_path = os.path.join(base_dir, preview_image_dir_name)
            os.makedirs(image_storage_path, exist_ok=True)

            # 执行转换
            images = convert_from_path(
                synthesis_task.ppt_pdf_path,
                output_folder=image_storage_path,
                fmt='jpeg',  # 使用jpeg格式以减小文件大小
                output_file='slide_'
            )

            # 获取相对路径用于URL访问
            # Web访问路径应该是相对于 instance/uploads/ 的
            base_web_path = os.path.join('video_synthesis', str(synthesis_task.training_content_id), preview_image_dir_name)
            
            # 使用更健壮的方式排序和获取相对路径
            image_relative_paths = sorted(
                [os.path.join(base_web_path, os.path.basename(img.filename)) for img in images],
                key=lambda p: int(re.search(r'slide_(\d+)', os.path.basename(p)).group(1))
            )

            synthesis_task.ppt_image_paths = image_relative_paths # 保存路径列表
            logger.info(f"[AnalyzeTask:{self.request.id}] PDF转换完成，共 {len(image_relative_paths)} 张图片。")

            # 4. 更新任务状态
            synthesis_task.video_script_json = video_script_json # 直接保存
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
                raise FileNotFoundError(f"PDF或音频素材文件pdf_path: {pdf_path} 或audio_path: {audio_path}不存在。")

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
            IS_DEBUG_MODE = False 
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
                # ++++++++++++++++ 关键优化 ++++++++++++++++
                # 1. 将线程数设置为您CPU的核心数（原始为4）
                threads=10, 

                fps=24,
                # 2. (推荐) 使用更快的预设来减少CPU计算时间，会稍微影响画质的质量
                #    ultrafast > superfast > veryfast > faster > fast > medium
                #    可以先从 'fast' 或 'veryfast' 开始尝试
                preset='fast', 
                # preset='medium',
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
        


    



@celery_app.task(bind=True, name='tasks.merge_current_generated_audios_async', max_retries=1)
def merge_current_generated_audios_async(self, training_content_id_str):
    app = create_flask_app_for_task()
    with app.app_context():
        content = TrainingContent.query.get(training_content_id_str)
        if not content:
            logger.error(f"[MergeCurrentTask:{self.request.id}] TrainingContent {training_content_id_str} 未找到。")
            self.update_state(state='FAILURE', meta={'error': '培训内容未找到'})
            return {'status': 'Error', 'message': '培训内容未找到'}

        latest_final_script = db.session.query(TtsScript).filter(
            TtsScript.training_content_id == content.id,
            TtsScript.script_type == 'final_tts_script'
        ).order_by(TtsScript.version.desc()).first()

        if not latest_final_script:
            logger.error(f"[MergeCurrentTask:{self.request.id}] 未找到内容 {content.id} 的最终脚本。")
            self.update_state(state='FAILURE', meta={'error': '最终脚本未找到'})
            return {'status': 'Error', 'message': '最终脚本未找到'}

        # 找到该最终脚本下所有已成功生成语音的句子，并按顺序排列
        generated_sentences_with_audio = db.session.query(TtsSentence, TtsAudio).join(
            TtsAudio, TtsSentence.id == TtsAudio.tts_sentence_id
        ).filter(
            TtsSentence.tts_script_id == latest_final_script.id,
            TtsSentence.audio_status == 'generated',
            TtsAudio.is_latest_for_sentence == True # 只合并最新的音频
        ).order_by(TtsSentence.order_index).all()

        if not generated_sentences_with_audio:
            logger.info(f"[MergeCurrentTask:{self.request.id}] 内容 {content.id} (脚本 {latest_final_script.id}) 没有已生成的语音可以合并。")
            content.status = 'merge_failed_no_audio' # 或其他合适状态
            db.session.commit()
            return {'status': 'Success', 'message': '没有已生成的语音可以合并。'}

        logger.info(f"[MergeCurrentTask:{self.request.id}] 找到 {len(generated_sentences_with_audio)} 个已生成的语音准备合并 for content {content.id}")
        content.status = 'merging_audio'
        db.session.commit()
        
        self.update_state(state='PROGRESS', meta={
            'total_sentences': len(generated_sentences_with_audio),
            'merged_count': 0,
            'message': f'开始合并 {len(generated_sentences_with_audio)} 个音频...'
        })

        merged_sound = None
        processed_count = 0
        audio_storage_base = app.config.get('TTS_AUDIO_STORAGE_PATH')

        try:
            for sentence, audio_record in generated_sentences_with_audio:
                audio_file_full_path = os.path.join(audio_storage_base, audio_record.file_path)
                if not os.path.exists(audio_file_full_path):
                    logger.warning(f"[MergeCurrentTask:{self.request.id}] 音频文件不存在: {audio_file_full_path} for sentence {sentence.id}。跳过此句。")
                    continue
                
                try:
                    # 根据文件扩展名加载音频
                    file_ext = os.path.splitext(audio_record.file_path)[1].lower().lstrip('.')
                    if not file_ext: # 如果没有扩展名，尝试根据MIME类型或默认
                        # 这里可以添加更复杂的逻辑，例如从 audio_record.generation_params 或 mime_type 推断
                        file_ext = "wav" # 或 "mp3"
                        logger.warning(f"音频文件 {audio_record.file_path} 无扩展名, 尝试作为 {file_ext} 加载。")
                    
                    sound_segment = AudioSegment.from_file(audio_file_full_path, format=file_ext)
                    
                    if merged_sound is None:
                        merged_sound = sound_segment
                    else:
                        merged_sound += sound_segment
                    
                    processed_count +=1
                    self.update_state(state='PROGRESS', meta={
                        'total_sentences': len(generated_sentences_with_audio),
                        'merged_count': processed_count,
                        'message': f'已合并 {processed_count}/{len(generated_sentences_with_audio)} 个音频...'
                    })
                except Exception as e_segment:
                    logger.error(f"[MergeCurrentTask:{self.request.id}] 合并句子 {sentence.id} 的音频失败: {e_segment}", exc_info=True)
                    # 可以选择是跳过这个句子还是中止整个合并
                    # 这里选择跳过

            if merged_sound is None:
                raise Exception("未能成功合并任何音频片段。")

            # 将旧的合并语音标记为非最新
            TtsAudio.query.filter_by(training_content_id=content.id, audio_type='merged_audio', is_latest_for_content=True).update({'is_latest_for_content': False})
            
            new_merged_version = 1
            latest_merged = TtsAudio.query.filter_by(training_content_id=content.id, audio_type='merged_audio').order_by(TtsAudio.version.desc()).first()
            if latest_merged:
                new_merged_version = latest_merged.version + 1

            # 决定合并后的文件格式，例如 MP3
            # merged_file_extension = ".mp3"

            merged_relative_path, merged_file_size = _save_merged_audio_file(merged_sound, content.id, new_merged_version)

            new_merged_audio_record = TtsAudio(
                training_content_id=content.id,
                audio_type='merged_audio',
                file_path=merged_relative_path,
                file_size_bytes=merged_file_size,
                duration_ms=len(merged_sound), # pydub 音频长度是毫秒
                version=new_merged_version,
                is_latest_for_content=True,
                tts_engine="merged" # 或记录参与合并的引擎（如果单一）
            )
            db.session.add(new_merged_audio_record)
            content.status = 'audio_merge_complete'
            db.session.commit()

            logger.info(f"[MergeCurrentTask:{self.request.id}] 内容 {content.id} 的音频已成功合并到 {merged_relative_path}")
            final_meta = {
                'total_sentences': len(generated_sentences_with_audio),
                'merged_count': processed_count,
                'message': f'成功合并 {processed_count} 个音频片段。',
                'merged_audio_id': str(new_merged_audio_record.id)
            }
            self.update_state(state='SUCCESS', meta=final_meta)
            return {'status': 'Success', **final_meta}

        except Exception as e:
            logger.error(f"[MergeCurrentTask:{self.request.id}] 合并音频过程中发生错误 for content {content.id}: {e}", exc_info=True)
            content.status = 'error_merging_audio'
            db.session.commit()
            self.update_state(state='FAILURE', meta={'error': str(e)})
            return {'status': 'Error', 'message': '合并音频时发生服务器错误: ' + str(e)}
    
@celery_app.task(name='tasks.reset_daily_tts_usage')
def reset_daily_tts_usage_task():
    """由Celery Beat调度的任务，用于重置每日使用量。"""
    logger.info("Celery Beat triggered: Resetting daily TTS usage...")
    reset_all_usage()
    logger.info("Daily TTS usage has been reset successfully.")


# --- 辅助函数：保存合并后的音频文件 ---
def _find_reusable_audio_info(text_to_match, training_content_id_to_match):
    """
    辅助函数：在指定 training_content_id 下查找具有相同文本且已生成音频的句子，
    并返回其最新的 TtsAudio 记录的信息。
    """
    # 查询 TtsSentence，需要通过 join TtsScript 来过滤 training_content_id
    reusable_sentence_with_audio = db.session.query(TtsSentence, TtsAudio).join(
        TtsAudio, TtsSentence.id == TtsAudio.tts_sentence_id
    ).join(
        TtsScript, TtsSentence.tts_script_id == TtsScript.id # <--- 加入 TtsScript
    ).filter(
        TtsScript.training_content_id == training_content_id_to_match, # <--- 通过 TtsScript 过滤
        TtsSentence.sentence_text == text_to_match,
        TtsSentence.audio_status == 'generated',
        TtsAudio.is_latest_for_sentence == True 
    ).order_by(TtsAudio.created_at.desc()).first()

    if reusable_sentence_with_audio:
        _, audio_record = reusable_sentence_with_audio
        return {
            'file_path': audio_record.file_path,
            'duration_ms': audio_record.duration_ms,
            'file_size_bytes': audio_record.file_size_bytes,
            'tts_engine': audio_record.tts_engine,
            'voice_name': audio_record.voice_name,
            'generation_params': audio_record.generation_params,
        }
    return None

# 匹配拆分后的句子，看库中是否已有此音频
@celery_app.task(bind=True, name='tasks.resplit_and_match_sentences')
def resplit_and_match_sentences_task(self, final_tts_script_id_str):
    app = create_flask_app_for_task()
    with app.app_context():
        final_script = TtsScript.query.get(final_tts_script_id_str)
        if not final_script or final_script.script_type != 'final_tts_script':
            logger.error(f"[ResplitTask:{self.request.id}] 脚本 {final_tts_script_id_str} 未找到或非最终脚本。")
            # self.update_state(state='FAILURE', meta=...)
            raise ValueError("无效的脚本ID或类型") # 让Celery标记为FAILURE

        training_content = final_script.training_content
        if not training_content:
            logger.error(f"[ResplitTask:{self.request.id}] 脚本 {final_script.id} 未关联培训内容。")
            raise ValueError("脚本未关联培训内容")

        logger.info(f"[ResplitTask:{self.request.id}] 开始为脚本 {final_script.id} (v{final_script.version}) 重新拆分和匹配句子。")
        
        try:
            # 1. (可选) 将与此脚本旧版本关联的所有句子的 is_latest_for_script 标记为 False
            #    或者，我们直接创建新句子，旧句子如果不再被引用，自然就“过时”了。
            #    为了简化，我们先不显式标记旧句子，而是专注于创建新句子列表。
            #    在创建新句子之前，删除与当前 final_tts_script_id 关联的所有旧 TtsSentence 记录。
            #    这样可以确保每个脚本版本都有自己的一套句子，避免混淆。
            #    但这也意味着我们不能直接从“上一个版本”的句子复用，而是从整个 TrainingContent 下复用。
            
            # 先删除当前脚本版本已有的所有句子，以便重新创建
            # 这样可以确保每个脚本版本下的句子列表是干净的
            TtsSentence.query.filter_by(tts_script_id=final_script.id).delete()
            # 注意：如果 TtsSentence 和 TtsAudio 之间没有设置 cascade delete on tts_sentence_id，
            # 那么删除 TtsSentence 不会自动删除其关联的 TtsAudio。
            # 但我们的目标是复用音频，所以不应该删除所有 TtsAudio。
            # 这里的 delete() 只删除了句子与脚本的关联（如果TtsSentence表只记录句子和脚本ID），
            # 或者删除了句子本身。我们需要的是，如果句子文本变了，旧的音频对新句子就没用了。

            # 一个更安全的做法是：
            # a. 获取新脚本拆分后的句子文本列表。
            # b. 为新文本列表创建新的 TtsSentence 对象，并尝试从整个 TrainingContent 下的旧音频中复用。
            # c. （可选）删除那些在旧版本脚本中存在，但在新版本脚本中不再存在的句子（如果需要清理）。

            # 简化流程：基于新的脚本内容创建句子，并尝试复用音频
            new_sentence_texts = [s.strip() for s in final_script.content.split('\n') if s.strip()]
            if not new_sentence_texts: # 如果换行符分割后为空，尝试用标点
                 # ... (更智能的拆分逻辑) ...
                 pass # 保持简单

            created_count = 0
            reused_audio_count = 0

            for index, text in enumerate(new_sentence_texts):
                new_sentence = TtsSentence(
                    tts_script_id=final_script.id,
                    sentence_text=text,
                    order_index=index,
                    # audio_status 默认为 pending_generation
                )
                db.session.add(new_sentence)
                db.session.flush() # 获取 new_sentence.id

                reusable_audio_info = _find_reusable_audio_info(text, training_content.id)
                
                if reusable_audio_info:
                    new_sentence.audio_status = 'generated' # 标记为已生成
                    
                    # 创建新的 TtsAudio 记录，指向复用的文件
                    new_audio_record = TtsAudio(
                        tts_sentence_id=new_sentence.id,
                        training_content_id=training_content.id,
                        audio_type='sentence_audio',
                        file_path=reusable_audio_info['file_path'],
                        duration_ms=reusable_audio_info['duration_ms'],
                        file_size_bytes=reusable_audio_info['file_size_bytes'],
                        tts_engine=reusable_audio_info['tts_engine'], # 可以记录为 "reused_from_" + original_engine
                        voice_name=reusable_audio_info['voice_name'],
                        generation_params=reusable_audio_info['generation_params'],
                        version=1, # 对于这个新句子，这是第一个（复用的）音频版本
                        is_latest_for_sentence=True
                    )
                    db.session.add(new_audio_record)
                    reused_audio_count += 1
                    logger.info(f"[ResplitTask:{self.request.id}] 句子 '{text[:30]}...' (新ID: {new_sentence.id}) 复用了音频: {reusable_audio_info['file_path']}")
                    
                else:
                    new_sentence.audio_status = 'pending_generation'
                    # logger.info(f"[ResplitTask:{self.request.id}] 句子 '{text[:30]}...' (新ID: {new_sentence.id}) 需要重新生成音频。")

                created_count +=1
            
            training_content.status = 'pending_audio_generation' # 或 'audio_matching_complete'
            db.session.commit()
            logger.info(f"[ResplitTask:{self.request.id}] 脚本 {final_script.id} 重新拆分完成。创建/更新句子数: {created_count}，复用音频数: {reused_audio_count}")
            return {'status': 'Success', 'message': f'句子已重新处理，复用音频 {reused_audio_count} 个。', 'created_sentences': created_count, 'reused_audios': reused_audio_count}

        except Exception as e:
            db.session.rollback()
            logger.error(f"[ResplitTask:{self.request.id}] 重新拆分和匹配句子失败 for script {final_script.id}: {e}", exc_info=True)
            if training_content:
                training_content.status = 'error_sentence_resplit'
                db.session.commit()
            raise # 让Celery知道任务失败了