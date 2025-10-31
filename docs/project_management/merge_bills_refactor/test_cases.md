# 续约账单合并重构 - 测试用例

### 测试用例: 1. 标准正向合并场景

**测试目的:**
验证最常见的合并场景：源账单（客户和员工）都有正数余额（客户欠款，员工应发工资），系统能正确冲抵并转移。

**涉及模块/文件:**
- `BillMergeService.merge_bills`
- `GET /api/bill-merges/preview`
- `POST /api/bill-merges`
- `MergePreviewModal.jsx`

**输入:**
- **源合同A - 客户账单**: `total_receivable` = 1000元。
- **源合同A - 员工工资单**: `total_payable` = 2000元。
- 源账单中不包含 `EMPLOYEE_COMMISSION`。

**期望输出:**
- **源合同A - 客户账单**: 
    - 新增一笔 `CUSTOMER_DECREASE` 调整项，金额为1000元。
    - 最终 `total_receivable` 为 0。
- **源合同A - 员工工资单**:
    - 新增一笔 `EMPLOYEE_DECREASE` 调整项，金额为2000元。
    - 最终 `total_payable` 为 0。
- **目标合同B - 客户账单**:
    - 新增一笔 `CUSTOMER_INCREASE` 调整项，金额为1000元。
- **目标合同B - 员工工资单**:
    - 新增一笔 `EMPLOYEE_INCREASE` 调整项，金额为2000元。
- 所有新建调整项都有到对方账单的链接。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

---

### 测试用例: 2. 客户账单为负数（退款）场景

**测试目的:**
验证当源客户账单为负数（即应退款给客户）时，系统能否正确处理反向的冲抵和转移。

**涉及模块/文件:**
- `BillMergeService.merge_bills`
- `POST /api/bill-merges`

**输入:**
- **源合同A - 客户账单**: `total_receivable` = -500元。
- **源合同A - 员工工资单**: `total_payable` = 2000元。

**期望输出:**
- **源合同A - 客户账单**: 
    - 新增一笔 `CUSTOMER_INCREASE` 调整项，金额为500元。
    - 最终 `total_receivable` 为 0。
- **目标合同B - 客户账单**:
    - 新增一笔 `CUSTOMER_DECREASE` 调整项，金额为500元。
- 员工工资单的处理同测试用例1。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

---

### 测试用例: 3. 包含员工返佣的场景

**测试目的:**
验证系统能否正确处理 `EMPLOYEE_COMMISSION`，将其从源账单冲抵，并在目标账单重建，同时不影响主要的工资转移。

**涉及模块/文件:**
- `BillMergeService.merge_bills`
- `POST /api/bill-merges`

**输入:**
- **源合同A - 员工工资单**: 
    - `total_payable` = 2000元。
    - 包含一笔 `EMPLOYEE_COMMISSION` 调整项，金额为300元 (此金额不计入 `total_payable`)。

**期望输出:**
- **源合同A - 员工工资单**:
    - 新增 `EMPLOYEE_DECREASE` 调整项，金额2000元。
    - 新增 `EMPLOYEE_COMMISSION_OFFSET` 调整项，金额300元。
    - 最终 `total_payable` 为 0。
- **目标合同B - 员工工资单**:
    - 新增 `EMPLOYEE_INCREASE` 调整项，金额2000元。
    - 新增 `EMPLOYEE_COMMISSION` 调整项，金额300元。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

---

### 测试用例: 4. 包含自动代付项的场景

**测试目的:**
验证系统在执行合并前，是否成功删除了自动生成的 `COMPANY_PAID_SALARY` 和 `DEPOSIT_PAID_SALARY` 调整项。

**涉及模块/文件:**
- `BillMergeService.merge_bills`
- `POST /api/bill-merges`

**输入:**
- **源合同A - 客户账单**: 包含一笔 `COMPANY_PAID_SALARY`。
- **源合同A - 员工工资单**: 包含一笔 `DEPOSIT_PAID_SALARY`。

**期望输出:**
- 在执行任何冲抵操作**之前**，上述两个调整项被删除。
- 最终的冲抵金额基于删除这两个项目后的账单总额来计算。
- 目标合同B中**不**包含任何与 `COMPANY_PAID_SALARY` 或 `DEPOSIT_PAID_SALARY` 相关的转移项。

**实际输出 & 测试结果:**
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

---

### 测试用例: 5. 幂等性测试

**测试目的:**
验证重复调用合并接口不会导致重复创建调整项或破坏数据。

**涉及模块/文件:**
- `POST /api/bill-merges`

**输入:**
- 成功执行一次合并操作后，立即使用相同的 `source_bill_id` 和 `target_bill_id` 再次调用 `POST /api/bill-merges` 接口。

**期望输出:**
- 第二次调用应返回错误信息，或被静默忽略，但绝不能在任何一个账单上创建重复的财务调整项。
- 数据库中的调整项数量与第一次成功调用后完全相同。

**实际输出 & 测试结果:**
- 集成测试: [待填充]
- **最终检查结果:** [待填充]
