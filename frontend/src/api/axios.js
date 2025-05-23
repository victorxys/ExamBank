// frontend/src/api/axios.js
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getToken, getRefreshToken, saveToken, clearTokens, shouldRefreshToken } from './auth-utils';

const baseURL = API_BASE_URL || 'http://127.0.0.1:5000/api';

const api = axios.create({
  baseURL: baseURL,
  // headers: { // 将默认 Content-Type 的设置移到下面的拦截器中
  //   'Content-Type': 'application/json',
  // },
  timeout: 300000,
  withCredentials: true,
  validateStatus: function (status) {
    return status >= 200 && status < 500;
  },
  retry: 3, // 如果您不需要全局重试，可以注释掉或移除
  retryDelay: 1000
});

// 请求拦截器
api.interceptors.request.use(
  async (config) => {
    // --- Token 处理逻辑 (保持不变) ---
    const isPublicRoute = config.url.includes('/profile') || 
                          config.url.includes('/employee-profile/') || 
                          config.url.includes('/evaluation-items') || 
                          config.url.includes('/knowledge-point-summary') || 
                          config.url.includes('/employee-self-evaluation');
    const token = getToken();
    
    if (!isPublicRoute && !token) {
      // 对于非公共路由且无token的情况，可以选择不修改Content-Type，让错误处理流程继续
      // 或者直接拒绝，如您之前的逻辑
      return Promise.reject(new Error('未登录'));
    }
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      if (shouldRefreshToken()) { // 确保 shouldRefreshToken 和 getRefreshToken 正确工作
        try {
          const refreshToken = getRefreshToken();
          if (refreshToken) { // 确保有 refreshToken
            const response = await axios.post(`${baseURL}/auth/refresh-token`, { // 假设刷新token的路由是 /auth/refresh-token
              refresh_token: refreshToken
            });
            const { access_token: newToken, refresh_token: newRefreshToken } = response.data; // 假设返回的是 access_token
            saveToken(newToken, newRefreshToken, true); // 假设 isRememberMe 为 true
            config.headers.Authorization = `Bearer ${newToken}`;
          } else {
            // 没有 refresh token，无法刷新，可能需要引导用户重新登录
            clearTokens();
            // window.location.href = '/login'; // 或者通过其他方式处理
            return Promise.reject(new Error('Refresh token not available. Please login again.'));
          }
        } catch (error) {
          console.error('Token刷新失败:', error);
          clearTokens();
          // window.location.href = '/login'; // 避免在拦截器中直接跳转，让组件或路由处理
          return Promise.reject(error); // 将错误传递下去
        }
      }
    }
    // --- Token 处理逻辑结束 ---

    // +++++ 新增: 根据请求数据类型设置或清除 Content-Type +++++
    if (config.data instanceof FormData) {
      // 当数据是 FormData 时，axios 会自动设置正确的 Content-Type (multipart/form-data)
      // 并包含正确的 boundary。我们应该删除任何可能冲突的全局 Content-Type 设置。
      delete config.headers['Content-Type'];
    } else if (config.headers && !config.headers['Content-Type']) {
      // 如果不是 FormData，并且请求头中没有显式设置 Content-Type，
      // 那么我们可以默认它是 JSON。
      // (如果您的应用主要使用 JSON API 的话)
      config.headers['Content-Type'] = 'application/json';
    }
    // +++++++++++++++++++++++++++++++++++++++++++++++++++++

    return config;
  },
  (error) => {
    // console.warn('[Axios Interceptor] Request error:', error); // config 可能未定义在错误对象中
    return Promise.reject(error);
  }
);

// 响应拦截器 (保持您之前的逻辑，或按需调整)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // (您的 Token 过期刷新逻辑 - 确保 /auth/refresh-token 路由正确)
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = getRefreshToken();
        if (!refreshToken) {
          // console.log("No refresh token available, redirecting to login.");
          // clearTokens();
          // window.location.href = '/login'; // 同样，避免在拦截器中直接跳转
          return Promise.reject(new Error('No refresh token available.'));
        }

        const response = await axios.post(`${baseURL}/auth/refresh-token`, { // 确认刷新路由
          refresh_token: refreshToken
        });

        const { access_token, refresh_token: newRefToken } = response.data; // 确认返回字段名
        saveToken(access_token, newRefToken, true); // 确认保存逻辑

        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return api(originalRequest); // 使用 api 实例重试，而不是 axios
      } catch (refreshError) {
        console.error('Token刷新彻底失败:', refreshError);
        clearTokens();
        // window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

export default api;