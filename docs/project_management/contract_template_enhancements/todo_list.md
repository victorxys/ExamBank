# 合同模板管理功能增强 - 任务清单 (To-Do List)

## 后端 (Backend)
- [ ] **数据库:** 确认 `contract_templates` 表包含 `version`, `created_at`, `updated_at` 字段。
- [ ] **API:** 修改 `GET /api/contract_templates` 接口，使其返回包含版本、创建/更新时间等完整字段的列表。
- [ ] **API:** 创建新接口 `GET /api/contract_templates/<id>/is_in_use`，返回布尔值，表示模板是否已被合同使用。
- [ ] **API:** 创建新接口 `POST /api/contract_templates/<id>/save_new_version`，用于处理“另存为新版”逻辑。
- [ ] **API:** 创建新接口 `GET /api/contract_templates/<id>/diff`，返回当前版本和上一版本的内容。
- [ ] **API:** 确认 `PUT /api/contract_templates/<id>` 接口能正确更新 `updated_at` 字段。

## 前端 (Frontend)
- [ ] **路由:** 在 `App.jsx` 或路由配置文件中，添加新路由 `/contract-templates/edit/:templateId`，指向新的编辑器组件。
- [ ] **组件:** 重构 `ContractTemplateManager.jsx`，将其改为表格视图，并实现“查看”、“对比”、“删除”按钮的逻辑。
- [ ] **组件:** 创建全新的 `ContractTemplateEditor.jsx` 页面组件。
- [ ] **组件:** 在 `ContractTemplateEditor.jsx` 中实现分屏/源码双模式编辑器。
- [ ] **组件:** 在 `ContractTemplateEditor.jsx` 中实现“覆盖保存”和“另存为新版”按钮，并根据 `is_in_use` 状态禁用“覆盖保存”。
- [ ] **组件:** 创建 `ViewTemplateModal.jsx` 弹窗组件，用于预览Markdown渲染效果。
- [ ] **组件:** 创建 `DiffTemplateModal.jsx` 弹窗组件，用于并排显示版本差异。
- [ ] **集成:** 将所有组件和API调用连接起来，形成完整流畅的用户操作流程。
