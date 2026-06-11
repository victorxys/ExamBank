const api = require('../../utils/api');
const { contractView } = require('../../utils/format');
const { markdownToNodes } = require('../../utils/markdown');
const {
  drawSignatureDot,
  drawSignatureSegment,
  getTouchPoint
} = require('../../utils/signature');

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
  if (contractRole === 'employee') return role === 'customer' || hasLocalCustomer() || !hasLocalEmployee();
  return false;
}

function roleBlockText(contractRole) {
  if (contractRole === 'customer') return '这是客户签署页面。请分享给客户本人签署，员工不能代客户签署。';
  if (contractRole === 'employee') return '这是服务人员签署页面。请先使用手机号和身份证后6位绑定员工身份，再返回签署。';
  return '当前登录身份与签署角色不一致，请分享给对应签署人。';
}

function maskPhone(phoneNumber = '') {
  const value = String(phoneNumber || '');
  if (value.length < 7) return value || '-';
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function maskIdCard(idCardNumber = '') {
  const value = String(idCardNumber || '');
  if (value.length < 8) return value || '-';
  return `${value.slice(0, 4)}********${value.slice(-4)}`;
}

Page({
  data: {
    token: '',
    contract: {},
    customerInfo: defaultCustomerInfo,
    employeeInfo: defaultEmployeeInfo,
    markdownNodes: [],
    submitting: false,
    hasSignature: false,
    blockedByRole: false,
    roleBlockText: '',
    showEmployeeBindAction: false
  },

  onLoad(options) {
    this.ctx = wx.createCanvasContext('contractSignature', this);
    this.lastSignaturePoint = null;
    this.signatureTouched = false;
    this.setData({ token: options.token || '' });
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
      const markdown = contract.template_content || contract.service_content || contract.attachment_content || '';
      const currentSignatureImage = contract.role === 'employee'
        ? contract.employee_signature_image
        : contract.customer_signature_image;
      this.setData({
        contract: {
          ...contract,
          current_signature_image: currentSignatureImage
        },
        blockedByRole: roleBlocked(contract.role || 'customer'),
        roleBlockText: roleBlockText(contract.role || 'customer'),
        showEmployeeBindAction: contract.role === 'employee' && !hasLocalEmployee(),
        markdownNodes: markdownToNodes(markdown),
        customerInfo: {
          ...defaultCustomerInfo,
          ...(contract.customer_info || {}),
          name: (contract.customer_info && contract.customer_info.name) || contract.customer_name || '',
          phone_masked: maskPhone((contract.customer_info || {}).phone_number),
          id_card_masked: maskIdCard((contract.customer_info || {}).id_card_number)
        },
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

  touchStart(event) {
    const point = getTouchPoint(event);
    if (!point) return;
    this.lastSignaturePoint = point;
    this.signatureTouched = true;
    drawSignatureDot(this.ctx, point);
  },

  touchMove(event) {
    const point = getTouchPoint(event);
    if (!point) return;
    if (this.lastSignaturePoint) {
      drawSignatureSegment(this.ctx, this.lastSignaturePoint, point);
    } else {
      drawSignatureDot(this.ctx, point);
    }
    this.lastSignaturePoint = point;
    if (!this.signatureTouched || !this.data.hasSignature) {
      this.signatureTouched = true;
      this.setData({ hasSignature: true });
    }
  },

  touchEnd() {
    this.lastSignaturePoint = null;
    if (this.signatureTouched && !this.data.hasSignature) {
      this.setData({ hasSignature: true });
    }
  },

  clearSignature() {
    this.ctx.clearRect(0, 0, 360, 140);
    this.ctx.draw();
    this.lastSignaturePoint = null;
    this.signatureTouched = false;
    this.setData({ hasSignature: false });
  },

  canvasToTempFile() {
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvasId: 'contractSignature',
        fileType: 'png',
        success: (res) => resolve(res.tempFilePath),
        fail: reject
      }, this);
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
    const { customerInfo, employeeInfo, contract, token } = this.data;
    const role = contract.role || 'customer';
    if (this.data.blockedByRole) {
      wx.showToast({ title: role === 'employee' ? '请服务人员本人签署' : '员工不能代客户签署', icon: 'none' });
      return;
    }
    const signerInfo = role === 'employee' ? employeeInfo : customerInfo;
    if (role === 'employee' && (!signerInfo.name || !signerInfo.phone_number || !signerInfo.id_card_number || !signerInfo.address)) {
      wx.showToast({ title: '请补全乙方信息', icon: 'none' });
      return;
    }
    if (role !== 'employee' && !signerInfo.name) {
      wx.showToast({ title: '合同甲方信息不完整，请联系运营', icon: 'none' });
      return;
    }
    if (!this.data.hasSignature) {
      wx.showToast({ title: '请先签名', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const path = await this.canvasToTempFile();
      const signature = await this.readFileBase64(path);
      const payload = {
        openid: api.getOpenid(),
        signature
      };
      if (role === 'employee') {
        payload.employee_info = employeeInfo;
      }
      await api.submitContractSign(token, payload);
      wx.showToast({ title: '签署完成', icon: 'success' });
      setTimeout(() => wx.redirectTo({ url: role === 'employee' ? '/pages/employee-home/index' : '/pages/home/index' }), 700);
    } catch (error) {
      wx.showToast({ title: error.message || '签署失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
