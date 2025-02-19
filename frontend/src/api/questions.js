import { API_BASE_URL } from '../config';

// 获取题目列表
export const getQuestions = async (params = {}) => {
  try {
    const queryString = new URLSearchParams(params).toString();
    const response = await fetch(`${API_BASE_URL}/questions${queryString ? `?${queryString}` : ''}`);
    if (!response.ok) {
      throw new Error('获取题目列表失败');
    }
    return await response.json();
  } catch (error) {
    console.error('获取题目列表出错:', error);
    throw error;
  }
};

// 删除题目
export const deleteQuestion = async (questionId) => {
  try {
    const response = await fetch(`${API_BASE_URL}/questions/${questionId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('删除题目失败');
    }
    return await response.json();
  } catch (error) {
    console.error('删除题目出错:', error);
    throw error;
  }
};

// 更新题目
export const updateQuestion = async (questionId, questionData) => {
  try {
    const response = await fetch(`${API_BASE_URL}/questions/${questionId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(questionData),
    });
    if (!response.ok) {
      throw new Error('更新题目失败');
    }
    return await response.json();
  } catch (error) {
    console.error('更新题目出错:', error);
    throw error;
  }
};