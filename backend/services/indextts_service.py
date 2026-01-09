# backend/services/indextts_service.py
"""
IndexTTS2 服务 - 调用 Gradio API 进行语音合成
基于 IndexTTS2 的 Gradio 接口实现零样本 TTS
"""

import os
import httpx
import tempfile
import logging
from typing import Optional, Tuple, Dict, Any
from flask import current_app

logger = logging.getLogger(__name__)


class IndexTTSService:
    """IndexTTS2 语音合成服务"""
    
    # 情感控制方式
    EMOTION_METHODS = {
        "same_as_reference": "Same as the voice reference",
        "emotion_audio": "Use emotion reference audio",
        "emotion_vectors": "Use emotion vectors",
        "text_description": "Use text description to control emotion"
    }
    
    # 默认生成参数
    DEFAULT_PARAMS = {
        "emo_control_method": "Same as the voice reference",
        "emo_weight": 0.8,
        "max_text_tokens_per_segment": 120,
        "do_sample": True,
        "top_p": 0.8,
        "top_k": 30,
        "temperature": 0.8,
        "length_penalty": 0.0,
        "num_beams": 3,
        "repetition_penalty": 10.0,
        "max_mel_tokens": 1500,
        # 情感向量默认值
        "vec_happy": 0.0,
        "vec_angry": 0.0,
        "vec_sad": 0.0,
        "vec_afraid": 0.0,
        "vec_disgusted": 0.0,
        "vec_melancholic": 0.0,
        "vec_surprised": 0.0,
        "vec_calm": 0.0,
        "emo_text": "",
        "emo_random": False,
    }
    
    def __init__(self, base_url: str = None):
        """
        初始化 IndexTTS 服务
        
        Args:
            base_url: IndexTTS2 Gradio 服务的基础 URL
        """
        self.base_url = base_url or os.environ.get(
            "INDEXTTS_BASE_URL", 
            "http://test.mengyimengsao.com:37860"
        )
        self.api_url = f"{self.base_url}/gradio_api/call/gen_single"
        self.upload_url = f"{self.base_url}/gradio_api/upload"
        
    def _upload_file(self, file_path: str) -> Dict[str, Any]:
        """
        上传文件到 Gradio 服务器
        
        Args:
            file_path: 本地文件路径
            
        Returns:
            Gradio FileData 格式的字典
        """
        with open(file_path, 'rb') as f:
            files = {'files': (os.path.basename(file_path), f)}
            with httpx.Client(timeout=60.0) as client:
                response = client.post(self.upload_url, files=files)
                response.raise_for_status()
                result = response.json()
        
        logger.info(f"IndexTTS: 文件上传响应: {result}")
        
        # Gradio 返回格式可能是:
        # 1. [{"path": "...", "url": "...", ...}] - 列表包含字典
        # 2. ["path/to/file"] - 列表包含字符串路径
        # 3. {"path": "..."} - 直接返回字典
        if isinstance(result, list) and len(result) > 0:
            uploaded = result[0]
            if isinstance(uploaded, dict):
                return {
                    "path": uploaded.get("path", uploaded.get("name")),
                    "url": uploaded.get("url"),
                    "orig_name": os.path.basename(file_path),
                    "meta": {"_type": "gradio.FileData"}
                }
            elif isinstance(uploaded, str):
                # 返回的是字符串路径
                return {
                    "path": uploaded,
                    "url": None,
                    "orig_name": os.path.basename(file_path),
                    "meta": {"_type": "gradio.FileData"}
                }
        elif isinstance(result, dict):
            return {
                "path": result.get("path", result.get("name")),
                "url": result.get("url"),
                "orig_name": os.path.basename(file_path),
                "meta": {"_type": "gradio.FileData"}
            }
        elif isinstance(result, str):
            return {
                "path": result,
                "url": None,
                "orig_name": os.path.basename(file_path),
                "meta": {"_type": "gradio.FileData"}
            }
        
        raise ValueError(f"文件上传失败，未获取到有效响应: {result}")
    
    def generate_audio(
        self,
        text: str,
        voice_reference_path: str,
        emotion_reference_path: Optional[str] = None,
        params: Optional[Dict[str, Any]] = None
    ) -> Tuple[bytes, str]:
        """
        生成语音
        
        Args:
            text: 要合成的文本
            voice_reference_path: 参考音频文件路径（用于克隆音色）
            emotion_reference_path: 情感参考音频路径（可选）
            params: 生成参数，覆盖默认值
            
        Returns:
            (audio_bytes, mime_type) 元组
        """
        import json
        
        # 合并参数
        final_params = {**self.DEFAULT_PARAMS, **(params or {})}
        
        logger.info(f"IndexTTS: 开始生成语音，文本长度: {len(text)}")
        logger.info(f"IndexTTS: 参考音频: {voice_reference_path}")
        logger.info(f"IndexTTS: 参数: {final_params}")
        
        # 上传参考音频
        voice_ref_data = self._upload_file(voice_reference_path)
        logger.info(f"IndexTTS: 参考音频已上传: {voice_ref_data}")
        
        # 上传情感参考音频（如果有）
        emo_ref_data = None
        if emotion_reference_path and os.path.exists(emotion_reference_path):
            emo_ref_data = self._upload_file(emotion_reference_path)
            logger.info(f"IndexTTS: 情感参考音频已上传: {emo_ref_data}")
        
        # 构建 API 请求数据
        request_data = {
            "data": [
                final_params.get("emo_control_method", self.EMOTION_METHODS["same_as_reference"]),
                voice_ref_data,
                text,
                emo_ref_data,
                final_params.get("emo_weight", 0.8),
                final_params.get("vec_happy", 0.0),
                final_params.get("vec_angry", 0.0),
                final_params.get("vec_sad", 0.0),
                final_params.get("vec_afraid", 0.0),
                final_params.get("vec_disgusted", 0.0),
                final_params.get("vec_melancholic", 0.0),
                final_params.get("vec_surprised", 0.0),
                final_params.get("vec_calm", 0.0),
                final_params.get("emo_text", ""),
                final_params.get("emo_random", False),
                final_params.get("max_text_tokens_per_segment", 120),
                final_params.get("do_sample", True),
                final_params.get("top_p", 0.8),
                final_params.get("top_k", 30),
                final_params.get("temperature", 0.8),
                final_params.get("length_penalty", 0.0),
                final_params.get("num_beams", 3),
                final_params.get("repetition_penalty", 10.0),
                final_params.get("max_mel_tokens", 1500),
            ]
        }
        
        with httpx.Client(timeout=300.0) as client:
            # Step 1: 提交任务
            logger.info(f"IndexTTS: 提交生成请求到 {self.api_url}")
            response = client.post(self.api_url, json=request_data)
            response.raise_for_status()
            result = response.json()
            
            event_id = result.get("event_id")
            if not event_id:
                raise ValueError(f"未获取到 event_id: {result}")
            
            logger.info(f"IndexTTS: 获取到 event_id: {event_id}")
            
            # Step 2: 获取结果 (SSE)
            result_url = f"{self.base_url}/gradio_api/call/gen_single/{event_id}"
            response = client.get(result_url, timeout=300.0)
            response.raise_for_status()
            
            # 按行分割响应内容
            lines = response.text.split('\n')
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                logger.info(f"IndexTTS SSE line: {line[:300] if len(line) > 300 else line}")
                
                if line.startswith("event:"):
                    event_type = line[6:].strip()
                    logger.info(f"IndexTTS: SSE event type: {event_type}")
                    continue
                
                if not line.startswith("data:"):
                    continue
                    
                data_str = line[5:].strip()
                if not data_str or data_str == "null":
                    continue
                
                try:
                    data = json.loads(data_str)
                except json.JSONDecodeError as e:
                    logger.warning(f"IndexTTS: 无法解析 JSON: {data_str[:200]}, error: {e}")
                    continue
                
                logger.info(f"IndexTTS: SSE data parsed: {str(data)[:500]}")
                
                # 检查是否是最终结果
                if not isinstance(data, list) or len(data) == 0:
                    continue
                    
                audio_info = data[0]
                logger.info(f"IndexTTS: audio_info type: {type(audio_info)}, value: {str(audio_info)[:500]}")
                
                audio_url = None
                
                if isinstance(audio_info, dict):
                    # 检查嵌套的 value 字段
                    if 'value' in audio_info and isinstance(audio_info['value'], dict):
                        inner_value = audio_info['value']
                        audio_url = inner_value.get("url") or inner_value.get("path")
                        logger.info(f"IndexTTS: 从嵌套 value 中获取 URL: {audio_url}")
                    else:
                        audio_url = audio_info.get("url") or audio_info.get("path")
                        logger.info(f"IndexTTS: 从顶层获取 URL: {audio_url}")
                elif isinstance(audio_info, str):
                    audio_url = audio_info
                    logger.info(f"IndexTTS: audio_info 是字符串: {audio_url}")
                
                if not audio_url:
                    logger.warning(f"IndexTTS: 未能从响应中提取 audio_url")
                    continue
                
                # 构建完整 URL
                if not audio_url.startswith("http"):
                    if audio_url.startswith("/"):
                        audio_url = f"{self.base_url}/gradio_api/file={audio_url}"
                    else:
                        audio_url = f"{self.base_url}/file={audio_url}"
                
                logger.info(f"IndexTTS: 开始下载音频文件: {audio_url}")
                
                # 下载音频文件
                audio_response = client.get(audio_url, timeout=60.0)
                audio_response.raise_for_status()
                audio_data = audio_response.content
                
                content_type = audio_response.headers.get("content-type", "audio/wav")
                logger.info(f"IndexTTS: 音频下载成功，大小: {len(audio_data)} bytes, type: {content_type}")
                return audio_data, content_type
        
        raise ValueError("未能获取到生成的音频数据")


def generate_audio_with_indextts(
    text_to_speak: str,
    voice_reference_path: str,
    emotion_reference_path: Optional[str] = None,
    base_url: Optional[str] = None,
    **params
) -> Tuple[bytes, str]:
    """
    便捷函数：使用 IndexTTS2 生成语音
    
    Args:
        text_to_speak: 要合成的文本
        voice_reference_path: 参考音频文件路径
        emotion_reference_path: 情感参考音频路径（可选）
        base_url: IndexTTS2 服务 URL（可选）
        **params: 其他生成参数
        
    Returns:
        (audio_bytes, mime_type) 元组
    """
    service = IndexTTSService(base_url=base_url)
    return service.generate_audio(
        text=text_to_speak,
        voice_reference_path=voice_reference_path,
        emotion_reference_path=emotion_reference_path,
        params=params
    )
