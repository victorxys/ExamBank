# 替班管理费功能 - 详细测试用例

**版本:** 2.0
**日期:** 2025年10月21日

---

### **测试用例 001：为已终止的合同添加完全期外替班**

**1. 测试目的**

验证当为一个**已终止**的合同，追加一笔完全在合同有效期外的替班记录时，系统能够正确计算“替班管理费”并更新到替班记录的`substitute_management_fee`字段。

**2. 测试用的 API 接口或函数名称, 所在文件**

- **API 接口:** `POST /api/contracts/<contract_id>/substitutes`
- **接口所在文件:** `backend/api/contract_api.py`
- **核心验证函数:** `calculate_substitute_management_fee` (位于 `backend/services/billing_engine.py`)

**3. 输入**

- **数据库前置状态:**
  - `NannyContract` 表中存在一条记录:
    - `id`: `contract-A`
    - `status`: `'terminated'`
    - `is_monthly_auto_renew`: `False`
    - `end_date`: `'2025-09-30'`
    - `termination_date`: `'2025-09-30'`

- **API 请求体:**
  - **URL:** `/api/contracts/contract-A/substitutes`
  - **JSON Payload:**
    ```json
    {
        "substitute_user_id": "{id_of_a_valid_user}",
        "start_date": "2025-10-05",
        "end_date": "2025-10-15",
        "employee_level": "5200",
        "substitute_type": "nanny"
    }
    ```

**4. 期望输出**

- **API 响应:**
  - **HTTP Status Code:** `201 Created`
  - **Response Body:** 返回新创建的替班记录，其中 `substitute_management_fee` 字段应有计算出的值。

- **数据库状态变更:**
  - 在 `substitute_records` 表中，新创建的记录:
    - `contract_id`: `contract-A`
    - `substitute_management_fee`: `173.33`  (计算逻辑: `(5200 / 30) * 10% * 10天`)

**5. 实际输出 & 测试结果**

- Passed. `sub_record.substitute_management_fee` is `173.33`.

---

### **测试用例 002：为已结束的合同添加部分重叠的替班**

**1. 测试目的**

验证当为一个**已自然结束**的合同，追加一笔部分在合同有效期外的替班记录时，系统能正确计算费用（只算超出部分）并更新到`substitute_management_fee`字段。

**2. 测试用的 API 接口或函数名称, 所在文件**

- **API 接口:** `POST /api/contracts/<contract_id>/substitutes`
- **接口所在文件:** `backend/api/contract_api.py`

**3. 输入**

- **数据库前置状态:**
  - `NannyContract` 表中存在一条记录:
    - `id`: `contract-B`
    - `status`: `'finished'`
    - `is_monthly_auto_renew`: `False`
    - `end_date`: `'2025-10-10'`
    - `termination_date`: `NULL`

- **API 请求体:**
  - **URL:** `/api/contracts/contract-B/substitutes`
  - **JSON Payload:**
    ```json
    {
        "substitute_user_id": "{id_of_a_valid_user}",
        "start_date": "2025-10-08",
        "end_date": "2025-10-15",
        "employee_level": "6000",
        "substitute_type": "nanny"
    }
    ```

**4. 期望输出**

- **API 响应:**
  - **HTTP Status Code:** `201 Created`

- **数据库状态变更:**
  - 在 `substitute_records` 表中，新创建的记录:
    - `contract_id`: `contract-B`
    - `substitute_management_fee`: `100.00` (计算逻辑: `(6000 / 30) * 10% * 5天`，只计算10月11日到15日)

**5. 实际输出 & 测试结果**

- Passed. `sub_record.substitute_management_fee` is `100.00`.

---

### **测试用例 003：提前终止含有未来替班的合同**

**1. 测试目的**

验证当一个有效合同被**提前终止**时，系统能自动为所有受影响的未来替班记录计算管理费并更新`substitute_management_fee`字段。

**2. 测试用的 API 接口或函数名称, 所在文件**

- **API 接口:** `POST /api/contracts/<contract_id>/terminate`
- **接口所在文件:** `backend/api/contract_api.py`

**3. 输入**

- **数据库前置状态:**
  - `NannyContract` 表中存在一条记录:
    - `id`: `contract-C`
    - `status`: `'active'`
    - `end_date`: `'2025-11-30'`
  - `substitute_records` 表中存在一条关联到 `contract-C` 的记录:
    - `id`: `sub-rec-1`
    - `start_date`: `2025-10-20`
    - `end_date`: `2025-11-05`
    - `employee_level`: "5200"
    - `substitute_management_fee`: `0` 或 `NULL`

- **API 请求体:**
  - **URL:** `/api/contracts/contract-C/terminate`
  - **JSON Payload:**
    ```json
    {
        "termination_date": "2025-10-31"
    }
    ```

**4. 期望输出**

- **API 响应:**
  - **HTTP Status Code:** `200 OK`

- **数据库状态变更:**
  - `contracts` 表中 `contract-C` 的 `status` 变为 `'terminated'`，`termination_date` 变为 `'2025-10-31'`。
  - `substitute_records` 表中 `sub-rec-1` 的 `substitute_management_fee` 字段被更新为: `86.67` (计算逻辑: `(5200 / 30) * 10% * 5天`，计算11月1日到5日)。

**5. 实际输出 & 测试结果**

- Passed. `sub_record.substitute_management_fee` is `86.67`.

---

### **测试用例 004：为正常合同添加期内替班（费用豁免）**

**1. 测试目的**

验证为正常生效的合同添加完全在有效期内的替班时，不产生任何管理费。

**2. 测试用的 API 接口或函数名称, 所在文件**

- **API 接口:** `POST /api/contracts/<contract_id>/substitutes`
- **接口所在文件:** `backend/api/contract_api.py`

**3. 输入**

- **数据库前置状态:**
  - `NannyContract` 表中存在一条记录:
    - `id`: `contract-D`
    - `status`: `'active'`
    - `end_date`: `'2025-12-31'`

- **API 请求体:**
  - **URL:** `/api/contracts/contract-D/substitutes`
  - **JSON Payload:**
    ```json
    {
        "substitute_user_id": "{id_of_a_valid_user}",
        "start_date": "2025-11-01",
        "end_date": "2025-11-10",
        "employee_level": "5200",
        "substitute_type": "nanny"
    }
    ```

**4. 期望输出**

- **API 响应:**
  - **HTTP Status Code:** `201 Created`

- **数据库状态变更:**
  - 在 `substitute_records` 表中，新创建的记录的 `substitute_management_fee` 字段为 `0` 或 `NULL`。

**5. 实际输出 & 测试结果**

- Passed. `sub_record.substitute_management_fee` is `0`.

---

### **测试用例 005：为自动续签合同添加期外替班（费用豁免）**

**1. 测试目的**

验证为一个**未终止**的**自动续签**合同添加期外替班时，不产生任何管理费。

**2. 测试用的 API 接口或函数名称, 所在文件**

- **API 接口:** `POST /api/contracts/<contract_id>/substitutes`
- **接口所在文件:** `backend/api/contract_api.py`

**3. 输入**

- **数据库前置状态:**
  - `NannyContract` 表中存在一条记录:
    - `id`: `contract-E`
    - `status`: `'active'`
    - `is_monthly_auto_renew`: `True`
    - `end_date`: `'2025-09-30'`

- **API 请求体:**
  - **URL:** `/api/contracts/contract-E/substitutes`
  - **JSON Payload:**
    ```json
    {
        "substitute_user_id": "{id_of_a_valid_user}",
        "start_date": "2025-10-05",
        "end_date": "2025-10-15",
        "employee_level": "5200",
        "substitute_type": "nanny"
    }
    ```

**4. 期望输出**

- **API 响应:**
  - **HTTP Status Code:** `201 Created`

- **数据库状态变更:**
  - 在 `substitute_records` 表中，新创建的记录的 `substitute_management_fee` 字段为 `0` 或 `NULL`。

**5. 实际输出 & 测试结果**

- Passed. `sub_record.substitute_management_fee` is `0`.

---

### **测试用例 006：终止自动续签合同后，为受影响的替班计算费用**

**1. 测试目的**

验证当一个**自动续签**合同被终止后，系统能为超出新终止日期的替班记录正确计算管理费。

**2. 测试用的 API 接口或函数名称, 所在文件**

- **API 接口:** `POST /api/contracts/<contract_id>/terminate`
- **接口所在文件:** `backend/api/contract_api.py`

**3. 输入**

- **数据库前置状态:**
  - `NannyContract` 表中存在一条记录:
    - `id`: `contract-F`
    - `status`: `'active'`
    - `is_monthly_auto_renew`: `True`
    - `end_date`: `'2025-09-30'`
  - `substitute_records` 表中存在一条关联到 `contract-F` 的记录:
    - `id`: `sub-rec-2`
    - `start_date`: `2025-10-25`
    - `end_date`: `2025-11-10`
    - `employee_level`: "6000"
    - `substitute_management_fee`: `0` 或 `NULL`

- **API 请求体:**
  - **URL:** `/api/contracts/contract-F/terminate`
  - **JSON Payload:**
    ```json
    {
        "termination_date": "2025-10-31"
    }
    ```

**4. 期望输出**

- **API 响应:**
  - **HTTP Status Code:** `200 OK`

- **数据库状态变更:**
  - `contracts` 表中 `contract-F` 的 `status` 变为 `'terminated'`，`termination_date` 变为 `'2025-10-31'`。
  - `substitute_records` 表中 `sub-rec-2` 的 `substitute_management_fee` 字段被更新为: `200.00` (计算逻辑: `(6000 / 30) * 10% * 10天`，计算11月1日到10日)。

**5. 实际输出 & 测试结果**

- Passed. `sub_record.substitute_management_fee` is `200.00`.

---

### **测试用例 007：计费引擎正确计入替班管理费**

**1. 测试目的**

验证 `BillingEngine` 在为育儿嫂生成账单时，能够正确读取并计入 `substitute_management_fee` 的金额。

**2. 测试用的 API 接口或函数名称, 所在文件**

- **核心函数:** `_calculate_substitute_details`
- **所在文件:** `backend/services/billing_engine.py`

**3. 输入**

- **数据库前置状态:**
  - `NannyContract` 表中存在一条记录 `contract-G`。
  - `substitute_records` 表中存在一条记录:
    - `id`: `sub-rec-3`
    - `contract_id`: `contract-G`
    - `substitute_management_fee`: `150.00`
  - `customer_bills` 表中存在一个需要计算的账单，该账单关联了 `sub-rec-3` 这笔替班。

**4. 期望输出**

- **函数执行结果:**
  - 在 `_calculate_substitute_details` 函数的返回结果或其影响的账单对象中，管理费部分应包含 `150.00`。
  - 生成的客户账单 (`CustomerBill`) 的总费用中，明确包含了这笔管理费。

**5. 实际输出 & 测试结果**

- Passed. `bill.calculation_details.get('management_fee', 0)` is `150.00`.