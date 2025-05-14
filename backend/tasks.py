# backend/tasks.py
from celery_worker import celery_app  # 导入在 celery_app.py 中创建的 Celery 实例
from flask import Flask # 需要 Flask 来创建应用上下文
from backend.models import db, TtsScript, TrainingContent, TtsSentence, TtsAudio 

from backend.api.ai_generate import transform_text_with_llm # 导入已有的 LLM 调用函数
from gradio_client import Client as GradioClient
import logging
import os
from datetime import datetime # <--- 新增这一行
import requests # <--- 新增这一行
import json # <--- 新增这一行

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
                "num_seeds": 1, "seed": 3, "speed": 5, "oral": 2, "laugh": 0,
                "bk": 4, "min_length": 80, "batch_size": 3, "temperature": 0.1,
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
        
# TODO: 类似地为 generate_oral_script 和 llm_refine_script 创建异步任务
# @celery_app.task(bind=True, name='tasks.trigger_generate_oral_script_async')
# def trigger_generate_oral_script_async(self, content_id_str):
#     app = create_flask_app_for_task()
#     with app.app_context():
#         # ... (调用 transform_text_with_llm 的逻辑) ...
#         # ... (更新数据库状态) ...
#         pass