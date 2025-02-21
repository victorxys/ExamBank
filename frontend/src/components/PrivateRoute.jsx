import React, { useState } from 'react';
import { hasToken } from '../api/auth-utils';
import UserLoginDialog from './UserLoginDialog';

const PrivateRoute = ({ element }) => {
  const [loginOpen, setLoginOpen] = useState(false);
  const isAuthenticated = hasToken();

  if (!isAuthenticated) {
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

  // 如果用户已登录，渲染原始组件
  return element;
};

export default PrivateRoute;