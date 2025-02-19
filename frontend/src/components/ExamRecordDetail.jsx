import React, { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { API_BASE_URL } from '../config';
import {
  Container,
  Box,
  Typography,
  Paper,
  Grid,
  CircularProgress,
  Chip
} from '@mui/material'

const ExamRecordDetail = () => {
  const { examId, userId } = useParams()
  const [searchParams] = useSearchParams()
  const examTime = searchParams.get('exam_time')

  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dataVersion, setDataVersion] = useState(0)

  const getCacheKey = (examId, userId, examTime) => {
    return `exam-record-${examId}-${userId}-${examTime}`;
  };

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const fetchExamRecord = async () => {
      if (!examId || !userId || !examTime) {
        setError('缺少必要的ID信息');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const cacheKey = getCacheKey(examId, userId, examTime);
        const cachedData = sessionStorage.getItem(cacheKey);
        
        if (cachedData) {
          const parsedData = JSON.parse(cachedData);
          if (isMounted) {
            setRecord(parsedData);
            setLoading(false);
          }
          return;
        }

        const formattedTime = examTime.includes('T') ? examTime : examTime.replace(' ', 'T');
        const timeWithZone = formattedTime.includes('+') ? formattedTime : `${formattedTime}+08:00`;
        const response = await fetch(
          `${API_BASE_URL}/exam-records/${examId}/${userId}?exam_time=${encodeURIComponent(timeWithZone)}`,
          {
            signal: abortController.signal,
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json;charset=UTF-8'
            }
          }
        );
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || '获取考试记录失败');
        }
        
        const data = await response.json();
        
        const baseKey = `exam-${examId}-user-${userId}-time-${formattedTime}`;
        
        const processedData = {
          ...data,
          questions: data.questions?.map((q, index) => ({
            ...q,
            uniqueId: `${baseKey}-q-${q.id || index}`
          })),
          courses: data.courses?.map((course, index) => ({
            ...course,
            uniqueId: `${baseKey}-c-${course.id || index}`
          })),
          baseKey
        };

        if (isMounted) {
          sessionStorage.setItem(cacheKey, JSON.stringify(processedData));
          setRecord(processedData);
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          console.log('Fetch aborted');
          return;
        }
        console.error('Error fetching exam record:', error);
        if (isMounted) {
          setError(error.message || '获取考试记录失败，请重试');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchExamRecord();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [examId, userId, examTime, dataVersion]);

  const handleRetry = () => {
    setDataVersion(v => v + 1);  
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    try {
      const date = new Date(timeStr);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch (e) {
      return timeStr;
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight="100vh">
        <Typography color="error" component="div" gutterBottom>{error}</Typography>
        <Typography 
          component="div" 
          sx={{ 
            cursor: 'pointer', 
            color: 'primary.main',
            '&:hover': { textDecoration: 'underline' }
          }}
          onClick={handleRetry}
        >
          点击重试
        </Typography>
      </Box>
    );
  }

  if (!record) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <Typography component="div">未找到考试记录</Typography>
      </Box>
    );
  }

  return (
    <Container maxWidth="lg">
      {/* 试卷标题和基本信息 */}
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          {record.exam_title}
        </Typography>
        <Grid container spacing={2} justifyContent="center">
          <Grid item>
            <Typography variant="body1">
              考生：{record.username} ({record.phone_number})
            </Typography>
          </Grid>
          <Grid item>
            <Typography variant="body1">
              考试时间：{formatTime(record.exam_time)}
            </Typography>
          </Grid>
          <Grid item>
            <Typography variant="body1">
              得分：
              <span style={{ 
                color: record.total_score >= 60 ? '#4CAF50' : '#FF5252',
                fontWeight: 'bold'
              }}>
                {record.total_score}分
              </span>
            </Typography>
          </Grid>
          <Grid item>
            <Typography variant="body1">
              答题次数：第 {record.attempt_number} 次
            </Typography>
          </Grid>
        </Grid>
      </Box>

      {/* 试题列表 */}
      {record.questions?.map((question, index) => (
        <Paper 
          key={question.uniqueId || index} 
          sx={{ 
            p: 3, 
            mb: 3,
            border: '1px solid',
            borderColor: question.is_correct ? '#4CAF50' : '#FF5252',
            borderRadius: 2
          }}
        >
          <Box sx={{ mb: 2 }}>
            <Typography variant="h6" gutterBottom>
              {index + 1}. {question.question_text} [{question.question_type}]
            </Typography>
            
            {/* 知识点和课程信息 */}
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <Chip 
                label={`课程: ${question.course_name}`} 
                size="small" 
                color="primary" 
                variant="outlined"
              />
              <Chip 
                label={`知识点: ${question.knowledge_point}`} 
                size="small" 
                color="secondary" 
                variant="outlined"
              />
            </Box>

            {/* 选项列表 */}
            <Box sx={{ ml: 2 }}>
              {question.options?.map((option, optIndex) => {
                const isSelected = question.selected_option_ids?.includes(option.id);
                const isCorrect = option.is_correct;
                
                return (
                  <Box 
                    key={option.id || optIndex}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      mb: 1,
                      p: 1,
                      backgroundColor: 
                        isCorrect && isSelected ? 'rgba(76, 175, 80, 0.1)' :
                        isCorrect ? 'rgba(76, 175, 80, 0.05)' :
                        isSelected ? 'rgba(255, 82, 82, 0.1)' :
                        'transparent',
                      borderRadius: 1,
                      position: 'relative'
                    }}
                  >
                    {/* 选择状态标记 */}
                    <Box
                      sx={{
                        position: 'absolute',
                        left: -24,
                        display: 'flex',
                        alignItems: 'center',
                        color: isSelected ? '#FF5252' : 'transparent'
                      }}
                    >
                      ●
                    </Box>
                    
                    {/* 选项字母 */}
                    <Typography 
                      sx={{ 
                        minWidth: 24,
                        color: 
                          isCorrect ? '#4CAF50' :
                          isSelected ? '#FF5252' :
                          'text.primary'
                      }}
                    >
                      {option.char}.
                    </Typography>

                    {/* 选项内容 */}
                    <Typography
                      sx={{
                        flex: 1,
                        color: 
                          isCorrect ? '#4CAF50' :
                          isSelected ? '#FF5252' :
                          'text.primary'
                      }}
                    >
                      {option.text}
                    </Typography>

                    {/* 正确/错误标记 */}
                    <Box sx={{ ml: 1, display: 'flex', alignItems: 'center' }}>
                      {isCorrect && (
                        <Typography sx={{ color: '#4CAF50', fontWeight: 'bold' }}>
                          ✓
                        </Typography>
                      )}
                      {!isCorrect && isSelected && (
                        <Typography sx={{ color: '#FF5252', fontWeight: 'bold' }}>
                          ✗
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>

          {/* 答案解析 */}
          {question.explanation && (
            <Box 
              sx={{ 
                mt: 2, 
                p: 2, 
                backgroundColor: 'rgba(25, 118, 210, 0.05)',
                borderRadius: 1
              }}
            >
              <Typography variant="subtitle2" color="primary" gutterBottom>
                答案解析：
              </Typography>
              <Typography variant="body2">
                {question.explanation}
              </Typography>
            </Box>
          )}
        </Paper>
      ))}
    </Container>
  );
};

export default ExamRecordDetail;
