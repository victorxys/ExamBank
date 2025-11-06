# To-Do List：创建正式合同

## 1. 后端开发

*   **API 端点实现**
    *   在 `backend/api/contract_api.py` 中添加 `/api/contracts/formal` POST 路由。
    *   实现请求数据解析和验证逻辑。
    *   从 `backend.models` 导入 `FormalContract` 和 `ContractTemplate`。
    *   从 `pypinyin` 库导入 `pinyin` 和 `Style`，用于生成客户姓名的拼音。
    *   查询 `ContractTemplate` 和 `User` 确保存在。
    *   创建 `FormalContract` 实例并填充数据。
    *   处理可选字段（如 `termination_date`, `deposit_amount` 等）。
    *   将新合同添加到数据库会话并提交。
    *   返回成功响应（201 Created）和新合同ID。

*   **错误处理**
    *   处理缺少必填字段的错误（400 Bad Request）。
    *   处理合同模板或服务人员不存在的错误（404 Not Found）。
    *   处理数据格式错误（`ValueError`, `decimal.InvalidOperation`）。
    *   处理数据库完整性错误（`IntegrityError`）。
    *   处理其他未预期错误（500 Internal Server Error）。
    *   确保在异常情况下回滚数据库事务。

*   **日志记录**
    *   在API的开始和结束记录日志。
    *   记录接收到的请求数据。
    *   记录任何警告和错误信息。

## 2. 依赖管理

*   确认 `pypinyin` 库已包含在 `backend/requirements.txt` 中。

## 3. 测试

*   **单元测试**
    *   编写测试用例，验证成功创建合同的场景。
    *   编写测试用例，验证缺少必填字段的场景。
    *   编写测试用例，验证合同模板或服务人员不存在的场景。
    *   编写测试用例，验证无效日期或金额格式的场景。
    *   编写测试用例，验证数据库完整性错误的场景。
    *   编写测试用例，验证客户姓名拼音生成功能。

## 4. 文档

*   更新API文档（如果存在）以包含新的 `/api/contracts/formal` 端点。
