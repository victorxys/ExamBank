# To-Do List: 替班管理费逻辑更新

## 阶段一：数据库与后端准备

-   [ ] **1. 数据库迁移**:
    -   在 `SubstituteRecord` model 中添加 `substitute_management_fee_rate` 字段。
    -   生成并执行 Alembic 数据库迁移脚本。

-   [ ] **2. 更新后端 Model**:
    -   修改 `backend/models.py` 中的 `SubstituteRecord` 类，加入新字段。

-   [ ] **3. 创建辅助 API**:
    -   在 `contract_api.py` 中添加一个新的 API endpoint，用于根据合同 ID 查询其有效的结束日期 `max(termination_date, end_date)`。

-   [ ] **4. 更新替班记录 API**:
    -   修改 `POST` 和 `PUT` `/api/contract/substitute-records/...` 的逻辑，使其能够接收并保存 `substitute_management_fee_rate`。

## 阶段二：核心逻辑修改

-   [ ] **5. 重构计费函数**:
    -   修改 `backend/services/billing_engine.py` 中的 `_calculate_substitute_details` 函数。
    -   移除旧的、针对特定角色的费率判断逻辑。
    -   统一从 `sub_record.substitute_management_fee_rate` 读取费率进行计算。

## 阶段三：前端实现

-   [ ] **6. 修改前端组件**:
    -   定位并修改负责添加/编辑替班记录的前端组件。
    -   添加“管理费率” (`substitute_management_fee_rate`) 的输入框。

-   [ ] **7. 实现前端动态逻辑**:
    -   在“替班结束时间”输入框的 `onChange` 事件中，调用后端新的辅助 API 获取合同结束日期。
    -   根据返回的日期和当前输入的替班结束时间，实现需求文档中描述的费率默认值（10% 或 0）和只读状态切换逻辑。

## 阶段四：测试与验证

-   [ ] **8. 编写后端单元测试**:
    -   为 `_calculate_substitute_details` 函数编写新的测试用例，覆盖不同费率（0%，10%，其他值）和不同服务类型（月嫂、育儿嫂）的场景。

-   [ ] **9. 编写集成测试**:
    -   测试从“创建替班记录 -> API 保存 -> 费用计算”的完整流程是否正确。

-   [ ] **10. 手动前端测试**:
    -   在界面上验证管理费率输入框的显隐、默认值和只读状态是否按预期工作。
    -   提交后，验证数据是否正确保存。
