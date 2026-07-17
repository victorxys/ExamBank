/**
 * 方案 A：月嫂/育儿嫂「级别」展示语义（不改存储）
 *
 * 存储约定：
 * - employee_level: 月嫂=月薪(纯劳务)；育儿嫂=级别/月薪
 * - security_deposit_paid: 月嫂=业务级别总价(=月薪+管理费=客交保证金)
 *
 * 业务展示：
 * - 月嫂 级别 = security_deposit_paid / package_level
 * - 月嫂 月薪 = employee_level / salary_amount
 * - 育儿嫂 级别/月薪 = employee_level
 */

export function isMaternityContract(contractOrType) {
  if (!contractOrType) return false;
  if (typeof contractOrType === 'string') {
    return contractOrType === 'maternity_nurse';
  }
  const type =
    contractOrType.contract_type_value ||
    contractOrType.contract_type ||
    contractOrType.type;
  return type === 'maternity_nurse' || contractOrType.is_maternity_level_semantics === true;
}

/** 业务「级别」展示值：月嫂取保证金总价，其它取 employee_level */
export function getPackageLevel(contractOrBill) {
  if (!contractOrBill) return 0;
  if (contractOrBill.level_display != null && contractOrBill.level_display !== '') {
    return contractOrBill.level_display;
  }
  if (contractOrBill.package_level != null && contractOrBill.package_level !== '') {
    return contractOrBill.package_level;
  }
  if (isMaternityContract(contractOrBill)) {
    return (
      contractOrBill.security_deposit_paid ??
      contractOrBill.customer_deposit ??
      contractOrBill.employee_level ??
      0
    );
  }
  return contractOrBill.employee_level ?? 0;
}

/** 月薪/劳务报酬：一律对应存储的 employee_level（月嫂/育儿嫂） */
export function getSalaryAmount(contractOrBill) {
  if (!contractOrBill) return 0;
  if (contractOrBill.salary_amount != null && contractOrBill.salary_amount !== '') {
    return contractOrBill.salary_amount;
  }
  return contractOrBill.employee_level ?? 0;
}

export function getLevelDisplayLabel(contractOrBill) {
  if (contractOrBill?.level_display_label) return contractOrBill.level_display_label;
  return isMaternityContract(contractOrBill) ? '级别(总价/含管理费)' : '级别/月薪';
}

export function getSalaryLabel(contractOrBill) {
  if (contractOrBill?.salary_label) return contractOrBill.salary_label;
  return isMaternityContract(contractOrBill) ? '月薪/劳务报酬' : '级别/月薪';
}

/** 表单里 employee_level 字段的 label */
export function getEmployeeLevelFieldLabel(contractType) {
  return isMaternityContract(contractType) ? '月薪/劳务报酬 (元/月)' : '级别 (月薪/元)';
}

/** 表单里 security_deposit 字段的 label（月嫂） */
export function getMaternityDepositFieldLabel() {
  return '级别/客交保证金 (元)';
}

export function getMaternityDepositHelperText() {
  return '业务级别 = 客交保证金 = 月薪 + 管理费';
}
