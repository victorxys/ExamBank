feat: 集成七牛云HLS视频播放支持

## 🎯 功能概述
- 新增七牛云HLS (HTTP Live Streaming) 视频播放支持
- 通过MengSchool代理服务实现安全的视频流传输
- 保持对现有本地视频的完全向后兼容

## ✨ 新增功能

### 前端改进
- **智能检测**: 自动识别七牛云视频URL并切换到HLS播放模式
- **HLS支持**: 集成hls.js库，提供原生HLS流媒体播放
- **状态指示**: 添加视频类型指示器（"HLS流媒体 + 七牛云" / "本地视频"）
- **增强错误处理**: 针对HLS特定错误提供友好的错误信息
- **智能回退**: API失败时自动回退到原有播放方式

### 后端新增API
- **`GET /api/resources/{id}/qiniu-info`**: 获取视频信息并返回推荐播放URL
- **`GET /api/resources/{id}/qiniu-hls-proxy`**: 安全的七牛云HLS代理端点（可选）
- **权限验证**: 确保所有视频访问都经过适当的权限检查
- **日志记录**: 记录所有视频访问请求用于审计

### 工具函数
- **`videoUtils.js`**: 提供URL检测、转换和验证功能
- **自动转换**: 将七牛云URL转换为HLS manifest URL
- **域名检测**: 支持多种七牛云域名格式

## 🔧 技术实现

### 依赖项
- **前端**: 新增 `hls.js` 用于HLS播放支持
- **后端**: 新增 `requests` 用于代理API调用

### 环境配置
- **`VITE_QINIU_API_KEY`**: 前端七牛云API密钥
- **`QINIU_API_KEY`**: 后端七牛云API密钥

### URL处理逻辑
- 七牛云URL: `https://rss.mengyimengsao.com/videos/xxx.mp4`
- 转换为HLS: `https://mengschool.mengyimengsao.com/api/v1/courses/public/video/hls-manifest?key=videos/xxx.mp4&token={api_key}`

## 🛠️ 修复问题
- **URL路径重复**: 修复了`/api/api/resources/...`的重复路径问题
- **相对URL处理**: 改进前后端URL拼接逻辑，正确处理相对和绝对URL
- **错误处理**: 增强HLS播放错误的用户友好提示

## 📁 新增文件
- `frontend/src/utils/videoUtils.js` - 视频URL处理工具
- `docs/qiniu-hls-integration.md` - 详细的集成文档
- `backend/test_qiniu_integration.py` - 测试脚本
- `QINIU_HLS_TEST_GUIDE.md` - 完整测试指南
- `frontend/.env.example` - 前端环境变量示例
- `backend/.env.example` - 后端环境变量示例

## 🔄 向后兼容
- ✅ 现有本地视频继续正常工作
- ✅ 无需修改现有数据库记录
- ✅ 用户界面保持一致
- ✅ API接口保持兼容

## 🧪 测试状态
- ✅ URL转换功能正常
- ✅ MengSchool API连接正常  
- ✅ 前端HLS播放器集成完成
- ✅ 后端代理API实现完成
- ✅ 错误处理和回退机制正常
- 🧪 生产环境测试待进行

## 📋 使用说明
1. 配置环境变量中的七牛云API密钥
2. 创建资源时使用七牛云URL格式
3. 系统自动检测并使用HLS播放
4. 现有本地视频无需任何更改

Co-authored-by: Kiro AI Assistant