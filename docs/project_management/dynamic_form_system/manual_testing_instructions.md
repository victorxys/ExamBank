### 如何手动测试 POST 和 PATCH 端点 (带 sync_mapping)

为了测试 `POST /api/form-data/submit/<form_id>` 和 `PATCH /api/form-data/<data_id>` 端点，你需要一个包含 `sync_mapping` 配置的 `DynamicForm` 记录。

#### 步骤 1: 准备环境

1.  **启动 Flask 服务器**：
    ```bash
    source venv/bin/activate
    flask run
    ```
2.  **获取有效的 JWT Token**：
    *   你需要一个已登录用户的 JWT Token。通常通过登录 API 获取。
    *   在 Postman 中，将此 Token 设置为 `Authorization: Bearer <你的JWT Token>` 请求头。

#### 步骤 2: 创建一个带有 `sync_mapping` 的 `DynamicForm` 记录

我们将创建一个简单的 `DynamicForm`，它将表单中的 `employee_name` 和 `employee_phone` 字段同步到 `ServicePersonnel` 模型。

1.  **打开一个新的终端**。
2.  **激活虚拟环境**：
    ```bash
    source venv/bin/activate
    ```
3.  **进入 Flask shell**：
    ```bash
    flask shell
    ```
4.  **在 shell 中执行以下 Python 代码来创建 `DynamicForm`**：

    ```python
    import uuid
    from backend.extensions import db
    from backend.models import DynamicForm

    # 定义 sync_mapping
    # 这个映射将表单字段 'employee_name' 和 'employee_phone' 同步到 ServicePersonnel 模型
    # 'lookup_field': 'phone_number' 表示如果 ServicePersonnel 中存在相同 phone_number 的记录，则更新它，否则创建新记录。
    sample_sync_mapping = {
        "ServicePersonnel": {
            "model": "ServicePersonnel",
            "lookup_field": "phone_number",
            "mappings": [
                {"form_field": "employee_name", "target_field": "name"},
                {"form_field": "employee_phone", "target_field": "phone_number", "lookup_field": "phone_number"},
                {"form_field": "employee_address", "target_field": "address"}
            ]
        }
    }

    # 定义一个简单的 SurveyJS schema (仅包含同步字段)
    sample_surveyjs_schema = {
        "pages": [
            {
                "name": "page1",
                "elements": [
                    {"type": "text", "name": "employee_name", "title": "员工姓名"},
                    {"type": "text", "name": "employee_phone", "title": "员工电话"},
                    {"type": "text", "name": "employee_address", "title": "员工地址"}
                ]
            }
        ]
    }

    # 创建 DynamicForm 实例
    new_form = DynamicForm(
        name="员工登记表",
        form_token=str(uuid.uuid4()), # 使用 UUID 作为 token
        description="用于登记新员工信息的动态表单",
        surveyjs_schema=sample_surveyjs_schema,
        sync_mapping=sample_sync_mapping
    )

    db.session.add(new_form)
    db.session.commit()

    print(f"DynamicForm '{new_form.name}' created with ID: {new_form.id}")
    print(f"请复制此 ID 用于 POST 请求: {new_form.id}")
    ```
5.  **复制输出的 `DynamicForm` ID**。

#### 步骤 3: 测试 `POST` 请求 (提交新表单数据)

1.  **在 Postman 中配置请求**：
    *   **方法 (Method):** `POST`
    *   **URL:** `http://127.0.0.1:5000/api/form-data/submit/<步骤2中复制的DynamicForm ID>`
    *   **Headers:** `Authorization: Bearer <你的JWT Token>`
    *   **Body:** 选择 `raw`，类型为 `JSON`，输入以下内容：
        ```json
        {
            "data": {
                "employee_name": "张三",
                "employee_phone": "13812345678",
                "employee_address": "北京市朝阳区"
            }
        }
        ```
2.  **发送请求**。
3.  **验证 `POST` 响应**：
    *   你应该收到 `201 Created` 状态码。
    *   响应体中会包含 `message` 和新创建的 `DynamicFormData` 记录的 `id`。**复制这个 `id`，它将用于 `PATCH` 请求。**
4.  **验证数据库中的 `DynamicFormData` 记录**：
    *   在 Flask shell 中，执行：
        ```python
        from backend.models import DynamicFormData
        new_data = DynamicFormData.query.get(uuid.UUID('<POST响应中的DynamicFormData ID>'))
        print(new_data.data)
        print(new_data.service_personnel_id) # 应该显示一个 UUID，不再是 None
        ```
5.  **验证数据库中的 `ServicePersonnel` 记录**：
    *   在 Flask shell 中，执行：
        ```python
        from backend.models import ServicePersonnel
        # 使用上面打印出的 service_personnel_id
        employee = ServicePersonnel.query.get(new_data.service_personnel_id)
        print(employee.name)
        print(employee.phone_number)
        print(employee.address)
        # 确认 ServicePersonnel 表中已创建了一个新记录，并且 name、phone_number 和 address 字段已正确填充。
        ```
    *   你应该看到 `ServicePersonnel` 表中创建了一个新记录，并且 `name`、`phone_number` 和 `address` 字段已正确填充。

#### 步骤 4: 测试 `PATCH` 请求 (更新现有表单数据)

1.  **在 Postman 中配置请求**：
    *   **方法 (Method):** `PATCH`
    *   **URL:** `http://127.0.0.1:5000/api/form-data/<步骤3中POST响应的DynamicFormData ID>`
    *   **Headers:** `Authorization: Bearer <你的JWT Token>`
    *   **Body:** 选择 `raw`，类型为 `JSON`，输入以下内容：
        ```json
        {
            "data": {
                "employee_name": "张三 (已更新)",
                "employee_phone": "13812345678", // 保持电话号码不变，用于查找现有员工
                "employee_address": "上海市浦东新区"
            }
        }
        ```
2.  **发送请求**。
3.  **验证 `PATCH` 响应**：
    *   你应该收到 `200 OK` 状态码。
    *   响应体中会包含 `message` 和更新的 `DynamicFormData` 记录的 `id`。
4.  **验证数据库中的 `DynamicFormData` 记录**：
    *   在 Flask shell 中，执行：
        ```python
        from backend.models import DynamicFormData
        updated_data = DynamicFormData.query.get(uuid.UUID('<PATCH响应中的DynamicFormData ID>'))
        print(updated_data.data)
        # 确认 data 字段已更新
        ```
5.  **验证数据库中的 `ServicePersonnel` 记录**：
    *   在 Flask shell 中，执行：
        ```python
        from backend.models import ServicePersonnel
        # 使用之前 POST 请求中 ServicePersonnel 的 ID
        employee = ServicePersonnel.query.get(updated_data.service_personnel_id)
        print(employee.name)
        print(employee.phone_number)
        print(employee.address)
        # 确认 ServicePersonnel 记录已被更新，而不是创建了新记录
        ```
    *   你应该看到 `ServicePersonnel` 记录的 `name` 和 `address` 字段已更新，但 `phone_number` 保持不变（因为它是查找字段）。

通过这些步骤，你可以手动验证 `POST` 和 `PATCH` 端点以及 `sync_mapping` 逻辑是否按预期工作。

---
**备注：**

*   已为 `DynamicFormData` 的 `POST` 和 `PATCH` 端点编写了自动化集成测试，验证 `sync_mapping` 逻辑。这些测试位于 `backend/tests/test_dynamic_form_data_api.py`。
*   由于 `genai` 导入错误，自动化测试目前被阻塞。一旦该问题解决，这些测试将提供更可靠的验证。