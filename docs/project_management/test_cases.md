# 合同管理功能 - 测试用例

## 1. 合同模板管理 (`ContractTemplate`)

### 测试用例: 创建新的合同模板

**测试目的:** 验证系统能否成功创建并存储新的合同模板，包括模板名称、类型、内容和版本。

**涉及模块/文件:**
- `backend/models.py` (ContractTemplate)
- `backend/api/contract_template_api.py` (或类似文件)
- `backend/services/contract_service.py` (或类似文件)

**输入:**
- `template_name`: "育儿嫂-标准版"
- `contract_type`: "nanny"
- `content`: "# 育儿嫂合同\n..."
- `version`: 1

**期望输出:**
- 数据库中成功插入一条 `ContractTemplate` 记录。
- 返回创建成功的模板信息，包含生成的 `id`。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

### 测试用例: 获取合同模板列表

**测试目的:** 验证系统能否正确返回所有合同模板的列表。

**涉及模块/文件:**
- `backend/api/contract_template_api.py`

**输入:** (无)

**期望输出:**
- 返回一个包含所有 `ContractTemplate` 记录的列表。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

### 测试用例: 更新合同模板内容

**测试目的:** 验证系统能否成功更新现有合同模板的内容和版本。

**涉及模块/文件:**
- `backend/models.py` (ContractTemplate)
- `backend/api/contract_template_api.py`

**输入:**
- `template_id`: (现有模板ID)
- `content`: "# 育儿嫂合同 (更新版)\n..."
- `version`: 2

**期望输出:**
- 数据库中对应 `ContractTemplate` 记录的 `content` 和 `version` 字段被更新。
- 返回更新后的模板信息。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

### 测试用例: 删除合同模板

**测试目的:** 验证系统能否成功删除合同模板。

**涉及模块/文件:**
- `backend/models.py` (ContractTemplate)
- `backend/api/contract_template_api.py`

**输入:**
- `template_id`: (现有模板ID)

**期望输出:**
- 数据库中对应 `ContractTemplate` 记录被删除。
- 返回删除成功状态。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

## 2. 正式合同创建与管理 (`FormalContract`)

### 测试用例: 从模板创建新合同

**测试目的:** 验证运营人员能否从现有模板创建一份新的 `FormalContract`，并正确填充客户、员工和合同条款信息。

**涉及模块/文件:**
- `backend/models.py` (FormalContract, Customer, ServicePersonnel)
- `backend/api/contract_api.py`
- `backend/services/contract_service.py`

**输入:**
- `template_id`: (现有模板ID)
- `customer_info`: (姓名, 电话, 身份证号, 地址)
- `employee_info`: (通过拼音搜索选中的 ServicePersonnel ID)
- `contract_details`: (劳务报酬, 保证金, 管理费, 起止日期, 服务内容, 服务方式, 是否自动续约等)

**期望输出:**
- 数据库中成功插入一条 `FormalContract` 记录，状态为 `unsigned`。
- `template_id`、客户和员工信息、所有合同条款正确关联和存储。
- 生成唯一的 `unique_signing_token`。
- 返回新合同的 `id` 和签名链接。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

### 测试用例: 员工拼音模糊搜索

**测试目的:** 验证运营人员能否通过员工姓名的拼音快速搜索到 `ServicePersonnel`。

**涉及模块/文件:**
- `backend/models.py` (ServicePersonnel)
- `backend/api/service_personnel_api.py` (或类似文件)

**输入:**
- `search_query`: "zhangsan" (或 "zs")

**期望输出:**
- 返回包含 "张三" 等匹配员工的列表。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

### 测试用例: 客户签署合同

**测试目的:** 验证客户能否通过签名链接查看合同详情，并成功提交签名，更新合同状态。

**涉及模块/文件:**
- `backend/models.py` (FormalContract)
- `backend/api/public_contract_api.py` (或类似文件)

**输入:**
- `unique_signing_token`: (合同创建时生成的token)
- `customer_signature_data`: (Base64编码的签名图片数据)

**期望输出:**
- 数据库中对应 `FormalContract` 记录的 `signing_status` 更新为 `customer_signed`。
- `customer_signature` 字段存储签名数据。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

### 测试用例: 员工签署合同

**测试目的:** 验证员工能否通过签名链接查看合同详情，并成功提交签名，更新合同状态为 `active`。

**涉及模块/文件:**
- `backend/models.py` (FormalContract)
- `backend/api/public_contract_api.py`

**输入:**
- `unique_signing_token`: (合同创建时生成的token)
- `employee_signature_data`: (Base64编码的签名图片数据)

**期望输出:**
- 数据库中对应 `FormalContract` 记录的 `signing_status` 更新为 `active`。
- `employee_signature` 字段存储签名数据。
- **触发账单生成逻辑**。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

## 3. 合同生命周期管理 (续约与变更)

### 测试用例: 从现有合同续约

**测试目的:** 验证运营人员能否从一个已生效的合同发起续约，并生成一份预填充数据的新合同。

**涉及模块/文件:**
- `backend/models.py` (FormalContract)
- `backend/api/contract_api.py`
- `backend/services/contract_service.py`

**输入:**
- `source_contract_id`: (现有 `active` 状态的合同ID)
- `new_contract_details`: (新的起止日期，可能修改的劳务报酬等)

**期望输出:**
- 数据库中成功插入一条新的 `FormalContract` 记录。
- 新合同的 `previous_contract_id` 正确指向源合同。
- 新合同的 `signing_status` 为 `unsigned`。
- 源合同的 `signing_status` 更新为 `expired` 或 `terminated`。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

### 测试用例: 续约时员工薪酬变更

**测试目的:** 验证在续约过程中，如果员工劳务报酬发生变化，系统能否正确更新 `ServicePersonnel` 的最新薪酬并记录到 `EmployeeSalaryHistory`。

**涉及模块/文件:**
- `backend/models.py` (ServicePersonnel, EmployeeSalaryHistory)
- `backend/services/contract_service.py`

**输入:**
- `source_contract_id`: (现有合同ID)
- `new_contract_details`: (包含新的劳务报酬)

**期望输出:**
- `ServicePersonnel` 记录的最新薪酬被更新。
- `EmployeeSalaryHistory` 中新增一条薪酬变更记录。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

### 测试用例: 续约时管理费转移

**测试目的:** 验证在续约过程中，如果运营人员选择转移管理费，系统能否正确调用现有财务调整逻辑进行转移。

**涉及模块/文件:**
- `backend/models.py` (FinancialAdjustment)
- `backend/services/contract_service.py`
- `backend/services/financial_adjustment_service.py` (或类似文件)

**输入:**
- `source_contract_id`: (现有合同ID)
- `new_contract_details`: (新合同信息)
- `transfer_management_fee`: `True`

**期望输出:**
- 数据库中生成相应的 `FinancialAdjustment` 记录，正确反映管理费从源合同转移到新合同。
- 验证相关账单的应付金额是否正确更新。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

## 4. 数据同步与初始化

### 测试用例: `jinshuju` 历史数据同步

**测试目的:** 验证一次性脚本能否正确从 `jinshuju` 历史数据中解析并同步客户和员工信息，并创建员工的初始薪酬历史记录。

**涉及模块/文件:**
- `backend/models.py` (Customer, ServicePersonnel, EmployeeSalaryHistory)
- `backend/services/data_sync_service.py` (或新脚本)

**输入:**
- `jinshuju_export_data`: (模拟的金数据导出CSV/JSON文件)

**期望输出:**
- 数据库中创建或更新 `Customer` 和 `ServicePersonnel` 记录。
- 为每个同步的员工在 `EmployeeSalaryHistory` 中创建一条初始薪酬记录。
- 确保身份证号作为唯一标识符的逻辑正确。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]
