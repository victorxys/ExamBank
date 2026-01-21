fix: 修复非月签育儿嫂合同终止时管理费退款计算错误

## 问题描述

对于开始日和结束日相同的非月签育儿嫂合同（如17日开始17日结束），
在终止时计算管理费退款存在bug：错误地将"终止日到下个月的周期结束日"
作为部分周期，导致少算了一个完整周期。

### 示例
- 合同周期：2025-10-17 ~ 2026-10-17
- 终止日期：2026-01-06（不收取终止日管理费）
- **错误计算**：部分周期 1月6日~2月16日（42天），完整周期8个
- **正确计算**：部分周期 1月6日~1月16日（11天），完整周期9个

## 根本原因

代码错误地计算了 `next_month_10th`（当前周期结束日）：
```python
# 错误逻辑
next_month_10th = date(termination_date.year, termination_date.month + 1, contract_end_day - 1)
```

这会将终止日所在月份的**下一个月**作为周期结束日，而不是**当前周期**的结束日。

## 修复方案

正确判断终止日所在的周期，然后计算该周期的结束日：

```python
# 正确逻辑
if termination_date.day >= contract_start_day:
    # 终止日在当前周期内（如1月17日~1月31日）
    current_cycle_end = date(year, month + 1, contract_start_day - 1)
else:
    # 终止日在上个周期的后半段（如1月1日~1月16日）
    current_cycle_end = date(year, month, contract_start_day - 1)
```

## 修改的文件

### 核心代码修复
1. **backend/api/billing_api.py** (第2447-2461行)
   - 修复终止合同API接口中的管理费退款计算逻辑

2. **backend/management_commands.py** (第1520-1534行)
   - 修复管理命令中的相同逻辑

### 数据修复工具
3. **fix_management_fee_refund.py** (新增)
   - 自动查找并修复受影响的历史数据
   - 支持 `--dry-run` 演习模式
   - 重新计算正确的退款金额并更新调整项

4. **FIX_MANAGEMENT_FEE_REFUND_README.md** (新增)
   - 详细的使用说明和技术文档

## 影响范围

- 只影响已终止的非月签育儿嫂合同
- 只影响开始日和结束日相同的合同（如17日~17日）
- 只影响跨月终止的情况
- 测试发现2个合同需要修复，总差额-48.33元

## 测试

```bash
# 演习模式查看影响
python fix_management_fee_refund.py --dry-run

# 实际执行修复
python fix_management_fee_refund.py
```

## 后续操作

1. 备份数据库
2. 运行修复脚本修复历史数据
3. 验证修复结果

## 相关Issue

修复了管理费退款计算中的周期判断逻辑错误，确保客户获得正确的退款金额。
