const api = require('../../utils/api');
const { contractView } = require('../../utils/format');

function optionValue(options, index) {
  const option = options[Number(index || 0)] || {};
  return option.value || '';
}

function canShareCustomer(contract = {}) {
  return Boolean(contract.customer_signing_token)
    && ['UNSIGNED', 'EMPLOYEE_SIGNED'].includes(contract.signing_status);
}

function canShareEmployee(contract = {}) {
  return Boolean(contract.employee_signing_token)
    && ['UNSIGNED', 'CUSTOMER_SIGNED'].includes(contract.signing_status);
}

function shareTitle(contract = {}) {
  return `请签署${contract.type_label || '服务合同'} - ${contract.customer_name || '客户'}`;
}

function signingBadgeClass(contract = {}) {
  if (contract.signing_status === 'SIGNED' || contract.signing_status === 'NOT_REQUIRED') return 'done';
  if (contract.signing_status === 'CUSTOMER_SIGNED' || contract.signing_status === 'EMPLOYEE_SIGNED') return 'partial';
  return 'pending';
}

function normalizeStats(stats = {}) {
  return {
    all: Number(stats.all || 0),
    customerPending: Number(stats.customerPending || 0),
    employeePending: Number(stats.employeePending || 0),
    expiring: Number(stats.expiring || 0)
  };
}

function contractIconText(contract = {}) {
  const map = {
    nanny: '育',
    maternity_nurse: '月',
    nanny_trial: '试',
    external_substitution: '外'
  };
  return map[contract.type] || '合';
}

function contractIconTone(contract = {}) {
  const map = {
    nanny: '',
    maternity_nurse: 'orange',
    nanny_trial: 'blue',
    external_substitution: 'purple'
  };
  return map[contract.type] || '';
}

Page({
  data: {
    keyword: '',
    typeIndex: 0,
    signingStatusIndex: 0,
    statusIndex: 0,
    statFilter: '',
    typeOptions: [
      { value: '', label: '全部类型' },
      { value: 'nanny', label: '育儿嫂' },
      { value: 'maternity_nurse', label: '月嫂' },
      { value: 'nanny_trial', label: '试工' },
      { value: 'external_substitution', label: '外部替班' }
    ],
    signingStatusOptions: [
      { value: '', label: '全部签署' },
      { value: 'UNSIGNED', label: '待签署' },
      { value: 'CUSTOMER_SIGNED', label: '客户已签' },
      { value: 'EMPLOYEE_SIGNED', label: '员工已签' },
      { value: 'SIGNED', label: '已签署' },
      { value: 'NOT_REQUIRED', label: '无需签署' }
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
    contracts: [],
    page: 1,
    perPage: 10,
    total: 0,
    hasMore: true,
    loading: false,
    loaded: false,
    stats: {
      all: 0,
      customerPending: 0,
      employeePending: 0,
      expiring: 0
    },
    shareContract: null,
    shareRole: ''
  },

  onLoad() {
    if (!this.ensureStaffAccess()) return;
    this.search(true);
  },

  ensureStaffAccess() {
    const role = getApp().globalData.role || wx.getStorageSync('miniapp_role');
    const staffUser = getApp().globalData.staffUser || wx.getStorageSync('miniapp_staff_user');
    if (role === 'staff' && staffUser) return true;
    wx.showToast({ title: '仅后台人员可查看合同', icon: 'none' });
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
    if (!this.data.loading && this.data.hasMore) {
      this.search(false);
    }
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
    this.setData({ typeIndex: Number(event.detail.value || 0), statFilter: '' });
    this.search(true);
  },

  onSigningStatusChange(event) {
    this.setData({ signingStatusIndex: Number(event.detail.value || 0), statFilter: '' });
    this.search(true);
  },

  onStatusChange(event) {
    this.setData({ statusIndex: Number(event.detail.value || 0), statFilter: '' });
    this.search(true);
  },

  resetFilters() {
    this.setData({
      keyword: '',
      typeIndex: 0,
      signingStatusIndex: 0,
      statusIndex: 0,
      statFilter: ''
    });
    this.search(true);
  },

  selectStat(event) {
    const value = event.currentTarget.dataset.value || '';
    this.setData({
      statFilter: this.data.statFilter === value ? '' : value
    });
    this.search(true);
  },

  async search(reset = true) {
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true });
    if (reset) wx.showLoading({ title: '搜索中' });
    try {
      const result = await api.staffContractList({
        search: this.data.keyword,
        type: optionValue(this.data.typeOptions, this.data.typeIndex),
        signing_status: optionValue(this.data.signingStatusOptions, this.data.signingStatusIndex),
        status: optionValue(this.data.statusOptions, this.data.statusIndex),
        stat_filter: this.data.statFilter,
        page,
        per_page: this.data.perPage
      });
      const nextContracts = (result.contracts || []).map((item) => {
        const contract = contractView(item);
        return {
          ...contract,
          icon_text: contractIconText(contract),
          icon_tone: contractIconTone(contract),
          signing_badge_class: signingBadgeClass(contract),
          can_share_customer: canShareCustomer(contract),
          can_share_employee: canShareEmployee(contract)
        };
      });
      const contracts = reset ? nextContracts : this.data.contracts.concat(nextContracts);
      this.setData({
        contracts,
        page,
        total: result.total || 0,
        stats: normalizeStats(result.stats || {}),
        hasMore: contracts.length < (result.total || 0),
        loaded: true
      });
    } catch (error) {
      this.setData({ loaded: true });
      wx.showToast({ title: error.message || '搜索失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      if (reset) wx.hideLoading();
    }
  },

  goDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/contract-detail/index?id=${id}&role=staff` });
  },

  prepareShare(event) {
    const id = event.currentTarget.dataset.id;
    const role = event.currentTarget.dataset.role;
    const contract = this.data.contracts.find((item) => item.id === id);
    this.setData({
      shareContract: contract || null,
      shareRole: role || ''
    });
  },

  onShareAppMessage(event = {}) {
    if (event.from !== 'button') {
      return {
        title: '萌姨萌嫂合同中心',
        path: '/pages/login/index'
      };
    }
    const dataset = event.target ? (event.target.dataset || {}) : {};
    const contract = dataset.id
      ? (this.data.contracts.find((item) => item.id === dataset.id) || this.data.shareContract || {})
      : (this.data.shareContract || {});
    const role = dataset.role || this.data.shareRole || 'customer';
    const token = role === 'employee'
      ? contract.employee_signing_token
      : contract.customer_signing_token;
    if (token) {
      return {
        title: shareTitle(contract),
        path: `/pages/contract-sign/index?token=${token}&role=${role}`
      };
    }
    return {
      title: '萌姨萌嫂服务助手',
      path: '/pages/login/index'
    };
  }
});
