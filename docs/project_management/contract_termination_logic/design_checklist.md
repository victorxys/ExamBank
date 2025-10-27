# 设计检查清单: 合同终止与余额结转

## 1. 数据结构与模型 (Data Structure & Models)

- [ ] **检查点**: `FinancialAdjustment` 和 `AdjustmentType` 模型是否需要修改？
    - **如何检查**: 查看 `backend/models.py`。
    - **检查结果**: **通过**。无需修改数据库 Schema。`AdjustmentType` 已包含 `COMPANY_PAID_SALARY`，而“余额结转”项将通过 `description` 区分，这为按需创建提供了灵活性。

## 2. 后端逻辑 (Backend Logic)

- [ ] **检查点**: `terminate_contract` 接口的职责是否已正确简化？
    - **如何检查**: 审查 `backend/api/billing_api.py` 中的 `terminate_contract` 函数。
    - **检查结果**: [待填充] 需在代码审查中确认，该函数现在只负责添加“公司代付工资”调整项并重算，不再处理任何余额转移逻辑。

- [ ] **检查点**: 新的 `POST /api/bills/<bill_id>/transfer-balance` 接口是否功能完备且具有原子性？
    - **如何检查**: 审查新接口的代码实现。
    - **检查结果**: [待填充] 需在代码审查中确认以下几点：
        - a. 整个“计算-创建-转移”流程是否被包裹在一个数据库事务中。
        - b. 是否正确计算了源账单的 `total_due`。
        - c. 是否正确创建了金额为 `-total_due` 的“账户余额结转”项。
        - d. 是否成功调用了 `transfer_financial_adjustment` 的核心逻辑来完成转移。

- [ ] **检查点**: “公司代付工资”的金额是否正确取自最终薪酬单？
    - **如何检查**: 审查 `terminate_contract` 函数，确认在创建调整项时，其 `amount` 来自 `final_payroll.total_due`。
    - **检查结果**: [待填充] (需在代码实现后验证)。

- [ ] **检查点**: 旧的 `transfer_options` 逻辑是否被完整保留？
    - **如何检查**: 审查 `terminate_contract` 函数，确认存在 `if transfer_options:` 分支，并且其内部保留了旧的、一步到位的转签逻辑。
    - **检查结果**: [待填充] (需在代码实现后验证)。

## 3. 前端交互 (Frontend Interaction)

- [ ] **检查点**: “转移余额”按钮是否在正确的位置和时机显示？
    - **如何检查**: 审查 `FinancialManagementModal.jsx` 的渲染逻辑。
    - **检查结果**: [待填充] 需在UI测试中确认，按钮仅对已终止合同的最后一个账单显示，且位置合理（如总额附近）。

- [ ] **检查点**: 点击“转移余额”按钮是否能正确触发新的API调用？
    - **如何检查**: 通过浏览器开发者工具的网络(Network)标签，监视按钮点击后发出的请求。
    - **检查结果**: [待填充] 需在UI测试中确认，点击并选择目标合同后，前端调用了 `POST /api/bills/<bill_id>/transfer-balance`，并传递了正确的 `destination_contract_id`。

## 4. 边界情况与错误处理 (Edge Cases & Error Handling)

- [ ] **检查点**: 如果最终账单余额为0，是否还显示“转移余额”按钮？
    - **如何检查**: 审查前端按钮的显示条件。
    - **检查结果**: [待填充] (建议增加 `total_due !== 0` 的判断，余额为0时无需转移)。

- [ ] **检查点**: 如果客户名下没有其他合同，转移流程如何处理？
    - **如何检查**: 审查复用的 `TransferDepositDialog.jsx` 的行为。它在调用 `GET /api/billing/contracts/eligible-for-transfer` 后，如果返回列表为空，应优雅地向用户显示“无可用转移目标”。
    - **检查结果**: [待填充] (需在UI测试中验证)。
