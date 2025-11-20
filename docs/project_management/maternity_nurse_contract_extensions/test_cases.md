# 月嫂合同续约与延长功能 - 测试用例

## 测试用例分类
- **单元测试**：测试单个方法或函数
- **集成测试**：测试多个组件协同工作
- **端到端测试**：测试完整的用户流程

---

## 一、续约功能测试用例

### 测试用例 1.1：月嫂合同续约 - 未确认上户日期

**测试目的**：
验证月嫂合同在续约时，如果原合同未确认实际上户日期，续约合同应自动确认实际上户日期并生成账单。

**涉及模块/文件**：
- `backend/services/contract_service.py::renew_contract`
- `backend/tasks/billing_tasks.py::trigger_initial_bill_generation_task`

**前置条件**：
- 存在一个月嫂合同（`type='maternity_nurse'`）
- 原合同状态为 `active`
- 原合同的 `actual_start_date` 为 `None`（未确认上户日期）

**输入**：
```python
{
    "old_contract_id": "uuid-of-original-contract",
    "new_start_date": "2025-07-01",
    "new_end_date": "2025-08-31",
    "template_id": "uuid-of-template"
}
```

**期望输出**：
- 续约合同创建成功
- 续约合同的 `actual_start_date` = `2025-07-01`
- 续约合同的 `status` = `active`
- 续约合同的 `previous_contract_id` = 原合同 ID
- 账单生成任务已触发
- 数据库中存在新生成的账单记录

**实际输出 & 测试结果**：
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果**: [待填充]

---

### 测试用例 1.2：月嫂合同续约 - 已确认上户日期

**测试目的**：
验证月嫂合同在续约时，即使原合同已确认实际上户日期，续约合同仍应自动确认实际上户日期并生成账单。

**涉及模块/文件**：
- `backend/services/contract_service.py::renew_contract`

**前置条件**：
- 存在一个月嫂合同
- 原合同的 `actual_start_date` 已设置（已确认上户日期）
- 原合同已有账单

**输入**：
```python
{
    "old_contract_id": "uuid-of-original-contract",
    "new_start_date": "2025-09-01",
    "new_end_date": "2025-10-31",
    "template_id": "uuid-of-template"
}
```

**期望输出**：
- 续约合同创建成功
- 续约合同的 `actual_start_date` = `2025-09-01`
- 续约合同的 `status` = `active`
- 账单生成任务已触发

**实际输出 & 测试结果**：
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果**: [待填充]

---

### 测试用例 1.3：育儿嫂合同续约 - 不自动确认上户日期

**测试目的**：
验证非月嫂合同（如育儿嫂合同）在续约时，不应自动确认实际上户日期，保持原有逻辑。

**涉及模块/文件**：
- `backend/services/contract_service.py::renew_contract`

**前置条件**：
- 存在一个育儿嫂合同（`type='nanny'`）

**输入**：
```python
{
    "old_contract_id": "uuid-of-nanny-contract",
    "new_start_date": "2025-07-01",
    "new_end_date": "2025-12-31",
    "template_id": "uuid-of-template"
}
```

**期望输出**：
- 续约合同创建成功
- 续约合同的 `actual_start_date` = `None`（不自动设置）
- 续约合同的 `status` = `pending`（或原有逻辑）
- 不自动触发账单生成

**实际输出 & 测试结果**：
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果**: [待填充]

---

### 测试用例 1.4：续约 API 端点测试

**测试目的**：
验证续约 API 端点返回正确的响应，包括账单生成状态。

**涉及模块/文件**：
- `backend/api/contract_api.py::renew_contract`

**前置条件**：
- 存在一个月嫂合同

**输入**：
```http
POST /api/contracts/{contract_id}/renew
Content-Type: application/json

{
    "new_start_date": "2025-07-01",
    "new_end_date": "2025-08-31",
    "template_id": "uuid-of-template"
}
```

**期望输出**：
```json
{
    "message": "合同续约成功",
    "new_contract": {
        "id": "uuid-of-new-contract",
        "actual_start_date": "2025-07-01",
        "status": "active",
        ...
    },
    "bills_generated": true
}
```

**实际输出 & 测试结果**：
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果**: [待填充]

---

## 二、延长功能测试用例

### 测试用例 2.1：延长 active 合同 - 当前周期内

**测试目的**：
验证延长 `active` 状态的月嫂合同，当新结束日期仍在当前账单周期内时，系统应更新最后一个账单的结束日期。

**涉及模块/文件**：
- `backend/services/contract_service.py::extend_contract`
- `backend/services/billing_service.py::recalculate_bills_for_extension`

**前置条件**：
- 存在一个月嫂合同，状态为 `active`
- 合同结束日期为 `2025-06-30`
- 已有账单，最后一个账单的结束日期为 `2025-06-30`

**输入**：
```python
{
    "contract_id": "uuid-of-contract",
    "new_end_date": "2025-06-25"  # 仍在 6 月内
}
```

**期望输出**：
- 合同的 `end_date` 更新为 `2025-06-25`
- 最后一个账单的 `end_date` 更新为 `2025-06-25`
- 不生成新账单
- 返回：`bills_updated=1, new_bills_generated=0`

**实际输出 & 测试结果**：
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果**: [待填充]

---

### 测试用例 2.2：延长 active 合同 - 跨周期

**测试目的**：
验证延长 `active` 状态的月嫂合同，当新结束日期跨越新的账单周期时，系统应生成新的账单。

**涉及模块/文件**：
- `backend/services/contract_service.py::extend_contract`
- `backend/services/billing_service.py::recalculate_bills_for_extension`

**前置条件**：
- 存在一个月嫂合同，状态为 `active`
- 合同结束日期为 `2025-06-30`
- 已有账单，最后一个账单的结束日期为 `2025-06-30`

**输入**：
```python
{
    "contract_id": "uuid-of-contract",
    "new_end_date": "2025-08-31"  # 跨越 7 月和 8 月
}
```

**期望输出**：
- 合同的 `end_date` 更新为 `2025-08-31`
- 生成 2 个新账单（7 月和 8 月）
- 返回：`bills_updated=0, new_bills_generated=2`

**实际输出 & 测试结果**：
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果**: [待填充]

---

### 测试用例 2.3：延长非 active 合同 - 应失败

**测试目的**：
验证尝试延长非 `active` 状态的合同时，系统应拒绝操作并返回错误。

**涉及模块/文件**：
- `backend/services/contract_service.py::extend_contract`

**前置条件**：
- 存在一个月嫂合同，状态为 `pending`

**输入**：
```python
{
    "contract_id": "uuid-of-pending-contract",
    "new_end_date": "2025-08-31"
}
```

**期望输出**：
- 抛出 `ValueError` 异常
- 错误消息：`"只能延长 active 状态的合同"`
- 合同的 `end_date` 未改变

**实际输出 & 测试结果**：
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果**: [待填充]

---

### 测试用例 2.4：延长合同 - 新结束日期早于当前结束日期

**测试目的**：
验证尝试将合同结束日期延长到早于当前结束日期时，系统应拒绝操作。

**涉及模块/文件**：
- `backend/services/contract_service.py::extend_contract`

**前置条件**：
- 存在一个月嫂合同，状态为 `active`
- 合同结束日期为 `2025-06-30`

**输入**：
```python
{
    "contract_id": "uuid-of-contract",
    "new_end_date": "2025-05-31"  # 早于当前结束日期
}
```

**期望输出**：
- 抛出 `ValueError` 异常
- 错误消息：`"新结束日期必须晚于当前结束日期"`
- 合同的 `end_date` 未改变

**实际输出 & 测试结果**：
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果**: [待填充]

---

### 测试用例 2.5：延长 API 端点测试

**测试目的**：
验证延长 API 端点返回正确的响应，包括账单变更信息。

**涉及模块/文件**：
- `backend/api/contract_api.py::extend_contract`

**前置条件**：
- 存在一个月嫂合同，状态为 `active`

**输入**：
```http
PATCH /api/contracts/{contract_id}/extend
Content-Type: application/json

{
    "new_end_date": "2025-08-31"
}
```

**期望输出**：
```json
{
    "message": "合同延长成功",
    "contract": {
        "id": "uuid-of-contract",
        "end_date": "2025-08-31",
        ...
    },
    "bills_updated": 0,
    "new_bills_generated": 2
}
```

**实际输出 & 测试结果**：
- 单元测试: [待填充]
- 集成测试: [待填充]
- **最终检查结果**: [待填充]

---

## 三、边界值测试用例

### 测试用例 3.1：延长合同 - 新结束日期等于当前结束日期

**测试目的**：
验证边界情况：新结束日期等于当前结束日期。

**输入**：
```python
{
    "contract_id": "uuid-of-contract",
    "new_end_date": "2025-06-30"  # 等于当前结束日期
}
```

**期望输出**：
- 抛出 `ValueError` 异常
- 错误消息：`"新结束日期必须晚于当前结束日期"`

**实际输出 & 测试结果**：
- 单元测试: [待填充]
- **最终检查结果**: [待填充]

---

### 测试用例 3.2：续约合同 - 新开始日期早于原合同结束日期

**测试目的**：
验证续约时，新合同开始日期早于原合同结束日期的情况（合同重叠）。

**输入**：
```python
{
    "old_contract_id": "uuid-of-contract",  # 结束日期为 2025-06-30
    "new_start_date": "2025-06-15",  # 早于原合同结束日期
    "new_end_date": "2025-08-31"
}
```

**期望输出**：
- 根据业务规则决定是否允许
- 如果允许：续约成功，可能需要特殊处理
- 如果不允许：抛出异常

**实际输出 & 测试结果**：
- 单元测试: [待填充]
- **最终检查结果**: [待填充]

---

## 四、集成测试用例

### 测试用例 4.1：完整续约流程 - 端到端

**测试目的**：
验证从前端发起续约请求到账单生成的完整流程。

**涉及模块/文件**：
- 前端续约组件
- `backend/api/contract_api.py::renew_contract`
- `backend/services/contract_service.py::renew_contract`
- `backend/tasks/billing_tasks.py`

**测试步骤**：
1. 创建一个月嫂合同（未确认上户日期）
2. 前端发起续约请求
3. 验证续约合同创建成功
4. 验证实际上户日期已设置
5. 验证账单已生成
6. 验证前端显示成功提示

**期望输出**：
- 所有步骤成功完成
- 前端显示续约成功提示
- 数据库中存在新合同和账单

**实际输出 & 测试结果**：
- 集成测试: [待填充]
- **最终检查结果**: [待填充]

---

### 测试用例 4.2：完整延长流程 - 端到端

**测试目的**：
验证从前端发起延长请求到账单更新的完整流程。

**涉及模块/文件**：
- 前端延长组件
- `backend/api/contract_api.py::extend_contract`
- `backend/services/contract_service.py::extend_contract`
- `backend/services/billing_service.py::recalculate_bills_for_extension`

**测试步骤**：
1. 创建一个月嫂合同（active 状态）
2. 前端发起延长请求
3. 验证合同结束日期已更新
4. 验证账单已更新或生成
5. 验证前端显示成功提示及账单变更信息

**期望输出**：
- 所有步骤成功完成
- 前端显示延长成功提示
- 数据库中合同和账单已更新

**实际输出 & 测试结果**：
- 集成测试: [待填充]
- **最终检查结果**: [待填充]

---

## 五、回归测试用例

### 测试用例 5.1：现有合同功能不受影响

**测试目的**：
验证新功能不影响现有的合同创建、查看、更新等功能。

**测试步骤**：
1. 创建各类型合同（育儿嫂、月嫂、试工等）
2. 查看合同详情
3. 更新合同信息
4. 确认上户日期
5. 生成账单

**期望输出**：
- 所有现有功能正常工作
- 无回归问题

**实际输出 & 测试结果**：
- 回归测试: [待填充]
- **最终检查结果**: [待填充]

---

## 六、性能测试用例

### 测试用例 6.1：批量续约性能测试

**测试目的**：
验证系统在批量续约场景下的性能表现。

**测试步骤**：
1. 创建 100 个月嫂合同
2. 批量执行续约操作
3. 测量响应时间

**期望输出**：
- 平均响应时间 < 2 秒/合同
- 无超时错误

**实际输出 & 测试结果**：
- 性能测试: [待填充]
- **最终检查结果**: [待填充]

---

## 测试用例总结

| 类别 | 测试用例数 | 已通过 | 待测试 |
|------|-----------|--------|--------|
| 续约功能 | 4 | 0 | 4 |
| 延长功能 | 5 | 0 | 5 |
| 边界值测试 | 2 | 0 | 2 |
| 集成测试 | 2 | 0 | 2 |
| 回归测试 | 1 | 0 | 1 |
| 性能测试 | 1 | 0 | 1 |
| **总计** | **15** | **0** | **15** |

---

## 测试环境要求

### 数据库
- PostgreSQL 测试数据库
- 包含测试数据（合同、账单、客户等）

### 依赖服务
- Celery 任务队列（用于异步账单生成）
- Redis（Celery broker）

### 测试工具
- pytest（单元测试）
- pytest-flask（Flask 集成测试）
- pytest-cov（代码覆盖率）

---

## 测试执行计划

### 阶段 1：单元测试
- 执行所有单元测试用例
- 确保代码覆盖率 > 80%

### 阶段 2：集成测试
- 执行集成测试用例
- 验证组件协同工作

### 阶段 3：端到端测试
- 手动执行端到端测试
- 验证用户流程

### 阶段 4：回归测试
- 执行回归测试
- 确保无破坏性变更

### 阶段 5：性能测试
- 执行性能测试
- 优化性能瓶颈
