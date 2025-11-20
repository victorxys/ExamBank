# 测试用例 (Test Cases)

本文档定义了“动态表单与记录管理系统”功能的核心测试用例。

---

## A. 单元测试 (Unit Tests)

### 测试用例: A-1: `sync_mapping` 服务函数

- **测试目的**: 验证处理数据同步的核心服务函数在各种情况下的行为是否正确。
- **涉及模块/文件**: `backend/services/form_sync_service.py` (假设)
- **输入**:
    1.  一个包含 `sync_mapping` 配置的 `DynamicForm` 对象。
    2.  一份模拟的表单提交 `data` JSON。
    3.  一个 mock 的数据库会话 (session)。
- **期望输出**:
    1.  数据库会话的 `execute` 方法被以一个动态生成的、正确的 `UPDATE` 语句调用。
    2.  `UPDATE` 语句的 `WHERE` 子句和参数与输入数据匹配。
    3.  如果 `sync_mapping` 为空，则不执行任何 `UPDATE` 操作。
- **实际输出 & 测试结果**:
    - 单元测试: [待填充]
    - **最终检查结果:** [待填充]

### 测试用例: A-2: 金数据到 SurveyJS 的转换器

- **测试目的**: 验证转换器能否将一个金数据字段结构正确转换为 SurveyJS 字段结构。
- **涉及模块/文件**: `scripts/migrate_jinshuju_forms.py`
- **输入**:
    1.  单个金数据字段的 JSON 对象，类型为 `single_line_text`。
    2.  单个金数据字段的 JSON 对象，类型为 `single_choice`。
    3.  单个金数据字段的 JSON 对象，类型为 `form_association`。
- **期望输出**:
    1.  输入1应转换为 `{ "type": "text", ... }`。
    2.  输入2应转换为 `{ "type": "radiogroup", "choices": [...] }`。
    3.  输入3应转换为 `{ "type": "record_association", "association_config": {...} }`。
- **实际输出 & 测试结果**:
    - 单元测试: [待填充]
    - **最终检查结果:** [待填充]

---

## B. 集成测试 (Integration Tests)

### 测试用例: B-1: 端到端的数据同步流程

- **测试目的**: 验证从提交表单到核心表数据更新的完整流程。
- **涉及模块/文件**: `POST /api/form-data`, `service_personnel` 表
- **输入**:
    1.  在数据库中预先创建一个带 `sync_mapping` 的 `DynamicForm` 记录。
    2.  在数据库中预先创建一个 `service_personnel` 记录。
    3.  通过 API 发送一个 `POST` 请求到 `/api/form-data`，请求体包含与 `sync_mapping` 匹配的字段。
- **期望输出**:
    1.  API 返回 `201 Created`。
    2.  `dynamic_form_data` 表中出现一条新记录。
    3.  `service_personnel` 表中对应的记录，其列（如 `address`）已被更新为提交的值。
    4.  如果提交的数据不完整导致同步失败，整个事务回滚，数据库中不应有新数据。
- **实际输出 & 测试结果**:
    - 集成测试: [待填充]
    - **最终检查结果:** [待填充]

### 测试用例: B-2: 端到端的数据关联与聚合流程

- **测试目的**: 验证记录关联的创建和查询聚合。
- **涉及模块/文件**: `PATCH /api/form-data/{id}`, `GET /api/form-data/{id}`
- **输入**:
    1.  预先创建“员工”和“合同”两条记录。
    2.  通过 `PATCH` API 更新“员工”记录，将其 `record_association` 字段的值设置为“合同”记录的 ID。
    3.  通过 `GET` API 查询这条“员工”记录。
- **期望输出**:
    1.  `PATCH` 请求成功。
    2.  `GET` 请求的响应体中，包含 `resolved_associations` 字段，其中含有被关联的“合同”记录的完整数据。
- **实际输出 & 测试结果**:
    - 集成测试: [待填充]
    - **最终检查结果:** [待填充]

### 测试用例: B-3: 字段级权限控制

- **测试目的**: 验证不同角色对私有字段的读写权限是否符合预期。
- **涉及模块/文件**: `GET /api/form-data/{id}`, `PATCH /api/form-data/{id}`
- **输入**:
    1.  预先创建一条包含 `private` 字段的员工记录。
    2.  获取一个“普通员工”角色的认证 Token。
    3.  获取一个“HR”角色的认证 Token。
- **期望输出**:
    1.  使用“员工”Token 调用 `GET`，响应体中**不包含**私有字段。
    2.  使用“HR”Token 调用 `GET`，响应体中**包含**私有字段。
    3.  使用“员工”Token 调用 `PATCH` 尝试修改私有字段，API 应返回 `403 Forbidden`。
    4.  使用“HR”Token 调用 `PATCH` 尝试修改私有字段，API 应返回 `200 OK`。
- **实际输出 & 测试结果**:
    - 集成测试: [待填充]
    - **最终检查结果:** [待填充]
