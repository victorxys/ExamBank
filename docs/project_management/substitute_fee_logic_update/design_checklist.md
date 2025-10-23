# 设计检查清单 (Design Checklist)

## 1. 数据模型 (Data Model)

-   [ ] **字段定义检查**
    -   **如何检查**: 查看 `backend/models.py` 中的 `SubstituteRecord` 模型。
    -   **检查项**: 是否已添加 `substitute_management_fee_rate` 字段？字段类型是否为 `db.Numeric` 以保证精度？是否设置了合理的默认值（例如 `server_default='0.00'`)？
    -   **模拟结果**: `检查通过` - 假设字段已正确添加。

-   [ ] **数据库迁移检查**
    -   **如何检查**: 查看 `migrations/versions/` 目录下新生成的迁移文件。
    -   **检查项**: 迁移脚本中 `op.add_column` 是否正确指向 `substitute_record` 表？`sa.Numeric` 类型和默认值是否与模型定义一致？`op.drop_column` 是否也已定义以便回滚？
    -   **模拟结果**: `检查通过` - 假设迁移脚本已正确生成。

## 2. 后端 API

-   [ ] **合同结束日期 API 检查**
    -   **如何检查**: 审阅 `backend/api/contract_api.py` 中的新 `GET` 接口代码。
    -   **检查项**: 接口是否能正确处理 `contract_id` 不存在的情况？是否能正确处理 `termination_date` 或 `end_date` 为 `None` 的情况？返回的日期格式是否为标准格式（如 ISO 8601）？
    -   **模拟调用**: `GET /api/contracts/<id>/effective-end-date`
    -   **模拟结果**: `检查通过` - 假设 API 返回了 `{'effective_end_date': 'YYYY-MM-DD'}`。

-   [ ] **替班记录 API 更新检查**
    -   **如何检查**: 审阅 `backend/api/contract_api.py` 中处理 `POST` 和 `PUT` `/api/contract/substitute-records/...` 的函数。
    -   **检查项**: API 是否能从请求的 JSON body 中正确解析 `substitute_management_fee_rate`？在创建或更新 `SubstituteRecord` 对象时，该值是否被正确赋值？
    -   **模拟调用**: `POST /api/contract/substitute-records/...` with `{'substitute_management_fee_rate': 0.1}`
    -   **模拟结果**: `检查通过` - 假设数据库中对应记录的 `substitute_management_fee_rate` 字段被存为 `0.1`。

## 3. 核心业务逻辑

-   [ ] **`_calculate_substitute_details` 函数重构检查**
    -   **如何检查**: 审阅 `backend/services/billing_engine.py` 中的 `_calculate_substitute_details` 函数。
    -   **检查项**: 是否已移除所有 `if substitute_type == 'maternity_nurse'` 之类的硬编码费率逻辑？计算 `management_fee_rate` 是否统一从 `sub_record.substitute_management_fee_rate` 获取？当 `substitute_management_fee_rate` 为 0 或其他值时，计算结果是否符合预期？
    -   **模拟调用**: `_calculate_substitute_details(sub_record)` where `sub_record.substitute_management_fee_rate` is `0.1`.
    -   **模拟结果**: `检查通过` - 假设函数返回的 `management_fee` 是基于 `0.1` 的费率计算得出的，而不是硬编码值。

## 4. 前端交互

-   [ ] **管理费率输入框显示检查**
    -   **如何检查**: 审阅前端替班记录表单的相关 React 组件代码。
    -   **检查项**: “管理费率”输入框是否对所有服务类型都可见？
    -   **模拟结果**: `检查通过` - 假设 UI 上已显示该输入框。

-   [ ] **动态逻辑实现检查**
    -   **如何检查**: 审阅替班记录表单组件中处理“替班结束时间”变化的事件处理器。
    -   **检查项**: 当日期改变时，是否触发了对 `GET /api/contracts/<id>/effective-end-date` 的 API 调用？是否根据返回的日期正确设置了费率输入框的 `defaultValue` 和 `readOnly` 属性？
    -   **模拟结果**: `检查通过` - 假设当选择一个超出合同的日期时，费率框变为 `10%` 且可编辑；否则变为 `0` 且只读。

## 5. 测试覆盖

-   [ ] **单元测试覆盖检查**
    -   **如何检查**: 查看 `backend/tests/` 目录下相关的测试文件。
    -   **检查项**: 是否有新的测试用例专门验证 `_calculate_substitute_details` 在不同 `substitute_management_fee_rate` 值下的计算结果？
    -   **模拟结果**: `检查通过` - 假设已添加相关测试。

-   [ ] **集成测试覆盖检查**
    -   **如何检查**: 查看相关的集成测试或 E2E 测试脚本。
    -   **检查项**: 是否有测试模拟了“前端修改日期 -> 后端保存费率 -> 触发账单计算”的完整流程？
    -   **模拟结果**: `检查待定` - 集成测试通常在功能完成后编写。
