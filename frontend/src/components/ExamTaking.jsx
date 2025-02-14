import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Box,
  Container,
  Typography,
  FormControl,
  FormControlLabel,
  FormGroup,
  Radio,
  RadioGroup,
  Checkbox,
  Button,
  CircularProgress,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material'
import UserLoginDialog from './UserLoginDialog'

function ExamTaking() {
  const { examId } = useParams()
  const navigate = useNavigate()
  const [exam, setExam] = useState(null)
  const [questions, setQuestions] = useState({ single: [], multiple: [] })
  const [answers, setAnswers] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [examResult, setExamResult] = useState(null)
  const [user, setUser] = useState(null)
  const [showLoginDialog, setShowLoginDialog] = useState(true)

  useEffect(() => {
    if (user) {
      fetchExamQuestions()
    }
  }, [examId, user])

  const fetchExamQuestions = async () => {
    try {
      setLoading(true)
      const response = await fetch(`http://localhost:5000/api/exams/${examId}/take`)
      if (!response.ok) {
        throw new Error('Failed to fetch exam questions')
      }
      const data = await response.json()
      setExam(data.exam)
      setQuestions(data.questions)
    } catch (error) {
      console.error('Error fetching exam questions:', error)
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSingleChoiceChange = (questionId, optionId) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: [optionId]
    }))
  }

  const handleMultipleChoiceChange = (questionId, optionId, checked) => {
    setAnswers(prev => {
      const currentAnswers = prev[questionId] || []
      if (checked) {
        return {
          ...prev,
          [questionId]: [...currentAnswers, optionId]
        }
      } else {
        return {
          ...prev,
          [questionId]: currentAnswers.filter(id => id !== optionId)
        }
      }
    })
  }

  const handleSubmit = async () => {
    try {
      const response = await fetch(`http://localhost:5000/api/exams/${examId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          answers,
          user_id: user.id
        })
      })
      if (!response.ok) {
        throw new Error('Failed to submit exam')
      }
      const result = await response.json()
      setExamResult(result)
      setShowConfirmDialog(false)
    } catch (error) {
      console.error('Error submitting exam:', error)
      setError(error.message)
    }
  }

  const handleLogin = (userData) => {
    setUser(userData)
    setShowLoginDialog(false)
  }

  if (!user) {
    return (
      <UserLoginDialog
        open={showLoginDialog}
        onClose={() => navigate('/exams')}
        onLogin={handleLogin}
      />
    )
  }

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

  if (!exam) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>
          考卷不存在
        </Typography>
      </Box>
    )
  }

  if (examResult) {
    return (
      <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h4" gutterBottom align="center">
            考试结果
          </Typography>
          
          <Box sx={{ mt: 3, mb: 4, textAlign: 'center' }}>
            <Typography variant="subtitle1" gutterBottom>
              考生：{user.username}
            </Typography>
            <Typography variant="h5" gutterBottom>
              得分：{examResult.score}分
            </Typography>
            <Typography variant="subtitle1">
              总题数：{examResult.total_questions} | 正确：{examResult.correct_count} | 错误：{examResult.total_questions - examResult.correct_count}
            </Typography>
          </Box>

          <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
            错题解析
          </Typography>
          
          {examResult.results.filter(q => !q.is_correct).map((question, index) => (
            <Box key={question.question_id} sx={{ mb: 4, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Typography variant="subtitle1" gutterBottom>
                {index + 1}. {question.question_text}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                题型：{question.question_type}
              </Typography>
              
              <Box sx={{ mt: 1 }}>
                {question.options.map((option, optIndex) => (
                  <Typography
                    key={option.id}
                    variant="body1"
                    sx={{
                      mb: 1,
                      pl: 2,
                      color: option.is_correct ? 'success.main' : 
                            question.submitted_answer.includes(option.id) ? 'error.main' : 'text.primary'
                    }}
                  >
                    {String.fromCharCode(65 + optIndex)}. {option.content}
                    {option.is_correct && ' ✓'}
                    {!option.is_correct && question.submitted_answer.includes(option.id) && ' ✗'}
                  </Typography>
                ))}
              </Box>
            </Box>
          ))}

          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Button variant="contained" onClick={() => navigate('/exams')}>
              返回考卷列表
            </Button>
          </Box>
        </Paper>
      </Container>
    )
  }

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h4" gutterBottom align="center">
          {exam.title}
        </Typography>
        <Typography variant="subtitle1" gutterBottom align="center" color="text.secondary">
          课程：{exam.course_name}
        </Typography>
        <Typography variant="subtitle1" gutterBottom align="center">
          考生：{user.username}
        </Typography>

        {/* 单选题 */}
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" gutterBottom>
            单选题（共 {questions.single?.length || 0} 道）
          </Typography>
          {questions.single?.map((question, index) => (
            <Box key={question.id} sx={{ mb: 4 }}>
              <Typography variant="subtitle1" gutterBottom>
                {index + 1}. {question.question_text}
              </Typography>
              <FormControl component="fieldset">
                <RadioGroup
                  value={answers[question.id]?.[0] || ''}
                  onChange={(e) => handleSingleChoiceChange(question.id, e.target.value)}
                >
                  {question.options.map((option, optIndex) => (
                    <FormControlLabel
                      key={option.id}
                      value={option.id}
                      control={<Radio />}
                      label={`${String.fromCharCode(65 + optIndex)}. ${option.content}`}
                    />
                  ))}
                </RadioGroup>
              </FormControl>
            </Box>
          ))}
        </Box>

        {/* 多选题 */}
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" gutterBottom>
            多选题（共 {questions.multiple?.length || 0} 道）
          </Typography>
          {questions.multiple?.map((question, index) => (
            <Box key={question.id} sx={{ mb: 4 }}>
              <Typography variant="subtitle1" gutterBottom>
                {index + 1}. {question.question_text}
              </Typography>
              <FormGroup>
                {question.options.map((option, optIndex) => (
                  <FormControlLabel
                    key={option.id}
                    control={
                      <Checkbox
                        checked={answers[question.id]?.includes(option.id) || false}
                        onChange={(e) => handleMultipleChoiceChange(question.id, option.id, e.target.checked)}
                      />
                    }
                    label={`${String.fromCharCode(65 + optIndex)}. ${option.content}`}
                  />
                ))}
              </FormGroup>
            </Box>
          ))}
        </Box>

        <Box sx={{ mt: 4, textAlign: 'center' }}>
          <Button
            variant="contained"
            color="primary"
            size="large"
            onClick={() => setShowConfirmDialog(true)}
          >
            提交答案
          </Button>
        </Box>
      </Paper>

      {/* 确认提交对话框 */}
      <Dialog
        open={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
      >
        <DialogTitle>确认提交</DialogTitle>
        <DialogContent>
          <Typography>
            确定要提交答案吗？提交后将无法修改。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowConfirmDialog(false)}>取消</Button>
          <Button onClick={handleSubmit} variant="contained" color="primary">
            确认提交
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  )
}

export default ExamTaking
