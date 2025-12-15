# 微信公众号菜单配置

## 菜单结构

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
        },
        {
          "type": "view", 
          "name": "员工评价",
          "url": "https://your-domain.com/public-employee-self-evaluation"
        }
      ]
    },
    {
      "name": "客户服务",
      "sub_button": [
        {
          "type": "view",
          "name": "服务评价",
          "url": "https://your-domain.com/client-evaluation"
        }
      ]
    },
    {
      "name": "联系我们",
      "type": "click",
      "key": "CONTACT_US"
    }
  ]
}
```

## 配置说明

### 我的考勤功能
- **菜单名称**: "我的考勤"
- **类型**: view (网页链接)
- **URL**: `https://your-domain.com/wechat-attendance`
- **功能**: 
  - 首次访问需要验证姓名和身份证号
  - 验证成功后自动关联微信openid
  - 后续访问直接显示考勤列表

### 使用流程

1. **首次使用**:
   - 用户点击"我的考勤"菜单
   - 跳转到身份验证页面
   - 输入姓名和身份证号进行验证
   - 验证成功后关联微信openid

2. **后续使用**:
   - 用户点击"我的考勤"菜单
   - 直接显示考勤表列表
   - 可以选择不同月份查看
   - 点击进入具体考勤表填写

### API接口

- `GET /api/wechat-attendance/employee-info?openid={openid}` - 获取员工信息
- `POST /api/wechat-attendance/verify-employee` - 验证员工身份
- `GET /api/wechat-attendance/my-attendance?openid={openid}&year={year}&month={month}` - 获取考勤列表
- `GET /api/wechat-attendance/attendance-form/{form_token}` - 获取考勤表详情

### 数据库变更

在 `service_personnel` 表中新增字段：
- `wechat_openid` (VARCHAR(100), UNIQUE, INDEX) - 微信公众号openid

### 安全考虑

1. **身份验证**: 通过姓名+身份证号双重验证确保安全
2. **唯一性**: 一个微信账号只能关联一个员工
3. **防重复**: 一个员工只能关联一个微信账号
4. **数据保护**: 敏感信息加密存储

### 部署注意事项

1. 确保前端域名已在微信公众号后台配置为可信域名
2. 配置正确的 `FRONTEND_BASE_URL` 环境变量
3. 运行数据库迁移添加 `wechat_openid` 字段
4. 测试微信JS-SDK获取openid功能