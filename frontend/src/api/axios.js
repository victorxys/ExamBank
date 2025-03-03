import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getToken, getRefreshToken, saveToken, clearTokens, shouldRefreshToken } from './auth-utils';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 设置超时时间为10秒
  validateStatus: function (status) {
    return status >= 200 && status < 500; // 只有状态码大于等于500时才会reject
  },
});

// 请求拦截器：添加Token到请求头
api.interceptors.request.use(
  async (config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;

      // 检查Token是否需要刷新
      if (shouldRefreshToken()) {
        try {
          const refreshToken = getRefreshToken();
          const response = await axios.post(`${API_BASE_URL}/users/refresh-token`, {
            refresh_token: refreshToken
          });
          
          const { token: newToken, refresh_token: newRefreshToken } = response.data;
          saveToken(newToken, newRefreshToken, true);
          config.headers.Authorization = `Bearer ${newToken}`;
        } catch (error) {
          console.error('Token刷新失败:', error);
          clearTokens();
          window.location.href = '/login';
          return Promise.reject(error);
        }
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器：处理Token过期等错误
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // 如果是401错误且没有重试过
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = getRefreshToken();
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        const response = await axios.post(`${API_BASE_URL}/users/refresh-token`, {
          refresh_token: refreshToken
        });

        const { token, refresh_token } = response.data;
        saveToken(token, refresh_token, true);

        // 使用新Token重试原请求
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return api(originalRequest);
      } catch (refreshError) {
        console.error('Token刷新失败:', refreshError);
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
