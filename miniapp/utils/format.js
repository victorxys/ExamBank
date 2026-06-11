function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const statusText = {
  active: '正在履约',
  pending: '待上户',
  trial_active: '试工中',
  finished: '已完成',
  completed: '已完成',
  terminated: '已终止',
  trial_succeeded: '试工成功'
};

const signingStatusText = {
  UNSIGNED: '待签署',
  CUSTOMER_SIGNED: '客户已签',
  EMPLOYEE_SIGNED: '待客户签署',
  SIGNED: '已签署',
  NOT_REQUIRED: '无需签署'
};

function contractView(contract) {
  const api = require('./api');
  const customerSignature = contract.customer_signature_url || contract.customer_signature || '';
  const employeeSignature = contract.employee_signature_url || contract.employee_signature || '';
  const statusTextValue = contract.is_monthly_auto_renew && contract.status === 'active'
    ? '自动月签'
    : (statusText[contract.status] || contract.status || '合同');
  return {
    ...contract,
    date_range: `${formatDate(contract.start_date)} - ${formatDate(contract.end_date)}`,
    status_text: statusTextValue,
    signing_status_text: signingStatusText[contract.signing_status] || contract.signing_status || '签署状态',
    customer_signature_image: api.assetUrl(customerSignature),
    employee_signature_image: api.assetUrl(employeeSignature)
  };
}

function attendanceStats(formData = {}) {
  const rest = Array.isArray(formData.rest_records) ? formData.rest_records : [];
  const leave = Array.isArray(formData.leave_records) ? formData.leave_records : [];
  const paidLeave = Array.isArray(formData.paid_leave_records) ? formData.paid_leave_records : [];
  const overtime = Array.isArray(formData.overtime_records) ? formData.overtime_records : [];
  const workDays = Number(formData.work_days || formData.attendance_days || formData.service_days || 0) || Math.max(0, 30 - rest.length - leave.length);
  const records = [
    ...rest.map((item) => ({ ...item, label: '休息' })),
    ...leave.map((item) => ({ ...item, label: '请假' })),
    ...paidLeave.map((item) => ({ ...item, label: '带薪假' })),
    ...overtime.map((item) => ({ ...item, label: '加班' }))
  ].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  return {
    workDays,
    restCount: rest.length,
    leaveCount: leave.length + paidLeave.length,
    overtimeCount: overtime.length,
    records
  };
}

module.exports = {
  formatDate,
  statusText,
  signingStatusText,
  contractView,
  attendanceStats
};
