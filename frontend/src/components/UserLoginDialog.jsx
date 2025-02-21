import React, { useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Alert
} from '@mui/material'
import { API_BASE_URL } from '../config'
import { saveToken } from '../api/auth-utils'

function UserLoginDialog({ open, onClose, onLogin }) {
  const [username, setUsername] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [alert, setAlert] = useState({ show: false, message: '', severity: 'info' })
  const [loading, setLoading] = useState(false)
  const [checkingPhone, setCheckingPhone] = useState(false)

  const checkPhoneNumber = async (phone) => {
    try {
      const response = await fetch(`${API_BASE_URL}/users/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone_number: phone,
          username: ''  // 不提供用户名，用于检查手机号是否存在
        }),
      })

      if (response.status === 404) {
        // 用户不存在，清空用户名字段
        setUsername('')
        return
      }

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '检查手机号失败')
      }

      const loginData = await response.json()
      // 如果找到了用户，自动填充用户名
      if (loginData && loginData.user.username) {
        setUsername(loginData.user.username)
      }
    } catch (error) {
      console.error('检查手机号时出错：', error)
      setAlert({
        show: true,
        message: error.message,
        severity: 'error'
      })
    }
  }

  const handlePhoneChange = async (e) => {
    const phone = e.target.value
    setPhoneNumber(phone)

    if (phone.length >= 3) {  // 当手机号长度达到3位时开始检查
      setCheckingPhone(true)
      await checkPhoneNumber(phone)
      setCheckingPhone(false)
    } else {
      // 当手机号长度不足时，清空用户名
      setUsername('')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username || !phoneNumber) {
      setAlert({
        show: true,
        message: '请填写用户名和手机号',
        severity: 'warning'
      })
      return
    }

    try {
      setLoading(true)
      setAlert({ show: false, message: '', severity: 'info' })
      const response = await fetch(`${API_BASE_URL}/users/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          username,
          phone_number: phoneNumber
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
      onLogin(user)
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
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="sm" 
      fullWidth
      sx={{
        '& .MuiBackdrop-root': {
          backgroundColor: 'rgba(0, 0, 0, 0.7)'
        },
        '& .MuiDialog-paper': {
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
          borderRadius: '12px',
          position: 'relative',
          zIndex: 1300
        }
      }}
    >
      <DialogTitle sx={{ 
        borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
        padding: '20px 24px',
        fontSize: '1.25rem',
        fontWeight: 600
      }}>
        用户信息
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          {alert.show && (
            <Alert severity={alert.severity} sx={{ mb: 2 }}>
              {alert.message}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
              label="手机号"
              value={phoneNumber}
              onChange={handlePhoneChange}
              required
              fullWidth
              type="tel"
            />
            <TextField
              label="姓名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              fullWidth
              disabled={checkingPhone}
            />
            
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={loading || checkingPhone}
          >
            开始考试
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

export default UserLoginDialog
