const api = require('../../utils/api');
const { contractView, formatDate } = require('../../utils/format');

function attendanceStatusText(status) {
  const labels = {
    draft: '待填写',
    employee_confirmed: '未签署',
    customer_signed: '已签署',
    synced: '已归档'
  };
  return labels[status] || status || '考勤';
}

function attendanceBadge(form = {}) {
  if (form.status === 'employee_confirmed') {
    return { text: '未签署', className: 'danger' };
  }
  if (['customer_signed', 'synced'].includes(form.status)) {
    return { text: form.status === 'synced' ? '已归档' : '已签署', className: 'signed' };
  }
  return { text: attendanceStatusText(form.status), className: 'pending' };
}

function attendanceStatText(stats = {}, key, fallback = '0') {
  return stats[key] || fallback;
}

function normalizeAttendanceForm(item = {}) {
  const badge = attendanceBadge(item);
  const stats = item.stats || {};
  return {
    ...item,
    status_text: attendanceStatusText(item.status),
    status_badge_text: badge.text,
    status_class: badge.className,
    date_range: `${formatDate(item.cycle_start_date)} - ${formatDate(item.cycle_end_date)}`,
    work_days_text: attendanceStatText(stats, 'work_days_text'),
    overtime_text: attendanceStatText(stats, 'overtime_text'),
    leave_days_text: attendanceStatText(stats, 'leave_days_text')
  };
}

Page({
  data: {
    id: '',
    role: 'customer',
    contract: {},
    attendanceForms: [],
    loaded: false
  },

  onLoad(options) {
    this.setData({
      id: options.id || '',
      role: options.role || getApp().globalData.role || wx.getStorageSync('miniapp_role') || 'customer'
    });
    this.loadAttendance();
  },

  onPullDownRefresh() {
    this.loadAttendance().finally(() => wx.stopPullDownRefresh());
  },

  async loadAttendance() {
    if (!this.data.id) {
      this.setData({ loaded: true });
      wx.showToast({ title: '缺少合同ID', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加载中' });
    try {
      const result = this.data.role === 'employee'
        ? await api.employeeContractDetail(this.data.id)
        : await api.contractDetail(this.data.id);
      const contract = contractView(result.contract || {});
      const attendanceForms = (contract.attendance_forms || [])
        .filter((item) => ['employee_confirmed', 'customer_signed', 'synced'].includes(item.status))
        .map(normalizeAttendanceForm);
      this.setData({
        contract,
        attendanceForms,
        loaded: true
      });
    } catch (error) {
      this.setData({ loaded: true });
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goAttendanceSign(event) {
    const token = event.currentTarget.dataset.token;
    if (token) wx.navigateTo({ url: `/pages/attendance-sign/index?token=${token}` });
  }
});
