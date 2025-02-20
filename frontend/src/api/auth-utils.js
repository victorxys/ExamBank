import Cookies from 'js-cookie';

const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const REMEMBER_ME_KEY = 'remember_me';

// Cookie配置，设置安全属性
const cookieOptions = {
  expires: 30, // 30天过期
  secure: process.env.NODE_ENV === 'production', // 在生产环境中只通过HTTPS发送
  sameSite: 'Lax' // 防止CSRF攻击
};

// 保存Token到Cookie
export const saveToken = (token, refreshToken, rememberMe = false) => {
  if (rememberMe) {
    Cookies.set(TOKEN_KEY, token, cookieOptions);
    Cookies.set(REFRESH_TOKEN_KEY, refreshToken, cookieOptions);
    Cookies.set(REMEMBER_ME_KEY, 'true', cookieOptions);
  } else {
    // 如果不记住登录，则Token在会话结束时过期
    Cookies.set(TOKEN_KEY, token);
    Cookies.set(REFRESH_TOKEN_KEY, refreshToken);
  }
};

// 从Cookie中获取Token
export const getToken = () => {
  return Cookies.get(TOKEN_KEY);
};

// 从Cookie中获取刷新Token
export const getRefreshToken = () => {
  return Cookies.get(REFRESH_TOKEN_KEY);
};

// 检查是否记住登录
export const isRememberMe = () => {
  return Cookies.get(REMEMBER_ME_KEY) === 'true';
};

// 清除所有认证相关的Cookie
export const clearTokens = () => {
  Cookies.remove(TOKEN_KEY);
  Cookies.remove(REFRESH_TOKEN_KEY);
  Cookies.remove(REMEMBER_ME_KEY);
};

// 检查Token是否在30天内有效
export const isTokenValid = () => {
  const token = getToken();
  if (!token) return false;
  
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expirationTime = payload.exp * 1000; // 转换为毫秒
    const currentTime = Date.now();
    const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
    
    return expirationTime - currentTime <= thirtyDaysInMs && expirationTime > currentTime;
  } catch (error) {
    return false;
  }
};

// 从Token中获取用户信息
export const getUserFromToken = () => {
  const token = getToken();
  if (!token) return null;
  
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload;
  } catch (error) {
    console.error('解析token失败：', error);
    return null;
  }
};

// 检查Token是否存在且有效，并返回用户信息
export const hasToken = () => {
  const isValid = !!getToken() && isTokenValid();
  if (!isValid) return false;
  return getUserFromToken();
};

// 检查是否需要刷新Token
export const shouldRefreshToken = () => {
  const token = getToken();
  if (!token) return false;
  
  try {
    // 解析JWT Token
    const payload = JSON.parse(atob(token.split('.')[1]));
    // 如果Token将在5分钟内过期，则需要刷新
    return payload.exp * 1000 - Date.now() < 5 * 60 * 1000;
  } catch (error) {
    return false;
  }
};