# To-Do List: 修复员工信息创建 404 错误

- [ ] **后端开发**
    - [ ] 在 `backend/api/staff_api.py` 中添加 `POST /create-from-form/<uuid:data_id>` 路由。
    - [ ] 实现数据提取逻辑：从 `DynamicFormData` 中提取姓名、手机、身份证、地址。
    - [ ] 实现员工创建逻辑：检查重复，创建/更新 `ServicePersonnel`。
    - [ ] 添加错误处理：处理数据不存在或字段缺失的情况。

- [ ] **测试**
    - [ ] 编写单元测试/集成测试，模拟表单提交并验证员工创建。
    - [ ] 手动验证：使用前端页面点击按钮，确认员工创建成功。
