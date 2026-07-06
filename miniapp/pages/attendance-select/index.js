const api = require('../../utils/api');
const { formatDate } = require('../../utils/format');

function statusMeta(status) {
  if (status === 'synced') return { text: '已归档', className: 'synced', buttonText: '查看考勤' };
  if (status === 'customer_signed') return { text: '已签署', className: 'signed', buttonText: '查看考勤' };
  if (status === 'employee_confirmed') return { text: '待客户确认', className: 'confirmed', buttonText: '修改考勤' };
  return { text: '待填写', className: 'draft', buttonText: '填写考勤' };
}

function normalizeForm(item = {}) {
  const meta = statusMeta(item.status);
  return {
    ...item,
    status_text: meta.text,
    status_class: meta.className,
    button_text: meta.buttonText,
    cycle_start_date_text: formatDate(item.attendance_start_date || item.cycle_start_date),
    cycle_end_date_text: formatDate(item.attendance_end_date || item.cycle_end_date),
    date_range: `${formatDate(item.attendance_start_date || item.cycle_start_date)} - ${formatDate(item.attendance_end_date || item.cycle_end_date)}`
  };
}

function currentMonth() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1
  };
}

Page({
  data: {
    year: null,
    month: null,
    monthText: '',
    forms: [],
    loaded: false
  },

  onLoad(options) {
    const fallback = currentMonth();
    const year = Number(options.year) || fallback.year;
    const month = Number(options.month) || fallback.month;
    this.setData({
      year,
      month,
      monthText: `${year}年${month}月`
    });
    this.loadForms();
  },

  onPullDownRefresh() {
    this.loadForms().finally(() => wx.stopPullDownRefresh());
  },

  async loadForms() {
    wx.showLoading({ title: '加载中' });
    try {
      const result = await api.employeeAttendanceList({
        year: this.data.year,
        month: this.data.month
      });
      const forms = (result.attendance_forms || []).map(normalizeForm);
      this.setData({
        forms,
        loaded: true
      });
    } catch (error) {
      this.setData({ loaded: true });
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goFill(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/attendance-fill/index?id=${id}` });
  }
});
