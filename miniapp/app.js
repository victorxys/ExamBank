App({
  globalData: {
    openid: '',
    customer: null,
    employee: null,
    role: 'customer'
  },

  onLaunch() {
    const openid = wx.getStorageSync('miniapp_openid');
    const customer = wx.getStorageSync('miniapp_customer');
    const employee = wx.getStorageSync('miniapp_employee');
    const role = wx.getStorageSync('miniapp_role');
    this.globalData.openid = openid || '';
    this.globalData.customer = customer || null;
    this.globalData.employee = employee || null;
    this.globalData.role = role || 'customer';
  },

  setSession(openid, customer, employee, role) {
    this.globalData.openid = openid || '';
    this.globalData.customer = customer || null;
    this.globalData.employee = employee || null;
    this.globalData.role = role || this.globalData.role || 'customer';
    if (openid) wx.setStorageSync('miniapp_openid', openid);
    if (customer) {
      wx.setStorageSync('miniapp_customer', customer);
    } else {
      wx.removeStorageSync('miniapp_customer');
    }
    if (employee) {
      wx.setStorageSync('miniapp_employee', employee);
    } else {
      wx.removeStorageSync('miniapp_employee');
    }
    if (role) wx.setStorageSync('miniapp_role', role);
  }
});
