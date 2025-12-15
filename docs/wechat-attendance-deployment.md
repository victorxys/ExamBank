# 微信考勤功能部署指南

## 功能概述

微信公众号"我的考勤"功能允许员工通过微信公众号菜单直接访问考勤系统，首次使用需要验证身份信息（姓名+身份证号），验证成功后自动关联微信openid，后续访问无需再次验证。

## 部署步骤

### 1. 数据库迁移

```bash
# 运行迁移添加wechat_openid字段
cd backend
python -c "
from app import app
from extensions import db
from flask_migrate import upgrade
with app.app_context():
    upgrade()
"
```

或者手动执行SQL：
```sql
ALTER TABLE service_personnel ADD COLUMN wechat_openid VARCHAR(100) UNIQUE;
CREATE INDEX ix_service_personnel_wechat_openid ON service_personnel(wechat_openid);
```

### 2. 环境变量配置

#### 后端配置 (backend/.env)
```bash
# 微信公众号配置
WECHAT_APP_ID=wx1234567890abcdef
WECHAT_APP_SECRET=your_app_secret_here

# 前端基础URL
FRONTEND_BASE_URL=https://your-domain.com
```

#### 前端配置 (frontend/.env.production)
```bash
# 微信公众号AppID
REACT_APP_WECHAT_APP_ID=wx1234567890abcdef

# API基础URL
REACT_APP_API_BASE_URL=https://your-domain.com

# 前端基础URL
REACT_APP_FRONTEND_BASE_URL=https://your-domain.com
```

### 3. 微信公众号配置

#### 3.1 设置可信域名
在微信公众平台后台设置以下域名为可信域名：
- JS接口安全域名：`your-domain.com`
- 网页授权域名：`your-domain.com`

#### 3.2 配置公众号菜单
使用微信公众平台接口或后台工具配置菜单：

```json
{
  "button": [
    {
      "name": "员工服务",
      "sub_button": [
        {
          "type": "view",
          "name": "我的考勤",
          "url": "https://your-domain.com/wechat-attendance"
        }
      ]
    }
  ]
}
```

### 4. 前端构建和部署

```bash
cd frontend
npm run build
# 将dist目录部署到Web服务器
```

### 5. 后端部署

```bash
cd backend
# 安装依赖
pip install -r requirements.txt

# 启动服务
gunicorn -c gunicorn_config.py backend.app:app
```

## API接口说明

### 员工身份验证
```
POST /api/wechat-attendance/verify-employee
Content-Type: application/json

{
  "openid": "微信用户openid",
  "name": "员工姓名",
  "id_card_number": "身份证号"
}
```

### 获取考勤列表
```
GET /api/wechat-attendance/my-attendance?openid={openid}&year={year}&month={month}
```

### 获取员工信息
```
GET /api/wechat-attendance/employee-info?openid={openid}
```

## 安全考虑

1. **身份验证安全**：
   - 使用姓名+身份证号双重验证
   - 一个微信账号只能关联一个员工
   - 一个员工只能关联一个微信账号

2. **数据传输安全**：
   - 使用HTTPS加密传输
   - 敏感信息不在URL中传递

3. **访问控制**：
   - 只有已关联的员工才能访问考勤信息
   - 考勤数据按员工隔离

## 测试流程

### 1. 本地测试
```bash
# 启动后端
cd backend && python app.py

# 启动前端
cd frontend && npm run dev

# 访问测试页面
http://localhost:5175/wechat-attendance?openid=test_openid_123
```

### 2. 微信环境测试
1. 配置微信公众号测试账号
2. 设置菜单指向测试环境
3. 在微信中点击菜单测试完整流程

## 故障排查

### 常见问题

1. **无法获取openid**
   - 检查微信JS-SDK配置
   - 确认域名已添加到可信域名列表
   - 检查微信授权流程

2. **身份验证失败**
   - 检查员工信息是否存在于数据库
   - 确认姓名和身份证号输入正确
   - 检查数据库连接

3. **考勤表不显示**
   - 检查员工是否有有效合同
   - 确认合同时间范围覆盖查询月份
   - 检查考勤表创建逻辑

### 日志查看
```bash
# 查看应用日志
tail -f logs/flask.log

# 查看Nginx日志
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

## 监控和维护

1. **定期检查**：
   - 微信access_token是否正常刷新
   - 考勤表创建是否正常
   - 员工关联状态是否正确

2. **数据备份**：
   - 定期备份service_personnel表
   - 备份考勤相关数据

3. **性能监控**：
   - 监控API响应时间
   - 检查数据库查询性能
   - 监控微信接口调用频率