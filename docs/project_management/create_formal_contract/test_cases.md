# 测试用例：创建正式合同

## 测试用例: 成功创建正式合同

**测试目的:**
验证API能够成功接收所有有效数据，创建 `FormalContract` 实例，并将其持久化到数据库中。同时，检查返回的响应是否符合预期，以及客户姓名的拼音是否正确生成。

**涉及模块/文件:**
`backend/api/contract_api.py` 中的 `create_formal_contract` 函数。

**输入:**
一个包含所有必填字段和部分可选字段的有效 JSON 请求体：
```json
{
    "contract_template_id": "<一个存在的合同模板UUID>",
    "customer_name": "李小明",
    "service_personnel_id": "<一个存在的用户UUID>",
    "start_date": "2024-03-01",
    "end_date": "2025-02-28",
    "monthly_fee": "5000.00",
    "commission_rate": "0.05",
    "contract_type": "nanny",
    "status": "active",
    "deposit_amount": "10000.00",
    "is_monthly_auto_renew": true
}
```

**期望输出:**
*   HTTP 状态码：201 Created。
*   响应体：`{"message": "正式合同创建成功", "contract_id": "<新创建合同的UUID>"}`。
*   数据库中存在一条新的 `FormalContract` 记录，其字段值与输入数据匹配，且 `customer_name_pinyin` 字段为 "li xiaoming lxm"。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充，例如：通过/失败，并简要说明原因]

## 测试用例: 缺少必填字段

**测试目的:**
验证API在缺少任何一个必填字段时，能够正确返回错误信息和相应的状态码。

**涉及模块/文件:**
`backend/api/contract_api.py` 中的 `create_formal_contract` 函数。

**输入:**
一个缺少 `customer_name` 字段的 JSON 请求体：
```json
{
    "contract_template_id": "<一个存在的合同模板UUID>",
    "service_personnel_id": "<一个存在的用户UUID>",
    "start_date": "2024-03-01",
    "end_date": "2025-02-28",
    "monthly_fee": "5000.00",
    "commission_rate": "0.05",
    "contract_type": "nanny",
    "status": "active"
}
```

**期望输出:**
*   HTTP 状态码：400 Bad Request。
*   响应体：`{"error": "缺少必填字段: customer_name"}`。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充，例如：通过/失败，并简要说明原因]

## 测试用例: 合同模板不存在

**测试目的:**
验证API在 `contract_template_id` 不对应任何现有合同模板时，能够正确返回错误信息。

**涉及模块/文件:**
`backend/api/contract_api.py` 中的 `create_formal_contract` 函数。

**输入:**
一个包含不存在的 `contract_template_id` 的 JSON 请求体：
```json
{
    "contract_template_id": "<一个不存在的合同模板UUID>",
    "customer_name": "王大锤",
    "service_personnel_id": "<一个存在的用户UUID>",
    "start_date": "2024-03-01",
    "end_date": "2025-02-28",
    "monthly_fee": "5000.00",
    "commission_rate": "0.05",
    "contract_type": "nanny",
    "status": "active"
}
```

**期望输出:**
*   HTTP 状态码：404 Not Found。
*   响应体：`{"error": "合同模板未找到"}`。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充，例如：通过/失败，并简要说明原因]

## 测试用例: 服务人员不存在

**测试目的:**
验证API在 `service_personnel_id` 不对应任何现有用户时，能够正确返回错误信息。

**涉及模块/文件:**
`backend/api/contract_api.py` 中的 `create_formal_contract` 函数。

**输入:**
一个包含不存在的 `service_personnel_id` 的 JSON 请求体：
```json
{
    "contract_template_id": "<一个存在的合同模板UUID>",
    "customer_name": "赵小花",
    "service_personnel_id": "<一个不存在的用户UUID>",
    "start_date": "2024-03-01",
    "end_date": "2025-02-28",
    "monthly_fee": "5000.00",
    "commission_rate": "0.05",
    "contract_type": "nanny",
    "status": "active"
}
```

**期望输出:**
*   HTTP 状态码：404 Not Found。
*   响应体：`{"error": "服务人员未找到"}`。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充，例如：通过/失败，并简要说明原因]

## 测试用例: 日期格式无效

**测试目的:**
验证API在日期字段格式无效时，能够正确返回错误信息。

**涉及模块/文件:**
`backend/api/contract_api.py` 中的 `create_formal_contract` 函数。

**输入:**
一个 `start_date` 格式无效的 JSON 请求体：
```json
{
    "contract_template_id": "<一个存在的合同模板UUID>",
    "customer_name": "钱多多",
    "service_personnel_id": "<一个存在的用户UUID>",
    "start_date": "2024/03/01", 
    "end_date": "2025-02-28",
    "monthly_fee": "5000.00",
    "commission_rate": "0.05",
    "contract_type": "nanny",
    "status": "active"
}
```

**期望输出:**
*   HTTP 状态码：400 Bad Request。
*   响应体：`{"error": "数据格式错误: <错误详情>"}` (具体错误信息可能因 `datetime.fromisoformat` 的异常而异)。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充，例如：通过/失败，并简要说明原因]

## 测试用例: 金额格式无效

**测试目的:**
验证API在金额字段格式无效时，能够正确返回错误信息。

**涉及模块/文件:**
`backend/api/contract_api.py` 中的 `create_formal_contract` 函数。

**输入:**
一个 `monthly_fee` 格式无效的 JSON 请求体：
```json
{
    "contract_template_id": "<一个存在的合同模板UUID>",
    "customer_name": "孙悟空",
    "service_personnel_id": "<一个存在的用户UUID>",
    "start_date": "2024-03-01",
    "end_date": "2025-02-28",
    "monthly_fee": "abc", 
    "commission_rate": "0.05",
    "contract_type": "nanny",
    "status": "active"
}
```

**期望输出:**
*   HTTP 状态码：400 Bad Request。
*   响应体：`{"error": "数据格式错误: <错误详情>"}` (具体错误信息可能因 `decimal.Decimal` 的异常而异)。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充，例如：通过/失败，并简要说明原因]
