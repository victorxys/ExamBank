const api = require('../../utils/api');
const { contractView, formatDate } = require('../../utils/format');
const { markdownToNodes } = require('../../utils/markdown');
const { normalizeAttendanceCard } = require('../../utils/attendance-summary');

function evaluationText(evaluation) {
  const tags = (evaluation.tags || []).join('、');
  return [tags, evaluation.comment].filter(Boolean).join(' · ') || '已提交评价';
}

function moneyText(value) {
  const number = Number(value || 0);
  if (Number.isNaN(number)) return value || '0.00';
  return number.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function roundedMoneyWithCentsText(value) {
  const number = Number(value || 0);
  if (Number.isNaN(number)) return value || '0.00';
  return Math.round(number).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function payrollView(payroll = {}) {
  const estimated = Boolean(payroll.estimated);
  return {
    ...payroll,
    amount_due_text: estimated ? roundedMoneyWithCentsText(payroll.amount_due) : moneyText(payroll.amount_due),
    estimated,
    period_text: `${payroll.year || ''}年${payroll.month || '-'}月`,
    title_suffix: estimated ? '预估劳务费' : '应付劳务费',
    date_range: `${formatDate(payroll.cycle_start_date)} - ${formatDate(payroll.cycle_end_date)}`,
    customer_status_class: payroll.customer_confirmed ? 'signed' : (estimated ? 'estimated' : 'danger'),
    customer_status_text: estimated ? '预估金额' : payroll.customer_status_text,
    payout_status_text: estimated ? '待确认考勤' : (payroll.status_text || '待支付')
  };
}

function contractReadyForEvaluation(contract = {}) {
  return ['finished', 'completed', 'terminated', 'trial_succeeded'].includes(contract.status)
    && ['SIGNED', 'NOT_REQUIRED'].includes(contract.signing_status);
}

function contractAllowsEvaluationEntry(contract = {}) {
  return Boolean(contract.employee_id)
    && ['active', 'trial_active', 'finished', 'completed', 'terminated', 'trial_succeeded'].includes(contract.status)
    && ['SIGNED', 'NOT_REQUIRED'].includes(contract.signing_status);
}

function customerCanSign(contract = {}) {
  return ['UNSIGNED', 'EMPLOYEE_SIGNED'].includes(contract.signing_status) && Boolean(contract.customer_signing_token);
}

function employeeCanSign(contract = {}) {
  return ['UNSIGNED', 'CUSTOMER_SIGNED'].includes(contract.signing_status) && Boolean(contract.employee_signing_token);
}

function staffCanShareCustomer(contract = {}) {
  return ['UNSIGNED', 'EMPLOYEE_SIGNED'].includes(contract.signing_status) && Boolean(contract.customer_signing_token);
}

function staffCanShareEmployee(contract = {}) {
  return ['UNSIGNED', 'CUSTOMER_SIGNED'].includes(contract.signing_status) && Boolean(contract.employee_signing_token);
}

function contractShareTitle(contract = {}) {
  const typeLabel = contract.type_label || '服务合同';
  if (contract.customer_signing_token) {
    return `请签署${typeLabel}`;
  }
  return `${typeLabel}详情`;
}

function contractSharePath(contract = {}) {
  if (contract.customer_signing_token) {
    return `/pages/contract-sign/index?token=${contract.customer_signing_token}`;
  }
  if (contract.id) {
    return `/pages/contract-detail/index?id=${contract.id}&role=customer`;
  }
  return '/pages/home/index';
}

Page({
  data: {
    id: '',
    token: '',
    role: 'customer',
    contract: {
      customer_info: {},
      employee_info: {},
      service_rows: []
    },
    attendanceForms: [],
    attendancePreviewForms: [],
    pendingAttendanceForms: [],
    payrolls: [],
    payrollPreviewItems: [],
    showAllPayrolls: false,
    evaluations: [],
    markdownNodes: [],
    canCustomerSign: false,
    canEmployeeSign: false,
    canEvaluate: false,
    canEvaluationEntry: false,
    evaluationEntryText: '填写评价',
    hasCustomerActions: false,
    hasEmployeeActions: false,
    canShareContract: false,
    canStaffShareCustomer: false,
    canStaffShareEmployee: false,
    shareRole: '',
    signingMessagesLoaded: false,
    signingMessagesLoading: false,
    signingMessagesError: '',
    signingMessageRole: 'customer',
    signingMessageEditing: false,
    signingMessages: {
      customer: '',
      employee: ''
    },
    signingMessageDraft: '',
    loadedOnce: false,
    loadError: '',
    shareTitle: '服务合同',
    sharePath: '',
    icons: {
      payroll: '/assets/ui/icons/payroll.svg'
    }
  },

  onLoad(options) {
    if (options.token) {
      wx.redirectTo({ url: `/pages/contract-sign/index?token=${options.token}` });
      return;
    }
    this.setData({
      id: options.id || '',
      token: options.token || '',
      role: options.role || 'customer',
      loadError: ''
    });
    this.loadContract();
  },

  onShow() {
    if (this.data.id && this.data.loadedOnce) {
      this.loadContract();
    }
  },

  async loadContract() {
    if (!this.data.id) {
      this.setData({ loadError: '缺少合同信息，请从运营分享的签署链接进入。' });
      wx.showToast({ title: '缺少合同ID', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加载中' });
    try {
      const result = this.data.role === 'staff'
        ? await api.staffContractDetail(this.data.id)
        : (this.data.role === 'employee'
          ? await api.employeeContractDetail(this.data.id)
          : await api.contractDetail(this.data.id));
      const contract = contractView(result.contract || {});
      const markdown = contract.template_content || '';
      const attachmentMarkdown = contract.attachment_content || '';
      const rawAttendanceForms = (contract.attendance_forms || []).filter((item) => (
        ['employee_confirmed', 'customer_signed', 'synced'].includes(item.status)
      ));
      const holidays = await this.loadAttendanceHolidays(rawAttendanceForms);
      const attendanceForms = rawAttendanceForms.map((item) => normalizeAttendanceCard(item, holidays[item.actual_year || item.year] || {}));
      const attendancePreviewForms = attendanceForms.slice(0, 3);
      const pendingAttendanceForms = attendanceForms.filter((item) => (
        item.status === 'employee_confirmed' && item.customer_signature_token
      ));
      const payrolls = (contract.payrolls || []).map(payrollView);
      const payrollPreviewItems = payrolls.slice(0, 3);
      const evaluations = (contract.evaluations || []).map((item) => ({
        ...item,
        rating_text: `${item.rating || '-'} 星`,
        summary_text: evaluationText(item),
        created_at_text: formatDate(item.created_at)
      }));
      const hasEvaluationRecord = evaluations.length > 0;
      const canCustomerSign = this.data.role === 'customer' && customerCanSign(contract);
      const canEmployeeSign = this.data.role === 'employee' && employeeCanSign(contract);
      const canEvaluate = this.data.role === 'customer' && contractReadyForEvaluation(contract) && !hasEvaluationRecord;
      const canEvaluationEntry = this.data.role === 'customer' && contractAllowsEvaluationEntry(contract);
      const canStaffShareCustomer = this.data.role === 'staff' && staffCanShareCustomer(contract);
      const canStaffShareEmployee = this.data.role === 'staff' && staffCanShareEmployee(contract);
      this.setData({
        contract: {
          ...contract,
          customer_info: contract.customer_info || {},
          employee_info: contract.employee_info || {},
          service_rows: contract.service_rows || []
        },
        attendanceForms,
        attendancePreviewForms,
        pendingAttendanceForms,
        payrolls,
        payrollPreviewItems,
        showAllPayrolls: false,
        evaluations,
        canCustomerSign,
        canEmployeeSign,
        canEvaluate,
        canEvaluationEntry,
        evaluationEntryText: evaluations.length > 0 ? '继续填写评价' : '填写评价',
        hasCustomerActions: canCustomerSign || canEvaluate || pendingAttendanceForms.length > 0,
        hasEmployeeActions: canEmployeeSign,
        canStaffShareCustomer,
        canStaffShareEmployee,
        canShareContract: Boolean(contract.customer_signing_token || contract.id),
        loadedOnce: true,
        loadError: '',
        shareTitle: contractShareTitle(contract),
        sharePath: contractSharePath(contract),
        markdownNodes: markdownToNodes(markdown),
        attachmentNodes: markdownToNodes(attachmentMarkdown)
      });
      if (this.data.role === 'staff') {
        this.loadSigningMessages();
      }
    } catch (error) {
      const message = error.message || '加载失败';
      this.setData({
        loadedOnce: true,
        loadError: message === '合同不存在或无权访问'
          ? '当前微信暂未获得该合同访问权限。请从运营分享的合同签署链接进入，完成签署后即可查看合同。'
          : message
      });
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async loadSigningMessages() {
    if (!this.data.id || this.data.signingMessagesLoading) return;
    this.setData({
      signingMessagesLoading: true,
      signingMessagesError: ''
    });
    try {
      const result = await api.staffContractSigningMessages(this.data.id);
      const role = this.data.signingMessageRole || 'customer';
      const messages = {
        customer: result.customer_message || '',
        employee: result.employee_message || ''
      };
      this.setData({
        signingMessages: messages,
        signingMessageDraft: messages[role] || '',
        signingMessagesLoaded: true,
        signingMessageEditing: false
      });
    } catch (error) {
      this.setData({
        signingMessagesError: error.message || '签约信息加载失败'
      });
    } finally {
      this.setData({ signingMessagesLoading: false });
    }
  },

  async loadAttendanceHolidays(forms = []) {
    const years = Array.from(new Set(forms.map((item) => item.actual_year || item.year).filter(Boolean)));
    const entries = await Promise.all(years.map(async (year) => {
      try {
        const result = await api.holidays(year);
        return [year, result.holidays || {}];
      } catch (error) {
        return [year, {}];
      }
    }));
    return entries.reduce((acc, item) => {
      acc[item[0]] = item[1];
      return acc;
    }, {});
  },

  goEvaluation() {
    if (!this.data.id) return;
    wx.navigateTo({ url: `/pages/evaluation/index?contractId=${this.data.id}` });
  },

  goContractSign() {
    const token = this.data.role === 'employee'
      ? this.data.contract.employee_signing_token
      : this.data.contract.customer_signing_token;
    if (token) wx.navigateTo({ url: `/pages/contract-sign/index?token=${token}` });
  },

  goAttendanceSign(event) {
    const token = event.currentTarget.dataset.token;
    if (token) wx.navigateTo({ url: `/pages/attendance-sign/index?token=${token}` });
  },

  goAllAttendance() {
    if (!this.data.id) return;
    wx.navigateTo({ url: `/pages/contract-attendance/index?id=${this.data.id}&role=${this.data.role}` });
  },

  goPayrollDue() {
    if (!this.data.id || this.data.role !== 'customer') return;
    const latestPayroll = (this.data.payrolls || [])[0] || {};
    if (latestPayroll.id) {
      wx.navigateTo({ url: `/pages/payroll-due/index?payrollId=${latestPayroll.id}` });
      return;
    }
    const now = new Date();
    wx.navigateTo({
      url: `/pages/payroll-due/index?contractId=${this.data.id}&year=${now.getFullYear()}&month=${now.getMonth() + 1}`
    });
  },

  goPayrollDetail(event) {
    const payrollId = event.currentTarget.dataset.id;
    if (payrollId) {
      wx.navigateTo({ url: `/pages/payroll-due/index?payrollId=${payrollId}` });
      return;
    }
    const contractId = event.currentTarget.dataset.contractId || this.data.id;
    const year = event.currentTarget.dataset.year;
    const month = event.currentTarget.dataset.month;
    if (contractId && year && month) {
      wx.navigateTo({ url: `/pages/payroll-due/index?contractId=${contractId}&year=${year}&month=${month}` });
    }
  },

  showAllPayrolls() {
    this.setData({
      payrollPreviewItems: this.data.payrolls || [],
      showAllPayrolls: true
    });
  },

  goExitSummary() {
    if (!this.data.id) return;
    wx.navigateTo({ url: `/pages/exit-summary/index?contractId=${this.data.id}` });
  },

  prepareShare(event) {
    this.setData({ shareRole: event.currentTarget.dataset.role || '' });
  },

  switchSigningMessageRole(event) {
    const role = event.currentTarget.dataset.role || 'customer';
    const messages = this.data.signingMessages || {};
    this.setData({
      signingMessageRole: role,
      signingMessageDraft: messages[role] || '',
      signingMessageEditing: false
    });
  },

  editSigningMessage() {
    this.setData({ signingMessageEditing: true });
  },

  cancelSigningMessageEdit() {
    const role = this.data.signingMessageRole || 'customer';
    const messages = this.data.signingMessages || {};
    this.setData({
      signingMessageDraft: messages[role] || '',
      signingMessageEditing: false
    });
  },

  onSigningMessageInput(event) {
    this.setData({ signingMessageDraft: event.detail.value || '' });
  },

  saveSigningMessageDraft() {
    const role = this.data.signingMessageRole || 'customer';
    this.setData({
      [`signingMessages.${role}`]: this.data.signingMessageDraft || '',
      signingMessageEditing: false
    });
    wx.showToast({ title: '已更新本页内容', icon: 'success' });
  },

  copySigningMessage() {
    const text = this.data.signingMessageDraft || '';
    if (!text.trim()) {
      wx.showToast({ title: '暂无可复制内容', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },

  resetSigningMessage() {
    this.loadSigningMessages();
  },

  onShareAppMessage(event = {}) {
    const contract = this.data.contract || {};
    if (this.data.role === 'staff' && event.from === 'button') {
      const dataset = event.target ? (event.target.dataset || {}) : {};
      const role = dataset.role || this.data.shareRole || 'customer';
      const token = role === 'employee'
        ? contract.employee_signing_token
        : contract.customer_signing_token;
      if (token) {
        return {
          title: `请签署${contract.type_label || '服务合同'} - ${contract.customer_name || '客户'}`,
          path: `/pages/contract-sign/index?token=${token}&role=${role}`
        };
      }
    }
    if (this.data.role === 'staff') {
      return {
        title: '萌姨萌嫂服务助手',
        path: '/pages/login/index'
      };
    }
    return {
      title: this.data.shareTitle || '服务合同',
      path: this.data.sharePath || `/pages/contract-detail/index?id=${this.data.id}&role=customer`
    };
  }
});
