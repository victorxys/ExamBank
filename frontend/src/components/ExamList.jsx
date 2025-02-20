import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTheme } from '@mui/material/styles'
import { API_BASE_URL } from '../config';
import {
  Box,
  Button,
  Typography,
  Card,
  CardContent,
  CardActions,
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
  Share as ShareIcon
} from '@mui/icons-material'
import AlertMessage from './AlertMessage';

function ExamList() {
  const navigate = useNavigate()
  const theme = useTheme()
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
  const [singleCount, setSingleCount] = useState('');
  const [multipleCount, setMultipleCount] = useState(0);
  const [examRecords, setExamRecords] = useState([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [examToDelete, setExamToDelete] = useState(null);
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedExam, setSelectedExam] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        const [examsResponse, coursesResponse, recordsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/exams`),
          fetch(`${API_BASE_URL}/courses`),
          fetch(`${API_BASE_URL}/exam-records`)
        ])

        if (!examsResponse.ok || !coursesResponse.ok || !recordsResponse.ok) {
          throw new Error('获取数据失败')
        }

        const [examsData, coursesData, recordsData] = await Promise.all([
          examsResponse.json(),
          coursesResponse.json(),
          recordsResponse.json()
        ])

        // 为每条记录生成唯一的 key
        const processedRecords = recordsData.map(record => ({
          ...record,
          // 使用 exam_id 和 created_at 组合作为唯一标识符
          uniqueId: record.exam_id && record.created_at 
            ? `${record.exam_id}-${new Date(record.created_at).getTime()}`
            : `record-${Math.random().toString(36).substr(2, 9)}`
        }));

        setExams(examsData)
        setCourses(coursesData)
        setExamRecords(processedRecords)
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

  const fetchExamRecords = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/exam-records`)
      if (!response.ok) {
        throw new Error('Failed to fetch exam records')
      }
      const data = await response.json()
      setExamRecords(data)
    } catch (error) {
      console.error('Error fetching exam records:', error)
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
      fetchExamRecords()
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

  const handleCoursesChange = async (event) => {
    const courseIds = event.target.value
    setSelectedCourses(courseIds)
    
    if (courseIds.length > 0) {
      try {
        const response = await fetch(`${API_BASE_URL}/courses/${courseIds.join(',')}/knowledge_points`)
        if (!response.ok) {
          throw new Error('Failed to fetch knowledge points')
        }
        const data = await response.json()
        console.log('Knowledge points:', data) // 添加日志
        setKnowledgePoints(data)
        setSelectedPoints([]) // 清空已选知识点
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

  const handleViewRecord = (examId, userId, examTime) => {
    // 确保时间格式正确
    const formattedTime = new Date(examTime).toISOString().replace('Z', '+00:00');
    navigate(`/exam-records/${examId}/${userId}?exam_time=${encodeURIComponent(formattedTime)}`);
  }

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

  const renderExamRecords = () => {
    return examRecords.map((record) => {
      const recordKey = `record-${record.exam_id}-${record.user_id}-${record.exam_time}`;
      return (
        <TableRow key={recordKey}>
          <TableCell>{record.exam_title}</TableCell>
          <TableCell>{record.user_phone}</TableCell>
          <TableCell>{record.score}</TableCell>
          <TableCell>{record.exam_time}</TableCell>
          <TableCell>
            <Button
              variant="contained"
              size="small"
              onClick={() => handleViewExamRecord(record.exam_id, record.user_id, record.exam_time)}
            >
              查看详情
            </Button>
          </TableCell>
        </TableRow>
      );
    });
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
            考卷管理
          </Typography>
          <Typography variant="body1" color="white" sx={{ opacity: 0.8 }}>
            这里列出了所有可用的考卷，您可以添加、编辑或删除考卷。
          </Typography>
        </Box>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddIcon />}
          onClick={() => setNewExamDialogOpen(true)}
          sx={{
            background: 'linear-gradient(87deg, #5e72e4 0, #825ee4 100%)',
            '&:hover': {
              background: 'linear-gradient(87deg, #4050e0 0, #6f4ed4 100%)',
            },
          }}
        >
          新建考卷
        </Button>
      </Box>

      <Card sx={{ boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)', borderRadius: '0.375rem', backgroundColor: 'transparent', border: 'none' }}>
        <Grid container spacing={2}>
          {exams.map((exam) => {
            const examKey = exam.id 
              ? `exam-${exam.id}-${Date.now()}`
              : `exam-${Math.random().toString(36).substr(2, 9)}`;
              
            return (
              <Grid item xs={12} sm={6} lg={4} key={examKey}>
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
                  onClick={() => handleViewDetails(exam.id, exam.created_at)}
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
                        <Typography variant="h2">{exam.title}</Typography>
                      </Box>
                      <IconButton
                        onClick={(e) => {
                          e.stopPropagation();
                          setAnchorEl(e.currentTarget);
                          setSelectedExam(exam);
                        }}
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
                      {exam.description || '暂无描述'}
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
                        label={`单选题：${exam.single_count || 0}题`}
                        color="primary"
                        variant="outlined"
                      />
                      <Chip
                        icon={<QuestionAnswerIcon />}
                        label={`多选题：${exam.multiple_count || 0}题`}
                        color="primary"
                        variant="outlined"
                      />
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      </Card>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        <MenuItem onClick={() => {
          setAnchorEl(null);
          handlePreview(selectedExam.id);
        }}>
          <VisibilityIcon sx={{ mr: 1 }} />
          预览
        </MenuItem>
        <MenuItem onClick={() => {
          setAnchorEl(null);
          handleShare(selectedExam.id);
        }}>
          <ShareIcon sx={{ mr: 1 }} />
          分享
        </MenuItem>
        <MenuItem 
          onClick={() => {
            setAnchorEl(null);
            handleDeleteClick(selectedExam);
          }} 
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon sx={{ mr: 1 }} />
          删除
        </MenuItem>
      </Menu>

      {/* 删除确认对话框 */}
      <Dialog open={deleteDialogOpen} onClose={handleDeleteCancel}>
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
      >
        <DialogTitle>新建考卷</DialogTitle>
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
                <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
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
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  已选择 {selectedPoints.length} 个知识点
                </Typography>

                {/* 知识点列表 */}
                {knowledgePoints.length > 0 ? (
                  <Grid container spacing={1}>
                    {knowledgePoints.map((point) => (
                      <Grid item xs={12} sm={6} md={4} key={point.id}>
                        <Paper
                          sx={{
                            p: 2,
                            cursor: 'pointer',
                            bgcolor: selectedPoints.includes(point.id) ? 'primary.light' : 'background.paper',
                            color: selectedPoints.includes(point.id) ? 'primary.contrastText' : 'text.primary',
                            '&:hover': {
                              bgcolor: 'action.hover',
                            },
                          }}
                          onClick={() => {
                            setSelectedPoints(prev =>
                              prev.includes(point.id)
                                ? prev.filter(id => id !== point.id)
                                : [...prev, point.id]
                            )
                          }}
                        >
                          <Typography variant="subtitle2" gutterBottom>
                            {point.point_name}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 2 }}>
                            <Typography variant="caption" color="text.secondary">
                              单选题：{point.single_count || 0}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              多选题：{point.multiple_count || 0}
                            </Typography>
                          </Box>
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
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
        <DialogActions>
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
    </Box>
  )
}

export default ExamList
