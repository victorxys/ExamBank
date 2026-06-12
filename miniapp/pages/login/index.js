const api = require('../../utils/api');
const { devMockOpenid, enableMockLogin } = require('../../config/index');

const contractSignTestLinks = [
  {
    role: 'customer',
    label: '测试客户签署',
    token: 'c6323e8a-60b2-408f-9757-040d7ab9a74e'
  },
  {
    role: 'employee',
    label: '测试员工签署',
    token: 'e1c3831c-23a8-413c-bdf6-7b3c1808c4cd'
  }
];

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res.code) {
          resolve(res.code);
        } else {
          reject(new Error('微信登录未返回 code'));
        }
      },
      fail: reject
    });
  });
}

Page({
  data: {
    openid: '',
    role: 'customer',
    contractSignTestLinks,
    enableMockLogin,
    loading: false
  },

  onLoad(options) {
    this.setData({
      openid: enableMockLogin ? (wx.getStorageSync('miniapp_openid') || devMockOpenid) : '',
      role: options.role || wx.getStorageSync('miniapp_role') || 'customer'
    });
  },

  selectRole(event) {
    this.setData({ role: event.currentTarget.dataset.role });
  },

  onOpenidInput(event) {
    this.setData({ openid: event.detail.value });
  },

  async login() {
    this.setData({ loading: true });
    try {
      if (enableMockLogin && this.data.openid.trim()) {
        await this.loginWithMock();
        return;
      }
      const code = await wxLogin();
      const result = await api.login({ code });
      const role = this.data.role;
      getApp().setSession(result.openid, result.customer || null, result.employee || null, role);
      if (role === 'employee') {
        wx.showToast({ title: result.employee_bound ? '登录成功' : '请先绑定员工身份', icon: 'none' });
        wx.redirectTo({ url: result.employee_bound ? '/pages/employee-home/index' : '/pages/employee-bind/index' });
        return;
      }
      wx.showToast({ title: result.has_customer_access ? '登录成功' : '暂无关联服务', icon: 'none' });
      wx.redirectTo({ url: '/pages/home/index' });
    } catch (error) {
      if (enableMockLogin) {
        try {
          await this.loginWithMock(error);
        } catch (mockError) {
          wx.showToast({ title: mockError.message || error.message || '登录失败', icon: 'none' });
        }
        return;
      }
      wx.showToast({ title: error.message || '登录失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loginWithMock(originalError = {}) {
    const openid = this.data.openid.trim();
    if (!openid) {
      wx.showToast({ title: originalError.message || '登录失败', icon: 'none' });
      return;
    }
    const result = await api.login({ mock_openid: openid });
    const role = this.data.role;
    getApp().setSession(result.openid || openid, result.customer || null, result.employee || null, role);
    if (role === 'employee') {
      wx.showToast({ title: result.employee_bound ? '登录成功' : '请先绑定员工身份', icon: 'none' });
      wx.redirectTo({ url: result.employee_bound ? '/pages/employee-home/index' : '/pages/employee-bind/index' });
      return;
    }
    wx.showToast({ title: result.has_customer_access ? '登录成功' : '暂无关联服务', icon: 'none' });
    wx.redirectTo({ url: '/pages/home/index' });
  },

  async goContractSignTest(event) {
    const token = event.currentTarget.dataset.token;
    const role = event.currentTarget.dataset.role || 'customer';
    if (!token) return;

    this.setData({ loading: true });
    try {
      if (enableMockLogin && this.data.openid.trim()) {
        const result = await api.login({ mock_openid: this.data.openid.trim() });
        getApp().setSession(result.openid || this.data.openid.trim(), result.customer || null, result.employee || null, role);
      } else {
        const code = await wxLogin();
        const result = await api.login({ code });
        getApp().setSession(result.openid, result.customer || null, result.employee || null, role);
      }
      wx.navigateTo({ url: `/pages/contract-sign/index?token=${token}` });
    } catch (error) {
      wx.showToast({ title: error.message || '打开签署页失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
