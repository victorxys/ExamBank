# Contract Data Optimization Test Cases

### 测试用例 1: 创建合同并验证模板内容关联

**测试目的:**
验证在移除 `template_content` 字段后，创建合同是否能正确关联模板，并通过关联关系获取模板内容。

**涉及模块/文件:**
`ContractService.create_contract`, `BaseContract`, `ContractTemplate`

**输入:**
- `template_id`: 有效的合同模板 ID
- `customer_id`: 有效的客户 ID
- `employee_id`: 有效的员工 ID

**期望输出:**
- 合同创建成功。
- 获取合同详情时，`contract.template_content` (或 API 返回的对应字段) 应包含模板的原始内容。
- 数据库 `contracts` 表中不应有 `template_content` 列（或为空）。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

---

### 测试用例 2: 客户签署合同 (签名文件存储)

**测试目的:**
验证客户签名是否被正确保存为文件，并在数据库中创建 `ContractSignature` 记录。

**涉及模块/文件:**
`ContractService.sign_contract`, `ContractSignature`

**输入:**
- `contract_id`: 待签署的合同 ID
- `signature_base64`: 客户签名的 Base64 字符串

**期望输出:**
- 签名图片被保存到指定的文件存储路径。
- `contract_signatures` 表中新增一条记录，`contract_id` 正确，`signature_type` 为 'customer'，`file_path` 指向保存的文件。
- `contracts` 表中 `customer_signature` 字段（如果还存在）应为空或被移除。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

---

### 测试用例 3: 获取合同详情 (包含签名 URL)

**测试目的:**
验证获取合同详情 API 是否能正确返回签名图片的 URL。

**涉及模块/文件:**
`ContractService.get_contract`, `contract_api.py`

**输入:**
- `contract_id`: 已签署的合同 ID

**期望输出:**
- API 响应中包含 `customer_signature_url` (或类似字段)。
- 该 URL 能被前端访问并显示图片。
- API 响应中包含 `template_content` (来自关联模板)。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]
