import React, { useState, useRef } from 'react'
import {
  Container,
  Paper,
  Typography,
  TextField,
  Button,
  Box,
  Alert,
  CircularProgress
} from '@mui/material'
import { API_BASE_URL } from '../config'
import { saveToken } from '../api/auth-utils'
import { useNavigate, useLocation } from 'react-router-dom'
import logoSvg from '../assets/logo.svg';

function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [alert, setAlert] = useState({ show: false, message: '', severity: 'info' })
  const [loading, setLoading] = useState(false)
  const [checkingPhone, setCheckingPhone] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
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
      const from = location.state?.from?.pathname || '/'
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
        paddingTop: { xs: '10vh', sm: '15vh' }
        // background: 'linear-gradient(87deg, #D0EBEA 0, #E0F2F1 100%)'
      }}
    >
      <Box
        component="img"
        src={logoSvg}
        alt="Logo"
        sx={{
          width: 180,
          height: 'auto',
          mb: 4
        }}
      />
      <Paper
        elevation={1}
        sx={{
          width: '100%',
          maxWidth: '400px',
          p: 4,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          borderRadius: 2,
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
        }}
      >
          <Typography 
            component="h1" 
            variant="h4" 
            sx={{ 
              mb: 4,
            //   color: '#5e72e4',
              fontWeight: 600
            }}
          >
            用户登录
          </Typography>

          <form onSubmit={handleSubmit} style={{ width: '100%' }}>
            {alert.show && (
              <Alert 
                severity={alert.severity} 
                sx={{ 
                  mb: 3,
                  borderRadius: '8px'
                }}
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
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '8px',
                    '&:hover fieldset': {
                      borderColor: 'primary.main',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: 'primary.main',
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
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '8px',
                    '&:hover fieldset': {
                      borderColor: 'primary.main',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: 'primary.main',
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
                //   background: 'linear-gradient(87deg, #5e72e4 0, #825ee4 100%)',
                  '&:hover': {
                    background: 'linear-gradient(87deg, #408d86 0, #408d86 100%)',
                  },
                  position: 'relative'
                }}
              >
                {loading ? (
                  <CircularProgress 
                    size={24} 
                    sx={{ 
                      color: 'white',
                      position: 'absolute'
                    }}
                  />
                ) : '登录'}
              </Button>
            </Box>
          </form>
        </Paper>
    </Box>
  )
}

export default LoginPage