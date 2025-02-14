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
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username || !phoneNumber) {
      setError('请填写用户名和手机号')
      return
    }

    try {
      setLoading(true)
      setError(null)
      const response = await fetch('http://localhost:5000/api/users/login', {
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
      onLogin(user)
    } catch (error) {
      console.error('Login error:', error)
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>考生信息</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
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
