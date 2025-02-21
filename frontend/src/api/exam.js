import api from './axios';

export const examApi = {
  // 获取考试列表
  getExams: () => api.get('/exams'),
  
  // 获取考试详情
  getExamDetail: (examId) => api.get(`/exams/${examId}/detail`),
  
  // 获取考试题目
  getExamQuestions: (examId) => api.get(`/exams/${examId}/take`),
  
  // 提交考试答案
  submitExam: (examId, data) => api.post(`/exams/${examId}/submit`, data),
  
  // 创建考试
  createExam: (data) => api.post('/exams', data),
  
  // 删除考试
  deleteExam: (examId) => api.delete(`/exams/${examId}`),
  
  // 获取考试记录
  getExamRecords: () => api.get('/exam-records'),
  
  // 获取考试记录详情
  getExamRecordDetail: (examId, userId, examTime) => 
    api.get(`/exam-records/${examId}/${userId}`, {
      params: { exam_time: examTime }
    }),
  
  // 获取临时答案
  getTempAnswers: (examId, userId) => 
    api.get(`/exams/${examId}/temp-answers/${userId}`),

};

export const courseApi = {
  // 获取课程列表
  getCourses: () => api.get('/courses'),
  
  // 获取知识点
  getKnowledgePoints: (courseIds) => 
    api.get(`/courses/${courseIds}/knowledge_points`)
};

export const userApi = {
  // 发送验证码
  sendCode: (phone) => api.post('/users/login', { phone }),
  
  // 验证登录
  verifyCode: (phone, code) => 
    api.post('/users/login', { phone, code })
};

export const questionApi = {
  // 获取题目列表
  getQuestions: (search = '', type = 'question') => 
    api.get('/questions', { params: { search, type } }),
  
  // 更新题目
  updateQuestion: (questionId, data) => 
    api.put(`/questions/${questionId}`, data),
  
  // 删除题目
  deleteQuestion: (questionId) => 
    api.delete(`/questions/${questionId}`)
};
