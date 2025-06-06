import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
// import { API_BASE_URL } from '../config'
import {
  Box,
  Button,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Rating,
  IconButton,
  Stack,
  Divider,
  FormLabel,
  Grid,
  Card,
  CardContent,
  RadioGroup,
  Radio,
  Checkbox,
  Chip,
  useTheme,
  CircularProgress,
  FormControlLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper
} from '@mui/material'
import AlertMessage from './AlertMessage'
import {
  Add as AddIcon,
  Remove as RemoveIcon,
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Person as PersonIcon,
  Notifications as NotificationsIcon,
} from '@mui/icons-material'
import PageHeader from './PageHeader'
import api from '../api/axios'; // <<<--- 新增：导入 api 实例


function Questions() {
  const navigate = useNavigate()
  const theme = useTheme()
  const location = useLocation()
  const queryParams = new URLSearchParams(location.search)
  
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingQuestion, setEditingQuestion] = useState(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [questionToDelete, setQuestionToDelete] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [searchType, setSearchType] = useState('question')
  const [courses, setCourses] = useState([])
  const [knowledgePoints, setKnowledgePoints] = useState([])
  const [selectedCourse, setSelectedCourse] = useState(queryParams.get('course_id') || '')
  const [selectedKnowledgePoint, setSelectedKnowledgePoint] = useState(queryParams.get('knowledge_point_id') || '')
  const [filteredKnowledgePoints, setFilteredKnowledgePoints] = useState([])
  const [aiGenerating, setAiGenerating] = useState(false)

  // fetchData 函数需要使用 useCallback 并包含所有依赖项
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {}; // Axios 会自动处理 URLSearchParams
      if (searchText) params.title = searchText;
      if (selectedCourse) params.course = selectedCourse;
      if (selectedKnowledgePoint) params.knowledgePoint = selectedKnowledgePoint;

      // 获取所有题目列表
      const questionsResponse = await api.get('/questions', { params }); // <<<--- 修改
      setQuestions(questionsResponse.data.data || []); // 假设后端返回 { data: [...] }

      // 获取课程列表
      const coursesResponse = await api.get('/courses'); // <<<--- 修改
      setCourses(coursesResponse.data || []);

      // 如果选择了课程，获取该课程下的知识点
      if (selectedCourse) {
        // 假设后端 /api/courses/:courseId/knowledge_points 返回该课程所有知识点
        // 或者，如果 /knowledge-points 接口支持按 course_id 过滤，则不需要额外调用
        // 这里我们假设 /knowledge-points 已经可以通过 params.course 过滤，所以上面的调用已足够
        // 如果后端是 /courses/:id/knowledge_points，则需要像 KnowledgePoints.jsx 那样单独调用
        const pointsResponse = await api.get(`/courses/${selectedCourse}/knowledge_points`); // <<<--- 修改
        setKnowledgePoints(pointsResponse.data || []);
        setFilteredKnowledgePoints(pointsResponse.data || []);
      } else {
        setKnowledgePoints([]);
        setFilteredKnowledgePoints([]);
      }
    } catch (error) {
      console.error('Error fetching data in Questions.jsx:', error);
      setError(error.response?.data?.error || error.message || '获取数据失败');
    } finally {
      setLoading(false);
    }
  }, [searchText, selectedCourse, selectedKnowledgePoint]); // <<<--- 添加依赖

  useEffect(() => {
    fetchData();
  }, [fetchData]); // 依赖 fetchData


  // 当编辑对话框打开时，如果有选中的课程，加载该课程的知识点列表
  // 当编辑对话框打开时，加载知识点 (如果 course_id 存在)
  useEffect(() => {
    const loadKnowledgePoints = async () => {
      if (editingQuestion?.course_id) {
        try {
          // 假设后端 /api/courses/:courseId/knowledge_points 返回该课程所有知识点
          const response = await api.get(`/courses/${editingQuestion.course_id}/knowledge_points`); // <<<--- 修改
          setKnowledgePoints(response.data || []);
        } catch (error) {
          console.error('Error loading knowledge points for edit:', error);
        }
      }
    };
    if (editDialogOpen) {
      loadKnowledgePoints();
    }
  }, [editDialogOpen, editingQuestion?.course_id]);

  const handleCourseChange = (event) => {
    const courseId = event.target.value;
    setSelectedCourse(courseId);
    setSelectedKnowledgePoint(''); // 重置知识点选择
  };

  const handleAddOption = () => {
    const maxId = editingQuestion.options.length > 0
      ? Math.max(...editingQuestion.options.map(opt => parseInt(opt.id) || 0))
      : 0;
    setEditingQuestion(prev => ({
      ...prev,
      options: [
        ...prev.options,
        {
          id: maxId + 1,
          option_text: '',
          is_correct: false
        }
      ]
    }));
  };

  const handleOptionChange = (optionId, field, value) => {
    setEditingQuestion(prev => ({
      ...prev,
      options: prev.options.map(opt =>
        opt.id === optionId ? { ...opt, [field]: value } : opt
      )
    }));
  };

  const handleRemoveOption = (optionId) => {
    setEditingQuestion(prev => ({
      ...prev,
      options: prev.options.filter(opt => opt.id !== optionId)
    }));
  };

  const handleDeleteQuestion = async () => {
    try {
      if (!questionToDelete) return;
      const checkResponse = await api.get(`/questions/${questionToDelete.id}/check-usage`); // <<<--- 修改
      // ...
      await api.delete(`/questions/${questionToDelete.id}`); // <<<--- 修改
      // ...
      setQuestions(questions.filter(q => q.id !== questionToDelete.id));
      setDeleteDialogOpen(false);
      setQuestionToDelete(null);
    } catch (error) {
      console.error('删除题目失败:', error);
      alert(error.response?.data?.error || error.message || '删除题目失败');
    }
  };

  const handleAddQuestion = () => {
    setEditingQuestion({
      question_text: '',
      question_type: '单选题',
      difficulty: 3,
      course_id: selectedCourse || '',
      knowledge_point_id: selectedKnowledgePoint || '',
      answer_text: '',
      explanation: '',
      source: '',
      options: []
    });
    setEditDialogOpen(true);
  };

  const handleEditQuestion = async (question) => {
    setEditingQuestion({
      ...question,
      options: [...(question.options || [])].sort((a, b) => a.id - b.id)
    });
    setEditDialogOpen(true);

    // 加载该题目所属课程的知识点列表
    if (question.course_id) {
      try {
        const response = await fetch(`${API_BASE_URL}/courses/${question.course_id}/knowledge_points`);
        if (!response.ok) {
          throw new Error(`获取知识点列表失败: ${response.status}`);
        }
        const data = await response.json();
        setKnowledgePoints(data || []);
      } catch (error) {
        console.error('Error loading knowledge points:', error);
      }
    }
  };

  const handleSaveQuestion = async () => {
    try {
      // 验证必填字段
      if (!editingQuestion.question_text.trim()) {
        alert('请输入题目内容');
        return;
      }

      if (editingQuestion.options.length === 0) {
        alert('请至少添加一个选项');
        return;
      }

      if (!editingQuestion.options.some(opt => opt.option_text.trim() && opt.is_correct)) {
        alert('请至少选择一个有内容的正确答案');
        return;
      }

      const questionData = {
        question_text: editingQuestion.question_text.trim(),
        question_type: editingQuestion.question_type,
        difficulty: editingQuestion.difficulty || 3,
        course_id: editingQuestion.course_id,
        knowledge_point_id: editingQuestion.knowledge_point_id,
        answer_text: editingQuestion.answer_text?.trim() || '',
        explanation: editingQuestion.explanation?.trim() || '',
        source: editingQuestion.source?.trim() || '',
        // 过滤掉空选项
        options: editingQuestion.options
          .filter(opt => opt.option_text.trim())
          .map(opt => ({
            option_text: opt.option_text.trim(),
            is_correct: opt.is_correct
          }))
      };

      let response;
      if (editingQuestion.id) {
        // 更新现有题目
        response = await api.put(`/questions/${editingQuestion.id}`, questionData); 
      } else {
        // 创建新题目
        response = await api.post('/questions', questionData); 
      }

      const updatedOrNewQuestion = response.data; // Axios 响应数据在 response.data

      if (editingQuestion.id) {
        setQuestions(questions.map(q => q.id === updatedOrNewQuestion.id ? updatedOrNewQuestion : q));
      } else {
        setQuestions(prevQuestions => [updatedOrNewQuestion, ...prevQuestions]);
      }

      setEditDialogOpen(false);
      setEditingQuestion(null);
    } catch (error) {
      console.error('Failed to save question:', error);
      alert(error.response?.data?.error || error.message || '保存题目失败');
    }
  };
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100%', maxWidth: '100%' }}>
        <CircularProgress />
      </Box>
    );
  }
  // 在搜索栏部分添加课程和知识点选择
  return (
  <Box sx={{ width: '100%', height: '100%' }}>
    <PageHeader
        title="题库管理"
        description="这里列出了所有可用的题目，您可以添加、编辑或删除题目。"
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddQuestion}
            sx={{
              background: 'linear-gradient(87deg, #5e72e4 0, #825ee4 100%)',
              '&:hover': {
                background: 'linear-gradient(87deg, #4050e0 0, #6f4ed4 100%)',
              },
            }}
          >
            添加题目
          </Button>
        }
      />
    <Box
    >
    </Box>

    <Box
      sx={{
        backgroundColor: 'white',
        borderRadius: '0.375rem',
        boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)',
        p: 3,
        mb: 4
      }}
    >
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <TextField
          label="搜索题目"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          size="small"
          sx={{
            width: '300px',
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
          placeholder="输入题目关键词"
        />
        <FormControl size="small" sx={{ width: '200px' }}>
          <InputLabel>选择课程</InputLabel>
          <Select
            value={selectedCourse}
            onChange={handleCourseChange}
            label="选择课程"
          >
            <MenuItem value="">全部课程</MenuItem>
            {courses.map((course) => (
              <MenuItem key={course.id} value={course.id}>
                {course.course_name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ width: '200px' }}>
          <InputLabel>选择知识点</InputLabel>
          <Select
            value={selectedKnowledgePoint}
            onChange={(e) => setSelectedKnowledgePoint(e.target.value)}
            label="选择知识点"
            disabled={!selectedCourse}
          >
            <MenuItem value="">全部知识点</MenuItem>
            {filteredKnowledgePoints.map((point) => (
              <MenuItem key={point.id} value={point.id}>
                {point.point_name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        
      </Box>

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
            <TableRow>
              <TableCell>题目内容</TableCell>
              <TableCell>题目类型</TableCell>
              <TableCell>知识点</TableCell>
              <TableCell>课程</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {Array.isArray(questions) && questions.map((question) => (
              <TableRow
                key={question.id}
                sx={{
                  '&:hover': {
                    backgroundColor: '#f6f9fc'
                  }
                }}
              >
                <TableCell sx={{ color: '#525f7f' }}>{question.question_text}</TableCell>
                <TableCell>
                  <Chip 
                    label={question.question_type === '单选题' ? '单选题' : '多选题'} 
                    size="small"
                    sx={{
                      backgroundColor: 'rgba(94, 114, 228, 0.1)',
                      color: theme.palette.primary.main,
                      fontWeight: 600
                    }}
                  />
                </TableCell>
                <TableCell sx={{ color: '#525f7f' }}>{question.knowledge_point_name || '-'}</TableCell>
                <TableCell sx={{ color: '#525f7f' }}>{question.course_name || '-'}</TableCell>
                <TableCell>
                  {question.is_used_in_exam && (
                    <Chip 
                      label="已用于试卷" 
                      color="warning" 
                      size="small"
                      sx={{
                        backgroundColor: 'rgba(251, 99, 64, 0.1)',
                        color: '#fb6340',
                        fontWeight: 600
                      }}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <IconButton
                    size="small"
                    onClick={() => handleEditQuestion(question)}
                    sx={{
                      mr: 1,
                      color: theme.palette.primary.main,
                      '&:hover': {
                        backgroundColor: 'rgba(94, 114, 228, 0.1)'
                      }
                    }}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => {
                      setQuestionToDelete(question)
                      setDeleteDialogOpen(true)
                    }}
                    disabled={question.is_used_in_exam}
                    sx={{
                      color: theme.palette.error.main,
                      '&:hover': {
                        backgroundColor: 'rgba(245, 54, 92, 0.1)'
                      },
                      '&.Mui-disabled': {
                        color: 'rgba(0, 0, 0, 0.26)'
                      }
                    }}
                  >
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>

      {/* 编辑对话框 */}
      <Dialog 
        open={editDialogOpen} 
        onClose={() => setEditDialogOpen(false)}
        maxWidth="md"
        fullWidth
        disableEnforceFocus={false}
        disablePortal={false}
        aria-labelledby="edit-question-title"
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={2} width="100%">
            <Typography variant="h6" id="edit-question-title">
              {editingQuestion?.id ? '编辑考题' : '添加新考题'}
            </Typography>
            {editingQuestion?.question_type && (
              <Typography 
                variant="subtitle1" 
                sx={{ 
                  backgroundColor: 'primary.main',
                  color: 'white',
                  px: 1,
                  py: 0.5,
                  borderRadius: 1,
                  fontSize: '0.875rem'
                }}
              >
                {editingQuestion.question_type}
              </Typography>
            )}
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {editingQuestion && (
            <Stack spacing={3} width="100%">
              <FormControl>
                <FormLabel>题目类型</FormLabel>
                <RadioGroup
                  row
                  value={editingQuestion.question_type}
                  onChange={(e) => {
                    const newType = e.target.value;
                    setEditingQuestion(prev => {
                      // 如果从多选改为单选，只保留第一个正确答案
                      const updatedOptions = prev.question_type === '多选题' && newType === '单选题'
                        ? prev.options.map((opt, index) => ({
                            ...opt,
                            is_correct: opt.is_correct && index === prev.options.findIndex(o => o.is_correct)
                          }))
                        : prev.options;
                      
                      return {
                        ...prev,
                        question_type: newType,
                        options: updatedOptions
                      };
                    });
                  }}
                >
                  <FormControlLabel value="单选题" control={<Radio />} label="单选题" />
                  <FormControlLabel value="多选题" control={<Radio />} label="多选题" />
                </RadioGroup>
              </FormControl>

              <TextField
                label="题目内容"
                multiline
                rows={3}
                value={editingQuestion.question_text}
                onChange={(e) => setEditingQuestion(prev => ({
                  ...prev,
                  question_text: e.target.value
                }))}
                fullWidth
              />

              <FormControl fullWidth>
                <InputLabel>所属课程</InputLabel>
                <Select
                  value={editingQuestion.course_id || ''}
                  label="所属课程"
                  onChange={(e) => setEditingQuestion(prev => ({
                    ...prev,
                    course_id: e.target.value
                  }))}
                >
                  {courses.map((course) => (
                    <MenuItem key={course.id} value={course.id}>
                      {course.course_name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel>所属知识点</InputLabel>
                <Select
                  value={editingQuestion.knowledge_point_id || ''}
                  label="所属知识点"
                  onChange={(e) => setEditingQuestion(prev => ({
                    ...prev,
                    knowledge_point_id: e.target.value
                  }))}
                >
                  {knowledgePoints.map((point) => (
                    <MenuItem key={point.id} value={point.id}>
                      {point.point_name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Box>
                <Typography component="div" variant="subtitle1" gutterBottom>
                  难度
                </Typography>
                <Rating
                  value={editingQuestion.difficulty || 0}
                  onChange={(e, newValue) => setEditingQuestion(prev => ({
                    ...prev,
                    difficulty: newValue
                  }))}
                />
              </Box>

              {editingQuestion.question_type !== '问答' && (
                <Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                    <Typography component="div" variant="subtitle1">
                      选项（{editingQuestion.question_type}）
                    </Typography>
                    <Button
                      startIcon={<AddIcon />}
                      onClick={handleAddOption}
                    >
                      添加选项
                    </Button>
                  </Box>
                  {editingQuestion.options.map((option) => (
                    <Box key={option.id} display="flex" alignItems="center" mb={2} width="100%">
                      {editingQuestion.question_type === '单选题' ? (
                        <Radio
                          checked={option.is_correct}
                          onChange={(e) => {
                            const newOptions = editingQuestion.options.map((opt) => ({
                              ...opt,
                              is_correct: opt.id === option.id
                            }));
                            setEditingQuestion(prev => ({
                              ...prev,
                              options: newOptions
                            }));
                          }}
                        />
                      ) : (
                        <Checkbox
                          checked={option.is_correct}
                          onChange={(e) => handleOptionChange(option.id, 'is_correct', e.target.checked)}
                        />
                      )}
                      <TextField
                        value={option.option_text}
                        onChange={(e) => handleOptionChange(option.id, 'option_text', e.target.value)}
                        fullWidth
                        size="small"
                        sx={{ mx: 1 }}
                      />
                      <IconButton onClick={() => handleRemoveOption(option.id)} size="small">
                        <RemoveIcon />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}

              <TextField
                label="参考答案"
                multiline
                rows={2}
                value={editingQuestion.answer_text || ''}
                onChange={(e) => setEditingQuestion(prev => ({
                  ...prev,
                  answer_text: e.target.value
                }))}
                fullWidth
              />

              <TextField
                label="答案解析"
                multiline
                rows={3}
                value={editingQuestion.explanation || ''}
                onChange={(e) => setEditingQuestion(prev => ({
                  ...prev,
                  explanation: e.target.value
                }))}
                fullWidth
              />

              <TextField
                label="来源"
                value={editingQuestion.source || ''}
                onChange={(e) => setEditingQuestion(prev => ({
                  ...prev,
                  source: e.target.value
                }))}
                fullWidth
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>
            取消
          </Button>
          <Button onClick={handleSaveQuestion} variant="contained" color="primary">
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>
            确定要删除这道题目吗？此操作不可恢复。
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            题目内容：{questionToDelete?.question_text}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button 
            onClick={handleDeleteQuestion} 
            color="error"
            variant="contained"
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default Questions
