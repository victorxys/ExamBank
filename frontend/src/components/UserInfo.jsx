import React, { useState, useEffect } from 'react';
import {
  Box,
  Avatar,
  Typography,
  Divider,
  CircularProgress,
} from '@mui/material';
import userApi from '../api/user';
import { hasToken } from '../api/auth-utils';

function UserInfo() {
  const [userInfo, setUserInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const tokenData = hasToken();
  const [user] = useState(tokenData);

  useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        setLoading(true);
        setError(null);
        const token = localStorage.getItem('token');
        if (tokenData) {
          const userId = tokenData.sub;
          if (userId) {
            const response = await userApi.getUserDetails(userId);
            setUserInfo(response.data);
          }
        }
      } catch (error) {
        console.error('获取用户信息失败:', error);
        setError('获取用户信息失败');
      } finally {
        setLoading(false);
      }
    };

    fetchUserInfo();
  }, []);

  if (loading) {
    return (
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100px' }}>
        <Typography color="error" variant="body2">{error}</Typography>
      </Box>
    );
  }

  if (!userInfo) {
    return null;
  }

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100px' }}>
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        mb: 2,
        mt:0
      }}>
        <Avatar
          sx={{
            width: 48,
            height: 48,
            bgcolor: 'primary.main'
          }}
        >
          {userInfo.username?.[0]?.toUpperCase()}
        </Avatar>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
            {userInfo.username}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {userInfo.role === 'admin' ? '管理员' : '普通用户'}
          </Typography>
        </Box>
      </Box>
      <Divider sx={{ width: '100%', borderColor: 'rgba(0, 0, 0, 0.12)' }} />
    </Box>
  );
}

export default UserInfo;