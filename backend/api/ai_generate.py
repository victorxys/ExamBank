# backend/api/ai_generate.py
import os
import time # 用于计时
import json # 确保导入 json
from flask import current_app # 用于日志记录
from google import genai
from google.genai import types
# from dotenv import load_dotenv # 如果 API Key 从数据库读取，这个可能不再直接需要

# 从新位置导入模型和数据库会话
from backend.models import LlmModel, LlmApiKey, LlmPrompt, LlmCallLog, db # 确保导入 db
# from backend.api.llm_config_api import get_active_llm_config, get_active_prompt # 导入辅助函数
# 由于循环导入问题，将这些辅助函数移到 ai_generate.py 或一个新的 utils 文件
# 这里我们暂时将它们定义在 ai_generate.py 内部或从一个共享的 utils 文件导入

# --- Helper functions (可以移到 utils.py) ---
from backend.security_utils import decrypt_data # 确保能正确导入

def to_dict(obj): # 这个函数的参数是 obj，保持不变
    if hasattr(obj, '__sa_instance_state__'):
        # 处理 SQLAlchemy DateTime 和 Date 类型，确保它们是 JSON 可序列化的
        # 并且只处理列属性，避免关系属性导致的无限递归
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
    elif isinstance(obj, (datetime.datetime, datetime.date)): # 如果顶层就是 datetime 对象
        return obj.isoformat()
    return obj

def get_active_llm_config_internal(provider_name, model_identifier=None):
    api_key_record = LlmApiKey.query.filter_by(provider=provider_name, status='active').first()
    if not api_key_record:
        return None, None, None, f"未找到提供商 '{provider_name}' 的活动API Key"
    try:
        api_key = decrypt_data(api_key_record.api_key_encrypted)
        if not api_key: # 解密失败或为空
            return None, api_key_record.key_name, None, f"API Key '{api_key_record.key_name}' 解密失败或为空"
    except Exception as e:
        current_app.logger.error(f"解密API Key '{api_key_record.key_name}' 失败: {e}", exc_info=True)
        return None, api_key_record.key_name, None, f"API Key '{api_key_record.key_name}' 解密时发生错误"

    llm_model_obj = None # 使用不同的变量名以区分
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
# --- End Helper functions ---


def log_llm_call(function_name, model, prompt, api_key_name, input_data, output_data_raw, parsed_output, status, error_message=None, duration_ms=None, user_id=None):
    """记录LLM调用日志"""
    try:
        # 确保 input_data 和 output_data 是可序列化为 JSON 的
        def make_json_safe(data): # 这个函数的参数是 data
            if isinstance(data, dict):
                return {k: make_json_safe(v) for k, v in data.items()}
            elif isinstance(data, list):
                return [make_json_safe(i) for i in data]
            elif isinstance(data, (str, int, float, bool, type(None))):
                return data
            else:
                # 对于无法直接序列化的类型
                if hasattr(data, '__sa_instance_state__'): # <--- 修改这里：obj 改为 data
                    try:
                        return to_dict(data) # 传递 data 给 to_dict
                    except Exception as e_todict:
                        current_app.logger.debug(f"make_json_safe: to_dict 转换 SQLAlchemy 对象失败 {type(data)}: {e_todict}, 回退到 str()")
                        return str(data) # 如果 to_dict 也失败，再回退
                elif hasattr(data, '__dict__'): # 对于其他有 __dict__ 的普通对象
                    try:
                        # 尝试只提取部分关键信息或避免循环引用
                        # 增加对可调用属性和特殊内置属性的过滤
                        return {
                            k: make_json_safe(v) 
                            for k, v in data.__dict__.items() 
                            if not k.startswith('_') and not callable(v) # 使用 v (属性值) 进行 callable检查
                        }
                    except Exception as e_dict:
                         current_app.logger.debug(f"make_json_safe: __dict__ 转换失败 {type(data)}: {e_dict}, 回退到 str()")
                         return str(data)
                return str(data) # 最终回退

        safe_input = make_json_safe(input_data)
        current_app.logger.debug(f"Safe input for log: {safe_input}") # 保持这个调试日志

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