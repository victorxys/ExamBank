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
    signaturePreview: '',
    signaturePadOpen: false,
    landscapePanelWidth: 667,
    landscapePanelHeight: 375,
    landscapeCanvasWidth: 667,
    landscapeCanvasHeight: 329,
    blockedByRole: false,
    roleBlockText: '',
    showEmployeeBindAction: false
  },

  onLoad(options) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const windowWidth = info.windowWidth || 375;
    const windowHeight = info.windowHeight || 667;
    const toolbarHeight = 46;
    this.ctx = null;
    this.landscapeCtx = null;
    this.lastSignaturePoint = null;
    this.lastLandscapeSignaturePoint = null;
    this.signatureTouched = false;
    this.landscapeSignatureTouched = false;
    this.setData({
      token: options.token || '',
      landscapePanelWidth: windowHeight,
      landscapePanelHeight: windowWidth,
      landscapeCanvasWidth: windowHeight,
      landscapeCanvasHeight: Math.max(220, windowWidth - toolbarHeight)
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

  createLandscapeContext() {
    if (!this.landscapeCtx) {
      this.landscapeCtx = wx.createCanvasContext('contractLandscapeSignature', this);
    }
    return this.landscapeCtx;
  },

  resetLandscapeCanvas() {
    const ctx = this.createLandscapeContext();
    ctx.setFillStyle('#ffffff');
    ctx.fillRect(0, 0, this.data.landscapeCanvasWidth, this.data.landscapeCanvasHeight);
    ctx.draw();
    this.lastLandscapeSignaturePoint = null;
    this.landscapeSignatureTouched = false;
  },

  openSignaturePad() {
    this.setData({ signaturePadOpen: true }, () => {
      this.resetLandscapeCanvas();
    });
  },

  cancelSignaturePad() {
    this.setData({ signaturePadOpen: false });
    this.lastLandscapeSignaturePoint = null;
    this.landscapeSignatureTouched = false;
  },

  landscapeTouchStart(event) {
    const point = getTouchPoint(event);
    if (!point) return;
    const ctx = this.createLandscapeContext();
    this.lastLandscapeSignaturePoint = point;
    this.landscapeSignatureTouched = true;
    drawSignatureDot(ctx, point, { lineWidth: 5 });
  },

  landscapeTouchMove(event) {
    const point = getTouchPoint(event);
    if (!point) return;
    const ctx = this.createLandscapeContext();
    if (this.lastLandscapeSignaturePoint) {
      drawSignatureSegment(ctx, this.lastLandscapeSignaturePoint, point, { lineWidth: 5 });
    } else {
      drawSignatureDot(ctx, point, { lineWidth: 5 });
    }
    this.lastLandscapeSignaturePoint = point;
  },

  landscapeTouchEnd() {
    this.lastLandscapeSignaturePoint = null;
  },

  clearLandscapeSignature() {
    this.resetLandscapeCanvas();
  },

  confirmSignaturePad() {
    if (!this.landscapeSignatureTouched) {
      wx.showToast({ title: '请先签名', icon: 'none' });
      return;
    }
    wx.canvasToTempFilePath({
      canvasId: 'contractLandscapeSignature',
      fileType: 'png',
      success: (res) => {
        this.setData({
          signaturePadOpen: false,
          signaturePreview: res.tempFilePath,
          hasSignature: true
        });
      },
      fail: () => wx.showToast({ title: '签名保存失败', icon: 'none' })
    }, this);
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
    this.lastSignaturePoint = null;
    this.lastLandscapeSignaturePoint = null;
    this.signatureTouched = false;
    this.landscapeSignatureTouched = false;
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
      const signature = await this.readFileBase64(this.data.signaturePreview);
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
