# 七牛云HLS视频播放集成

## 概述

本系统现已支持七牛云HLS（HTTP Live Streaming）视频播放，通过MengSchool代理服务实现安全的视频流传输。

## 功能特性

### 前端功能
- **自动检测**: 自动识别七牛云视频URL并切换到HLS播放模式
- **HLS支持**: 使用hls.js库提供原生HLS播放支持
- **回退机制**: 如果HLS播放失败，自动回退到原始URL
- **状态指示**: 显示当前使用的播放方式（HLS流媒体/本地视频）
- **错误处理**: 针对HLS特定错误提供友好的错误信息

### 后端功能
- **代理服务**: 提供安全的七牛云HLS代理端点
- **权限验证**: 确保只有授权用户可以访问视频流
- **日志记录**: 记录所有视频访问请求用于审计
- **信息API**: 提供视频信息和推荐播放URL的API端点

## API端点

### 1. 获取视频信息
```
GET /api/resources/{resource_id}/qiniu-info
```

**响应示例（七牛云视频）:**
```json
{
  "is_qiniu": true,
  "original_url": "https://rss.mengyimengsao.com/videos/example.mp4",
  "key": "videos/example.mp4",
  "direct_hls_url": "http://mengschool.mengyimengsao.com/api/v1/courses/public/video/hls-manifest?key=videos%2Fexample.mp4",
  "proxy_hls_url": "/api/resources/{resource_id}/qiniu-hls-proxy",
  "recommended_url": "http://mengschool.mengyimengsao.com/api/v1/courses/public/video/hls-manifest?key=videos%2Fexample.mp4"
}
```

**响应示例（本地视频）:**
```json
{
  "is_qiniu": false,
  "original_url": "uploads/videos/local_video.mp4",
  "stream_url": "/api/resources/{resource_id}/stream?access_token={token}",
  "recommended_url": "/api/resources/{resource_id}/stream?access_token={token}"
}
```

### 2. 七牛云HLS代理
```
GET /api/resources/{resource_id}/qiniu-hls-proxy
```

此端点作为MengSchool API的安全代理，提供额外的权限验证和日志记录。

## 前端使用

### 工具函数

```javascript
import { getVideoUrl, isQiniuVideoUrl, isHLSUrl } from '../utils/videoUtils';

// 检查是否为七牛云URL
const isQiniu = isQiniuVideoUrl('https://rss.mengyimengsao.com/videos/example.mp4');

// 转换为HLS URL
const hlsUrl = getVideoUrl('https://rss.mengyimengsao.com/videos/example.mp4');

// 检查是否为HLS URL
const isHLS = isHLSUrl(hlsUrl);
```

### ReactPlayer配置

系统自动配置ReactPlayer以支持HLS播放：

```javascript
<ReactPlayer
  url={streamUrlWithToken}
  config={{
    file: {
      attributes: { controlsList: 'nodownload' },
      forceAudio: isAudio,
      forceVideo: isVideo,
      // HLS配置（当useHLS为true时）
      hlsOptions: {
        debug: false,
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90
      }
    }
  }}
/>
```

## 配置

### 环境变量

确保以下配置正确：

```bash
# MengSchool API基础URL（在videoUtils.js中配置）
MENGSCHOOL_API=http://mengschool.mengyimengsao.com
```

### 依赖项

前端需要安装hls.js：

```bash
cd frontend
npm install hls.js
```

后端需要安装requests：

```bash
cd backend
pip install requests
```

## 支持的视频格式

### 七牛云视频
- 自动转换为HLS流（.m3u8）
- 支持自适应码率
- 优化的缓冲和加载

### 本地视频
- MP4, WebM, OGV等标准格式
- 通过现有的流媒体端点提供

## 错误处理

系统提供针对不同错误类型的友好提示：

- **HLS错误**: "HLS视频流播放错误，请检查网络连接或稍后重试"
- **网络错误**: "网络连接错误，无法加载视频流"
- **权限错误**: "权限不足或认证失败，请刷新页面或重新登录"

## 性能优化

### 直接访问 vs 代理访问

- **直接访问**: 使用MengSchool API直接获取HLS流，性能最佳
- **代理访问**: 通过本系统代理，提供额外安全性和日志记录

系统默认使用直接访问以获得最佳性能，但提供代理选项用于需要额外控制的场景。

## 监控和日志

所有视频访问请求都会记录到应用日志中，包括：

- 用户身份和权限验证
- 视频资源访问
- HLS流请求
- 错误和异常情况

## 故障排除

### 常见问题

1. **HLS播放失败**
   - 检查网络连接
   - 验证MengSchool API可访问性
   - 查看浏览器控制台错误信息

2. **权限错误**
   - 确认用户有资源访问权限
   - 检查JWT token有效性
   - 验证资源存在且可访问

3. **性能问题**
   - 考虑使用CDN加速
   - 检查网络带宽
   - 优化HLS配置参数

### 调试模式

在开发环境中，可以启用详细日志：

```javascript
// 在videoUtils.js中启用调试
console.log('[videoUtils] Converted Qiniu URL to HLS:', {
  original: qiniuVideoUrl,
  key: key,
  hls: hlsUrl
});
```

## 未来改进

- [ ] 支持更多七牛云域名
- [ ] 添加视频质量选择
- [ ] 实现播放统计和分析
- [ ] 支持字幕和多音轨
- [ ] 添加播放速度记忆功能