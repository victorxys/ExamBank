import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Container,
  Typography,
  Paper,
  List,
  ListItemButton,
  ListItemText,
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
  Pagination,
  CircularProgress,
  FormControlLabel,
  Radio,
  RadioGroup,
  Checkbox,
  Stack,
  Divider,
  FormLabel
} from '@mui/material'
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Remove as RemoveIcon
} from '@mui/icons-material'

const ITEMS_PER_PAGE = 10

function Questions({ knowledgePoint, onBack, courseId }) {
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [editingQuestion, setEditingQuestion] = useState(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [sortOrder, setSortOrder] = useState('time') // 'time' 或 'text' 或 'id'

  useEffect(() => {
    fetchQuestions()
  }, [knowledgePoint.id])

  const fetchQuestions = async () => {
    try {
      const response = await fetch(`http://localhost:5000/api/knowledge_points/${knowledgePoint.id}/questions`)
      const data = await response.json()
      setQuestions(data)
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  // 排序题目
  const sortedQuestions = [...questions].sort((a, b) => {
    if (sortOrder === 'time') {
      return new Date(b.created_at) - new Date(a.created_at)
    } else if (sortOrder === 'text') {
      return a.question_text.localeCompare(b.question_text, 'zh-CN')
    } else {
      return a.id - b.id
    }
  })

  const handleEditQuestion = (question) => {
    // 确保选项按id排序
    const sortedOptions = [...question.options].sort((a, b) => a.id - b.id)
    setEditingQuestion({
      ...question,
      options: sortedOptions.map(opt => ({ ...opt }))
    })
    setEditDialogOpen(true)
  }

  const handleSaveQuestion = async () => {
    try {
      const response = await fetch(`http://localhost:5000/api/questions/${editingQuestion.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editingQuestion),
      })
      
      if (response.ok) {
        fetchQuestions()
        setEditDialogOpen(false)
        setEditingQuestion(null)
      } else {
        console.error('Failed to update question')
      }
    } catch (error) {
      console.error('Error:', error)
    }
  }

  const handleAddOption = () => {
    // 为新选项生成一个临时id，确保它比现有选项的id都大
    const maxId = Math.max(...editingQuestion.options.map(opt => opt.id || 0), 0)
    setEditingQuestion(prev => ({
      ...prev,
      options: [
        ...prev.options,
        { id: maxId + 1, option_text: '', is_correct: false }
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

  const startIndex = (page - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const displayedQuestions = sortedQuestions.slice(startIndex, endIndex)
  const pageCount = Math.ceil(sortedQuestions.length / ITEMS_PER_PAGE)

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box display="flex" alignItems="center" mb={4}>
        <Button onClick={onBack} color="primary">
          返回知识点列表
        </Button>
        <Typography variant="h4" component="h1" sx={{ ml: 2 }}>
          {knowledgePoint.point_name} - 考题列表
        </Typography>
        <Box sx={{ ml: 'auto' }}>
          <Button
            onClick={() => setSortOrder(order => {
              if (order === 'time') return 'text'
              if (order === 'text') return 'id'
              return 'time'
            })}
            color="primary"
          >
            {sortOrder === 'time' ? '按题目文字排序' : 
             sortOrder === 'text' ? '按题目ID排序' : 
             '按创建时间排序'}
          </Button>
        </Box>
      </Box>

      <Paper elevation={1}>
        <List>
          {displayedQuestions.map((question) => (
            <div key={question.id}>
              <ListItemButton onClick={() => handleEditQuestion(question)}>
                <ListItemText
                  primary={
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography 
                        component="span" 
                        variant="subtitle1" 
                        color="primary"
                        sx={{ 
                          backgroundColor: 'primary.main',
                          color: 'white',
                          px: 1,
                          py: 0.5,
                          borderRadius: 1,
                          fontSize: '0.875rem'
                        }}
                      >
                        {question.question_type === '单选' ? '单选题' : 
                         question.question_type === '多选' ? '多选题' : 
                         question.question_type}
                      </Typography>
                      <Typography component="span" variant="subtitle1">
                        {question.question_text}
                      </Typography>
                      <Rating 
                        value={question.difficulty || 0}
                        readOnly
                        size="small"
                        sx={{ ml: 'auto' }}
                      />
                    </Box>
                  }
                  secondary={
                    <Box component="div">
                      {question.question_type !== '问答' && (
                        <Box sx={{ mt: 1 }}>
                          {[...question.options]
                            .sort((a, b) => a.id - b.id)
                            .map((option, index) => (
                            <Typography 
                              key={option.id}
                              component="div" 
                              variant="body2" 
                              color={option.is_correct ? 'success.main' : 'text.secondary'}
                              sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                            >
                              {option.is_correct ? '✓' : '○'} {option.option_text}
                            </Typography>
                          ))}
                        </Box>
                      )}
                      <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                        <Typography component="div" variant="caption" color="text.secondary">
                          创建时间：{new Date(question.created_at).toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </Typography>
                        {question.updated_at && new Date(question.updated_at).getTime() > new Date(question.created_at).getTime() && (
                          <Typography component="div" variant="caption" color="text.secondary">
                            修改时间：{new Date(question.updated_at).toLocaleString('zh-CN', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </Typography>
                        )}
                      </Stack>
                    </Box>
                  }
                />
              </ListItemButton>
              <Divider />
            </div>
          ))}
          {sortedQuestions.length === 0 && (
            <ListItemText
              sx={{ p: 3, textAlign: 'center' }}
              primary={
                <Typography component="div" color="text.secondary">
                  暂无考题
                </Typography>
              }
            />
          )}
        </List>

        {sortedQuestions.length > ITEMS_PER_PAGE && (
          <Box display="flex" justifyContent="center" p={2}>
            <Pagination
              count={pageCount}
              page={page}
              onChange={(e, value) => setPage(value)}
              color="primary"
            />
          </Box>
        )}
      </Paper>

      <Dialog 
        open={editDialogOpen} 
        onClose={() => setEditDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={2}>
            <Typography variant="h6">编辑考题</Typography>
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
              {editingQuestion?.question_type}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {editingQuestion && (
            <Stack spacing={3}>
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
                <InputLabel>知识点</InputLabel>
                <Select
                  value={editingQuestion.knowledge_point_id}
                  onChange={(e) => setEditingQuestion(prev => ({
                    ...prev,
                    knowledge_point_id: e.target.value
                  }))}
                >
                  {editingQuestion.available_knowledge_points?.map((point) => (
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
                  {[...editingQuestion.options]
                    .sort((a, b) => a.id - b.id)
                    .map((option) => (
                    <Box key={option.id} display="flex" alignItems="center" mb={2}>
                      {editingQuestion.question_type === '单选题' ? (
                        <Radio
                          checked={option.is_correct}
                          onChange={(e) => {
                            // 单选题：只能有一个正确答案
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
    </Container>
  )
}

export default Questions
