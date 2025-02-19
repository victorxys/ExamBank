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

function UserLoginDialog({ open, onClose, onLogin }) {
  const [username, setUsername] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [alert, setAlert] = useState({ show: false, message: '', severity: 'info' })
  const [loading, setLoading] = useState(false)

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
      const response = await fetch(`${API_BASE_URL}/api/users/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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

      const user = await response.json()
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
        message: error.message || '登录失败，请重试',
        severity: 'error'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>考生信息</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          {alert.show && (
            <Alert severity={alert.severity} sx={{ mb: 2 }}>
              {alert.message}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="姓名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              fullWidth
            />
            <TextField
              label="手机号"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              required
              fullWidth
              type="tel"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={loading}
          >
            开始考试
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

export default UserLoginDialog
