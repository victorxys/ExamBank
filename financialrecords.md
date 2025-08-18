### **【设计方案：财务记录系统 V2.0】**

#### **一、 核心判断**

✅ **值得做。**

我们最初的错误，是试图用一个概念去解决两个完全不同的问题：**现金流（Cash Flow）**和**账目调整（Accounting Adjustments）**。这导致了混乱，比如“部分支付”和“顺延”这种所谓的“特殊情况”。

这个设计的“好品味”在于**彻底分离这两个关注点**。我们引入一个清晰、简单的规则：

*   **支付是一个事件（Event）。** 我们用一个专门的模型 `PaymentRecord` 来记录每一笔真实的资金流动。它是不可变的流水。
*   **账目是一个状态（State）。** `FinancialAdjustment` 描述了账目上应该发生什么。它的结算状态 `is_settled` 只用来处理非现金的核销。

我们不提供一个复杂的入口，而是提供两把目的明确的工具：一把记录现金流的**大锤**（`PaymentRecord`），和一把修正账目的**手术刀**（`FinancialAdjustment`）。

#### **二、 数据模型设计 (Data structures first!)**

给我看你的表，其他都是废话。

##### 1. 模型定义 (SQLAlchemy/Python 代码)

**第一步：新增 `PaymentRecord` 模型，记录事实**

这是我们系统的现金流水账。每一条记录都是一个真实的、发生过的支付事件。

```python
# backend/models.py (新增模型)
import enum
from sqlalchemy import Enum as SAEnum

class PaymentRecord(db.Model):
    __tablename__ = 'payment_records'
    __table_args__ = {'comment': '针对客户账单的支付记录表'}

    id = db.Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_bill_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('customer_bills.id', ondelete='CASCADE'), nullable=False, index=True)
    amount = db.Column(db.Numeric(12, 2), nullable=False, comment='本次支付金额')
    payment_date = db.Column(db.Date, nullable=False, comment='支付日期')
    method = db.Column(db.String(100), nullable=True, comment='支付方式')
    notes = db.Column(db.Text, nullable=True, comment='备注')
    image_url = db.Column(db.String(512), nullable=True, comment='支付凭证图片URL')
    created_by_user_id = db.Column(PG_UUID(as_uuid=True), db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    
    customer_bill = db.relationship('CustomerBill', back_populates='payment_records')
    created_by_user = db.relationship('User')
```

**第二步：进化 `CustomerBill` 模型，反映状态**

把那些模棱两可的布尔值（`is_paid`, `is_deferred`）扔进垃圾桶。它们是谎言。我们需要一个能精确描述当前状态的字段。

```python
# backend/models.py (修改 CustomerBill)

class PaymentStatus(enum.Enum):
    UNPAID = 'unpaid'
    PARTIALLY_PAID = 'partially_paid'
    PAID = 'paid'
    OVERPAID = 'overpaid'

class CustomerBill(db.Model):
    __tablename__ = 'customer_bills'
    # ... (id, contract_id 等保持不变)

    # --- 字段演进 ---
    # is_paid: db.Column(...)          <-- REMOVE THIS. IT'S A LIE.
    # is_deferred: db.Column(...)      <-- REMOVE THIS. IT'S A HACK.
    
    payment_status = db.Column(
        SAEnum(PaymentStatus), 
        nullable=False, 
        default=PaymentStatus.UNPAID, 
        server_default='unpaid', 
        index=True
    )
    total_due = db.Column(db.Numeric(12, 2), nullable=False, server_default='0', comment='总应付金额 (由BillingEngine计算)')
    total_paid = db.Column(db.Numeric(12, 2), nullable=False, server_default='0', comment='已支付总额 (冗余字段，实时更新)')

    # --- 关系建立 ---
    payment_records = db.relationship('PaymentRecord', back_populates='customer_bill', cascade='all, delete-orphan')
    # ... (其他字段和关系保持不变)
```

**第三步：明确 `FinancialAdjustment` 模型的职责**

`FinancialAdjustment` 是账目调整工具，不是现金记录工具。我们给它加上结算状态，但只用于**非现金**的场景。

```python
# backend/models.py (扩展 FinancialAdjustment)

class FinancialAdjustment(db.Model):
    __tablename__ = 'financial_adjustments'
    # ... (id, adjustment_type, amount, description, date 等保持不变)

    # --- 新增字段，用于非现金核销 ---
    is_settled = db.Column(
        db.Boolean, 
        nullable=False, 
        default=False, 
        server_default='false', 
        index=True, 
        comment="是否已(通过非现金方式)核销"
    )
    settlement_date = db.Column(db.Date, nullable=True, comment="核销日期")
    settlement_details = db.Column(PG_JSONB, nullable=True, comment="核销详情")
    # ----------------
```

##### 2. 设计哲学

*   **分离现金与账目**: `PaymentRecord` 追踪**现金**。`FinancialAdjustment` 追踪**账目**。它们各司其职。会计用前者记录银行流水，用后者处理内部冲抵、顺延、豁免等账目操作。
*   **消除特殊情况**:
    *   **部分支付**: 不再是一个特殊状态。它只是 `payment_records` 表里有多条记录，且它们的总和小于 `total_due` 的自然结果。
    *   **顺延**: 不再是一个 `is_deferred` 标签。它是在两个账单上创建两条清晰、可审计的、方向相反的 `FinancialAdjustment` 记录的原子操作。这个“特殊情况”被一个通用规则消灭了。

#### **三、 核心业务逻辑 (The Code)**

拒绝复杂的流程。每个工具只做一件事。

##### 1. “记录付款”流程 (大锤：处理现金)

当会计收到客户打来的15000元，而账单应收17000元时：

1.  **后端在一个数据库事务中执行。**
2.  **创建事件**: 在 `payment_records` 表中插入一条新记录，`amount` 为 15000.00。
3.  **更新聚合状态**:
    *   重新计算 `CustomerBill` 的 `total_paid` (现在是 15000.00)。
    *   比较 `total_paid` (15000) 和 `total_due` (17000)，将 `payment_status` 更新为 `PARTIALLY_PAID`。
4.  **结束。** 系统不关心这15000元具体支付了什么，它只忠实地记录了“收到了15000元，还欠2000元”这个事实。

##### 2. “费用顺延”流程 (手术刀：调整账目)

当运营决定将 A 账单的500元顺延到 B 账单时：

1.  **后端在一个数据库事务中执行。**
2.  在 A 账单下创建一条 `FinancialAdjustment`：`adjustment_type='customer_decrease'`, `amount=500`, `description='费用顺延至账单B'`。
3.  在 B 账单下创建一条 `FinancialAdjustment`：`adjustment_type='customer_increase'`, `amount=500`, `description='承接自账单A的顺延费用'`。
4.  **（可选）** 将这两条新创建的调整项的 `is_settled` 标记为 `true`，因为这个内部操作已经“完成”了。
5.  **结束。** `BillingEngine` 会自动重新计算两个账单的 `total_due`，一切都会自动平衡。

##### 3. “手动核销”流程 (会计的笔：处理非现金账目)

当公司决定免除客户一笔200元的费用（已记录为 `FinancialAdjustment`）时：

1.  会计找到这条 `-200` 的 `FinancialAdjustment` 记录。
2.  将其 `is_settled` 标记为 `true`，并在 `settlement_details` 中注明“经XX经理批准豁免”。
3.  **结束。** 没有现金流动，但账目被清晰地处理了。

#### **四、 API 接口设计 (The Interface)**

*   **`POST /api/bills/{bill_id}/payments`**: **(主要工具)** 为账单添加一笔支付记录。
*   **`GET /api/bills/{bill_id}/payments`**: 查看一个账单的所有支付记录。
*   **`PUT /api/financial-adjustments/{id}`**: **(次要工具)** 更新单条账目调整的核销状态。
*   **`POST /api/financial-adjustments`**: 创建手动的账目调整（如优惠、罚款）。
*   **`POST /api/bills/{bill_id}/defer-to/{next_bill_id}`**: (可选) 创建一个高层API来封装“顺延”操作，内部执行上述第二条逻辑。

#### **五、 潜在风险与“绝不破坏”的保证**

*   **对 `BillingEngine` 的影响**: **零影响。** `BillingEngine` 的世界里只有 `FinancialAdjustment`。它只负责计算 `total_due`。它不需要，也不应该知道任何关于支付的事情。
*   **数据一致性**: **极强。** 现金流被记录为不可变的事件。账单状态是这些事件的聚合结果，可以随时根据事件重新计算，永远不会出错。所有关键操作都在数据库事务中完成。
*   **向后兼容**: **清晰的迁移路径。**
    1.  创建新表 `payment_records`。
    2.  为 `CustomerBill` 和 `FinancialAdjustment` 添加新字段。
    3.  编写一个一次性的迁移脚本：
        *   遍历所有旧的 `CustomerBill`。
        *   如果旧的 `is_paid` 为 `true`，则将新的 `payment_status` 设为 `PAID`，`total_paid` 设为 `total_due`，并在 `payment_records` 表里为它生成一条历史支付记录，备注为“系统迁移前已支付”。
        *   删除旧的 `is_paid` 和 `is_deferred` 字段。
    4.  所有现有功能都不会被破坏。新功能是一个干净的、正交的扩展。