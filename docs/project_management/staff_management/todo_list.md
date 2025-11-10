# 待办事项: 员工管理功能 (V2-修订版)

## Backend
1.  **API 设计与实现**:
    - [ ] 在 `backend/api/` 目录下创建 `staff_api.py` 并注册蓝图。
    - [ ] **Endpoint 1: 获取员工列表** (`GET /api/staff/employees`)
        - [ ] **实现**: 查询 `ServicePersonnel` 并返回 `id`, `name`, `phone_number`, `is_active`。 (此项无变化)
    - [ ] **Endpoint 2: 获取单个员工详细信息** (`GET /api/staff/employees/<uuid:employee_id>`)
        - [ ] **重构实现**:
            1.  根据 `employee_id` 查询 `ServicePersonnel`。
            2.  查询该员工的所有 `EmployeeSalaryHistory` 记录，并 **JOIN** 关联的 `BaseContract`，再 **JOIN** `Customer`。确保查询是高效的 (使用 `joinedload` 或 `selectinload`)。
            3.  将查询结果按 `effective_date` **升序**排列，以便于计算“原月薪”。
            4.  在业务逻辑中处理薪资历史列表：
                - 遍历列表，对于每一条记录，它的“变更后月薪”就是 `record.base_salary`。
                - 它的“原月薪”是**前一条**记录的 `base_salary`。第一条记录的“原月薪”为 `null` 或 `0`。
            5.  构建响应JSON，每条历史记录都必须包含：
                - `id` (薪资记录ID)
                - `previous_salary` (原月薪)
                - `new_salary` (变更后月薪)
                - `effective_date`
                - `customer_name`
                - `contract_start_date`
                - `contract_end_date`
                - `customer_address`
                - `contract_notes`
            6.  将处理后的列表（按生效日期**降序**返回给前端）和员工基本信息一起序列化返回。

## Frontend
1.  **API Service** (`frontend/src/api/staff.js`):
    - [ ] 创建或更新获取员工详情的函数，以匹配后端返回的新的、更丰富的数据结构。

2.  **路由设置**:
    - [ ] 添加 `/staff-management` 路由。(无变化)

3.  **组件开发**:
    - [ ] **`EmployeeList.jsx`**: (无变化)
    - [ ] **`EmployeeDetails.jsx`**:
        - [ ] **重构薪资历史表格**:
            - 表格列更新为: "客户名称", "合同周期", "上户地址", "原月薪", "变更后月薪", "薪资变化", "生效日期", "合同备注"。
            - "薪资变化" 列：
                - 根据 `new_salary` 和 `previous_salary` 的大小关系进行条件渲染。
                - 如果 `new_salary > previous_salary`，显示绿色向上箭头 `↑`。
                - 如果 `new_salary < previous_salary`，显示红色向下箭头 `↓`。
                - 如果相等或 `previous_salary` 为 `null`，则该列留空。
        - [ ] 确保组件能正确处理后端返回的所有新字段，包括 `null` 或空值的情况。

## 测试
1.  **后端单元测试 (`pytest`)**:
    - [ ] **更新** `GET /api/staff/employees/<id>` 的测试用例：
        - 验证响应体中的 `salary_history` 数组的每个对象都包含所有新增字段 (`customer_name`, `contract_start_date`, `customer_address`, `previous_salary` 等)。
        - 编写一个针对首次添加薪资记录的员工的测试，验证其第一条历史记录的 `previous_salary` 为 `null`。
        - 编写一个针对薪资有多次变动的员工的测试，验证其第二条记录的 `previous_salary` 等于第一条记录的 `new_salary`。
        - 验证当关联合同或客户不存在时，相关字段（如`customer_name`）能优雅地处理（返回`null`）。
2.  **前端组件测试**:
    - [ ] **更新** `EmployeeDetails` 组件的测试：
        - 模拟API返回包含完整合同信息的薪资历史数据，并验证表格是否正确渲染了所有新列。
        - 模拟API返回薪资上涨的数据，验证"薪资变化"列是否显示绿色箭头。
        - 模拟API返回薪资下降的数据，验证"薪资变化"列是否显示红色箭头。
