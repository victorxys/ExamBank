import React, { useState, useEffect } from 'react';
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
  Grid,
  Chip
} from '@mui/material';
import { useNavigate } from 'react-router-dom';

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
  const [examId, setExamId] = useState(null);
  const [exam, setExam] = useState(null);
  const [answers, setAnswers] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [examResult, setExamResult] = useState(null);
  const [loading, setLoading] = useState(false);
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

  const navigate = useNavigate();

  useEffect(() => {
    // 从 URL 中获取考试 ID
    const pathParts = window.location.pathname.split('/');
    const id = pathParts[pathParts.length - 1]; // 从路径中获取 ID
    const urlParams = new URLSearchParams(window.location.search);
    const preview = urlParams.get('preview') === 'true';

    console.log('组件初始化:', {
      pathParts,
      id,
      preview,
      fullPath: window.location.pathname,
      search: window.location.search,
      state: {
        loading,
        error,
        loginOpen,
        examId,
        hasExam: !!exam,
        hasUser: !!user
      }
    });

    if (id) {
      setExamId(id);
      if (preview) {
        console.log('预览模式：跳过登录');
        setLoginOpen(false); // 预览模式不需要登录
      }
    } else {
      setError('试卷ID不能为空');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    console.log('依赖项变化:', {
      examId,
      loginOpen,
      hasUser: !!user,
      loading,
      error,
      hasExam: !!exam
    });

    if (examId && !loginOpen) {
      console.log('准备加载试卷');
      fetchExam();
    }
  }, [examId, loginOpen]);

  const fetchExam = async () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const preview = urlParams.get('preview') === 'true';
      const endpoint = preview ? 
        `http://localhost:5000/api/exams/${examId}` : 
        `http://localhost:5000/api/exams/${examId}/take`;

      console.log('开始获取试卷数据:', {
        examId,
        url: endpoint,
        preview
      });

      setLoading(true);
      const response = await fetch(endpoint);
      
      console.log('API 响应:', {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText
      });
      
      if (!response.ok) {
        throw new Error(`获取试卷失败: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('API 返回数据:', JSON.stringify(data, null, 2));

      let processedExam;
      let questions;

      if (data.questions.single || data.questions.multiple) {
        // 普通答题模式数据格式
        questions = [
          ...(data.questions.single || []).map(q => ({
            ...q,
            question_type: '单选题',
            options: q.options.map(opt => ({
              id: opt.id,
              option_text: opt.content
            }))
          })),
          ...(data.questions.multiple || []).map(q => ({
            ...q,
            question_type: '多选题',
            options: q.options.map(opt => ({
              id: opt.id,
              option_text: opt.content
            }))
          }))
        ];
      } else {
        // 预览模式数据格式
        questions = data.questions.map(q => ({
          ...q,
          question_type: q.question_type,
          options: q.options.map((opt, index) => ({
            id: String(index),  // 使用索引作为ID
            option_text: opt
          }))
        }));
      }

      processedExam = {
        id: data.exam?.id || data.id,
        title: data.exam?.title || data.title,
        description: data.exam?.description || data.description,
        questions: questions
      };

      console.log('最终的试卷数据:', processedExam);
      setExam(processedExam);

      setLoading(false);
    } catch (error) {
      console.error('获取试卷失败:', error);
      setError(error.message);
      setLoading(false);
    }
  };

  const handleAnswerChange = (questionId, value) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: value
    }));
  };

  const renderQuestion = (question, index) => {
    const isMultipleChoice = question.question_type === '多选题';
    const currentAnswer = answers[question.id] || (isMultipleChoice ? [] : '');

    return (
      <Box key={question.id} id={`question-${question.id}`} sx={{ mb: 4 }}>
        <FormControl component="fieldset" fullWidth>
          <FormLabel component="legend">
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <Typography variant="h6" component="span">
                {`${index + 1}. `}
              </Typography>
              <MarkdownTypography>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {question.question_text}
                </ReactMarkdown>
              </MarkdownTypography>
            </Box>
          </FormLabel>

          {isMultipleChoice ? (
            <FormGroup>
              {question.options.map((option, optionIndex) => (
                <FormControlLabel
                  key={option.id}
                  control={
                    <Checkbox
                      checked={currentAnswer.includes(option.id)}
                      onChange={(e) => {
                        const newValue = e.target.checked
                          ? [...currentAnswer, option.id]
                          : currentAnswer.filter(id => id !== option.id);
                        handleAnswerChange(question.id, newValue);
                      }}
                    />
                  }
                  label={
                    <MarkdownTypography>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {option.option_text}
                      </ReactMarkdown>
                    </MarkdownTypography>
                  }
                />
              ))}
            </FormGroup>
          ) : (
            <RadioGroup
              value={currentAnswer}
              onChange={(e) => handleAnswerChange(question.id, e.target.value)}
            >
              {question.options.map((option, optionIndex) => (
                <FormControlLabel
                  key={option.id}
                  value={option.id}
                  control={<Radio />}
                  label={
                    <MarkdownTypography>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {option.option_text}
                      </ReactMarkdown>
                    </MarkdownTypography>
                  }
                />
              ))}
            </RadioGroup>
          )}
        </FormControl>
      </Box>
    );
  };

  // 检查手机号是否存在
  const checkPhoneNumber = async (phone) => {
    try {
      const response = await fetch('http://localhost:5000/api/users/login', {
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
      const response = await fetch('http://localhost:5000/api/users/login', {
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
    } catch (err) {
      console.error('登录时出错：', err);
      setLoginError(err.message);
    }
  };

  const checkIncompleteQuestions = () => {
    const incomplete = [];
    exam.questions.forEach((question, index) => {
      const answer = answers[question.id];
      let isIncomplete = false;

      if (question.question_type === '单选题') {
        isIncomplete = !answer;
      } else if (question.question_type === '多选题') {
        isIncomplete = !answer || answer.length === 0;
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
        // 确保 selected_options 始终是数组
        const selected_options = Array.isArray(answer) ? answer : [answer];

        return {
          question_id: questionId,
          selected_options: selected_options
        };
      });

      console.log('开始提交考试答案，考试ID：', examId);
      console.log('提交的答案数据：', JSON.stringify(formattedAnswers, null, 2));

      const response = await fetch(`http://localhost:5000/api/exams/${examId}/submit`, {
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
      console.log('提交答案结果：', JSON.stringify(result, null, 2));

      if (!result || !result.questions) {
        throw new Error('服务器返回的数据格式不正确');
      }

      // 获取答卷提交时间
      const getExamRecordsResponse = await fetch(`http://localhost:5000/api/exam-records?search=${user.id}`);
      if (!getExamRecordsResponse.ok) {
        throw new Error('获取考试记录失败');
      }
      const examRecords = await getExamRecordsResponse.json();
      
      // 找到最新的考试记录
      const latestRecord = examRecords.find(record => 
        record.exam_paper_id === examId && 
        record.user_id === user.id
      );

      if (!latestRecord || !latestRecord.exam_time) {
        throw new Error('无法获取考试提交时间');
      }

      const examTime = latestRecord.exam_time;

      // 处理考试结果数据
      const processedResult = {
        total_score: result.total_score || 0,
        student_name: result.student_name || '',
        student_phone: result.student_phone || '',
        exam_time: examTime,
        questions: (result.questions || []).map(q => {
          if (!q) return null;

          // 获取用户选择的答案
          const userAnswers = q.selected_answer || [];
          console.log(`问题 ${q.question_text} 的用户答案:`, userAnswers);
          console.log(`问题 ${q.question_text} 的正确答案:`, q.answer);

          return {
            ...q,
            id: q.id || '',
            question_text: q.question_text || '',
            question_type: q.question_type || '单选题',
            explanation: q.explanation || '',
            options: (q.options || []).map((opt) => {
              return {
                id: opt.id || '',
                content: opt.content || '',
                char: opt.char || '',
                is_correct: q.answer.includes(opt.char),
                is_selected: userAnswers.includes(opt.char)
              };
            }),
            course_name: q.course_name || '未知课程',
            point_name: q.point_name || '未知知识点',
            is_correct: q.is_correct || false,
            score: q.score || 0,
            answer: q.answer || []
          };
        }).filter(q => q !== null)
      };

      console.log('处理后的考试结果：', JSON.stringify(processedResult, null, 2));
      setExamResult(processedResult);
      setSubmitted(true);

      // 提交成功后直接导航到详情页面
      navigate(`/exam-records/${examId}/${user.id}?exam_time=${encodeURIComponent(examTime)}`);
    } catch (err) {
      console.error('提交答案时出错：', err);
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  console.log('渲染状态:', {
    loading,
    error,
    hasExam: !!exam,
    examTitle: exam?.title,
    questionCount: exam?.questions?.length,
    loginOpen,
    hasUser: !!user
  });

  return (
    <Container maxWidth="md">
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Box sx={{ p: 3 }}>
          <Alert severity="error">{error}</Alert>
        </Box>
      ) : (
        <>
          {/* 登录对话框 */}
          <Dialog open={loginOpen} onClose={() => {}}>
            <DialogTitle>请登录</DialogTitle>
            <DialogContent>
              <Box sx={{ mt: 2 }}>
                <TextField
                  margin="dense"
                  label="手机号"
                  type="tel"
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
                  required={!loginForm.username}
                  helperText={!loginForm.username && '请输入用户名'}
                />
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleLogin}>登录</Button>
            </DialogActions>
          </Dialog>

          {/* 主要内容 */}
          {exam && (
            <Paper sx={{ p: 3, my: 3 }}>
              <Typography variant="h4" gutterBottom>
                {exam.title}
              </Typography>
              {exam.description && (
                <Typography variant="body1" color="text.secondary" paragraph>
                  {exam.description}
                </Typography>
              )}

              {/* 题目列表 */}
              {exam.questions && exam.questions.length > 0 ? (
                <Box>
                  {exam.questions.map((question, index) => renderQuestion(question, index))}
                  {!submitted && (
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
                  )}
                </Box>
              ) : (
                <Alert severity="info">该试卷暂无题目</Alert>
              )}

              {/* 考试结果 */}
              {submitted && examResult && (
                <Box sx={{ mt: 4 }}>
                  {/* 试卷标题和基本信息 */}
                  <Box sx={{ textAlign: 'center', mb: 4 }}>
                    <Typography variant="h4" gutterBottom>
                      考试结果
                    </Typography>
                    <Grid container spacing={2} justifyContent="center">
                      <Grid item>
                        <Typography variant="body1">
                          考生：{user?.username} ({user?.phone_number})
                        </Typography>
                      </Grid>
                      <Grid item>
                        <Typography variant="body1">
                          得分：
                          <span style={{ 
                            color: examResult.total_score >= 60 ? '#4CAF50' : '#FF5252',
                            fontWeight: 'bold'
                          }}>
                            {examResult.total_score}分
                          </span>
                        </Typography>
                      </Grid>
                    </Grid>
                  </Box>

                  {/* 试题列表 */}
                  {examResult.questions?.map((question, index) => (
                    <Paper 
                      key={question.id} 
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
                        
                        {/* 选项列表 */}
                        <Box sx={{ ml: 2 }}>
                          {question.options?.map((option) => {
                            const isSelected = option.is_selected;
                            const isCorrect = option.is_correct;
                            
                            // 确定选项的背景色
                            const getBackgroundColor = () => {
                              if (isCorrect) {
                                return 'rgba(76, 175, 80, 0.1)'; // 正确答案使用浅绿色背景
                              }
                              return 'transparent';
                            };
                            
                            return (
                              <Box 
                                key={option.id}
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  mb: 1,
                                  p: 1,
                                  backgroundColor: getBackgroundColor(),
                                  borderRadius: 1,
                                }}
                              >
                                {/* 选项字母和内容 */}
                                <Typography
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    color: 'text.primary'
                                  }}
                                >
                                  {option.char}. {option.content}
                                </Typography>

                                {/* 正确/错误标记 */}
                                <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
                                  {isCorrect && (
                                    <Typography sx={{ color: '#4CAF50', fontWeight: 'bold', ml: 1 }}>
                                      ✓
                                    </Typography>
                                  )}
                                </Box>
                              </Box>
                            );
                          })}
                        </Box>

                        {/* 课程和知识点标签 */}
                        <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          <Chip
                            label={`课程: ${question.course_name}`}
                            size="small"
                            sx={{ bgcolor: 'rgba(25, 118, 210, 0.1)' }}
                          />
                          <Chip
                            label={`知识点: ${question.point_name}`}
                            size="small"
                            sx={{ bgcolor: 'rgba(25, 118, 210, 0.1)' }}
                          />
                        </Box>

                        {/* 答案解析 */}
                        {question.explanation && (
                          <Box sx={{ mt: 2 }}>
                            <Typography variant="subtitle2" color="text.secondary">
                              答案解析:
                            </Typography>
                            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                              {question.explanation}
                            </Typography>
                          </Box>
                        )}
                      </Box>
                    </Paper>
                  ))}
                </Box>
              )}
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
                        const rect = element.getBoundingClientRect();
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
        </>
      )}
    </Container>
  );
};

export default ExamTake;
