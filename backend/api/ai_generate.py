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

_RequestOptions = None # 先定义为 None

# --- Helper functions ---
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

def transform_text_with_llm(input_text: str, prompt_identifier: str, reference_text: str = None, user_id: uuid.UUID = None, custom_model_identifier: str = None, request_timeout: int = 300):
    start_time = time.time()
    
    # 1. 获取 Prompt 和模型配置 (保持不变)
    active_prompt, prompt_error = get_active_prompt_internal(prompt_identifier)
    if prompt_error:
        # ... (日志和错误处理)
        raise Exception(prompt_error)

    model_to_use_identifier = custom_model_identifier or active_prompt.model_identifier or "gemini-1.5-flash-latest"
    api_key, api_key_name_for_log, llm_model_for_log, config_error = get_active_llm_config_internal("Google", model_to_use_identifier)
    
    if config_error:
        # ... (日志和错误处理)
        raise Exception(config_error)
    
    if not api_key:
        # ... (日志和错误处理)
        raise Exception("未能获取有效的API Key")

    # 2. **核心修改：创建 Client 时明确指定 transport='rest'**
    client = genai.Client(
        api_key=api_key,
        # client_options 可以在这里配置代理等，如果需要的话
        # client_options={"api_endpoint": "generativelanguage.googleapis.com"}
    )
    
    # 3. 准备调用参数 (恢复到你原始可以工作的同步代码的结构)
    system_instruction_text = active_prompt.prompt_template
    user_message_parts = [f"请修订以下“待修订脚本”：\n```text\n{input_text}\n```"]
    if reference_text:
        user_message_parts.append(f"\n\n请在修订时主要参考以下“原始口播稿”：\n```text\n{reference_text}\n```")
    user_message_for_llm = "\n".join(user_message_parts)

    contents = [genai.types.Content(role="user", parts=[genai.types.Part.from_text(text=user_message_for_llm)])]
    
    # 准备 config 对象
    config_params = {}
    expected_json_output = "json" in (system_instruction_text or "").lower() or "json" in (active_prompt.prompt_name or "").lower()
    if expected_json_output:
        config_params['response_mime_type'] = "application/json"
        
    # 将 system_instruction 作为顶级参数传递（即使之前的版本不支持，这里的 client 行为可能不同）
    # 我们将恢复到你最初能够工作的调用结构
    generation_config_obj = genai.types.GenerateContentConfig(
        **config_params,
        system_instruction=[genai.types.Part.from_text(text=system_instruction_text)]
    )

    log_input_data = { # ... (日志记录逻辑不变)
        "input_text_length": len(input_text),
        "reference_text_length": len(reference_text) if reference_text else 0,
        "prompt_details": to_dict(active_prompt),
        "model_api_identifier_used": model_to_use_identifier,
        "user_message_preview": user_message_for_llm[:300]
    }
    
    response_text = ""
    try:
        current_app.logger.info(f"Calling LLM ({prompt_identifier}) with model: {model_to_use_identifier} via REST transport")
        
        # 4. 使用你原始的、可以工作的调用方式
        stream_response = client.models.generate_content_stream(
            model=model_to_use_identifier, 
            contents=contents,
            config=generation_config_obj, # <-- 使用 'config' 参数
        )

        for chunk in stream_response:
            if hasattr(chunk, 'text') and chunk.text:
                 response_text += chunk.text
        
        # ... (后续的结果处理和日志记录逻辑保持不变) ...
        llm_output_raw = {"raw_response": response_text, "streamed": True}
        parsed_output = None

        if expected_json_output:
            result_cleaned = response_text.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
            parsed_output = json.loads(result_cleaned) if result_cleaned else {}
        else:
            parsed_output = response_text 

        duration_ms = int((time.time() - start_time) * 1000)
        log_llm_call(f"transform_text ({prompt_identifier})", llm_model_for_log, active_prompt, api_key_name_for_log,
                     log_input_data, llm_output_raw, parsed_output, "success", duration_ms=duration_ms, user_id=user_id)
        
        return parsed_output if expected_json_output else response_text
    except Exception as e:
        # ... (日志和异常处理不变)
        current_app.logger.error(f"LLM调用失败 ({prompt_identifier}): {e}", exc_info=True)
        # ...
        raise