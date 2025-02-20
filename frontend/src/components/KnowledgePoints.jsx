import { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../config';
import AlertMessage from './AlertMessage';
import {
  Box,
  Card,
  CardHeader,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  TablePagination,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Person as PersonIcon,
  Notifications as NotificationsIcon,
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { useTheme } from '@mui/material';

function KnowledgePoints() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const [knowledgePoints, setKnowledgePoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openEditDialog, setOpenEditDialog] = useState(false);
  const [selectedKnowledgePoint, setSelectedKnowledgePoint] = useState(null);
  const [courses, setCourses] = useState([]);
  const [searchParams, setSearchParams] = useState({
    point_name: '',
    course_id: courseId || '',
  });
  const [alert, setAlert] = useState({ show: false, message: '', severity: 'info' });
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [total, setTotal] = useState(0);
  const [openCreateDialog, setOpenCreateDialog] = useState(false);
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const [deletePointId, setDeletePointId] = useState(null);

  const [newKnowledgePoint, setNewKnowledgePoint] = useState({
    point_name: '',
    course_id: courseId || ''
  });

  // 用于跟踪对话框打开之前获得焦点的元素
  const previousActiveElement = useRef(null);

  // 获取主要内容容器的函数
  const getMainContent = () => {
    return document.getElementById('root');
  };

  // 焦点和 aria-hidden 处理
  useEffect(() => {
    if (openEditDialog || openCreateDialog || openDeleteDialog) {
      // 对话框打开时
      // 1. 存储当前聚焦的元素
      previousActiveElement.current = document.activeElement;

      // 2. 隐藏应用程序的其余部分
      const mainContent = getMainContent();
      if (mainContent) {
        mainContent.setAttribute('inert', '');
      }
    } else {
      // 对话框关闭时
      // 1. 恢复 inert 属性
      const mainContent = getMainContent();
      if (mainContent) {
        mainContent.removeAttribute('inert');
      }

      // 2. 将焦点恢复到对话框打开之前拥有焦点的元素
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    }
  }, [openEditDialog, openCreateDialog, openDeleteDialog]);
  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/courses`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setCourses(data || []);
      } catch (error) {
        console.error('获取课程列表失败:', error);
        setAlert({
          show: true,
          message: '获取课程列表失败，请稍后重试',
          severity: 'error'
        });
      }
    };

    fetchCourses();
  }, []); // 空依赖数组意味着这个效果只在组件挂载时运行一次

  useEffect(() => {
    fetchKnowledgePoints();
  }, [page, rowsPerPage, searchParams]);

  const fetchKnowledgePoints = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: page + 1,
        per_page: rowsPerPage,
        ...searchParams
      });
      const response = await fetch(`${API_BASE_URL}/knowledge-points?${queryParams}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setKnowledgePoints(data.items || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error('获取知识点列表失败:', error);
      setAlert({
        show: true,
        message: '获取知识点列表失败，请稍后重试',
        severity: 'error'
      });
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

  const handleSearch = () => {
    setPage(0);
    fetchKnowledgePoints();
  };



  const handleEdit = async () => {
    if (!selectedKnowledgePoint) return;

    try {
      const response = await fetch(`${API_BASE_URL}/knowledge_points/${selectedKnowledgePoint.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(selectedKnowledgePoint),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      setAlert({
        show: true,
        message: '知识点更新成功',
        severity: 'success'
      });
      setOpenEditDialog(false);
      fetchKnowledgePoints();
    } catch (error) {
      console.error('更新知识点失败:', error);
      setAlert({
        show: true,
        message: '更新知识点失败，请稍后重试',
        severity: 'error'
      });
    }
  };

  const handleDelete = async (pointId) => {
    setDeletePointId(pointId);
    setOpenDeleteDialog(true);
  };

  const handleCreate = async () => {
    if (!newKnowledgePoint.point_name?.trim()) {
      setAlert({
        show: true,
        message: '请输入知识点名称',
        severity: 'error'
      });
      return;
    }

    if (!newKnowledgePoint.course_id) {
      setAlert({
        show: true,
        message: '请选择所属课程',
        severity: 'error'
      });
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/knowledge-points`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newKnowledgePoint),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      setAlert({
        show: true,
        message: '知识点创建成功',
        severity: 'success'
      });
      setOpenCreateDialog(false);
      setNewKnowledgePoint({
        point_name: '',
        course_id: courseId || ''
      });
      fetchKnowledgePoints();
    } catch (error) {
      console.error('创建知识点失败:', error);
      setAlert({
        show: true,
        message: '创建知识点失败，请稍后重试',
        severity: 'error'
      });
    }
  };

  const confirmDelete = async () => {
    if (!deletePointId) return;

    try {
      const response = await fetch(`${API_BASE_URL}/knowledge_points/${deletePointId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      setAlert({
        show: true,
        message: '知识点删除成功',
        severity: 'success'
      });
      setOpenDeleteDialog(false);
      fetchKnowledgePoints();
    } catch (error) {
      console.error('删除知识点失败:', error);
      setAlert({
        show: true,
        message: error.message || '删除知识点失败，请稍后重试',
        severity: 'error'
      });
    } finally {
      setDeletePointId(null);
    }
  };

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
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
            知识点管理
          </Typography>
          <Typography variant="body1" color="white" sx={{ opacity: 0.8 }}>
            这里列出了所有的知识点，您可以添加、编辑或删除知识点。
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <IconButton sx={{ color: 'white' }}>
            <PersonIcon />
          </IconButton>
          <IconButton sx={{ color: 'white' }}>
            <NotificationsIcon />
          </IconButton>
        </Box>
      </Box>
      <AlertMessage
        open={alert.show}
        message={alert.message}
        severity={alert.severity}
        onClose={() => setAlert({ ...alert, show: false })}
      />
      
      <Card sx={{ mb: 2 }}>
        <CardHeader 
          title={courseId ? courses.find(c => c.id === courseId)?.course_name || '课程知识点' : '知识点管理'} 
          subheader={courseId ? '课程的所有知识点' : undefined}
          action={
            <Button
              variant="contained"
              color="primary"
              onClick={() => setOpenCreateDialog(true)}
            >
              添加知识点
            </Button>
          }
        />
        <CardContent>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={courseId ? 8 : 4}>
              <TextField
                fullWidth
                label="知识点名称"
                value={searchParams.point_name}
                onChange={(e) => setSearchParams({ ...searchParams, point_name: e.target.value })}
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
            </Grid>
            {!courseId && (
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth>
                  <InputLabel>所属课程</InputLabel>
                  <Select
                    value={searchParams.course_id}
                    label="所属课程"
                    onChange={(e) => setSearchParams({ ...searchParams, course_id: e.target.value })}
                  >
                    <MenuItem value="">全部</MenuItem>
                    {courses.map((course) => (
                      <MenuItem key={course.id} value={course.id}>
                        {course.course_name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
            <Grid item xs={12} sm={courseId ? 4 : 4}>
              <Button
                variant="contained"
                startIcon={<SearchIcon />}
                onClick={handleSearch}
                sx={{ mt: 1 }}
              >
                搜索
              </Button>
            </Grid>
          </Grid>

          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>知识点名称</TableCell>
                  <TableCell>所属课程</TableCell>
                  <TableCell>创建时间</TableCell>
                  <TableCell>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {knowledgePoints.map((point) => (
                  <TableRow key={point.id}>
                    <TableCell>
                      <Button
                        color="primary"
                        onClick={() => navigate(`/questions?knowledge_point_id=${point.id}&course_id=${point.course_id}`)}
                      >
                        {point.point_name}
                      </Button>
                    </TableCell>
                    <TableCell>{point.course_name}</TableCell>
                    <TableCell>{new Date(point.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        onClick={() => {
                          setSelectedKnowledgePoint(point);
                          setOpenEditDialog(true);
                        }}
                        aria-label={`编辑知识点 ${point.name}`}
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDelete(point.id)}
                        aria-label={`删除知识点 ${point.name}`}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={total}
              page={page}
              onPageChange={handleChangePage}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={handleChangeRowsPerPage}
              labelRowsPerPage="每页行数"
            />
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog 
        open={openEditDialog} 
        onClose={() => setOpenEditDialog(false)}
        aria-labelledby="edit-knowledge-point-dialog"
      >
        <DialogTitle id="edit-knowledge-point-dialog">编辑知识点</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="知识点名称"
              value={selectedKnowledgePoint?.point_name || ''}
              onChange={(e) => setSelectedKnowledgePoint({
                ...selectedKnowledgePoint,
                point_name: e.target.value
              })}
              sx={{ mb: 2 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>所属课程</InputLabel>
              <Select
                value={selectedKnowledgePoint?.course_id || ''}
                label="所属课程"
                onChange={(e) => setSelectedKnowledgePoint({
                  ...selectedKnowledgePoint,
                  course_id: e.target.value
                })}
              >
                {courses.map((course) => (
                  <MenuItem key={course.id} value={course.id}>
                    {course.course_name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenEditDialog(false)}>取消</Button>
          <Button onClick={handleEdit} variant="contained">保存</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={openDeleteDialog}
        onClose={() => setOpenDeleteDialog(false)}
        aria-labelledby="delete-knowledge-point-dialog"
      >
        <DialogTitle id="delete-knowledge-point-dialog">确认删除</DialogTitle>
        <DialogContent>
          <Typography>确定要删除这个知识点吗？如果知识点下有关联的考题，将无法删除。</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDeleteDialog(false)}>取消</Button>
          <Button onClick={confirmDelete} color="error" variant="contained">删除</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={openCreateDialog}
        onClose={() => setOpenCreateDialog(false)}
        aria-labelledby="create-knowledge-point-dialog"
      >
        <DialogTitle id="create-knowledge-point-dialog">添加知识点</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="知识点名称"
              value={newKnowledgePoint.point_name}
              onChange={(e) => setNewKnowledgePoint({
                ...newKnowledgePoint,
                point_name: e.target.value
              })}
              sx={{ mb: 2 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>所属课程</InputLabel>
              <Select
                value={newKnowledgePoint.course_id}
                label="所属课程"
                onChange={(e) => setNewKnowledgePoint({
                  ...newKnowledgePoint,
                  course_id: e.target.value
                })}
              >
                {courses.map((course) => (
                  <MenuItem key={course.id} value={course.id}>
                    {course.course_name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCreateDialog(false)}>取消</Button>
          <Button onClick={handleCreate} variant="contained">创建</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={openCreateDialog}
        onClose={() => setOpenCreateDialog(false)}
        aria-labelledby="create-knowledge-point-dialog"
      >
        <DialogTitle id="create-knowledge-point-dialog">添加知识点</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="知识点名称"
              value={newKnowledgePoint.point_name}
              onChange={(e) => setNewKnowledgePoint({
                ...newKnowledgePoint,
                point_name: e.target.value
              })}
              sx={{ mb: 2 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>所属课程</InputLabel>
              <Select
                value={newKnowledgePoint.course_id}
                label="所属课程"
                onChange={(e) => setNewKnowledgePoint({
                  ...newKnowledgePoint,
                  course_id: e.target.value
                })}
              >
                {courses.map((course) => (
                  <MenuItem key={course.id} value={course.id}>
                    {course.course_name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCreateDialog(false)}>取消</Button>
          <Button onClick={handleCreate} variant="contained">创建</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default KnowledgePoints;