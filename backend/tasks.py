# backend/tasks.py
from celery_worker import celery_app
from flask import Flask, current_app # 导入 current_app
from backend.models import db, TtsScript, TrainingContent, TtsSentence, TtsAudio, MergedAudioSegment
import sqlalchemy as sa # <--- 添加这一行
from sqlalchemy import or_, func # 也可以只导入 or_，但如果后面还用到 sa.func 等，还是导入整个 sqlalchemy 好

# from backend.api.ai_generate import transform_text_with_llm # 如果其他任务需要
from gradio_client import Client as GradioClient # GradioClient 已导入
import logging
import os
from datetime import datetime
import requests
import json
import uuid # 导入 uuid

from pydub import AudioSegment # For audio manipulation
from pydub.exceptions import CouldntDecodeError
import shutil # For safely cleaning up temporary files if any


# 为了在 Celery 任务中使用 Flask 应用上下文（例如数据库会话、current_app.config）
# 我们需要一种方式来访问或创建 Flask app 实例。
# 如果你的 Flask app 是通过工厂函数创建的，可以在这里导入工厂并创建实例。
# 或者，如果你的 app 实例是全局可导入的（不推荐用于大型应用），可以直接导入。
# 这里我们假设有一个可以创建或获取 app 实例的方式。

# 简单的 Flask app 创建函数，用于任务上下文
# 这只是一个示例，您需要根据您的项目结构调整
def create_flask_app_for_task():
    from backend.app import app as flask_app_instance # 尝试直接导入已创建的 app 实例
    # 或者如果使用工厂模式:
    # from backend.app import create_app
    # flask_app_instance = create_app()
    return flask_app_instance

logger = logging.getLogger(__name__)

def _save_merged_audio_file(audio_segment_obj, training_content_id_str, version_number):
    """Saves a Pydub AudioSegment object for a merged audio."""
    app = create_flask_app_for_task()
    with app.app_context():
        storage_base_path = app.config.get('TTS_AUDIO_STORAGE_PATH', os.path.join(app.root_path, 'static', 'tts_audio'))
        # Merged files go into the training_content_id directory directly
        relative_dir = str(training_content_id_str)
        full_dir_path = os.path.join(storage_base_path, relative_dir)
        os.makedirs(full_dir_path, exist_ok=True)
        
        timestamp_str = datetime.now().strftime("%Y%m%d%H%M%S%f")
        file_name = f"merged_audio_v{version_number}_{timestamp_str}.mp3" # Saving as MP3 for potentially smaller size
        full_file_path = os.path.join(full_dir_path, file_name)
        relative_file_path = os.path.join(relative_dir, file_name)

        try:
            # Export as MP3. You can choose .wav if preferred, but MP3 is often better for web.
            # Ensure ffmpeg is installed and in PATH for pydub to export non-wav formats.
            audio_segment_obj.export(full_file_path, format="mp3")
            logger.info(f"Merged audio file saved to: {full_file_path} (relative: {relative_file_path})")
            return relative_file_path, os.path.getsize(full_file_path)
        except Exception as e:
            logger.error(f"Saving merged audio file failed {full_file_path}: {e}", exc_info=True)
            raise


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


@celery_app.task(bind=True, name='tasks.trigger_tts_refine_async') # bind=True 可以让任务访问 self (任务实例)
def trigger_tts_refine_async(self, oral_script_id_str):
    app = create_flask_app_for_task() # 为任务创建 Flask 应用上下文
    with app.app_context():
        oral_script = TtsScript.query.get(oral_script_id_str)
        if not oral_script or oral_script.script_type != 'oral_script':
            logger.error(f"TTS Refine Task: 无效的口播脚本ID {oral_script_id_str} 或类型不匹配")
            self.update_state(state='FAILURE', meta={'exc_type': 'ValueError', 'exc_message': '无效的脚本ID'})
            # 可以考虑更新数据库中 TrainingContent 的状态为 error
            return {'status': 'Error', 'message': '无效的脚本ID'}

        training_content = oral_script.training_content
        if not training_content:
            logger.error(f"TTS Refine Task: 找不到关联的培训内容 for script {oral_script_id_str}")
            self.update_state(state='FAILURE', meta={'exc_type': 'ValueError', 'exc_message': '找不到关联内容'})
            return {'status': 'Error', 'message': '找不到关联内容'}
        
        try:
            # 更新状态为处理中，如果需要的话
            # training_content.status = 'processing_tts_refine_async'
            # db.session.commit()

            tts_service_base_url = app.config.get('TTS_SERVICE_BASE_URL', "http://test.mengyimengsao.com:37860/")
            gradio_tts_client = GradioClient(tts_service_base_url)
            
            logger.info(f"TTS Refine Task: 向 Gradio TTS 服务 API '/generate_refine' 发送请求 for script {oral_script_id_str}")
            
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

            logger.info(f"TTS Refine Task: Gradio TTS API 响应成功 for script {oral_script_id_str}")

            new_refined_script = _create_new_script_version_task(
                source_script_id=oral_script.id,
                training_content_id=training_content.id,
                new_script_type='tts_refined_script',
                new_content=refined_content
            )
            training_content.status = 'pending_llm_final_refine'
            db.session.add(new_refined_script) # 添加到会话
            db.session.commit() # 提交数据库更改

            logger.info(f"TTS Refine Task: TTS Refine脚本 (ID: {new_refined_script.id}) 已为口播脚本 {oral_script_id_str} 生成。")
            return {'status': 'Success', 'new_script_id': str(new_refined_script.id)}

        # ++++++ 修改异常捕获 ++++++
        except Exception as e: # 捕获更通用的 Exception
            logger.error(f"TTS Refine Task: Exception for script {oral_script_id_str}: {e}", exc_info=True)
            # 可以尝试检查 e 的类型或内容来判断是否是 Gradio 特有的错误，但通常 Exception 足够
            # if "gradio" in str(e).lower() or isinstance(e, ...): # 如果需要更精确的判断
            
            training_content.status = 'error_tts_refine'
            db.session.commit()
            self.update_state(state='FAILURE', meta={'exc_type': type(e).__name__, 'exc_message': str(e)})
            return {'status': 'Error', 'message': 'TTS Refine脚本处理时发生服务器错误: ' + str(e)}
        # ++++++++++++++++++++++++++
def _save_audio_file(audio_binary_content, training_content_id_str, sentence_id_str, version): # 参数改为字符串
    app = create_flask_app_for_task()
    with app.app_context():
        storage_base_path = app.config.get('TTS_AUDIO_STORAGE_PATH', os.path.join(app.root_path, 'static', 'tts_audio'))
        # 确保 training_content_id 和 sentence_id 是字符串，以便用于路径拼接
        relative_dir = os.path.join(str(training_content_id_str), str(sentence_id_str))
        full_dir_path = os.path.join(storage_base_path, relative_dir)
        os.makedirs(full_dir_path, exist_ok=True)
        
        timestamp_str = datetime.now().strftime("%Y%m%d%H%M%S%f") # 现在 datetime 已定义
        file_name = f"sentence_v{version}_{timestamp_str}.wav"
        full_file_path = os.path.join(full_dir_path, file_name)
        relative_file_path = os.path.join(relative_dir, file_name)

        try:
            with open(full_file_path, 'wb') as f:
                f.write(audio_binary_content)
            logger.info(f"音频文件已保存到: {full_file_path} (相对路径: {relative_file_path})")
            return relative_file_path, os.path.getsize(full_file_path)
        except Exception as e:
            logger.error(f"保存音频文件失败 {full_file_path}: {e}", exc_info=True)
            raise

@celery_app.task(bind=True, name='tasks.generate_single_sentence_audio_async', max_retries=2)
def generate_single_sentence_audio_async(self, sentence_id_str, tts_engine_params=None):
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
                "num_seeds": 1, "seed": 1029, "speed": 2, "oral": 2, "laugh": 0,
                "bk": 6, "min_length": 80, "batch_size": 6, "temperature": 0.1,
                "top_P": 0.7, "top_K": 20, "roleid": "1", "refine_text": True, "pt_file": None
            }
            
            actual_params = {**default_params, **(tts_engine_params or {})}
            
            # predict 调用
            job_result = gradio_tts_client.predict(
                text_file=sentence.sentence_text, # 这是需要转换为语音的文本
                **actual_params, # 将其他参数解包传入
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
def batch_generate_audio_task(self, final_script_id_str):
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

        for index, sentence in enumerate(sentences_to_process):
            sentence_id_str = str(sentence.id)
            sentence.audio_status = 'generating' # 标记单个句子开始生成
            db.session.commit() 
            # logger.info(f"[BatchTask:{self.request.id}] ({processed_count + 1}/{initially_to_process_count}) 开始为句子ID {sentence_id_str} 生成语音...")

            current_sentence_processed_status = 'error_generation' # 默认为失败

            try:
                actual_params = {**default_tts_params} 
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
        logger.info(f"[MergeTask:{task_id}] Starting audio merge for TrainingContent ID: {training_content_id_str}")
        
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
            merged_relative_path, merged_file_size = _save_merged_audio_file(merged_sound, content.id, new_merged_version)
            
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