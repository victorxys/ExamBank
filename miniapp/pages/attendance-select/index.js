const api = require('../../utils/api');
const { formatDate } = require('../../utils/format');

function statusMeta(status) {
  if (status === 'synced') return { text: '已归档', className: 'synced', buttonText: '查看考勤' };
  if (status === 'customer_signed') return { text: '已签署', className: 'signed', buttonText: '查看考勤' };
  if (status === 'employee_confirmed') return { text: '待客户确认', className: 'confirmed', buttonText: '修改考勤' };
  if (status === 'need_onboarding_date') return { text: '待确认上户', className: 'draft', buttonText: '确认上户日期' };
  return { text: '待填写', className: 'draft', buttonText: '填写考勤' };
}

function normalizeForm(item = {}, index = 0) {
  const meta = statusMeta(item.status);
  const isMaternity = Boolean(item.is_maternity || item.attendance_cycle_type === 'maternity_26d');
  const start = item.attendance_start_date || item.cycle_start_date;
  const end = item.attendance_end_date || item.cycle_end_date;
  return {
    ...item,
    list_key: item.id || `${item.contract_id || 'c'}_${start || index}`,
    is_maternity: isMaternity,
    status_text: meta.text,
    status_class: meta.className,
    button_text: meta.buttonText,
    period_label: isMaternity ? '考勤周期' : '服务期间',
    cycle_start_date_text: formatDate(start),
    cycle_end_date_text: formatDate(end),
    date_range: `${formatDate(start)} - ${formatDate(end)}`,
    needs_onboarding_date: Boolean(item.needs_onboarding_date || item.status === 'need_onboarding_date')
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
      const forms = (result.attendance_forms || []).map((item, index) => normalizeForm(item, index));
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
    const {
      id,
      contractId,
      cycleStart,
      year,
      month,
      needsOnboarding,
      employeeId
    } = event.currentTarget.dataset;
    const app = getApp();
    const resolvedEmployeeId = employeeId
      || (app.globalData.employee && app.globalData.employee.id)
      || wx.getStorageSync('miniapp_employee_id')
      || '';

    // 无上户日或无 form id：用员工 ID + contractId 进入填报页（触发上户引导或 by-token 创建）
    if (needsOnboarding === true || needsOnboarding === 'true' || !id) {
      const token = resolvedEmployeeId;
      if (!token && !contractId) {
        wx.showToast({ title: '缺少员工信息', icon: 'none' });
        return;
      }
      const query = [
        token ? `employee_token=${encodeURIComponent(token)}` : '',
        year ? `year=${year}` : '',
        month ? `month=${month}` : '',
        contractId ? `contractId=${encodeURIComponent(contractId)}` : '',
        cycleStart ? `cycleStart=${encodeURIComponent(cycleStart)}` : ''
      ].filter(Boolean).join('&');
      wx.navigateTo({
        url: `/pages/attendance-fill/index?id=${encodeURIComponent(token || '')}${query ? `&${query}` : ''}`
      });
      return;
    }

    const parts = [
      `id=${id}`,
      contractId ? `contractId=${encodeURIComponent(contractId)}` : '',
      cycleStart ? `cycleStart=${encodeURIComponent(cycleStart)}` : '',
      year ? `year=${year}` : '',
      month ? `month=${month}` : '',
      resolvedEmployeeId ? `employee_token=${encodeURIComponent(resolvedEmployeeId)}` : ''
    ].filter(Boolean);
    wx.navigateTo({ url: `/pages/attendance-fill/index?${parts.join('&')}` });
  }
});
