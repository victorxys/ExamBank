import React, { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  Box,
  Typography,
  CircularProgress
} from '@mui/material'

export default function AddQuestionDialog({ open, onClose, onAdd, courseId, examId }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [availableQuestions, setAvailableQuestions] = useState([])

  useEffect(() => {
    if (open && courseId) {
      fetchAvailableQuestions()
    }
  }, [open, courseId])

  const fetchAvailableQuestions = async () => {
    try {
      setLoading(true)
      const response = await fetch(`http://localhost:5000/api/courses/${courseId}/questions?exam_id=${examId}`)
      if (!response.ok) {
        throw new Error('Failed to fetch available questions')
      }
      const data = await response.json()
      setAvailableQuestions(data)
    } catch (error) {
      console.error('Error fetching available questions:', error)
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = async (questionId) => {
    await onAdd(questionId)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>添加题目</DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Typography color="error" sx={{ p: 2 }}>
            Error: {error}
          </Typography>
        ) : availableQuestions.length === 0 ? (
          <Typography sx={{ p: 2 }}>
            没有可添加的题目
          </Typography>
        ) : (
          <List>
            {availableQuestions.map((question) => (
              <Box
                key={question.id}
                sx={{
                  mb: 2,
                  p: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  position: 'relative'
                }}
              >
                <Box sx={{ pr: 4 }}>
                  <Typography variant="subtitle1" gutterBottom>
                    {question.question_text}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    知识点：{question.point_name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    题型：{question.question_type === 'single' ? '单选题' : '多选题'}
                  </Typography>
                  {question.options && Array.isArray(question.options) && question.options.map((option, optIndex) => (
                    <Typography 
                      key={option.id} 
                      variant="body1" 
                      sx={{ 
                        mb: 1,
                        pl: 2,
                        color: option.is_correct ? 'success.main' : 'text.primary'
                      }}
                    >
                      {String.fromCharCode(65 + optIndex)}. {option.content}
                      {option.is_correct && ' ✓'}
                    </Typography>
                  ))}
                </Box>
                <Button
                  variant="contained"
                  size="small"
                  sx={{ position: 'absolute', top: 8, right: 8 }}
                  onClick={() => handleAdd(question.id)}
                >
                  添加
                </Button>
              </Box>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  )
}
