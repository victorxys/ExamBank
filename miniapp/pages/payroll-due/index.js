const api = require('../../utils/api');
const { formatDate } = require('../../utils/format');

function moneyText(value) {
  const number = Number(value || 0);
  if (Number.isNaN(number)) return value || '0.00';
  return number.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function roundedMoneyWithCentsText(value) {
  const number = Number(value || 0);
  if (Number.isNaN(number)) return value || '0.00';
  return Math.round(number).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function compactMoneyText(value) {
  const number = Number(value || 0);
  if (Number.isNaN(number)) return value || '0';
  if (Math.abs(number - Math.round(number)) < 0.001) return String(Math.round(number));
  return number.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function roundedMoneyText(value) {
  const number = Number(value || 0);
  if (Number.isNaN(number)) return value || '0';
  return roundedMoneyWithCentsText(number);
}

function daysText(value) {
  const text = String(value || '0');
  return text.endsWith('天') ? text : `${text}天`;
}

function buildView(payroll = {}) {
  const cycleStart = formatDate(payroll.cycle_start_date);
  const cycleEnd = formatDate(payroll.cycle_end_date);
  const employeeBank = {
    ...(payroll.employee_bank || {}),
    holder_name: (payroll.employee_bank || {}).holder_name || payroll.employee_name || ''
  };
  const estimated = Boolean(payroll.estimated);
  return {
    ...payroll,
    estimated,
    customer_status_text: estimated ? '预估金额' : payroll.customer_status_text,
    amount_due_text: estimated ? roundedMoneyWithCentsText(payroll.amount_due) : moneyText(payroll.amount_due),
    calculated_amount_text: moneyText(payroll.calculated_amount || payroll.amount_due),
    rounded_calculated_amount_text: roundedMoneyText(payroll.calculated_amount || payroll.amount_due),
    base_salary_text: compactMoneyText(payroll.base_salary),
    salary_days_text: payroll.salary_days || '26',
    work_days_text: payroll.work_days || '0',
    overtime_days_text: payroll.overtime_days || '0',
    leave_days_text: payroll.leave_days || '0',
    work_days_label: daysText(payroll.work_days),
    overtime_days_label: daysText(payroll.overtime_days),
    leave_days_label: daysText(payroll.leave_days),
    cycle_range_text: `${cycleStart} - ${cycleEnd}`,
    attendance_link_text: payroll.attendance_signature_token ? '查看考勤表' : '暂无考勤表',
    employee_bank: employeeBank
  };
}

Page({
  data: {
    payrollId: '',
    contractId: '',
    shareToken: '',
    year: '',
    month: '',
    payroll: null,
    loaded: false,
    loadError: ''
  },

  onLoad(options) {
    this.setData({
      payrollId: options.payrollId || options.payroll_id || '',
      contractId: options.contractId || options.contract_id || '',
      shareToken: options.shareToken || options.share_token || '',
      year: options.year || '',
      month: options.month || ''
    });
    this.loadPayroll();
  },

  onPullDownRefresh() {
    this.loadPayroll().finally(() => wx.stopPullDownRefresh());
  },

  async loadPayroll() {
    wx.showLoading({ title: '加载中' });
    try {
      await api.ensureOpenid();
      const result = await api.customerPayrollCurrent({
        payroll_id: this.data.payrollId,
        contract_id: this.data.contractId,
        share_token: this.data.shareToken,
        year: this.data.year,
        month: this.data.month
      });
      this.setData({
        payroll: result.payroll ? buildView(result.payroll) : null,
        loaded: true,
        loadError: ''
      });
    } catch (error) {
      this.setData({
        payroll: null,
        loaded: true,
        loadError: error.message || '工资单加载失败'
      });
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goAttendance() {
    const token = this.data.payroll && this.data.payroll.attendance_signature_token;
    if (!token) {
      wx.showToast({ title: '暂无可查看的考勤表', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/attendance-sign/index?token=${token}` });
  },

  copyBankField(event) {
    const field = event.currentTarget.dataset.field;
    const bank = (this.data.payroll && this.data.payroll.employee_bank) || {};
    const text = bank[field] || '';
    if (!text) {
      wx.showToast({ title: '暂无可复制内容', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },

  confirmPayroll() {
    if (!this.data.payroll) return;
    if (this.data.payroll.readonly) {
      wx.showToast({ title: '运营查看模式，不能代客户确认', icon: 'none' });
      return;
    }
    if (this.data.payroll.customer_confirmed) {
      wx.showToast({ title: '已确认', icon: 'success' });
      return;
    }
    wx.showModal({
      title: '确认应付劳务费',
      content: '请在付款前核对金额、员工姓名与银行卡号。确认后此工资单将从首页待处理中移除。',
      confirmText: '我已确认',
      confirmColor: '#4f46e5',
      success: async (res) => {
        if (res.confirm) {
          try {
            wx.showLoading({ title: '确认中' });
            const result = await api.confirmCustomerPayroll(this.data.payroll.id);
            this.setData({
              payroll: result.payroll ? buildView(result.payroll) : this.data.payroll
            });
            wx.showToast({ title: '已确认', icon: 'success' });
          } catch (error) {
            wx.showToast({ title: error.message || '确认失败', icon: 'none' });
          } finally {
            wx.hideLoading();
          }
        }
      }
    });
  },

  onShareAppMessage() {
    const payroll = this.data.payroll || {};
    const shareToken = payroll.customer_share_token || this.data.shareToken;
    const params = [];
    const payrollId = payroll.id || this.data.payrollId;
    const contractId = payroll.contract_id || this.data.contractId;
    const year = payroll.year || this.data.year;
    const month = payroll.month || this.data.month;
    if (shareToken) params.push(`shareToken=${encodeURIComponent(shareToken)}`);
    if (payrollId) params.push(`payrollId=${encodeURIComponent(payrollId)}`);
    if (contractId) params.push(`contractId=${encodeURIComponent(contractId)}`);
    if (year) params.push(`year=${encodeURIComponent(year)}`);
    if (month) params.push(`month=${encodeURIComponent(month)}`);
    const path = `/pages/payroll-due/index${params.length ? `?${params.join('&')}` : ''}`;
    return {
      title: `${payroll.customer_name || '客户'}${payroll.year || ''}年${payroll.month || ''}月应付劳务费`,
      path
    };
  }
});
