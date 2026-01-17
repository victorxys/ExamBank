# 七牛云HLS视频播放测试指南

## 🎯 测试概述

本指南将帮助你测试七牛云HLS视频播放功能的完整集成。

## ✅ 已验证的功能

### 1. URL转换功能
- **原始URL**: `https://rss.mengyimengsao.com/videos/1768662820-final_output_fast.mp4`
- **转换后HLS URL**: `https://mengschool.mengyimengsao.com/api/v1/courses/public/video/hls-manifest?key=videos%2F1768662820-final_output_fast.mp4&token=abc123def456ghi789jkl012mno345pq`
- **状态**: ✅ 转换成功

### 2. MengSchool API连接
- **API端点**: `https://mengschool.mengyimengsao.com/api/v1/courses/public/video/hls-manifest`
- **响应**: ✅ 返回完整的HLS manifest (m3u8格式)
- **视频段数**: 约430个10秒片段 (总时长约72分钟)

## 🔧 环境配置

### 前端配置 (.env文件)
```bash
# frontend/.env.development 或 frontend/.env.local
VITE_API_URL=http://localhost:5001/api
VITE_QINIU_API_KEY=你的实际API密钥
```

### 后端配置 (.env文件)
```bash
# backend/.env
DATABASE_URL=你的数据库连接
SECRET_KEY=你的密钥
JWT_SECRET_KEY=你的JWT密钥
QINIU_API_KEY=你的实际API密钥
```

## 🧪 测试步骤

### 步骤1: 基础URL转换测试
```bash
# 运行URL转换测试
node test_video_url.js
```

**期望输出**:
```
测试视频URL: https://rss.mengyimengsao.com/videos/1768662820-final_output_fast.mp4
[videoUtils] Converted Qiniu URL to HLS: {
  original: 'https://rss.mengyimengsao.com/videos/1768662820-final_output_fast.mp4',
  key: 'videos/1768662820-final_output_fast.mp4',
  hls: 'https://mengschool.mengyimengsao.com/api/v1/courses/public/video/hls-manifest?key=videos%2F1768662820-final_output_fast.mp4&token=***'
}
```

### 步骤2: API连接测试
```bash
# 测试MengSchool API连接
curl -X GET "https://mengschool.mengyimengsao.com/api/v1/courses/public/video/hls-manifest?key=videos%2F1768662820-final_output_fast.mp4&token=你的API密钥"
```

**期望输出**: 应该返回HLS manifest内容，包含多个`.ts`文件引用

### 步骤3: 前端集成测试

1. **启动前端开发服务器**:
```bash
cd frontend
npm run dev
```

2. **创建测试资源**:
   - 在数据库中创建一个CourseResource记录
   - 设置`file_path`为: `https://rss.mengyimengsao.com/videos/1768662820-final_output_fast.mp4`

3. **访问播放页面**:
   - 导航到: `/my-courses/{courseId}/resource/{resourceId}/play`
   - 应该看到"HLS流媒体 + 七牛云"标签
   - 视频应该能正常播放

### 步骤4: 后端API测试

1. **启动后端服务器**:
```bash
cd backend
python app.py
```

2. **测试视频信息API**:
```bash
curl -H "Authorization: Bearer 你的JWT令牌" \
     "http://localhost:5001/api/resources/{resourceId}/qiniu-info"
```

**期望响应**:
```json
{
  "is_qiniu": true,
  "original_url": "https://rss.mengyimengsao.com/videos/1768662820-final_output_fast.mp4",
  "key": "videos/1768662820-final_output_fast.mp4",
  "direct_hls_url": "https://mengschool.mengyimengsao.com/api/v1/courses/public/video/hls-manifest?key=videos%2F1768662820-final_output_fast.mp4&token=你的API密钥",
  "proxy_hls_url": "/api/resources/{resourceId}/qiniu-hls-proxy",
  "recommended_url": "https://mengschool.mengyimengsao.com/api/v1/courses/public/video/hls-manifest?key=videos%2F1768662820-final_output_fast.mp4&token=你的API密钥"
}
```

## 🎬 实际测试场景

### 场景1: 新建七牛云视频资源
1. 在管理界面创建新的课程资源
2. 设置文件路径为七牛云URL: `https://rss.mengyimengsao.com/videos/1768662820-final_output_fast.mp4`
3. 保存并访问播放页面
4. 验证显示"HLS流媒体 + 七牛云"标签
5. 验证视频能正常播放

### 场景2: 本地视频回退测试
1. 创建本地视频资源 (file_path不包含mengyimengsao.com)
2. 访问播放页面
3. 验证显示"本地视频"标签
4. 验证使用原有的流媒体方式

### 场景3: 错误处理测试
1. 使用无效的API Key
2. 使用不存在的视频key
3. 验证错误信息显示正确

## 🔍 调试技巧

### 浏览器开发者工具
1. 打开Network标签
2. 查找对`hls-manifest`的请求
3. 检查响应是否为有效的m3u8内容

### 后端日志
```bash
# 查看Flask日志
tail -f logs/flask.log
```

### 前端控制台
查找以下日志信息:
- `[videoUtils] Converted Qiniu URL to HLS`
- `[MediaPlayerPage fetchData] Qiniu Cloud video detected`

## 🚨 常见问题

### 问题1: API Key无效
**症状**: 返回401或403错误
**解决**: 检查环境变量中的`QINIU_API_KEY`是否正确

### 问题2: 视频无法播放
**症状**: 播放器显示错误
**解决**: 
1. 检查浏览器是否支持HLS
2. 验证网络连接
3. 检查API响应是否正常

### 问题3: URL路径重复 (已修复)
**症状**: 错误日志显示`/api/api/resources/...`
**原因**: 前后端URL构建时重复添加`/api`前缀
**解决**: 
1. 后端返回相对路径不包含`/api`前缀
2. 前端正确处理相对和绝对URL
3. 避免路径重复拼接

### 问题4: 显示本地视频而非HLS
**症状**: 显示"本地视频"标签
**解决**: 
1. 检查URL是否包含`mengyimengsao.com`
2. 验证`isQiniuVideoUrl`函数逻辑

## 📊 性能监控

### 关键指标
- **首次播放时间**: 应在3秒内开始播放
- **缓冲频率**: 正常网络下应很少缓冲
- **错误率**: 应低于1%

### 监控方法
1. 浏览器Network面板监控请求
2. 后端日志监控API调用
3. 用户反馈收集

## 🎉 测试完成检查清单

- [ ] URL转换功能正常
- [ ] MengSchool API连接正常
- [ ] 前端正确显示HLS标签
- [ ] 视频能正常播放
- [ ] 后端API返回正确信息
- [ ] 错误处理工作正常
- [ ] 本地视频回退正常
- [ ] 性能表现良好
- [ ] URL路径不重复 (无`/api/api/`错误)
- [ ] 相对和绝对URL正确处理

完成所有检查项后，七牛云HLS集成就可以投入生产使用了！