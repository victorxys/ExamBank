# To-Do List: 续约账单合并功能

## 后端 (Backend)

- [ ] **API-1: 续约合同检测**
    - 创建一个新的API端点 `GET /api/contracts/<contract_id>/successor`。
    - 该接口用于在加载合同的最后一期账单时，根据 `requirement_document.md` 中定义的触发条件，检测是否存在符合条件的续约合同。
    - 如果存在，返回续约合同的ID和基本信息；否则返回空。

- [ ] **API-2: 账单合并预览**
    - 创建一个新的API端点 `GET /api/bill-merges/preview`。
    - 参数：`source_contract_id` 和 `target_contract_id`。
    - 该接口用于计算并返回 `requirement_document.md` 中定义的预览信息，包括将要转移的保证金、员工工资等。

- [ ] **API-3: 执行账单合并**
    - 创建一个新的API端点 `POST /api/bill-merges`。
    - 参数：`source_contract_id` 和 `target_contract_id`。
    - 该接口负责执行所有后台操作，包括创建财务调整项、删除旧的代付项等。

- [ ] **服务层 (Service Layer)**
    - 在 `BillingService` 或创建一个新的 `BillMergeService` 中实现核心业务逻辑。
    - 确保整个合并操作包裹在数据库事务中，保证原子性。
    - 逻辑必须严格遵循 `requirement_document.md` 中的所有规则。

- [ ] **数据模型 (Data Models)**
    - 评估是否需要在 `FinancialAdjustment` 模型中增加字段来存储关联账单的链接，以实现可追溯性。

## 前端 (Frontend)

- [ ] **组件: BillingDashboard**
    - 当加载合同的最后一期账单时，调用 `API-1` (`/api/contracts/<contract_id>/successor`)。
    - 如果API返回续约合同信息，则在页面上显示 **“合并至续约账单”** 按钮。

- [ ] **组件: MergePreviewModal**
    - 创建一个新的React模态框组件 `MergePreviewModal.jsx`。
    - 当用户点击“合并”按钮时，调用 `API-2` (`/api/bill-merges/preview`) 获取数据并显示此模态框。
    - 模态框需要清晰地展示所有预览信息。
    - 包含“确认合并”和“取消”按钮。

- [ ] **状态管理 (State Management)**
    - 当用户点击“确认合并”后，调用 `API-3` (`/api/bill-merges`)。
    - 处理API请求的加载（loading）、成功（success）和错误（error）状态。
    - 成功后，应刷新当前页面或将用户引导至新合同的账单页面，并显示成功提示。
    - 失败后，显示明确的错误信息。

## 测试 (Testing)

- [ ] **单元测试 (Unit Tests)**
    - 为新的服务层逻辑 (`BillMergeService`) 编写全面的单元测试。
    - 覆盖所有边界情况，例如没有保证金、没有员工工资等。

- [ ] **集成测试 (Integration Tests)**
    - 为 `API-1`, `API-2`, `API-3` 编写集成测试。
    - 模拟真实的HTTP请求，验证数据库中的数据在操作前后是否符合预期。

- [ ] **端到端测试 (E2E Tests)**
    - （可选）创建一个端到端测试，模拟用户从点击按钮到完成合并的整个流程。
