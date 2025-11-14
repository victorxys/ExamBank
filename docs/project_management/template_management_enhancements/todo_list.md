# To-Do List: 合同模板管理功能优化

## 阶段一: 后端与数据库准备 (Foundation)

-   [ ] **数据库**:
    -   [ ] 在 `ContractTemplate` 模型 (`backend/models.py`) 中增加 `remark` 字段 (`db.Text`)。
    -   [ ] 使用 `flask db migrate` 生成数据库迁移脚本。
    -   [ ] 使用 `flask db upgrade` 应用迁移。

-   [ ] **后端API (`backend/api/contract_template_api.py`)**:
    -   [ ] **修改创建逻辑 (`POST /api/contract_templates`)**:
        -   [ ] 接收 `remark` 参数。
        -   [ ] 实现“每个`contract_type`只能有一个`template_name`”的规则。
        -   [ ] 处理“第一个模板可命名”的特殊情况。
    -   [ ] **修改列表查询逻辑 (`GET /api/contract_templates`)**:
        -   [ ] 在返回结果中包含 `remark` 字段。
        -   [ ] 增加 `search` 和 `contract_type` 请求参数，用于模糊搜索和类型筛选。
    -   [ ] **新增对比API (`POST /api/contract_templates/compare`)**:
        -   [ ] 接收两个模板ID (`template_id_1`, `template_id_2`)。
        -   [ ] 验证两个模板的 `contract_type` 是否相同。
        -   [ ] 返回两个模板的内容和版本信息。

## 阶段二: 前端功能实现 (Implementation)

-   [ ] **模板创建/编辑流程 (`CreateTemplateModal.jsx` 或类似组件)**:
    -   [ ] 增加 "模板备注" (`remark`) 的输入框。
    -   [ ] 重构 "模板名称" (`template_name`) 的逻辑：
        -   [ ] 根据所选 `contract_type` 查询是否已有模板存在。
        -   [ ] 如果不存在，允许编辑名称，并提供默认值。
        -   [ ] 如果已存在，禁用名称输入框。
    -   [ ] 更新创建模板时的API调用，传递 `remark`。

-   [ ] **列表页功能 (`ContractTemplateManager.jsx`)**:
    -   [ ] **UI组件**:
        -   [ ] 添加用于模糊搜索的 `TextField`。
        -   [ ] 添加用于筛选 `contract_type` 的 `Select` 或 `Autocomplete`。
        -   [ ] 在模板表格的每一行前添加 `Checkbox`。
        -   [ ] 添加一个“对比已选”按钮。
    -   [ ] **状态管理**:
        -   [ ] 管理搜索词、筛选类型和已勾选模板ID列表的状态。
    -   [ ] **逻辑实现**:
        -   [ ] 实现前端或后端驱动的搜索和筛选功能。
        -   [ ] 根据已勾选模板的状态，控制“对比已选”按钮的可用性（必须是两个，且类型相同）。

-   [ ] **跨版本对比功能**:
    -   [ ] 创建一个新的 `CrossVersionDiffModal.jsx` 组件（或改造现有 `DiffTemplateModal`）。
    -   [ ] 该组件应接收两个模板的内容和版本信息作为 `props`。
    -   [ ] 在 `ContractTemplateManager.jsx` 中，当点击“对比已选”按钮时：
        -   [ ] 调用新的 `POST /api/contract_templates/compare` API。
        -   [ ] 将返回的数据传递给 `CrossVersionDiffModal` 并显示它。

## 阶段三: 测试与收尾 (Verification)

-   [ ] **单元/集成测试**:
    -   [ ] 为新的API端点和修改后的API编写后端测试。
    -   [ ] 验证前端组件在各种场景下的行为是否符合预期。
-   [ ] **端到端测试**:
    -   [ ] 完整测试一遍创建、搜索、筛选、对比的全流程。
    -   [ ] 测试所有边界情况（例如，选择3个模板进行对比，选择不同类型的模板对比等）。
-   [ ] **代码审查与重构**:
    -   [ ] 清理代码，移除无用逻辑。
    -   [ ] 确保代码风格统一。
