# 合同管理功能 - To-Do List

## Phase 1: 数据模型与数据库迁移

- [x] **1.1.** 在 `backend/models.py` 中定义 `ContractTemplate` 模型。
- [x] **1.2.** 在 `backend/models.py` 中定义 `FormalContract` 模型，继承自 `BaseContract`，并包含需求文档中所有新增字段。
- [x] **1.3.** 在 `backend/models.py` 中定义 `EmployeeSalaryHistory` 模型。
- [x] **1.4.** 审查并根据需要扩展 `ServicePersonnel` 和 `Customer` 模型 (例如，为身份证号添加唯一约束)。
- [x] **1.5.** 使用 `flask db migrate` 生成 Alembic 数据库迁移脚本。
- [x] **1.6.** 审查并确认迁移脚本的正确性，然后使用 `flask db upgrade` 应用迁移。

## Phase 2: 后端 - 核心业务逻辑

- [ ] **2.1.** 创建或扩展一个服务层 (例如 `ContractService`) 来封装合同管理的核心逻辑。
- [x] **2.2.** 实现从 `ContractTemplate` 创建 `FormalContract` 的逻辑。
- [x] **2.3.** 实现合同的续约/变更流程：
    - [x] 预填充新合同的数据。
    - [x] 正确设置新合同的 `previous_contract_id`。
- [x] **2.4.** **【关键任务】** 实现管理费转移逻辑。
    - **备注**: 此功能已由 `BillMergeService` 实现，作为“续约账单合并”功能的一部分。在续约流程中，应调用 `BillMergeService` 来处理所有费用的转移。
- [x] **2.5.** 实现当合同中员工薪酬变更时，自动更新 `ServicePersonnel` 和 `EmployeeSalaryHistory` 的逻辑。
- [x] 2.6. 实现电子签约流程的后台逻辑.
- [x] 2.7. 确保合同状态变为 `active` 后，能被现有的账单生成引擎正确识别.

## Phase 3: 后端 - API 接口

- [ ] **3.1.** 为 `ContractTemplate` 模型创建标准的 CRUD API 接口。
- [ ] **3.2.** 创建用于新建 `FormalContract` 的 API 接口。
- [ ] **3.3.** 创建用于发起合同续约/变更的 API 接口。
- [ ] **3.4.** 创建面向公网的、无需登录的签约 API：
    - [ ] `GET /contracts/sign/{token}`: 获取合同详情以供签署。
    - [ ] `POST /contracts/sign/{token}`: 提交客户或员工的签名。
- [ ] **3.5.** 创建用于根据拼音模糊搜索 `ServicePersonnel` 的 API 接口。

## Phase 4: 前端 - UI 实现

- [ ] **4.1.** 开发“合同模板管理”的前端界面。
- [ ] **4.2.** 开发“创建合同”的表单界面，包含员工拼音搜索功能。
- [ ] **4.3.** 在合同详情页，添加“续约/变更”功能按钮，并连接到相应流程。
- [ ] **4.4.** 开发面向移动端的电子签约页面，需要支持手写签名。

## Phase 5: 数据迁移与测试

- [ ] **5.1.** 编写一次性数据迁移脚本，用于从金数据同步历史客户和员工信息，**并为同步的员工创建初始的薪酬变化记录到 `EmployeeSalaryHistory` 表中。**
- [ ] **5.2.** 为 `ContractService` 中的关键业务逻辑编写单元测试。
- [ ] **5.3.** 编写集成测试，覆盖从合同创建到续约、再到账单生成的完整流程，**特别是管理费转移的场景**。
