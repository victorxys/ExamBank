App({
  globalData: {
    openid: '',
    customer: null,
    employee: null,
    role: ''
  },

  onLaunch() {
    const openid = wx.getStorageSync('miniapp_openid');
    const customer = wx.getStorageSync('miniapp_customer');
    const employee = wx.getStorageSync('miniapp_employee');
    const role = wx.getStorageSync('miniapp_role');
    this.globalData.openid = openid || '';
    this.globalData.customer = customer || null;
    this.globalData.employee = employee || null;
    this.globalData.role = role || '';
  },

  setSession(openid, customer, employee, role) {
    const hasRoleArg = arguments.length >= 4;
    this.globalData.openid = openid || '';
    this.globalData.customer = customer || null;
    this.globalData.employee = employee || null;
    this.globalData.role = hasRoleArg ? (role || '') : (this.globalData.role || '');
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
    if (hasRoleArg) {
      if (role) {
        wx.setStorageSync('miniapp_role', role);
      } else {
        wx.removeStorageSync('miniapp_role');
      }
    }
  }
});
