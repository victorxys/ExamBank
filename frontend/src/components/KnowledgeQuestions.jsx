import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../config'
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
  FormControlLabel
} from '@mui/material'
import {
  Add as AddIcon,
  Remove as RemoveIcon,
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material'

function Questions() {
  const { courseId, knowledgePointId } = useParams()
  const navigate = useNavigate()
  const theme = useTheme()
  
  const [knowledgePoint, setKnowledgePoint] = useState(null)
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingQuestion, setEditingQuestion] = useState(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [questionToDelete, setQuestionToDelete] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [searchType, setSearchType] = useState('question')
  
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)

        // 获取知识点信息
        const pointResponse = await fetch(`${API_BASE_URL}/knowledge_points/${knowledgePointId}`)
        if (!pointResponse.ok) {
          throw new Error(`Failed to fetch knowledge point: ${pointResponse.status}`)
        }
        const pointData = await pointResponse.json()
        setKnowledgePoint(pointData)

        // 获取题目列表，添加搜索参数
        const questionsResponse = await fetch(
          `${API_BASE_URL}/knowledge_points/${knowledgePointId}/questions?search=${searchText}&type=${searchType}`
        )
        if (!questionsResponse.ok) {
          throw new Error(`Failed to fetch questions: ${questionsResponse.status}`)
        }
        const questionsData = await questionsResponse.json()
        setQuestions(questionsData)
      } catch (error) {
        console.error('Error:', error)
        setError(error.message)
      } finally {
        setLoading(false)
      }
    }
    
    // 使用防抖进行搜索
    const timeoutId = setTimeout(fetchData, 300)
    return () => clearTimeout(timeoutId)
  }, [knowledgePointId, searchText, searchType])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100%', maxWidth: '100%' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error || !knowledgePoint) {
    return (
      <Box sx={{ p: 3, width: '100%', maxWidth: '100%' }}>
        <Button
          color="primary"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate(`/courses/${courseId}/knowledge_points`)}
          sx={{ mb: 3 }}
        >
          返回知识点列表
        </Button>
        <Typography color="error" gutterBottom>
          {error || '知识点不存在'}
        </Typography>
      </Box>
    )
  }

  const handleEditQuestion = (question) => {
    setEditingQuestion({
      ...question,
      options: [...question.options].sort((a, b) => a.id - b.id)
    })
    setEditDialogOpen(true)
  }

  const handleAddQuestion = () => {
    setEditingQuestion({
      question_text: '',
      question_type: '单选题',
      difficulty: 3,
      knowledge_point_id: knowledgePointId,
      answer_text: '',
      explanation: '',
      source: '',
      options: []
    })
    setEditDialogOpen(true)
  }

  const handleSaveQuestion = async () => {
    try {
      // 验证必填字段
      if (!editingQuestion.question_text.trim()) {
        alert('请输入题目内容')
        return
      }

      if (editingQuestion.options.length === 0) {
        alert('请至少添加一个选项')
        return
      }

      if (!editingQuestion.options.some(opt => opt.option_text.trim() && opt.is_correct)) {
        alert('请至少选择一个有内容的正确答案')
        return
      }

      const questionData = {
        question_text: editingQuestion.question_text.trim(),
        question_type: editingQuestion.question_type,
        difficulty: editingQuestion.difficulty || 3,
        knowledge_point_id: knowledgePointId,
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
      }

      let response
      if (editingQuestion.id) {
        // 更新现有题目
        response = await fetch(`${API_BASE_URL}/questions/${editingQuestion.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(questionData),
        })
      } else {
        // 创建新题目
        response = await fetch(`${API_BASE_URL}/questions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(questionData),
        })
      }

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `Failed to ${editingQuestion.id ? 'update' : 'create'} question: ${response.status}`)
      }

      const updatedQuestion = await response.json()
      
      // 更新题目列表
      if (editingQuestion.id) {
        // 如果是更新现有题目，保持原有位置
        setQuestions(questions.map(q => 
          q.id === updatedQuestion.id ? updatedQuestion : q
        ))
      } else {
        // 如果是新题目，添加到列表最前方
        setQuestions([updatedQuestion, ...questions])
      }

      setEditDialogOpen(false)
      setEditingQuestion(null)
    } catch (error) {
      console.error('Failed to save question:', error)
      alert(error.message)
    }
  }

  const handleAddOption = () => {
    const maxId = Math.max(...(editingQuestion.options.map(opt => opt.id || 0)), 0)
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
    }))
  }

  const handleRemoveOption = (optionId) => {
    setEditingQuestion(prev => ({
      ...prev,
      options: prev.options.filter(opt => opt.id !== optionId)
    }))
  }

  const handleOptionChange = (optionId, field, value) => {
    setEditingQuestion(prev => ({
      ...prev,
      options: prev.options.map(opt =>
        opt.id === optionId ? { ...opt, [field]: value } : opt
      )
    }))
  }

  const openDeleteDialog = (question) => {
    setQuestionToDelete(question)
    setDeleteDialogOpen(true)
  }

  const handleDeleteQuestion = async () => {
    try {
      // 检查题目是否被试卷引用
      const checkResponse = await fetch(`${API_BASE_URL}/questions/${questionToDelete.id}/check-usage`);
      const checkData = await checkResponse.json();
      
      if (checkData.is_used_in_exam) {
        throw new Error('该题目已被试卷引用，无法删除');
      }

      const response = await fetch(`${API_BASE_URL}/questions/${questionToDelete.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to delete question: ${response.status}`);
      }

      // 从列表中移除被删除的题目
      setQuestions(questions.filter(q => q.id !== questionToDelete.id));
      setDeleteDialogOpen(false);
      setQuestionToDelete(null);
    } catch (error) {
      console.error('Failed to delete question:', error);
      alert(error.message);
    }
  };

  return (
    <Box sx={{ p: 3, width: '100%', maxWidth: '100%' }}>
      <Button
        color="primary"
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate(`/courses/${courseId}/knowledge_points`)}
        sx={{ mb: 3 }}
      >
        返回知识点列表
      </Button>

      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" gutterBottom>
          {knowledgePoint.point_name} - 题目管理
        </Typography>
        
        {/* 搜索栏 */}
        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <TextField
            label="搜索"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            size="small"
            sx={{ width: '300px' }}
          />
          <FormControl size="small" sx={{ width: '150px' }}>
            <InputLabel>搜索类型</InputLabel>
            <Select
              value={searchType}
              onChange={(e) => setSearchType(e.target.value)}
              label="搜索类型"
            >
              <MenuItem value="question">题目</MenuItem>
              <MenuItem value="point">知识点</MenuItem>
              <MenuItem value="course">课程</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddQuestion}
          >
            添加题目
          </Button>
        </Box>
      </Box>

      {/* 题目列表 */}
      <Grid container spacing={2}>
        {questions.map((question) => (
          <Grid item xs={12} key={question.id}>
            <Card variant="outlined">
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                  <Typography variant="subtitle1" component="div" sx={{ flex: 1 }}>
                    {question.question_text}
                  </Typography>
                  <Box>
                    <IconButton 
                      size="small" 
                      onClick={() => handleEditQuestion(question)}
                      sx={{ mr: 1 }}
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
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                </Box>
                
                <Box sx={{ ml: 2 }}>
                  {question.options.map((option) => (
                    <Box 
                      key={option.id} 
                      sx={{ 
                        display: 'flex', 
                        alignItems: 'center',
                        color: option.is_correct ? 'success.main' : 'text.primary'
                      }}
                    >
                      <Typography variant="body2">
                        {option.char}. {option.option_text}
                      </Typography>
                      {option.is_correct && (
                        <Chip 
                          label="正确答案" 
                          color="success" 
                          size="small" 
                          sx={{ ml: 1 }}
                        />
                      )}
                    </Box>
                  ))}
                </Box>
                
                <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Chip 
                    label={question.question_type === 'single' ? '单选题' : '多选题'} 
                    size="small"
                  />
                  <Chip 
                    label={`难度: ${question.difficulty}`} 
                    size="small"
                  />
                  {question.is_used_in_exam && (
                    <Chip 
                      label="已用于试卷" 
                      color="warning" 
                      size="small"
                    />
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* 编辑对话框 */}
      <Dialog 
        open={editDialogOpen} 
        onClose={() => setEditDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={2} width="100%">
            <Typography variant="h6">
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
