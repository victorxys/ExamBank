import React, { useState, useEffect } from 'react';
import {
  Avatar,
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
  useMediaQuery,
  TablePagination,
  CircularProgress,
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon, Add as AddIcon, Assessment as AssessmentIcon } from '@mui/icons-material';
import { MenuItem } from '@mui/material';
import api from '../api/axios';
// 假设你的dateUtils.js和MyComponent.jsx在同一个文件夹
import { formatRelativeTime } from '../api/dateUtils'; // 确保路径正确
import AlertMessage from './AlertMessage';


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
  
  // 监听搜索条件变化，重置页码
  useEffect(() => {
    setPage(0);
  }, [searchTerm]);
  const [alertMessage, setAlertMessage] = useState(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  
  // 使用媒体查询检测是否为移动设备
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  useEffect(() => {
    fetchUsers();
  }, [page, rowsPerPage, searchTerm, sortBy, sortOrder]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      // 构建查询参数
      const params = new URLSearchParams({
        page: page + 1, // API使用1-based索引，而MUI使用0-based索引
        per_page: rowsPerPage,
        sort_by: sortBy,
        sort_order: sortOrder
      });
      
      if (searchTerm) {
        params.append('search', searchTerm);
      }
      
      const response = await api.get(`/users?${params.toString()}`);
      
      if (response.data && response.data.items) {
        setUsers(response.data.items);
        setTotalUsers(response.data.total);
        setTotalPages(response.data.total_pages);
      } else {
        console.error('Invalid users data format:', response.data);
        setUsers([]);
        setTotalUsers(0);
        setTotalPages(0);
      }
    } catch (error) {
      console.error('Error fetching users:', error.response || error);
      setUsers([]);
      setTotalUsers(0);
      setTotalPages(0);
      setAlertMessage({
        severity: 'error',
        message: '获取用户列表失败，请稍后重试'
      });
      setAlertOpen(true);
    } finally {
      setLoading(false);
    }
  };
  
  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };
  
  const handleSort = (column) => {
    const isAsc = sortBy === column && sortOrder === 'asc';
    setSortOrder(isAsc ? 'desc' : 'asc');
    setSortBy(column);
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
      <AlertMessage
        open={alertOpen}
        message={alertMessage?.message}
        severity={alertMessage?.severity || 'info'}
        onClose={() => setAlertOpen(false)}
      />
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
              overflow: 'auto',
              maxWidth: '100%'
            }}
          >
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                <Table sx={{ minWidth: isMobile ? 300 : 650 }}>
                  <TableHead>
                    <TableRow>
                      {!isMobile && (
                        <TableCell sx={{ whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' } }}>头像</TableCell>
                      )}
                      <TableCell 
                        sx={{ whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' }, cursor: 'pointer' }}
                        onClick={() => handleSort('username')}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          用户名
                          {sortBy === 'username' && (
                            <Box component="span" sx={{ ml: 0.5 }}>
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </Box>
                          )}
                        </Box>
                      </TableCell>
                      {!isMobile && (
                        <>
                          <TableCell sx={{ whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' } }}>手机号</TableCell>
                          <TableCell 
                            sx={{ whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' }, cursor: 'pointer' }}
                            onClick={() => handleSort('evaluation_count')}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                              评价次数
                              {sortBy === 'evaluation_count' && (
                                <Box component="span" sx={{ ml: 0.5 }}>
                                  {sortOrder === 'asc' ? '↑' : '↓'}
                                </Box>
                              )}
                            </Box>
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' } }}>评价人</TableCell>
                          <TableCell 
                            sx={{ whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' }, cursor: 'pointer' }}
                            onClick={() => handleSort('created_at')}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                              评价时间
                              {sortBy === 'created_at' && (
                                <Box component="span" sx={{ ml: 0.5 }}>
                                  {sortOrder === 'asc' ? '↑' : '↓'}
                                </Box>
                              )}
                            </Box>
                          </TableCell>
                        </>
                      )}
                      <TableCell sx={{ textAlign: isMobile ? 'center' : 'center', whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' } }}>操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {users.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isMobile ? 3 : 7} align="center" sx={{ py: 3 }}>
                          没有找到匹配的用户
                        </TableCell>
                      </TableRow>
                    ) : (
                      users.map((user) => (
                        <TableRow 
                          key={user.id}
                          sx={{
                            '&:hover': {
                              backgroundColor: '#f6f9fc'
                            },
                            '& > td': {
                              padding: { xs: '16px 8px', sm: '20px 16px' },
                              fontSize: { xs: '0.875rem', sm: '1rem' }
                            }
                          }}
                        >
                          {!isMobile && (
                            <TableCell sx={{ whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' } }}>
                              <Avatar
                                sx={{
                                  width: { xs: 30, sm: 40 },
                                  height: { xs: 30, sm: 40 },
                                  bgcolor: theme.palette.primary.main
                                }}
                                alt={user.username}
                                src={`/avatar/${user.id}-avatar.jpg`}
                              >
                                {user.username?.[0]?.toUpperCase()}
                              </Avatar>
                            </TableCell>
                          )}
                          <TableCell sx={{ color: '#525f7f', whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' } }}>{user.username}</TableCell>
                          {!isMobile && (
                            <>
                              <TableCell sx={{ color: '#525f7f', whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' } }}>{user.phone_number}</TableCell>
                              <TableCell sx={{ color: '#525f7f', whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' } }}>{user.evaluation_count || 0}</TableCell>
                              <TableCell sx={{ color: '#525f7f', whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' }, maxWidth: { xs: '100px', sm: '150px' }, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.evaluator_names?.join(', ') || '-'}</TableCell>
                              <TableCell sx={{ color: '#525f7f', whiteSpace: 'nowrap', padding: { xs: '8px', sm: '16px' } }}>
                                {user.last_evaluation_time ? formatRelativeTime(user.last_evaluation_time) : '-'}
                              </TableCell>
                            </>
                          )}
                          <TableCell align={isMobile ? "right" : "center"} sx={{ whiteSpace: 'nowrap', padding: { xs: '4px', sm: '16px' } }}>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: isMobile ? 'flex-end' : 'center', gap: { xs: '2px', sm: '4px' } }}>
                              <IconButton
                                color="primary"
                                onClick={() => handleOpen(user)}
                                size="small"
                                sx={{ padding: { xs: '4px', sm: '8px' } }}
                              >
                                <EditIcon fontSize={isMobile ? "small" : "medium"} />
                              </IconButton>
                              <IconButton
                                color="error"
                                onClick={() => handleDelete(user.id)}
                                size="small"
                                sx={{ padding: { xs: '4px', sm: '8px' } }}
                              >
                                <DeleteIcon fontSize={isMobile ? "small" : "medium"} />
                              </IconButton>
                              <IconButton
                                color="info"
                                onClick={() => navigate(`/user-evaluation/${user.id}`)}
                                size="small"
                                sx={{ padding: { xs: '4px', sm: '8px' } }}
                              >
                                <AssessmentIcon fontSize={isMobile ? "small" : "medium"} />
                              </IconButton>
                              <IconButton
                                color="success"
                                onClick={() => navigate(`/user-evaluation-summary/${user.id}`)}
                                size="small"
                                sx={{ padding: { xs: '4px', sm: '8px' } }}
                              >
                                <AssessmentIcon fontSize={isMobile ? "small" : "medium"} />
                              </IconButton>
                              <IconButton
                                color="info"
                                onClick={() => navigate(`/employee-profile/${user.id}`)}
                                size="small"
                                sx={{ padding: { xs: '4px', sm: '8px' } }}
                              >
                                <PersonIcon fontSize={isMobile ? "small" : "medium"} />
                              </IconButton>
                              <IconButton
                                color="success"
                                onClick={async () => {
                                  try {
                                    const evaluationUrl = `${window.location.origin}/client-evaluation/${user.id}`;
                                    await navigator.clipboard.writeText(evaluationUrl);
                                    setAlertMessage({
                                      severity: 'success',
                                      message: '客户评价链接已复制到剪贴板'
                                    });
                                    setAlertOpen(true);
                                  } catch (error) {
                                    console.error('复制链接失败:', error);
                                    setAlertMessage({
                                      severity: 'error',
                                      message: '复制链接失败，请重试'
                                    });
                                    setAlertOpen(true);
                                  }
                                }}
                                size="small"
                                title="复制客户评价链接"
                                sx={{ padding: { xs: '4px', sm: '8px' } }}
                              >
                                <NotificationsIcon fontSize={isMobile ? "small" : "medium"} />
                              </IconButton>
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <TablePagination
                  component="div"
                  count={totalUsers}
                  page={page}
                  onPageChange={handleChangePage}
                  rowsPerPage={rowsPerPage}
                  onRowsPerPageChange={handleChangeRowsPerPage}
                  rowsPerPageOptions={[5, 10, 25, 50]}
                  labelRowsPerPage="每页行数:"
                  labelDisplayedRows={({ from, to, count }) => `${from}-${to} 共 ${count}`}
                />
              </>
            )}
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