import api from './axios';

export default {
  // 根据用户ID获取用户信息
  getUserInfo: (userId) => api.get(`/users/${userId}`)
};