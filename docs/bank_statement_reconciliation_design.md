# 设计文档：银行对账单自动核销功能

**版本**: V1.0
**状态**: 设计完成，待开发

## 1. 概述与目标

为了解决财务人员手动核对银行收款与系统账单的繁琐流程，本项目旨在开发一个半自动化的银行对账单核销功能。系统将允许用户粘贴银行流水文本，通过智能匹配和清晰的人工处理界面，将每一笔银行收款精确地分配到一个或多个客户账单上，最终完成支付记录的创建和账单核销。

核心目标是：**提升对账效率，保证财务数据的准确性，并为所有资金流动提供清晰、可追溯的记录。**

## 2. 核心工作流

最终确定的用户工作流如下：

1.  **进入功能**: 财务人员从特定会计月份的账单管理页面进入【对账中心】。
2.  **粘贴流水**: 将从银行网站复制的流水文本粘贴到指定文本框中。
3.  **数据入库**: 系统自动解析流水文本，并根据银行的“交易流水号”进行排重，将新的流水存入数据库，初始状态为“未匹配”。
4.  **处理流水**: 用户在对账中心界面，逐条处理“未匹配”的银行流水。
    *   **对于系统无法识别付款人的流水**: 用户将被引导手动搜索并关联一个系统内的客户。在此过程中，系统会**智能提示并默认勾选**“为此付款人创建别名”的选项，并允许用户添加备注，以便于未来自动识别。
    *   **对于系统已识别客户的流水**: 系统直接展示该客户名下所有“未付清”的账单列表。
5.  **分配金额**: 用户在账单列表中，将银行流水的总金额以任意方式填写（拆分）到一张或多张账单的“本次支付”输入框中。
6.  **保存确认**: 用户确认分配无误后，点击“保存分配”。系统将在后台创建对应的支付记录（`PaymentRecord`），更新所有相关账单的状态和已付金额，并同步更新该银行流水的状态为“部分分配”或“完全分配”。

## 3. 数据模型设计 (Data Model)

为支撑此功能，需要对数据库进行以下修改：

### 3.1. `BankTransaction` 表 (银行交易流水)

此为新增表，用于存储银行流水记录。

```sql
CREATE TABLE bank_transactions (
    id UUID PRIMARY KEY, -- 主键
    transaction_id VARCHAR(255) UNIQUE, -- 银行提供的交易流水号，用于排重
    transaction_time TIMESTAMPTZ NOT NULL, -- 交易时间
    amount NUMERIC(12, 2) NOT NULL, -- 交易总金额
    payer_name VARCHAR(255) NOT NULL, -- 付款方名称
    
    allocated_amount NUMERIC(12, 2) NOT NULL DEFAULT 0, -- 已分配到支付记录的总金额

    status VARCHAR(50) NOT NULL, -- 匹配状态 (Enum)
    -- >> Enum: UNMATCHED, PARTIALLY_ALLOCATED, MATCHED, IGNORED, ERROR, PENDING_CONFIRMATION

    summary TEXT, -- 摘要
    raw_text TEXT, -- 原始行文本，用于审计
    -- 其他辅助字段: transaction_method, currency, business_type, etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2. `PaymentRecord` 表 (支付记录)

此为现有表，需要进行修改。

```sql
CREATE TABLE payment_records (
    id UUID PRIMARY KEY,
    customer_bill_id UUID NOT NULL, -- 关联的客户账单ID
    amount NUMERIC(12, 2) NOT NULL, -- 本次支付的金额（可能是银行流水的一部分）
    
    -- **新增字段**
    bank_transaction_id UUID, -- 关联到 bank_transactions 表，表明资金来源
    source_transaction_id VARCHAR(255), -- 冗余存储银行流水号，便于直接查看

    -- 其他现有字段: payment_date, method, notes, created_by_user_id, etc.
);
```

### 3.3. `PayerAlias` 表 (付款人别名)

此为新增表，用于建立银行付款人与系统客户的永久关联。

```sql
CREATE TABLE payer_aliases (
    id UUID PRIMARY KEY,
    payer_name VARCHAR(255) NOT NULL, -- 银行流水中的付款人名称
    customer_id UUID NOT NULL, -- 关联的系统客户ID
    notes TEXT, -- 备注，例如：“XX客户的配偶账户”
    created_by_user_id UUID NOT NULL, -- 创建人
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- 确保一个付款人只能关联到一个客户一次
    UNIQUE (payer_name, customer_id)
);
```

## 4. 前端 UI/UX 设计

前端界面设计以 `bank_statement_ui_mockup_v5.html` 原型为准，其核心交互点包括：

- **统一的对账中心**: 提供一个集中的界面来处理所有待办流水。
- **会计月份上下文**: 用户可以清晰地看到并切换当前操作的会计月份。
- **引导式工作流**: 对于“未匹配”流水，通过清晰的步骤引导用户“识别客户” -> “（可选）创建别名” -> “分配金额”。
- **灵活的金额分配**: 用户可以将一笔汇款的金额，自由地填入该客户名下的多个未结清账单中。
- **实时计算反馈**: 在分配金额时，界面会实时计算并显示“已分配”、“未分配”的金额，并对超出总额等错误操作进行即时校验。
- **别名创建集成**: 在关联客户的同时，无缝集成了创建别名的功能（包含备注），并将其作为默认推荐操作，以简化未来工作。

## 5. 后端 API 接口

为支持上述功能，后端需要提供以下API：

- `POST /api/bank-statement/reconcile`: 接收用户粘贴的对账单文本，执行解析和入库。
- `POST /api/bank-statement/run-auto-match`: （可选）触发简单的“一对一”自动匹配建议引擎。
- `POST /api/bank-transactions/<txn_id>/allocate`: **核心接口**。接收一个分配数组 `{"allocations": [...]}`，在事务中执行创建多条支付记录、更新账单、更新银行流水状态等一系列操作。
- `POST /api/payer-aliases`: 创建付款人别名记录。
- `GET /api/bank-transactions`: 获取待处理的银行流水列表（支持按月份筛选）。
- `GET /api/customers/<customer_id>/unpaid-bills`: 获取指定客户的所有未付清账单。

## 6. 关键实现细节

- **数据库事务**: 所有涉及多表写入的操作（尤其是金额分配）都必须包裹在数据库事务中，以保证数据的一致性和准确性。任何一步失败，所有操作都必须回滚。
- **用户输入校验**: 后端必须对所有来自前端的输入（特别是金额和ID）进行严格的校验。

