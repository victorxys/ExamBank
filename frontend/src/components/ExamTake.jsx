import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Container,
  Typography,
  Paper,
  Box,
  Button,
  TextField,
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
  Chip
} from '@mui/material';
import { API_BASE_URL } from '../config';

// 自定义 Markdown 样式组件
const MarkdownTypography = ({ children, ...props }) => {
  return (
    <Typography
      component="div"
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
    </Typography>
  );
};

const ExamTake = () => {
  const { examId } = useParams();
  const previousActiveElement = React.useRef(null);
  const mainContentRef = React.useRef(null);
  const [exam, setExam] = useState(null);
  const [answers, setAnswers] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [examResult, setExamResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loginOpen, setLoginOpen] = useState(true);
  const [user, setUser] = useState(null);
  const [loginForm, setLoginForm] = useState({
    username: '',
    phone_number: '',
  });
  const [loginError, setLoginError] = useState(null);
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [incompleteQuestions, setIncompleteQuestions] = useState([]);
  const [showIncompleteDialog, setShowIncompleteDialog] = useState(false);

  useEffect(() => {
    if (!examId) {
      setError('试卷ID不能为空');
      setLoading(false);
      return;
    }
    
    const preview = new URLSearchParams(window.location.search).get('preview') === 'true';
    if (preview) {
      setLoginOpen(false); // 预览模式不需要登录
    }
    
    fetchExam();
  }, [examId]);

  const fetchExam = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/exams/${examId}/take`);
      if (!response.ok) {
        throw new Error('获取试卷失败');
      }
      const data = await response.json();
      console.log('获取到的试卷数据：', data);  // 添加日志
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

  // 检查手机号是否存在
  const checkPhoneNumber = async (phone) => {
    try {
      const response = await fetch(`${API_BASE_URL}/users/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone_number: phone,
          username: ''  // 不提供用户名，用于检查手机号是否存在
        }),
      });

      if (response.status === 404) {
        // 用户不存在，清空用户名字段
        setLoginForm(prev => ({
          ...prev,
          username: ''
        }));
        return;
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '检查手机号失败');
      }

      const user = await response.json();
      // 如果找到了用户，自动填充用户名
      if (user && user.username) {
        setLoginForm(prev => ({
          ...prev,
          username: user.username
        }));
      }
    } catch (err) {
      console.error('检查手机号时出错：', err);
      setLoginError(err.message);
    }
  };

  // 处理手机号输入
  const handlePhoneChange = async (e) => {
    const phone = e.target.value;
    setLoginForm(prev => ({
      ...prev,
      phone_number: phone
    }));

    if (phone.length >= 3) {  // 这里的长度可以根据实际需求调整
      setCheckingPhone(true);
      await checkPhoneNumber(phone);
      setCheckingPhone(false);
    } else {
      // 当手机号长度不足时，清空用户名
      setLoginForm(prev => ({
        ...prev,
        username: ''
      }));
    }
  };

  const handleLogin = async () => {
    if (!loginForm.phone_number) {
      setLoginError('请输入手机号');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/users/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: loginForm.username || '考生',
          phone_number: loginForm.phone_number,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '登录失败');
      }

      const user = await response.json();
      setUser(user);
      setLoginOpen(false);
      setLoginError(null);

      // 加载临时答案
      try {
        const tempAnswersResponse = await fetch(`${API_BASE_URL}/exams/${examId}/temp-answers/${user.id}`);
        if (tempAnswersResponse.ok) {
          const tempAnswersData = await tempAnswersResponse.json();
          if (tempAnswersData.success && tempAnswersData.temp_answers) {
            // 将临时答案转换为answers状态格式
            const tempAnswers = {};
            tempAnswersData.temp_answers.forEach(answer => {
              // 获取问题类型
              const question = exam.questions.find(q => q.id === answer.question_id);
              if (question) {
                // 解析PostgreSQL数组格式字符串
                const optionIds = answer.selected_option_ids
                  .replace(/[{}]/g, '') // 移除花括号
                  .split(',') // 按逗号分割
                  .filter(id => id.trim()); // 过滤空字符串

                if (question.question_type === '单选题') {
                  tempAnswers[answer.question_id] = {
                    question_type: '单选题',
                    selected: optionIds[0]
                  };
                } else {
                  // 多选题，将选项数组转换为对象格式
                  const selectedOptions = {};
                  optionIds.forEach(optionId => {
                    selectedOptions[optionId] = true;
                  });
                  tempAnswers[answer.question_id] = {
                    question_type: '多选题',
                    selected: selectedOptions
                  };
                }
              }
            });
            setAnswers(tempAnswers);
            console.log('已加载临时答案：', tempAnswers);
          }
        }
      } catch (err) {
        console.error('加载临时答案失败：', err);
      }
    } catch (err) {
      console.error('登录时出错：', err);
      setLoginError(err.message);
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
        console.log('更新后的答案状态：', newAnswers);
        // 触发自动保存
        saveAnswerToServer(questionId, newAnswers[questionId]);
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
        // 触发自动保存
        saveAnswerToServer(questionId, newAnswers[questionId]);
        return newAnswers;
      });
    }
  };

  // 添加自动保存函数
  const saveAnswerToServer = async (questionId, answer) => {
    if (!user) {
      console.log('用户未登录，不执行自动保存');
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
        userId: user.id,
        selected_options
      });

      const response = await fetch(`${API_BASE_URL}/exams/${examId}/temp-answers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: user.id,
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

  const handleSubmit = async () => {
    if (!user) {
      setLoginOpen(true);
      return;
    }

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
        user_id: user.id
      });

      const response = await fetch(`${API_BASE_URL}/exams/${examId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: user.id,
          answers: formattedAnswers
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '提交答案失败');
      }

      const result = await response.json();
      console.log('提交答案结果：', result);
      setExamResult(result);
      setSubmitted(true);
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
      <Dialog 
        open={loginOpen && !user} 
        onClose={() => !isSubmitting && setLoginOpen(false)}
        disableEnforceFocus={false}
        disablePortal={false}
        aria-labelledby="login-dialog-title"
      >
        <DialogTitle id="login-dialog-title">登录</DialogTitle>
        <DialogContent>
          <Box component="form" sx={{ mt: 2 }}>
            <TextField
              margin="dense"
              label="手机号"
              type="tel"
              required
              fullWidth
              value={loginForm.phone_number || ''}
              onChange={handlePhoneChange}
              error={!!loginError}
              helperText={loginError}
              InputProps={{
                endAdornment: checkingPhone && (
                  <CircularProgress size={20} />
                ),
              }}
            />
            <TextField
              margin="dense"
              label="用户名"
              type="text"
              fullWidth
              value={loginForm.username || ''}
              onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
              disabled={checkingPhone}
              required={!loginForm.username}  // 如果没有用户名，则为必填
              helperText={!loginForm.username && '请输入用户名'}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleLogin}>登录</Button>
        </DialogActions>
      </Dialog>

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
          <Typography variant="h4" gutterBottom>
            {exam.title}
          </Typography>
          {exam.description && (
            <Typography variant="body1" color="text.secondary" paragraph>
              <MarkdownTypography component="span">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {exam.description}
                </ReactMarkdown>
              </MarkdownTypography>
            </Typography>
          )}

          {submitted ? (
            <Box>
              {/* 考试基本信息 */}
              <Paper 
                sx={{ 
                  p: 3, 
                  mb: 4,
                  backgroundColor: '#f8f9fa',
                  borderRadius: 2
                }}
              >
                <Typography variant="h5" gutterBottom>
                  {exam?.title || '考试结果'}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, color: 'text.secondary' }}>
                  <Typography>
                    学生：{user?.username || '-'}
                  </Typography>
                  <Typography>
                    考试时间：{new Date().toLocaleString()}
                  </Typography>
                  <Typography color="primary" fontWeight="bold">
                    得分：{examResult.total_score}分
                  </Typography>
                  <Typography>
                    答题次数：第 1 次
                  </Typography>
                </Box>
              </Paper>

              {/* 错题列表 */}
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
                  sx={{ 
                    mt: 3,
                    p: 3,
                    textAlign: 'center',
                    backgroundColor: '#e8f5e9',
                    border: '1px solid #a5d6a7',
                    borderRadius: 2
                  }}
                >
                  <Typography 
                    variant="h6" 
                    color="success.main"
                    sx={{ fontWeight: 'bold' }}
                  >
                    太棒了！你已经完全掌握了这些知识点
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
