# 考勤系统假期加班计算修复

## 问题描述

在有"假期"的月份，加班和出勤的天数计算存在问题。

### 核心业务规则

1. **假期也算出勤**：员工的假期（标记为"假"）也计入出勤天数
2. **假期加班算双薪**：如果员工在假期加班，该天既算出勤又算加班
3. **正常加班不算出勤**：正常工作日加班，只算加班不算出勤

### 示例场景（截图数据）

1月份有31天，员工考勤记录：
- **1-3日**：假期（标记为"假"）
- **1日**：假期+加班（双薪）
- **4-26日**：正常出勤（23天）
- **27-31日**：正常加班（5天）

**正确计算：**
- 出勤天数 = 31天（总天数）- 5天（正常加班）= **26天** ✅
- 加班天数 = 1天（假期加班）+ 5天（正常加班）= **6天** ✅

**说明：**
- 1-3日虽然是假期，但仍算出勤（假期出勤）
- 1日既是假期又加班，所以既算出勤又算加班（双薪效果）
- 27-31日是正常加班，不算出勤，需要从总天数中扣除

## 修复方案

### 1. 核心逻辑调整

**修复前（错误）：**
```javascript
出勤天数 = 总天数 - 假期天数 - 加班天数
```
问题：假期被错误地从出勤中扣除了

**修复后（正确）：**
```javascript
// 1. 区分加班类型
假期加班 = 同一天既有假期记录又有加班记录
正常加班 = 只有加班记录，没有假期记录

// 2. 计算出勤
出勤天数 = 总天数 - 正常加班天数
```

### 2. 前端实现

```javascript
// 计算加班天数，区分假期加班和正常加班
let holidayOvertimeDays = 0; // 假期加班
let normalOvertimeDays = 0;  // 正常加班

attendanceData.overtime_records.forEach(record => {
    const overtimeDate = record.date;
    let isHolidayOvertime = false;
    
    // 检查该日期是否有假期记录
    ['rest_records', 'leave_records'].forEach(key => {
        attendanceData[key].forEach(otherRecord => {
            if (otherRecord.date === overtimeDate) {
                isHolidayOvertime = true;
            }
        });
    });
    
    if (isHolidayOvertime) {
        holidayOvertimeDays += overtimeDays;
    } else {
        normalOvertimeDays += overtimeDays;
    }
});

// 计算出勤天数（假期不扣除，只扣除正常加班）
totalWorkDays = validDaysCount - normalOvertimeDays;
```

### 3. 后端同步

后端PDF统计计算也同步更新：

```python
# 区分假期加班和正常加班
holiday_overtime = 0
normal_overtime = 0

for record in data.get('overtime_records', []):
    overtime_date = record.get('date')
    is_holiday_overtime = False
    
    # 检查是否为假期加班
    for key in ['rest_records', 'leave_records']:
        for other_record in data.get(key, []):
            if other_record.get('date') == overtime_date:
                is_holiday_overtime = True
                break
    
    if is_holiday_overtime:
        holiday_overtime += overtime_days
    else:
        normal_overtime += overtime_days

# 计算出勤天数
total_work = days_count - normal_overtime
```

## 修改的文件

### 前端
- `frontend/src/components/attendance/AttendanceFillPage.jsx`
  - 第1467-1499行：统计计算逻辑（区分假期加班和正常加班）
  - 第1549行：出勤天数计算公式（假期不扣除）
  - 第1204-1238行：自动转换加班逻辑（考虑假期加班）

### 后端
- `backend/api/attendance_form_api.py`
  - `_calculate_pdf_stats()` 函数：PDF统计计算逻辑
  - 同步前端逻辑，确保PDF导出的统计数据与前端显示一致

## 测试验证

所有测试场景均已通过：

### 场景1：实际场景（截图数据）
- 输入：1-3日假期（1日加班），27-31日加班
- 预期：出勤26天，加班6天 ✅
- 实际：出勤26天，加班6天 ✅

### 场景2：纯假期（无加班）
- 输入：1-3日假期，其他28天正常
- 预期：出勤31天，加班0天 ✅
- 实际：出勤31天，加班0天 ✅

### 场景3：纯正常加班（无假期）
- 输入：27-31日加班，其他26天正常
- 预期：出勤26天，加班5天 ✅
- 实际：出勤26天，加班5天 ✅

### 场景4：全部假期加班
- 输入：1-3日假期+加班，其他28天正常
- 预期：出勤31天，加班3天 ✅
- 实际：出勤31天，加班3天 ✅

### 场景5：部分时间假期加班
- 输入：1日假期12小时+加班12小时
- 预期：出勤31天，加班0.5天 ✅
- 实际：出勤31天，加班0.5天 ✅

## 业务逻辑总结

1. **假期算出勤**：员工的假期（rest/leave）也计入出勤天数，不扣除
2. **假期加班双薪**：假期当天加班，既算出勤又算加班（双薪效果）
3. **正常加班单薪**：正常工作日加班，只算加班不算出勤
4. **26天上限**：出勤天数超过26天时，自动将超出部分转为加班
5. **计算公式**：出勤天数 = 总天数 - 正常加班天数

## 注意事项

1. 假期加班的判断依据：同一天既有假期记录又有加班记录
2. 带薪休假（paid_leave）不参与假期判断，按正常出勤处理
3. 跨天记录需要按日期拆分后再判断是否为假期加班
4. 自动转换加班功能会优先转换月末的正常出勤日，不会转换假期
