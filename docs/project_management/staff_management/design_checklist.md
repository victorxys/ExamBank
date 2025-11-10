# 设计清单: 员工管理功能 (V2-修订版)

## 第一层：数据结构分析 (基于 `models.py`)
- **核心数据模型**: `ServicePersonnel`, `EmployeeSalaryHistory`, `BaseContract`, `Customer`。
- **关系**:
    - `ServicePersonnel` 1 -> * `EmployeeSalaryHistory`
    - `EmployeeSalaryHistory` * -> 1 `BaseContract`
    - `BaseContract` * -> 1 `Customer`
- **数据流**:
    1.  **读取**: 前端请求 -> 后端API -> SQLAlchemy查询 `EmployeeSalaryHistory` 并通过 `joinedload` 预加载 `BaseContract`，再通过 `BaseContract` 预加载 `Customer`。这是为了避免N+1查询。
    2.  **计算**: 在Python业务逻辑中，对按日期排序后的薪资历史列表进行迭代，计算出每次变更的 "原月薪"。
    3.  **返回**: 序列化包含所有计算和关联数据的JSON给前端。

## 第二层：特殊情况识别
- **薪资历史为空**: `employee.salary_history` 返回空列表。**处理**: API返回 `salary_history: []`。前端显示"暂无记录"。
- **员工不存在**: `ServicePersonnel.query.get(id)` 返回 `None`。**处理**: API返回 `404 Not Found`。
- **薪资历史的第一条记录**:
    - **问题**: 第一条记录没有 "前一条记录" 来获取 "原月薪"。
    - **处理**: API逻辑中必须处理这个情况，将第一条记录的 `previous_salary` 字段设为 `null`。前端在渲染时，如果 `previous_salary` 为 `null`，则不显示涨跌箭头。
- **关联合同或客户被删除/不存在**:
    - **问题**: `salary_history.contract` 或 `contract.customer` 可能为 `None`。
    - **处理**: API在序列化数据时必须做空值检查。例如 `customer_name = record.contract.customer.name if record.contract and record.contract.customer else None`。这确保了即使数据存在孤岛，API也不会崩溃。
- **薪资不变**:
    - **问题**: `new_salary` == `previous_salary`。
    - **处理**: 前端在渲染箭头时，应将此情况视作与首次记录一样，不显示任何箭头。

## 第三层：复杂度审查
- **功能本质**: 查询一个核心事实（薪资变更），并附带其所有相关的上下文（合同、客户）。
- **当前方案复杂度**:
    - **后端**: 复杂度从中低 -> 中等。引入了多表JOIN和业务逻辑中的数据处理（计算原月薪）。关键点在于写出高效的SQLAlchemy查询。
    - **前端**: 复杂度从中低 -> 中等。需要渲染一个更复杂、数据列更多的表格，并处理更多的条件逻辑（箭头显示）。
- **简化可能性**:
    - 后端计算 `previous_salary` 是正确的选择。让前端来做这个计算会增加前端的复杂性和出错可能。
    - 一次性在后端通过JOIN加载所有数据，比前端发起多次API请求更高效。
    - 当前方案是解决该需求的合理路径，没有明显的过度设计。

## 第四层：破坏性分析
- **结论**: 仍然是**零破坏性风险**。所有变动都局限在新增的模块和API内部。查询操作不会影响数据。

## 第五层：实用性验证
- **问题真实性**: 用户的补充需求非常实际。不带合同背景的薪资变动记录是无用的信息。
- **解决方案匹配度**: 增强的解决方案（后端聚合数据，前端富文本展示）完全匹配了用户提出的更精细化的管理需求。

---
## 模拟检查 (基于新需求)

1.  **API: `GET /api/staff/employees/<id>` 的数据聚合逻辑**
    - **如何检查**: 模拟后端Python代码逻辑。
      ```python
      # 1. 高效查询
      history_records = EmployeeSalaryHistory.query.options(
          joinedload(EmployeeSalaryHistory.contract).joinedload(BaseContract.customer)
      ).filter_by(employee_id=id).order_by(EmployeeSalaryHistory.effective_date.asc()).all()

      # 2. 处理与计算
      processed_history = []
      for i, record in enumerate(history_records):
          previous_salary = history_records[i-1].base_salary if i > 0 else None
          processed_history.append({
              "previous_salary": previous_salary,
              "new_salary": record.base_salary,
              "customer_name": record.contract.customer.name if record.contract and record.contract.customer else "N/A",
              # ... other fields
          })
      
      # 3. 返回前倒序
      return sorted(processed_history, key=lambda x: x['effective_date'], reverse=True)
      ```
    - **检查结果**: **通过**。这个逻辑是可行的，并且考虑了性能和边界情况。

2.  **前端: 箭头显示逻辑**
    - **如何检查**: 模拟React组件的JSX。
      ```jsx
      function SalaryChangeArrow({ previous, current }) {
        if (previous === null || previous === undefined) return null; // 首次记录
        if (current > previous) return <span style={{ color: 'green' }}>↑</span>;
        if (current < previous) return <span style={{ color: 'red' }}>↓</span>;
        return null; // 薪资未变
      }
      ```
    - **检查结果**: **通过**。前端逻辑简单直接，可以正确实现UI需求。
