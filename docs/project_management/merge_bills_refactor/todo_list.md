# 续约账单合并实现重构 - 待办事项

## 后端

- [ ] **核心服务**:
    - [ ] 在 `bill_merge_service.py` 中创建核心函数 `merge_bills(source_bill_id, target_bill_id)`。
    - [ ] 确保整个合并操作包裹在单个数据库事务中，保证原子性。
- [ ] **源合同A - 账单冲抵逻辑**:
    - [ ] 实现删除 `COMPANY_PAID_SALARY` 和 `DEPOSIT_PAID_SALARY` 调整项的逻辑。
    - [ ] **客户账单**: 计算剩余 `total_receivable`，创建反向的平衡调整项 (`CUSTOMER_DECREASE` / `INCREASE`) 使其归零。
    - [ ] **员工工资单**: 计算剩余 `total_payable`，创建反向的平衡调整项 (`EMPLOYEE_DECREASE` / `INCREASE`) 使其归零。
    - [ ] **特殊项**: 为 `EMPLOYEE_COMMISSION` 创建 `EMPLOYEE_COMMISSION_OFFSET` 进行冲抵。
    - [ ] 所有在源账单上创建的冲抵调整项，都需要记录关联的目标账单ID，用于前端跳转。
- [ ] **目标合同B - 账单接收逻辑**:
    - [ ] **客户账单**: 根据源账单的冲抵项，创建金额相同、效果相反的转移项 (例如，源是 `DECREASE`，目标就是 `INCREASE`)。
    - [ ] **员工工资单**: 同上，创建与源工资单冲抵项相反的转移项。
    - [ ] **特殊项**: 如果源账单有 `EMPLOYEE_COMMISSION_OFFSET`，则在目标工资单上重建 `EMPLOYEE_COMMISSION` 调整项。
    - [ ] 所有在目标账单上创建的转移项，都需要记录关联的源账单ID。
- [ ] **API 层**:
    - [ ] 创建 **`GET /api/bill-merges/preview`** 接口：
        - 接收 `source_bill_id` 和 `target_bill_id`。
        - **不修改任何数据**。
        - 计算并返回一个JSON对象，清晰描述将要执行的所有操作（删除、冲抵、转移），并按“客户账单”和“员工工资单”分类。
    - [ ] 创建 **`POST /api/bill-merges`** 接口：
        - 接收 `source_bill_id` 和 `target_bill_id`。
        - 调用 `merge_bills` 服务执行实际的合并操作。
- [ ] **测试**:
    - [ ] 为 `BillMergeService` 编写全面的单元测试和集成测试，覆盖所有逻辑分支。

## 前端

- [ ] **数据获取**:
    - [ ] 修改调用 `MergePreviewModal.jsx` 的父组件，使其首先调用 `GET /api/bill-merges/preview` 获取预览数据。
- [ ] **更新 `MergePreviewModal.jsx`**:
    - [ ] 移除旧的 `transferableAdjustments` 逻辑。
    - [ ] 组件接收从预览API获取的 `previewData` 作为 prop。
    - [ ] 在模态框内部，分两个区域展示预览数据：
        - **客户账单**: 列出将要创建的冲抵项和转移项。
        - **员工工资单**: 列出将要创建的冲抵项和转移项。
        - 清晰展示每个操作的类型（如“冲抵”、“转移”）、描述和金额。
    - [ ] 修改“确认合并”按钮的 `onClick` 事件，使其调用 `POST /api/bill-merges` 接口来执行合并。
- [ ] **实现跳转链接**:
    - [ ] 在显示财务调整项的通用组件中，检查是否存在 `linked_bill_id` 字段。
    - [ ] 如果存在，渲染一个可点击的“链接”图标，点击后可以跳转到关联的账单页面。
