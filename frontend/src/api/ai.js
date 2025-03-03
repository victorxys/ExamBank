import api from './axios';

export default {
  // 生成AI评价
  generateAIEvaluation: (evaluations, userId) => {
    console.log('提交AI评价数据前:', evaluations);
    return api.post('/ai-generate', { evaluations, evaluated_user_id: userId }, {
      timeout: 300000 // 设置5分钟超时时间
    })
      .then(response => {
        console.log('AI评价生成响应:', response.data);
        return response;
      })
      .catch(error => {
        console.error('AI评价生成失败:', error);
        throw error;
      });
  }
};