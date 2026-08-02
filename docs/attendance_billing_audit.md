# 历史考勤与账单一致性审计

## 用途

`scripts/audit_attendance_billing_consistency.py` 用于检查历史客户账单中的加班天数是否与已签考勤表、`AttendanceRecord` 和员工工资单一致，并可在确认后重新同步不一致数据。

脚本以历史客户账单为扫描入口，默认检查当前年份 1 月 1 日至执行当天。加班天数按每张账单自己的起止日期计算，不会把合同开始前或合同结束后的考勤计入首月、末月账单。

默认只展开需要处理的账单。每条记录包含：

- 账单 ID 和账单周期；
- 考勤表在该账单周期内的普通/自动加班和法定节假日加班；
- `AttendanceRecord`、客户账单、员工工资单当前加班天数；
- 可在终端直接点击的完整账单和考勤链接。

## 生产环境准备

进入项目目录并确认代码已经更新：

```bash
cd /path/to/examdb
git pull origin fix/billing-management-fee-receivables
```

以下命令直接使用项目虚拟环境，无需单独执行 `source`：

```bash
venv/bin/python scripts/audit_attendance_billing_consistency.py --help
```

## 全量只读检查

从 2026 年 1 月开始检查到执行当天：

```bash
venv/bin/python scripts/audit_attendance_billing_consistency.py \
  --dry-run \
  --from-date 2026-01-01 \
  --include-renewals \
  --host https://hr.mengyimengsao.com
```

`--dry-run` 不修改数据库。生产执行前必须先保存并检查这份输出。

如需展开缺少已签考勤表、数据一致账单和法定节假日待人工确认清单，增加：

```bash
--verbose
```

## 检查指定合同

```bash
venv/bin/python scripts/audit_attendance_billing_consistency.py \
  --dry-run \
  --from-date 2026-01-01 \
  --contract-id <合同ID> \
  --include-renewals \
  --host https://hr.mengyimengsao.com
```

建议优先用指定合同方式验证个别问题，再执行全量修复。

## 修复指定合同

确认 `--dry-run` 输出中的账单周期和考勤数据无误后执行：

```bash
venv/bin/python scripts/audit_attendance_billing_consistency.py \
  --apply \
  --from-date 2026-01-01 \
  --contract-id <合同ID> \
  --include-renewals \
  --host https://hr.mengyimengsao.com
```

脚本会重新同步：

1. 已签考勤表；
2. 对应账单周期的 `AttendanceRecord`；
3. 客户账单；
4. 员工工资单。

每张处理完成后会输出修复前后的数值，例如：

```text
加班修复: AttendanceRecord 4 -> 5 天, 客户账单 4 -> 5 天, 员工工资单 4 -> 5 天
```

## 全量修复

全量 `--dry-run` 检查完成后执行：

```bash
venv/bin/python scripts/audit_attendance_billing_consistency.py \
  --apply \
  --from-date 2026-01-01 \
  --include-renewals \
  --host https://hr.mengyimengsao.com
```

完成后必须再次运行相同范围的 `--dry-run` 命令进行复核。

## 参数说明

- `--dry-run`：只检查，不修改数据；未指定 `--apply` 时也默认为只读模式。
- `--apply`：更新考勤记录并重新计算客户账单和员工工资单。
- `--from-date YYYY-MM-DD`：账单月份扫描起点，默认当前年份 1 月 1 日。
- `--to-date YYYY-MM-DD`：账单月份扫描终点，默认执行当天。
- `--contract-id UUID`：只处理指定合同。
- `--include-renewals`：包含续签关联合同；不指定时只汇总并跳过续签相关账单。
- `--include-employee-confirmed`：同时检查尚未由客户签署的员工已提交考勤；生产修复通常不需要。
- `--verbose`：展开缺表、一致账单和法定节假日待确认清单。
- `--host URL`：生成终端可点击链接所使用的前端地址。

## 输出与退出码

- `需要处理`：考勤表、考勤记录、客户账单或员工工资单存在数值差异，或考勤需要规范化。
- `缺少对应已签考勤表`：账单存在，但当前没有可用于比较的已签考勤表；只做汇总，不由脚本自动修复。
- `需要人工确认是否漏填法定加班`：服务期覆盖法定节假日，但考勤表中没有对应加班或休假记录。
- `处理后仍不一致`：同步或账单重算后仍有差异，脚本最终返回非零退出码。
- `APPLY 完成，成功 N 张，仍不一致 0 张`：本次修复完成。

如果退出码非零，不要反复执行 `--apply`。应先根据输出的账单 ID、完整链接和前后数值定位剩余问题。

## 兼容入口

旧入口 `scripts/fix_june_holiday_overtime_billing.py` 仍可使用，但它现在执行的是同一套跨月份历史账单审计逻辑。生产环境统一使用：

```text
scripts/audit_attendance_billing_consistency.py
```
