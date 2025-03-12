import { useState, useEffect } from 'react'
import TablePagination from '@mui/material/TablePagination'
import { useNavigate, Link } from 'react-router-dom'
import { useTheme } from '@mui/material/styles'
import { API_BASE_URL } from '../config';
import useMediaQuery from '@mui/material/useMediaQuery';
import {
  Box,
  Button,
  Typography,
  Card,
  CardContent,
  CardActions,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  Grid,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  OutlinedInput,
  ListItemText,
  Checkbox,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableContainer,
  TableHead,
  TableFooter,
  IconButton,
  Menu
} from '@mui/material'
import { 
  Add as AddIcon,
  Delete as DeleteIcon,
  School as SchoolIcon,
  MoreVert as MoreVertIcon,
  LibraryBooks as LibraryBooksIcon,
  QuestionAnswer as QuestionAnswerIcon,
  Visibility as VisibilityIcon,
  Share as ShareIcon,
  Person as PersonIcon,
  Notifications as NotificationsIcon,
  Edit as EditIcon
} from '@mui/icons-material'
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';

function ExamList() {
  const navigate = useNavigate()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newExamDialogOpen, setNewExamDialogOpen] = useState(false)
  const [alert, setAlert] = useState({ show: false, message: '', severity: 'info' })
  const [editingExam, setEditingExam] = useState(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedCourses, setSelectedCourses] = useState([])
  const [courses, setCourses] = useState([])
  const [knowledgePoints, setKnowledgePoints] = useState([])
  const [selectedPoints, setSelectedPoints] = useState([])
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [singleCount, setSingleCount] = useState('');
  const [multipleCount, setMultipleCount] = useState(0);
  
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [examToDelete, setExamToDelete] = useState(null);
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedExam, setSelectedExam] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [selectedFilterCourses, setSelectedFilterCourses] = useState([]);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [selectedPointsQuestionCounts, setSelectedPointsQuestionCounts] = useState({ single: 0, multiple: 0 });

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        const [examsResponse, coursesResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/exams`),
          fetch(`${API_BASE_URL}/courses`),
          // fetch(`${API_BASE_URL}/exam-records`)
        ])

        if (!examsResponse.ok || !coursesResponse.ok ) {
          throw new Error('获取数据失败')
        }

        const [examsData, coursesData] = await Promise.all([
          examsResponse.json(),
          coursesResponse.json(),
          // recordsResponse.json()
        ])



        setExams(examsData)
        setCourses(coursesData)
      } catch (error) {
        console.error('Error fetching data:', error)
        setError(error.message)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  const fetchCourses = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/courses`)
      if (!response.ok) {
        throw new Error('获取课程列表失败')
      }
      const data = await response.json()
      console.log('获取到的课程列表：', data)  // 添加日志
      if (Array.isArray(data)) {
        setCourses(data)
      } else {
        console.error('课程数据格式错误：', data)
        setCourses([])
      }
    } catch (error) {
      console.error('获取课程列表出错：', error)
      setCourses([])
    }
  }

  

  const fetchExams = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/exams`);
      if (!response.ok) {
        throw new Error('Failed to fetch exams');
      }
      const data = await response.json();
      setExams(data);
    } catch (error) {
      console.error('Error fetching exams:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewExam = async () => {
    try {
      if (!title) {
        setAlert({
          show: true,
          message: '请输入考卷标题',
          severity: 'warning'
        })
        return
      }
      if (selectedCourses.length === 0) {
        setAlert({
          show: true,
          message: '请选择至少一个课程',
          severity: 'warning'
        })
        return
      }
      if (selectedPoints.length === 0) {
        setAlert({
          show: true,
          message: '请选择至少一个知识点',
          severity: 'warning'
        })
        return
      }
      if (singleCount === '' && multipleCount === 0) {
        setAlert({
          show: true,
          message: '请设置要抽取的题目数量',
          severity: 'warning'
        })
        return
      }

      const response = await fetch(`${API_BASE_URL}/exams`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          description,
          course_ids: selectedCourses,
          point_ids: selectedPoints,
          single_count: parseInt(singleCount),
          multiple_count: parseInt(multipleCount),
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || '创建考卷失败')
      }

      setNewExamDialogOpen(false)
      resetForm()
      await fetchExams()
      setAlert({
        show: true,
        message: '考卷创建成功',
        severity: 'success'
      })
    } catch (error) {
      console.error('Error creating exam:', error)
      setAlert({
        show: true,
        message: error.message || '创建考卷失败，请重试',
        severity: 'error'
      })
    }
  }

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setSelectedCourses([])
    setSelectedPoints([])
    setSingleCount('');
    setMultipleCount(0);
  }

  // 在过滤或搜索时重置分页
  useEffect(() => {
    setPage(0)
  }, [searchText, selectedFilterCourses, selectedPoints])

  // 修改handleCoursesChange函数
  const handleCoursesChange = async (event) => {
    const courseIds = event.target.value
    setSelectedCourses(courseIds)
    
    if (courseIds.length > 0) {
      try {
        // 获取所有选中课程的知识点
        const promises = courseIds.map(courseId =>
          fetch(`${API_BASE_URL}/courses/${courseId}/knowledge_points`)
            .then(res => res.json())
        )
        
        const allPointsData = await Promise.all(promises)
        // 合并所有课程的知识点，并去重
        const mergedPoints = allPointsData.flat()
        const uniquePoints = Array.from(new Map(mergedPoints.map(point => [point.id, point])).values())
        setKnowledgePoints(uniquePoints)
      } catch (error) {
        console.error('Error fetching knowledge points:', error)
        alert('获取知识点失败：' + error.message)
      }
    } else {
      setKnowledgePoints([])
      setSelectedPoints([])
    }
  }

  const handleSelectAllPoints = () => {
    setSelectedPoints(knowledgePoints.map(point => point.id))
  }

  const handleUnselectAllPoints = () => {
    setSelectedPoints([])
  }

  const handlePreview = (examId) => {
    window.open(`/exams/${examId}/take?preview=true`, '_blank');
  };

  const handleShare = async (examId) => {
    const examUrl = `${window.location.origin}/exams/${examId}/take`;
    
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(examUrl);
        setAlert({
          show: true,
          message: '答题链接已复制到剪贴板！',
          severity: 'success'
        });
      } else {
        // 创建一个临时输入框来复制文本
        const tempInput = document.createElement('input');
        tempInput.value = examUrl;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
        setAlert({
          show: true,
          message: '答题链接已复制到剪贴板！',
          severity: 'success'
        });
      }
    } catch (error) {
      console.error('复制链接失败:', error);
      // 如果复制失败，显示链接让用户手动复制
      setAlert({
        show: true,
        message: `请手动复制链接：${examUrl}`,
        severity: 'error'
      });
    }
  };

  const handleViewDetails = (examId, examTime) => {
    navigate(`/exams/${examId}?exam_time=${encodeURIComponent(examTime)}`)
  };

  const handleViewExamRecord = (examId, userId, examTime) => {
    // 确保时间格式正确
    const formattedTime = new Date(examTime).toISOString().replace('Z', '+00:00');
    navigate(`/exam-records/${examId}/${userId}?exam_time=${encodeURIComponent(formattedTime)}`);
  };

  // 在过滤或搜索时重置分页
  useEffect(() => {
    setPage(0)
  }, [searchText, selectedFilterCourses])

  // 获取选中知识点题目数量
  useEffect(() => {
    const fetchSelectedPointsQuestions = async () => {
      if (selectedPoints.length === 0) {
        setSelectedPointsQuestionCounts({ single: 0, multiple: 0 });
        return;
      }

      try {
        const promises = selectedPoints.map(pointId =>
          fetch(`${API_BASE_URL}/knowledge_points/${pointId}/questions`)
            .then(res => res.json())
        );

        const allQuestionsData = await Promise.all(promises);
        const flatQuestions = allQuestionsData.flat();

        const counts = flatQuestions.reduce((acc, question) => {
          if (question.question_type === '单选题') acc.single++;
          if (question.question_type === '多选题') acc.multiple++;
          return acc;
        }, { single: 0, multiple: 0 });

        setSelectedPointsQuestionCounts(counts);
      } catch (error) {
        console.error('获取知识点题目数量失败：', error);
      }
    };

    fetchSelectedPointsQuestions();
  }, [selectedPoints]);

  // 搜索重置
  useEffect(() => {
    if (searchText.trim() === '') {
      // 重置知识点列表为原始状态
      const fetchAllKnowledgePoints = async () => {
        if (selectedCourses.length > 0) {
          try {
            const promises = selectedCourses.map(courseId =>
              fetch(`${API_BASE_URL}/courses/${courseId}/knowledge_points`)
                .then(res => res.json())
            );
            const allPointsData = await Promise.all(promises);
            const mergedPoints = allPointsData.flat();
            const uniquePoints = Array.from(new Map(mergedPoints.map(point => [point.id, point])).values());
            setKnowledgePoints(uniquePoints);
          } catch (error) {
            console.error('Error fetching knowledge points:', error);
          }
        }
      };
      fetchAllKnowledgePoints();
    }
  }, [searchText, selectedCourses]);

  // 过滤考卷列表
  const filteredExams = exams.filter(exam => {
    const matchesSearch = searchText.trim() === '' ||
      exam.title.toLowerCase().includes(searchText.toLowerCase()) ||
      (exam.description && exam.description.toLowerCase().includes(searchText.toLowerCase()));

    const matchesCourses = selectedFilterCourses.length === 0 ||
      (exam.course_names && Array.isArray(exam.course_names) && 
       exam.course_names.some(courseName => 
         courses.some(course => 
           selectedFilterCourses.includes(course.id) && course.course_name === courseName
         )
       ));

    return matchesSearch && matchesCourses;
  });

  // 计算单选题和多选题总数
  const totalCounts = filteredExams.reduce((acc, exam) => {
    const singleChoiceQuestions = exam.questions?.filter(q => q.question_type === '单选题') || []
    const multiChoiceQuestions = exam.questions?.filter(q => q.question_type === '多选题') || []
    return {
      single: acc.single + singleChoiceQuestions.length,
      multiple: acc.multiple + multiChoiceQuestions.length
    }
  }, { single: 0, multiple: 0 })

  const handleDeleteClick = (exam) => {
    setExamToDelete(exam);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!examToDelete) return;

    try {
      const response = await fetch(`${API_BASE_URL}/exams/${examToDelete.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('删除试卷失败');
      }

      setExams(exams.filter(exam => exam.id !== examToDelete.id));
      setDeleteDialogOpen(false);
      setExamToDelete(null);
      setAlert({
        show: true,
        message: '试卷删除成功',
        severity: 'success'
      });
    } catch (error) {
      console.error('删除试卷时出错：', error);
      alert('删除试卷失败：' + error.message);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setExamToDelete(null);
  };

  const handleSingleCountChange = (e) => {
    const inputValue = e.target.value;
    if (inputValue === '') {
      setSingleCount('');
      setMultipleCount(0);
      return;
    }

    const value = parseInt(inputValue) || 0;
    // 限制单选题数量不超过100
    const newSingleCount = Math.min(100, Math.max(0, value));
    setSingleCount(newSingleCount);

    // 计算多选题数量：(100 - 单选题分数) / 2，向下取整
    const remainingPoints = 100 - newSingleCount;
    const calculatedMultipleCount = Math.floor(remainingPoints / 2);
    // 限制多选题数量不超过50
    const newMultipleCount = Math.min(50, Math.max(0, calculatedMultipleCount));
    setMultipleCount(newMultipleCount);
  };

  const handleMultipleCountChange = (e) => {
    const value = parseInt(e.target.value) || 0;
    // 限制多选题数量不超过50且总分不超过100
    const maxMultipleCount = Math.floor((100 - singleCount) / 2);
    const newMultipleCount = Math.min(50, Math.min(maxMultipleCount, Math.max(0, value)));
    setMultipleCount(newMultipleCount);
  };

  const handleEditClick = (exam) => {
    setEditingExam(exam);
    setEditTitle(exam.title);
    setEditDescription(exam.description || '');
    setEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    try {
      if (!editTitle.trim()) {
        setAlert({
          show: true,
          message: '请输入考卷标题',
          severity: 'warning'
        });
        return;
      }

      const response = await fetch(`${API_BASE_URL}/exams/${editingExam.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
        }),
      });

      if (!response.ok) {
        throw new Error('更新考卷失败');
      }

      // 更新本地数据
      setExams(exams.map(exam => 
        exam.id === editingExam.id 
          ? { ...exam, title: editTitle, description: editDescription }
          : exam
      ));

      setEditDialogOpen(false);
      setEditingExam(null);
      setAlert({
        show: true,
        message: '考卷更新成功',
        severity: 'success'
      });
    } catch (error) {
      console.error('Error updating exam:', error);
      setAlert({
        show: true,
        message: error.message || '更新考卷失败，请重试',
        severity: 'error'
      });
    }
  };

  const handleEditCancel = () => {
    setEditDialogOpen(false);
    setEditingExam(null);
    setEditTitle('');
    setEditDescription('');
  };

  const handleMenuOpen = (event, exam) => {
    setAnchorEl(event.currentTarget);
    setSelectedExam(exam);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedExam(null);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">
          Error: {error}
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ width: '100%', height: '100%' }}>
      {alert.show && (
        <AlertMessage
          open={alert.show}
          message={alert.message}
          severity={alert.severity}
          onClose={() => setAlert({ ...alert, show: false })}
        />
      )}
      <PageHeader
        title="考卷管理"
        description="这里列出了所有可用的考卷，您可以添加、编辑或删除考卷。"
        actions={
          <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setNewExamDialogOpen(true)}
          size={isMobile ? "small" : "medium"}
        >
          新建考卷
        </Button>
        }
      />
      <Card sx={{ mb: 2 }}>
        
        <CardContent>
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          <TextField
            label="搜索考卷"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            size="small"
            sx={{
              width: isMobile ? '100%' : '300px',
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
            placeholder="输入考卷标题或描述"
          />
          <FormControl size="small" sx={{ width: isMobile ? '100%' : '200px' }}>
            <InputLabel>按课程筛选</InputLabel>
            <Select
              multiple
              value={selectedFilterCourses}
              onChange={(e) => setSelectedFilterCourses(e.target.value)}
              label="按课程筛选"
            >
              {courses.map((course) => (
                <MenuItem key={course.id} value={course.id}>
                  {course.course_name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

        </Box>

        {/* 移动端使用卡片布局，桌面端使用表格布局 */}
        {isMobile ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filteredExams.length === 0 ? (
              <Typography variant="body1" sx={{ py: 2, color: '#8898aa', textAlign: 'center' }}>
                暂无考卷
              </Typography>
            ) : (
              filteredExams.map((exam) => (
                <Card key={exam.id} sx={{ mb: 2, boxShadow: '0 2px 12px 0 rgba(0,0,0,0.1)' }}>
                  <CardContent>
                    <Typography variant="h2" gutterBottom>
                      {exam.title}
                    </Typography>
                    
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        <strong>课程:</strong> {exam.course_names?.join(', ') || '无'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        <strong>题目数量:</strong> 单选题 {exam.single_count || 0}题, 多选题 {exam.multiple_count || 0}题
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        <strong>创建时间:</strong> {exam.created_at ? new Date(exam.created_at).toLocaleString('zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        }) : '未知'}
                      </Typography>
                    </Box>
                  </CardContent>
                  <Divider />
                  <CardActions sx={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, p: 2 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => handlePreview(exam.id)}
                      startIcon={<VisibilityIcon />}
                    >
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => handleShare(exam.id)}
                      startIcon={<ShareIcon />}
                    >
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="primary"
                      onClick={() => handleEditClick(exam)}
                      startIcon={<EditIcon />}
                    >
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      onClick={() => handleDeleteClick(exam)}
                      startIcon={<DeleteIcon />}
                    ></Button>
                  </CardActions>
                </Card>
              ))
            )}
          </Box>
        ) : (
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
              <TableHead >
                <TableRow>
                  <TableCell>考卷标题</TableCell>
                  <TableCell>课程</TableCell>
                  <TableCell>题目数量</TableCell>
                  <TableCell>创建时间</TableCell>
                  <TableCell>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!filteredExams || filteredExams.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      <Typography variant="body1" sx={{ py: 2, color: '#8898aa' }}>
                        暂无考卷
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredExams.map((exam) => (
                    <TableRow key={exam.id}>
                      <TableCell>{exam.title}</TableCell>
                      <TableCell>
                        {exam.course_names?.join(', ') || '无'}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <Typography variant="body2">
                            单选题：{exam.single_count || 0}题
                          </Typography>
                          <Typography variant="body2">
                            多选题：{exam.multiple_count || 0}题
                          </Typography>
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            总计：{exam.question_count || 0}题
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        {exam.created_at ? new Date(exam.created_at).toLocaleString('zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        }) : '未知'}
                      </TableCell>
                      <TableCell>
                        {exam.created_at ? new Date(exam.created_at).toLocaleString('zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        }) : '未知'}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Button
                            size="small"
                            variant="contained"
                            onClick={() => handlePreview(exam.id)}
                            startIcon={<VisibilityIcon />}
                          >
                            预览
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            onClick={() => handleShare(exam.id)}
                            startIcon={<ShareIcon />}
                          >
                            分享
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            color="primary"
                            onClick={() => handleEditClick(exam)}
                            startIcon={<EditIcon />}
                          >
                            编辑
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            color="error"
                            onClick={() => handleDeleteClick(exam)}
                            startIcon={<DeleteIcon />}
                          >
                            删除
                          </Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        </CardContent>
      </Card>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={() => {
          handleMenuClose();
          handlePreview(selectedExam.id);
        }}>
          <VisibilityIcon sx={{ mr: 1 }} />
          预览
        </MenuItem>
        <MenuItem onClick={() => {
          handleMenuClose();
          handleShare(selectedExam.id);
        }}>
          <ShareIcon sx={{ mr: 1 }} />
          分享
        </MenuItem>
        <MenuItem 
          onClick={() => {
            handleMenuClose();
            handleDeleteClick(selectedExam);
          }} 
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon sx={{ mr: 1 }} />
          删除
        </MenuItem>
      </Menu>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onClose={handleDeleteCancel} fullWidth={isMobile}>
        <DialogTitle>删除考卷</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要删除考卷 {examToDelete?.title} 吗？
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>取消</Button>
          <Button onClick={handleDeleteConfirm} variant="contained" color="error">
            删除
          </Button>
        </DialogActions>
      </Dialog>

      {/* 新建考卷对话框 */}
      <Dialog
        open={newExamDialogOpen}
        onClose={() => setNewExamDialogOpen(false)}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle>
          {isMobile && (
            <IconButton
              edge="start"
              color="inherit"
              onClick={() => setNewExamDialogOpen(false)}
              aria-label="close"
              sx={{ mr: 2 }}
            >
              <MoreVertIcon />
            </IconButton>
          )}
          新建考卷
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <TextField
              fullWidth
              label="考卷标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="考卷描述"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              rows={3}
              sx={{ mb: 2 }}
            />
            
            {/* 课程选择 */}
            <FormControl fullWidth sx={{ mb: 3 }}>
              <InputLabel>选择课程</InputLabel>
              <Select
                multiple
                value={selectedCourses}
                onChange={handleCoursesChange}
                input={<OutlinedInput label="选择课程" />}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map((value) => (
                      <Chip
                        key={value}
                        label={courses.find(c => c.id === value)?.course_name}
                      />
                    ))}
                  </Box>
                )}
              >
                {courses.map((course) => (
                  <MenuItem key={course.id} value={course.id}>
                    <Checkbox checked={selectedCourses.includes(course.id)} />
                    <ListItemText 
                      primary={course.course_name}
                      secondary={`知识点: ${course.knowledge_point_count} | 题目: ${course.question_count}`}
                    />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* 知识点选择 */}
            {selectedCourses.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle1" gutterBottom>
                  知识点选择
                </Typography>
                
                {/* 全选按钮 */}
                <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button
                    variant="outlined"
                    onClick={handleSelectAllPoints}
                    size="small"
                  >
                    全选知识点
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={handleUnselectAllPoints}
                    size="small"
                  >
                    取消全选
                  </Button>
                </Box>

                {/* 已选知识点计数 */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1, mb: 2, flexWrap: 'wrap' }}>
                  <Typography variant="body2" color="text.secondary">
                    已选择 {selectedPoints.length} 个知识点
                  </Typography>
                  <Chip
                    size="small"
                    label={`单选题：${selectedPointsQuestionCounts.single}题`}
                    color="primary"
                    variant="outlined"
                  />
                  <Chip
                    size="small"
                    label={`多选题：${selectedPointsQuestionCounts.multiple}题`}
                    color="primary"
                    variant="outlined"
                  />
                </Box>
                <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
                      <TextField
                        size="small"
                        label="搜索知识点"
                        variant="outlined"
                        fullWidth={isMobile}
                        onChange={(e) => {
                          const searchValue = e.target.value.toLowerCase();
                          if (searchValue === '') {
                            // 当搜索内容为空时，显示所有已选课程的知识点
                            if (selectedCourses.length > 0) {
                              const fetchOriginalPoints = async () => {
                                try {
                                  const promises = selectedCourses.map(courseId =>
                                    fetch(`${API_BASE_URL}/courses/${courseId}/knowledge_points`)
                                      .then(res => res.json())
                                  );
                                  const allPointsData = await Promise.all(promises);
                                  const mergedPoints = allPointsData.flat();
                                  const uniquePoints = Array.from(
                                    new Map(mergedPoints.map(point => [point.id, point])).values()
                                  );
                                  setKnowledgePoints(uniquePoints);
                                } catch (error) {
                                  console.error('Error fetching original knowledge points:', error);
                                }
                              };
                              fetchOriginalPoints();
                            }
                          } else {
                            // 在所有已选课程的知识点中进行搜索
                            const fetchAndFilterPoints = async () => {
                              try {
                                const promises = selectedCourses.map(courseId =>
                                  fetch(`${API_BASE_URL}/courses/${courseId}/knowledge_points`)
                                    .then(res => res.json())
                                );
                                const allPointsData = await Promise.all(promises);
                                const mergedPoints = allPointsData.flat();
                                const uniquePoints = Array.from(
                                  new Map(mergedPoints.map(point => [point.id, point])).values()
                                );
                                const filteredPoints = uniquePoints.filter(point =>
                                  point.point_name.toLowerCase().includes(searchValue)
                                );
                                setKnowledgePoints(filteredPoints);
                              } catch (error) {
                                console.error('Error fetching and filtering knowledge points:', error);
                              }
                            };
                            fetchAndFilterPoints();
                          }
                        }}
                      />
                    </Box>
                {/* 知识点列表 */}
                {knowledgePoints.length > 0 ? (
                  <Box>
                    
                    <TableContainer component={Paper}>
                      <Table size={isMobile ? "small" : "medium"}>
                        <TableHead>
                          <TableRow>
                            <TableCell padding="checkbox">
                              <Checkbox
                                indeterminate={selectedPoints.length > 0 && selectedPoints.length < knowledgePoints.length}
                                checked={selectedPoints.length === knowledgePoints.length}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    handleSelectAllPoints();
                                  } else {
                                    handleUnselectAllPoints();
                                  }
                                }}
                              />
                            </TableCell>
                            <TableCell>知识点名称</TableCell>
                            {!isMobile && (
                              <>
                                <TableCell align="right">单选题数量</TableCell>
                                <TableCell align="right">多选题数量</TableCell>
                                <TableCell>所属课程</TableCell>
                              </>
                            )}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {knowledgePoints
                            .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                            .map((point) => (
                              <TableRow
                                key={point.id}
                                selected={selectedPoints.includes(point.id)}
                                onClick={() => {
                                  setSelectedPoints(prev =>
                                    prev.includes(point.id)
                                      ? prev.filter(id => id !== point.id)
                                      : [...prev, point.id]
                                  );
                                }}
                                hover
                                sx={{ cursor: 'pointer' }}
                              >
                                <TableCell padding="checkbox">
                                  <Checkbox
                                    checked={selectedPoints.includes(point.id)}
                                  />
                                </TableCell>
                                <TableCell>{point.point_name}</TableCell>
                                {!isMobile && (
                                  <>
                                    <TableCell align="right">{point.single_count || 0}</TableCell>
                                    <TableCell align="right">{point.multiple_count || 0}</TableCell>
                                    <TableCell>{point.course_name}</TableCell>
                                  </>
                                )}
                              </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <TablePagination
                        component="div"
                        count={knowledgePoints.length}
                        page={page}
                        onPageChange={(e, newPage) => setPage(newPage)}
                        rowsPerPage={rowsPerPage}
                        onRowsPerPageChange={(e) => {
                          setRowsPerPage(parseInt(e.target.value, 10));
                          setPage(0);
                        }}
                        labelRowsPerPage={isMobile ? "行数" : "每页行数"}
                      />
                    </TableContainer>
                  </Box>
                ) : (
                  <Typography color="text.secondary">
                    暂无知识点
                  </Typography>
                )}
              </Box>
            )}

            {/* 题目数量设置 */}
            {selectedPoints.length > 0 && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle1" gutterBottom>
                  题目数量设置
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      type="number"
                      label="单选题数量 （每题1分）"
                      value={singleCount}
                      onChange={handleSingleCountChange}
                      inputProps={{ 
                        min: 0,
                        max: 100
                      }}
                      helperText={`试卷总分：${(parseInt(singleCount) || 0) + multipleCount * 2}/100`}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      type="number"
                      label="多选题数量（每题2分）"
                      value={multipleCount}
                      onChange={handleMultipleCountChange}
                      inputProps={{ 
                        min: 0,
                        max: 50
                      }}
                      disabled={true}
                    />
                  </Grid>
                </Grid>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2, flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={() => {
            setNewExamDialogOpen(false)
            resetForm()
          }}>
            取消
          </Button>
          <Button onClick={handleNewExam} variant="contained" color="primary">
            创建
          </Button>
        </DialogActions>
      </Dialog>

      {/* 编辑考卷对话框 */}
      <Dialog
        open={editDialogOpen}
        onClose={handleEditCancel}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
        disableEnforceFocus={false}
        disablePortal={false}
      >
        <DialogTitle>
          {isMobile && (
            <IconButton
              edge="start"
              color="inherit"
              onClick={handleEditCancel}
              aria-label="close"
              sx={{ mr: 2 }}
            >
              <MoreVertIcon />
            </IconButton>
          )}
          编辑考卷
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <TextField
              fullWidth
              label="考卷标题"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="考卷描述"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              multiline
              rows={3}
              sx={{ mb: 2 }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={handleEditCancel}>取消</Button>
          <Button onClick={handleEditSave} variant="contained" color="primary">
            保存
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default ExamList
