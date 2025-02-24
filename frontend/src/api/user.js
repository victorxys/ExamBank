import api from './axios';

export default {
  // 根据用户ID获取用户详细信息
  getUserInfo: (userId) => api.get(`/users/${userId}`),
  
  // 获取用户完整信息（包括姓名、手机号、角色、状态）
  getUserDetails: (userId) => api.get(`/users/${userId}/details`)
};