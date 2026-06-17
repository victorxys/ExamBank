const api = require('../../utils/api');
const { contractView } = require('../../utils/format');
const { normalizeAttendanceCard } = require('../../utils/attendance-summary');

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
      const rawAttendanceForms = (contract.attendance_forms || [])
        .filter((item) => ['employee_confirmed', 'customer_signed', 'synced'].includes(item.status));
      const holidays = await this.loadAttendanceHolidays(rawAttendanceForms);
      const attendanceForms = rawAttendanceForms
        .map((item) => normalizeAttendanceCard(item, holidays[item.actual_year || item.year] || {}));
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

  async loadAttendanceHolidays(forms = []) {
    const years = Array.from(new Set(forms.map((item) => item.actual_year || item.year).filter(Boolean)));
    const entries = await Promise.all(years.map(async (year) => {
      try {
        const result = await api.holidays(year);
        return [year, result.holidays || {}];
      } catch (error) {
        return [year, {}];
      }
    }));
    return entries.reduce((acc, item) => {
      acc[item[0]] = item[1];
      return acc;
    }, {});
  },

  goAttendanceSign(event) {
    const token = event.currentTarget.dataset.token;
    if (token) wx.navigateTo({ url: `/pages/attendance-sign/index?token=${token}` });
  }
});
