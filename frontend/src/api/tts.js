// frontend/src/api/tts.js
import api from './axios'; // 您的 axios 实例

export const ttsApi = {
  // TrainingContent
  createTrainingContent: (data) => api.post('/tts/training-contents', data),
  getTrainingContentsByCourse: (courseId) => api.get(`/tts/training-contents/by-course/${courseId}`),
  getTrainingContentDetail: (contentId) => api.get(`/tts/training-contents/${contentId}`),
  getOriginalTrainingContent: (contentId) => api.get(`/tts/training-contents/${contentId}/original`),
  updateTrainingContent: (contentId, data) => api.put(`/tts/training-contents/${contentId}`, data),
  deleteTrainingContent: (contentId) => api.delete(`/tts/training-contents/${contentId}`),

  // TtsScript - 获取脚本内容
  getScriptContent: (scriptId) => api.get(`/tts/scripts/${scriptId}`),
  // TtsScript - 手动更新脚本内容 (renamed for general use)
  updateScriptContent: (scriptId, content) => api.put(`/tts/scripts/${scriptId}`, { content }),

  // 新增：专门用于更新原始培训内容的 API
  updateOriginalTrainingContent: (contentId, originalContent) => 
    api.put(`/tts/training-contents/${contentId}/original-content`, { original_content: originalContent }),

  // --- 触发处理流程的 API ---
  generateOralScript: (contentId) => api.post(`/tts/scripts/${contentId}/generate-oral-script`),
  triggerTtsRefine: (oralScriptId) => api.post(`/tts/scripts/${oralScriptId}/tts-refine`),
  triggerLlmRefine: (refinedScriptId) => api.post(`/tts/scripts/${refinedScriptId}/llm-refine`),
  splitSentences: (finalScriptId) => api.post(`/tts/scripts/${finalScriptId}/split-sentences`),

  // Task Status
  getTaskStatus: (taskId) => api.get(`/tts/task-status/${taskId}`),

  // --- 按句子生成语音 API ---
  generateSentenceAudio: (sentenceId, params = {}) => api.post(`/tts/sentences/${sentenceId}/generate-audio`, params),
  // 批量生成语音
  batchGenerateAudioForContent: (contentId) => api.post(`/tts/training-contents/${contentId}/batch-generate-audio`),

  // TtsSentence - 手动更新句子文本
  updateSentence: (sentenceId, data) => api.put(`/tts/sentences/${sentenceId}`, data),

  // 新增：删除句子及其语音
  deleteSentence: (sentenceId) => api.delete(`/tts/sentences/${sentenceId}`),

  // TtsAudio - 列表和删除 (其他如生成、合并的触发在上面)
  getAudiosByContent: (contentId, params) => api.get(`/tts/audios/by-content/${contentId}`, { params }),
  deleteAudio: (audioId) => api.delete(`/tts/audios/${audioId}`),
  
  // 获取 LLM Prompts (用于上传内容时的选择器)
  getLlmPrompts: () => api.get('/llm-config/prompts'), 
};