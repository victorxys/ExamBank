# 月嫂合同续约与延长功能需求文档

## 1. 背景与问题

### 1.1 当前系统行为
月嫂合同（`MaternityNurseContract`）在创建时只有**预产期**（`provisional_start_date`），没有**实际上户日期**（`actual_start_date`）。系统设计为：
- 只有在确认实际上户日期后，才会自动生成账单
- 在确认实际上户日期之前，不会生成任何账单

### 1.2 业务问题

#### 问题 1：续约时无法找到前序合同
**场景**：客户对月嫂服务满意，希望延长服务时间，需要"续约"（创建新合同）。

**问题**：
1. 原合同可能还未确认实际上户日期（无账单）
2. 系统在续约时无法找到前序合同的账单信息
3. 续约合同应该自动确认实际上户日期（等于新合同开始日期），并生成账单

**影响**：
- 续约流程不完整
- 账单生成逻辑不一致
- 业务流程中断

#### 问题 2：系统不支持合同延长
**场景**：客户希望延长现有合同的服务时间，但不重新签订合同。

**问题**：
- 当前系统只支持"续约"（创建新合同）
- 不支持直接修改现有合同的结束日期
- 延长合同后需要重新计算账单

**影响**：
- 业务灵活性不足
- 需要手动处理延长场景

---

## 2. 功能需求

### 2.1 月嫂合同续约优化

#### 需求描述
当对月嫂合同进行"续约"时，系统应：
1. **自动确认实际上户日期**：新合同的实际上户日期 = 新合同的开始日期
2. **自动生成账单**：与"确认上户日期"功能逻辑一致
3. **关联前序合同**：正确设置 `previous_contract_id`

#### 业务规则
- 续约合同的 `actual_start_date` = 续约合同的 `start_date`
- 续约合同创建后立即触发账单生成任务
- 续约合同的状态应为 `active`（而非 `pending`）

#### 用户故事
```
作为 合同管理员
我想要 在月嫂合同续约时自动确认上户日期并生成账单
以便 简化续约流程，确保账单及时生成
```

---

### 2.2 月嫂合同延长功能

#### 需求描述
系统应支持直接延长现有月嫂合同的服务时间，而不创建新合同。

#### 功能要点
1. **修改结束日期**：允许管理员修改合同的 `end_date`
2. **重新计算账单**：
   - 如果已有账单，需要调整最后一个账单的结束日期
   - 如果延长后超出原账单周期，生成新的账单
3. **保留合同历史**：记录延长操作的历史（可选）

#### 业务规则
- 只能延长 `active` 状态的合同
- 新的结束日期必须晚于当前结束日期
- 延长操作应触发账单重新计算
- 延长后的合同仍然是同一个合同（ID 不变）

#### 用户故事
```
作为 合同管理员
我想要 直接延长现有月嫂合同的结束日期
以便 灵活调整服务时间，无需重新签订合同
```

---

## 3. 技术方案概述

### 3.1 续约优化方案

#### 后端修改
**文件**：`backend/services/contract_service.py`

**修改点**：`renew_contract` 方法
```python
def renew_contract(old_contract_id, new_start_date, new_end_date, ...):
    # 现有逻辑...
    
    # 新增：如果是月嫂合同，自动确认实际上户日期
    if new_contract.type == 'maternity_nurse':
        new_contract.actual_start_date = new_start_date
        new_contract.status = 'active'
        db.session.commit()
        
        # 触发账单生成（与 confirm_actual_start_date 逻辑一致）
        from backend.tasks.billing_tasks import trigger_initial_bill_generation_task
        trigger_initial_bill_generation_task.delay(str(new_contract.id))
```

#### API 修改
**文件**：`backend/api/contract_api.py`

**修改点**：`renew_contract` 端点
- 返回时包含账单生成状态
- 前端提示用户账单已自动生成

---

### 3.2 延长功能方案

#### 新增 API 端点
**端点**：`PATCH /api/contracts/<contract_id>/extend`

**请求体**：
```json
{
  "new_end_date": "2025-12-31"
}
```

**响应**：
```json
{
  "message": "合同延长成功",
  "contract": { ... },
  "bills_updated": true,
  "new_bills_generated": 2
}
```

#### 后端服务方法
**文件**：`backend/services/contract_service.py`

**新增方法**：`extend_contract`
```python
def extend_contract(contract_id, new_end_date):
    """
    延长合同的结束日期
    
    Args:
        contract_id: 合同 ID
        new_end_date: 新的结束日期
        
    Returns:
        (contract, bills_updated_count, new_bills_count)
    """
    contract = BaseContract.query.get(contract_id)
    
    # 验证
    if contract.status != 'active':
        raise ValueError("只能延长 active 状态的合同")
    if new_end_date <= contract.end_date:
        raise ValueError("新结束日期必须晚于当前结束日期")
    
    # 更新结束日期
    old_end_date = contract.end_date
    contract.end_date = new_end_date
    db.session.commit()
    
    # 重新计算账单
    bills_updated, new_bills = recalculate_bills_for_extension(
        contract, old_end_date, new_end_date
    )
    
    return contract, bills_updated, new_bills
```

#### 账单重新计算逻辑
**文件**：`backend/services/billing_service.py`

**新增方法**：`recalculate_bills_for_extension`
```python
def recalculate_bills_for_extension(contract, old_end_date, new_end_date):
    """
    合同延长后重新计算账单
    
    逻辑：
    1. 找到最后一个账单
    2. 如果最后一个账单的结束日期 < old_end_date，说明还有未生成的账单
    3. 延长最后一个账单的结束日期（如果在同一个周期内）
    4. 或者生成新的账单（如果跨越了新的周期）
    """
    # 实现细节...
```

---

## 4. 数据库影响

### 4.1 现有字段
无需新增字段，使用现有字段：
- `actual_start_date`：实际上户日期
- `end_date`：合同结束日期
- `status`：合同状态

### 4.2 可选：延长历史记录
如果需要记录延长历史，可以考虑新增表（可选）：
```sql
CREATE TABLE contract_extension_history (
    id UUID PRIMARY KEY,
    contract_id UUID REFERENCES contracts(id),
    old_end_date DATE,
    new_end_date DATE,
    extended_at TIMESTAMP,
    extended_by UUID REFERENCES users(id),
    notes TEXT
);
```

---

## 5. 前端界面

### 5.1 续约界面
**修改**：续约确认对话框

**新增提示**：
```
月嫂合同续约说明：
- 续约合同将自动确认实际上户日期（等于新合同开始日期）
- 系统将自动生成账单
- 续约后合同状态为"进行中"
```

### 5.2 延长界面
**新增**：合同详情页 → "延长合同"按钮

**对话框**：
```
延长合同

当前结束日期：2025-06-30
新的结束日期：[日期选择器]

说明：
- 延长后将重新计算账单
- 如果跨越新的计费周期，将生成新账单

[取消] [确认延长]
```

---

## 6. 测试场景

### 6.1 续约测试
1. **场景 1**：未确认上户日期的月嫂合同续约
   - 创建月嫂合同（只有预产期）
   - 执行续约操作
   - 验证：续约合同的 `actual_start_date` 已设置
   - 验证：账单已自动生成

2. **场景 2**：已确认上户日期的月嫂合同续约
   - 创建月嫂合同并确认上户日期
   - 执行续约操作
   - 验证：续约合同的 `actual_start_date` 已设置
   - 验证：账单已自动生成

### 6.2 延长测试
1. **场景 1**：延长合同（在当前账单周期内）
   - 创建并激活月嫂合同
   - 延长结束日期（仍在当前月）
   - 验证：最后一个账单的结束日期已更新

2. **场景 2**：延长合同（跨越新账单周期）
   - 创建并激活月嫂合同
   - 延长结束日期（跨越下个月）
   - 验证：生成了新的账单

3. **场景 3**：延长非 active 状态的合同
   - 尝试延长 `pending` 状态的合同
   - 验证：返回错误提示

---

## 7. 风险与注意事项

### 7.1 风险
1. **账单重复生成**：续约时需要确保不会重复生成账单
2. **延长后账单计算错误**：需要仔细处理跨周期的账单生成
3. **状态不一致**：续约后的合同状态需要正确设置

### 7.2 注意事项
1. **向后兼容**：确保现有合同不受影响
2. **权限控制**：延长合同操作需要适当的权限
3. **审计日志**：记录延长操作的历史

---

## 8. 验收标准

### 8.1 续约功能
- [ ] 月嫂合同续约时自动设置 `actual_start_date`
- [ ] 续约后自动生成账单
- [ ] 续约合同状态为 `active`
- [ ] 前端显示续约成功提示

### 8.2 延长功能
- [ ] 可以成功延长 `active` 状态的合同
- [ ] 延长后账单正确更新或生成
- [ ] 不能延长非 `active` 状态的合同
- [ ] 前端显示延长成功提示及账单变更信息

---

## 9. 实施优先级

### 高优先级
1. **续约优化**：这是当前业务痛点，需要优先解决

### 中优先级
2. **延长功能**：提升业务灵活性，可以在续约功能稳定后实施

---

## 10. 后续优化

### 可选功能
1. **延长历史记录**：记录每次延长操作
2. **批量延长**：支持批量延长多个合同
3. **延长审批流程**：需要审批后才能延长
4. **自动提醒**：合同即将到期时提醒是否需要延长
