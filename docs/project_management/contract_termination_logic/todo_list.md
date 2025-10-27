# 待办事项: 合同终止与余额结转

## 后端 (Backend)

- [ ] **1. 修改 `terminate_contract` 接口**:
    - 在 `backend/api/billing_api.py` 的 `terminate_contract` 函数中，找到处理 `NannyContract` 的逻辑部分。
    - [ ] 1.1. 在重算最终账单 (`final_bill`) 之后，找到与该账单关联的最终薪酬单 (`final_payroll`)。
    - [ ] 1.2. **仅**创建“公司代付工资”调整项：获取 `final_payroll.total_due` 的值，并以此金额创建一个新的 `FinancialAdjustment`，类型为 `COMPANY_PAID_SALARY`，描述为“[系统] 公司代付员工工资”。
    - [ ] 1.3. 再次调用计费引擎 `engine.calculate_for_month(...)` 重算最后一个账单，以确保“公司代付工资”项被正确计入总额。
    - [ ] 1.4. **移除**或**禁用**任何与 `transfer_options` 相关的旧的、手动的转移逻辑，确保该接口不再处理余额转移。

- [ ] **2. 新增 `transfer-balance` 接口**:
    - [ ] 2.1. 在 `backend/api/billing_api.py` 中，创建一个新的路由 `POST /api/bills/<bill_id>/transfer-balance`。
    - [ ] 2.2. 接口接收 `destination_contract_id` 作为参数。
    - [ ] 2.3. 实现接口逻辑：
        - a. 根据 `bill_id` 找到源账单，并计算其当前的“总应付款” (`total_due`)。
        - b. 在源账单下，创建一个新的 `FinancialAdjustment` 项，描述为“[系统] 账户余额结转”，金额为 `-total_due`。
        - c. 获取新创建的调整项的ID。
        - d. 调用现有的 `transfer_financial_adjustment` 函数或其核心服务，将这个新创建的调整项转移到 `destination_contract_id` 指定的目标合同。
    - [ ] 2.4. 确保整个操作是原子性的（使用数据库事务）。

- [ ] **3. 编写单元测试**: 
    - 在 `backend/tests/` 目录下，创建或修改测试文件。
    - [ ] 3.1. 验证 `terminate_contract` 调用后，是否只生成了“公司代付工资”调整项，且最终账单余额**不为零**。
    - [ ] 3.2. 为新的 `transfer-balance` 接口编写专门的测试，模拟调用，并断言源账单最终归零，且目标合同收到了正确的结转款项。

## 前端 (Frontend)

- [ ] **1. 在账单弹窗中添加“转移余额”按钮**:
    - [ ] 1.1. 修改 `FinancialManagementModal.jsx` 或相关组件。
    - [ ] 1.2. 在显示“总应付款”的区域附近，添加一个新的“转移余额”按钮。
    - [ ] 1.3. 添加显示逻辑：该按钮仅当账单属于一个“已终止”的合同，并且是该合同的最后一个账单时才可见。

- [ ] **2. 实现转移流程**:
    - [ ] 2.1. 点击“转移余额”按钮后，复用 `TransferDepositDialog.jsx` 组件，让用户选择目标合同。
    - [ ] 2.2. 用户确认后，调用新的 `POST /api/bills/<bill_id>/transfer-balance` 接口，并传递目标合同ID。
    - [ ] 2.3. 成功后，刷新或更新UI，显示最新的账单状态（应付款为0）。

- [ ] **3. 端到端测试**:
    - [ ] 3.1. 手动测试完整流程：终止合同 -> 检查最终账单（有余额） -> 点击“转移余额”按钮 -> 选择目标合同 -> 确认 -> 检查原账单（余额归零）和目标账单（收到款项）。

## 文档与代码风格

- [ ] **1. 更新 `design_checklist.md`**: 根据新的实现方案更新设计检查清单。
- [ ] **2. 更新 `test_cases.md`**: 调整测试用例以匹配新的两步操作流程。
- [ ] **3. 代码审查**: 确保所有代码遵循项目规范，逻辑清晰。
