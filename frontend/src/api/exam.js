import api from './axios';

export const examApi = {
  // 获取考试列表
  getExams: () => api.get('/api/exams'),
  
  // 获取考试详情
  getExamDetail: (examId) => api.get(`/api/exams/${examId}/detail`),
  
  // 获取考试题目
  getExamQuestions: (examId) => api.get(`/api/exams/${examId}/take`),
  
  // 提交考试答案
  submitExam: (examId, data) => api.post(`/api/exams/${examId}/submit`, data),
  
  // 创建考试
  createExam: (data) => api.post('/api/exams', data),
  
  // 删除考试
  deleteExam: (examId) => api.delete(`/api/exams/${examId}`),
  
  // 获取考试记录
  getExamRecords: () => api.get('/api/exam-records'),
  
  // 获取考试记录详情
  getExamRecordDetail: (examId, userId, examTime) => 
    api.get(`/api/exam-records/${examId}/${userId}`, {
      params: { exam_time: examTime }
    })
};

export const courseApi = {
  // 获取课程列表
  getCourses: () => api.get('/api/courses'),
  
  // 获取知识点
  getKnowledgePoints: (courseIds) => 
    api.get(`/api/courses/${courseIds.join(',')}/points`)
};

export const userApi = {
  // 发送验证码
  sendCode: (phone) => api.post('/api/users/login', { phone }),
  
  // 验证登录
  verifyCode: (phone, code) => 
    api.post('/api/users/login', { phone, code })
};
