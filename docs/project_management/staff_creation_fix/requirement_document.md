# 需求文档：修复员工信息创建 404 错误

## 1. 背景与问题
用户在“萌嫂入职登记表”中点击“创建员工信息”按钮时，后端报错 404。经排查，后端缺失对应的 API 接口 `/api/staff/create-from-form/<uuid:data_id>`。

## 2. 目标
实现缺失的后端接口，使得用户能够从“萌嫂入职登记表”的提交数据中直接创建员工（ServicePersonnel）记录。

## 3. 功能需求
### 3.1 新增 API 接口
- **路径**: `POST /api/staff/create-from-form/<uuid:data_id>`
- **输入**: `data_id` (DynamicFormData 的 UUID)
- **逻辑**:
    1. 根据 `data_id` 查询 `DynamicFormData` 记录。
    2. 解析表单数据 (`result_details` 或 `data` 字段)。
    3. 提取关键信息：姓名、手机号、身份证号、地址。
    4. 检查该手机号是否已存在于 `ServicePersonnel` 表中。
        - 如果存在，更新现有记录（可选，或报错提示已存在）。
        - 如果不存在，创建新的 `ServicePersonnel` 记录。
    5. 返回成功或失败消息。

### 3.2 数据映射 (针对 "萌嫂入职登记表")
由于表单字段可能变化，需通过字段名称（Label）或特定的 Field ID 来映射。
假设表单包含以下字段（需在代码中通过模糊匹配或配置映射）：
- 姓名 (Name)
- 手机号 (Phone Number)
- 身份证号 (ID Card Number)
- 现居住地址 (Address)

## 4. 非功能需求
- **错误处理**: 如果表单数据缺失关键字段，应返回清晰的错误提示。
- **幂等性**: 多次点击不应创建重复员工。

## 5. 约束
- 必须使用现有的 `ServicePersonnel` 模型。
- 必须兼容现有的 `DynamicFormData` 结构。
