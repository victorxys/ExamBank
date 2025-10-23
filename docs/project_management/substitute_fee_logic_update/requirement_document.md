# 需求规格说明：替班管理费逻辑更新 (v2)

## 1. 需求背景

当前系统在计算替班费用时，对不同类型的服务人员（月嫂、育儿嫂）的管理费率处理方式不统一，特别是育儿嫂的替班管理费存在硬编码或未明确定义的问题。当替班服务超出原合同期限时，需要引入一种灵活的管理费计算机制。特别地，针对“自动续签”合同和“非自动续签”合同，其合同周期的计算方式有本质区别，必须分别处理。

## 2. 目标

-   **精确数据模型**：在替班记录中增加 `substitute_management_fee_rate` 字段。
-   **明确业务规则**：为不同合同类型（自动续签/非自动续签）定义清晰的“有效结束日期”计算规则，并基于此计算管理费率。
-   **优化用户体验**：前端根据合同类型和日期，智能判断费率的默认值和读写状态。
-   **消除硬编码**：重构后端计费逻辑，使其能适应并正确处理复杂的业务场景。

## 3. 功能需求

### 3.1. 数据模型变更

1.  **修改 `SubstituteRecord` 表**：
    -   增加 `substitute_management_fee_rate` 字段，类型为 `Numeric`。

### 3.2. 后端功能

1.  **调整/新增 API 获取合同信息**:
    -   需要一个 API (例如: `GET /api/contracts/<id>/substitute-context`)，该 API 返回判断替班费率所需的所有关键信息，包括：
        -   `contract_type`: (例如: `auto_renewing_nanny`, `non_auto_renewing_nanny`)
        -   `effective_end_date`: 根据下述“有效结束日期”逻辑计算出的日期 (可能为 `null`)。

2.  **定义“有效结束日期” (`effective_end_date`) 的计算逻辑**:
    -   **对于“非自动续签合同”**: `effective_end_date` = `max(contract.end_date, contract.termination_date)` (如果 `termination_date` 为空，则只考虑 `end_date`)。
    -   **对于“自动续签合同”**:
        -   如果 `contract.termination_date` **存在**，则 `effective_end_date` = `contract.termination_date`。在这种场景下，`contract.end_date` 必须被忽略。
        -   如果 `contract.termination_date` **不存在**，则该合同视为无限期。返回的 `effective_end_date` 应为 `null`。

3.  **更新替班记录 API**:
    -   创建和更新替班记录的 API (`/api/contract/substitute-records/...`) 需要支持接收和保存 `substitute_management_fee_rate` 字段。

4.  **更新 `_calculate_substitute_details` 函数**:
    -   统一从 `SubstituteRecord` 实例的 `substitute_management_fee_rate` 字段获取管理费率，用于费用计算。

### 3.3. 前端功能 (替班记录创建/编辑页面)

1.  **获取合同上下文**:
    -   在加载页面或选择合同时，调用 `GET /api/contracts/<id>/substitute-context` 获取合同类型和有效结束日期。

2.  **费率输入框动态逻辑**:
    -   当“替班结束时间”输入框内容改变时，执行判断：
    -   **Case 1: 自动续签合同且 `effective_end_date` 为 `null`**
        -   管理费率永远为 `0`，输入框始终只读。
    -   **Case 2: 其他所有情况 (有 `effective_end_date` 的合同)**
        -   如果 `替班结束时间` > `effective_end_date`:
            -   “管理费率”输入框默认值为 `10%`，且**可编辑**。
        -   如果 `替班结束时间` <= `effective_end_date`:
            -   “管理费率”输入框值为 `0`，且**只读**。

## 4. 非功能性要求

-   **数据一致性**：历史数据迁移时，需要根据新的逻辑设定合理的默认值。
-   **代码质量**：遵循现有编码规范，关键逻辑部分（如日期计算）需要有注释说明原因。