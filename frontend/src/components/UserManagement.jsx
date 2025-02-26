import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Box,
  Card,
  CardHeader,
  CardContent,
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon, Add as AddIcon, Assessment as AssessmentIcon } from '@mui/icons-material';
import { MenuItem } from '@mui/material';
import api from '../api/axios';
import { useTheme } from '@mui/material';
import {  
  Person as PersonIcon,
  Notifications as NotificationsIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import PageHeader from './PageHeader';

const UserManagement = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState({
    username: '',
    phone_number: '',
    password: '',
    role: 'student',
    email: '',
    status: 'active'
  });

  useEffect(() => {
    fetchUsers();
  }, [searchTerm]);

  const fetchUsers = async () => {
    try {
      const response = await api.get('/users');
      // console.log('Users API response:', response.data);
      if (response.data && Array.isArray(response.data)) {
        let filteredUsers = response.data;
        if (searchTerm) {
          filteredUsers = filteredUsers.filter(user =>
            user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
            user.phone_number.includes(searchTerm)
          );
        }
        setUsers(filteredUsers);
      } else {
        console.error('Invalid users data format:', response.data);
        setUsers([]);
      }
    } catch (error) {
      console.error('Error fetching users:', error.response || error);
      setUsers([]);
    }
  };

  const handleOpen = (user = null) => {
    if (user) {
      setEditUser(user);
      setFormData({
        username: user.username,
        phone_number: user.phone_number,
        role: user.role || 'student',
        email: user.email || '',
        status: user.status || 'active',
        password: ''
      });
    } else {
      setEditUser(null);
      setFormData({
        username: '',
        phone_number: '',
        password: '',
        role: 'student',
        email: '',
        status: 'active'
      });
    }
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setEditUser(null);
    setFormData({
      username: '',
      phone_number: '',
      password: '',
      role: 'student',
      email: '',
      status: 'active'
    });
  };

  const handleSubmit = async () => {
    try {
      if (editUser) {
        await api.put(`/users/${editUser.id}`, formData);
      } else {
        await api.post('/users', formData);
      }
      fetchUsers();
      handleClose();
    } catch (error) {
      console.error('Error saving user:', error);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('确定要删除这个用户吗？')) {
      try {
        await api.delete(`/users/${id}`);
        fetchUsers();
      } catch (error) {
        console.error('Error deleting user:', error);
      }
    }
  };

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <PageHeader
        title="用户管理"
        description="这里列出了所有的用户，您可以添加、编辑或删除用户。此处用户与员工平台关联"
      />

      <Card sx={{ 
        boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)',
        backgroundColor: 'white',
        borderRadius: '0.375rem'
      }}>
        <CardHeader
          sx={{ p: 3 }}
          title={
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
              <Box display="flex" gap={2} flex={1}>
                <TextField
                  size="small"
                  placeholder="搜索用户名或手机号"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  fullWidth
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '0.375rem',
                      '&:hover fieldset': {
                        borderColor: theme.palette.primary.main,
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: theme.palette.primary.main,
                      },
                    },
                  }}
                />
              </Box>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={() => handleOpen()}
                sx={{
                  background: 'linear-gradient(87deg, #5e72e4 0, #825ee4 100%)',
                  '&:hover': {
                    background: 'linear-gradient(87deg, #4050e0 0, #6f4ed4 100%)',
                  },
                }}
              >
                添加用户
              </Button>
            </Box>
          }
        />
        <CardContent sx={{ p: 3 }}>
          <TableContainer
            component={Paper}
            sx={{
              boxShadow: 'none',
              border: '1px solid rgba(0, 0, 0, 0.1)',
              borderRadius: '0.375rem',
              overflow: 'hidden'
            }}
          >
            <Table>
              <TableHead>
                <TableRow sx={{ backgroundColor: '#f6f9fc' }}>
                  <TableCell sx={{ color: '#8898aa', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '1px' }}>用户名</TableCell>
                  <TableCell sx={{ color: '#8898aa', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '1px' }}>手机号</TableCell>
                  <TableCell sx={{ color: '#8898aa', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '1px' }}>角色</TableCell>
                  <TableCell sx={{ color: '#8898aa', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '1px' }}>邮箱</TableCell>
                  <TableCell sx={{ color: '#8898aa', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '1px' }}>状态</TableCell>
                  <TableCell sx={{ color: '#8898aa', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '1px' }}>创建时间</TableCell>
                  <TableCell sx={{ color: '#8898aa', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '1px' }}>更新时间</TableCell>
                  <TableCell sx={{ color: '#8898aa', fontWeight: 600, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '1px' }} align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((user) => (
                  <TableRow 
                    key={user.id}
                    sx={{
                      '&:hover': {
                        backgroundColor: '#f6f9fc'
                      }
                    }}
                  >
                    <TableCell sx={{ color: '#525f7f' }}>{user.username}</TableCell>
                    <TableCell sx={{ color: '#525f7f' }}>{user.phone_number}</TableCell>
                    <TableCell sx={{ color: '#525f7f' }}>{user.role}</TableCell>
                    <TableCell sx={{ color: '#525f7f' }}>{user.email || '-'}</TableCell>
                    <TableCell sx={{ color: '#525f7f' }}>{user.status}</TableCell>
                    <TableCell sx={{ color: '#525f7f' }}>{new Date(user.created_at).toLocaleString()}</TableCell>
                    <TableCell sx={{ color: '#525f7f' }}>{new Date(user.updated_at).toLocaleString()}</TableCell>
                    <TableCell align="right">
                      <IconButton
                        color="primary"
                        onClick={() => handleOpen(user)}
                        size="small"
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        color="error"
                        onClick={() => handleDelete(user.id)}
                        size="small"
                      >
                        <DeleteIcon />
                      </IconButton>
                      <IconButton
                        color="info"
                        onClick={() => navigate(`/user-evaluation/${user.id}`)}
                        size="small"
                      >
                        <AssessmentIcon />
                      </IconButton>
                      <IconButton
                        color="success"
                        onClick={() => navigate(`/user-evaluation-summary/${user.id}`)}
                        size="small"
                      >
                        <AssessmentIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog 
        open={open} 
        onClose={handleClose}
        PaperProps={{
          sx: {
            borderRadius: '0.375rem',
          }
        }}
      >
        <DialogTitle>{editUser ? '编辑用户' : '添加用户'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="用户名"
            type="text"
            fullWidth
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          />
          <TextField
            margin="dense"
            label="手机号"
            type="text"
            fullWidth
            value={formData.phone_number}
            onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
          />
          <TextField
            margin="dense"
            label="密码"
            type="password"
            fullWidth
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          />
          <TextField
            margin="dense"
            label="邮箱"
            type="email"
            fullWidth
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          />
          <TextField
            select
            margin="dense"
            label="角色"
            fullWidth
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
          >
            <MenuItem value="student">学生</MenuItem>
            <MenuItem value="teacher">教师</MenuItem>
            <MenuItem value="admin">管理员</MenuItem>
          </TextField>
          <TextField
            select
            margin="dense"
            label="状态"
            fullWidth
            value={formData.status}
            onChange={(e) => setFormData({ ...formData, status: e.target.value })}
          >
            <MenuItem value="active">激活</MenuItem>
            <MenuItem value="inactive">未激活</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>取消</Button>
          <Button 
            onClick={handleSubmit} 
            variant="contained" 
            color="primary"
            sx={{
              background: 'linear-gradient(87deg, #5e72e4 0, #825ee4 100%)',
              '&:hover': {
                background: 'linear-gradient(87deg, #4050e0 0, #6f4ed4 100%)',
              },
            }}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UserManagement;