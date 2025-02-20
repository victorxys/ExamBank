import axios from './axios';

export const login = async (username, phoneNumber) => {
  try {
    const response = await axios.post('/users/login', {
      username,
      phone_number: phoneNumber
    });
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || '登录失败');
  }
};

export const register = async (username, phoneNumber) => {
  try {
    const response = await axios.post('/users/register', {
      username,
      phone_number: phoneNumber
    });
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || '注册失败');
  }
};

export const logout = async () => {
  try {
    await axios.post('/users/logout');
  } catch (error) {
    console.error('登出失败:', error);
  }
};

export const checkAuth = async () => {
  try {
    const response = await axios.get('/users/check-auth');
    return response.data;
  } catch (error) {
    return null;
  }
};