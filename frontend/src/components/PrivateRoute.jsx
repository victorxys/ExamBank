import React, { useState } from 'react';
import { hasToken } from '../api/auth-utils';
import UserLoginDialog from './UserLoginDialog';
import { useLocation, Navigate } from 'react-router-dom';


const PrivateRoute = ({ element }) => {
  const [loginOpen, setLoginOpen] = useState(false);
  const userInfo = hasToken();
  const location = useLocation();

  if (!userInfo) {
    // 如果用户未登录，显示登录弹窗
    return (
      <>
        {element}
        <UserLoginDialog
          open={true}
          onClose={() => setLoginOpen(false)}
          onLogin={() => {
            setLoginOpen(false);
            window.location.reload(); // 登录成功后刷新页面以更新认证状态
          }}
        />
      </>
    );
  }

  // 如果是学生用户，只允许访问考试记录页面
  // console.log(location.pathname)
  // console.log(userInfo.role)
  if (userInfo.role === 'student' && !location.pathname.includes('/exam-records')) {
    return <Navigate to="/exam-records" replace />;
  }

  // 如果用户已登录且有权限，渲染原始组件
  return element;
};

export default PrivateRoute;