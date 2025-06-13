# backend/api/ai_generate.py
import os
import time # 用于计时
import json # 确保导入 json
from flask import current_app # 用于日志记录
from google import genai
from google.genai import types
# from dotenv import load_dotenv # 如果 API Key 从数据库读取，这个可能不再直接需要
import uuid # 用于用户 ID
# 从新位置导入模型和数据库会话
from backend.models import LlmModel, LlmApiKey, LlmPrompt, LlmCallLog, db # 确保导入 db
# from backend.api.llm_config_api import get_active_llm_config, get_active_prompt # 导入辅助函数
# 由于循环导入问题，将这些辅助函数移到 ai_generate.py 或一个新的 utils 文件
# 这里我们暂时将它们定义在 ai_generate.py 内部或从一个共享的 utils 文件导入

# --- Helper functions (可以移到 utils.py) ---
from backend.security_utils import decrypt_data # 确保能正确导入
from sqlalchemy import inspect # 如果 to_dict 在此文件且用到 inspect
import datetime # 如果 to_dict 在此文件且用到 datetime

import struct # 用于 convert_to_wav


_RequestOptions = None # 先定义为 None

# --- Helper functions ---
def _convert_to_wav_gemini(audio_data: bytes, mime_type: str) -> bytes:
    parameters = _parse_audio_mime_type_gemini(mime_type)
    bits_per_sample = parameters["bits_per_sample"]
    sample_rate = parameters["rate"]
    num_channels = 1
    data_size = len(audio_data)
    bytes_per_sample = bits_per_sample // 8
    block_align = num_channels * bytes_per_sample
    byte_rate = sample_rate * block_align
    chunk_size = 36 + data_size
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", chunk_size, b"WAVE", b"fmt ", 16, 1,
        num_channels, sample_rate, byte_rate, block_align,
        bits_per_sample, b"data", data_size
    )
    return header + audio_data

def _parse_audio_mime_type_gemini(mime_type: str) -> dict[str, int | None]:
    bits_per_sample = 16
    rate = 24000
    if not mime_type:
        return {"bits_per_sample": bits_per_sample, "rate": rate}
    parts = mime_type.split(";")
    for param in parts:
        param = param.strip()
        if param.lower().startswith("rate="):
            try:
                rate_str = param.split("=", 1)[1]
                rate = int(rate_str)
            except (ValueError, IndexError): pass
        elif param.startswith("audio/L"):
            try:
                bits_per_sample = int(param.split("L", 1)[1])
            except (ValueError, IndexError): pass
    return {"bits_per_sample": bits_per_sample, "rate": rate}

def make_json_safe(data):
    if isinstance(data, dict):
        return {k: make_json_safe(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [make_json_safe(i) for i in data]
    elif isinstance(data, (str, int, float, bool, type(None))):
        return data
    else:
        if hasattr(data, '__sa_instance_state__'):
            try:
                return to_dict(data)
            except Exception as e_todict:
                current_app.logger.debug(f"make_json_safe: to_dict 转换 SQLAlchemy 对象失败 {type(data)}: {e_todict}, 回退到 str()")
                return str(data)
        elif hasattr(data, '__dict__'):
            try:
                return {
                    k: make_json_safe(v) 
                    for k, v in data.__dict__.items() 
                    if not k.startswith('_') and not callable(v)
                }
            except Exception as e_dict:
                    current_app.logger.debug(f"make_json_safe: __dict__ 转换失败 {type(data)}: {e_dict}, 回退到 str()")
                    return str(data)
        return str(data)
    
def create_initial_llm_log(function_name, model, prompt, api_key_name, input_data, user_id=None):
    """创建初始的LLM调用日志条目，并返回其ID。"""
    try:
        # make_json_safe 仍然需要确保 input_data 可序列化
        safe_input = make_json_safe(input_data) 

        log_entry = LlmCallLog(
            function_name=function_name,
            llm_model_id=model.id if model and hasattr(model, 'id') else None,
            llm_prompt_id=prompt.id if prompt and hasattr(prompt, 'id') else None,
            api_key_name=api_key_name,
            input_data=safe_input,
            status="pending", # 初始状态
            user_id=user_id,
            # timestamp, created_at, updated_at 会有默认值
        )
        db.session.add(log_entry)
        db.session.commit() # 提交以获取ID
        current_app.logger.info(f"初始日志已创建 (ID: {log_entry.id}) for {function_name}")
        return log_entry.id
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"创建初始LLM调用日志失败 for {function_name}: {e}", exc_info=True)
        return None # 返回 None 表示创建失败

def to_dict(obj):
    if hasattr(obj, '__sa_instance_state__'):
        d = {}
        for c in inspect(obj).mapper.column_attrs:
            val = getattr(obj, c.key)
            if isinstance(val, (datetime.datetime, datetime.date)):
                d[c.key] = val.isoformat()
            else:
                d[c.key] = val
        return d
    elif isinstance(obj, list):
        return [to_dict(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: to_dict(v) for k, v in obj.items()}
    elif isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    return obj

def get_active_llm_config_internal(provider_name, model_identifier=None):
    api_key_record = LlmApiKey.query.filter_by(provider=provider_name, status='active').first()
    if not api_key_record:
        return None, None, None, f"未找到提供商 '{provider_name}' 的活动API Key"
    try:
        api_key = decrypt_data(api_key_record.api_key_encrypted)
        if not api_key:
            return None, api_key_record.key_name, None, f"API Key '{api_key_record.key_name}' 解密失败或为空"
    except Exception as e:
        current_app.logger.error(f"解密API Key '{api_key_record.key_name}' 失败: {e}", exc_info=True)
        return None, api_key_record.key_name, None, f"API Key '{api_key_record.key_name}' 解密时发生错误"

    llm_model_obj = None
    if model_identifier:
        llm_model_obj = LlmModel.query.filter_by(model_identifier=model_identifier, status='active').first()
        if not llm_model_obj:
             return api_key, api_key_record.key_name, None, f"未找到模型标识符为 '{model_identifier}' 的活动模型"
    
    return api_key, api_key_record.key_name, llm_model_obj, None

def get_active_prompt_internal(prompt_identifier, version=None):
    query = LlmPrompt.query.filter_by(prompt_identifier=prompt_identifier, status='active')
    if version:
        prompt_record = query.filter_by(version=version).first()
    else:
        prompt_record = query.order_by(LlmPrompt.version.desc()).first()
        
    if not prompt_record:
        return None, f"未找到标识符为 '{prompt_identifier}' (版本: {version or '最新'}) 的活动提示词"
    return prompt_record, None

def update_llm_log_result(log_id, output_data_raw, parsed_output, status, error_message=None, duration_ms=None):
    """更新已存在的LLM调用日志条目。"""
    if not log_id:
        current_app.logger.error("更新LLM日志失败：log_id 为空。")
        return

    try:
        log_entry = LlmCallLog.query.get(log_id)
        if not log_entry:
            current_app.logger.error(f"更新LLM日志失败：未找到 ID 为 {log_id} 的日志条目。")
            return

        safe_output_raw = make_json_safe(output_data_raw)
        safe_parsed_output = make_json_safe(parsed_output)

        log_entry.output_data = safe_output_raw
        log_entry.parsed_output_data = safe_parsed_output
        log_entry.status = status
        log_entry.error_message = error_message
        log_entry.duration_ms = duration_ms
        # updated_at 会自动更新 (如果模型中配置了 onupdate=func.now())
        
        db.session.commit()
        current_app.logger.info(f"日志 (ID: {log_id}) 已更新为状态: {status}")
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新LLM调用日志 (ID: {log_id}) 失败: {e}", exc_info=True)

def log_llm_call(function_name, model, prompt, api_key_name, input_data, output_data_raw, parsed_output, status, error_message=None, duration_ms=None, user_id=None):
    try:
        def make_json_safe(data):
            if isinstance(data, dict):
                return {k: make_json_safe(v) for k, v in data.items()}
            elif isinstance(data, list):
                return [make_json_safe(i) for i in data]
            elif isinstance(data, (str, int, float, bool, type(None))):
                return data
            else:
                if hasattr(data, '__sa_instance_state__'):
                    try:
                        return to_dict(data)
                    except Exception as e_todict:
                        current_app.logger.debug(f"make_json_safe: to_dict 转换 SQLAlchemy 对象失败 {type(data)}: {e_todict}, 回退到 str()")
                        return str(data)
                elif hasattr(data, '__dict__'):
                    try:
                        return {
                            k: make_json_safe(v) 
                            for k, v in data.__dict__.items() 
                            if not k.startswith('_') and not callable(v)
                        }
                    except Exception as e_dict:
                         current_app.logger.debug(f"make_json_safe: __dict__ 转换失败 {type(data)}: {e_dict}, 回退到 str()")
                         return str(data)
                return str(data)

        safe_input = make_json_safe(input_data)
        safe_output_raw = make_json_safe(output_data_raw)
        safe_parsed_output = make_json_safe(parsed_output)

        log_entry = LlmCallLog(
            function_name=function_name,
            llm_model_id=model.id if model and hasattr(model, 'id') else None,
            llm_prompt_id=prompt.id if prompt and hasattr(prompt, 'id') else None,
            api_key_name=api_key_name,
            input_data=safe_input,
            output_data=safe_output_raw, 
            parsed_output_data=safe_parsed_output,
            status=status,
            error_message=error_message,
            duration_ms=duration_ms,
            user_id=user_id
        )
        db.session.add(log_entry)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"记录LLM调用日志失败: {e}", exc_info=True)

# --- LLM 调用函数 ---
# --- 统一的LLM调用函数 (最终修正版 v4) ---

def transform_text_with_llm(input_text: str, prompt_identifier: str, reference_text: str = None, user_id: uuid.UUID = None, custom_model_identifier: str = None, request_timeout: int = 300): # request_timeout 暂时未使用
    start_time = time.time()
    log_id = None # 初始化 log_id
    active_prompt = None
    llm_model_for_log = None
    api_key_name_for_log = None
    # 用于在早期错误时记录的简单输入信息
    initial_log_input_error_context = {
        "input_text_length": len(input_text),
        "reference_text_length": len(reference_text) if reference_text else 0,
        "prompt_identifier_requested": prompt_identifier,
        "custom_model_identifier_requested": custom_model_identifier
    }

    try:
        # 1. 获取 Prompt 和模型配置
        active_prompt, prompt_error = get_active_prompt_internal(prompt_identifier)
        if prompt_error:
            initial_log_input_error_context["error_context"] = "prompt_fetch_failed"
            log_id = create_initial_llm_log(f"transform_text ({prompt_identifier})", None, None, None, initial_log_input_error_context, user_id)
            raise Exception(prompt_error)

        model_to_use_identifier = custom_model_identifier or active_prompt.model_identifier or "gemini-1.5-flash-latest"
        api_key, api_key_name_for_log, llm_model_for_log, config_error = get_active_llm_config_internal("Google", model_to_use_identifier)
        
        if config_error:
            initial_log_input_error_context["error_context"] = "config_fetch_failed"
            log_id = create_initial_llm_log(f"transform_text ({prompt_identifier})", llm_model_for_log, active_prompt, api_key_name_for_log, initial_log_input_error_context, user_id)
            raise Exception(config_error)
        
        if not api_key:
            error_msg = "未能获取有效的API Key"
            initial_log_input_error_context["error_context"] = "api_key_missing"
            log_id = create_initial_llm_log(f"transform_text ({prompt_identifier})", llm_model_for_log, active_prompt, api_key_name_for_log, initial_log_input_error_context, user_id)
            raise Exception(error_msg)

        # 2. 初始化 Gemini Client
        client = genai.Client(api_key=api_key)
        
        # 3. 准备调用参数
        system_instruction_text = active_prompt.prompt_template
        user_message_parts = [f"请修订以下“待修订脚本”：\n```text\n{input_text}\n```"]
        if reference_text:
            user_message_parts.append(f"\n\n请在修订时主要参考以下“原始口播稿”：\n```text\n{reference_text}\n```")
        user_message_for_llm = "\n".join(user_message_parts)

        contents = [genai.types.Content(role="user", parts=[genai.types.Part.from_text(text=user_message_for_llm)])]
        
        config_params = {}
        expected_json_output = "json" in (system_instruction_text or "").lower() or "json" in (active_prompt.prompt_name or "").lower()
        if expected_json_output:
            config_params['response_mime_type'] = "application/json"
            
        generation_config_obj = genai.types.GenerateContentConfig(
            **config_params,
            # 注意：如果你的 genai 库版本 system_instruction 不在 GenerateContentConfig 中，
            # 你可能需要通过 client.models.generate_content(..., system_instruction=...) 传递
            # 但 generate_content_stream 的 config 参数通常支持它
            system_instruction=[genai.types.Part.from_text(text=system_instruction_text)] 
        )

        # --- 准备完整的日志输入数据 ---
        log_input_data_for_db = {
            "input_text_length": len(input_text),
            "input_text_preview": input_text[:300] + "..." if len(input_text) > 300 else input_text,
            "reference_text_length": len(reference_text) if reference_text else 0,
            "reference_text_preview": (reference_text[:300] + "..." if len(reference_text) > 300 else reference_text) if reference_text else None,
            "prompt_details": to_dict(active_prompt) if active_prompt else None, # 确保 active_prompt 存在
            "model_api_identifier_used": model_to_use_identifier,
            "user_message_preview": user_message_for_llm[:300] # 这个可能与 input_text_preview 重复，酌情保留
        }
        
        # --- 创建初始日志 ---
        log_id = create_initial_llm_log(f"transform_text ({prompt_identifier})", llm_model_for_log, active_prompt, 
                                        api_key_name_for_log, log_input_data_for_db, user_id)
        if not log_id:
            raise Exception("无法记录AI调用初始日志，操作中止。")

        # --- 4. 实际调用 LLM (包含重试逻辑) ---
        response_text = ""
        parsed_output = None # 初始化
        MAX_RETRIES = 3
        RETRY_DELAY_SECONDS = 2
        last_api_exception = None

        for attempt in range(MAX_RETRIES):
            try:
                response_text = "" # 每次重试前清空
                current_app.logger.info(f"Calling LLM ({prompt_identifier}, attempt {attempt + 1}) with model: {model_to_use_identifier}")
                stream_response = client.models.generate_content_stream(
                    model=model_to_use_identifier, 
                    contents=contents,
                    config=generation_config_obj,
                )
                for chunk in stream_response:
                    if hasattr(chunk, 'text') and chunk.text:
                        response_text += chunk.text
                
                if not response_text and not expected_json_output: # 对于非JSON输出，空响应也可能是一种有效结果
                    current_app.logger.warning(f"LLM ({prompt_identifier}) 返回了空文本内容，但期望非JSON输出。")
                elif not response_text and expected_json_output:
                    raise Exception("LLM 返回了空内容，但期望JSON输出。")


                llm_output_raw = {"raw_response": response_text, "streamed": True}
                if expected_json_output:
                    result_cleaned = response_text.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
                    # 增加对空 result_cleaned 的处理，避免 json.loads 报错
                    parsed_output = json.loads(result_cleaned) if result_cleaned else {} 
                else:
                    parsed_output = response_text 

                duration_ms = int((time.time() - start_time) * 1000)
                update_llm_log_result(log_id, llm_output_raw, parsed_output, "success", duration_ms=duration_ms)
                return parsed_output # 如果期望 JSON 则返回解析后的，否则返回原始文本
            
            except json.JSONDecodeError as e:
                last_api_exception = e
                current_app.logger.error(f"JSON解析失败 (transform_text, attempt {attempt + 1}): {e}", exc_info=False)
                break 
            except types.StopCandidateException as e:
                last_api_exception = e
                current_app.logger.error(f"内容被 Gemini 阻止 (transform_text, attempt {attempt + 1}): {e}", exc_info=False)
                break
            except Exception as e:
                last_api_exception = e
                current_app.logger.warning(f"LLM API 调用失败 (transform_text, attempt {attempt + 1}): {e}", exc_info=False)
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY_SECONDS * (2**attempt))
                else:
                    current_app.logger.error(f"LLM API调用在 {MAX_RETRIES} 次尝试后仍然失败 (transform_text)。")
                    break
        
        # 如果循环结束且未成功返回
        raise last_api_exception if last_api_exception else Exception("LLM调用最终失败 (transform_text)")

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_message_for_log = str(e)
        # 确保即使在创建初始日志之前出错，也有一个 log_id 可以尝试更新
        if log_id:
            update_llm_log_result(log_id, 
                                  {"raw_response": response_text if 'response_text' in locals() and response_text else None}, 
                                  None, "error", error_message_for_log, duration_ms=duration_ms)
        else: 
            # 如果在获取配置阶段就失败，log_id 可能为 None
            # 尝试记录一个尽可能详细的错误日志，使用 initial_log_input_error_context
            create_initial_llm_log(f"transform_text ({prompt_identifier}) - EARLY_FAILURE", 
                                   llm_model_for_log, active_prompt, api_key_name_for_log,
                                   {**initial_log_input_error_context, "exception_details": str(e)}, # 合并错误上下文
                                   user_id)
        raise # 重新抛出异常

# --- 新增：专门为视频脚本生成定义的 Schema ---
def _get_video_script_schema() -> types.Schema:
    """返回用于视频脚本生成的JSON Schema对象"""
    return types.Schema(
        type=types.Type.OBJECT,
        # 注意: 您的示例中外层是 "response"，我将其调整为更符合业务的 "unmatched_ppts", "unmatched_srts", "video_scripts"
        # 如果模型确实只能返回 "response"，则在下面函数中处理
        required=["video_scripts", "unmatched_ppts", "unmatched_srts"],
        properties={
            "video_scripts": types.Schema(
                type=types.Type.ARRAY,
                description="An array of successfully matched video script entries.",
                items=types.Schema(
                    type=types.Type.OBJECT,
                    required=["ppt_page", "time_range"],
                    properties={
                        "ppt_page": types.Schema(type=types.Type.INTEGER, description="The corresponding slide page number."),
                        "time_range": types.Schema(type=types.Type.STRING, description="The time range in HH:MM:SS,ms ~ HH:MM:SS,ms format."),
                    },
                ),
            ),
            "unmatched_ppts": types.Schema(
                type=types.Type.ARRAY,
                description="An array of PPT pages that could not be matched.",
                items=types.Schema(
                    type=types.Type.OBJECT,
                    required=["ppt_page", "explanation"],
                    properties={
                        "ppt_page": types.Schema(type=types.Type.INTEGER, description="The unmatched slide page number."),
                        "explanation": types.Schema(type=types.Type.STRING, description="Reason for no match."),
                    },
                ),
            ),
            "unmatched_srts": types.Schema(
                type=types.Type.ARRAY,
                description="An array of subtitle entries that could not be matched.",
                items=types.Schema(
                    type=types.Type.OBJECT,
                    required=["srt_num", "time_range", "explanation"],
                    properties={
                        "srt_num": types.Schema(type=types.Type.INTEGER, description="The subtitle entry number."),
                        "time_range": types.Schema(type=types.Type.STRING, description="The unmatched time range."),
                        "explanation": types.Schema(type=types.Type.STRING, description="Reason for no match."),
                    },
                ),
            ),
        },
    )


# --- 新增：视频脚本生成专用函数 ---
def generate_video_script(srt_content: str, pdf_summary: str, prompt_identifier: str, user_id: uuid.UUID = None):
    start_time = time.time()
    log_id = None
    active_prompt = None
    llm_model_for_log = None
    api_key_name_for_log = None
    initial_log_input_error_context = {
        "srt_content_length": len(srt_content),
        "pdf_summary_length": len(pdf_summary),
        "prompt_identifier_requested": prompt_identifier
    }

    try:
        # 1. 获取 Prompt 和模型配置
        active_prompt, prompt_error = get_active_prompt_internal(prompt_identifier)
        if prompt_error:
            initial_log_input_error_context["error_context"] = "prompt_fetch_failed"
            log_id = create_initial_llm_log(f"generate_video_script ({prompt_identifier})", None, None, None, initial_log_input_error_context, user_id)
            raise Exception(prompt_error)

        model_to_use_identifier = active_prompt.model_identifier or "gemini-1.5-pro-latest" # 之前是2.5，建议用标准名
        api_key, api_key_name_for_log, llm_model_for_log, config_error = get_active_llm_config_internal("Google", model_to_use_identifier)
        
        if config_error:
            initial_log_input_error_context["error_context"] = "config_fetch_failed"
            log_id = create_initial_llm_log(f"generate_video_script ({prompt_identifier})", llm_model_for_log, active_prompt, api_key_name_for_log, initial_log_input_error_context, user_id)
            raise Exception(config_error)
        if not api_key:
            error_msg = "未能获取有效的API Key"
            initial_log_input_error_context["error_context"] = "api_key_missing"
            log_id = create_initial_llm_log(f"generate_video_script ({prompt_identifier})", llm_model_for_log, active_prompt, api_key_name_for_log, initial_log_input_error_context, user_id)
            raise Exception(error_msg)

        # 2. 初始化 Gemini Client
        client = genai.Client(api_key=api_key)

        # 3. 准备调用参数
        system_instruction_text = active_prompt.prompt_template
        user_message_parts = [
            "请根据以下SRT字幕文件内容和PDF大纲内容，生成视频脚本。",
            "--- SRT字幕内容开始 ---", srt_content, "--- SRT字幕内容结束 ---", "",
            "--- PDF内容大纲开始 ---", pdf_summary, "--- PDF内容大纲结束 ---"
        ]
        user_message_for_llm = "\n".join(user_message_parts)
        contents = [types.Content(role="user", parts=[types.Part.from_text(text=user_message_for_llm)])]
        
        generation_config_obj = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=_get_video_script_schema(), # 确保这个函数已定义
            system_instruction=[types.Part.from_text(text=system_instruction_text)]
        )

        # --- 准备完整的日志输入数据 ---
        log_input_data_for_db = {
            "srt_content_length": len(srt_content),
            "srt_content_preview": srt_content[:300] + "..." if len(srt_content) > 300 else srt_content,
            "pdf_summary_length": len(pdf_summary),
            "pdf_summary_preview": pdf_summary[:300] + "..." if len(pdf_summary) > 300 else pdf_summary,
            "prompt_details": to_dict(active_prompt) if active_prompt else None,
            "model_api_identifier_used": model_to_use_identifier
        }
        
        # --- 创建初始日志 ---
        log_id = create_initial_llm_log(f"generate_video_script ({prompt_identifier})", llm_model_for_log, active_prompt, 
                                        api_key_name_for_log, log_input_data_for_db, user_id)
        if not log_id:
            raise Exception("无法记录AI调用初始日志，操作中止。")

        # --- 4. 实际调用 LLM (包含重试逻辑) ---
        response_text = ""
        parsed_output = None
        MAX_RETRIES = 3
        RETRY_DELAY_SECONDS = 2
        last_api_exception = None

        for attempt in range(MAX_RETRIES):
            try:
                response_text = ""
                current_app.logger.info(f"Calling LLM ({prompt_identifier}, attempt {attempt + 1}) for video script.")
                stream_response = client.models.generate_content_stream(
                    model=model_to_use_identifier, 
                    contents=contents,
                    config=generation_config_obj,
                )
                for chunk in stream_response:
                    if hasattr(chunk, 'text') and chunk.text:
                        response_text += chunk.text
                
                if not response_text:
                    raise Exception("LLM 返回了空内容。")

                llm_output_raw = {"raw_response": response_text, "streamed": True}
                parsed_output = json.loads(response_text) # 强制 JSON

                duration_ms = int((time.time() - start_time) * 1000)
                update_llm_log_result(log_id, llm_output_raw, parsed_output, "success", duration_ms=duration_ms)
                return parsed_output
            
            except json.JSONDecodeError as e: # JSON 解析错误通常不重试
                last_api_exception = e
                current_app.logger.error(f"JSON解析失败 (video_script, attempt {attempt + 1}): {e}", exc_info=False)
                break
            except types.StopCandidateException as e: # 内容被阻止不重试
                last_api_exception = e
                current_app.logger.error(f"内容被 Gemini 阻止 (video_script, attempt {attempt + 1}): {e}", exc_info=False)
                break
            except Exception as e:
                last_api_exception = e
                current_app.logger.warning(f"LLM API 调用失败 (video_script, attempt {attempt + 1}): {e}", exc_info=False)
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY_SECONDS * (2**attempt))
                else:
                    current_app.logger.error(f"LLM API调用在 {MAX_RETRIES} 次尝试后仍然失败 (video_script)。")
                    break
        
        raise last_api_exception if last_api_exception else Exception("LLM调用最终失败 (generate_video_script)")

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_message_for_log = str(e)
        if log_id:
            update_llm_log_result(log_id, 
                                  {"raw_response": response_text if 'response_text' in locals() and response_text else None}, 
                                  None, "error", error_message_for_log, duration_ms=duration_ms)
        else:
            create_initial_llm_log(f"generate_video_script ({prompt_identifier}) - EARLY_FAILURE", 
                                   llm_model_for_log, active_prompt, api_key_name_for_log,
                                   {**initial_log_input_error_context, "exception_details": str(e)},
                                   user_id)
        raise



# --- Gemini TTS 生成函数 (基于您的官方示例) ---
def generate_audio_with_gemini_tts(
    text_to_speak: str, 
    api_key: str, # 直接传入解密后的 API Key
    model_name: str = "gemini-2.5-pro-preview-tts", # 官方推荐的 TTS 模型，替代 "gemini-2.5-pro-preview-tts"
    voice_name: str = "Kore", # 示例音色，需要确认是否对 tts-001 有效或需要
    temperature: float = 1 # 示例 temperature (官方 TTS 示例通常不强调这个)
):
    """
    使用 Google Gemini TTS (基于您提供的官方示例的调用方式) 生成音频。
    """
    start_time = time.time()
    current_app.logger.info(f"Gemini TTS: Starting audio generation for text (snippet): {text_to_speak[:50]}...")
    current_app.logger.info(f"Gemini TTS: Using model '{model_name}', voice '{voice_name}', temp '{temperature}'")

    # 确保 API Key 已配置 (虽然这里是传入的，但 genai.Client 还是会用到)
    # 如果 genai.configure() 之前没有被调用，或者你想确保这个 client 使用特定的 key
    # genai.configure(api_key=api_key) # 官方示例是 client = genai.Client(api_key=...)

    client = genai.Client(api_key=api_key)

    contents = [
        types.Content(
            role="user", # 对于 TTS，这个 role 通常是 "user" 或 "model" (如果有多轮)
            parts=[
                types.Part.from_text(text=text_to_speak),
            ],
        ),
    ]
    
    # 构建 GenerateContentConfig，严格按照您的示例
    # 注意： "gemini-2.5-pro-preview-tts" 可能已过时或为预览版名称。
    # 官方文档现在更推荐如 "models/tts-001" (高质量) 或 "models/tts-004" (速度优化)。
    # "Kore" 作为 voice_name 也需要确认是否适用于您选择的 tts_model。
    # 对于 tts-001, tts-004，通常不需要指定 voice_name，模型会自动选择。
    # 如果指定，确保它是有效的。
    speech_config_params = {}
    if voice_name: # 只有当 voice_name 提供时才尝试设置
        # 查阅您使用的模型是否支持/需要 PrebuiltVoiceConfig
        # 对于 models/tts-001, 通常不需要显式设置 voice_name
        speech_config_params["voice_config"] = types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name)
        )

    generate_content_config = types.GenerateContentConfig(
        temperature=temperature, # 官方TTS示例中 temperature 通常为 0 (更稳定) 或不设置
        response_modalities=["audio"], # 明确要求音频输出
        speech_config=types.SpeechConfig(**speech_config_params) if speech_config_params else None # 只有当有参数时才创建
    )
    
    audio_buffer = b""
    final_mime_type = None

    try:
        current_app.logger.debug(f"Gemini TTS: Calling client.models.generate_content_stream with model '{model_name}'")
        current_app.logger.debug(f"Gemini TTS: Contents: {contents}")
        current_app.logger.debug(f"Gemini TTS: Config: {generate_content_config}")

        stream_response = client.models.generate_content_stream(
            model=model_name, # 使用传入的 model_name
            contents=contents,
            config=generate_content_config, # 参数名是 generation_config (根据您 generate 函数)
                                                    # 或者如果是 config (根据您 TTS 示例)，请统一
                                                    # ** 假设您的 generate() 函数也用 generation_config **
        )

        for chunk in stream_response:
            if (
                chunk.candidates is None
                or not chunk.candidates # 检查是否为空列表
                or chunk.candidates[0].content is None
                or not chunk.candidates[0].content.parts # 检查是否为空列表
            ):
                continue
            
            part = chunk.candidates[0].content.parts[0]
            if part.inline_data and part.inline_data.data:
                audio_buffer += part.inline_data.data
                if part.inline_data.mime_type and not final_mime_type:
                    final_mime_type = part.inline_data.mime_type
            elif hasattr(part, 'text') and part.text: # 您的示例中有 else: print(chunk.text)
                current_app.logger.info(f"Gemini TTS: Received text part from stream (ignoring): {part.text[:100]}...")


        if not audio_buffer:
            current_app.logger.error("Gemini TTS: No audio data received from stream.")
            raise Exception("Gemini TTS 未返回音频数据")

        # 处理 MIME 类型和 WAV 转换，与您的示例一致
        if final_mime_type and final_mime_type.startswith("audio/L"):
            current_app.logger.info(f"Gemini TTS: Received raw audio data ({final_mime_type}), converting to WAV.")
            processed_audio_data = _convert_to_wav_gemini(audio_buffer, final_mime_type)
            output_mime_type = "audio/wav"
        else:
            processed_audio_data = audio_buffer
            output_mime_type = final_mime_type or "audio/mpeg" # 如果直接是 MP3 或 WAV，或者默认 MP3

        current_app.logger.info(f"Gemini TTS: Audio generation successful. Duration: {time.time() - start_time:.2f}s. Output MIME: {output_mime_type}")
        return processed_audio_data, output_mime_type

    except Exception as e:
        current_app.logger.error(f"Gemini TTS: API call failed for model '{model_name}': {e}", exc_info=True)
        # 可以在这里记录更详细的请求参数用于调试
        debug_info = {
            "model_name": model_name,
            "text_length": len(text_to_speak),
            "config": str(generate_content_config)
        }
        current_app.logger.error(f"Gemini TTS: Debug info - {debug_info}")
        raise



    