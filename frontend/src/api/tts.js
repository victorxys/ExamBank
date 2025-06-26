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
  skipTtsRefine: (oralScriptId) => api.post(`/tts/scripts/${oralScriptId}/skip-tts-refine`),
  triggerLlmRefine: (refinedScriptId) => api.post(`/tts/scripts/${refinedScriptId}/llm-refine`),
  splitSentences: (finalScriptId) => api.post(`/tts/scripts/${finalScriptId}/split-sentences`),

  // Task Status
  getTaskStatus: (taskId) => api.get(`/tts/task-status/${taskId}`),

  // --- 按句子生成语音 API ---
  generateSentenceAudio: (sentenceId, params = {}) => api.post(`/tts/sentences/${sentenceId}/generate-audio`, params),
  // 批量生成语音
  batchGenerateAudioForContent: (contentId, data) => api.post( 
    `/tts/training-contents/${contentId}/batch-generate-audio`, 
    data // <--- 将 data 参数传递给 api.post
  ), 

  mergeAudio: (contentId) => api.post(`/tts/training-contents/${contentId}/merge-audio`),
  getMergedAudioSegments: (mergedAudioId) => api.get(`/tts/audios/${mergedAudioId}/segments`), // New API call
  // 新增：合并当前生成的语音
  mergeCurrentGeneratedAudios: (contentId) => api.post(`/tts/training-contents/${contentId}/merge-current-audio`),

  // TtsConfig - 获取和更新配置
  updateTrainingContentTtsConfig: (contentId, config) => api.put(`/tts/training-contents/${contentId}/tts-config`, config),

  // TtsSentence - 跟新句子TTS配置
  updateSentenceTtsConfig: (sentenceId, config) => api.put(`/tts/sentences/${sentenceId}/tts-config`, config),

  // TtsSentence - 手动更新句子文本
  updateSentence: (sentenceId, data) => api.put(`/tts/sentences/${sentenceId}`, data),

  // ++++++ 新增：手动触发重新拆分和匹配的 API ++++++
  triggerResplitAndMatch: (finalScriptId) => api.post(`/tts/scripts/${finalScriptId}/resplit-and-match`),


  // 新增：删除句子及其语音
  deleteSentence: (sentenceId) => api.delete(`/tts/sentences/${sentenceId}`),

  // TtsAudio - 列表和删除 (其他如生成、合并的触发在上面)
  getAudiosByContent: (contentId, params) => api.get(`/tts/audios/by-content/${contentId}`, { params }),
  deleteAudio: (audioId) => api.delete(`/tts/audios/${audioId}`),
  
  // 获取 LLM Prompts (用于上传内容时的选择器)
  getLlmPrompts: () => api.get('/llm-config/prompts'), 

  // 新增：获取最新的视频合成任务状态
  getLatestSynthesisTask: (contentId) => api.get(`/tts/content/${contentId}/video-synthesis/latest`),

  // 新增：触发视频合成分析
  startVideoAnalysis: (contentId, pptFile, promptId) => {
    const formData = new FormData();
    formData.append('ppt_pdf', pptFile);
    formData.append('prompt_id', promptId);
    return api.post(`/tts/content/${contentId}/video-synthesis/analyze`, formData);
    // 注意：axios 会自动处理 multipart/form-data 的 Content-Type
  },

  // 新增：触发最终视频合成
  startVideoSynthesis: (synthesisId, finalScriptData) => {
    // 注意蓝图前缀 /api/tts 会被axios自动加上
    return api.post(`/tts/synthesis/${synthesisId}/synthesize`, finalScriptData);
  },

  resetSynthesisTask: (synthesisId) => {
        return api.post(`/tts/synthesis/${synthesisId}/reset`);
    },
  
  updateVideoScript: (synthesisId, scriptData) => {
    return api.put(`/tts/synthesis/${synthesisId}/script`, { video_script_json: scriptData });
  },

};