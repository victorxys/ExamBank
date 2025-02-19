import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../config';
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  IconButton,
  Chip,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  DialogContentText,
  Menu,
  MenuItem,
} from '@mui/material'
import AlertMessage from './AlertMessage'
import {
  School as SchoolIcon,
  LibraryBooks as LibraryBooksIcon,
  QuestionAnswer as QuestionAnswerIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  MoreVert as MoreVertIcon,
} from '@mui/icons-material'

function CourseList() {
  const [courses, setCourses] = useState([])
  const [openEditDialog, setOpenEditDialog] = useState(false)
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false)
  const [openCreateDialog, setOpenCreateDialog] = useState(false)
  const [anchorEl, setAnchorEl] = useState(null)
  const [selectedCourse, setSelectedCourse] = useState(null)
  const [editFormData, setEditFormData] = useState({ course_name: '', description: '', age_group: '' })
  const navigate = useNavigate()
  const theme = useTheme()
  const [alert, setAlert] = useState({ show: false, message: '', severity: 'info' });

  const handleMenuClick = (event, course) => {
    event.stopPropagation()
    setAnchorEl(event.currentTarget)
    setSelectedCourse(course)
  }

  const handleMenuClose = () => {
    setAnchorEl(null)
  }

  const handleMenuEdit = () => {
    handleMenuClose()
    setEditFormData({
      course_name: selectedCourse.course_name,
      description: selectedCourse.description || '',
    })
    setOpenEditDialog(true)
  }

  const handleMenuDelete = () => {
    handleMenuClose()
    handleDeleteClick(new Event('click'), selectedCourse)
  }

  const fetchCourses = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/courses`)
      const data = await response.json()
      setCourses(data)
    } catch (error) {
      console.error('Error:', error)
    }
  }

  useEffect(() => {
    fetchCourses()
  }, [])

  const handleEditClick = (e, course) => {
    e.stopPropagation()
    setSelectedCourse(course)
    setEditFormData({
      course_name: course.course_name,
      description: course.description || '',
    })
    setOpenEditDialog(true)
  }

  const handleDeleteClick = async (e, course) => {
    e.stopPropagation()
    try {
      const response = await fetch(`${API_BASE_URL}/api/courses/${course.id}/check-deleteable`)
      const data = await response.json()
      if (data.deleteable) {
        setSelectedCourse(course)
        setOpenDeleteDialog(true)
      } else {
        alert('该课程包含知识点或题目，无法删除')
      }
    } catch (error) {
      console.error('Error:', error)
      alert('检查课程是否可删除时出错')
    }
  }

  const handleEditSubmit = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/courses/${selectedCourse.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editFormData),
      })
      if (response.ok) {
        fetchCourses()
        setOpenEditDialog(false)
        setAlert({
          show: true,
          message: '课程更新成功',
          severity: 'success'
        });
      } else {
        const data = await response.json();
        setAlert({
          show: true,
          message: data.message || '更新课程失败',
          severity: 'error'
        });
      }
    } catch (error) {
      console.error('Error:', error)
      setAlert({
        show: true,
        message: '更新课程时出错',
        severity: 'error'
      });
    }
  }

  const handleDeleteConfirm = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/courses/${selectedCourse.id}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        fetchCourses()
        setOpenDeleteDialog(false)
        setAlert({
          show: true,
          message: '课程删除成功',
          severity: 'success'
        });
      } else {
        const data = await response.json();
        setAlert({
          show: true,
          message: data.message || '删除课程失败',
          severity: 'error'
        });
      }
    } catch (error) {
      console.error('Error:', error)
      setAlert({
        show: true,
        message: '删除课程时出错',
        severity: 'error'
      });
    }
  }

  const handleCreateSubmit = async () => {
    if (!editFormData.course_name.trim()) {
      setAlert({
        show: true,
        message: '请输入课程名称',
        severity: 'warning'
      });
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/courses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editFormData),
      })
      if (response.ok) {
        await fetchCourses()
        setOpenCreateDialog(false)
        setEditFormData({ course_name: '', description: '' })
        setAlert({
          show: true,
          message: '课程创建成功',
          severity: 'success'
        });
      } else {
        const data = await response.json()
        setAlert({
          show: true,
          message: data.message || '创建课程失败',
          severity: 'error'
        });
      }
    } catch (error) {
      console.error('Error:', error)
      setAlert({
        show: true,
        message: '创建课程时出错',
        severity: 'error'
      });
    }
  }

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <AlertMessage
        open={alert.show}
        message={alert.message}
        severity={alert.severity}
        onClose={() => setAlert({ ...alert, show: false })}
      />
      <Box
        sx={{
          background: `linear-gradient(87deg, ${theme.palette.primary.main} 0, ${theme.palette.primary.dark} 100%)`,
          borderRadius: '0.375rem',
          p: 3,
          mb: 3,
          color: 'white',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Box>
          <Typography variant="h1" component="h1" color="white" gutterBottom>
            课程列表
          </Typography>
          <Typography variant="body1" color="white" sx={{ opacity: 0.8 }}>
            这里列出了所有可用的课程，点击课程卡片可以查看该课程的知识点和题目。
          </Typography>
        </Box>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditFormData({ course_name: '', description: '', age_group: '' })
            setOpenCreateDialog(true)
          }}
          sx={{
            background: 'linear-gradient(87deg, #5e72e4 0, #825ee4 100%)',
            '&:hover': {
              background: 'linear-gradient(87deg, #4050e0 0, #6f4ed4 100%)',
            },
          }}
        >
          添加课程
        </Button>
      </Box>

      <Grid container spacing={3} sx={{ width: '100%', m: 0 }}>
        {courses.map((course) => (
          <Grid item key={course.id} xs={12} sm={6} lg={4} sx={{ p: 1.5 }}>
            <Card
              sx={{
                height: '100%',
                cursor: 'pointer',
                transition: 'all .15s ease',
                background: `linear-gradient(87deg, ${theme.palette.grey[100]} 0, ${theme.palette.grey[50]} 100%)`,
                boxShadow: '0 0 2rem 0 rgba(136,168,170,.15)',
                '&:hover': {
                  transform: 'translateY(-5px)',
                  boxShadow: '0 7px 14px rgba(50,50,93,.1), 0 3px 6px rgba(0,0,0,.08)',
                },
              }}
              onClick={() => navigate(`/courses/${course.id}/knowledge_points`)}
            >
              <CardContent>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    mb: 2,
                    justifyContent: 'space-between',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <IconButton
                      sx={{
                        backgroundColor: theme.palette.primary.main,
                        color: 'white',
                        '&:hover': {
                          backgroundColor: theme.palette.primary.dark,
                        },
                        mr: 2,
                      }}
                    >
                      <SchoolIcon />
                    </IconButton>
                    <Typography variant="h2">{course.course_name}</Typography>
                  </Box>
                  <IconButton
                    onClick={(e) => handleMenuClick(e, course)}
                    size="small"
                    color="primary"
                  >
                    <MoreVertIcon />
                  </IconButton>
                </Box>

                <Typography
                  variant="body1"
                  color="text.secondary"
                  sx={{ mb: 2, minHeight: '3em' }}
                >
                  {course.description || '暂无描述'}
                </Typography>

                <Box
                  sx={{
                    display: 'flex',
                    gap: 1,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  <Chip
                    icon={<LibraryBooksIcon />}
                    label={`${course.knowledge_point_count || 0} 个知识点`}
                    color="primary"
                    variant="outlined"
                  />
                  <Chip
                    icon={<QuestionAnswerIcon />}
                    label={`${course.question_count || 0} 道题目`}
                    color="primary"
                    variant="outlined"
                  />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleMenuEdit}>
          <EditIcon sx={{ mr: 1 }} />
          编辑
        </MenuItem>
        <MenuItem onClick={handleMenuDelete} sx={{ color: 'error.main' }}>
          <DeleteIcon sx={{ mr: 1 }} />
          删除
        </MenuItem>
      </Menu>

      {/* 编辑课程对话框 */}
      <Dialog open={openEditDialog} onClose={() => setOpenEditDialog(false)}>
        <DialogTitle>编辑课程</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="课程名称"
            fullWidth
            value={editFormData.course_name}
            onChange={(e) =>
              setEditFormData({ ...editFormData, course_name: e.target.value })
            }
          />
          <TextField
            margin="dense"
            label="课程描述"
            fullWidth
            multiline
            rows={4}
            value={editFormData.description}
            onChange={(e) =>
              setEditFormData({ ...editFormData, description: e.target.value })
            }
          />
          <TextField
            margin="dense"
            label="年龄组"
            fullWidth
            value={editFormData.age_group}
            onChange={(e) =>
              setEditFormData({ ...editFormData, age_group: e.target.value })
            }
            select
          >
            <MenuItem value="1-2岁">1-2岁</MenuItem>
            <MenuItem value="2-3岁">2-3岁</MenuItem>
            <MenuItem value="2-3月">2-3月</MenuItem>
            <MenuItem value="4-5月">4-5月</MenuItem>
            <MenuItem value="6月">6月</MenuItem>
            <MenuItem value="7-12月">7-12月</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenEditDialog(false)}>取消</Button>
          <Button onClick={handleEditSubmit} variant="contained" color="primary">
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除课程对话框 */}
      <Dialog open={openDeleteDialog} onClose={() => setOpenDeleteDialog(false)}>
        <DialogTitle>删除课程</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要删除课程 {selectedCourse?.course_name} 吗？
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeleteDialog(false)}>取消</Button>
          <Button onClick={handleDeleteConfirm} variant="contained" color="error">
            删除
          </Button>
        </DialogActions>
      </Dialog>

      {/* 创建课程对话框 */}
      <Dialog open={openCreateDialog} onClose={() => setOpenCreateDialog(false)}>
        <DialogTitle>创建课程</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="课程名称"
            fullWidth
            value={editFormData.course_name}
            onChange={(e) =>
              setEditFormData({ ...editFormData, course_name: e.target.value })
            }
          />
          <TextField
            margin="dense"
            label="课程描述"
            fullWidth
            multiline
            rows={4}
            value={editFormData.description}
            onChange={(e) =>
              setEditFormData({ ...editFormData, description: e.target.value })
            }
          />
          <TextField
            margin="dense"
            label="年龄组"
            fullWidth
            value={editFormData.age_group}
            onChange={(e) =>
              setEditFormData({ ...editFormData, age_group: e.target.value })
            }
            select
          >
            <MenuItem value="1-2岁">1-2岁</MenuItem>
            <MenuItem value="2-3岁">2-3岁</MenuItem>
            <MenuItem value="2-3月">2-3月</MenuItem>
            <MenuItem value="4-5月">4-5月</MenuItem>
            <MenuItem value="6月">6月</MenuItem>
            <MenuItem value="7-12月">7-12月</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCreateDialog(false)}>取消</Button>
          <Button onClick={handleCreateSubmit} variant="contained" color="primary">
            创建
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default CourseList