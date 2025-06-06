// frontend/src/api/ai.js
import api from './axios';

export default {
  // 生成AI评价
  generateAIEvaluation: (evaluations, userId) => {
    // 这个函数现在非常简洁。它发起请求。
    // 如果成功，调用它的地方会拿到 response。
    // 如果失败，axios拦截器或这里的catch会抛出错误，
    // 调用它的地方的 try...catch 将会捕获到这个错误。
    return api.post('/ai-generate', { evaluations, evaluated_user_id: userId })
      .catch(error => {
        // 直接重新抛出错误，让调用者处理
        // Axios的错误对象通常在 error.response 中包含更多信息
        throw error;
      });
  }
};