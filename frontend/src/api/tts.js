// frontend/src/api/tts.js (新增或修改)
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
  // TtsScript - 手动更新最终脚本内容
  updateFinalTtsScriptContent: (scriptId, content) => api.put(`/tts/scripts/${scriptId}`, { content }),


  // --- 触发处理流程的 API ---
  generateOralScript: (contentId) => api.post(`/tts/scripts/${contentId}/generate-oral-script`),
  triggerTtsRefine: (oralScriptId) => api.post(`/tts/scripts/${oralScriptId}/tts-refine`),
  triggerLlmRefine: (refinedScriptId) => api.post(`/tts/scripts/${refinedScriptId}/llm-refine`),
  splitSentences: (finalScriptId) => api.post(`/tts/scripts/${finalScriptId}/split-sentences`),

  // TtsSentence - 列表和删除
  getTaskStatus: (taskId) => api.get(`/tts/task-status/${taskId}`),

  // --- 按句子生成语音 API ---
  generateSentenceAudio: (sentenceId, params = {}) => api.post(`/tts/sentences/${sentenceId}/generate-audio`, params),

  // TtsSentence - 手动更新句子文本
  updateSentenceText: (sentenceId, sentenceText) => api.put(`/tts/sentences/${sentenceId}`, { sentence_text: sentenceText }),

  // TtsAudio - 列表和删除 (其他如生成、合并的触发在上面)
  getAudiosByContent: (contentId, params) => api.get(`/tts/audios/by-content/${contentId}`, { params }),
  deleteAudio: (audioId) => api.delete(`/tts/audios/${audioId}`),
  
  // 获取 LLM Prompts (用于上传内容时的选择器)
  getLlmPrompts: () => api.get('/llm-config/prompts'), 
};