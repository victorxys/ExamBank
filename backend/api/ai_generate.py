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

def generate(evaluations, user_id=None):
    start_time = time.time()
    prompt_identifier = "EMPLOYEE_SELF_EVALUATION_SUMMARY"
    default_model_identifier = "gemini-2.5-pro-preview-03-25" # 保持与原代码一致

    active_prompt, prompt_error = get_active_prompt_internal(prompt_identifier)
    llm_model_for_log = None # 用于日志的模型对象
    api_key_name_for_log = None # 用于日志的api key name

    if prompt_error:
        current_app.logger.error(f"generate: {prompt_error}")
        log_llm_call("generate_employee_summary", None, None, None, {'evaluations_type': str(type(evaluations))}, None, None, "error", prompt_error, int((time.time() - start_time) * 1000), user_id)
        raise Exception(prompt_error)

    model_to_use_identifier = active_prompt.model_identifier or default_model_identifier
    api_key, api_key_name_for_log, llm_model_for_log, config_error = get_active_llm_config_internal("Google", model_to_use_identifier)

    if config_error:
        current_app.logger.error(f"generate: {config_error}")
        log_llm_call("generate_employee_summary", llm_model_for_log, active_prompt, api_key_name_for_log, {'evaluations_type': str(type(evaluations))}, None, None, "error", config_error, int((time.time() - start_time) * 1000), user_id)
        raise Exception(config_error)
    
    if not api_key: # 确保 api_key 有效
        error_msg = "未能获取有效的API Key"
        current_app.logger.error(f"generate: {error_msg}")
        log_llm_call("generate_employee_summary", llm_model_for_log, active_prompt, api_key_name_for_log, {'evaluations_type': str(type(evaluations))}, None, None, "error", error_msg, int((time.time() - start_time) * 1000), user_id)
        raise Exception(error_msg)

    client = genai.Client(api_key=api_key)
    evaluation_text = "# 评价数据\n\n" + str(evaluations)
    system_instruction_text = active_prompt.prompt_template
    model_api_identifier = llm_model_for_log.model_identifier if llm_model_for_log else model_to_use_identifier

    try:
        serializable_evaluations = json.loads(json.dumps(evaluations, default=str)) # 先尝试标准的 default=str
    except TypeError:
        serializable_evaluations = to_dict(evaluations) # 如果标准方法不行，用我们的 to_dict

    log_input_data ={
        "evaluation_data_passed": serializable_evaluations, # 使用序列化后的数据
        "system_instruction_details": {
            "id": str(active_prompt.id) if active_prompt else None,
            "name": active_prompt.prompt_name if active_prompt else "N/A",
            "version": active_prompt.version if active_prompt else "N/A",
        },
        "model_api_identifier_used": model_api_identifier,
    }

    contents = [types.Content(role="user", parts=[types.Part.from_text(text=evaluation_text)])]
    generate_content_config = types.GenerateContentConfig(
        response_mime_type="application/json",
        system_instruction=[types.Part.from_text(text=system_instruction_text)],
    )

    response_text = ""
    parsed_result = None
    try:
        for chunk in client.models.generate_content_stream(
            model=model_api_identifier,
            contents=contents,
            config=generate_content_config,
        ):
            response_text += chunk.text
        
        result_cleaned = response_text.strip()
        if result_cleaned.startswith("```json"): result_cleaned = result_cleaned[7:]
        if result_cleaned.startswith("```"): result_cleaned = result_cleaned[3:]
        if result_cleaned.endswith("```"): result_cleaned = result_cleaned[:-3]
        result_cleaned = result_cleaned.strip()

        parsed_result = json.loads(result_cleaned)
        
        duration_ms = int((time.time() - start_time) * 1000)
        log_llm_call("generate_employee_summary", llm_model_for_log, active_prompt, api_key_name_for_log, log_input_data, 
                     {"raw_response": response_text}, 
                     parsed_result, "success", duration_ms=duration_ms, user_id=user_id)
        return parsed_result
    except json.JSONDecodeError as e:
        current_app.logger.error(f"JSON解析失败 (generate): {e}, 原始文本: {response_text[:200]}...", exc_info=True)
        duration_ms = int((time.time() - start_time) * 1000)
        log_llm_call("generate_employee_summary", llm_model_for_log, active_prompt, api_key_name_for_log, log_input_data, 
                     {"raw_response": response_text}, 
                     None, "error", f"JSON解析失败: {str(e)[:200]}", duration_ms, user_id)
        raise Exception("AI生成的结果不是有效的JSON格式 (generate)")
    except Exception as e:
        current_app.logger.error(f"AI调用失败 (generate): {e}", exc_info=True)
        duration_ms = int((time.time() - start_time) * 1000)
        log_llm_call("generate_employee_summary", llm_model_for_log, active_prompt, api_key_name_for_log, log_input_data, 
                     {"raw_response": response_text}, 
                     None, "error", str(e), duration_ms, user_id)
        raise

def merge_kp_name(exam_results, user_id=None):
    start_time = time.time()
    if not exam_results or not isinstance(exam_results, list):
        log_llm_call("merge_kp_name", None, None, None, {'exam_results': "Invalid input"}, None, None, "error", "无效的输入数据: exam_results 不是列表或为空", int((time.time() - start_time) * 1000), user_id)
        return []

    prompt_identifier = "KNOWLEDGE_POINT_MERGING"
    default_model_identifier = "gemini-2.0-flash-lite" # 与原代码一致

    active_prompt, prompt_error = get_active_prompt_internal(prompt_identifier)
    llm_model_for_log = None
    api_key_name_for_log = None

    if prompt_error:
        current_app.logger.error(f"merge_kp_name: {prompt_error}")
        log_llm_call("merge_kp_name", None, None, None, {'exam_results_snippet': str(exam_results)[:500]}, None, None, "error", prompt_error, int((time.time() - start_time) * 1000), user_id)
        raise Exception(prompt_error)

    model_to_use_identifier = active_prompt.model_identifier or default_model_identifier
    api_key, api_key_name_for_log, llm_model_for_log, config_error = get_active_llm_config_internal("Google", model_to_use_identifier)

    if config_error:
        current_app.logger.error(f"merge_kp_name: {config_error}")
        log_llm_call("merge_kp_name", llm_model_for_log, active_prompt, api_key_name_for_log, {'exam_results_snippet': str(exam_results)[:500]}, None, None, "error", config_error, int((time.time() - start_time) * 1000), user_id)
        raise Exception(config_error)
        
    if not api_key:
        error_msg = "未能获取有效的API Key"
        current_app.logger.error(f"merge_kp_name: {error_msg}")
        log_llm_call("merge_kp_name", llm_model_for_log, active_prompt, api_key_name_for_log, {'exam_results_snippet': str(exam_results)[:500]}, None, None, "error", error_msg, int((time.time() - start_time) * 1000), user_id)
        raise Exception(error_msg)

    client = genai.Client(api_key=api_key)
    evaluation_text = str(exam_results)
    system_instruction_text = active_prompt.prompt_template
    model_api_identifier = llm_model_for_log.model_identifier if llm_model_for_log else model_to_use_identifier

    try:
        serializable_exam_results = json.loads(json.dumps(exam_results, default=str))
    except TypeError:
        serializable_exam_results = to_dict(exam_results)

    log_input_data = {
        "exam_results_passed": serializable_exam_results, # 使用序列化后的数据
        "system_instruction_details": {
            "id": str(active_prompt.id) if active_prompt else None,
            "name": active_prompt.prompt_name if active_prompt else "N/A",
            "version": active_prompt.version if active_prompt else "N/A",
        },
        "model_api_identifier_used": model_api_identifier,
    }

    contents = [types.Content(role="user", parts=[types.Part.from_text(text=evaluation_text)])]
    generate_content_config = types.GenerateContentConfig(
        response_mime_type="application/json",
        system_instruction=[types.Part.from_text(text=system_instruction_text)],
    )

    response_text = ""
    parsed_result = None
    try:
        for chunk in client.models.generate_content_stream(
            model=model_api_identifier,
            contents=contents,
            config=generate_content_config,
        ):
            response_text += chunk.text
        
        result_cleaned = response_text.strip()
        if result_cleaned.startswith("```json"): result_cleaned = result_cleaned[7:]
        if result_cleaned.startswith("```"): result_cleaned = result_cleaned[3:]
        if result_cleaned.endswith("```"): result_cleaned = result_cleaned[:-3]
        result_cleaned = result_cleaned.strip()

        parsed_result = json.loads(result_cleaned)
        
        duration_ms = int((time.time() - start_time) * 1000)
        log_llm_call("merge_kp_name", llm_model_for_log, active_prompt, api_key_name_for_log, log_input_data, 
                     {"raw_response": response_text},
                     parsed_result, "success", duration_ms=duration_ms, user_id=user_id)
        return parsed_result
    except json.JSONDecodeError as e:
        current_app.logger.error(f"JSON解析失败 (merge_kp_name): {e}, 原始文本: {response_text[:200]}...", exc_info=True)
        duration_ms = int((time.time() - start_time) * 1000)
        log_llm_call("merge_kp_name", llm_model_for_log, active_prompt, api_key_name_for_log, log_input_data, 
                     {"raw_response": response_text},
                     None, "error", f"JSON解析失败: {str(e)[:200]}", duration_ms, user_id)
        raise Exception("AI生成的结果不是有效的JSON格式 (merge_kp_name)")
    except Exception as e:
        current_app.logger.error(f"AI调用失败 (merge_kp_name): {e}", exc_info=True)
        duration_ms = int((time.time() - start_time) * 1000)
        log_llm_call("merge_kp_name", llm_model_for_log, active_prompt, api_key_name_for_log, log_input_data, 
                     {"raw_response": response_text},
                     None, "error", str(e), duration_ms, user_id)
        raise

# --- 修改 transform_text_with_llm 以匹配 generate() 的调用风格 ---
def transform_text_with_llm(
        input_text: str, 
        prompt_identifier: str,
        reference_text: str = None,
        user_id: uuid.UUID = None, 
        custom_model_identifier: 
        str = None, 
        request_timeout: int = 300
    ):
    start_time = time.time()
    
    active_prompt, prompt_error = get_active_prompt_internal(prompt_identifier)
    llm_model_for_log = None
    api_key_name_for_log = None

    if prompt_error:
        current_app.logger.error(f"transform_text_with_llm: {prompt_error}")
        log_llm_call(
            f"transform_text ({prompt_identifier})", None, None, None, 
            {'input_text_snippet': input_text[:200]}, None, None, 
            "error", prompt_error, int((time.time() - start_time) * 1000), user_id
        )
        raise Exception(prompt_error)

    model_to_use_identifier = custom_model_identifier or active_prompt.model_identifier or "gemini-1.5-flash-latest"
    api_key, api_key_name_for_log, llm_model_for_log, config_error = get_active_llm_config_internal("Google", model_to_use_identifier)

    if config_error:
        current_app.logger.error(f"transform_text_with_llm: {config_error}")
        log_llm_call(
            f"transform_text ({prompt_identifier})", llm_model_for_log, active_prompt, api_key_name_for_log,
            {'input_text_snippet': input_text[:200]}, None, None,
            "error", config_error, int((time.time() - start_time) * 1000), user_id
        )
        raise Exception(config_error)
    
    if not api_key:
        error_msg = "未能获取有效的API Key"
        current_app.logger.error(f"transform_text_with_llm: {error_msg}")
        log_llm_call(
            f"transform_text ({prompt_identifier})", llm_model_for_log, active_prompt, api_key_name_for_log,
            {'input_text_snippet': input_text[:200]}, None, None,
            "error", error_msg, int((time.time() - start_time) * 1000), user_id
        )
        raise Exception(error_msg)

    client = genai.Client(api_key=api_key) # <--- 使用 genai.Client
    
    system_instruction_text = active_prompt.prompt_template 

     # +++++ 构建用户消息，包含主要文本和参考文本 +++++
    # 构建用户消息，包含主要文本和参考文本
    user_message_parts = []
    user_message_parts.append(f"请修订以下“待修订脚本”：\n```text\n{input_text}\n```")
    if reference_text:
        user_message_parts.append(f"\n\n请在修订时主要参考以下“原始口播稿”以确保内容准确性，并保留“[uv_break]”、“[laugh]”等标记，同时将阿拉伯数字转为中文：\n```text\n{reference_text}\n```")
    user_message_for_llm = "\n".join(user_message_parts)
    
    model_api_identifier = llm_model_for_log.model_identifier if llm_model_for_log else model_to_use_identifier
        
    log_input_data = {
        "input_text_length": len(input_text),
        "reference_text_length": len(reference_text) if reference_text else 0,
        "prompt_details": {
            "id": str(active_prompt.id), "name": active_prompt.prompt_name,
            "identifier": active_prompt.prompt_identifier, "version": active_prompt.version,
        },
        "model_api_identifier_used": model_api_identifier,
        "user_message_preview": user_message_for_llm[:300]
    }
    
    # 构建 contents，与您的 generate() 函数保持一致
    contents = [
        types.Content(role="user", parts=[types.Part.from_text(text=user_message_for_llm)])
    ]
    
    # 构建 generation_config，与您的 generate() 函数保持一致
    generation_config_params = {} # 使用字典构建参数
    expected_json_output = "json" in active_prompt.prompt_template.lower() or \
                           "json" in active_prompt.prompt_name.lower() or \
                           ("json" in active_prompt.description.lower() if active_prompt.description else False)
    
    # 对于TTS脚本修订，通常期望纯文本输出，除非您的Prompt特别设计为输出JSON
    # 如果这个特定的Prompt (TTS_SCRIPT_FINAL_REFINE) 不期望JSON，则不设置response_mime_type
    # if expected_json_output: 
    #     generation_config_params["response_mime_type"] = "application/json"

    if system_instruction_text:
        generation_config_params["system_instruction"] = [types.Part.from_text(text=system_instruction_text)]
    
    generation_config_obj = types.GenerateContentConfig(**generation_config_params) if generation_config_params else None

    # request_options 通常不直接用于 client.models.generate_content_stream
    # 超时控制可能需要通过 client 级别设置或依赖默认值

    response_text = ""
    llm_output_raw = None
    parsed_output = None # 对于非JSON输出，这个可能就是 response_text

    try:
        current_app.logger.info(f"Calling LLM ({prompt_identifier}) with model: {model_api_identifier}, expecting JSON: {expected_json_output}")
        current_app.logger.debug(f"LLM Contents (for final refine): {contents}")
        current_app.logger.debug(f"LLM GenerationConfig (for final refine): {generation_config_obj}")
        
        stream_response = client.models.generate_content_stream(
            model=model_api_identifier, 
            contents=contents,
            config=generation_config_obj, # 传递对象，或者如果您的 generate() 使用 'config'，则改为 config=generation_config_obj
            # request_options=... # 如果支持的话
        )

        for chunk in stream_response:
            if hasattr(chunk, 'text') and chunk.text:
                 response_text += chunk.text
        llm_output_raw = {"raw_response": response_text, "streamed": True}

        for chunk in stream_response:
            if hasattr(chunk, 'text') and chunk.text:
                 response_text += chunk.text
        llm_output_raw = {"raw_response": response_text, "streamed": True}

        if expected_json_output:
            result_cleaned = response_text.strip()
            if result_cleaned.startswith("```json"): result_cleaned = result_cleaned[7:]
            if result_cleaned.startswith("```"): result_cleaned = result_cleaned[3:]
            if result_cleaned.endswith("```"): result_cleaned = result_cleaned[:-3]
            result_cleaned = result_cleaned.strip()
            if not result_cleaned:
                current_app.logger.warning(f"LLM返回了空的JSON字符串 ({prompt_identifier})")
                parsed_output = {} 
            else:
                parsed_output = json.loads(result_cleaned)
        else:
            parsed_output = response_text 

        duration_ms = int((time.time() - start_time) * 1000)
        log_llm_call(
            f"transform_text ({prompt_identifier})", llm_model_for_log, active_prompt, api_key_name_for_log,
            log_input_data, llm_output_raw, parsed_output,
            "success", duration_ms=duration_ms, user_id=user_id
        )
        return parsed_output if expected_json_output else response_text
        
    except json.JSONDecodeError as e_json:
        # ... (日志和异常处理不变)
        current_app.logger.error(f"LLM期望返回JSON但解析失败 ({prompt_identifier}): {e_json}, 原始文本: {response_text[:200]}...", exc_info=True)
        # ...
        raise Exception(f"AI生成结果不是有效的JSON格式 ({prompt_identifier})")
    except Exception as e:
        # ... (日志和异常处理不变)
        current_app.logger.error(f"LLM调用失败 ({prompt_identifier}): {e}", exc_info=True)
        # ...
        raise