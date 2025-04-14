import React, { useState, useRef } from 'react';
import {
  Container,
  Paper,
  Typography,
  TextField,
  Button,
  Box,
  Alert,
  CircularProgress
} from '@mui/material';
import { API_BASE_URL } from '../config';
import { saveToken } from '../api/auth-utils';
import { useNavigate, useLocation } from 'react-router-dom';
import logoSvg from '../assets/logo.svg'; // **再次确认这个路径是正确的**
import { useTheme, alpha } from '@mui/material/styles'; // 引入 alpha 用于颜色透明度

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [alert, setAlert] = useState({ show: false, message: '', severity: 'info' });
  const [loading, setLoading] = useState(false);
  const [checkingPhone, setCheckingPhone] = useState(false);
  const theme = useTheme();

  // --- (保留其他 state 和函数) ---
    const handleSubmit = async (e) => {
    // ... (保留 handleSubmit 逻辑)
    e.preventDefault();
    if (!password || !phoneNumber) {
      setAlert({
        show: true,
        message: '请填写手机号和密码',
        severity: 'warning'
      })
      return
    }

    try {
      setLoading(true)
      setAlert({ show: false, message: '', severity: 'info' })
      const response = await fetch(`${API_BASE_URL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          phone_number: phoneNumber,
          password: password
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '登录失败')
      }

      const { user, access_token, refresh_token } = await response.json()

      // 使用auth-utils中的saveToken函数保存token
      saveToken(access_token, refresh_token, true)

      setAlert({
        show: true,
        message: '登录成功',
        severity: 'success'
      })

      // 登录成功后重定向到之前的页面，如果没有则跳转到首页
      const from = location.state?.from?.pathname || '/users'
      navigate(from, { replace: true })
    } catch (error) {
      console.error('Login error:', error)
      setAlert({
        show: true,
        message: error.message === 'Failed to fetch' ? '网络连接失败，请检查网络设置' : (error.message || '登录失败，请重试'),
        severity: 'error'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: { xs: '10vh', sm: '15vh' },
        // 移除伪元素样式，设置一个简单的背景色
        backgroundColor: theme.palette.grey[100],
        // background: `linear-gradient(160deg, ${alpha(theme.palette.primary.light, 0.05)} 0%, ${alpha(theme.palette.grey[50], 0.5)} 100%)`, // 可以尝试更复杂的背景
      }}
    >
      <Box
        component="img"
        src={logoSvg} // **再次确认 logo 路径**
        alt="萌姨萌嫂 Logo"
        sx={{
          width: 180,
          height: 'auto',
          mb: 4,
          zIndex: 1, // 确保 Logo 在 Paper 之上（如果 Paper 有背景）
        }}
      />
      <Paper
        elevation={0} // 移除 MUI 的默认阴影，使用自定义的 box-shadow
        sx={{
          width: '100%',
          maxWidth: '400px',
          p: 4,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          borderRadius: '16px', // 更圆润的边角
          zIndex: 1,
          position: 'relative',
          backgroundColor: '#ffffff', // 纯白背景
          border: '1px solid rgba(0, 0, 0, 0.05)',
          // **直接在 Paper 上应用多层 box-shadow**
          boxShadow: `
            /* 辉光效果层 1 (主色, 较近, 较实) */
            0 0 15px 5px ${alpha(theme.palette.primary.main, 0.2)},
            /* 辉光效果层 2 (主色浅色, 中等距离, 较散) */
            0 0 35px 15px ${alpha(theme.palette.primary.light, 0.15)},
            /* 辉光效果层 3 (主色深色, 较远, 最散) */
            0 0 60px 25px ${alpha(theme.palette.primary.dark, 0.1)},
            /* 基础阴影 (可选, 增加立体感) */
            0 4px 12px rgba(0, 0, 0, 0.08)
          `,
          transition: 'box-shadow 0.3s ease-in-out',
          '&:hover': { // 可选：悬停时增强效果
            boxShadow: `
              0 0 20px 7px ${alpha(theme.palette.primary.main, 0.25)},
              0 0 45px 20px ${alpha(theme.palette.primary.light, 0.2)},
              0 0 75px 30px ${alpha(theme.palette.primary.dark, 0.15)},
              0 6px 16px rgba(0, 0, 0, 0.1)
            `,
          }
        }}
      >
        <Typography
          component="h1"
          variant="h4"
          sx={{
            mb: 4,
            color: theme.palette.grey[800],
            fontWeight: 600
          }}
        >
          用户登录
        </Typography>

        <form onSubmit={handleSubmit} style={{ width: '100%' }}>
          {alert.show && (
            <Alert
              severity={alert.severity}
              sx={{ mb: 3, borderRadius: '8px' }}
              onClose={() => setAlert({ ...alert, show: false })}
            >
              {alert.message}
            </Alert>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <TextField
                label="手机号"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                required
                fullWidth
                type="tel"
                autoFocus
                disabled={loading}
                InputLabelProps={{ shrink: true }} // 确保标签始终缩小
                sx={{
                    '& .MuiOutlinedInput-root': {
                        borderRadius: '8px',
                        '&:hover fieldset': {
                            borderColor: theme.palette.primary.main,
                        },
                        '&.Mui-focused fieldset': {
                            borderColor: theme.palette.primary.main,
                        },
                    },
                }}
              />
            <TextField
                label="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                fullWidth
                type="password"
                disabled={loading}
                InputLabelProps={{ shrink: true }} // 确保标签始终缩小
                sx={{
                    '& .MuiOutlinedInput-root': {
                        borderRadius: '8px',
                        '&:hover fieldset': {
                            borderColor: theme.palette.primary.main,
                        },
                        '&.Mui-focused fieldset': {
                            borderColor: theme.palette.primary.main,
                        },
                    },
                }}
              />

            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={loading || checkingPhone}
              sx={{
                mt: 2,
                py: 1.5,
                borderRadius: '8px',
                fontSize: '1rem',
                textTransform: 'none',
                background: `linear-gradient(87deg, ${theme.palette.primary.main} 0, ${theme.palette.primary.dark} 100%)`,
                '&:hover': {
                  background: `linear-gradient(87deg, ${theme.palette.primary.dark} 0, ${theme.palette.primary.dark} 100%)`,
                  boxShadow: `0 4px 15px ${alpha(theme.palette.primary.main, 0.4)}`,
                },
                position: 'relative',
                transition: 'all 0.3s ease',
              }}
            >
              {loading ? (
                <CircularProgress
                  size={24}
                  sx={{ color: 'white', position: 'absolute' }}
                />
              ) : '登录'}
            </Button>
          </Box>
        </form>
      </Paper>
    </Box>
  );
}

export default LoginPage;