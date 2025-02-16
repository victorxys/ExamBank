import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
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
  IconButton
} from '@mui/material'
import { Add as AddIcon } from '@mui/icons-material'
import DeleteIcon from '@mui/icons-material/Delete';

function ExamList() {
  const navigate = useNavigate()
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newExamDialogOpen, setNewExamDialogOpen] = useState(false)
  const [editingExam, setEditingExam] = useState(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedCourses, setSelectedCourses] = useState([])
  const [courses, setCourses] = useState([])
  const [knowledgePoints, setKnowledgePoints] = useState([])
  const [selectedPoints, setSelectedPoints] = useState([])
  const [singleCount, setSingleCount] = useState(0)
  const [multipleCount, setMultipleCount] = useState(0)
  const [examRecords, setExamRecords] = useState([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [examToDelete, setExamToDelete] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        const [examsResponse, coursesResponse, recordsResponse] = await Promise.all([
          fetch('http://localhost:5000/api/exams'),
          fetch('http://localhost:5000/api/courses'),
          fetch('http://localhost:5000/api/exam-records')
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
      const response = await fetch('http://localhost:5000/api/courses')
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
      const response = await fetch('http://localhost:5000/api/exam-records')
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
      const response = await fetch('http://localhost:5000/api/exams');
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
        alert('请输入考卷标题')
        return
      }
      if (selectedCourses.length === 0) {
        alert('请选择至少一个课程')
        return
      }
      if (selectedPoints.length === 0) {
        alert('请选择至少一个知识点')
        return
      }
      if (singleCount === 0 && multipleCount === 0) {
        alert('请设置要抽取的题目数量')
        return
      }

      const response = await fetch('http://localhost:5000/api/exams', {
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
    } catch (error) {
      console.error('Error creating exam:', error)
      alert(error.message || '创建考卷失败，请重试')
    }
  }

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setSelectedCourses([])
    setSelectedPoints([])
    setSingleCount(0)
    setMultipleCount(0)
  }

  const handleCoursesChange = async (event) => {
    const courseIds = event.target.value
    setSelectedCourses(courseIds)
    
    if (courseIds.length > 0) {
      try {
        const response = await fetch(`http://localhost:5000/api/courses/${courseIds.join(',')}/points`)
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
    window.open(`/take-exam/${examId}?preview=true`, '_blank');
  };

  const handleShare = (examId) => {
    const examUrl = `${window.location.origin}/take-exam/${examId}`;
    navigator.clipboard.writeText(examUrl).then(() => {
      alert('答题链接已复制到剪贴板！');
    });
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

  const handleDeleteCancel = () => {
    setExamToDelete(null);
    setDeleteDialogOpen(false);
  };

  const handleDeleteConfirm = async () => {
    try {
      const response = await fetch(`http://localhost:5000/api/exams/${examToDelete.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete exam');
      }

      // Remove the deleted exam from the state
      setExams(exams.filter(exam => exam.id !== examToDelete.id));
      setDeleteDialogOpen(false);
      setExamToDelete(null);
    } catch (error) {
      console.error('Error deleting exam:', error);
      // You might want to show an error message to the user here
    }
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
    <Box sx={{ width: '100%', height: '100%', p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4">
          考卷管理
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setNewExamDialogOpen(true)}
        >
          新建考卷
        </Button>
      </Box>

      <Grid container spacing={2}>
        {exams.map((exam) => {
          // 确保有一个有效的唯一标识符
          const examKey = exam.id 
            ? `exam-${exam.id}-${Date.now()}`
            : `exam-${Math.random().toString(36).substr(2, 9)}`;
            
          return (
            <Grid item xs={12} sm={6} md={4} key={examKey}>
              <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ flexGrow: 1 }}>
                  <Typography gutterBottom variant="h5" component="div">
                    {exam.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {exam.description || '无描述'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    课程：{exam.course_names?.join('、') || '无课程'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    单选题：{exam.single_count || 0}题
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    多选题：{exam.multiple_count || 0}题
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    创建时间：{new Date(exam.created_at).toLocaleString()}
                  </Typography>
                </CardContent>
                <CardActions>
                  <Button
                    variant="contained"
                    color="primary"
                    component={Link}
                    to={`/take-exam/${exam.id}`}
                    sx={{ mr: 1 }}
                  >
                    开始考试
                  </Button>
                  <Button size="small" onClick={() => handleViewDetails(exam.id, exam.created_at)}>
                    查看详情
                  </Button>
                  <Button size="small" onClick={() => handlePreview(exam.id)}>
                    预览
                  </Button>
                  <Button size="small" onClick={() => handleShare(exam.id)}>
                    分享
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Table>
        <TableBody>
          {examRecords.map((record) => {
            // 确保有一个有效的唯一标识符
            const recordKey = record.uniqueId || `record-${Math.random().toString(36).substr(2, 9)}`;
            
            return (
              <TableRow key={recordKey}>
                <TableCell>{record.exam_title}</TableCell>
                <TableCell>{record.total_score}</TableCell>
                <TableCell>{new Date(record.created_at).toLocaleString()}</TableCell>
                <TableCell>
                  <Button
                    variant="contained"
                    color="primary"
                    size="small"
                    onClick={() => handleViewRecord(record.exam_id, record.user_id, record.created_at)}
                  >
                    查看详情
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

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
                            {point.name}
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
                      label="单选题数量"
                      value={singleCount}
                      onChange={(e) => setSingleCount(parseInt(e.target.value) || 0)}
                      inputProps={{ min: 0 }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      type="number"
                      label="多选题数量"
                      value={multipleCount}
                      onChange={(e) => setMultipleCount(parseInt(e.target.value) || 0)}
                      inputProps={{ min: 0 }}
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

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
      >
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            确定要删除试卷 "{examToDelete?.title}" 吗？此操作将同时删除所有相关的考试记录，且不可恢复。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>取消</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default ExamList
