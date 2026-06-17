const api = require('../../utils/api');
const { formatDate: formatFullDate } = require('../../utils/format');
const {
  buildCalendar,
  buildSpecialRecords,
  calculateStats,
  normalizeAutoOvertime,
  normalizeContractInfoForAttendance,
  normalizeAttendanceData,
  findCoveringRecord,
  findOriginalRecord,
  formatDate: formatAttendanceDate,
  formatMonthDay
} = require('../../utils/attendance');

function monthTitle(form) {
  const month = form.actual_month || form.month || '';
  return `${month || '-'}月考勤确认`;
}

function buildStatusText(form, signed) {
  if (signed) return '客户已签署';
  if (form.status === 'employee_confirmed') return '请确认考勤信息无误后签署';
  return '请核对服务人员提交的考勤';
}

function isEmployeeSignedIn() {
  const app = getApp();
  const role = app.globalData.role || wx.getStorageSync('miniapp_role') || '';
  const employee = app.globalData.employee || wx.getStorageSync('miniapp_employee');
  return role === 'employee' || Boolean(employee);
}

function signatureImage(signatureData = {}) {
  const image = signatureData.image || signatureData.signature_image || signatureData.signature || '';
  return image ? api.assetUrl(image) : '';
}

function formatDateTime(value) {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  const pad = (item) => String(item).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildEmptyStats() {
  return {
    workDaysText: '0',
    leaveDaysText: '0',
    overtimeDaysText: '0',
    holidayOvertimeDaysText: '0',
    autoOvertimeDaysText: '0'
  };
}

Page({
  data: {
    token: '',
    form: {
      contract_info: {}
    },
    attendanceData: normalizeAttendanceData({}),
    dateRangeText: '',
    customerNameText: '请确认考勤信息',
    employeeNameText: '服务人员',
    avatarText: '员工',
    pageTitleText: '考勤确认',
    statusText: '请核对服务人员提交的考勤',
    monthText: '-',
    stats: buildEmptyStats(),
    monthDays: [],
    calendarCells: [],
    specialRecords: [],
    showSpecialRecords: false,
    holidays: {},
    holidayYear: null,
    showHolidayOvertimeStat: false,
    showAutoBanner: false,
    isSigned: false,
    showSignedCard: false,
    signatureImage: '',
    signedAtText: '',
    signedNameText: '',
    blockedByEmployeeRole: false,
    employeeBlockText: '这是客户考勤确认页面。请分享给客户本人签署，员工端不能代客户确认。',
    auth: {
      authenticated: true,
      requires_phone_auth: false,
      blocked_by_employee: false
    },
    shareTitle: '请确认月度考勤',
    sharePath: '',
    signaturePreview: '',
    hasSignature: false,
    submitting: false,
    returnAttendance: null,
    showReturnAttendance: false
  },

  onLoad(options) {
    const returnYear = options.returnYear ? Number(options.returnYear) : null;
    const returnMonth = options.returnMonth ? Number(options.returnMonth) : null;
    const returnAttendance = returnYear && returnMonth
      ? {
        year: returnYear,
        month: returnMonth,
        contractId: options.returnContractId || '',
        signatureToken: options.returnSignatureToken || ''
      }
      : null;
    this.setData({
      token: options.token || '',
      selectedYear: options.year ? Number(options.year) : null,
      selectedMonth: options.month ? Number(options.month) : null,
      contractId: options.contractId || '',
      returnAttendance,
      showReturnAttendance: Boolean(returnAttendance)
    });
    this.loadForm();
  },

  async loadForm() {
    if (!this.data.token) {
      wx.showToast({ title: '缺少签署 token', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加载中' });
    try {
      await api.ensureOpenid('customer');
      const result = await api.attendanceSignDetail(this.data.token, {
        year: this.data.selectedYear,
        month: this.data.selectedMonth,
        contractId: this.data.contractId
      });
      const form = result.attendance_form || {};
      const holidays = await this.loadHolidays(form.actual_year || form.year);
      this.applyForm(form, holidays, result.auth || null);
    } catch (error) {
      wx.showToast({ title: error.message || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async loadHolidays(year) {
    if (!year) return {};
    try {
      const result = await api.holidays(year);
      const holidays = result.holidays || {};
      this.setData({ holidays, holidayYear: year });
      return holidays;
    } catch (error) {
      this.setData({ holidays: {} });
      return {};
    }
  },

  applyForm(form, holidays = this.data.holidays || {}, authState = this.data.auth) {
    const normalizedForm = {
      ...form,
      contract_info: form.contract_info || {}
    };
    const initialData = normalizeAttendanceData(form.form_data || {});
    normalizedForm.contract_info = normalizeContractInfoForAttendance(normalizedForm, initialData);
    const initialCalendar = buildCalendar(normalizedForm, initialData, holidays);
    const attendanceData = normalizeAutoOvertime(initialData, normalizedForm, initialCalendar.monthDays, holidays);
    const calendar = buildCalendar(normalizedForm, attendanceData, holidays);
    const stats = calculateStats(attendanceData, calendar.monthDays, normalizedForm, holidays);
    const specialRecords = buildSpecialRecords(attendanceData, normalizedForm);
    const contractInfo = normalizedForm.contract_info || {};
    const signatureData = normalizedForm.signature_data || {};
    const currentSignatureImage = signatureImage(signatureData);
    const isSigned = ['customer_signed', 'synced'].includes(normalizedForm.status) || Boolean(currentSignatureImage);
    const auth = authState || {};
    const authBlockedByEmployee = Boolean(auth.blocked_by_employee);
    const requiresPhoneAuth = false;
    const blockedByEmployeeRole = (isEmployeeSignedIn() || authBlockedByEmployee) && !isSigned;
    const selectedMonth = normalizedForm.actual_month || normalizedForm.month || '-';
    const signedAt = normalizedForm.customer_signed_at || signatureData.signed_at;
    const shareTitle = `请确认${contractInfo.employee_name || '服务人员'}${selectedMonth && selectedMonth !== '-' ? `${selectedMonth}月` : ''}考勤`;
    const sharePath = `/pages/attendance-sign/index?token=${encodeURIComponent(this.data.token)}`;

    this.setData({
      form: {
        ...normalizedForm,
        date_range: `${formatFullDate(normalizedForm.cycle_start_date)} - ${formatFullDate(normalizedForm.cycle_end_date)}`
      },
      attendanceData,
      dateRangeText: `${formatFullDate(normalizedForm.cycle_start_date)} - ${formatFullDate(normalizedForm.cycle_end_date)}`,
      customerNameText: contractInfo.customer_name || '请确认考勤信息',
      employeeNameText: contractInfo.employee_name || '服务人员',
      avatarText: contractInfo.employee_name ? String(contractInfo.employee_name).slice(-2) : '员工',
      pageTitleText: monthTitle(normalizedForm),
      monthText: selectedMonth,
      stats,
      monthDays: calendar.monthDays.map(formatAttendanceDate),
      calendarCells: calendar.cells,
      specialRecords,
      showSpecialRecords: specialRecords.length > 0,
      showHolidayOvertimeStat: Number(stats.holidayOvertimeDays || 0) > 0,
      showAutoBanner: Number(stats.autoOvertimeDays || 0) > 0,
      isSigned,
      showSignedCard: isSigned,
      signatureImage: currentSignatureImage,
      signedAtText: formatDateTime(signedAt),
      signedNameText: signatureData.signer_name || contractInfo.customer_name || '客户',
      blockedByEmployeeRole,
      auth: {
        authenticated: Boolean(isSigned || auth.authenticated),
        requires_phone_auth: requiresPhoneAuth,
        blocked_by_employee: authBlockedByEmployee
      },
      statusText: blockedByEmployeeRole ? '员工端仅可分享给客户，不能代客户签署' : buildStatusText(normalizedForm, isSigned),
      shareTitle,
      sharePath
    });
  },

  onCalendarDayTap(event) {
    const { date, disabled, auto, typeLabel, time } = event.currentTarget.dataset;
    if (!date) return;
    if (disabled === true || disabled === 'true') {
      wx.showToast({ title: '该日期不在合同服务期内', icon: 'none' });
      return;
    }
    if (auto === true || auto === 'true') {
      this.openAutoOvertimeInfo();
      return;
    }

    const coveringRecord = findCoveringRecord(this.data.attendanceData, date);
    const originalRecord = findOriginalRecord(this.data.attendanceData, date);
    const record = originalRecord || coveringRecord;
    if (record) {
      const typeText = record.typeLabel || typeLabel || '考勤';
      const timeText = record.timeLabel || time || '详见考勤详情';
      wx.showModal({
        title: `${formatMonthDay(date)} ${typeText}`,
        content: timeText,
        showCancel: false,
        confirmText: '我知道了'
      });
      return;
    }

    wx.showModal({
      title: `${formatMonthDay(date)} 考勤`,
      content: `${typeLabel || '出勤'}${time ? `\n${time}` : ''}`,
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  onRecordTap(event) {
    const { index } = event.currentTarget.dataset;
    const record = this.data.specialRecords[Number(index)];
    if (!record) return;
    if (record.is_auto) {
      this.openAutoOvertimeInfo();
      return;
    }
    wx.showModal({
      title: record.typeLabel || '考勤详情',
      content: [record.timeLabel, record.showDuration ? record.durationText : ''].filter(Boolean).join('\n'),
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  goOnboardingAttendance(event) {
    const { year, month, contractId, contractid, signatureToken, signaturetoken } = event.currentTarget.dataset;
    const targetYear = Number(year);
    const targetMonth = Number(month);
    if (!targetYear || !targetMonth || !this.data.token) return;
    const targetContractId = contractId || contractid || (this.data.form && this.data.form.contract_id);
    const targetToken = signatureToken || signaturetoken || this.data.token;
    const currentForm = this.data.form || {};
    const currentYear = this.data.selectedYear || currentForm.actual_year || currentForm.year;
    const currentMonth = this.data.selectedMonth || currentForm.actual_month || currentForm.month;
    const currentContractId = this.data.contractId || currentForm.contract_id || '';
    const params = [
      `token=${encodeURIComponent(targetToken)}`,
      `year=${targetYear}`,
      `month=${targetMonth}`
    ];
    if (targetContractId) params.push(`contractId=${encodeURIComponent(targetContractId)}`);
    if (currentYear && currentMonth) {
      params.push(`returnYear=${encodeURIComponent(currentYear)}`);
      params.push(`returnMonth=${encodeURIComponent(currentMonth)}`);
      if (currentContractId) params.push(`returnContractId=${encodeURIComponent(currentContractId)}`);
      params.push(`returnSignatureToken=${encodeURIComponent(this.data.token)}`);
    }
    wx.navigateTo({ url: `/pages/attendance-sign/index?${params.join('&')}` });
  },

  goReturnAttendance() {
    const target = this.data.returnAttendance;
    if (!target || !target.year || !target.month) return;
    const params = [
      `token=${encodeURIComponent(target.signatureToken || this.data.token)}`,
      `year=${encodeURIComponent(target.year)}`,
      `month=${encodeURIComponent(target.month)}`
    ];
    if (target.contractId) params.push(`contractId=${encodeURIComponent(target.contractId)}`);
    wx.redirectTo({ url: `/pages/attendance-sign/index?${params.join('&')}` });
  },

  openAutoOvertimeInfo() {
    wx.showModal({
      title: '自动补齐说明',
      content: '本月出勤天数已超过 26 天上限，超出上限的加班时长已自动折算至对应日期。此记录由系统生成，客户确认时无需手动调整。',
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  openSignatureModal() {
    if (this.data.isSigned) return;
    if (this.data.blockedByEmployeeRole) {
      wx.showModal({
        title: '请分享给客户签署',
        content: this.data.employeeBlockText,
        showCancel: false,
        confirmText: '我知道了'
      });
      return;
    }
    this.setData({ hasSignature: false, signaturePreview: '' }, () => {
      wx.navigateTo({ url: '/pages/signature-pad/index?return=attendance-sign' });
    });
  },

  clearSignature() {
    this.setData({ hasSignature: false, signaturePreview: '' });
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
    if (this.data.isSigned) {
      wx.showToast({ title: '考勤已签署', icon: 'none' });
      return;
    }
    if (this.data.blockedByEmployeeRole) {
      wx.showToast({ title: '员工不能代客户签署', icon: 'none' });
      return;
    }
    if (!this.data.hasSignature) {
      wx.showToast({ title: '请先签名', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const image = await this.readFileBase64(this.data.signaturePreview);
      const signatureData = {
        image,
        signed_at: new Date().toISOString(),
        signer_name: (getApp().globalData.customer && getApp().globalData.customer.name)
          || this.data.customerNameText
          || '客户',
        signed_from: 'miniapp'
      };
      const result = await api.submitAttendanceSign(this.data.token, {
        openid: api.getOpenid(),
        signature_data: signatureData
      });
      const nextForm = result.form || result.attendance_form || {
        ...this.data.form,
        status: 'customer_signed',
        customer_signed_at: signatureData.signed_at,
        signature_data: signatureData
      };
      this.applyForm(nextForm);
      this.setData({ hasSignature: false, signaturePreview: '' });
      wx.showToast({ title: '确认完成', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '确认失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  goEmployeeHome() {
    wx.redirectTo({ url: '/pages/employee-home/index' });
  },

  onShareAppMessage() {
    return {
      title: this.data.shareTitle || '请确认月度考勤',
      path: this.data.sharePath || `/pages/attendance-sign/index?token=${encodeURIComponent(this.data.token || '')}`
    };
  }
});
