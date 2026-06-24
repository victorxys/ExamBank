const api = require('../../utils/api');
const { contractView } = require('../../utils/format');
const { markdownToNodes } = require('../../utils/markdown');
const defaultCustomerInfo = {
  name: '',
  phone_number: '',
  id_card_number: '',
  address: ''
};

const defaultEmployeeInfo = {
  name: '',
  phone_number: '',
  id_card_number: '',
  address: ''
};

function currentMiniappRole() {
  const app = getApp();
  return app.globalData.role || wx.getStorageSync('miniapp_role') || '';
}

function hasLocalEmployee() {
  const app = getApp();
  return Boolean(app.globalData.employee || wx.getStorageSync('miniapp_employee'));
}

function hasLocalCustomer() {
  const app = getApp();
  return Boolean(app.globalData.customer || wx.getStorageSync('miniapp_customer'));
}

function roleBlocked(contractRole) {
  const role = currentMiniappRole();
  if (contractRole === 'customer') return role === 'employee' || hasLocalEmployee();
  if (contractRole === 'employee') return role === 'customer' || hasLocalCustomer();
  return false;
}

function roleBlockText(contractRole) {
  if (contractRole === 'customer') return '这是客户签署页面。请分享给客户本人签署，员工不能代客户签署。';
  if (contractRole === 'employee') return '这是服务人员签署页面。请使用服务人员本人微信打开签署。';
  return '当前登录身份与签署角色不一致，请分享给对应签署人。';
}

function normalizeSignerInfo(info = {}) {
  return {
    name: String(info.name || '').trim(),
    phone_number: String(info.phone_number || '').trim(),
    id_card_number: String(info.id_card_number || '').trim(),
    address: String(info.address || '').trim()
  };
}

function customerInfoFromContract(contract = {}) {
  const info = contract.customer_info || {};
  const hasCustomerInfo = Boolean(info.id || info.name || info.phone_number || info.id_card_number || info.address);
  return {
    ...defaultCustomerInfo,
    ...(hasCustomerInfo ? info : {}),
    name: hasCustomerInfo
      ? (info.name || '')
      : (contract.customer_name === '新客户' ? '' : (contract.customer_name || ''))
  };
}

Page({
  data: {
    token: '',
    contract: {
      role: 'customer',
      service_rows: []
    },
    customerInfo: defaultCustomerInfo,
    employeeInfo: defaultEmployeeInfo,
    markdownNodes: [],
    submitting: false,
    hasSignature: false,
    signaturePreview: '',
    blockedByRole: false,
    roleBlockText: '',
    showEmployeeBindAction: false
  },

  onLoad(options) {
    this.setData({
      token: options.token || ''
    });
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage']
    });
    this.loadContract();
  },

  async loadContract() {
    if (!this.data.token) {
      wx.showToast({ title: '缺少签署 token', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加载中' });
    try {
      const result = await api.contractSignDetail(this.data.token);
      const contract = contractView(result.contract || {});
      await api.ensureOpenid(contract.role === 'employee' ? 'employee' : 'customer');
      const markdown = contract.template_content || '';
      const attachmentMarkdown = contract.attachment_content || '';
      const currentSignatureImage = contract.role === 'employee'
        ? contract.employee_signature_image
        : contract.customer_signature_image;
      this.setData({
        contract: {
          ...contract,
          service_rows: contract.service_rows || [],
          current_signature_image: currentSignatureImage
        },
        blockedByRole: roleBlocked(contract.role || 'customer'),
        roleBlockText: roleBlockText(contract.role || 'customer'),
        showEmployeeBindAction: false,
        markdownNodes: markdownToNodes(markdown),
        attachmentNodes: markdownToNodes(attachmentMarkdown),
        customerInfo: customerInfoFromContract(contract),
        employeeInfo: {
          ...defaultEmployeeInfo,
          ...(contract.employee_info || {}),
          name: (contract.employee_info && contract.employee_info.name) || contract.employee_name || ''
        }
      });
    } catch (error) {
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goEmployeeBind() {
    wx.navigateTo({ url: `/pages/employee-bind/index?redirect=${encodeURIComponent(`/pages/contract-sign/index?token=${this.data.token}`)}` });
  },

  onCustomerInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`customerInfo.${field}`]: event.detail.value });
  },

  onEmployeeInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`employeeInfo.${field}`]: event.detail.value });
  },

  validateSignerInfo() {
    const role = this.data.contract.role || 'customer';
    const signerInfo = normalizeSignerInfo(role === 'employee' ? this.data.employeeInfo : this.data.customerInfo);
    if (!signerInfo.name || !signerInfo.phone_number || !signerInfo.id_card_number || !signerInfo.address) {
      wx.showToast({ title: role === 'employee' ? '请补全乙方信息' : '请先补全甲方信息', icon: 'none' });
      return null;
    }
    return signerInfo;
  },

  openSignaturePad() {
    if (this.data.blockedByRole) {
      wx.showToast({ title: (this.data.contract.role || 'customer') === 'employee' ? '请服务人员本人签署' : '员工不能代客户签署', icon: 'none' });
      return;
    }
    if (!this.validateSignerInfo()) return;
    wx.navigateTo({ url: '/pages/signature-pad/index' });
  },

  clearSignature() {
    this.setData({
      hasSignature: false,
      signaturePreview: ''
    });
  },

  readFileBase64(path) {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath: path,
        encoding: 'base64',
        success: (res) => resolve(`data:image/png;base64,${res.data}`),
        fail: reject
      });
    });
  },

  async submitSign() {
    const { contract, token } = this.data;
    const role = contract.role || 'customer';
    if (this.data.blockedByRole) {
      wx.showToast({ title: role === 'employee' ? '请服务人员本人签署' : '员工不能代客户签署', icon: 'none' });
      return;
    }
    const signerInfo = this.validateSignerInfo();
    if (!signerInfo) return;
    if (!this.data.hasSignature) {
      wx.showToast({ title: '请先签名', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const signature = await this.readFileBase64(this.data.signaturePreview);
      const payload = {
        openid: api.getOpenid(),
        signature
      };
      if (role === 'employee') {
        payload.employee_info = signerInfo;
      } else {
        payload.customer_info = signerInfo;
      }
      await api.submitContractSign(token, payload);
      wx.showToast({ title: '签署完成', icon: 'success' });
      setTimeout(() => wx.redirectTo({ url: role === 'employee' ? '/pages/employee-home/index' : '/pages/home/index' }), 700);
    } catch (error) {
      wx.showToast({ title: error.message || '签署失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onShareAppMessage() {
    const { contract, token } = this.data;
    const customerName = contract.customer_name || (contract.customer_info || {}).name || '客户';
    const typeLabel = contract.type_label || '服务合同';
    return {
      title: `${customerName}的${typeLabel}待签署`,
      path: `/pages/contract-sign/index?token=${token}`
    };
  }
});
