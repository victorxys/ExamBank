### 测试用例: 获取包含完整合同信息的员工详情 (API)

**测试目的:**
验证 `GET /api/staff/employees/<id>` API能返回完整的员工信息，并且其薪资历史记录中包含了所有必需的关联合同及客户信息，以及正确计算出的“原月薪”。

**涉及模块/文件:**
- `backend/api/staff_api.py` (待创建)
- `backend/models.py`

**输入:**
- 数据库中存在员工 `employee-A`，他有两条薪资记录 `hist-1` 和 `hist-2`。
- `hist-1` (`2023-10-01`, 薪资10000) 关联 `contract-1`。`contract-1` 的客户是 "客户甲"，地址 "地址甲"。
- `hist-2` (`2024-10-01`, 薪资12000) 关联 `contract-2`。`contract-2` 的客户是 "客户乙"，地址 "地址乙"。
- HTTP `GET` 请求发送至 `/api/staff/employees/employee-A`。

**期望输出:**
- HTTP 状态码: `200 OK`。
- 响应体为一个JSON对象，其 `salary_history` 数组按日期降序排列，内容如下:
  ```json
  {
    "id": "employee-A",
    "name": "员工A",
    ...,
    "salary_history": [
      {
        "id": "hist-2",
        "previous_salary": "10000.00",
        "new_salary": "12000.00",
        "effective_date": "2024-10-01",
        "customer_name": "客户乙",
        "contract_start_date": "...",
        "contract_end_date": "...",
        "customer_address": "地址乙",
        "contract_notes": "..."
      },
      {
        "id": "hist-1",
        "previous_salary": null,
        "new_salary": "10000.00",
        "effective_date": "2023-10-01",
        "customer_name": "客户甲",
        "contract_start_date": "...",
        "contract_end_date": "...",
        "customer_address": "地址甲",
        "contract_notes": "..."
      }
    ]
  }
  ```

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

---
### 测试用例: 薪资历史关联的合同或客户信息不完整 (API)

**测试目的:**
验证当薪资历史记录关联的合同或客户不存在时，API不会崩溃，而是能优雅地返回 `null`。

**涉及模块/文件:**
- `backend/api/staff_api.py` (待创建)

**输入:**
- 数据库中某条薪资记录关联的 `contract_id` 指向一个已被删除的合同。
- HTTP `GET` 请求获取包含该记录的员工详情。

**期望输出:**
- HTTP 状态码: `200 OK`。
- 响应体中，该条薪资历史记录的合同相关字段（`customer_name`, `customer_address` 等）值为 `null` 或 "N/A"。
  ```json
  {
    ...,
    "salary_history": [
      {
        ...,
        "customer_name": null,
        "customer_address": null,
        ...
      }
    ]
  }
  ```

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]

---
### 测试用例: 前端正确渲染包含合同信息的薪资历史表格

**测试目的:**
验证前端详情组件能正确渲染一个包含所有新增列（客户名称、合同周期、原月薪、薪资变化等）的表格。

**涉及模块/文件:**
- `frontend/src/components/EmployeeDetails.jsx` (待创建)

**输入:**
- 用户点击某员工。
- API Mock返回符合"获取包含完整合同信息的员工详情"测试用例期望输出的JSON数据。

**期望输出:**
- 页面上出现一个薪资历史表格。
- 表格包含 "客户名称", "合同周期", "上户地址", "原月薪", "变更后月薪", "薪资变化" 等列。
- 第一行数据显示 "客户乙"、"10000.00"、"12000.00"，并且"薪资变化"列有一个**绿色向上箭头**。
- 第二行数据显示 "客户甲"、空 ("原月薪"列)、"10000.00"，并且"薪资变化"列**没有箭头**。

**实际输出 & 测试结果:**
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果:** [待填充]
