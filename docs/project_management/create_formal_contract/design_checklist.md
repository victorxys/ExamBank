# 设计检查清单：创建正式合同

## Checklist

*   **API 端点设计**
    *   [x] 确保端点路径为 `/api/contracts/formal`，方法为 `POST`。
    *   [x] 确保请求体为 JSON 格式。

*   **数据验证**
    *   [x] 检查所有必填字段（`contract_template_id`, `customer_name`, `service_personnel_id`, `start_date`, `end_date`, `monthly_fee`, `commission_rate`, `contract_type`, `status`）是否存在且不为空。
    *   [x] 验证 `contract_template_id` 是否对应一个存在的 `ContractTemplate`。
    *   [x] 验证 `service_personnel_id` 是否对应一个存在的 `User`。
    *   [x] 验证日期字段（`start_date`, `end_date`, `termination_date`）是否为有效的 ISO 格式日期。
    *   [x] 验证金额字段（`monthly_fee`, `commission_rate`, `deposit_amount`, `deposit_deduction_amount`）是否为有效的数字格式。

*   **业务逻辑**
    *   [x] 确保 `FormalContract` 实例正确创建并填充所有字段。
    *   [x] 确保客户姓名的拼音自动生成逻辑正确，并在失败时优雅降级。
    *   [x] 确保可选字段（如 `termination_date`, `deposit_amount`, `is_monthly_auto_renew`, `auto_renew_period_months`, `source`）被正确处理。

*   **错误处理**
    *   [x] 缺少必填字段时返回 400 Bad Request。
    *   [x] 合同模板或服务人员不存在时返回 404 Not Found。
    *   [x] 数据格式错误时返回 400 Bad Request。
    *   [x] 数据库完整性错误时返回 409 Conflict。
    *   [x] 其他内部服务器错误时返回 500 Internal Server Error。
    *   [x] 确保所有数据库操作都在事务中，并在出错时回滚。

*   **安全性**
    *   [x] 确保接口受 `jwt_required()` 保护。

*   **日志记录**
    *   [x] 记录请求的开始和结束。
    *   [x] 记录接收到的请求数据。
    *   [x] 记录所有错误和警告信息。

## 检查说明

*   **API 端点设计**：通过查看 `contract_bp.route` 装饰器和方法定义进行检查。
*   **数据验证**：通过检查代码中的 `if not data[field]`、`ContractTemplate.query.get()`、`User.query.get()`、`datetime.fromisoformat()` 和 `D()` 调用进行检查。
*   **业务逻辑**：通过检查 `FormalContract` 实例的创建和字段赋值，以及 `pypinyin` 库的使用进行检查。
*   **错误处理**：通过检查 `try...except` 块、`jsonify` 返回的错误码和错误信息，以及 `db.session.rollback()` 调用进行检查。
*   **安全性**：通过检查 `@jwt_required()` 装饰器进行检查。
*   **日志记录**：通过检查 `current_app.logger.debug`、`current_app.logger.warning` 和 `current_app.logger.error` 调用进行检查。

## AI 模拟

*   **模拟调用**：
    *   **API**：`POST /api/contracts/formal`
    *   **请求体示例**：
        ```json
        {
            "contract_template_id": "<valid_template_uuid>",
            "customer_name": "张三",
            "service_personnel_id": "<valid_user_uuid>",
            "start_date": "2023-01-01",
            "end_date": "2023-12-31",
            "monthly_fee": "1000.00",
            "commission_rate": "0.10",
            "contract_type": "nanny",
            "status": "active",
            "deposit_amount": "2000.00"
        }
        ```
    *   **预期结果**：
        *   成功：返回 201 Created，包含 `{"message": "正式合同创建成功", "contract_id": "<new_contract_uuid>"}`。
        *   失败（缺少字段）：返回 400 Bad Request，包含 `{"error": "缺少必填字段: <field_name>"}`。
        *   失败（模板不存在）：返回 404 Not Found，包含 `{"error": "合同模板未找到"}`。
        *   失败（日期格式错误）：返回 400 Bad Request，包含 `{"error": "数据格式错误: <error_details>"}`。

*   **检查结果**：
    *   通过：所有检查点在代码中均已覆盖。
