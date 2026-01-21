# backend/services/tts_server_service.py

import requests
import logging
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

class TTSServerService:
    """TTS微服务客户端 - 使用直接生成接口"""
    
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update({
            'X-API-Key': api_key,
            'Content-Type': 'application/json'
        })
    
    def synthesize_text(
        self, 
        text: str, 
        model: str = "cosyvoice-v3-flash",
        voice: str = "longanling_v3",
        format: str = "mp3",
        enable_ssml: bool = True
    ) -> bytes:
        """
        直接调用TTS微服务合成语音（简化接口）
        
        流程：
        1. 直接生成 (POST /api/tts/generate-batch) - 传入文本直接生成
        2. 下载音频 (GET /api/audio/{audio_id})
        
        Args:
            text: 要合成的文本（支持SSML）
            model: 语音模型
            voice: 语音音色
            format: 音频格式
            enable_ssml: 是否启用SSML（现在统一支持）
            
        Returns:
            bytes: 音频文件的二进制数据
            
        Raises:
            Exception: 当合成失败时抛出异常
        """
        logger.info(f"TTS-Server====: 接收到语音合成请求text:{text}")
        try:
            logger.info(f"TTS-Server: 开始合成文本，长度: {len(text)}, 模型: {model}, 音色: {voice}, SSML: {enable_ssml}")
            
            # 步骤 1: 直接调用生成接口
            generate_url = f"{self.base_url}/api/tts/generate-batch"
            payload = {
                "text": text,
                "model": model,
                "voice": voice
            }
            
            logger.debug(f"TTS-Server: 调用生成接口 - URL: {generate_url}")
            logger.debug(f"TTS-Server: 请求参数 - text长度: {len(text)}, model: {model}, voice: {voice}")
            
            generate_response = self.session.post(generate_url, json=payload, timeout=60)
            generate_response.raise_for_status()
            
            result = generate_response.json()
            audio_id = result.get("audio_id")
            
            if not audio_id:
                raise Exception(f"生成失败，未返回 audio_id。响应: {result}")
            
            logger.info(f"TTS-Server: 生成成功，audio_id: {audio_id}")
            
            # 步骤 2: 下载音频文件
            download_url = f"{self.base_url}/api/audio/{audio_id}"
            logger.debug(f"TTS-Server: 下载音频 - URL: {download_url}")
            download_response = self.session.get(download_url, timeout=30)
            download_response.raise_for_status()
            
            # 检查响应内容类型
            content_type = download_response.headers.get('content-type', '')
            if not content_type.startswith('audio/'):
                try:
                    error_data = download_response.json()
                    raise Exception(f"下载音频失败: {error_data.get('message', '未知错误')}")
                except ValueError:
                    raise Exception(f"下载音频失败: 响应不是有效的音频文件 (Content-Type: {content_type})")
            
            audio_data = download_response.content
            if len(audio_data) == 0:
                raise Exception("下载的音频文件为空")
            
            logger.info(f"TTS-Server: 音频下载成功，大小: {len(audio_data)} bytes")
            return audio_data
            
        except requests.exceptions.RequestException as e:
            logger.error(f"TTS-Server: 网络请求失败: {e}")
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_detail = e.response.json()
                    logger.error(f"TTS-Server: 错误详情: {error_detail}")
                except:
                    logger.error(f"TTS-Server: 响应内容: {e.response.text[:500]}")
            raise Exception(f"TTS-Server网络请求失败: {str(e)}")
        except Exception as e:
            logger.error(f"TTS-Server: 合成失败: {e}")
            raise Exception(f"TTS-Server合成失败: {str(e)}")
