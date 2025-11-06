# 合同管理功能 - 设计检查清单

## 1. 数据模型设计

### 1.1. `ContractTemplate` 模型

-   **设计点**: 定义 `ContractTemplate` 模型及其字段。
-   **设计说明**:
    -   表名: `contract_templates`
    -   字段: `id` (UUID, PK), `template_name` (String, Unique), `contract_type` (String, Index), `content` (Text, Markdown), `version` (Integer), `created_at`, `updated_at`。
    -   关系: 无直接复杂关系。
-   **检查方法**: 审查 `backend/models.py` 中的 `ContractTemplate` 类定义，确认字段类型、约束和索引。
-   **检查结果**: [待填充]

### 1.2. `FormalContract` 模型 (继承 `BaseContract`)

-   **设计点**: 定义 `FormalContract` 模型，继承 `BaseContract`，并添加新字段和关系。
-   **设计说明**:
    -   继承: `class FormalContract(BaseContract):`
    -   `__mapper_args__`: `polymorphic_identity='formal'`
    -   新增字段:
        -   `template_id` (PG_UUID, FK to `contract_templates.id`)
        -   `service_content` (PG_JSONB 或 ARRAY(String), 存储服务内容列表)
        -   `service_type` (String, 枚举类型，如 "全日住家型")
        -   `is_auto_renew` (Boolean)
        -   `attachment_content` (Text)
        -   `signing_status` (SAEnum, 枚举: `unsigned`, `customer_signed`, `employee_signed`, `active`, `terminated`, `expired`)
        -   `customer_signature` (String, 存储签名图片URL或Base64)
        -   `employee_signature` (String, 存储签名图片URL或Base64)
        -   `unique_signing_token` (String, Unique, Index)
        -   `previous_contract_id` (PG_UUID, FK to `contracts.id`, Nullable, 自关联)
    -   关系: `template` (一对一或多对一), `previous_contract` (一对一自关联)。
-   **检查方法**: 审查 `backend/models.py` 中的 `FormalContract` 类定义，确认继承关系、新增字段、类型、约束、索引和关系定义。
-   **检查结果**: [待填充]

### 1.3. `EmployeeSalaryHistory` 模型

-   **设计点**: 定义 `EmployeeSalaryHistory` 模型及其字段。
-   **设计说明**:
    -   表名: `employee_salary_history`
    -   字段: `id` (UUID, PK), `personnel_id` (PG_UUID, FK to `service_personnel.id`), `contract_id` (PG_UUID, FK to `contracts.id`), `salary` (Numeric), `effective_date` (Date), `created_at`。
    -   索引: `(personnel_id, effective_date)`。
-   **检查方法**: 审查 `backend/models.py` 中的 `EmployeeSalaryHistory` 类定义，确认字段类型、约束和索引。
-   **检查结果**: [待填充]

### 1.4. `Customer` 和 `ServicePersonnel` 模型扩展

-   **设计点**: 确保 `Customer` 和 `ServicePersonnel` 模型支持身份证号唯一性约束，并包含所有必要字段。
-   **设计说明**:
    -   `Customer`: 确保 `id_card_number` 字段存在且唯一。
    -   `ServicePersonnel`: 确保 `id_card_number` 字段存在且唯一，`name_pinyin` 字段用于搜索。
-   **检查方法**: 审查 `backend/models.py` 中 `Customer` 和 `ServicePersonnel` 的定义。
-   **检查结果**: [待填充]

### 1.5. 数据库迁移脚本

-   **设计点**: 生成并审查 Alembic 迁移脚本。
-   **设计说明**: 脚本应包含上述所有新表和字段的创建，以及现有表的修改。
-   **检查方法**: 运行 `flask db migrate`，然后手动审查生成的迁移文件 (`versions/*.py`)。
-   **检查结果**: [待填充]

## 2. 后端核心业务逻辑设计

### 2.1. `ContractService` (或类似服务)

-   **设计点**: 封装合同相关的业务逻辑。
-   **设计说明**: 包含创建、更新、查询合同的方法，以及处理续约、签名等复杂流程的方法。
-   **检查方法**: 审查 `backend/services/contract_service.py` (或相应文件) 的类结构和方法签名。
-   **检查结果**: [待填充]

### 2.2. 合同创建逻辑

-   **设计点**: 实现从模板创建 `FormalContract` 的流程。
-   **设计说明**: 
    -   接收模板ID和合同数据。
    -   验证数据。
    -   创建 `FormalContract` 实例，并将其 `type` 设置为 `'formal'`。
    -   生成 `unique_signing_token`。
    -   初始 `signing_status` 为 `unsigned`。
-   **检查方法**: 单元测试 `ContractService.create_contract_from_template()` 方法。
-   **检查结果**: [待填充]

### 2.3. 合同续约/变更逻辑

-   **设计点**: 实现从现有合同创建新合同的流程。
-   **设计说明**:
    -   接收源合同ID。
    -   复制源合同大部分数据到新合同。
    -   新合同的 `previous_contract_id` 指向源合同。
    -   允许修改员工、薪酬等信息。
    -   源合同状态更新为 `expired` 或 `terminated`。
-   **检查方法**: 单元测试 `ContractService.renew_contract()` 或 `ContractService.amend_contract()` 方法。
-   **检查结果**: [待填充]

### 2.4. 管理费转移逻辑

-   **设计点**: 复用现有财务调整项转移功能。
-   **设计说明**:
    -   **调研**: 确定现有 `FinancialAdjustment` 模型和相关服务中，用于处理费用转移的具体方法或模式。
    -   **集成**: 在续约/变更流程中，当运营人员选择转移管理费时，调用该现有功能，创建类型为 `DEFERRED_FEE` 或 `CUSTOMER_DECREASE` (针对源合同) 和 `CUSTOMER_INCREASE` (针对新合同) 的 `FinancialAdjustment` 记录。
-   **检查方法**: 
    -   代码审查 `ContractService` 中调用财务调整服务的逻辑。
    -   集成测试，验证管理费转移后，新旧合同的账单金额是否正确。
-   **检查结果**: [待填充]

### 2.5. 员工薪酬更新逻辑

-   **设计点**: 确保员工薪酬变更时，`ServicePersonnel` 和 `EmployeeSalaryHistory` 同步更新。
-   **设计说明**: 在新合同生效时，如果员工薪酬发生变化，更新 `ServicePersonnel.current_salary` (如果存在此字段) 并向 `EmployeeSalaryHistory` 插入新记录。
-   **检查方法**: 单元测试 `ContractService` 中处理薪酬变更的方法。
-   **检查结果**: [待填充]

### 2.6. 电子签名处理逻辑

-   **设计点**: 实现签名流程的状态流转和数据存储。
-   **设计说明**:
    -   `signing_status` 枚举的正确流转。
    -   签名图片上传到指定存储路径 (例如 `instance/uploads/signatures/`)。
    -   `customer_signature` 和 `employee_signature` 字段存储图片路径。
-   **检查方法**: 单元测试签名提交方法，验证状态和数据存储。
-   **检查结果**: [待填充]

### 2.7. 账单生成集成

-   **设计点**: 确保 `FormalContract` 能被现有账单引擎识别并生成账单。
-   **设计说明**: 现有账单引擎应能通过 `BaseContract` 的 `contract_id` 找到 `FormalContract` 的实例，并根据其字段生成 `CustomerBill` 和 `EmployeePayroll`。
-   **检查方法**: 集成测试，创建 `active` 状态的 `FormalContract`，并验证是否生成了正确的账单。
-   **检查结果**: [待填充]

## 3. API 接口设计

### 3.1. `ContractTemplate` CRUD API

-   **设计点**: 为合同模板提供 RESTful API。
-   **设计说明**: 
    -   `GET /api/contract_templates`: 获取所有模板。
    -   `GET /api/contract_templates/<id>`: 获取单个模板。
    -   `POST /api/contract_templates`: 创建模板。
    -   `PUT /api/contract_templates/<id>`: 更新模板。
    -   `DELETE /api/contract_templates/<id>`: 删除模板。
-   **检查方法**: 使用 Postman 或类似工具测试所有 API 端点。
-   **检查结果**: [待填充]

### 3.2. 新建 `FormalContract` API

-   **设计点**: 提供创建新正式合同的 API。
-   **设计说明**: `POST /api/contracts/formal`，接收模板ID和合同详情数据，返回新合同ID和签名链接。
-   **检查方法**: Postman 测试。
-   **检查结果**: [待填充]

### 3.3. 合同续约/变更 API

-   **设计点**: 提供合同续约/变更的 API。
-   **设计说明**: `POST /api/contracts/<id>/renew` 或 `POST /api/contracts/<id>/amend`，接收源合同ID和新合同数据，包含管理费转移选项。
-   **检查方法**: Postman 测试。
-   **检查结果**: [待填充]

### 3.4. 电子签名 API

-   **设计点**: 提供公共签名 API。
-   **设计说明**: 
    -   `GET /api/public/contracts/sign/<token>`: 获取合同详情。
    -   `POST /api/public/contracts/sign/<token>/customer`: 提交客户签名。
    -   `POST /api/public/contracts/sign/<token>/employee`: 提交员工签名。
-   **检查方法**: Postman 测试，模拟客户和员工签名流程。
-   **检查结果**: [待填充]

### 3.5. `ServicePersonnel` 拼音搜索 API

-   **设计点**: 提供员工拼音模糊搜索 API。
-   **设计说明**: `GET /api/service_personnel/search?query=<pinyin_or_name>`，返回匹配的员工列表。
-   **检查方法**: Postman 测试，验证搜索结果的准确性和性能。
-   **检查结果**: [待填充]

## 4. 前端 UI/UX 设计

### 4.1. 合同模板管理界面

-   **设计点**: 模板列表、创建/编辑表单。
-   **设计说明**: 列表展示模板名称、类型、版本。编辑表单支持 Markdown 编辑器。
-   **检查方法**: 浏览器中手动测试界面功能和响应式布局。
-   **检查结果**: [待填充]

### 4.2. 创建合同表单

-   **设计点**: 包含模板选择、客户/员工信息填写、财务信息、扩展条款。
-   **设计说明**: 员工信息输入框应集成拼音搜索自动补全功能。
-   **检查方法**: 浏览器中手动测试表单填写流程和数据提交。
-   **检查结果**: [待填充]

### 4.3. 合同详情页与续约/变更按钮

-   **设计点**: 展示合同详情，提供续约/变更入口。
-   **设计说明**: 按钮应在合同状态允许时才显示。点击后跳转到预填充的创建表单。
-   **检查方法**: 浏览器中手动测试按钮的可见性和跳转逻辑。
-   **检查结果**: [待填充]

### 4.4. 电子签约页面

-   **设计点**: 移动端友好的合同展示和签名界面。
-   **设计说明**: 
    -   清晰展示合同内容。
    -   提供手写签名区域。
    -   提交按钮。
-   **检查方法**: 在不同移动设备模拟器或真机上测试页面布局、签名功能和提交流程。
-   **检查结果**: [待填充]

## 5. 数据迁移设计

### 5.1. `jinshuju` 数据同步脚本

-   **设计点**: 编写一次性脚本，同步历史客户和员工数据。
-   **设计说明**: 
    -   解析 `jinshuju` 导出数据。
    -   根据身份证号判断客户/员工是否存在，不存在则创建，存在则更新。
    -   **为同步的每个员工创建一条 `EmployeeSalaryHistory` 记录，记录其初始薪酬。**
-   **检查方法**: 
    -   代码审查脚本逻辑。
    -   在测试环境中运行脚本，验证数据导入的准确性。
-   **检查结果**: [待填充]
