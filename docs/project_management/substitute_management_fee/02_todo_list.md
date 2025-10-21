## 替班管理费功能 - 任务清单 (TODO List)

**版本:** 2.0
**日期:** 2025年10月21日
**基于:** `01_requirements.md` (版本 2.0)

---

### 阶段一：核心逻辑与数据准备

- [x] **数据库:** 确认 `SubstituteRecord` 表中存在 `substitute_management_fee` 字段。
- [ ] **配置:** 确认系统中存在或新增一个地方，用于定义**不同级别人员的每日替班管理费**标准。
- [ ] **核心服务:** 创建一个可复用的 `calculate_substitute_management_fee` 服务函数。
    - **输入:** 合同对象、替班记录对象。
    - **核心逻辑:** 实现 `计费天数 = 替班结束日期 - max(合同最终结束日期, 替班开始日期)` 公式。
    - **输出:** 计费天数和根据人员级别计算出的总费用。

### 阶段二：业务流程集成

- [ ] **修改“创建/更新替班记录”的API及服务:**
    - [ ] 在保存替班记录前，获取其关联的主合同。
    - [ ] 调用 `calculate_substitute_management_fee` 服务。
    - [ ] 如果服务返回的费用大于0，且当前 `substitute_management_fee` 为空或0，则将费用更新到 `SubstituteRecord` 的 `substitute_management_fee` 字段。

- [ ] **修改“终止合同”的API及服务:**
    - [ ] 在执行合同终止的逻辑中，遍历该合同下所有的替班记录。
    - [ ] 对每一条替班记录，调用 `calculate_substitute_management_fee` 服务（使用合同**新的终止日期**）。
    - [ ] 将服务返回的费用更新到对应替班记录的 `substitute_management_fee` 字段。

### 阶段三：测试与验证

- [ ] **单元测试:**
    - [ ] 为 `calculate_substitute_management_fee` 服务编写单元测试，必须覆盖以下场景：
        - [ ] 场景1: 替班周期完全在合同期之后（应产生费用）。
        - [ ] 场景2: 替班周期部分在合同期之后（应产生费用）。
        - [ ] 场景3: 替班周期完全在合同期之内（不应产生费用）。
        - [ ] 场景4: 替班结束日期与合同结束日期为同一天（不应产生费用）。
        - [ ] 场景5: 自动续签的合同，不应产生费用。

- [ ] **集成测试:**
    - [ ] 测试1: 模拟“合同提前终止”流程，验证 `SubstituteRecord` 的 `substitute_management_fee` 字段被正确更新。
    - [ ] 测试2: 模拟“为已结束的合同添加替班记录”流程，验证 `SubstituteRecord` 的 `substitute_management_fee` 字段被正确更新。
    - [ ] 测试3: 模拟常规的合同期内替班，验证 `substitute_management_fee` 字段为0或null。
    - [ ] 测试4: 验证计费引擎 (`BillingEngine`) 在生成替班账单时，能正确将 `substitute_management_fee` 的值计入管理费。

### 阶段四：文档与收尾

- [ ] **API 文档:** 更新“创建替班”和“终止合同”的API文档，说明 `substitute_management_fee` 字段的更新逻辑。
- [ ] **用户文档:** 撰写或更新内部知识库，向财务或运营人员解释新收费规则的使用场景和查看方式。