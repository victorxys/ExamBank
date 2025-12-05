# 电子考勤表功能 - 实施计划

## 1. 概述

本文档描述电子考勤表功能的实施计划,包括数据库迁移、后端API实现、前端界面开发和工资计算逻辑修改。

## 2. 用户已确认的需求

### 核心业务规则
1. **访问方式**: 员工和客户均通过固定链接访问,无需登录
2. **填写时机**: 当月填写上个月的考勤表
3. **签署流程**: 仅客户签署,签署后立即生效
4. **出京管理费**: 客户额外支付10%,公司收取10%管理费
5. **出境管理费**: 客户额外支付20%,公司收取20%管理费
6. **复用现有功能**: 使用系统已有的电子签名组件

## 3. 用户需求回顾

### 需要修改的核心模块
1. **AttendanceRecord 模型**: 添加出京/出境天数字段
2. **DynamicFormData 模型**: 添加访问令牌和签署状态字段
3. **BillingEngine**: 修改工资计算逻辑,加入出京出境管理费
4. **前端**: 新建考勤表填写和签署页面(使用 shadcn)

## 4. 实施计划

### 阶段1: 数据库设计与迁移 (预计2-3小时)

#### 4.1 创建数据库迁移脚本
**文件**: `migrations/versions/xxx_create_attendance_forms_table.py`

**修改内容**:
1. **创建 attendance_forms 表**:
   ```python
   op.create_table(
       'attendance_forms',
       sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
       sa.Column('contract_id', postgresql.UUID(as_uuid=True), nullable=False),
       sa.Column('employee_id', postgresql.UUID(as_uuid=True), nullable=False),
       sa.Column('cycle_start_date', sa.DateTime(timezone=True), nullable=False),
       sa.Column('cycle_end_date', sa.DateTime(timezone=True), nullable=False),
       sa.Column('form_data', postgresql.JSONB, nullable=False, server_default='{}'),
       sa.Column('employee_access_token', sa.String(255), unique=True),
       sa.Column('customer_signature_token', sa.String(255), unique=True),
       sa.Column('status', sa.String(50), nullable=False, server_default='draft'),
       sa.Column('customer_signed_at', sa.DateTime(timezone=True)),
       sa.Column('signature_data', postgresql.JSONB),
       sa.Column('synced_to_attendance', sa.Boolean, nullable=False, server_default='false'),
       sa.Column('attendance_record_id', postgresql.UUID(as_uuid=True)),
       sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
       sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
       sa.ForeignKeyConstraint(['contract_id'], ['contracts.id'], ondelete='CASCADE'),
       sa.ForeignKeyConstraint(['attendance_record_id'], ['attendance_records.id'], ondelete='SET NULL'),
       sa.UniqueConstraint('contract_id', 'cycle_start_date', name='uq_contract_cycle')
   )
   op.create_index('ix_attendance_forms_employee_access_token', 'attendance_forms', ['employee_access_token'])
   op.create_index('ix_attendance_forms_customer_signature_token', 'attendance_forms', ['customer_signature_token'])
   op.create_index('ix_attendance_forms_status', 'attendance_forms', ['status'])
   ```

2. **扩展 attendance_records 表**:
   - 添加 `out_of_beijing_days` (Numeric(10,3))
   - 添加 `out_of_country_days` (Numeric(10,3))
   - 添加 `attendance_form_id` (UUID, 外键到 attendance_forms)
   - 添加 `attendance_details` (JSONB)

**验证方式**:
- 在开发环境执行迁移: `flask db upgrade`
- 检查数据库表结构: `\d attendance_records` 和 `\d dynamic_form_data`
- 确认所有字段已添加且类型正确

---

### 阶段2: 后端API实现 (预计8-10小时)

#### 4.2 考勤表管理API (无需登录)
**文件**: `backend/api/attendance_form_api.py` (新建)

**实现内容**:
1. `GET /api/attendance-forms/by-token/<employee_token>`
   - 验证员工令牌
   - **自动关联合同**:
     ```python
     # 根据令牌查找 AttendanceForm
     form = AttendanceForm.query.filter_by(
         employee_access_token=employee_token
     ).first()
     
     if not form:
         # 查找员工当前活跃的合同
         employee = find_employee_by_token(employee_token)
         active_contract = BaseContract.query.filter_by(
             service_personnel_id=employee.id,
             status='active'
         ).order_by(BaseContract.start_date.desc()).first()
         
         if not active_contract:
             return error("未找到活跃合同")
         
         # 创建 AttendanceForm
         form = AttendanceForm(
             contract_id=active_contract.id,
             employee_id=employee.id,
             cycle_start_date=calculate_last_month_start(),
             cycle_end_date=calculate_last_month_end(),
             employee_access_token=employee_token,
             form_data={}
         )
         db.session.add(form)
         db.session.commit()
     
     return jsonify(form.to_dict())
     ```
   - 返回 AttendanceForm 数据和基础信息

2. `PUT /api/attendance-forms/by-token/<employee_token>`
   - 更新 AttendanceForm.form_data
   - 实时验证数据合理性

3. `POST /api/attendance-forms/by-token/<employee_token>/confirm`
   - 更新 status 为 'employee_confirmed'
   - 生成 customer_signature_token
   - 返回签署链接

**验证方式**:
- 使用 Postman 或 curl 测试各接口
- 验证令牌验证逻辑
- 验证数据验证规则

---

#### 4.3 签署API (无需登录)
**文件**: `backend/api/attendance_form_api.py`

**实现内容**:
1. `GET /api/attendance-forms/sign/<signature_token>`
   - 客户查看考勤表
   - 返回考勤表数据和PDF预览链接

2. `POST /api/attendance-forms/sign/<signature_token>`
   - 客户签署考勤表
   - 复用现有的电子签名功能
   - 签署成功后:
     - 更新签署状态为 'signed'
     - 记录签署时间和IP
     - 触发数据同步到 AttendanceRecord
     - 触发工资单重算

**验证方式**:
- 测试签署流程
- 验证签署后数据同步
- 验证工资单重算触发

---

#### 4.4 考勤表管理 API
**文件**: `backend/api/attendance_form_api.py` (新建)

**实现内容**:
1. `GET /api/attendance-forms/by-token/<token>`: 获取考勤表(自动关联合同)
2. `PUT /api/attendance-forms/by-token/<token>`: 更新考勤表数据
3. `POST /api/attendance-forms/by-token/<token>/confirm`: 确认并生成签署链接
4. `GET /api/attendance-forms/sign/<token>`: 获取签署页面数据
5. `POST /api/attendance-forms/sign/<token>`: 提交客户签名

#### 4.4.1 更新账单详情 API (新增)
**文件**: `backend/api/utils.py`

**实现内容**:
- 修改 `get_billing_details_internal` 函数
- 从 `AttendanceRecord` 中读取 `out_of_beijing_days` 和 `out_of_country_days`
- 从 `AttendanceRecord.attendance_details` 中解析 `leave_days`, `paid_leave_days`, `rest_days`
- 将这些字段添加到返回的 `attendance` 对象中

**验证方式**:
- 使用管理员账号测试各接口
- 验证权限控制

---

#### 4.5 管理员API
**文件**: `backend/api/attendance_form_api.py`

**实现内容**:
1. `GET /api/admin/attendance-forms` - 查询考勤表列表
2. `POST /api/admin/attendance-forms/create` - 创建考勤表
3. `GET /api/admin/attendance-forms/<form_data_id>` - 查看详情
4. `PUT /api/admin/attendance-forms/<form_data_id>` - 修改考勤表
5. `POST /api/admin/attendance-forms/<form_data_id>/sync` - 手动同步

**验证方式**:
- 使用管理员账号测试各接口
- 验证权限控制

---

#### 4.5 数据同步逻辑
**文件**: `backend/services/attendance_sync_service.py` (新建)

**实现内容**:
```python
def sync_attendance_to_record(attendance_form_id):
    """
    将考勤表数据同步到 AttendanceRecord
    """
    # 1. 获取 AttendanceForm
    form = AttendanceForm.query.get(attendance_form_id)
    if not form:
        raise ValueError("考勤表不存在")
    
    data = form.form_data
    
    # 2. 计算各项天数(时长转天数)
    def hours_to_days(hours, minutes):
        return (hours + minutes/60) / 24
    
    # 计算出勤天数: 当月总天数 - 请假天数 - 休息天数
    total_days_in_month = get_days_in_month(form.cycle_start_date)
    rest_days = sum(hours_to_days(r['hours'], r['minutes']) for r in data.get('rest_records', []))
    leave_days = sum(hours_to_days(r['hours'], r['minutes']) for r in data.get('leave_records', []))
    
    total_days_worked = total_days_in_month - rest_days - leave_days
    # 注意: 出勤天数已包含出京、出境、带薪休假
    
    overtime_days = sum(hours_to_days(r['hours'], r['minutes']) for r in data.get('overtime_records', []))
    beijing_days = sum(hours_to_days(r['hours'], r['minutes']) for r in data.get('beijing_records', []))
    country_days = sum(hours_to_days(r['hours'], r['minutes']) for r in data.get('country_records', []))
    
    # 3. 创建或更新 AttendanceRecord
    attendance = AttendanceRecord.query.filter_by(
        contract_id=form.contract_id,
        cycle_start_date=form.cycle_start_date
    ).first()
    
    if not attendance:
        attendance = AttendanceRecord(
            employee_id=form.employee_id,
            contract_id=form.contract_id,
            cycle_start_date=form.cycle_start_date,
            cycle_end_date=form.cycle_end_date
        )
        db.session.add(attendance)
    
    attendance.total_days_worked = total_days_worked
    attendance.overtime_days = overtime_days
    attendance.out_of_beijing_days = beijing_days
    attendance.out_of_country_days = country_days
    attendance.attendance_form_id = form.id
    attendance.attendance_details = data  # 保存原始数据
    
    db.session.commit()
    
    # 4. 更新 AttendanceForm 状态
    form.synced_to_attendance = True
    form.attendance_record_id = attendance.id
    form.status = 'synced'
    db.session.commit()
    
    # 5. 触发工资单重算
    year = form.cycle_start_date.year
    month = form.cycle_start_date.month
    BillingEngine.calculate_for_month(year, month, form.contract_id, force_recalculate=True)
```

**关键逻辑**:
- 出勤天数 = 当月总天数 - 请假天数 - 休息天数
- 出勤天数已包含:带薪休假、出京、出境
- 带薪休假仅存储在 attendance_details 中用于显示,不参与计算

**验证方式**:
- 单元测试: 测试时长转天数的计算
- 单元测试: 测试出勤天数计算公式
- 集成测试: 测试完整同步流程
- 验证数据一致性: 出勤 + 休息 + 请假 = 当月天数

---

#### 4.6 工资计算逻辑修改
**文件**: `backend/services/billing_engine.py`

**修改内容**:
1. 在 `_calculate_maternity_nurse_details()` 中:
   - 读取 `attendance.out_of_beijing_days`
   - 读取 `attendance.out_of_country_days`
   - 计算出京管理费: `级别 * 10% * 出京天数 / 26`
   - 计算出境管理费: `级别 * 20% * 出境天数 / 26`
   - 将管理费加入客户应付和公司收入

2. 在 `_calculate_nanny_details()` 中:
   - 同样添加出京出境管理费计算逻辑

**验证方式**:
- 单元测试: 测试管理费计算公式
- 集成测试: 创建测试考勤数据,验证工资单金额
- 手动验证: 对比计算结果与预期

---

### 阶段3: 前端实现 (预计10-12小时)

#### 4.7 考勤表填写页面 (shadcn + react-calendar)
**文件**: `frontend/src/pages/AttendanceFormFill.jsx` (新建)

**实现内容**:
1. 使用 shadcn Card, Form, Button, Input 组件
2. **日历组件集成**:
   ```javascript
   import Calendar from 'react-calendar';
   import 'react-calendar/dist/Calendar.css';
   
   const [selectedDates, setSelectedDates] = useState({
     rest: [],
     leave: [],
     overtime: [],
     beijing: [],
     country: [],
     paidLeave: []
   });
   
   // 自定义日期样式
   const tileClassName = ({ date }) => {
     const dateStr = formatDate(date);
     if (selectedDates.rest.includes(dateStr)) return 'rest-day';
     if (selectedDates.leave.includes(dateStr)) return 'leave-day';
     if (selectedDates.overtime.includes(dateStr)) return 'overtime-day';
     if (selectedDates.beijing.includes(dateStr)) return 'beijing-day';
     if (selectedDates.country.includes(dateStr)) return 'country-day';
     if (selectedDates.paidLeave.includes(dateStr)) return 'paid-leave-day';
     return 'attendance-day';
   };
   ```

3. **表单字段**:
   - 使用 shadcn Input 组件输入时长(小时:分钟)
   - 使用 shadcn Select 组件选择类型
   - 每个日期类型都有对应的记录列表

4. **自动计算逻辑**:
   ```javascript
   // 出勤天数(含带薪休假、出京、出境) = 当月总天数 - 请假天数 - 休息天数
   const calculateAttendanceDays = () => {
     const totalDays = getDaysInMonth(year, month);
     const restDays = calculateDaysFromHours(formData.rest_records);
     const leaveDays = calculateDaysFromHours(formData.leave_records);
     
     // 出勤天数已包含:出京、出境、带薪休假
     return totalDays - restDays - leaveDays;
   };
   
   // 数据验证
   const validateData = () => {
     const attendanceDays = calculateAttendanceDays();
     const restDays = calculateDaysFromHours(formData.rest_records);
     const leaveDays = calculateDaysFromHours(formData.leave_records);
     const totalDays = getDaysInMonth(year, month);
     
     if (Math.abs(attendanceDays + restDays + leaveDays - totalDays) > 0.01) {
       showError("出勤天数(含带薪休假、出京、出境) + 休息天数 + 请假天数 应等于当月总天数");
       return false;
     }
     return true;
   };
   ```

5. **实时可视化预览**:
   - 在日历上用不同颜色标示各类状态
   - 实时更新统计信息

6. **数据保存**:
   ```javascript
   const saveFormData = async () => {
     const payload = {
       rest_records: formData.rest_records,
       leave_records: formData.leave_records,
       overtime_records: formData.overtime_records,
       beijing_records: formData.beijing_records,
       country_records: formData.country_records,
       paid_leave_dates: formData.paid_leave_dates,
       calculated_stats: {
         attendance_days: calculateAttendanceDays(),
         rest_days: calculateDaysFromHours(formData.rest_records),
         leave_days: calculateDaysFromHours(formData.leave_records),
         overtime_days: calculateDaysFromHours(formData.overtime_records),
         beijing_days: calculateDaysFromHours(formData.beijing_records),
         country_days: calculateDaysFromHours(formData.country_records)
       }
     };
     
     await api.put(`/attendance-forms/by-token/${token}`, payload);
   };
   ```

**使用的 shadcn 组件**:
- Card - 表单容器
- Form - 表单布局
- Button - 操作按钮
- Input - 时长输入
- Select - 类型选择
- Badge - 状态标签
- Alert - 错误提示
- Toast - 成功提示

**日历颜色方案**:
```css
.rest-day { background-color: #ef4444; }        /* 红色 - 休息日 */
.leave-day { background-color: #f59e0b; }       /* 黄色 - 请假日 */
.overtime-day { background-color: #3b82f6; }    /* 蓝色 - 加班日 */
.beijing-day { background-color: #f97316; }     /* 橙色 - 出京日 */
.country-day { background-color: #a855f7; }     /* 紫色 - 出境日 */
.paid-leave-day { background-color: #059669; }  /* 深绿色 - 带薪休假 */
.attendance-day { background-color: #10b981; }  /* 绿色 - 出勤日 */
```

**验证方式**:
- 浏览器测试: 访问员工固定链接
- 测试日期选择功能
- 测试自动计算逻辑
- 测试日历可视化效果
- 测试数据验证规则

#### 4.8 账单详情页面更新 (FinancialManagementModal)
**文件**: `frontend/src/components/FinancialManagementModal.jsx`

**实现内容**:
1. 修改 `FinancialManagementModal` 组件
2. 在 `attendance` 数据展示区域添加新字段:
   - 出京天数
   - 出境天数
   - 请假天数
   - 带薪休假天数
   - 休息天数
3. 实现条件显示逻辑: 仅当数值 > 0 时显示
4. 保持现有样式风格一致

**日历颜色方案**:
```javascript
const dateColors = {
  attendance: '#10b981',    // 绿色 - 出勤日
  rest: '#ef4444',          // 红色 - 休息日
  leave: '#f59e0b',         // 黄色 - 请假日
  overtime: '#3b82f6',      // 蓝色 - 加班日
  beijing: '#f97316',       // 橙色 - 出京日
  country: '#a855f7',       // 紫色 - 出境日
  paidLeave: '#059669',     // 深绿色 - 带薪休假日
};
```

**验证方式**:
- 浏览器测试: 访问员工固定链接
- 测试日期选择功能
- 测试自动计算逻辑
- 测试日历可视化效果
- 测试数据验证规则

---

#### 4.8 客户签署页面 (shadcn + 日历可视化)
**文件**: `frontend/src/pages/AttendanceFormSign.jsx` (新建)

**实现内容**:
1. 使用 shadcn Card, Dialog, Button 组件
2. **日历可视化展示**:
   - 显示当月完整日历
   - 用不同颜色/图标标示各类状态:
     - 🟢 出勤日(绿色)
     - 🔴 休息日(红色)
     - 🟡 请假日(黄色,hover显示请假类型和时长)
     - 🔵 加班日(蓝色,hover显示加班时长)
     - 🟠 出京日(橙色,hover显示时长)
     - 🟣 出境日(紫色,hover显示时长)
     - 💚 带薪休假日(深绿色)
3. **文字明细展示**(日历下方):
   - 出勤天数: XX天
   - 休息天数: XX天
   - 请假天数: XX天(详细列表)
   - 加班天数: XX天(详细列表)
   - 出京天数: XX天(详细列表)
   - 出境天数: XX天(详细列表)
   - 带薪休假天数: XX天
4. PDF预览(使用现有PDF生成逻辑)
5. 集成现有电子签名组件
6. 签署确认流程

**使用的 shadcn 组件**:
- Card - 内容容器
- Calendar - 日历展示
- Badge - 状态标签
- ScrollArea - 内容预览
- Dialog/AlertDialog - 签署确认
- Button - 签署按钮
- Toast - 签署成功提示
- Tooltip - 日期hover提示

**验证方式**:
- 浏览器测试: 访问客户签署链接
- 测试日历可视化效果
- 测试文字明细展示
- 测试签名功能
- 测试签署后数据同步

---

#### 4.9 管理员考勤表列表页面
**文件**: `frontend/src/pages/AttendanceFormList.jsx` (新建)

**实现内容**:
1. 使用 shadcn Table 组件
2. 显示所有考勤表
3. 筛选功能(员工、客户、周期、状态)
4. 状态标签(draft, pending_signature, signed, synced)

**使用的 shadcn 组件**:
- Table - 列表展示
- Select - 筛选下拉
- DatePicker - 日期筛选
- Badge - 状态标签

**验证方式**:
- 浏览器测试: 管理员登录后访问
- 测试筛选功能
- 测试状态显示

---

### 阶段4: 测试与验证 (预计4-6小时)

#### 4.10 单元测试
**文件**: `backend/tests/test_attendance_sync.py` (新建)

**测试内容**:
1. 时长转天数计算
2. 出京出境管理费计算
3. 数据验证规则

**运行方式**:
```bash
source venv/bin/activate
pytest backend/tests/test_attendance_sync.py -v
```

---

#### 4.11 集成测试
**文件**: `backend/tests/test_attendance_flow.py` (新建)

**测试内容**:
1. 完整流程: 填写 → 确认 → 签署 → 同步 → 工资重算
2. 异常场景: 数据验证失败、签署失败等

**运行方式**:
```bash
source venv/bin/activate
pytest backend/tests/test_attendance_flow.py -v
```

---

#### 4.12 手动验证测试
**测试步骤**:
1. 创建测试合同和员工
2. 生成员工访问令牌
3. 员工填写考勤表(包含出京出境记录)
4. 员工确认并生成签署链接
5. 客户签署考勤表
6. 验证数据同步到 AttendanceRecord
7. 验证工资单重算,检查出京出境管理费
8. 验证工资单金额正确性

**预期结果**:
- 考勤数据正确同步
- 工资单包含出京出境管理费
- 客户应付金额 = 基础工资 + 加班费 + 出京管理费(10%) + 出境管理费(20%)

---

## 5. 风险与注意事项

### 5.1 技术风险
1. **数据一致性**: 确保考勤表数据与 AttendanceRecord 保持一致
   - 缓解措施: 使用数据库事务,同步失败时回滚

2. **并发问题**: 员工和管理员同时修改考勤表
   - 缓解措施: 使用乐观锁,版本号控制

3. **令牌安全**: 访问令牌和签署令牌的安全性
   - 缓解措施: 使用UUID生成,设置过期时间

### 5.2 业务风险
1. **客户拒绝签署**: 影响工资发放流程
   - 缓解措施: 保留手动录入方式,两种方式并存

2. **数据验证规则**: 出勤+请假+出京+出境可能超过当月天数
   - 缓解措施: 前端实时验证,后端二次验证

### 5.3 性能考虑
1. **工资单重算**: 签署后立即重算可能影响响应时间
   - 缓解措施: 使用异步任务(Celery)

2. **PDF生成**: 大量考勤表PDF生成
   - 缓解措施: 异步生成,缓存结果

---

## 6. 部署计划

### 6.1 数据库迁移
```bash
# 1. 备份生产数据库
pg_dump examdb > examdb_backup_$(date +%Y%m%d).sql

# 2. 在测试环境验证迁移
flask db upgrade

# 3. 在生产环境执行迁移
flask db upgrade
```

### 6.2 代码部署
1. 创建开发分支: `git checkout -b feature/attendance-form-system`
2. 开发完成后合并到主分支
3. 部署到测试环境验证
4. 部署到生产环境

### 6.3 上线检查清单
- [ ] 数据库迁移成功
- [ ] 后端API测试通过
- [ ] 前端页面正常显示
- [ ] 签署流程测试通过
- [ ] 工资计算逻辑验证通过
- [ ] 性能测试通过
- [ ] 用户培训完成

---

## 7. 时间估算

| 阶段 | 任务 | 预计时间 |
|------|------|----------|
| 1 | 数据库设计与迁移 | 2-3小时 |
| 2 | 后端API实现 | 8-10小时 |
| 3 | 前端实现 | 10-12小时 |
| 4 | 测试与验证 | 4-6小时 |
| **总计** | | **24-31小时** |

---

## 8. 下一步行动

1. ✅ 需求文档已完成并经用户确认
2. ⬜ 创建开发分支
3. ⬜ 执行数据库迁移
4. ⬜ 实现后端API
5. ⬜ 实现前端页面
6. ⬜ 编写测试用例
7. ⬜ 集成测试
8. ⬜ 用户验收测试
9. ⬜ 部署上线
