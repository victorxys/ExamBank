const api = require('../../utils/api');

function normalizeOptions(options = []) {
  return (options || []).map((item) => ({
    value: String(item.value || ''),
    label: item.label || ''
  })).filter((item) => item.value && item.label);
}

function withAllOption(label, options = []) {
  return [{ value: '', label }, ...normalizeOptions(options)];
}

function pickValue(options, index) {
  const option = options[Number(index || 0)] || {};
  return option.value || '';
}

Page({
  data: {
    keyword: '',
    typeIndex: 0,
    cityIndex: 0,
    shengxiaoIndex: 0,
    xingzuoIndex: 0,
    typeOptions: [{ value: '', label: '全部类型' }],
    cityOptions: [{ value: '', label: '全部籍贯' }],
    shengxiaoOptions: [{ value: '', label: '全部生肖' }],
    xingzuoOptions: [{ value: '', label: '全部星座' }],
    ageOptions: [{ value: '', label: '不限' }],
    educationOptions: [{ value: '', label: '不限' }],
    payRateOptions: [{ value: '', label: '不限' }],
    age: '',
    education: '',
    payRate: '',
    items: [],
    page: 1,
    perPage: 10,
    total: 0,
    loading: false,
    loaded: false,
    hasMore: true
  },

  onLoad() {
    if (!this.ensureStaffAccess()) return;
    this.loadOptions();
    this.search(true);
  },

  ensureStaffAccess() {
    const role = getApp().globalData.role || wx.getStorageSync('miniapp_role');
    const staffUser = getApp().globalData.staffUser || wx.getStorageSync('miniapp_staff_user');
    if (role === 'staff' && staffUser) return true;

    wx.showToast({ title: '仅后台人员可搜索阿姨资料', icon: 'none' });
    setTimeout(() => {
      wx.redirectTo({ url: '/pages/employee-bind/index' });
    }, 700);
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

  async loadOptions() {
    try {
      const result = await api.ayiOptions();
      const options = result.options || {};
      this.setData({
        typeOptions: withAllOption('全部类型', options.types),
        cityOptions: withAllOption('全部籍贯', options.cities),
        shengxiaoOptions: withAllOption('全部生肖', options.shengxiao),
        xingzuoOptions: withAllOption('全部星座', options.xingzuo),
        ageOptions: [{ value: '', label: '不限' }, ...normalizeOptions(options.ages)],
        educationOptions: [{ value: '', label: '不限' }, ...normalizeOptions(options.education)],
        payRateOptions: [{ value: '', label: '不限' }, ...normalizeOptions(options.pay_rates)]
      });
    } catch (error) {
      wx.showToast({ title: error.message || '筛选项加载失败', icon: 'none' });
    }
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  onTypeChange(event) {
    this.setData({ typeIndex: Number(event.detail.value || 0) });
    this.search(true);
  },

  onCityChange(event) {
    this.setData({ cityIndex: Number(event.detail.value || 0) });
    this.search(true);
  },

  onShengxiaoChange(event) {
    this.setData({ shengxiaoIndex: Number(event.detail.value || 0) });
    this.search(true);
  },

  onXingzuoChange(event) {
    this.setData({ xingzuoIndex: Number(event.detail.value || 0) });
    this.search(true);
  },

  selectAge(event) {
    this.setData({ age: event.currentTarget.dataset.value || '' });
    this.search(true);
  },

  selectEducation(event) {
    this.setData({ education: event.currentTarget.dataset.value || '' });
    this.search(true);
  },

  selectPayRate(event) {
    this.setData({ payRate: event.currentTarget.dataset.value || '' });
    this.search(true);
  },

  resetFilters() {
    this.setData({
      typeIndex: 0,
      cityIndex: 0,
      shengxiaoIndex: 0,
      xingzuoIndex: 0,
      age: '',
      education: '',
      payRate: ''
    });
    this.search(true);
  },

  onSearchConfirm() {
    this.search(true);
  },

  clearKeyword() {
    this.setData({ keyword: '' });
    this.search(true);
  },

  async search(reset = true) {
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true });
    if (reset) {
      wx.showLoading({ title: '搜索中' });
    }
    try {
      const result = await api.ayiSearch({
        search: this.data.keyword,
        type: pickValue(this.data.typeOptions, this.data.typeIndex),
        city: pickValue(this.data.cityOptions, this.data.cityIndex),
        shegnxiao: pickValue(this.data.shengxiaoOptions, this.data.shengxiaoIndex),
        xingzuo: pickValue(this.data.xingzuoOptions, this.data.xingzuoIndex),
        age: this.data.age,
        hobbies: this.data.education,
        pay_rate: this.data.payRate,
        page,
        per_page: this.data.perPage
      });
      const nextItems = result.items || [];
      const items = reset ? nextItems : this.data.items.concat(nextItems);
      this.setData({
        items,
        page,
        total: result.total || 0,
        loaded: true,
        hasMore: items.length < (result.total || 0)
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
    if (id) {
      wx.navigateTo({ url: `/pages/ayi-detail/index?id=${id}` });
    }
  }
});
