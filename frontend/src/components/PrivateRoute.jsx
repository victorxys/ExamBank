// src/components/PrivateRoute.jsx
import React from 'react';
import { getToken, hasToken as isUserLoggedIn } from '../api/auth-utils'; // 重命名 hasToken 以避免混淆，或只导入 getToken
import { useLocation, Navigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode'; // 引入 jwt-decode 来解析 token

const PrivateRoute = ({ element }) => {
  const tokenString = getToken(); ; // 直接获取 token 字符串或 null
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const isPublic = searchParams.get('public') === 'true';
  const isEmployeeProfilePath = location.pathname.startsWith('/employee-profile/');

  let userInfo = null;
  // --- 使用 tokenString 判断是否存在 ---
  if (tokenString) { 
    try {
      // --- 使用 tokenString 进行解析 ---
      userInfo = jwtDecode(tokenString); 
    } catch (error) {
      console.error("解析 Token 失败:", error);
      // Token 无效或过期，视为未登录，但在 finally 中处理重定向可能更好
      // 或者在这里清除无效 token
      // clearTokens(); // 可以考虑在此处清除无效 token
    }
  }



  // --- 核心逻辑调整 ---
  if (!userInfo) {
    // 用户未登录或 Token 无效
    if (isEmployeeProfilePath && isPublic) {
       // 如果是员工档案路径，且明确带有 ?public=true，允许访问
      //  console.log("PrivateRoute: 公开访问员工档案，允许");
       return element;
    } else if (isEmployeeProfilePath && !isPublic) {
      // 如果是员工档案路径，但没有 ?public=true，重定向到公开版本
      const newUrl = `${location.pathname}?public=true${location.hash}`;
      // console.log("PrivateRoute: 未登录访问私有员工档案，重定向到:", newUrl);
      return <Navigate to={newUrl} replace />;
    } else {
      // 其他所有未登录情况，重定向到登录页
      // console.log("PrivateRoute: 未登录访问受保护页面，重定向到登录页");
      return <Navigate to="/login" state={{ from: location }} replace />;
    }
  }

  // 用户已登录
  // 如果是学生角色，并且访问的不是允许的路径，重定向到考试记录
  // **你需要根据实际情况定义学生可以访问的所有路径前缀**
  const allowedStudentPathPrefixes = ['/exam-records', '/employee-profile']; // 示例：允许访问考试记录和员工档案
  const isAllowedForStudent = allowedStudentPathPrefixes.some(p => location.pathname.startsWith(p));

  if (userInfo.role === 'student' && !isAllowedForStudent) {
    //  console.log("PrivateRoute: 学生用户访问非授权页面，重定向到考试记录");
     // 可以考虑重定向到更合适的学生首页，比如 /exam-records
     return <Navigate to="/exam-records" replace />; 
  }

  // 用户已登录且有权限，渲染目标组件
  // console.log("PrivateRoute: 用户已登录且有权限，渲染目标组件");
  return element;
};

export default PrivateRoute;