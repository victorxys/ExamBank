App({
  globalData: {
    openid: '',
    customer: null,
    employee: null,
    staffUser: null,
    role: ''
  },

  onLaunch() {
    const openid = wx.getStorageSync('miniapp_openid');
    const customer = wx.getStorageSync('miniapp_customer');
    const employee = wx.getStorageSync('miniapp_employee');
    const staffUser = wx.getStorageSync('miniapp_staff_user');
    const role = wx.getStorageSync('miniapp_role');
    this.globalData.openid = openid || '';
    this.globalData.customer = customer || null;
    this.globalData.employee = employee || null;
    this.globalData.staffUser = staffUser || null;
    this.globalData.role = role || '';
  },

  setSession(openid, customer, employee, role, staffUser) {
    const hasRoleArg = arguments.length >= 4;
    const hasStaffArg = arguments.length >= 5;
    this.globalData.openid = openid || '';
    this.globalData.customer = customer || null;
    this.globalData.employee = employee || null;
    this.globalData.staffUser = hasStaffArg ? (staffUser || null) : (this.globalData.staffUser || null);
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
    if (hasStaffArg) {
      if (staffUser) {
        wx.setStorageSync('miniapp_staff_user', staffUser);
      } else {
        wx.removeStorageSync('miniapp_staff_user');
      }
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
