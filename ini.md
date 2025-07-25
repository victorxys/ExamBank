# 项目开发文档 (ini.md) 

## 前言

我已经完成了本项目的核心架构设计、数据模型定义以及初步的数据同步与计算实现。我们正处于从后端逻辑开发过渡到前端交互完善的关键阶段。

你的首要任务是，严格以这份文档中描述的业务逻辑和已确认的代码结构为基础，继续完成后续的开发工作。 这份文档经过了最终审查，修正了之前所有已知的错误和不一致之处，是你可以完全信赖的、唯一的真相来源。

---

## 本次开发周期总结 (截至 2025年7月22日)

**状态：** 本次迭代的所有核心需求均已完成。

1.  **【已完成】核心计费逻辑修正与对齐:**
    *   **问题:** 现有的计费引擎在多个方面与 `ini.md` 定义的业务规范存在偏差，导致计算错误、数据不一致和UI Bug。
    *   **解决方案:** 对核心计费系统进行了一次全面的重构和修复。
        *   **计费引擎 (`billing_engine.py`):** 重写了月嫂和育儿嫂的计费详情函数，严格对齐了文档中关于基础费、加班费、管理费（含首月/末月特殊逻辑）、保证金抵扣、员工服务费等所有计算规则。
        *   **精度问题:** 通过在中间计算过程保持最高精度，彻底解决了因浮点数运算导致的微小金额误差。
        *   **账单重复问题:** 在 `models.py` 中为账单和薪酬表添加了唯一性约束，并应用了数据库迁移，从根本上杜绝了并发任务导致的重复账单。同时优化了API调用逻辑作为双重保障。
        *   **账单周期生成:** 修正了月嫂合同的账单周期生成算法，确保周期结束日由“开始日 + 26天”得出，解决了因“差一天”问题而产生的多余账单。
        *   **API 数据结构 (`billing_api.py`):** 重构了账单详情API的响应，确保无论账单是否存在，都返回结构一致的对象，解决了前端因收到 `undefined` 数据而导致的渲染和保存失败问题。
        *   **计算日志:** 增强了日志的透明度，现在会显示代入实际数值的完整公式，并对特殊业务逻辑提供文字说明。

2.  **【已完成】功能增强 - 合同列表优化:**
    *   **需求:** 优化合同列表的默认视图，并增加按剩余有效期排序的功能，同时为即将到期的合同提供视觉提醒。
    *   **解决方案:**
        *   **后端 (`billing_api.py`):** `get_all_contracts` 接口现在默认只返回状态为 'active' 的合同。新增了按剩余有效期排序的逻辑，并会返回一个 `highlight_remaining` 标记。同时，剩余有效期的计算逻辑被重构，使其能精确显示“X个月 Y天”或“Z天”。
        *   **前端 (`ContractList.jsx`):** 状态筛选器现在默认为“服务中”。为“剩余有效期”表头增加了可点击的排序控件。会根据后端返回的 `highlight_remaining` 标记，将即将到期（少于30天）的育儿嫂合同以 warning 颜色高亮显示。

3.  **【已完成】Bug修复 - 月嫂合同下户日期计算错误:**
    *   **问题:** 月嫂合同的预计下户日期仅根据实际上户日期加固定天数，未考虑预产期与实际上户日期的偏差。
    *   **解决方案:** 修正了 `billing_api.py` 中的计算逻辑，现在会根据“实际上户日”与“预产期”的差值，动态调整原始的合同结束日期，以保证合同总时长不变。

4.  **【已完成】Bug修复 - 月嫂合同重复账单:**
    *   **问题:** 在特定情况下，系统会为同一个服务周期生成重复的月度账单。
    *   **解决方案:** 锁定了 `billing_engine.py` 中的根源问题。通过实现更健壮的“Get or Create”逻辑，确保了对任意一个服务周期，系统只会创建唯一的一张账单，彻底杜绝了重复。

5.  **【已完成】功能增强 - 自动识别月签育儿嫂合同:**
    *   **需求:** 根据金数据“补充条款”字段中的“延续一个月”字样，自动将合同标记为月签。
    *   **解决方案:** 在 `data_sync_service.py` 中增加了关键字识别逻辑，实现了合同类型的自动分类。

6.  **【已完成】功能增强 - 增加“合同剩余月数”:**
    *   **需求:** 在合同列表和详情页展示合同的剩余有效期。
    *   **解决方案:** 在后端 `billing_api.py` 中增加了动态计算逻辑，能正确处理“月签”、“短期”（月嫂）、以及根据是否已开始合同来计算剩余月数的多种情况。前端 `ContractList.jsx` 和 `ContractDetail.jsx` 已同步更新展示。

7.  **【已完成】功能增强 - 育儿嫂账单详情优化:**
    *   **需求:** 丰富育儿嫂账单详情，使其与月嫂账单布局一致，并实现更精细的业务计算规则。
    *   **解决方案:**
        *   **后端:** 重写了 `billing_engine.py` 中的 `_calculate_nanny_bill` 方法，实现了精确的管理费（区分年签/月签、首月/末月）、员工首月10%服务费等核心业务逻辑。
        *   **前端:** 更新了 `FinancialManagementModal.jsx` 组件，以正确展示所有新增字段，并实现了“加班费为0则不显示”、“育儿嫂不显示5%奖励”等动态渲染规则。

8.  **【已完成】功能增强 - 账单金额计算过程说明:**
    *   **需求:** 在账单详情的每个金额旁增加信息图标，悬停后显示该金额的详细计算规则和过程。
    *   **解决方案:**
        *   **后端:** 增强了 `billing_engine.py`，使其在计算日志中保存所有必要的原始值。
        *   **前端:** 在 `FinancialManagementModal.jsx` 中创建了 `getTooltipContent` 辅助函数，该函数能动态生成带有中文标签的、清晰的计算公式说明，并能优雅地处理账单未计算时的状态。

9.  **【已完成】Bug修复 - 实现育儿嫂试工失败账单生成:**
    *   **问题:** 将“育儿嫂试工合同”标记为“试工失败”后，系统没有按预期生成最终的试工账单。
    *   **解决方案:**
        *   **计费引擎 (`billing_engine.py`):** 在核心计费引擎中增加了对 `nanny_trial` 合同类型的处理逻辑。现在，当一个试工合同的状态被更新为 `terminated` 时，引擎会调用新增的 `_calculate_trial_contract_bill` 方法，为其生成一个符合业务规则（无管理费、有服务费）的最终账单。
        *   **健壮性提升:** 修正了计算过程中的多处类型错误，确保了从数据库读取的字段在运算前被正确转换为 `Decimal` 数字类型，避免了因类型不匹配导致的运行时错误。

*   **【已完成】修复账单详情API参数错误**: 修正了 `_get_billing_details_internal` 函数的参数接收方式，使其能够通过 `bill_id` 或 `contract_id` 组合参数正确获取账单详情。
*   **【已完成】实现“被替班费用”计算与显示**: 
    *   在 `_calculate_maternity_nurse_details` 和 `_calculate_nanny_details` 中增加了“被替班扣款”的计算逻辑。
    *   更新了 `_calculate_final_amounts`，确保在计算客户应付款和员工应领款时扣除“被替班扣款”。
    *   修改了 `_create_calculation_log`，使其在日志中清晰展示“被替班扣款”的计算过程。
    *   调整了 `_get_billing_details_internal` (后端) 和 `FinancialManagementModal.jsx` (前端)，确保“被替班费用”和相关计算日志能在前端正确显示。
*   **【已完成】修正“总劳务天数”计算逻辑**: 在 `_calculate_maternity_nurse_details` 和 `_calculate_nanny_details` 中，确保“总劳务天数”的计算公式为 `基本劳务天数 + 加班天数 - 被替班天数`。
*   **【已完成】彻底解决“替班账单”更新混淆问题**: 
    *   重构了前端 `FinancialManagementModal.jsx` 的 `handleSave` 函数，使其仅发送 `bill_id` 作为更新标识。
    *   彻底重构了后端 `batch_update_billing_details` 函数，使其完全基于 `bill_id` 进行操作，确保替班加班天数更新到正确的 `SubstituteRecord`，并返回正确的账单详情。

---

## 第一部分：已确认的数据库模型 (models.py)

这是我们系统的“宪法”，所有代码都必须围绕这个结构来编写。

### 核心模型:

- **BaseContract**: 合同的父模型，采用单表继承策略。关键通用字段如 `customer_name`, `employee_level`, `status`, 以及所有日期字段（`start_date`, `end_date`, `provisional_start_date`, `actual_onboarding_date`）都已定义在此模型中，所有子类共享这些列。
- **NannyContract (育儿嫂合同)**: `BaseContract` 的子类，通过 `type='nanny'` 识别，包含 `is_monthly_auto_renew` 等特有字段。
- **MaternityNurseContract (月嫂合同)**: `BaseContract` 的子类，通过 `type='maternity_nurse'` 识别，包含 `deposit_amount`, `management_fee_rate` 等特有字段。

### 人员模型:

- **User**: 系统内部员工，可登录。
- **ServicePersonnel**: 外部或历史服务人员，不可登录。
- **关联**: `BaseContract` 过 `user_id` 和 `service_personnel_id` 两个可为空的外键来关联到具体人员。

### 业务数据模型:

- **AttendanceRecord**: 考勤记录。已升级为周期模式，通过 `cycle_start_date` 和 `cycle_end_date` 记录，以支持月嫂的跨月考勤。
- **SubstituteRecord**: 替班记录。
- **FinancialAdjustment**: 财务调整项（增/减款）。

### 结果模型:

- **CustomerBill**: 客户月度账单。
- **EmployeePayroll**: 员工月度薪酬单。`employee_id` 字段已移除外键约束，可以存储来自 `User` 或 `ServicePersonnel` 的ID。

---

## 第二部分：业务逻辑与字段映射 (最终审查版)

### **第一部分：通用定义 (适用于所有合同类型)**

为了消除所有歧义，我们首先统一定义关于“天数”的核心字段：

*   **基本劳务天数 (`base_work_days`)**:
    *   **含义**: **（已按最新规则重构）** 这是用于**预估和计算基础工资**的、一个账单周期内的**标准工作天数**。它是一个**默认值或基于周期长度的计算值**，**不包含**加班。
    *   **月嫂合同**: 固定为 **26天**。
    *   **育儿嫂合同**:
        *   如果账单周期 **小于26天**，则等于 **实际周期天数**。
        *   如果账单周期 **大于等于26天**，则等于 **26天**。

*   **加班天数 (`overtime_days`)**:
    *   **含义**: 员工在本账单周期内的总加班天数。**（已更新）** 不再区分节假日和非节假日。
    *   **来源**: `AttendanceRecord.overtime_days`

*   **被替班天数 **:

    *   **含义**: 合同中的服务人员由于特殊情况请假，但客户家有不能缺少服务人员，因此会选定一个替班员工，因此会产生替班天数
    *   **来源**: 

    

*   **总劳务天数 (`total_days_worked`)**:
    *   **含义**: 员工在本账单周期内，实际工作的总天数。
    *   **计算**: `基本劳务天数 + 加班天数 - 被替班天数 `

---

### **第二部分：月嫂合同 (Maternity Nurse Contract)**

#### 1. 核心定义与周期逻辑

*   **核心定义**:
    *   **级别 (`employee_level`)**: 客户在一个完整26天服务周期内应支付的 **纯劳务费**。
    *   **日薪**: `级别 / 26`。

*   **合同日期联动逻辑**:
    *   **初始合同开始日 (`start_date`)**: 默认为 **`预产期 (provisional_start_date)`**。
    *   **日期更新**: 当运营人员填入 **`实际上户日期 (actual_onboarding_date)`** 后，系统会自动：
        1.  用 `实际上户日期` 更新 `合同开始日`。
        2.  计算日期差值：`差值 = 实际上户日期 - 预产期`。
        3.  用 `原合同结束日 + 差值` 来更新 `合同结束日`。

*   **账单周期 (`劳务费时段`)**:
    *   **起点**: `实际上户日期`。
    *   **周期**: 从起点开始，每 **26天** 构成一个账单周期。

---

#### 2. 客户账单 (CustomerBill) - 字段与计算方法

*   **级别**:
    *   **来源**: `BaseContract.employee_level`
*   **定金**:
    *   **来源**: `MaternityNurseContract.deposit_amount`
*   **客交保证金**:
    *   **来源**: `MaternityNurseContract.security_deposit_paid`
*   **劳务费时段**:
    *   **计算**: 根据“账单周期计算逻辑”确定。
*   **基本劳务天数**:
    *   **显示**: `min(账单周期,26天)`
*   **加班天数**:
    *   **来源**: `AttendanceRecord.overtime_days`
*   **总劳务天数**:
    *   **计算**: `26 + 加班天数`
*   **被替班天数**:
    *   **计算**: 其他员工代替此阿姨的“替班天数”
*   **基础劳务费**:
    *   **计算**: `日薪 * 基本劳务天数 (即 26)`
*   **加班费**:
    *   **计算**: `日薪 * 加班天数`
*   **管理费**:
    *   **含义**: **（已修正）** 管理费仅基于基础劳务天数计算，不包含加班费部分。
    *   **计算**: `日薪 * min(基本劳务天数, 26) * 管理费率`
*   **优惠**:
    *   **来源**: `MaternityNurseContract.discount_amount`
*   **客增加款 / 退客户款**:
    *   **计算**: 汇总相应类型的 `FinancialAdjustment` 金额。
*   **客应付款**:
    *   **计算**: `基础劳务费 + 加班费 + 管理费 - 优惠 + 客增加款 - 退客户款`
    *   **末月特殊逻辑**: 如果是最后一个账单周期，还需在此基础上减去 **`客交保证金`**。

---

#### 3. 员工薪酬 (EmployeePayroll) - 字段与计算方法

*   **基本劳务天数**:
    *   **显示**: min(账单周期,26天)
*   **加班天数**:
    *   **来源**: `AttendanceRecord.overtime_days`
*   **被替班天数**:
    *   **计算**: 其他员工代替此阿姨的“替班天数”
*   **总劳务天数**:
    *   **计算**: `26 + 加班天数 - 被替班天数  `
*   **萌嫂保证金(工资)**:
    *   **计算**: `日薪 * 基本劳务天数 (即 26)`
*   **加班费**:
    *   **计算**: `日薪 * 加班天数`
*   **5%奖励**:
    *   **条件**: `management_fee_rate` 为 15%。
    *   **计算**: `级别 * 5%`
*   **萌嫂增款 / 减萌嫂款**:
    *   **计算**: 汇总相应类型的 `FinancialAdjustment` 金额。
*   **萌嫂应领款**:
    *   **计算**: `萌嫂保证金(工资) + 加班费 + 5%奖励 + 萌嫂增款 - 减萌嫂款`

---

### **第三部分：育儿嫂合同 (Nanny Contract)**

#### 1. 核心定义与周期逻辑

*   **核心定义**:
    *   **级别 (`employee_level`)**: 客户支付的 **月度总服务费**，**已包含** 10%的管理费。
    *   **客户日薪**: `级别 / 26`
    *   **员工日薪**: `(级别 * (1 - 10%)) / 26`

*   **账单周期 (`本月合同时间段`)**:
    *   **（已按最新规则重构）** 育儿嫂合同的账单周期严格与**自然月**对齐，并分为三段处理：
        1.  **首月账单**: 从 `合同开始日` 到 `开始日所在月的最后一天`。
        2.  **中间账单**: 从 `每月1号` 到 `该月最后一天`。
        3.  **末月账单**: 从 `结束日所在月的1号` 到 `合同结束日`。
    *   如果合同在同一个自然月内开始和结束，则只生成一期账单，周期为 `合同开始日` 到 `合同结束日`。

---

#### 2. 客户账单 (CustomerBill) - 字段与计算方法

*   **级别**:
    *   **来源**: `BaseContract.employee_level`
*   **本月合同时间段**:
    *   **计算**: 根据“账单周期计算逻辑”确定。
*   **基本劳务天数**:
    *   **计算**: `min(实际账单周期天数, 26)`
*   **加班天数**:
    *   **来源**: `AttendanceRecord.overtime_days`
*   **被替班天数**:
    *   **计算**: 其他员工代替此阿姨的“替班天数”
*   **总劳务天数**:
    *   **计算**: `基本劳务天数 + 加班天数 - 被替班天数` 
*   **基础劳务费**:
    *   **计算**: `员工日薪 * 基本劳务天数`
*   **加班费**:
    *   **计算**: `客户日薪 * 加班天数`
*   **本次交管理费**:
    *   **月签合同**: `级别 * 10%`
    *   **非月签合同 (首月)**: `(级别 * 10% * 完整合同月数) + (级别 * 10% / 30 * 不足月的天数)`
    *   **非月签合同 (非首月)**: `0`
*   **客增加款 / 退客户款**:
    *   **计算**: 汇总 `FinancialAdjustment`。
    *   **末月特殊逻辑**: 对于非月签合同，若末月服务不满30天，将按比例退还管理费。
*   **客应付款**:
    *   **计算**: `基础劳务费 + 加班费 + 本次交管理费 + 客增加款 - 退客户款`

---

#### 3. 员工薪酬 (EmployeePayroll) - 字段与计算方法

*   **基本劳务天数**:
    *   **计算**: `min(实际周期天数, 26)`
*   **加班天数**:
    *   **来源**: `AttendanceRecord.overtime_days`
*   **被替班天数**:
    *   **计算**: 其他员工代替此阿姨的“替班天数”
*   **总劳务天数**:
    *   **计算**: `26 + 加班天数 - 被替班天数  `
*   **基础劳务费**:
    *   **计算**: `员工日薪 * 基本劳务天数`
*   **加班费**:
    *   **计算**: `员工日薪 * 加班天数`
*   **首月员工10%费用**:
    *   **含义**: **（已修正）** 员工首月需向公司支付的服务费，但不能超过其当期总收入。
    *   **条件**: 仅在第一个账单周期计算。
    *   **计算**: `min( (基础劳务费 + 加班费 + 萌嫂增款 - 减萌嫂款), 级别 * 10% )` (作为一笔减款项)。
*   **萌嫂增款 / 减萌嫂款**:
    *   **计算**: 汇总 `FinancialAdjustment`。
*   **萌嫂应领款**:
    *   **计算**: `基础劳务费 + 加班费 - 首月员工10%费用 + 萌嫂增款 - 减萌嫂款`。

### **第四部分：育儿嫂试工合同 (Nanny Trial Contract)**

#### 1. 核心定义与生命周期

*   **核心定义**:
    *   一种短期的、用于评估服务人员是否合适的特殊育儿嫂合同。
    *   **试工天数**: `合同结束日 - 合同开始日`。
*   **生命周期**:
    *   **试工中 (`trial_active`)**: 合同创建后的默认状态。在此状态下，合同**不产生**任何账单或薪酬单。
    *   **试工成功 (`trial_succeeded`)**: 运营人员手动确认。此状态为最终状态，合同**不产生**任何账单或薪酬单。后续费用由新签订的正式合同承担。
    *   **试工失败 (`terminated`)**: 运营人员手动确认。这是唯一会产生费用的状态，合同会进入结算流程。

#### 2. 客户账单 (CustomerBill) - 仅在“试工失败”时生成

*   **级别**:
    *   **来源**: `BaseContract.employee_level`
*   **本月合同时间段**:
    *   **计算**: `合同开始日` ~ `合同结束日` (即试工周期)。
*   **基本劳务天数**:
    *   **计算**: `试工天数`。
*   **加班天数**:
    *   **来源**: `AttendanceRecord.overtime_days` (通常为0)。
*   **基础劳务费**:
    *   **计算**: `(级别 / 26) * 试工天数`。
*   **加班费**:
    *   **计算**: `(级别 / 26) * 加班天数`。
*   **本次交管理费**:
    *   **固定为**: `0`。
*   **客应付款**:
    *   **计算**: `基础劳务费 + 加班费 + 客增加款 - 退客户款`。

#### 3. 员工薪酬 (EmployeePayroll) - 仅在“试工失败”时生成

*   **基本劳务天数**:
    *   **计算**: `试工天数`。
*   **加班天数**:
    *   **来源**: `AttendanceRecord.overtime_days`。
*   **基础劳务费**:
    *   **计算**: `(级别 / 26) * 试工天数`。
*   **加班费**:
    *   **计算**: `(级别 / 26) * 加班天数`。
*   **首月员工10%费用**:
    *   **逻辑**: 与正式育儿嫂合同**完全一致**。
    *   **计算**: `min( (基础劳务费 + 加班费 + 萌嫂增款 - 减萌嫂款), 级别 * 10% )` (作为一笔减款项)。
*   **萌嫂应领款**:
    *   **计算**: `基础劳务费 + 加班费 - 首月员工10%费用 + 萌嫂增款 - 减萌嫂款`。

### 第五部分：“替班”的业务逻辑：

#### 	“替班”的业务描述：

​	首先，替班是没有合同的，是临时产生的，例如A阿姨正在服务，需要临时休假，由B阿姨上户替班。替班细节完全由运营人员来确定，有以下区分：

#### 	替班人员类型

​	不论被替班的合同（主合同）是什么类型的合同（月嫂或育儿嫂），<u>**只看替班阿姨（B阿姨）的类型**</u>，由运营人员选择此阿姨是“月嫂”还是“育儿嫂”。也就是是说替班人员的账单逻辑，与被替班的阿姨（A阿姨）合同类型无关！！。

#### 	月嫂：

​	管理费率 = `25%` 管理费率由运营人员选择15%或25%，此处默认值是25%。

​	替班日薪 = `B阿姨的级别 * (1-管理费率) / 26` 

​	基础服务费 = `B阿姨的级别 * (1-管理费率) / 26 * 替班天数`

​	管理费 = `B阿姨的级别 * 管理费率 / 26 * 替班天数`

​	客户应付 = `基础服务费 + 管理费` = 被替班扣款

​	月嫂工资 = `B阿姨的级别 * (1-管理费率) / 26 * 替班天数` 。

#### 	育儿嫂：

​	替班日薪 = `B阿姨的级别 / 26`

​	管理费率 = `0`

​	管理费 = `0`  *（育儿嫂去替班不收任何管理费，都是给育儿嫂的）*

​	客户应付款 = `B阿姨的级别 / 26 * 替班天数`   = 被替班扣款

​	育儿嫂工资 = `B阿姨的级别 / 26 * 替班天数` 

#### 	替班加班	

​	如果有加班，算法是一样，加班费= `B阿姨级别 / 26 * 加班天数`

#### 	账单调整

##### 	金额调整	

​	替班账单生成后，要对A阿姨的相应账单周期中减去相应的 被 `替班天数` 与 `被替班扣款`

##### 	周期调整

​	原A阿姨账单（主合同账单）

​	1. 如果是月嫂：则将对应账单周期的日期向后顺延 `替班天数` ，因为月嫂账单是按26天结算的，这个不能被打破

```
举例，现有月嫂合同主账单周期是2月1日~26日，其中被替班3天（不论替班阿姨是月嫂还是育儿嫂），2月账单向后顺延三天也就是周期变为2月1日~29日，后面如果有账单，后续账单的开始、结束日期也相应自动顺延，以此类推
```

​	2. 如果是育儿嫂：则无须调整主账单周期，在主账单中扣除相应的替班天数、替班扣款即可

---

## 第四部分：已完成的后端功能模块说明

我们已经实现了一个功能基本完备的后端。

1.  **services/data_sync_service.py - 数据同步服务**
    - `_load_credentials()`: 从数据库（`llm_api_keys`表）安全地加载并解密金数据API Key和Secret。
    - `get_form_entries()`: 核心API交互函数。使用标准的HTTP Basic Auth，向金数据 V1 API (`jinshuju.net/api/v1`) 发起请求。已实现基于游标(`next`)的自动分页，能够获取一个表单下的所有数据条目。
    - `_get_or_create_personnel_ref()`: 健壮的人员查找/创建函数。遵循“User by phone -> User by name -> ServicePersonnel by phone -> ServicePersonnel by name -> Create new ServicePersonnel”的三步查找逻辑，返回人员类型和ID。
    - `sync_contracts_from_form()`: 主同步逻辑。遍历从API获取的每一条数据，使用嵌套事务来处理单个条目的错误（如唯一性冲突），确保一个条目的失败不会导致整个任务中断。它能正确解析关联字段，清洗数据，并创建对应的 `NannyContract` 或 `MaternityNurseContract` 对象。

2.  **services/billing_engine.py - 核心计算引擎**
    - `calculate_for_month()`: 计算的总入口。它会遍历所有活动合同，并根据类型调用相应的子计算器。
    - `_calculate_maternity_nurse_bill_for_month()`: 月嫂计算逻辑（已按最新规则重构）。它会严格按照“实际上户日期”和26天周期来查找当月需要结算的服务周期。
    - `_process_one_billing_cycle()`: 核心计算函数。当找到一个需要结算的周期后，此函数会被调用。它会查找对应周期的考勤记录，并根据我们最终确认的公式，分别计算客户应付款和员工应领款，然后将结果和计算详情存入 `CustomerBill` 和 `EmployeePayroll` 表。

3.  **api/billing_api.py - 对外API接口**
    - `/sync-contracts` (POST): 触发一个后台Celery任务来执行 `DataSyncService` 的同步逻辑。
    - `/calculate-bills` (POST): 触发一个后台Celery任务来执行 `BillingEngine` 的计算逻辑。
    - `/attendance` (POST): 保存或更新一条考勤记录。
    - `/contracts` (GET): 获取合同列表。
        - 已实现：分页、按客户/员工姓名搜索、按合同类型/状态筛选。
        - 已实现: 默认只显示当前月份处于服务周期内的活动合同。
        - 已实现: 按合同开始日期降序排序。
    - `/summary` (POST): 批量获取账单摘要。接收一个合同ID列表和月份，返回这些合同在该月的应付/应收金额。
    - `/details` (GET): 获取单个合同的单月财务详情。返回一个结构化的对象，包含了与Excel表头对应的所有字段，供前端展示。
    - `/pre-check` (POST): 计算前预检查。接收合同ID列表和月份，返回其中缺少“实际上户日期”的月嫂合同列表。
    - `/contracts/{id}` (PUT): 更新单个合同。目前用于为月嫂合同设置“实际上户日期”。

4.  **tasks.py - 异步任务**
    - 已创建 `sync_all_contracts_task` 和 `calculate_monthly_billing_task`，它们分别作为 `DataSyncService` 和 `BillingEngine` 的异步执行包装器。

---

## 第五部分：后续待办任务

我们已经走完了最艰难的0到1。你的任务是基于现有成果，完成从1到100的精细化开发。

1.  **【最高优先级】实现育儿嫂试工合同与统一的合同终止功能**:
    *   **目标**:引入“育儿嫂试工合同”类型，并创建一个统一的、健壮的合同终止流程，该流程能同时处理月嫂、育儿嫂合同的提前终止，以及育儿嫂试工合同的“失败”确认。
    *   **数据与同步**:
        *   **模型 (`models.py`)**: 在 `BaseContract` 中增加 `'nanny_trial'` 类型和 `'trial_active'`, `'trial_succeeded'` 状态。创建`NannyTrialContract` 子类。
        *   **同步 (`data_sync_service.py`)**: 在 `DataSyncService` 的 `FORM_CONFIGS` 中增加试工合同的配置（包含其独立的 `form_token`），使其能被`sync_all_contracts_task` 任务自动同步，并将初始状态设为 `'trial_active'`。
    *   **统一的终止流程**:
        *   **后端 API (`billing_api.py`)**: 创建一个新的API端点：`POST /api/contracts/<contract_id>/terminate`，接收一个必需的参数 `termination_date`。
        *   **后端逻辑**:
            1.  将合同的 `status` 更新为 `terminated`。
            2.  将合同的 `end_date` (及月嫂的 `expected_offboarding_date`) 更新为 `termination_date`。
            3.  删除所有开始日期在 `termination_date` 之后的无效账单和薪酬单。
            4.  为终止日所在的月份，触发一次强制的月度账单重算任务。
    *   **计费引擎 (`billing_engine.py`)**:
        *   **跳过未决合同**: 计费引擎将跳过所有状态为 `'trial_active'` 和 `'trial_succeeded'` 的合同。
        *   **复用现有逻辑**: 对于被终止的试工合同 (`status='terminated'`)，现有的计费逻辑将能自动为其生成一个**零管理费**的客户账单和一个**扣除服务费**的员工薪酬单。
    *   **前端交互 (`ContractList.jsx`)**:
        *   在合同列表的操作列，为正式合同提供“终止合同”按钮，为试工合同提供“试工失败”按钮。
        *   点击任一按钮，都弹出同一个终止日期确认弹窗。
        *   用户确认后，调用新的 `terminate` 接口，并在成功后刷新列表。

1.  **【已完成】实现育儿嫂计费逻辑**:
    - 在 `BillingEngine` 中实现 `_calculate_nanny_bill` 函数。
    - 严格按照本交接文档中描述的自然月、26天工作日基准、加班费、首月10%费等规则进行计算。
2.  **【高优先级】实现替班与保证金结算**:
    - **替班管理**: 创建一个界面来录入 `SubstituteRecord`（替班记录），包括替班人员、时间、薪资和额外的管理费。
    - **引擎升级**: 升级 `BillingEngine`，使其在计算时能处理替班情况。
    - **保证金结算**: 升级 `BillingEngine`，在计算最后一个服务周期的账单时，能正确地动用保证金进行多退少补。
3.  **【高优先级】增加终止合同多功能：**
    1.  由于实际业务中，没有“终止”合同的操作，尤其是在“月签”自动续签的合同中，并没有“终止”的这个操作。
    2.  因此在运营人员查看账单详情或者合同详情的时候需要增加一个按钮“终止合同”，点击后弹出“确认终止日期”的弹窗，此处默认的是合同原本的终止日期，提示用户，是否按合同完成日终止合同？用户可以自行选择日期来终止合同。
    3.  终止合同后，要根据合同的终止日来判断是否要重新计算账单，同时删除已生成的后续月份账单
        1.  如果终止日 = 合同结束日，则不用调整任何账单
        2.  如果终止日 早于 合同结束日，怎结最后一个月的账单就要调整，减少账单服务周期（根据终止日来进行计算）
        3.  如果终止日 晚于 合同结束日，则在当前账单的基础上 生成一个新账单，账单服务周期为合同结束日  ~ 终止日。

4.  **【低优先级】仪表盘统计**:
    - 控制台展示，需要设计一个运营人员查看的展示板。请查看我的所有代码，来规划设计一个展示板，用来给运营人员、ceo查看当前系统的核心业务数据。
    - 在财务仪表盘顶部增加统计卡片，显示当月的总应收、总应付、总利润等关键指标。
5.  补充功能
    1.  在月嫂账单中，小概率事件会在26天的账单周期中会休息一天，但是账单周期中出勤天数至少是26天，因此会存在运营人员手动修改账单结束日，将本账单周期的结束日向后延x天。因此，如果有后续账单的话，后续账单的周期都会因此而顺延，因此需要重新更新此后的账单。


---

## 第六部分：前端页面设计要求

为以下两个关键页面设计线框图或直接输出HTML代码。

**技术约束:**

- 使用 HTML 和 Tailwind CSS (通过 CDN 引用: `<script src="https://cdn.tailwindcss.com"></script>`)。
- 使用 Material Icons 或 Font Awesome 作为图标 (通过 CDN 引用)
- 页面必须是响应式的。
- 包含轻微的交互效果，如按钮悬停效果。

1.  **【已完成】核心计费逻辑修正与对齐:**
    *   **问题:** 现有的计费引擎在多个方面与 `ini.md` 定义的业务规范存在偏差，导致计算错误、数据不一致和UI Bug。
    *   **解决方案:** 对核心计���系统进行了一次全面的重构和修复。
        *   **计费引擎 (`billing_engine.py`):** 重写了月嫂和育儿嫂的计费详情函数，严格对齐了文档中关于基础费、加班费、管理费（含首月/末月特殊逻辑）、保证金抵扣、员工服务费等所有计算规则。
        *   **精度问题:** 通过在中间计算过程保持最高精度，彻底解决了因浮点数运算导致的微小金额误差。
        *   **账单重复问题:** 在 `models.py` 中为账单和薪酬表添加了唯一性约束，并应用了数据库迁移，从根本上杜绝了并发任务导致的重复账单。同时优化了API调用逻辑作为双重保障。
        *   **账单周期生成:** 修正了月嫂合同的账单周期生成算法，确保周期结束日由“开始日 + 26天”得出，解决了因“差一天”问题而产生的多余账单。
        *   **API 数据结构 (`billing_api.py`):** 重构了账单详情API的响应，确保无论账单是否存在，都返回结构一致的对象，解决了前端因收到 `undefined` 数据而导致的渲染和保存失败问题。
        *   **计算日志:** 增强了日志的透明度，现在会显示代入实际数值的完整公式，并对特殊业务逻辑提供文字说明。

2.  **【已完成】功能增强 - 合同列表优化:**
    *   **需求:** 优化合同列表的默认视图，并增加按剩余有效期排序的功能，同时为即将到期的合同提供视觉提醒。
    *   **解决方案:**
        *   **后端 (`billing_api.py`):** `get_all_contracts` 接口现在默认只返回状态为 'active' 的合同。新增了按剩余有效期排序的逻辑，并会返回一个 `highlight_remaining` 标记。同时，剩余有效期的计算逻辑被重构，使其能精确显示“X个月 Y天”或“Z天”。
        *   **前端 (`ContractList.jsx`):** 状态筛选器现在默认为“服务中”。为“剩余有效期”表头增加了可点击的排序控件。会根据后端返回的 `highlight_remaining` 标记，将即将到期（少于30天）的育儿嫂合同以 warning 颜色高亮显示。

3.  **【已完成】Bug修复 - 月嫂合同下户日期计算错误:**
    *   **问题:** 月嫂合同的预计下户日期仅根据实际上户日期加固定天数，未考虑预产期与实际上户日期的偏差。
    *   **解决方案:** 修正了 `billing_api.py` 中的计算逻辑，现在会根据“实际上户日”与“预产期”的差值，动态调整原始的合同结束日期，以保证合同总时长不变。

4.  **【已完成】Bug修复 - 月嫂合同重复账单:**
    *   **问题:** 在特定情况下，系统会为同一个服务周期生成重复的月度账单。
    *   **解决方案:** 锁定了 `billing_engine.py` 中的根源问题。通过实现更健壮的“Get or Create”逻辑，确保了对任意一个服务周期，系统只会创建唯一的一张账单，彻底杜绝了重复。

5.  **【已完成】功能增强 - 自动识别月签育儿嫂合同:**
    *   **需求:** 根据金数据“补充条款”字段中的“延续一个月”字样，自动将合同标记为月签。
    *   **解决方案:** 在 `data_sync_service.py` 中增加了关键字识别逻辑，实现了合同类型的自动分类。

6.  **【已完成】功能增强 - 增加“合同剩余月数”:**
    *   **需求:** 在合同列表和详情页展示合同的剩余有效期。
    *   **解决方案:** 在后端 `billing_api.py` 中增加了动态计算逻辑，能正确处理“月签”、“短期”（月嫂）、以及根据是否已开始合同来计算剩余月数的多种情况。前端 `ContractList.jsx` 和 `ContractDetail.jsx` 已同步更新展示。

7.  **【已完成】功能增强 - 育儿嫂账单详情优化:**
    *   **需求:** 丰富育儿嫂账单详情，使其与月嫂账单布局一致，并实现更精细的业务计算规则。
    *   **解决方案:**
        *   **后端:** 重写了 `billing_engine.py` 中的 `_calculate_nanny_bill` 方法，实现了精确的管理费（区分年签/月签、首月/末月）、员工首月10%服务费等核心业务逻辑。
        *   **前端:** 更新了 `FinancialManagementModal.jsx` 组件，以正确展示所有新增字段，并实现了“加班费为0则不显示”、“育儿嫂不显示5%奖励”等动态渲染规则。

8.  **【已完成】功能增强 - 账单金额计算过程说明:**
    *   **需求:** 在账单详情的每个金额旁增加信息图标，悬停后显示该金额的详细计算规则和过程。
    *   **解决方案:**
        *   **后端:** 增强了 `billing_engine.py`，使其在计算日志中保存所有必要的原始值。
        *   **前端:** 在 `FinancialManagementModal.jsx` 中创建了 `getTooltipContent` 辅助函数，该函数能动态生成带有中文标签的、清晰的计算公式说明，并能优雅地处理账单未计算时的状态。

9.  **【已完成】Bug修复 - 实现育儿嫂试工失败账单生成:**
    *   **问题:** 将“育儿嫂试工合同”标记为“试工失败”后，系统没有按预期生成最终的试工账单。
    *   **解决方案:**
        *   **计费引擎 (`billing_engine.py`):** 在核心计费引擎中增加了对 `nanny_trial` 合同类型的处理逻辑。现在，当一个试工合同的状态被更新为 `terminated` 时，引擎会调用新增的 `_calculate_trial_contract_bill` 方法，为其生成一个符合业务规则（无管理费、有服务费）的最终账单。
        *   **健壮性提升:** 修正了计算过程中的多处类型错误，确保了从数据库读取的字段在运算前被正确转换为 `Decimal` 数字类型，避免了因类型不匹配导致的运行时错误。

---

## 第一部分：已确认的数据库模型 (models.py)

这是我们系统的“宪法”，所有代码都必须围绕这个结构来编写。

### 核心模型:

- **BaseContract**: 合同的父模型，采用单表继承策略。关键通用字段如 `customer_name`, `employee_level`, `status`, 以及所有日期字段（`start_date`, `end_date`, `provisional_start_date`, `actual_onboarding_date`）都已定义在此模型中，所有子类共享这些列。
- **NannyContract (育儿嫂合同)**: `BaseContract` 的子类，通过 `type='nanny'` 识别，包含 `is_monthly_auto_renew` 等特有字段。
- **MaternityNurseContract (月嫂合同)**: `BaseContract` 的子类，通过 `type='maternity_nurse'` 识别，包含 `deposit_amount`, `management_fee_rate` 等特有字段。

### 人员模型:

- **User**: 系统内部员工，可登录。
- **ServicePersonnel**: 外部或历史服务人员，不可登录。
- **关联**: `BaseContract` 过 `user_id` 和 `service_personnel_id` 两个可为空的外键来关联到具体人员。

### 业务数据模型:

- **AttendanceRecord**: 考勤记录。已升级为周期模式，通过 `cycle_start_date` 和 `cycle_end_date` 记录，以支持月嫂的跨月考勤。
- **SubstituteRecord**: 替班记录。
- **FinancialAdjustment**: 财务调整项（增/减款）。

### 结果模型:

- **CustomerBill**: 客户月度账单。
- **EmployeePayroll**: 员工月度薪酬单。`employee_id` 字段已移除外键约束，可以存储来自 `User` 或 `ServicePersonnel` 的ID。

---

## 第二部分：业务逻辑与字段映射 (最终审查版)

### **第一部分：通用定义 (适用于所有合同类型)**

为了消除所有歧义，我们首先统一定义关于“天数”的核心字段：

*   **基本劳务天数 (`base_work_days`)**:
    *   **含义**: **（已按最新规则重构）** 这是用于**预估和计算基础工资**的、一个账单周期内的**标准工作天数**。它是一个**默认值或基于周期长度的计算值**，**不包含**加班。
    *   **月嫂合同**: 固定为 **26天**。
    *   **育儿嫂合同**:
        *   如果账单周期 **小于26天**，则等于 **实际周期天数**。
        *   如果账单周期 **大于等于26天**，则等于 **26天**。

*   **加班天数 (`overtime_days`)**:
    *   **含义**: 员工在本账单周期内的总加班天数。**（已更新）** 不再区分节假日和非节假日。
    *   **来源**: `AttendanceRecord.overtime_days`

*   **被替班天数 **:

    *   **含义**: 合同中的服务人员由于特殊情况请假，但客户家有不能缺少服务人员，因此会选定一个替班员工，因此会产生替班天数
    *   **来源**: 

    

*   **总劳务天数 (`total_days_worked`)**:
    *   **含义**: 员工在本账单周期内，实际工作的总天数。
    *   **计算**: `基本劳务天数 + 加班天数 - 被替班天数 `

---

### **第二部分：月嫂合同 (Maternity Nurse Contract)**

#### 1. 核心定义与周期逻辑

*   **核心定义**:
    *   **级别 (`employee_level`)**: 客户在一个完整26天服务周期内应支付的 **纯劳务费**。
    *   **日薪**: `级别 / 26`。

*   **合同日期联动逻辑**:
    *   **初始合同开始日 (`start_date`)**: 默认为 **`预产期 (provisional_start_date)`**。
    *   **日期更新**: 当运营人员填入 **`实际上户日期 (actual_onboarding_date)`** 后，系统会自动：
        1.  用 `实际上户日期` 更新 `合同开始日`。
        2.  计算日期差值：`差值 = 实际上户日期 - 预产期`。
        3.  用 `原合同结束日 + 差值` 来更新 `合同结束日`。

*   **账单周期 (`劳务费时段`)**:
    *   **起点**: `实际上户日期`。
    *   **周期**: 从起点开始，每 **26天** 构成一个账单周期。

---

#### 2. 客户账单 (CustomerBill) - 字段与计算方法

*   **级别**:
    *   **来源**: `BaseContract.employee_level`
*   **定金**:
    *   **来源**: `MaternityNurseContract.deposit_amount`
*   **客交保证金**:
    *   **来源**: `MaternityNurseContract.security_deposit_paid`
*   **劳务费时段**:
    *   **计算**: 根据“账单周期计算逻辑”确定。
*   **基本劳务天数**:
    *   **显示**: `min(账单周期,26天)`
*   **加班天数**:
    *   **来源**: `AttendanceRecord.overtime_days`
*   **总劳务天数**:
    *   **计算**: `26 + 加班天数`
*   **被替班天数**:
    *   **计算**: 其他员工代替此阿姨的“替班天数”
*   **基础劳务费**:
    *   **计算**: `日薪 * 基本劳务天数 (即 26)`
*   **加班费**:
    *   **计算**: `日薪 * 加班天数`
*   **被替班费用:
    *   **计算**: `日薪 * 被替班天数`
*   **管理费**:
    *   **含义**: **（已修正）** 管理费仅基于基础劳务天数计算，不包含加班费部分。
    *   **计算**: `日薪 * min(基本劳务天数, 26) * 管理费率`
*   **优惠**:
    *   **来源**: `MaternityNurseContract.discount_amount`
*   **客增加款 / 退客户款**:
    *   **计算**: 汇总相应类型的 `FinancialAdjustment` 金额。
*   **客应付款**:
    *   **计算**: `基础劳务费 - 被替班费用 + 加班费 + 管理费 - 优惠 + 客增加款 - 退客户款`
    *   **末月特殊逻辑**: 如果是最后一个账单周期，还需在此基础上减去 **`客交保证金`**。

---

#### 3. 员工薪酬 (EmployeePayroll) - 字段与计算方法

*   **基本劳务天数**:
    *   **显示**: min(账单周期,26天)
*   **加班天数**:
    *   **来源**: `AttendanceRecord.overtime_days`
*   **被替班天数**:
    *   **计算**: 其他员工代替此阿姨的“替班天数”
*   **总劳务天数**:
    *   **计算**: `26 + 加班天数 - 被替班天数  `
*   **萌嫂保证金(工资)**:
    *   **计算**: `日薪 * 基本劳务天数 (即 26)`
*   **加班费**:
    *   **计算**: `日薪 * 加班天数`
*   **被替班费用:**
    *   **计算**: `日薪 * 被替班天数`
*   **5%奖励**:
    *   **条件**: `management_fee_rate` 为 15%。
    *   **计算**: `级别 * 5%`
*   **萌嫂增款 / 减萌嫂款**:
    *   **计算**: 汇总相应类型的 `FinancialAdjustment` 金额。
*   **萌嫂应领款**:
    *   **计算**: `萌嫂保证金(工资) + 加班费 - 被替班费用 + 5%奖励 + 萌嫂增款 - 减萌嫂款`

---

### **第三部分：育儿嫂合同 (Nanny Contract)**

#### 1. 核心定义与周期逻辑

*   **核心定义**:
    *   **级别 (`employee_level`)**: 客户支付的 **月度总服务费**，**已包含** 10%的管理费。
    *   **客户日薪**: `级别 / 26`
    *   **员工日薪**: `(级别 * (1 - 10%)) / 26`

*   **账单周期 (`本月合同时间段`)**:
    *   **（已按最新规则重构）** 育儿嫂合同的账单周期严格与**自然月**对齐，并分为三段处理：
        1.  **首月账单**: 从 `合同开始日` 到 `开始日所在月的最后一天`。
        2.  **中间账单**: 从 `每月1号` 到 `该月最后一天`。
        3.  **末月账单**: 从 `结束日所在月的1号` 到 `合同结束日`。
    *   如果合同在同一个自然月内开始和结束，则只生成一期账单，周期为 `合同开始日` 到 `合同结束日`。

---

#### 2. 客户账单 (CustomerBill) - 字段与计算方法

*   **级别**:
    *   **来源**: `BaseContract.employee_level`
*   **本月合同时间段**:
    *   **计算**: 根据“账单周期计算逻辑”确定。
*   **基本劳务天数**:
    *   **计算**: `min(实际账单周期天数, 26)`
*   **加班天数**:
    *   **来源**: `AttendanceRecord.overtime_days`
*   **被替班天数**:
    *   **计算**: 其他员工代替此阿姨的“替班天数”
*   **总劳务天数**:
    *   **计算**: `基本劳务天数 + 加班天数 - 被替班天数` 
*   **基础劳务费**:
    *   **计算**: `员工日薪 * 基本劳务天数`
*   **加班费**:
    *   **计算**: `客户日薪 * 加班天数`
*   **被替班费用:**
    *   **计算**: `日薪 * 被替班天数`
*   **本次交管理费**:
    *   **月签合同**: `级别 * 10%`
    *   **非月签合同 (首月)**: `(级别 * 10% * 完整合同月数) + (级别 * 10% / 30 * 不足月的天数)`
    *   **非月签合同 (非首月)**: `0`
*   **客增加款 / 退客户款**:
    *   **计算**: 汇总 `FinancialAdjustment`。
    *   **末月特殊逻辑**: 对于非月签合同，若末月服务不满30天，将按比例退还管理费。
*   **客应付款**:
    *   **计算**: `基础劳务费 + 加班费 + 本次交管理费 - 被替班费用 + 客增加款 - 退客户款`

---

#### 3. 员工薪酬 (EmployeePayroll) - 字段与计算方法

*   **基本劳务天数**:
    *   **计算**: `min(实际周期天数, 26)`
*   **加班天数**:
    *   **来源**: `AttendanceRecord.overtime_days`
*   **被替班天数**:
    *   **计算**: 其他员工代替此阿姨的“替班天数”
*   **总劳务天数**:
    *   **计算**: `26 + 加班天数 - 被替班天数  `
*   **基础劳务费**:
    *   **计算**: `员工日薪 * 基本劳务天数`
*   **加班费**:
    *   **计算**: `员工日薪 * 加班天数`
*   **被替班费用:**
    *   **计算**: `日薪 * 被替班天数`
*   **首月员工10%费用**:
    *   **含义**: **（已修正）** 员工首月需向公司支付的服务费，但不能超过其当期总收入。
    *   **条件**: 仅在第一个账单周期计算。
    *   **计算**: `min( (基础劳务费 + 加班费 + 萌嫂增款 - 减萌嫂款), 级别 * 10% )` (作为一笔减款项)
*   **萌嫂增款 / 减萌嫂款**:
    *   **计算**: 汇总 `FinancialAdjustment`。
*   **萌嫂应领款**:
    *   **计算**: `基础劳务费 + 加班费 - 被替班费用 - 首月员工10%费用 + 萌嫂增款 - 减萌嫂款`

### **第四部分：育儿嫂试工合同 (Nanny Trial Contract)**

#### 1. 核心定义与生命周期

*   **核心定义**:
    *   一种短期的、用于评估服务人员是否合适的特殊育儿嫂合同。
    *   **试工天数**: `合同结束日 - 合同开始日`。
*   **生命周期**:
    *   **试工中 (`trial_active`)**: 合同创建后的默认状态。在此状态下，合同**不产生**任何账单或薪酬单。
    *   **试工成功 (`trial_succeeded`)**: 运营人员手动确认。此状态为最终状态，合同**不产生**任何账单或薪酬单。后续费用由新签订的正式合同承担。
    *   **试工失败 (`terminated`)**: 运营人员手动确认。这是唯一会产生费用的状态，合同会进入结算流程。

#### 2. 客户账单 (CustomerBill) - 仅在“试工失败”时生成

*   **级别**:
    *   **来源**: `BaseContract.employee_level`
*   **本月合同时间段**:
    *   **计算**: `合同开始日` ~ `合同结束日` (即试工周期)。
*   **基本劳务天数**:
    *   **计算**: `试工天数`。
*   **加班天数**:
    *   **来源**: `AttendanceRecord.overtime_days` (通常为0)。
*   **基础劳务费**:
    *   **计算**: `(级别 / 26) * 试工天数`。
*   **加班费**:
    *   **计算**: `(级别 / 26) * 加班天数`。
*   **本次交管理费**:
    *   **固定为**: `0`。
*   **客应付款**:
    *   **计算**: `基础劳务费 + 加班费 + 客增加款 - 退客户款`。

#### 3. 员工薪酬 (EmployeePayroll) - 仅在“试工失败”时生成

*   **基本劳务天数**:
    *   **计算**: `试工天数`。
*   **加班天数**:
    *   **来源**: `AttendanceRecord.overtime_days`。
*   **基础劳务费**:
    *   **计算**: `(级别 / 26) * 试工天数`。
*   **加班费**:
    *   **计算**: `(级别 / 26) * 加班天数`。
*   **首月员工10%费用**:
    *   **逻辑**: 与正式育儿嫂合同**完全一致**。
    *   **计算**: `min( (基础劳务费 + 加班费 + 萌嫂增款 - 减萌嫂款), 级别 * 10% )` (作为一笔减款项)。
*   **萌嫂应领款**:
    *   **计算**: `基础劳务费 + 加班费 - 首月员工10%费用 + 萌嫂增款 - 减萌嫂款`。

### 第五部分：替班的业务逻辑：

​	替班的业务描述：首先，替班是没有合同的，是临时产生的，例如A阿姨正在服务，需要临时休假，由B阿姨上户替班。替班细节完全由运营人员来确定，有以下区分：

​	月嫂：客户应付 = `B阿姨的级别 / 26 * 替班天数` 这个里面是包含管理费了；管理费率由运营人员选择15%或25%，此处默认值是25%。月嫂工资 = `B阿姨的级别 * (1-管理费率) / 26 * 替班天数` 。A阿姨被替班后，由于月嫂账单必须满26天才结算，因此A阿姨被替班所在月份的账单要向后延展`替班天数`，从而导致此合同的后续账单也要向后顺延（后续账单的开始、结束时间都要向后延展）。

​	育儿嫂：管理费 = `A阿姨的级别 * 10% / 26 * 替班天数`。萌嫂基础劳务费= `B阿姨的级别 / 26 * 替班天数`。客户应付款 = `管理费 + 萌嫂基础劳务费`   育儿嫂工资 = 萌嫂基础劳务费 

如果有加班，算法是一样，加班费= `B阿姨级别 / 26 * 加班天数`

---

## 第四部分：已完成的后端功能模块说明

我们已经实现了一个功能基本完备的后端。

1.  **services/data_sync_service.py - 数据同步服务**
    - `_load_credentials()`: 从数据库（`llm_api_keys`表）安全地加载并解密金数据API Key和Secret。
    - `get_form_entries()`: 核心API交互函数。使用标准的HTTP Basic Auth，向金数据 V1 API (`jinshuju.net/api/v1`) 发起请求。已实现基于游标(`next`)的自动分页，能够获取一个表单下的所有数据条目。
    - `_get_or_create_personnel_ref()`: 健壮的人员查找/创建函数。遵循“User by phone -> User by name -> ServicePersonnel by phone -> ServicePersonnel by name -> Create new ServicePersonnel”的三步查找逻辑，返回人员类型和ID。
    - `sync_contracts_from_form()`: 主同步逻辑。遍历从API获取的每一条数据，使用嵌套事务来处理单个条目的错误（如唯一性冲突），确保一个条目的失败不会导致整个任务中断。它能正确解析关联字段，清洗数据，并创建对应的 `NannyContract` 或 `MaternityNurseContract` 对象。

2.  **services/billing_engine.py - 核心计算引擎**
    - `calculate_for_month()`: 计算的总入口。它会遍历所有活动合同，并根据类型调用相应的子计算器。
    - `_calculate_maternity_nurse_bill_for_month()`: 月嫂计算逻辑（已按最新规则重构）。它会严格按照“实际上户日期”和26天周期来查找当月需要结算的服务周期。
    - `_process_one_billing_cycle()`: 核心计算函数。当找到一个需要结算的周期后，此函数会被调用。它会查找对应周期的考勤记录，并根据我们最终确认的公式，分别计算客户应付款和员工应领款，然后将结果和计算详情存入 `CustomerBill` 和 `EmployeePayroll` 表。

3.  **api/billing_api.py - 对外API接口**
    - `/sync-contracts` (POST): 触发一个后台Celery任务来执行 `DataSyncService` 的同步逻辑。
    - `/calculate-bills` (POST): 触发一个后台Celery任务来执行 `BillingEngine` 的计算逻辑。
    - `/attendance` (POST): 保存或更新一条考勤记录。
    - `/contracts` (GET): 获取合同列表。
        - 已实现：分页、按客户/员工姓名搜索、按合同类型/状态筛选。
        - 已实现: 默认只显示当前月份处于服务周期内的活动合同。
        - 已实现: 按合同开始日期降序排序。
    - `/summary` (POST): 批量获取账单摘要。接收一个合同ID列表和月份，返回这些合同在该月的应付/应收金额。
    - `/details` (GET): 获取单个合同的单月财务详情。返回一个结构化的对象，包含了与Excel表头对应的所有字段，供前端展示。
    - `/pre-check` (POST): 计算前预检查。接收合同ID列表和月份，返回其中缺少“实际上户日期”的月嫂合同列表。
    - `/contracts/{id}` (PUT): 更新单个合同。目前用于为月嫂合同设置“实际上户日期”。

4.  **tasks.py - 异步任务**
    - 已创建 `sync_all_contracts_task` 和 `calculate_monthly_billing_task`，它们分别作为 `DataSyncService` 和 `BillingEngine` 的异步执行包装器。

---

## 第五部分：后续待办任务

我们已经走完了最艰难的0到1。你的任务是基于现有成果，完成从1到100的精细化开发。

1.  **【最高优先级】实现育儿嫂试工合同与统一的合同终止功能**:
    *   **目标**:引入“育儿嫂试工合同”类型，并创建一个统一的、健壮的合同终止流程，该流程能同时处理月嫂、育儿嫂合同的提前终止，以及育儿嫂试工合同的“失败”确认。
    *   **数据与同步**:
        *   **模型 (`models.py`)**: 在 `BaseContract` 中增加 `'nanny_trial'` 类型和 `'trial_active'`, `'trial_succeeded'` 状态。创建`NannyTrialContract` 子类。
        *   **同步 (`data_sync_service.py`)**: 在 `DataSyncService` 的 `FORM_CONFIGS` 中增加试工合同的配置（包含其独立的 `form_token`），使其能被`sync_all_contracts_task` 任务自动同步，并将初始状态设为 `'trial_active'`。
    *   **统一的终止流程**:
        *   **后端 API (`billing_api.py`)**: 创建一个新的API端点：`POST /api/contracts/<contract_id>/terminate`，接收一个必需的参数 `termination_date`。
        *   **后端逻辑**:
            1.  将合同的 `status` 更新为 `terminated`。
            2.  将合同的 `end_date` (及月嫂的 `expected_offboarding_date`) 更新为 `termination_date`。
            3.  删除所有开始日期在 `termination_date` 之后的无效账单和薪酬单。
            4.  为终止日所在的月份，触发一次强制的月度账单重算任务。
    *   **计费引擎 (`billing_engine.py`)**:
        *   **跳过未决合同**: 计费引擎将跳过所有状态为 `'trial_active'` 和 `'trial_succeeded'` 的合同。
        *   **复用现有逻辑**: 对于被终止的试工合同 (`status='terminated'`)，现有的计费逻辑将能自动为其生成一个**零管理费**的客户账单和一个**扣除服务费**的员工薪酬单。
    *   **前端交互 (`ContractList.jsx`)**:
        *   在合同列表的操作列，为正式合同提供“终止合同”按钮，为试工合同提供“试工失败”按钮。
        *   点击任一按钮，都弹出同一个终止日期确认弹窗。
        *   用户确认后，调用新的 `terminate` 接口，并在成功后刷新列表。

1.  **【已完成】实现育儿嫂计费逻辑**:
    - 在 `BillingEngine` 中实现 `_calculate_nanny_bill` 函数。
    - 严格按照本交接文档中描述的自然月、26天工作日基准、加班费、首月10%费等规则进行计算。
2.  **【高优先级】实现替班与保证金结算**:
    - **替班管理**: 创建一个界面来录入 `SubstituteRecord`（替班记录），包括替班人员、时间、薪资和额外的管理费。
    - **引擎升级**: 升级 `BillingEngine`，使其在计算时能处理替班情况。
    - **保证金结算**: 升级 `BillingEngine`，在计算最后一个服务周期的账单时，能正确地动用保证金进行多退少补。
3.  **【高优先级】增加终止合同多功能：**
    1.  由于实际业务中，没有“终止”合同的操作，尤其是在“月签”自动续签的合同中，并没有“终止”的这个操作。
    2.  因此在运营人员查看账单详情或者合同详情的时候需要增加一个按钮“终止合同”，点击后弹出“确认终止日期”的弹窗，此处默认的是合同原本的终止日期，提示用户，是否按合同完成日终止合同？用户可以自行选择日期来终止合同。
    3.  终止合同后，要根据合同的终止日来判断是否要重新计算账单，同时删除已生成的后续月份账单
        1.  如果终止日 = 合同结束日，则不用调整任何账单
        2.  如果终止日 早于 合同结束日，怎结最后一个月的账单就要调整，减少账单服务周期（根据终止日来进行计算）
        3.  如果终止日 晚于 合同结束日，则在当前账单的基础上 生成一个新账单，账单服务周期为合同结束日  ~ 终止日。

4.  **【低优先级】仪表盘统计**:
    - 控制台展示，需要设计一个运营人员查看的展示板。请查看我的所有代码，来规划设计一个展示板，用来给运营人员、ceo查看当前系统的核心业务数据。
    - 在财务仪表盘顶部增加统计卡片，显示当月的总应收、总应付、总利润等关键指标。
5.  补充功能
    1.  在月嫂账单中，小概率事件会在26天的账单周期中会休息一天，但是账单周期中出勤天数至少是26天，因此会存在运营人员手动修改账单结束日，将本账单周期的结束日向后延x天。因此，如果有后续账单的话，后续账单的周期都会因此而顺延，因此需要重新更新此后的账单。


---

## 第六部分：前端页面设计要求

为以下两个关键页面设计线框图或直接输出HTML代码。

**技术约束:**

- 使用 HTML 和 Tailwind CSS (通过 CDN 引用: `<script src="https://cdn.tailwindcss.com"></script>`)。
- 使用 Material Icons 或 Font Awesome 作为图标 (通过 CDN 引用)
- 页面必须是响应式的。
- 包含轻微的交互效果，如按钮悬停效果。