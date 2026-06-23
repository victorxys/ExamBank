const api = require('../../utils/api');

Page({
  data: {
    form: {
      phone_number: '',
      credential: ''
    },
    redirect: '',
    loading: false
  },

  onLoad(options) {
    this.setData({ redirect: options.redirect ? decodeURIComponent(options.redirect) : '' });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  async bindEmployee() {
    const { form } = this.data;
    const openid = api.getOpenid();
    const credential = (form.credential || '').trim();
    if (!openid || !form.phone_number || !credential) {
      wx.showToast({ title: '请填写手机号和验证信息', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    try {
      const result = await api.bindEmployee({
        phone_number: form.phone_number,
        id_card_last6: credential,
        password: credential,
        openid
      });
      const role = result.role || (result.staff_user ? 'staff' : 'employee');
      getApp().setSession(openid, null, result.employee || null, role, result.staff_user || null);
      wx.showToast({ title: '绑定成功', icon: 'success' });
      wx.redirectTo({ url: this.data.redirect || (role === 'staff' ? '/pages/ayi-search/index' : '/pages/employee-home/index') });
    } catch (error) {
      wx.showToast({ title: error.message || '绑定失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
