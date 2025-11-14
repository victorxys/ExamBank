# 合同模板管理功能增强 - 设计检查清单 (Design Checklist)

## 1. 数据模型 (Data Model)
- [ ] **检查项:** `contract_templates` 表是否包含 `version` (Integer), `created_at` (DateTime), `updated_at` (DateTime) 字段？
- **检查方法:** 查看 `backend/models.py` 中的 `ContractTemplate` 模型定义。
- **检查结果:** [待填充]

## 2. API 设计 (API Design)
- [ ] **检查项:** `GET /api/contract_templates` 是否返回了列表中所需的所有字段？
- **检查方法:** 模拟调用该API，并检查返回的JSON对象数组是否包含 `id`, `template_name`, `version`, `contract_type`, `created_at`, `updated_at`。
- **检查结果:** [待填充]

- [ ] **检查项:** `GET /api/contract_templates/<id>/is_in_use` 是否能正确工作？
- **检查方法:** 模拟调用一个已使用的模板ID，应返回 `{"is_in_use": true}`。模拟调用一个未使用的模板ID，应返回 `{"is_in_use": false}`。
- **检查结果:** [待填充]

- [ ] **检查项:** `POST /api/contract_templates/<id>/save_new_version` 是否能正确创建新版本？
- **检查方法:** 模拟调用该API。检查数据库是否新增了一条记录，其 `template_name` 相同，但 `version` 加1，且 `id` 是新的。
- **检查结果:** [待填充]

- [ ] **检查项:** `GET /api/contract_templates/<id>/diff` 是否能正确返回两个版本的内容？
- **检查方法:** 模拟调用一个 `version > 1` 的模板ID。检查返回的JSON是否包含 `current_content` 和 `previous_content`。
- **检查结果:** [待填充]

## 3. 前端架构 (Frontend Architecture)
- [ ] **检查项:** 是否规划了独立的路由用于编辑页面？
- **检查方法:** 检查路由配置文件，确认存在 `/contract-templates/edit/:templateId` 路径。
- **检查结果:** [待填充]

- [ ] **检查项:** 编辑器组件是否与列表组件分离？
- **检查方法:** 确认存在 `ContractTemplateManager.jsx` 和 `ContractTemplateEditor.jsx` 两个独立的文件。
- **检查结果:** [待填充]

## 4. 核心逻辑 (Core Logic)
- [ ] **检查项:** “覆盖保存”按钮的禁用逻辑是否正确实现？
- **检查方法:** 在 `ContractTemplateEditor.jsx` 中，检查 `useEffect` 钩子是否在组件加载时调用 `is_in_use` API，并根据返回结果设置按钮的 `disabled` 属性。
- **检查结果:** [待填充]

- [ ] **检查项:** 版本对比功能是否仅对 `version > 1` 的模板启用？
- **检查方法:** 在 `ContractTemplateManager.jsx` 的列表渲染逻辑中，检查“对比”按钮是否有一个 `disabled={template.version <= 1}` 的属性。
- **检查结果:** [待填充]
