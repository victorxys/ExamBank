// src/api/llm.js (示例，你需要根据你的后端 API 实现)
import api from './axios'; // 你的 axios 实例

export const llmApi = {
  // Models
  getModels: () => api.get('/llm-config/models'),
  createModel: (data) => api.post('/llm-config/models', data),
  updateModel: (id, data) => api.put(`/llm-config/models/${id}`, data),
  deleteModel: (id) => api.delete(`/llm-config/models/${id}`),

  // API Keys
  getApiKeys: () => api.get('/llm-config/api-keys'),
  createApiKey: (data) => api.post('/llm-config/api-keys', data),
  updateApiKey: (id, data) => api.put(`/llm-config/api-keys/${id}`, data),
  deleteApiKey: (id) => api.delete(`/llm-config/api-keys/${id}`),

  // Prompts
  getPrompts: () => api.get('/llm-config/prompts'),
  createPrompt: (data) => api.post('/llm-config/prompts', data),
  updatePrompt: (id, data) => api.put(`/llm-config/prompts/${id}`, data),
  deletePrompt: (id) => api.delete(`/llm-config/prompts/${id}`),

  // Call Logs
  getCallLogs: (params) => api.get('/llm-logs', { params }), // 支持分页和过滤
  getCallLogDetail: (logId) => api.get(`/llm-logs/${logId}`),
};