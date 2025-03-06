import React, { useState, useEffect } from 'react';
import { useParams ,useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import logoSvg from '../assets/logo.svg';
import {
  Container,
  Typography,
  Paper,
  Box,
  Button,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormControl,
  FormLabel,
  Checkbox,
  FormGroup,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Alert,
  Chip,
  Grid
} from '@mui/material';
import { API_BASE_URL } from '../config';
import { hasToken } from '../api/auth-utils';
import { useTheme } from '@mui/material/styles';
import userApi from '../api/user';

// 自定义 Markdown 样式组件
const MarkdownTypography = ({ children, ...props }) => {
  return (
    <Box
      sx={{
        '& p': { mt: 1, mb: 1 },
        '& strong': { fontWeight: 'bold' },
        '& em': { fontStyle: 'italic' },
        '& code': {
          backgroundColor: 'rgba(0, 0, 0, 0.1)',
          padding: '2px 4px',
          borderRadius: '4px',
        },
        '& img': { maxWidth: '100%' },
      }}
      {...props}
    >
      {children}
    </Box>
  );
};

const ExamTake = () => {
  const { examId } = useParams();
  const navigate = useNavigate(); // 添加useNavigate钩子
  const previousActiveElement = React.useRef(null);
  const mainContentRef = React.useRef(null);
  const [exam, setExam] = useState(null);
  const [answers, setAnswers] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [examResult, setExamResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const tokenData = hasToken();
  const [user] = useState(tokenData);
  const [preview, setPreview] = useState(false);
  const [incompleteQuestions, setIncompleteQuestions] = useState([]);
  const [showIncompleteDialog, setShowIncompleteDialog] = useState(false);
  const theme = useTheme();
  const [examStartTime, setExamStartTime] = useState(null);
  const [examDuration, setExamDuration] = useState(null);
  const [userInfo, setUserInfo] = useState(null);

  useEffect(() => {
    // 检查登录状态
    if (!tokenData) {
      navigate('/login', { state: { from: { pathname: `/exams/${examId}/take` } } });
      return;
    }

    if (!examId) {
      setError('试卷ID不能为空');
      setLoading(false);
      return;
    }
    
    const preview = new URLSearchParams(window.location.search).get('preview') === 'true';
    setPreview(preview);
    const fetchExam = async () => {
      try {

        const response = await fetch(`${API_BASE_URL}/exams/${examId}/take`);
        if (!response.ok) {
          throw new Error('获取试卷失败');
        }
        const data = await response.json();
        setExam({
          ...data.exam,
          questions: [
            ...(data.questions.single || []).map(q => ({
              id: q.id,
              question_text: q.question_text,
              question_type: '单选题',
              options: q.options.map(opt => ({
                id: opt.id,
                option_text: opt.content
              }))
            })),
            ...(data.questions.multiple || []).map(q => ({
              id: q.id,
              question_text: q.question_text,
              question_type: '多选题',
              options: q.options.map(opt => ({
                id: opt.id,
                option_text: opt.content
              }))
            }))
          ]
        });
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchExam();
  }, [examId]);

  // 新增一个useEffect来处理临时答案的加载
  useEffect(() => {
    const loadTempAnswersIfNeeded = async () => {
      if (exam && tokenData && tokenData.sub && !preview) {
        console.log('exam已加载，开始加载临时答案');
        await loadTempAnswers(tokenData.sub);
        
        const response = await userApi.getUserDetails(tokenData.sub);
        setUserInfo(response.data);
      }
    };

    loadTempAnswersIfNeeded();
  }, [exam]); // 当exam更新时触发

  const loadTempAnswers = async (userId) => {
    if (!exam) {
      console.log('exam 对象尚未加载，暂不处理临时答案');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/exams/${examId}/temp-answers/${userId}`);

      if (!response.ok) {
        throw new Error('加载临时答案失败');
      }
      const data = await response.json();
      if (data.success && data.temp_answers) {
        const tempAnswers = {};
        console.log('临时答案数据：', data.temp_answers);
        data.temp_answers.forEach(answer => {
          // 获取题目类型
          const question = exam.questions.find(q => q.id === answer.question_id);
          if (!question) return;
          
          console.log('题目类型：', answer);
          // 处理PostgreSQL数组格式：确保selected_option_ids是字符串类型
          const optionIds = typeof answer.selected_option_ids === 'string'
            ? answer.selected_option_ids
                .replace(/[{}]/g, '')
                .split(',')
                .map(id => id.trim())
                .filter(id => id)
            : Array.isArray(answer.selected_option_ids)
              ? answer.selected_option_ids
              : [];

          if (question.question_type === '多选题') {
            // 多选题：将选项ID数组转换为对象格式
            const selectedOptions = {};
            optionIds.forEach(optionId => {
              selectedOptions[optionId] = true;
            });
            tempAnswers[answer.question_id] = {
              question_type: '多选题',
              selected: selectedOptions
            };
          } else {
            // 单选题：使用第一个选项ID
            tempAnswers[answer.question_id] = {
              question_type: '单选题',
              selected: optionIds[0]
            };
          }
        });
        console.log('处理后的临时答案：', tempAnswers);
        setAnswers(tempAnswers);
      }
    } catch (error) {
      console.error('加载临时答案失败:', error);
    }
  };

  

  const handleAnswerChange = (questionId, optionId, type) => {
    console.log('答案变更：', { questionId, optionId, type });
    if (type === '多选题') {
      setAnswers(prev => {
        const newAnswers = {
          ...prev,
          [questionId]: {
            question_type: type,
            selected: {
              ...prev[questionId]?.selected,
              [optionId]: !prev[questionId]?.selected?.[optionId]
            }
          }
        };
        console.log('用户信息：', user);
        console.log('更新后的答案状态11：', newAnswers);
        // 只有在用户已登录时才保存答案
        
        if (user && user.sub) {
          saveAnswerToServer(questionId, newAnswers[questionId]);
        }
        return newAnswers;
      });
    } else {
      setAnswers(prev => {
        const newAnswers = {
          ...prev,
          [questionId]: {
            question_type: type,
            selected: optionId
          }
        };
        
        console.log('更新后的答案状态：', newAnswers);
        // 只有在用户已登录时才保存答案
        if (user && user.sub) {
          saveAnswerToServer(questionId, newAnswers[questionId]);
        }
        return newAnswers;
      });
    }
  };

  const saveAnswerToServer = async (questionId, answer) => {
    if (!user || !user.sub) {
      console.log('用户未登录或用户信息不完整，不执行自动保存');
      return;
    }

    try {
      const selected_options = answer.question_type === '单选题'
        ? [answer.selected]
        : Object.entries(answer.selected || {})
            .filter(([_, selected]) => selected)
            .map(([optionId]) => optionId);

      console.log('准备发送自动保存请求：', {
        examId,
        questionId,
        userId: user.sub,
        selected_options
      });

      const response = await fetch(`${API_BASE_URL}/exams/${examId}/temp-answers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: user.sub,
          question_id: questionId,
          selected_options
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '自动保存失败');
      }

      const result = await response.json();
      console.log('自动保存成功：', result);
    } catch (err) {
      console.error('自动保存失败：', err);
    }
  };

  const checkIncompleteQuestions = () => {
    const incomplete = [];
    exam.questions.forEach((question, index) => {
      const answer = answers[question.id];
      let isIncomplete = false;

      if (question.question_type === '单选题') {
        isIncomplete = !answer?.selected;
      } else if (question.question_type === '多选题') {
        isIncomplete = !answer?.selected || Object.values(answer.selected).filter(Boolean).length === 0;
      }

      if (isIncomplete) {
        incomplete.push({
          ...question,
          index: index + 1
        });
      }
    });
    return incomplete;
  };

  const calculateDuration = (startTime, endTime) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diff = Math.floor((end - start) / 1000); // 转换为秒

    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;

    if (hours > 0) {
      return `${hours}小时${minutes}分${seconds}秒`;
    } else if (minutes > 0) {
      return `${minutes}分${seconds}秒`;
    } else {
      return `${seconds}秒`;
    }
  };

  const handleSubmit = async () => {
    // 检查未完成的题目
    const incomplete = checkIncompleteQuestions();
    if (incomplete.length > 0) {
      setIncompleteQuestions(incomplete);
      setShowIncompleteDialog(true);
      return;
    }

    setIsSubmitting(true);
    try {
      // 转换答案格式
      const formattedAnswers = Object.entries(answers).map(([questionId, answer]) => {
        const selected_options = answer.question_type === '单选题'
          ? [answer.selected]  // 单选题直接使用选中的optionId
          : Object.entries(answer.selected || {})  // 多选题过滤出选中的optionId
              .filter(([_, selected]) => selected)
              .map(([optionId]) => optionId);
      
      console.log('格式化答案：', {
        questionId,
        answer,
        selected_options
      });
      
      return {
        question_id: questionId,
        selected_options
      };
    });
  
    console.log('提交的答案数据：', {
      answers,
      formattedAnswers,
      user_id: user.sub,
      API_BASE_URL:API_BASE_URL,
      examId:examId
    });
  
    const response = await fetch(`${API_BASE_URL}/exams/${examId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: user.sub,
        answers: formattedAnswers
      }),
    });
  
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || '提交答案失败');
    }
  
    const result = await response.json();
    console.log('提交答案结果：', result);
    
    // 计算考试用时
    if (result.start_time && result.submit_time) {
      const duration = calculateDuration(result.start_time, result.submit_time);
      setExamDuration(duration);
    }
    
    setExamResult(result);
    setSubmitted(true);
  
    // 添加页面滚动和焦点设置逻辑
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const scoreElement = document.querySelector('[data-testid="exam-score"]');
      if (scoreElement) {
        scoreElement.focus();
        scoreElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  
  } catch (err) {
    console.error('提交答案时出错：', err);
    setError(err.message);
  } finally {
    setIsSubmitting(false);
  }
};

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Container>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  return (
    <Container>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          mb: 4,
          mt: 2
        }}
      >
        <img src={logoSvg} alt="考试题库系统" style={{ width: '200px' }} />
      </Box>

      {exam && !submitted && (
        <Paper 
          elevation={3}
          sx={{ 
            p: 4, 
            mb: 4,
            backgroundColor: '#f8f9fa',
            borderRadius: 2,
            border: '1px solid #e0e0e0'
          }}
        >
          <Box sx={{ 
            textAlign: 'center', 
            mb: 4,
            borderBottom: '1px solid #e0e0e0',
            pb: 1
          }}>
            <Typography 
              variant="h3" 
              gutterBottom 
              sx={{ 
                fontWeight: 'bold',
                color: theme.palette.primary.main
              }}
            >
              {exam?.title || '考试'}
            </Typography>
            {exam?.description && (
              <Typography 
                variant="subtitle1" 
                sx={{ 
                  color: 'text.secondary',
                  maxWidth: '800px',
                  margin: '0 auto',
                  mb: 3
                }}
              >
                {exam.description}
              </Typography>
            )}
          </Box>

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography variant="body1">
                  <Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>考生姓名：</Box>
                  <Box component="span" sx={{ fontWeight: 'bold' }}>{userInfo?.username || '-'}</Box>
                </Typography>
                <Typography variant="body1">
                  <Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>手机号码：</Box>
                  <Box component="span">{userInfo?.phone_number || '-'}</Box>
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} md={6}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography variant="body1">
                  <Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>题目数量：</Box>
                  <Box component="span">{exam?.questions?.length || 0}题</Box>
                </Typography>
                <Typography variant="body1">
                  <Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>考试时间：</Box>
                  <Box component="span">{new Date().toLocaleString()}</Box>
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </Paper>
      )}

      {/* 未完成题目对话框 */}
      <Dialog
        open={showIncompleteDialog}
        onClose={() => setShowIncompleteDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Typography variant="h6" color="error">
            还有未完成的题目
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" gutterBottom>
            以下题目尚未作答：
          </Typography>
          {incompleteQuestions.map((question) => (
            <Box key={question.id} sx={{ mt: 2 }}>
              <Typography variant="body2" color="error">
                第 {question.index} 题：{question.question_text}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                color="primary"
                sx={{ mt: 1 }}
                onClick={() => {
                  setShowIncompleteDialog(false);
                  const element = document.getElementById(`question-${question.id}`);
                  if (element) {
                    // 获取元素的位置信息
                    const rect = element.getBoundingClientRect();
                    // 计算需要滚动的位置，减去顶部导航栏的高度（假设是64px）和一些额外的空间
                    const scrollTop = window.pageYOffset + rect.top - 100;
                    window.scrollTo({
                      top: scrollTop,
                      behavior: 'smooth'
                    });
                    element.style.backgroundColor = '#fff3e0';
                    setTimeout(() => {
                      element.style.backgroundColor = 'transparent';
                    }, 2000);
                  }
                }}
              >
                前往作答
              </Button>
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowIncompleteDialog(false)} color="primary">
            继续答题
          </Button>
        </DialogActions>
      </Dialog>

      {exam && (
        <Paper sx={{ p: 3, my: 3 }}>
          {submitted ? (
            <Box>
              {/* 考试基本信息 */}
              <Box sx={{ 
                textAlign: 'center', 
                mb: 4,
                borderBottom: '1px solid #e0e0e0',
                pb: 1
              }}>
                <Typography 
                  variant="h3" 
                  gutterBottom 
                  sx={{ 
                    fontWeight: 'bold',
                    color: theme.palette.primary.main
                  }}
                >
                  {exam?.title || '考试结果'}
                </Typography>
                {exam?.description && (
                  <Typography 
                    variant="subtitle1" 
                    sx={{ 
                      color: 'text.secondary',
                      maxWidth: '800px',
                      margin: '0 auto',
                      mb: 3
                    }}
                  >
                    {exam.description}
                  </Typography>
                )}
              </Box>

              <Paper 
                elevation={3}
                sx={{ 
                  p: 4, 
                  mb: 4,
                  backgroundColor: '#f8f9fa',
                  borderRadius: 2,
                  border: '1px solid #e0e0e0'
                }}
              >
                <Grid container spacing={3}>
                  <Grid item xs={12} md={8}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Typography variant="body1">
                        <Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>考生姓名：</Box>
                        <Box component="span" sx={{ fontWeight: 'bold' }}>{examResult?.username || '-'}</Box>
                      </Typography>
                      <Typography variant="body1">
                        <Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>考试时间：</Box>
                        <Box component="span">{new Date(examResult?.start_time).toLocaleString()}</Box>
                      </Typography>
                      <Typography variant="body1">
                        <Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>提交时间：</Box>
                        <Box component="span">{new Date(examResult?.submit_time).toLocaleString()}</Box>
                      </Typography>
                      <Typography variant="body1">
                        <Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>考试用时：</Box>
                        <Box component="span">{examDuration || '-'}</Box>
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Box sx={{ 
                      display: 'flex', 
                      flexDirection: 'column', 
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      backgroundColor: examResult.total_score >= 60 ? '#2dce89' : '#f5365c',
                      background: examResult.total_score >= 60
                        ? 'linear-gradient(87deg, #2dce89 0%, #2fcca0 100%)'
                        : 'linear-gradient(87deg, #f5365c 0%, #f56036 100%)',
                      borderRadius: 2,
                      p: 3,
                      boxShadow: '0 4px 20px 0 rgba(0,0,0,0.14), 0 7px 10px -5px rgba(45,206,137,0.4)',
                      transition: 'all 0.3s ease-in-out'
                    }}>
                      <Typography variant="h2" sx={{ 
                        color: 'white', 
                        mb: 1,
                        opacity: 0.9
                      }}>总分</Typography>
                      <Typography variant="h2" sx={{ 
                        color: 'white', 
                        fontWeight: 'bold',
                        textShadow: '2px 2px 4px rgba(0,0,0,0.2)',
                        fontSize: '3rem'
                      }}>
                        {examResult.total_score}
                      </Typography>
                    </Box>
                  </Grid>
                </Grid>
              </Paper>

              

              {examResult.questions
                .filter(question => !question.is_correct)
                .map((question, index) => (
                <Paper 
                  key={question.id} 
                  sx={{ 
                    mt: 3,
                    p: 3,
                    border: '1px solid #ffcdd2',
                    borderRadius: 2,
                    backgroundColor: '#fff',
                    '& + &': { mt: 3 }
                  }}
                >
                  {/* 错题列表 */}
                  <Typography variant="h3" sx={{ mb: 3, fontWeight: 'bold', color: '#d32f2f', textAlign:'center'}}>
                  错题解析
                  </Typography>
                  {/* 课程和知识点标签 */}
                  <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {question.course_name && (
                      <Chip 
                        label={`课程: ${question.course_name}`}
                        size="small"
                        sx={{ backgroundColor: '#e3f2fd' }}
                      />
                    )}
                    {question.knowledge_point && (
                      <Chip 
                        label={`知识点: ${question.knowledge_point}`}
                        size="small"
                        sx={{ backgroundColor: '#f3e5f5' }}
                      />
                    )}
                  </Box>

                  {/* 题目内容 */}
                  <Typography 
                    variant="subtitle1" 
                    gutterBottom
                    sx={{ 
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'flex-start'
                    }}
                  >
                    <Box 
                      component="span" 
                      sx={{ 
                        color: '#f44336',
                        mr: 1,
                        minWidth: '4rem',
                        fontWeight: 'bold'
                      }}
                    >
                      错题 {index + 1}
                    </Box>
                    <Box component="span" sx={{ flex: 1 }}>
                      {question.question_text}
                    </Box>
                  </Typography>

                  {/* 选项列表 */}
                  <Box sx={{ ml: 2, mt: 2 }}>
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
                            {option.content}
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

                  {/* 得分和解析 */}
                  <Box 
                    sx={{ 
                      mt: 2,
                      ml: 2,
                      p: 2,
                      backgroundColor: '#fff3e0',
                      borderRadius: 1
                    }}
                  >
                    <Typography 
                      variant="subtitle2" 
                      color="error"
                      gutterBottom
                    >
                      得分：{question.score}
                    </Typography>
                    {question.explanation && (
                      <Typography 
                        variant="body2" 
                        sx={{ 
                          color: '#795548',
                          mt: 1
                        }}
                      >
                        <Box component="span" sx={{ fontWeight: 'bold' }}>解析：</Box>
                        {question.explanation}
                      </Typography>
                    )}
                  </Box>
                </Paper>
              ))}

              {/* 全对提示 */}
              {examResult.questions.every(q => q.is_correct) && (
                <Paper 
                  elevation={3}
                  sx={{ 
                    mt: 3,
                    p: 4,
                    textAlign: 'center',
                    backgroundColor: '#e8f5e9',
                    border: '1px solid #a5d6a7',
                    borderRadius: 2
                  }}
                >
                  <Typography 
                    variant="h2" 
                    color="success.main"
                    sx={{ 
                      fontWeight: 'bold',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 2
                    }}
                  >
                    <span role="img" aria-label="celebration">🎉</span>
                    恭喜你！完美通过本次考试
                    <span role="img" aria-label="celebration">🎉</span>
                  </Typography>
                  <Typography 
                    variant="subtitle1" 
                    sx={{ 
                      mt: 2,
                      color: 'success.dark'
                    }}
                  >
                    你已经完全掌握了这些知识点，继续保持！
                  </Typography>
                </Paper>
              )}
            </Box>
          ) : (
            <Box>
              {/* 单选题部分 */}
              {exam.questions.filter(q => q.question_type === '单选题').length > 0 && (
                <>
                  <Typography variant="h5" sx={{ mt: 4, mb: 3, fontWeight: 'bold' }}>
                    一、单选题 
                  </Typography>
                  {exam.questions
                    .filter(q => q.question_type === '单选题')
                    .map((question, index) => (
                      <Box key={question.id} id={`question-${question.id}`} sx={{ mt: 3, transition: 'background-color 0.5s ease' }}>
                        <FormControl component="fieldset" sx={{ width: '100%' }}>
                          <FormLabel component="legend" sx={{ mb: 1, display: 'flex', alignItems: 'flex-start' }}>
                            <Box component="span" sx={{ mr: 1, flexShrink: 0 }}>
                              {index + 1}.
                            </Box>
                            <MarkdownTypography 
                              component="span" 
                              sx={{ 
                                display: 'inline',
                                '& p': { 
                                  display: 'inline',
                                  mt: 0,
                                  mb: 0
                                }
                              }}
                            >
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {question.question_text}
                              </ReactMarkdown>
                            </MarkdownTypography>
                          </FormLabel>
                          <RadioGroup
                            value={answers[question.id]?.selected || ''}
                            onChange={(e) => {
                              console.log('单选题选择：', {
                                questionId: question.id,
                                optionId: e.target.value,
                                type: '单选题'
                              });
                              handleAnswerChange(question.id, e.target.value, '单选题');
                            }}
                          >
                            {question.options.map((option, optionIndex) => (
                              <FormControlLabel
                                key={option.id}
                                value={option.id}
                                control={
                                  <Radio 
                                    sx={{
                                      mt: '-3px', // 向上微调单选框位置
                                      p: '9px'    // 调整内边距
                                    }}
                                  />
                                }
                                sx={{
                                  alignItems: 'flex-start',
                                  margin: '4px 0',  // 调整选项间距
                                  '& .MuiFormControlLabel-label': {
                                    mt: '3px'  // 微调标签位置以对齐单选框
                                  }
                                }}
                                label={
                                  <Box component="span" sx={{ display: 'flex', alignItems: 'flex-start' }}>
                                    <Box component="span" sx={{ mr: 1, flexShrink: 0, minWidth: '20px' }}>
                                      {String.fromCharCode(65 + optionIndex)}.
                                    </Box>
                                    <MarkdownTypography 
                                      component="span"
                                      sx={{
                                        flex: 1,
                                        '& p': { 
                                          mt: 0,
                                          mb: 0
                                        }
                                      }}
                                    >
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {option.option_text}
                                      </ReactMarkdown>
                                    </MarkdownTypography>
                                  </Box>
                                }
                              />
                            ))}
                          </RadioGroup>
                        </FormControl>
                      </Box>
                    ))}
                </>
              )}

              {/* 多选题部分 */}
              {exam.questions.filter(q => q.question_type === '多选题').length > 0 && (
                <>
                  <Typography variant="h5" sx={{ mt: 4, mb: 3, fontWeight: 'bold' }}>
                    二、多选题
                  </Typography>
                  {exam.questions
                    .filter(q => q.question_type === '多选题')
                    .map((question, index) => (
                      <Box key={question.id} id={`question-${question.id}`} sx={{ mt: 3, transition: 'background-color 0.5s ease' }}>
                        <FormControl component="fieldset" sx={{ width: '100%' }}>
                          <FormLabel component="legend" sx={{ mb: 1, display: 'flex', alignItems: 'flex-start' }}>
                            <Box component="span" sx={{ mr: 1, flexShrink: 0 }}>
                              {index + 1}.
                            </Box>
                            <MarkdownTypography 
                              component="span" 
                              sx={{ 
                                display: 'inline',
                                '& p': { 
                                  display: 'inline',
                                  mt: 0,
                                  mb: 0
                                }
                              }}
                            >
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {question.question_text}
                              </ReactMarkdown>
                            </MarkdownTypography>
                          </FormLabel>
                          <FormGroup>
                            {question.options.map((option, optionIndex) => (
                              <FormControlLabel
                                key={option.id}
                                control={
                                  <Checkbox
                                    checked={answers[question.id]?.selected?.[option.id] || false}
                                    onChange={() => {
                                      console.log('多选题选择：', {
                                        questionId: question.id,
                                        optionId: option.id,
                                        type: '多选题'
                                      });
                                      handleAnswerChange(question.id, option.id, '多选题');
                                    }}
                                    sx={{
                                      mt: '-3px', // 向上微调复选框位置
                                      p: '9px'    // 调整内边距
                                    }}
                                  />
                                }
                                sx={{
                                  alignItems: 'flex-start',
                                  margin: '4px 0',  // 调整选项间距
                                  '& .MuiFormControlLabel-label': {
                                    mt: '3px'  // 微调标签位置以对齐复选框
                                  }
                                }}
                                label={
                                  <Box component="span" sx={{ display: 'flex', alignItems: 'flex-start' }}>
                                    <Box component="span" sx={{ mr: 1, flexShrink: 0, minWidth: '20px' }}>
                                      {String.fromCharCode(65 + optionIndex)}.
                                    </Box>
                                    <MarkdownTypography 
                                      component="span"
                                      sx={{
                                        flex: 1,
                                        '& p': { 
                                          mt: 0,
                                          mb: 0
                                        }
                                      }}
                                    >
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {option.option_text}
                                      </ReactMarkdown>
                                    </MarkdownTypography>
                                  </Box>
                                }
                              />
                            ))}
                          </FormGroup>
                        </FormControl>
                      </Box>
                    ))}
                </>
              )}
              <Box sx={{ mt: 4, display: 'flex', justifyContent: 'center' }}>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? <CircularProgress size={24} /> : '提交答案'}
                </Button>
              </Box>
            </Box>
          )}
        </Paper>
      )}
    </Container>
  );
};

export default ExamTake;
