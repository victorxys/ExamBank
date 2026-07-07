const api = require('../../utils/api');
const { formatDate } = require('../../utils/format');

function optionValue(options, index) {
  const option = options[Number(index || 0)] || {};
  return option.value || '';
}

function moneyText(value) {
  const number = Number(value || 0);
  if (Number.isNaN(number)) return value || '0.00';
  return number.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function compactDate(value) {
  const text = formatDate(value);
  if (!text || text === '-') return '-';
  return text.slice(5);
}

function badgeClass(status) {
  if (status === 'active') return 'active';
  if (status === 'finished' || status === 'completed' || status === 'trial_succeeded') return 'done';
  if (status === 'terminated') return 'muted';
  return 'pending';
}

function paymentClass(status) {
  if (status === 'paid' || status === 'overpaid') return 'done';
  if (status === 'partially_paid') return 'partial';
  return 'pending';
}

function normalizeItem(item = {}) {
  const customerDue = Number(item.customer_total_due || 0);
  const employeeDue = Number(item.employee_total_due || 0);
  const grossMargin = Number(item.gross_margin || (customerDue - employeeDue));
  return {
    ...item,
    customer_total_due_text: moneyText(customerDue),
    employee_total_due_text: moneyText(employeeDue),
    gross_margin_text: moneyText(grossMargin),
    gross_margin_positive: grossMargin >= 0,
    employee_level_text: item.employee_level ? `¥${moneyText(item.employee_level)}` : '-',
    service_range_text: `${compactDate(item.cycle_start_date)} ~ ${compactDate(item.cycle_end_date)}`,
    contract_range_text: `${formatDate(item.contract_start_date)} ~ ${formatDate(item.contract_end_date)}`,
    status_badge_class: badgeClass(item.status),
    payment_badge_class: paymentClass(item.customer_payment_status),
    payout_badge_class: paymentClass(item.employee_payout_status)
  };
}

function currentMonthValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

Page({
  data: {
    keyword: '',
    billingMonth: currentMonthValue(),
    typeIndex: 0,
    statusIndex: 0,
    paymentStatusIndex: 0,
    payoutStatusIndex: 0,
    typeOptions: [
      { value: '', label: '全部类型' },
      { value: 'nanny', label: '育儿嫂' },
      { value: 'maternity_nurse', label: '月嫂' },
      { value: 'nanny_trial', label: '试工' },
      { value: 'external_substitution', label: '外部替班' }
    ],
    statusOptions: [
      { value: '', label: '全部状态' },
      { value: 'active', label: '正在履约' },
      { value: 'pending', label: '待上户' },
      { value: 'trial_active', label: '试工中' },
      { value: 'finished', label: '已完成' },
      { value: 'terminated', label: '已终止' },
      { value: 'trial_succeeded', label: '试工成功' }
    ],
    paymentStatusOptions: [
      { value: '', label: '客户付款' },
      { value: 'unpaid', label: '未支付' },
      { value: 'partially_paid', label: '部分支付' },
      { value: 'paid', label: '已支付' },
      { value: 'overpaid', label: '超额支付' }
    ],
    payoutStatusOptions: [
      { value: '', label: '员工领取' },
      { value: 'unpaid', label: '未发放' },
      { value: 'partially_paid', label: '部分发放' },
      { value: 'paid', label: '已发放' }
    ],
    payrolls: [],
    page: 1,
    perPage: 10,
    total: 0,
    hasMore: true,
    loading: false,
    loaded: false
  },

  onLoad() {
    if (!this.ensureStaffAccess()) return;
    this.search(true);
  },

  ensureStaffAccess() {
    const role = getApp().globalData.role || wx.getStorageSync('miniapp_role');
    const staffUser = getApp().globalData.staffUser || wx.getStorageSync('miniapp_staff_user');
    if (role === 'staff' && staffUser) return true;
    wx.showToast({ title: '仅后台人员可查看账单', icon: 'none' });
    wx.redirectTo({ url: '/pages/login/index?force_bind=1' });
    return false;
  },

  onPullDownRefresh() {
    if (!this.ensureStaffAccess()) {
      wx.stopPullDownRefresh();
      return;
    }
    this.search(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.loading && this.data.hasMore) this.search(false);
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  onSearchConfirm() {
    this.search(true);
  },

  clearKeyword() {
    this.setData({ keyword: '' });
    this.search(true);
  },

  onTypeChange(event) {
    this.setData({ typeIndex: Number(event.detail.value || 0) });
    this.search(true);
  },

  onStatusChange(event) {
    this.setData({ statusIndex: Number(event.detail.value || 0) });
    this.search(true);
  },

  onPaymentStatusChange(event) {
    this.setData({ paymentStatusIndex: Number(event.detail.value || 0) });
    this.search(true);
  },

  onPayoutStatusChange(event) {
    this.setData({ payoutStatusIndex: Number(event.detail.value || 0) });
    this.search(true);
  },

  onMonthChange(event) {
    this.setData({ billingMonth: event.detail.value });
    this.search(true);
  },

  resetFilters() {
    this.setData({
      keyword: '',
      billingMonth: currentMonthValue(),
      typeIndex: 0,
      statusIndex: 0,
      paymentStatusIndex: 0,
      payoutStatusIndex: 0
    });
    this.search(true);
  },

  async search(reset = true) {
    const page = reset ? 1 : this.data.page + 1;
    const [year, month] = String(this.data.billingMonth || '').split('-');
    this.setData({ loading: true });
    if (reset) wx.showLoading({ title: '加载账单' });
    try {
      const result = await api.staffPayrollList({
        search: this.data.keyword,
        type: optionValue(this.data.typeOptions, this.data.typeIndex),
        status: optionValue(this.data.statusOptions, this.data.statusIndex),
        payment_status: optionValue(this.data.paymentStatusOptions, this.data.paymentStatusIndex),
        payout_status: optionValue(this.data.payoutStatusOptions, this.data.payoutStatusIndex),
        year,
        month,
        page,
        per_page: this.data.perPage
      });
      const nextItems = (result.payrolls || []).map(normalizeItem);
      const payrolls = reset ? nextItems : this.data.payrolls.concat(nextItems);
      this.setData({
        payrolls,
        page,
        total: result.total || 0,
        hasMore: payrolls.length < (result.total || 0),
        loaded: true
      });
    } catch (error) {
      this.setData({ loaded: true });
      wx.showToast({ title: error.message || '账单加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      if (reset) wx.hideLoading();
    }
  },

  goDetail(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.payrolls.find((payroll) => payroll.id === id);
    if (!item) return;
    const params = [
      `payrollId=${encodeURIComponent(item.payroll_id || item.id)}`,
      `contractId=${encodeURIComponent(item.contract_id)}`,
      `year=${encodeURIComponent(item.year)}`,
      `month=${encodeURIComponent(item.month)}`,
      'source=staff'
    ];
    if (item.customer_share_token) {
      params.unshift(`shareToken=${encodeURIComponent(item.customer_share_token)}`);
    }
    wx.navigateTo({ url: `/pages/payroll-due/index?${params.join('&')}` });
  }
});
