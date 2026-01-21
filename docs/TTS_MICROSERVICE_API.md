# ExamDB 集成文档 - TTS Server API 调用指南

## 概述

本文档说明如何从 examdb 项目调用 TTS Server (端口 5002) 生成语音。

## 服务信息

- **服务地址**: `http://localhost:5002` (同服务器调用)
- **API 密钥**: `dev-admin-key-123` (开发环境)
- **数据库**: `backend/storage/tts.db`

## 推荐调用方式（给 examdb）

### 直接生成接口 ⭐

**端点**: `POST /api/tts/generate-batch`

**说明**: 直接传入文本生成音频，不需要创建文档、拆分句子。examdb 可以自己决定是单句调用还是批量多句调用。

**请求体**:
```json
{
  "text": "要转换的文本内容",
  "model": "cosyvoice-v3-flash",
  "voice": "longanling_v3"
}
```

**参数说明**:
- `text` (必填): 要转换的文本，支持普通文本和 SSML
- `model` (可选): TTS 模型，默认 `cosyvoice-v3-flash`
- `voice` (可选): 音色，默认 `longanling_v3`

**响应**:
```json
{
  "audio_id": 123,
  "download_url": "/api/audio/123",
  "filename": "tts_a1b2c3d4e5f6.mp3",
  "file_size": 45678
}
```

**下载音频**:
```python
audio_url = f"http://localhost:5002{download_url}"
# 或者
audio_url = f"http://localhost:5002/api/audio/{audio_id}"
```

## 核心 API 端点

### 1. 创建文档

**端点**: `POST /api/documents`

**说明**: 创建文档时会自动拆分句子。如果文本包含 `<speak>` 标签，则不拆分，保持完整。

**请求体**:
```json
{
  "title": "文档标题",
  "content": "这是要转换的文本内容",
  "model": "cosyvoice-v3-flash",
  "voice": "longanling_v3"
}
```

**参数说明**:
- `title` (必填): 文档标题
- `content` (必填): 文本内容
  - 普通文本：会按标点符号自动拆分成句子
  - SSML 文本：如果包含 `<speak>` 标签，不拆分，保持完整
- `model` (可选): TTS 模型，默认 `cosyvoice-v3-flash`
- `voice` (可选): 音色，默认 `longanyang`

**响应**:
```json
{
  "id": 1,
  "title": "文档标题",
  "model": "cosyvoice-v3-flash",
  "voice": "longanling_v3",
  "status": "draft",
  "total_sentences": 1,
  "completed_sentences": 0,
  "created_at": "2026-01-20T10:00:00"
}
```

### 2. 获取文档详情（含句子列表）

**端点**: `GET /api/documents/{doc_id}`

**说明**: 获取文档信息和所有句子的 ID，用于后续生成音频。

**响应**:
```json
{
  "id": 1,
  "title": "文档标题",
  "content": "原始文本内容",
  "model": "cosyvoice-v3-flash",
  "voice": "longanling_v3",
  "status": "draft",
  "total_sentences": 1,
  "completed_sentences": 0,
  "sentences": [
    {
      "id": 1669,
      "order_index": 0,
      "original_text": "<speak>完整的SSML文本</speak>",
      "current_text": "<speak>完整的SSML文本</speak>",
      "status": "pending",
      "audio_file_id": null
    }
  ]
}
```

### 3. 生成单个句子的音频 ⭐

**端点**: `POST /api/tts/generate/{sentence_id}`

**说明**: 为指定句子生成音频。这是核心接口，直接调用即可生成音频。

**请求体**: 空（使用句子的 `current_text` 字段）

**响应**:
```json
{
  "id": 1669,
  "order_index": 0,
  "original_text": "<speak>完整的SSML文本</speak>",
  "current_text": "<speak>完整的SSML文本</speak>",
  "status": "completed",
  "audio_file_id": 123,
  "audio_file": {
    "id": 123,
    "filename": "1_1669_a1b2c3d4.mp3",
    "file_size": 45678,
    "model": "cosyvoice-v3-flash",
    "voice": "longanling_v3",
    "created_at": "2026-01-20T10:01:00"
  }
}
```

### 4. 批量生成文档所有句子 ⭐

**端点**: `POST /api/tts/generate-batch/{doc_id}`

**说明**: 批量生成文档中所有待处理句子的音频。

**请求体**: 空

**响应**:
```json
{
  "message": "Batch generation completed",
  "processed": 1,
  "failed": 0,
  "document": {
    "id": 1,
    "status": "completed",
    "completed_sentences": 1,
    "total_sentences": 1
  }
}
```

### 5. 下载音频文件

**端点**: `GET /api/audio/{audio_id}`

**说明**: 下载生成的音频文件。

**响应**: 音频文件流 (audio/mpeg)

**下载链接构建**:
```python
audio_url = f"http://localhost:5002/api/audio/{audio_id}"
```

## Python 调用示例

### 示例 1: 简单调用（推荐给 examdb）

```python
import requests

BASE_URL = "http://localhost:5002"

def generate_audio_simple(text, model="cosyvoice-v3-flash", voice="longanling_v3"):
    """
    最简单的调用方式：创建文档 → 生成音频 → 下载
    
    Args:
        text: 要转换的文本（支持 SSML）
        model: TTS 模型
        voice: 音色
        
    Returns:
        bytes: 音频文件的二进制数据
    """
    # 步骤 1: 创建文档（自动拆分句子，SSML 不拆分）
    doc_response = requests.post(
        f"{BASE_URL}/api/documents",
        json={
            "title": "TTS临时文档",
            "content": text,
            "model": model,
            "voice": voice
        },
        timeout=30
    )
    doc_response.raise_for_status()
    doc_data = doc_response.json()
    doc_id = doc_data["id"]
    
    # 步骤 2: 获取文档详情（获取句子 ID）
    doc_detail_response = requests.get(
        f"{BASE_URL}/api/documents/{doc_id}",
        timeout=10
    )
    doc_detail_response.raise_for_status()
    doc_detail = doc_detail_response.json()
    
    if not doc_detail.get("sentences"):
        raise Exception("文档没有句子")
    
    # 步骤 3: 生成第一个句子的音频
    sentence_id = doc_detail["sentences"][0]["id"]
    generate_response = requests.post(
        f"{BASE_URL}/api/tts/generate/{sentence_id}",
        timeout=60
    )
    generate_response.raise_for_status()
    sentence_data = generate_response.json()
    
    audio_id = sentence_data.get("audio_file_id")
    if not audio_id:
        raise Exception("生成音频失败，未返回 audio_id")
    
    # 步骤 4: 下载音频
    download_response = requests.get(
        f"{BASE_URL}/api/audio/{audio_id}",
        timeout=30
    )
    download_response.raise_for_status()
    
    return download_response.content

# 使用示例
try:
    # 支持普通文本
    audio_binary = generate_audio_simple(
        text="你是一名专业的育儿嫂培训师，请用口语化的培训师的口吻以及标准的普通话来讲解以下内容：",
        model="cosyvoice-v3-flash",
        voice="longanling_v3"
    )
    
    # 也支持 SSML 文本（不会被拆分）
    audio_binary_ssml = generate_audio_simple(
        text='<speak>以下是<phoneme alphabet="py" ph="nèi róng">内容</phoneme>映射与补充方案。</speak>',
        model="cosyvoice-v3-flash",
        voice="longanling_v3"
    )
    
    # 保存音频文件
    with open("output.mp3", "wb") as f:
        f.write(audio_binary)
    
    print(f"音频生成成功，大小: {len(audio_binary)} 字节")
    
except requests.exceptions.HTTPError as e:
    print(f"HTTP 错误: {e}")
    print(f"响应内容: {e.response.text}")
except Exception as e:
    print(f"错误: {e}")
```

### 示例 2: 批量生成多句语音

```python
import requests

BASE_URL = "http://localhost:5002"

def generate_batch_audio(text, model="cosyvoice-v3-flash", voice="longanling_v3"):
    """
    批量生成多句语音
    
    Args:
        text: 要转换的文本（会自动拆分成句子）
        model: TTS 模型
        voice: 音色
        
    Returns:
        list: 音频下载链接列表
    """
    # 步骤 1: 创建文档
    doc_response = requests.post(
        f"{BASE_URL}/api/documents",
        json={
            "title": "批量文档",
            "content": text,
            "model": model,
            "voice": voice
        }
    )
    doc_response.raise_for_status()
    doc_data = doc_response.json()
    doc_id = doc_data["id"]
    
    # 步骤 2: 批量生成所有句子的音频
    batch_response = requests.post(
        f"{BASE_URL}/api/tts/generate-batch/{doc_id}",
        timeout=300  # 批量生成可能需要较长时间
    )
    batch_response.raise_for_status()
    batch_data = batch_response.json()
    
    print(f"处理完成: {batch_data['processed']} 成功, {batch_data['failed']} 失败")
    
    # 步骤 3: 获取文档详情，获取所有音频 ID
    doc_detail_response = requests.get(f"{BASE_URL}/api/documents/{doc_id}")
    doc_detail_response.raise_for_status()
    doc_detail = doc_detail_response.json()
    
    # 步骤 4: 构建下载链接
    audio_urls = []
    for sentence in doc_detail["sentences"]:
        if sentence["status"] == "completed" and sentence["audio_file_id"]:
            audio_url = f"{BASE_URL}/api/audio/{sentence['audio_file_id']}"
            audio_urls.append({
                "text": sentence["current_text"],
                "url": audio_url,
                "audio_id": sentence["audio_file_id"]
            })
    
    return audio_urls

# 使用示例
try:
    text = """
    这是第一句话。
    这是第二句话！
    这是第三句话？
    """
    
    audio_list = generate_batch_audio(text)
    
    for i, audio_info in enumerate(audio_list):
        print(f"句子 {i+1}: {audio_info['text']}")
        print(f"下载链接: {audio_info['url']}")
        
        # 下载音频
        response = requests.get(audio_info['url'])
        with open(f"sentence_{i+1}.mp3", "wb") as f:
            f.write(response.content)
    
except Exception as e:
    print(f"错误: {e}")
```

### 示例 3: 集成到 examdb 的 tts_server_service.py

```python
import requests
import logging

logger = logging.getLogger(__name__)

class TTSServerService:
    def __init__(self, server_url="http://localhost:5002", api_key="dev-admin-key-123"):
        self.server_url = server_url.rstrip('/')
        self.api_key = api_key
    
    def synthesize_text(self, text, model="cosyvoice-v3-flash", voice="longanling_v3", **kwargs):
        """
        合成文本为语音
        
        Args:
            text: 要合成的文本
            model: TTS 模型
            voice: 音色
            
        Returns:
            bytes: 音频文件的二进制数据
        """
        try:
            logger.info(f"TTS-Server: 开始合成文本，长度: {len(text)}, 模型: {model}, 音色: {voice}")
            
            # 步骤 1: 创建文档
            doc_response = requests.post(
                f"{self.server_url}/api/documents",
                json={
                    "title": "TTS临时文档",
                    "content": text,
                    "model": model,
                    "voice": voice
                },
                timeout=30
            )
            doc_response.raise_for_status()
            doc_data = doc_response.json()
            doc_id = doc_data["id"]
            
            # 步骤 2: 获取文档详情
            doc_detail_response = requests.get(
                f"{self.server_url}/api/documents/{doc_id}",
                timeout=10
            )
            doc_detail_response.raise_for_status()
            doc_detail = doc_detail_response.json()
            
            if not doc_detail.get("sentences"):
                raise Exception("文档没有句子")
            
            # 步骤 3: 生成第一个句子的音频
            sentence_id = doc_detail["sentences"][0]["id"]
            generate_response = requests.post(
                f"{self.server_url}/api/tts/generate/{sentence_id}",
                timeout=60
            )
            generate_response.raise_for_status()
            sentence_data = generate_response.json()
            
            audio_id = sentence_data.get("audio_file_id")
            if not audio_id:
                raise Exception("生成音频失败，未返回 audio_id")
            
            logger.info(f"TTS-Server: 合成成功，audio_id: {audio_id}")
            
            # 步骤 4: 下载音频
            download_response = requests.get(
                f"{self.server_url}/api/audio/{audio_id}",
                timeout=30
            )
            download_response.raise_for_status()
            
            return download_response.content
            
        except requests.exceptions.HTTPError as e:
            logger.error(f"TTS-Server: 网络请求失败: {str(e)}")
            raise Exception(f"TTS-Server网络请求失败: {str(e)}")
        except Exception as e:
            logger.error(f"TTS-Server: 合成失败: {str(e)}")
            raise Exception(f"TTS-Server合成失败: {str(e)}")
```

## 常见问题

### Q1: SSML 文本会被拆分吗？

A: 不会。如果文本包含 `<speak>` 标签，系统会识别为 SSML 文本，不会拆分，保持完整作为一个句子。

### Q2: 如何处理长文本？

A: 使用批量生成接口 `POST /api/tts/generate-batch/{doc_id}`，系统会自动拆分并逐句生成。

### Q3: 音频文件存储在哪里？

A: 音频文件存储在 `backend/storage/audio/` 目录，通过 `/api/audio/{audio_id}` 访问。

### Q4: 如何获取音频下载链接？

A: 生成音频后，响应中包含 `audio_file_id`，构建下载链接：
```python
download_url = f"http://localhost:5002/api/audio/{audio_file_id}"
```

### Q5: 为什么要先创建文档？

A: 这是 TTS Server 的设计架构，通过文档管理可以：
- 支持句子级别的编辑和重新生成
- 跟踪生成状态和历史记录
- 支持批量操作和音频合并
- 提供更好的错误处理和重试机制

## 错误处理

### 404 错误

如果遇到 404 错误，检查：
1. 端口是否正确（5002 而不是 5003）
2. 路由是否正确（`/api/documents` 而不是 `/api/v1/tts/synthesize`）
3. 服务是否正在运行

### 500 错误

如果遇到 500 错误，检查：
1. API 密钥是否配置（`.env.local` 中的 `DASHSCOPE_API_KEY`）
2. 数据库是否存在（`backend/storage/tts.db`）
3. 音频存储目录是否可写（`backend/storage/audio/`）

## 健康检查

```bash
curl http://localhost:5002/health
```

响应：
```json
{
  "status": "ok",
  "has_api_key": true
}
```

## 总结

从 examdb 调用 TTS Server 的关键步骤：

1. **创建文档** → 获取 `doc_id`（SSML 文本不会被拆分）
2. **获取句子列表** → 获取 `sentence_id`
3. **生成音频** → 调用 `POST /api/tts/generate/{sentence_id}` 或 `POST /api/tts/generate-batch/{doc_id}`
4. **下载音频** → 使用 `audio_id` 构建下载链接 `GET /api/audio/{audio_id}`

**重要提示**：
- SSML 文本（包含 `<speak>` 标签）不会被拆分，保持完整
- 使用 `generate_sentence_audio` 或 `generate_batch_audio` 接口直接生成音频
- 不需要调用 `/api/v1/tts/synthesize`，这个端点不存在
