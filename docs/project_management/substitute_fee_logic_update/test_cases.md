# 测试用例：替班管理费逻辑更新 (v2 - 修订版)

---

### 测试用例: 001 - 数据库与迁移

**测试目的:** 验证 `SubstituteRecord` 表结构已更新，包含 `substitute_management_fee_rate` 字段。
**涉及模块/文件:** `backend/models.py`, `migrations/versions/`
**输入:** 运行 Alembic 迁移。
**期望输出:** `substitute_record` 表包含 `substitute_management_fee_rate` (Numeric, default 0)。
**实际输出 & 测试结果:** [待填充]

---

### 测试用例: 002 - 合同上下文 API (`/substitute-context`)

**测试目的:** 验证新的上下文 API 能根据不同合同类型和状态，返回正确的 `contract_type` 和 `effective_end_date`。
**涉及模块/文件:** `backend/api/contract_api.py`

**场景 A: 非自动续签 - 正常**
- **输入:** 非自动续签合同, `end_date`='2025-11-30', `termination_date`=None.
- **期望输出:** `{"contract_type": "non_auto_renewing", "effective_end_date": "2025-11-30"}`.

**场景 B: 非自动续签 - 提前终止**
- **输入:** 非自动续签合同, `end_date`='2025-11-30', `termination_date`='2025-11-15'.
- **期望输出:** `{"contract_type": "non_auto_renewing", "effective_end_date": "2025-11-30"}` (取 max).

**场景 C: 非自动续签 - 延后终止**
- **输入:** 非自动续签合同, `end_date`='2025-11-30', `termination_date`='2025-12-15'.
- **期望输出:** `{"contract_type": "non_auto_renewing", "effective_end_date": "2025-12-15"}` (取 max).

**场景 D: 自动续签 - 无终止日期**
- **输入:** 自动续签合同, `end_date`='2025-01-31' (无意义), `termination_date`=None.
- **期望输出:** `{"contract_type": "auto_renewing", "effective_end_date": null}`.

**场景 E: 自动续签 - 首月内终止**
- **输入:** 自动续签合同, `end_date`='2025-01-31', `termination_date`='2025-01-20'.
- **期望输出:** `{"contract_type": "auto_renewing", "effective_end_date": "2025-01-20"}` (忽略 `end_date`).

**场景 F: 自动续签 - 后续月份终止**
- **输入:** 自动续签合同, `end_date`='2025-01-31', `termination_date`='2025-03-10'.
- **期望输出:** `{"contract_type": "auto_renewing", "effective_end_date": "2025-03-10"}` (忽略 `end_date`).

**实际输出 & 测试结果:** [待填充]

---

### 测试用例: 003 - 前端逻辑 (自动续签，无终止)

**测试目的:** 验证对于无限期合同，费率框始终为0且只读。
**涉及模块/文件:** 前端替班组件
**输入:** 1. API返回 `{"contract_type": "auto_renewing", "effective_end_date": null}`. 2. 用户输入任意替班结束日期。
**期望输出:** “管理费率”输入框始终为0且只读。
**实际输出 & 测试结果:** [待填充]

---

### 测试用例: 004 - 前端逻辑 (有明确结束日期的合同)

**测试目的:** 验证对于有明确 `effective_end_date` 的合同，前端逻辑正确。
**涉及模块/文件:** 前端替班组件
**输入:** 1. API返回 `{"effective_end_date": "2025-11-30"}`. 2. 用户选择替班结束日期为 `2025-12-01` (超期) / `2025-11-29` (未超期)。
**期望输出:** 超期时，费率框默认为10%且可编辑。未超期时，为0且只读。
**实际输出 & 测试结果:** [待填充]

---

### 测试用例: 005 - 后端计费 (自动续签，终止后替班)

**测试目的:** 验证自动续签合同在终止后发生替班，能正确应用管理费。
**涉及模块/文件:** `backend/services/billing_engine.py`
**输入:** - 合同: 自动续签, `termination_date`='2025-03-10'. - 替班记录: `end_date`='2025-03-15', `substitute_management_fee_rate`=0.1.
**期望输出:** `management_fee` 基于 10% 计算。
**实际输出 & 测试结果:** [待填充]

---

### 测试用例: 006 - 后端计费 (自动续签，终止前替班)

**测试目的:** 验证自动续签合同在终止前发生替班，管理费为0。
**涉及模块/文件:** `backend/services/billing_engine.py`
**输入:** - 合同: 自动续签, `termination_date`='2025-03-10'. - 替班记录: `end_date`='2025-03-05', `substitute_management_fee_rate`=0.
**期望输出:** `management_fee` 为 0。
**实际输出 & 测试结果:** [待填充]

---

### 测试用例: 007 - 后端计费 (非自动续签，终止后替班)

**测试目的:** 验证非自动续签合同在有效结束后替班，能正确应用管理费。
**涉及模块/文件:** `backend/services/billing_engine.py`
**输入:** - 合同: 非自动续签, `end_date`='2025-11-30', `termination_date`='2025-12-15'. (有效结束日 `2025-12-15`) - 替班记录: `end_date`='2025-12-20', `substitute_management_fee_rate`=0.1.
**期望输出:** `management_fee` 基于 10% 计算。
**实际输出 & 测试结果:** [待填充]

---
