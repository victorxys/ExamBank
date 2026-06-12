// frontend/src/api/wechat.js
import api from './axios';

/**
 * 分页拉取企业微信推送日志
 * @param {Object} params - { page, per_page, status, message_type, touser }
 */
export const getWechatMessageLogs = async (params) => {
  const response = await api.get('/contracts/wechat-messages', { params });
  return response.data;
};

/**
 * 手动重试发送某条推送日志
 * @param {number|string} logId 
 */
export const retryWechatMessage = async (logId) => {
  const response = await api.post(`/contracts/wechat-messages/${logId}/retry`);
  return response.data;
};

export const getMiniappOpenidLinks = async (params) => {
  const response = await api.get('/admin/wechat/miniapp-openids', { params });
  return response.data;
};

export const deleteMiniappOpenidLink = async (role, accountId) => {
  const response = await api.delete(`/admin/wechat/miniapp-openids/${role}/${accountId}`);
  return response.data;
};
