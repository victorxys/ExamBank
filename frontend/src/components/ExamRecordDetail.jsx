import React, { useEffect, useState } from 'react'
import { useParams, useSearchParams, useLocation } from 'react-router-dom'
import { API_BASE_URL } from '../config';
import {
  Container,
  Box,
  Typography,
  Paper,
  Grid,
  CircularProgress,
  Chip,
  Card,
  CardContent,
  Divider
} from '@mui/material'
import { FormControlLabel, Switch } from '@mui/material'
import {
  Person as PersonIcon,
  AccessTime as AccessTimeIcon,
  History as HistoryIcon,
  RadioButtonChecked as RadioButtonCheckedIcon,
  CheckBox as CheckBoxIcon
} from '@mui/icons-material'

const ExamRecordDetail = () => {
  const { examId, userId } = useParams()
  const [searchParams] = useSearchParams()
  const examTime = searchParams.get('exam_time')
  const location = useLocation()
  const recordData = location.state || {}

  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dataVersion, setDataVersion] = useState(0)
  const [showOnlyIncorrect, setShowOnlyIncorrect] = useState(false)

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
            setRecord({
              ...parsedData,
              ...recordData
            });
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
          ...recordData,
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
  }, [examId, userId, examTime, dataVersion, recordData]);

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
        <Typography variant="h2" gutterBottom>          
          {record.exam_title}        
        </Typography>        
        <Card sx={{ 
          mb: 3, 
          borderRadius: '0.375rem',
          boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)',
          backgroundColor: 'white'
        }}>
          <CardContent>
            {/* 考生信息行 */}
            <Grid container spacing={3} sx={{ mb: 3 }}>
              <Grid item xs={12} md={4}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <PersonIcon sx={{ color: 'primary.main' }} />
                  <Typography variant="body1">
                    考生：{record.username} 
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={12} md={4}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AccessTimeIcon sx={{ color: 'primary.main' }} />
                  <Typography variant="body1">
                    考试时间：{formatTime(record.exam_time)}
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={12} md={4}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <HistoryIcon sx={{ color: 'primary.main' }} />
                  <Typography variant="body1">
                    第 {record.attempt_number || 1} 次答题
                  </Typography>
                </Box>
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />

            {/* 得分信息行 */}
            <Grid container spacing={3}>
              <Grid item xs={12} md={4}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body1">得分：</Typography>
                  <Typography
                    variant="body1"
                    sx={{
                      color: record.total_score >= 60 ? '#2dce89' : '#f5365c',
                      fontWeight: 600,
                      backgroundColor: record.total_score >= 60 ? 'rgba(45, 206, 137, 0.1)' : 'rgba(245, 54, 92, 0.1)',
                      borderRadius: '0.25rem',
                      px: 1,
                      py: 0.5,
                      display: 'inline-block'
                    }}
                  >
                    {(typeof record.total_score === 'number' ? record.total_score.toFixed(2) : '0.00')}分
                  </Typography>
                  <Typography variant="body1" sx={{ ml: 2 }}>正确率：</Typography>
                  <Typography
                    variant="body1"
                    sx={{
                      color: (typeof record.accuracy_rate === 'number' && record.accuracy_rate >= 0.6) ? '#2dce89' : '#f5365c',
                      fontWeight: 600,
                      backgroundColor: (typeof record.accuracy_rate === 'number' && record.accuracy_rate >= 0.6) ? 'rgba(45, 206, 137, 0.1)' : 'rgba(245, 54, 92, 0.1)',
                      borderRadius: '0.25rem',
                      px: 1,
                      py: 0.5,
                      display: 'inline-block'
                    }}
                  >
                    {(record.accuracy_rate * 100).toFixed(1)}%
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={12} md={6}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <RadioButtonCheckedIcon sx={{ color: 'primary.main' }} />
                    <Typography variant="body2" component="div">
                      单选题：
                      <Box component="span" sx={{ color: '#2dce89', fontWeight: 600 }}>
                        {record.single_choice_correct || 0}
                      </Box>
                      <Box component="span" sx={{ mx: 0.5 }}>/</Box>
                      <Box component="span" sx={{ color: '#f5365c', fontWeight: 600 }}>
                        {record.single_choice_incorrect || 0}
                      </Box>
                      <Box component="span" sx={{ mx: 0.5 }}>/</Box>
                      <Box component="span" sx={{ color: '#525f7f' }}>
                        {record.single_choice_total || 0}题
                      </Box>
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CheckBoxIcon sx={{ color: 'primary.main' }} />
                    <Typography variant="body2" component="div">
                      多选题：
                      <Box component="span" sx={{ color: '#2dce89', fontWeight: 600 }}>
                        {record.multi_choice_correct || 0}
                      </Box>
                      <Box component="span" sx={{ mx: 0.5 }}>/</Box>
                      <Box component="span" sx={{ color: '#f5365c', fontWeight: 600 }}>
                        {record.multi_choice_incorrect || 0}
                      </Box>
                      <Box component="span" sx={{ mx: 0.5 }}>/</Box>
                      <Box component="span" sx={{ color: '#525f7f' }}>
                        {record.multi_choice_total || 0}题
                      </Box>
                    </Typography>
                  </Box>
                </Box>
              </Grid>
              <Grid item xs={12} md={2}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={showOnlyIncorrect}
                      onChange={(e) => setShowOnlyIncorrect(e.target.checked)}
                      color="primary"
                    />
                  }
                  label="只显示错题"
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      </Box>

      {/* 试题列表 */}
      {/* 单选题部分 */}
      {record.questions?.filter(q => q.question_type === '单选题' && (!showOnlyIncorrect || !q.is_correct)).length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h2" sx={{ mb: 3, fontWeight: 'bold', color: 'primary.main' }}>
            一、单选题
          </Typography>
          {record.questions
            .filter(q => q.question_type === '单选题' && (!showOnlyIncorrect || !q.is_correct))
            .map((question, index) => (
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
                  <Typography variant="h3" gutterBottom>
                    {index + 1}. {question.question_text}
                  </Typography>
                  
                  {/* 知识点和课程信息 */}
                  <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                    <Chip 
                      label={`课程: ${question.course_name}`} 
                      size="small" 
                      color="primary" 
                      variant="outlined"
                      sx={{ borderWidth: 1.5 }}
                    />
                    <Chip 
                      label={`知识点: ${question.knowledge_point}`} 
                      size="small" 
                      color="primary"
                      variant="filled"
                      sx={{ fontWeight: 600 }}
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
                              color: isSelected ? '#666666' : 'transparent'
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
        </Box>
      )}

      {/* 多选题部分 */}
      {record.questions?.filter(q => q.question_type === '多选题' && (!showOnlyIncorrect || !q.is_correct)).length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h2" sx={{ mb: 3, fontWeight: 'bold', color: 'primary.main' }}>
            二、多选题
          </Typography>
          {record.questions
            .filter(q => q.question_type === '多选题' && (!showOnlyIncorrect || !q.is_correct))
            .map((question, index) => (
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
                  <Typography variant="h3" gutterBottom>
                    {index + 1}. {question.question_text}
                  </Typography>
                  
                  {/* 知识点和课程信息 */}
                  <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                    <Chip 
                      label={`课程: ${question.course_name}`} 
                      size="small" 
                      color="primary" 
                      variant="outlined"
                      sx={{ borderWidth: 1.5 }}
                    />
                    <Chip 
                      label={`知识点: ${question.knowledge_point}`} 
                      size="small" 
                      color="primary" 
                      variant="filled"
                      sx={{ fontWeight: 600 }}
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
                              color: isSelected ? '#666666' : 'transparent'
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
        </Box>
      )}
    </Container>
  );
};

export default ExamRecordDetail;
