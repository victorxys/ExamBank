const { apiBaseUrl, devMockOpenid, enableMockLogin } = require('../config/index');

const app = () => getApp();
const apiOrigin = apiBaseUrl.replace(/\/api\/?$/, '');

function getOpenid() {
  return app().globalData.openid || wx.getStorageSync('miniapp_openid') || '';
}

function wxLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (res.code) {
          resolve(res.code);
          return;
        }
        reject(new Error('微信登录未返回 code'));
      },
      fail: reject
    });
  });
}

function request(options) {
  const { url, method = 'GET', data = {}, header = {} } = options;
  const openid = getOpenid();
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBaseUrl}${url}`,
      method,
      data,
      header: {
        'content-type': 'application/json',
        ...(openid ? { 'X-Miniapp-Openid': openid } : {}),
        ...header
      },
      success(res) {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (body && body.success === false) {
            reject(new Error(body.error || body.message || '操作失败'));
            return;
          }
          resolve(body);
          return;
        }
        reject(new Error(body.error || body.message || `请求失败 ${res.statusCode}`));
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络请求失败'));
      }
    });
  });
}

function assetUrl(path) {
  if (!path) return '';
  if (/^(https?:|data:|wxfile:|cloud:)/.test(path)) return path;
  return `${apiOrigin}${path.startsWith('/') ? path : `/${path}`}`;
}

function miniappIconUrl(key) {
  return `${apiBaseUrl}/miniapp/icons/${encodeURIComponent(key)}.svg`;
}

async function ensureOpenid(role = '') {
  const existing = getOpenid();
  if (existing) return existing;

  let result;
  try {
    const code = await wxLoginCode();
    result = await request({ url: '/miniapp/auth/login', method: 'POST', data: { code } });
  } catch (error) {
    if (!enableMockLogin || !devMockOpenid) throw error;
    result = await request({ url: '/miniapp/auth/login', method: 'POST', data: { mock_openid: devMockOpenid } });
  }

  const openid = result.openid || devMockOpenid;
  const sessionRole = role || result.default_role || '';
  if (app().setSession) {
    app().setSession(openid, result.customer || null, result.employee || null, sessionRole, result.staff_user || null);
  } else {
    wx.setStorageSync('miniapp_openid', openid);
    if (sessionRole) wx.setStorageSync('miniapp_role', sessionRole);
    if (result.staff_user) wx.setStorageSync('miniapp_staff_user', result.staff_user);
  }
  return openid;
}

function buildQuery(params = {}) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

module.exports = {
  getOpenid,
  ensureOpenid,
  assetUrl,
  miniappIconUrl,
  login(data) {
    return request({ url: '/miniapp/auth/login', method: 'POST', data });
  },
  bindPhone(data) {
    return request({ url: '/miniapp/auth/bind-phone', method: 'POST', data });
  },
  bindEmployee(data) {
    return request({ url: '/miniapp/auth/bind-employee', method: 'POST', data });
  },
  overview() {
    return request({ url: '/miniapp/customer/overview' });
  },
  employeeOverview() {
    return request({ url: '/miniapp/employee/overview' });
  },
  holidays(year) {
    return request({ url: `/miniapp/holidays/${year}` });
  },
  contractList(statusGroup = 'all') {
    return request({ url: `/miniapp/customer/contracts?status_group=${statusGroup}` });
  },
  employeeContractList(statusGroup = 'all') {
    return request({ url: `/miniapp/employee/contracts?status_group=${statusGroup}` });
  },
  contractDetail(contractId) {
    return request({ url: `/miniapp/customer/contracts/${contractId}` });
  },
  employeeContractDetail(contractId) {
    return request({ url: `/miniapp/employee/contracts/${contractId}` });
  },
  contractEvaluation(contractId) {
    return request({ url: `/miniapp/customer/contracts/${contractId}/evaluation` });
  },
  submitContractEvaluation(contractId, data) {
    return request({ url: `/miniapp/customer/contracts/${contractId}/evaluation`, method: 'POST', data });
  },
  employeeExitSummary(contractId) {
    return request({ url: `/miniapp/employee/contracts/${contractId}/exit-summary` });
  },
  submitEmployeeExitSummary(contractId, data) {
    return request({ url: `/miniapp/employee/contracts/${contractId}/exit-summary`, method: 'POST', data });
  },
  contractSignDetail(token) {
    return request({ url: `/miniapp/contracts/sign/${token}` });
  },
  submitContractSign(token, data) {
    return request({ url: `/miniapp/contracts/sign/${token}`, method: 'POST', data });
  },
  attendanceSignDetail(token, params = {}) {
    const query = buildQuery(params);
    return request({ url: `/miniapp/attendance/sign/${token}${query ? `?${query}` : ''}` });
  },
  verifyAttendanceSign(token, data) {
    return request({ url: `/miniapp/attendance/sign/${token}/auth`, method: 'POST', data });
  },
  submitAttendanceSign(token, data) {
    return request({ url: `/miniapp/attendance/sign/${token}`, method: 'POST', data });
  },
  employeeAttendanceList(params = {}) {
    const query = buildQuery(params);
    return request({ url: `/miniapp/employee/attendance${query ? `?${query}` : ''}` });
  },
  employeeAttendanceDetail(formId) {
    return request({ url: `/miniapp/employee/attendance/${formId}` });
  },
  employeeAttendanceByToken(token, params = {}) {
    const query = buildQuery(params);
    return request({ url: `/miniapp/employee/attendance/by-token/${token}${query ? `?${query}` : ''}` });
  },
  updateEmployeeAttendance(formId, data) {
    return request({ url: `/miniapp/employee/attendance/${formId}`, method: 'PUT', data });
  },
  ayiOptions() {
    return request({ url: '/miniapp/ayi/options' });
  },
  ayiSearch(params = {}) {
    const query = buildQuery(params);
    return request({ url: `/miniapp/ayi/search${query ? `?${query}` : ''}` });
  },
  ayiDetail(id) {
    return request({ url: `/miniapp/ayi/${id}` });
  }
};
