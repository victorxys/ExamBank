const api = require('../../utils/api');
const { contractView, formatDate } = require('../../utils/format');

Page({
  data: {
    contractId: '',
    contract: {},
    form: {
      exit_date: '',
      learned: '',
      improved: ''
    },
    loading: false,
    submitted: false
  },

  onLoad(options) {
    this.setData({ contractId: options.contractId || options.id || '' });
    this.loadSummary();
  },

  async loadSummary() {
    if (!this.data.contractId) {
      wx.showToast({ title: '缺少合同ID', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加载中' });
    try {
      const result = await api.employeeExitSummary(this.data.contractId);
      const summary = result.summary || null;
      const data = summary ? summary.data || {} : {};
      const contract = contractView(result.contract || {});
      this.setData({
        contract,
        form: {
          exit_date: summary ? (summary.exit_date || '') : formatDate(contract.end_date),
          learned: summary ? (summary.learned || data.field_23 || '') : '',
          improved: summary ? (summary.improved || data.field_22 || '') : ''
        },
        submitted: Boolean(summary)
      });
    } catch (error) {
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  onDateChange(event) {
    this.setData({ 'form.exit_date': event.detail.value });
  },

  async submit() {
    const form = this.data.form;
    if (!form.learned && !form.improved) {
      wx.showToast({ title: '请填写总结内容', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      const result = await api.submitEmployeeExitSummary(this.data.contractId, {
        exit_date: form.exit_date,
        learned: form.learned,
        improved: form.improved
      });
      const summary = result.summary || {};
      this.setData({
        submitted: true,
        form: {
          exit_date: summary.exit_date || form.exit_date,
          learned: summary.learned || form.learned,
          improved: summary.improved || form.improved
        }
      });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
