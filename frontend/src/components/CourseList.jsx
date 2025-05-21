// frontend/src/components/CourseList.jsx
import { useEffect, useState, useCallback } from 'react'; // 确保 useCallback 已导入
import { useNavigate } from 'react-router-dom';
// import { API_BASE_URL } from '../config'; // 将被 api 实例取代
import api from '../api/axios'; // <<<--- 修改：导入配置好的 axios 实例
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
  Paper,
  CircularProgress, // <<<--- 新增：导入
  Divider,          // <<<--- 新增：导入
} from '@mui/material';
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';
import {
  School as SchoolIcon,
  LibraryBooks as LibraryBooksIcon,
  QuestionAnswer as QuestionAnswerIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  MoreVert as MoreVertIcon,
  Audiotrack as AudiotrackIcon, // 保留您原有的
  AttachFile as AttachFileIcon, // <<<--- 新增：或您选择的其他资源管理图标
} from '@mui/icons-material';

// <<<--- 新增：导入新的子组件 ---<<<
import CourseResourceUploader from './CourseResource/CourseResourceUploader';
import CourseResourceList from './CourseResource/CourseResourceList';
// --- >>>

function CourseList() {
  const [courses, setCourses] = useState([]);
  const [openEditDialog, setOpenEditDialog] = useState(false);
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [openCreateDialog, setOpenCreateDialog] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [editFormData, setEditFormData] = useState({ course_name: '', description: '', age_group: '' });
  const navigate = useNavigate();
  const theme = useTheme();
  const [alert, setAlert] = useState({ show: false, message: '', severity: 'info' });
  const [loading, setLoading] = useState(true); // <<<--- 修改：添加 loading 状态

  // --- 新增状态用于资源管理 ---
  const [resourceManagementDialogOpen, setResourceManagementDialogOpen] = useState(false);
  const [courseForResourceManagement, setCourseForResourceManagement] = useState(null);
  const [resourceListKey, setResourceListKey] = useState(0); // 用于强制刷新资源列表
  // --- 结束新增状态 ---

  const handleManageTtsContents = () => {
    handleMenuClose();
    if (selectedCourse && selectedCourse.id) {
      navigate(`/courses/${selectedCourse.id}/tts-contents`);
    }
  };

  const fetchCourses = useCallback(async () => {
    setLoading(true); // 开始加载时设置 loading 为 true
    try {
      const response = await api.get('/courses'); // <<<--- 修改：使用 api 实例
      setCourses(response.data || []);
    } catch (error) {
      console.error('Error fetching courses:', error);
      setAlert({ show: true, message: '获取课程列表失败: ' + (error.response?.data?.error || error.message), severity: 'error' });
    } finally {
      setLoading(false); // 加载结束时设置 loading 为 false
    }
  }, []);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  const handleMenuClick = (event, course) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
    setSelectedCourse(course);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    // 不在此处清除 selectedCourse，以便 Dialog 能访问
  };

  const handleMenuEdit = () => {
    if (!selectedCourse) return;
    handleMenuClose();
    setEditFormData({
      course_name: selectedCourse.course_name,
      description: selectedCourse.description || '',
      age_group: selectedCourse.age_group || '', // <<<--- 确保 age_group 也被设置
    });
    setOpenEditDialog(true);
  };

  const handleDeleteClick = (e, course) => { // 这个函数可能可以被 handleMenuDelete 替代或合并
    e.stopPropagation();
    setSelectedCourse(course);
    // 检查逻辑可以放在 handleMenuDelete 或 handleConfirmDelete 中
    setOpenDeleteDialog(true);
  };
  
  const handleMenuDelete = async () => {
    if (!selectedCourse) return;
    handleMenuClose();
    // 将检查逻辑移到确认删除前
    setOpenDeleteDialog(true);
  };

  // --- 新增：打开资源管理对话框的处理函数 ---
  const handleManageResources = () => {
    if (!selectedCourse) return;
    handleMenuClose();
    setCourseForResourceManagement(selectedCourse);
    setResourceManagementDialogOpen(true);
  };
  // --- 结束新增 ---
  
  // --- 新增：资源上传/删除/更新成功后的回调 ---
  const handleResourceActionSuccess = () => {
    setResourceListKey(prevKey => prevKey + 1); 
    // 可选：如果上传/删除资源会影响课程卡片上的统计数据（如资源数量），则需要刷新课程列表
    // fetchCourses(); 
  };
  // --- 结束新增 ---

  const handleEditSubmit = async () => {
    if (!selectedCourse || !editFormData.course_name.trim()) {
      setAlert({ show: true, message: '课程名称不能为空', severity: 'warning' });
      return;
    }
    try {
      await api.put(`/courses/${selectedCourse.id}`, editFormData); // <<<--- 修改：使用 api 实例
      fetchCourses();
      setOpenEditDialog(false);
      setAlert({ show: true, message: '课程更新成功', severity: 'success' });
    } catch (error) {
      console.error('Error updating course:', error);
      setAlert({ show: true, message: '更新课程失败: ' + (error.response?.data?.error || error.message), severity: 'error' });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!selectedCourse) return;
    try {
      // 先检查课程是否可删除
      const checkResponse = await api.get(`/courses/${selectedCourse.id}/check-deleteable`); // <<<--- 修改：使用 api 实例
      if (!checkResponse.data.deleteable) {
        setAlert({ show: true, message: checkResponse.data.message || '该课程包含知识点或题目，无法删除', severity: 'warning' });
        setOpenDeleteDialog(false);
        return;
      }
      
      await api.delete(`/courses/${selectedCourse.id}`); // <<<--- 修改：使用 api 实例
      fetchCourses();
      setOpenDeleteDialog(false);
      setAlert({ show: true, message: '课程删除成功', severity: 'success' });
    } catch (error) {
      console.error('Error deleting course:', error);
      setAlert({ show: true, message: '删除课程失败: ' + (error.response?.data?.error || error.message), severity: 'error' });
    }
  };

  const handleCreateSubmit = async () => {
    if (!editFormData.course_name.trim()) {
      setAlert({ show: true, message: '请输入课程名称', severity: 'warning' });
      return;
    }
    try {
      await api.post('/courses', editFormData); // <<<--- 修改：使用 api 实例
      await fetchCourses(); // 确保在 fetchCourses 前加 await
      setOpenCreateDialog(false);
      setEditFormData({ course_name: '', description: '', age_group: '' });
      setAlert({ show: true, message: '课程创建成功', severity: 'success' });
    } catch (error) {
      console.error('Error creating course:', error);
      setAlert({ show: true, message: '创建课程失败: ' + (error.response?.data?.error || error.message), severity: 'error' });
    }
  };

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      <AlertMessage
        open={alert.show}
        message={alert.message}
        severity={alert.severity}
        onClose={() => setAlert({ ...alert, show: false })}
      />
      <PageHeader
        title="课程列表"
        description="这里列出了所有可用的课程。点击课程卡片导航至知识点，或通过菜单管理课程。"
        actions={
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditFormData({ course_name: '', description: '', age_group: '' });
              setOpenCreateDialog(true);
            }}
          >
            添加课程
          </Button>
        }
      />
    
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>
      ) : (
        <Card sx={{ boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)', borderRadius: '0.375rem', backgroundColor: 'transparent', border: 'none' }}>
          <Grid container spacing={2}>
          {courses.map((course) => (
            <Grid item key={course.id} xs={12} sm={6} lg={4}>
              <Card
                sx={{
                  height: '100%',
                  // cursor: 'pointer', // 保持，因为卡片主体点击导航到知识点
                  transition: 'all .15s ease',
                  background: `linear-gradient(87deg, ${theme.palette.grey[100]} 0, ${theme.palette.grey[50]} 100%)`,
                  boxShadow: '0 0 2rem 0 rgba(136,168,170,.15)',
                  '&:hover': {
                    transform: 'translateY(-5px)',
                    boxShadow: '0 7px 14px rgba(50,50,93,.1), 0 3px 6px rgba(0,0,0,.08)',
                  },
                }}
              >
                <CardContent onClick={() => navigate(`/courses/${course.id}/knowledge_points`)} sx={{cursor: 'pointer'}}> {/* 将点击导航放到 CardContent */}
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
                    {/* 菜单触发按钮的点击事件不应导航 */}
                    <IconButton
                      onClick={(e) => handleMenuClick(e, course)}
                      size="small"
                      color="primary"
                      aria-controls={anchorEl && selectedCourse?.id === course.id ? 'course-actions-menu' : undefined}
                      aria-haspopup="true"
                      aria-expanded={anchorEl && selectedCourse?.id === course.id ? 'true' : undefined}
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
        </Card>
      )}

      <Menu
        id="course-actions-menu" // <<<--- 新增：给 Menu 一个 ID
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleMenuEdit}>
          <EditIcon sx={{ mr: 1 }} />
          编辑课程
        </MenuItem>
        {/* <<<--- 修改菜单项 ---<<< */}
        <MenuItem onClick={handleManageResources}> 
          <AttachFileIcon sx={{ mr: 1 }} /> 
          课程资源管理
        </MenuItem>
        {/* --- >>> */}
        <MenuItem onClick={handleManageTtsContents}> 
          <AudiotrackIcon sx={{ mr: 1 }} />
          培训音频管理 (旧)
        </MenuItem>
        <MenuItem onClick={handleMenuDelete} sx={{ color: 'error.main' }}>
          <DeleteIcon sx={{ mr: 1 }} />
          删除课程
        </MenuItem>
      </Menu>

      {/* 编辑课程对话框 (保持不变) */}
      <Dialog open={openEditDialog} onClose={() => setOpenEditDialog(false)}>
        <DialogTitle>编辑课程</DialogTitle>
        <DialogContent>
          <TextField autoFocus margin="dense" label="课程名称" fullWidth value={editFormData.course_name} onChange={(e) => setEditFormData({ ...editFormData, course_name: e.target.value })} />
          <TextField margin="dense" label="课程描述" fullWidth multiline rows={4} value={editFormData.description} onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })} />
          <TextField margin="dense" label="年龄组" fullWidth value={editFormData.age_group} onChange={(e) => setEditFormData({ ...editFormData, age_group: e.target.value })} select >
            <MenuItem value="1-2岁">1-2岁</MenuItem> <MenuItem value="2-3岁">2-3岁</MenuItem> <MenuItem value="2-3月">2-3月</MenuItem> <MenuItem value="4-5月">4-5月</MenuItem> <MenuItem value="6月">6月</MenuItem> <MenuItem value="7-12月">7-12月</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenEditDialog(false)}>取消</Button>
          <Button onClick={handleEditSubmit} variant="contained" color="primary">保存</Button>
        </DialogActions>
      </Dialog>

      {/* 删除课程对话框 (保持不变) */}
      <Dialog open={openDeleteDialog} onClose={() => setOpenDeleteDialog(false)}>
        <DialogTitle>删除课程</DialogTitle>
        <DialogContent>
          <DialogContentText>确定要删除课程 "{selectedCourse?.course_name}" 吗？</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeleteDialog(false)}>取消</Button>
          <Button onClick={handleDeleteConfirm} variant="contained" color="error">删除</Button>
        </DialogActions>
      </Dialog>

      {/* 创建课程对话框 (保持不变) */}
      <Dialog open={openCreateDialog} onClose={() => setOpenCreateDialog(false)}>
        <DialogTitle>创建课程</DialogTitle>
        <DialogContent>
          <TextField autoFocus margin="dense" label="课程名称" fullWidth value={editFormData.course_name} onChange={(e) => setEditFormData({ ...editFormData, course_name: e.target.value })} />
          <TextField margin="dense" label="课程描述" fullWidth multiline rows={4} value={editFormData.description} onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })} />
          <TextField margin="dense" label="年龄组" fullWidth value={editFormData.age_group} onChange={(e) => setEditFormData({ ...editFormData, age_group: e.target.value })} select >
             <MenuItem value="1-2岁">1-2岁</MenuItem> <MenuItem value="2-3岁">2-3岁</MenuItem> <MenuItem value="2-3月">2-3月</MenuItem> <MenuItem value="4-5月">4-5月</MenuItem> <MenuItem value="6月">6月</MenuItem> <MenuItem value="7-12月">7-12月</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCreateDialog(false)}>取消</Button>
          <Button onClick={handleCreateSubmit} variant="contained" color="primary">创建</Button>
        </DialogActions>
      </Dialog>

      {/* --- 新增：资源管理对话框 --- */}
      <Dialog
        open={resourceManagementDialogOpen}
        onClose={() => setResourceManagementDialogOpen(false)}
        maxWidth="lg" 
        fullWidth
      >
        <DialogTitle>
          管理课程资源: {courseForResourceManagement?.course_name || ''}
        </DialogTitle>
        <DialogContent dividers> {/* dividers 添加分割线 */}
          {courseForResourceManagement && (
            <>
              <CourseResourceUploader
                courseId={courseForResourceManagement.id}
                onUploadSuccess={handleResourceActionSuccess} // <<<--- 修改：使用新的回调
                onUploadError={(errMsg) => setAlert({ show: true, message: errMsg, severity: 'error' })}
              />
              <Divider sx={{ my: 2 }} />
              <CourseResourceList
                key={resourceListKey} // 使用 key 来强制刷新
                courseId={courseForResourceManagement.id}
                onResourceDeleted={handleResourceActionSuccess} // <<<--- 修改：使用新的回调
                onResourceUpdated={handleResourceActionSuccess} // <<<--- 新增：传递更新回调
              />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResourceManagementDialogOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>
      {/* --- 结束新增 --- */}
    </Box>
  );
}

export default CourseList;