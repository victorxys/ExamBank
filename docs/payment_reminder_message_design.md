# 催款信息一键复制功能详细设计文档

| 版本 | 日期 | 作者 | 变更内容 |
| :--- | :--- | :--- | :--- |
| 1.1 | 2025-09-25 | Linus Torvalds | 根据代码分析和补充需求，确认最终版 V3.3 方案 |

## 1. 需求背景与目标

### 1.1. 背景

当前，运营人员在向客户催款时，需要手动从系统各处复制信息（客户名、员工名、服务周期、金额等），并按照固定的格式手动拼凑计算过程和银行账户信息，最终形成催款文本消息。这个过程耗时、繁琐，且极易出错。

### 1.2. 核心痛点

1.  **效率低下**：为每个账单手动组合信息是重复性劳动。
2.  **容易出错**：手动计算或复制数字时可能出现错误，导致与客户的沟通问题和财务风险。
3.  **格式不一**：不同运营人员可能发出格式略有差异的消息，影响专业性。
4.  **信息分散**：所需信息（账单、合同、员工、公司账户）分散在系统不同位置，查找不便。
5.  **逻辑不透明**：简单的“增减款”无法说明具体业务，如“替班费”、“保证金”、“费用转移”、“佣金冲抵”等，客户无法清晰了解费用构成。

### 1.3. 项目目标

1.  **一键生成**：允许运营人员通过简单的界面操作，为单个或多个账单自动生成格式化、内容准确、计算过程清晰的催款消息。
2.  **财务透明**：生成的消息必须详细展示每一笔费用的计算过程或业务缘由，特别是对于手动添加的财务调整项，要能清晰反映其业务性质。
3.  **逻辑统一**：确保消息生成逻辑与 `BillingEngine` 的核心计费逻辑完全一致，避免出现数据二义性。
4.  **灵活可配**：公司收款账户等固定信息应在系统中可配置，而非硬编码。

## 2. 核心设计理念

1.  **计算与展示分离**: `BillingEngine` 是唯一的 **计算者**，负责在生成账单时，将详细的计算过程和结果存入 `CustomerBill.calculate_details` 字段。本功能 (`PaymentMessageGenerator`) 是一个纯粹的 **展示者**，它只负责解析和呈现已有数据，绝不重复计算。

2.  **唯一真实来源 (Single Source of Truth)**: 采用混合数据源策略，确保信息的全面和准确。
    -   `CustomerBill.calculate_details` JSON 字段是获取 **核心计算过程** （如劳务费、管理费计算公式）的主要来源。
    -   `FinancialAdjustment` 表是获取 **手动调整项精确业务含义** （如保证金、替班费、费用转移、冲抵等）的唯一来源。

3.  **配置优于硬编码**: 公司银行账户这类信息从代码中分离，存放在专门的数据库表中，方便管理。

## 3. 模型设计 (Data Model)

为支持此功能，我们仅新增一个用于配置的表，不对现有核心业务模型（如`CustomerBill`, `FinancialAdjustment`）进行结构性修改。

### 3.1. 新增: `CompanyBankAccount` (公司收款账户) 表

用于存储公司收款账户信息。

**表名:** `company_bank_accounts`

| 字段名 | 类型 | 约束/注释 |
| :--- | :--- | :--- |
| `id` | `Integer` | Primary Key |
| `account_nickname` | `String(100)` | 账户别名，如 "公司招行主账户", Not Null |
| `payee_name` | `String(100)` | 收款户名, Not Null |
| `account_number` | `String(100)` | 银行账号, Not Null |
| `bank_name` | `String(200)` | 开户行全称, Not Null |
| `is_default` | `Boolean` | 是否为默认账户, Not Null, Default `false` |
| `is_active` | `Boolean` | 是否启用, Not Null, Default `true` |

## 4. 核心逻辑与流程设计

我们将创建一个新的服务模块 `PaymentMessageGenerator`，它负责接收账单ID，并输出格式化的字符串。

### 4.1. 核心服务: `PaymentMessageGenerator`

独立的Python模块 `backend/services/payment_message_generator.py`。

```python
# 伪代码
class PaymentMessageGenerator:
    def generate_for_bills(bill_ids: list[int]) -> str:
        # ... 实现多账单按客户分组和合并的逻辑 ...

    def _build_context_for_bill(bill: CustomerBill) -> dict:
        # ... 核心上下文构建逻辑 ...
```

### 4.2. 上下文构建器: `_build_context_for_bill` (最终确认版 V3.3)

此函数是整个功能的大脑，负责将分散的数据源融合成一个有序的、可供模板使用的明细列表。

**执行步骤:** 

1.  **加载数据**: 
    -   加载 `CustomerBill` 对象。
    -   加载并解析其 `calculate_details` JSON 字段。
    -   加载与此 `bill.id` 关联的所有 `FinancialAdjustment` 对象列表。

2.  **初始化明细列表**: 创建一个空的 `final_line_items` 列表。

3.  **处理核心计算项 (来自 `calculate_details`)**:
    -   遍历 `calculate_details['calculation_log']` 字典。
    -   将“基础劳务费”、“加班费”、“本次交管理费”等条目的键作为 `name`，值作为 `description`，添加入 `final_line_items` 列表。
    -   **忽略** `calculation_log` 中模糊的“客应付款”、“萌嫂应领款”等总计性质的条目。

4.  **处理财务调整项 (来自 `FinancialAdjustment` 列表)**:
    -   根据对 `billing_api.py` 的分析，定义一个“减项”类型集合：
        ```python
        NEGATIVE_TYPES = {
            AdjustmentType.CUSTOMER_DECREASE,
            AdjustmentType.CUSTOMER_DISCOUNT,
            AdjustmentType.EMPLOYEE_DECREASE,
            AdjustmentType.EMPLOYEE_COMMISSION 
        }
        ```
    -   遍历查询到的 `FinancialAdjustment` 记录列表，对每一条 `adj` 执行以下 **智能命名和格式化规则**：
        
        a. **确定明细名称 (`name`)**:
            -   **特殊冲抵/转移类型**: 如果 `adj.adjustment_type` 是 `EMPLOYEE_COMMISSION_OFFSET` (佣金冲账) 或 `DEFERRED_FEE` (顺延费用)，`name` 直接使用其类型的预设中文标签。
            -   **通用增减款类型**: 如果 `adj.adjustment_type` 是 `CUSTOMER_INCREASE`, `CUSTOMER_DECREASE` 等，`name` **直接取自 `adj.description` 字段** (例如 "替班费", "春节红包")。
            -   **特定业务类型**: 如果 `adj.adjustment_type` 是 `DEPOSIT`, `DISCOUNT`, `INTRODUCTION_FEE` 等，`name` 取自类型的预设中文标签（例如“保证金”）。

        b. **组合补充描述**:
            -   对于**除通用增减款之外**的所有类型，如果 `adj.description` 字段有内容且不与 `name` 重复，都应作为补充信息附加在 `name` 后的括号中。例如: `佣金冲账(冲抵来自合同#123的佣金)` 或 `优惠(新客户首单立减)`。

        c. **确定带符号的金额描述 (`description`)**:
            -   如果 `adj.adjustment_type` 在 `NEGATIVE_TYPES` 集合中，金额描述为 `f"-{adj.amount:.2f}元"`。
            -   对于所有其他类型，金额描述为 `f"+{adj.amount:.2f}元"`。

        d. **生成并添加明细**: 将最终生成的 `{ "name": name, "description": description }` 添加到 `final_line_items` 列表中。

5.  **返回上下文**: 将包含 `final_line_items` 列表和最终总金额的 `context` 字典返回。

### 4.3. 模板设计

模板将变得非常通用和简洁。

**`bill_fragment.txt` (通用账单片段模板):** 
```jinja
{{ customer.name }}——{{ employee.name }} ({{ bill_date_range }}):
{% for item in line_items %}
  - {{ item.name }}: {{ item.description }}
{% endfor %}
```

**`consolidated_wrapper.txt` (多账单合并包装模板):** 
```jinja
{% for fragment in bill_fragments %}
{{ fragment }}
--------------------
{% endfor %}

费用总计：{{ grand_total_amount }}元

户名：{{ company_account.payee_name }}
帐号：{{ company_account.account_number }}
银行：{{ company_account.bank_name }}
```

## 5. API 与界面设计

### 5.1. API 设计

| Method | Endpoint | 描述 |
| :--- | :--- | :--- |
| `POST` | `/api/bills/generate_payment_message` | 接收一个包含 `bill_ids` 的JSON数组，返回生成的催款消息字符串。 |

**Request Body:**
```json
{
  "bill_ids": [101, 102, 105]
}
```

**Response Body:**
```json
{
  "message": "...\n费用总计：20460.00元\n\n户名：北京家福安家政服务有限公司\n帐号：8613 8236 7910 001\n银行：招商银行股份有限公司北京万寿路支行"
}
```

### 5.2. 界面设计 (UI/UX)

1.  **账单列表页**: 在每行账单前增加一个复选框。
2.  **操作按钮**: 在页面顶部或底部的操作栏中，增加一个 **“生成催款信息”** 的按钮。
3.  **交互流程**: 
    -   运营人员勾选一个或多个账单。
    -   点击“生成催款信息”按钮。
    -   前端调用 `POST /api/bills/generate_payment_message` API。
    -   API返回成功后，弹出一个模态框，框内有一个只读的 `<textarea>` 显示完整的催款消息。
    -   模态框提供一个 **“复制内容”** 按钮，方便用户一键复制。

## 6. 部署与风险

-   **部署**: 
    1.  编写并运行 Alembic 迁移脚本，创建 `company_bank_accounts` 表。
    2.  在后台管理界面中增加对 `CompanyBankAccount` 表的增删改查功能。
    3.  部署后端和前端代码。
-   **风险**: 
    -   **数据准确性**: 风险点在于 `BillingEngine` 写入 `calculate_details` 的数据是否完整，以及 `PaymentMessageGenerator` 对 `FinancialAdjustment` 的解析逻辑是否覆盖所有情况。**必须使用包含各类真实业务场景（特别是含冲抵、转移、通用增减款）的账单进行严格的单元测试和集成测试。**