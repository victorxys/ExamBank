# 月度结算单 (Monthly Statement) 功能详细设计文档

| 版本 | 日期 | 作者 | 变更内容 |
| :--- | :--- | :--- | :--- |
| 1.0 | 2025-09-25 | Linus Torvalds | 初始草案 |
| 1.1 | 2025-09-26 | Linus Torvalds | 更新开发进展 |

## 1. 需求背景与目标

### 1.1. 背景

在当前系统中，账单 (`CustomerBill`) 的生成与单个服务合同 (`Contract`) 的生命周期严格绑定。当一个客户与员工的服务在同一个日历月内跨越了两个连续的非月签合同时（例如，合同A在8月4日结束，合同B在8月4日开始），系统会为这个月份生成两张独立的账单。

这种设计虽然在数据层面是准确的，但与实际业务操作习惯严重不符。在业务上，客户期望为每个日历月收到的所有服务支付一笔总费用，而不是在同一个月内处理多张账单和付款。

### 1.2. 核心痛点

1.  **用户体验不佳**：客户在一个月内收到多张账单，感到困惑，增加了支付的复杂性。
2.  **财务对账困难**：财务人员需要手动将同一月份的多张账单合并计算，以核对客户的付款，效率低下且容易出错。
3.  **关键财务事件割裂**：与合同生命周期绑定的关键财务事件（如首月收取保证金、末月退还保证金）被分散在不同的账单中，无法在一个统一的视图中清晰地呈现给客户。

### 1.3. 项目目标

1.  **统一支付体验**：为客户提供一个按自然月统一的结算视图，使其每月只需支付一笔总费用。
2.  **保证财务严谨性**：在优化用户体验的同时，底层数据必须保持绝对的准确性、独立性和可追溯性。每个合同的财务事件必须清晰地与原始合同关联。
3.  **无缝向上兼容**：新功能不应破坏或影响现有其他类型合同（如月签合同）的计费逻辑。

## 2. 核心设计理念

本方案严格遵循 **“数据与表现分离”** 的核心原则。

-   **保持数据纯粹性 (Data Purity)**：我们 **不会合并** 底层的 `CustomerBill` 记录。每一张 `CustomerBill` 依然独立生成，并严格与它的源合同 (`Contract`) 关联。这保证了所有财务数据的原子性和记账的准确性，任何与合同相关的费用（如管理费、保证金）都保留在其原始的、不可变的上下文中。

-   **创建表现层包装器 (Presentation Layer Wrapper)**：我们将引入一个新的逻辑层和数据模型——`MonthlyStatement`（月度结算单）。它不处理具体的财务计算，而是作为一个“信封”或“容器”，将属于同一客户、同一自然月的所有 `CustomerBill` 聚合起来，为用户提供一个统一的、面向支付的视图。

这种分层设计，使得底层数据模型干净、稳定，同时又能在表现层灵活地满足业务需求，是具有“好品味”的解决方案。

## 3. 模型设计 (Data Model)

### 3.1. 新增: `MonthlyStatement` (月度结算单) 表

此表是新功能的核心，用于聚合月度账单。

**表名:** `monthly_statements`

| 字段名 | 类型 | 约束/注释 |
| :--- | :--- | :--- |
| `id` | `Integer` | Primary Key, Auto-increment |
| `customer_id` | `Integer` | Foreign Key to `users.id`, Not Null |
| `year` | `Integer` | 年份, e.g., `2025`, Not Null |
| `month` | `Integer` | 月份, e.g., `8`, Not Null |
| `total_amount` | `Numeric(10, 2)` | 本期应付总额 (所有关联账单总额), Not Null, Default 0.00 |
| `paid_amount` | `Numeric(10, 2)` | 已付总额, Not Null, Default 0.00 |
| `status` | `String(20)` | 状态 (`UNPAID`, `PARTIALLY_PAID`, `PAID`, `VOID`), Not Null, Default `UNPAID` |
| `created_at` | `DateTime` | 创建时间 |
| `updated_at` | `DateTime` | 最后更新时间 |

**索引:**
-   `ix_monthly_statements_customer_id_year_month` (唯一约束): 确保一个客户在一个月只有一张结算单。
-   `ix_monthly_statements_status`: 加速按状态查询。

### 3.2. 修改: `CustomerBill` (客户账单) 表

在现有 `CustomerBill` 表中增加一个外键，将其与 `MonthlyStatement` 关联。

**表名:** `customer_bills`

| 字段名 (新增) | 类型 | 约束/注释 |
| :--- | :--- | :--- |
| `statement_id` | `Integer` | Foreign Key to `monthly_statements.id`, Nullable |

**索引 (新增):**
-   `ix_customer_bills_statement_id`: 加速查找属于同一结算单的所有账单。

## 4. 核心逻辑与流程设计

### 4.1. 结算单的生成与关联

此过程应在 `CustomerBill` 创建后自动触发，推荐使用异步任务处理以避免阻塞主流程。

**流程:**
1.  **触发**: `Billing Engine` 成功创建一个 `CustomerBill` 记录。
2.  **入队**: 系统触发一个异步任务（如 Celery Task），例如 `process_statement_for_bill(bill_id)`。
3.  **执行任务**:
    a. 任务根据 `bill_id` 获取 `CustomerBill` 实例。
    b. 根据 `bill.customer_id`, `bill.year`, `bill.month` 查询 `MonthlyStatement`。
    c. **如果 `MonthlyStatement` 不存在**，则创建一个新的实例。
    d. **将 `bill.statement_id` 更新为** 对应的 `statement.id`。
    e. **重新计算** `statement.total_amount`：`SUM(bill.total_amount)` for all bills where `statement_id = statement.id`。
    f. 根据 `total_amount` 和 `paid_amount` **更新 `statement.status`**。
    g. 将所有变更在一个事务中提交到数据库。

### 4.2. 支付流程

用户的支付行为将直接面向 `MonthlyStatement`。

**流程:**
1.  **用户操作**: 用户在UI上点击“支付”按钮，该按钮与一个 `statement_id` 关联。
2.  **API调用**: 前端调用 `POST /api/statements/{statement_id}/pay`，并传递支付金额。
3.  **后端处理** (必须在单个数据库事务中完成):
    a. 创建一条支付记录 (`PaymentRecord`)。
    b. 更新 `MonthlyStatement` 的 `paid_amount` 和 `status`。
    c. **分配支付金额**: 将收到的款项按预定规则分配到该 `Statement` 关联的各个 `CustomerBill` 上。推荐使用 **FIFO (先进先出)** 规则，即优先冲抵最早创建的 `CustomerBill`。
    d. 相应更新每个被冲抵的 `CustomerBill` 的 `paid_amount` 和 `status`。

### 4.3. API 设计

| Method | Endpoint | 描述 |
| :--- | :--- | :--- |
| `GET` | `/api/statements` | 获取当前登录用户的月度结算单列表，支持分页。 |
| `GET` | `/api/statements/{statement_id}` | 获取单个结算单的详细信息，返回结果中需包含其关联的所有 `CustomerBill` 的详细列表。 |
| `POST`| `/api/statements/{statement_id}/pay` | 为指定的结算单创建一笔支付。 |
| `GET` | `/api/bills/{bill_id}` | (修改现有API) 获取账单详情时，如果 `statement_id` 存在，需一并返回。 |

## 5. 界面设计 (UI/UX)

1.  **账单列表页**:
    -   默认视图从 `CustomerBill` 列表改为 `MonthlyStatement` 列表。
    -   每行显示 "YYYY年MM月结算单"、总金额、状态（待支付/已支付等）和操作按钮。

2.  **结算单详情页**:
    -   页面顶部显示总览信息：结算周期、应付总额、状态、支付按钮。
    -   下方以卡片或列表形式，**分组展示** 构成此结算单的所有费用明细。分组标题应清晰指明费用来源的合同，例如：
        -   **"来自合同 [合同A名称/编号] 的费用"**
            -   服务费 (8月1日-8月4日): +XXX元
            -   保证金退还: -YYY元
        -   **"来自合同 [合同B名称/编号] 的费用"**
            -   服务费 (8月4日-8月31日): +ZZZ元
            -   合同管理费: +MMM元
            -   保证金: +NNN元

3.  **合同详情页**:
    -   原有的账单列表保持不变，但每条账单记录旁应增加一个链接，可以跳转到它所属的 `MonthlyStatement`。

## 6. 迁移与部署

1.  **数据库迁移 (Migration)**:
    -   编写 Alembic 迁移脚本，用于创建 `monthly_statements` 表和修改 `customer_bills` 表。
2.  **数据回填 (Data Backfilling)**:
    -   在部署后，需运行一个一次性的数据脚本。该脚本遍历所有现存的 `CustomerBill`，根据其 `customer_id`, `year`, `month` 创建对应的 `MonthlyStatement`，并回填 `customer_bills.statement_id`。
3.  **部署顺序**:
    -   1. 部署后端代码（包含迁移脚本）。
    -   2. 运行数据库迁移命令。
    -   3. （在维护窗口）运行数据回填脚本。
    -   4. 部署前端代码。

## 7. 风险与考量

-   **事务性**: 支付分配和状态更新的逻辑必须保证原子性，防止出现结算单状态已更新、但底层账单状态更新失败的数据不一致问题。
-   **性能**: `MonthlyStatement` 的 `total_amount` 重新计算逻辑虽然在异步任务中，但如果一个结算单关联了大量账单（罕见但可能），求和操作需要确保高效。对 `customer_bills.statement_id` 的索引至关重要。
-   **边缘情况**:
    -   **账单作废**: 如果一张 `CustomerBill` 被作废，必须触发一个任务来更新其父 `MonthlyStatement` 的总金额和状态。
    -   **部分支付**: 支付流程必须能正确处理部分支付，并相应更新 `Statement` 和 `Bill` 的状态。

## 8. 开发进展

### 8.1. 后端逻辑 (已完成)

-   **[已完成]** 已确认 `MonthlyStatement` 和 `CustomerBill` 的数据库模型已根据设计文档正确实现。
-   **[已完成]** 已确认异步任务 `process_statement_for_bill` 已在 `backend/tasks.py` 中实现，其逻辑符合设计要求。
-   **[已完成]** 发现 `process_statement_for_bill` 任务在账单创建或更新后并未被触发。
-   **[已完成]** 为了解决现有代码中数据库提交逻辑分散的问题，我在 `BillingEngine` 内部实现了一个追踪机制，用于收集在单次操作中所有被修改的账单。
-   **[已完成]** 已修改核心的计费任务 (`calculate_monthly_billing_task`, `post_virtual_contract_creation_task`)，确保它们在数据库事务提交后，能为所有受影响的账单触发 `process_statement_for_bill` 任务。
-   **[已完成]** 已将 `BillingEngine` 中的 `process_substitution` 和 `process_trial_termination` 函数重构为不直接提交数据库事务，并为它们创建了相应的 Celery 任务 (`process_substitution_task`, `process_trial_termination_task`)。这些任务现在负责处理事务，并能在完成后正确触发月度结算单的处理流程。
-   **[已完成]** 在 `backend/api/statement_api.py` 中实现了月度结算单的 `GET` API，用于获取结算单列表和详情。
-   **[已完成]** 在 `BillingEngine` 中实现了 `process_statement_payment` 方法，用于处理支付和按 FIFO 规则分配款项。同时在 `statement_api.py` 中添加了 `POST /api/statements/{id}/pay` 接口来调用此逻辑。

### 8.2. 下一步计划

-   **[待办]** 实现前端界面，包括月度结算单列表页和详情页，并集成支付功能。