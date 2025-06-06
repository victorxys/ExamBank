import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  Grid,
  LinearProgress
} from '@mui/material';
import api from '../api/axios';
import { hasToken } from '../api/auth-utils';
import { useTheme } from '@mui/material/styles';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import debounce from 'lodash/debounce';
import AlertMessage from './AlertMessage';
import useTaskPolling from '../utils/useTaskPolling';


// 自定义 Markdown 样式组件
const MarkdownTypography = ({ children, ...props }) => {
  return (
    <Box
      sx={{
        '& p': { mt: 0, mb: 0, display: 'inline' }, // 确保段落表现得像行内元素
        '& strong': { fontWeight: 'bold' },
        '& em': { fontStyle: 'italic' },
        '& code': {
          backgroundColor: 'rgba(0, 0, 0, 0.05)',
          padding: '2px 4px',
          borderRadius: '4px',
          fontSize: '0.875rem'
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
  console.log('[DEBUG] ExamTake component is rendering/re-rendering.'); // 添加一个顶级日志

  const { examId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();

  const tokenData = useMemo(() => hasToken(), []);

  const [exam, setExam] = useState(null);
  const [answers, setAnswers] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [examResult, setExamResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(false);
  const [incompleteQuestions, setIncompleteQuestions] = useState([]);
  const [showIncompleteDialog, setShowIncompleteDialog] = useState(false);
  const [examDuration, setExamDuration] = useState(null);
  const [knowledgeReport, setKnowledgeReport] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [alert, setAlert] = useState({ show: false, message: '', severity: 'info' });

  const handleAlertClose = () => {
    setAlert({ ...alert, show: false });
  };

  const handleTaskCompletion = useCallback((taskData, taskType) => {
    console.log(`[DEBUG] handleTaskCompletion triggered!`, { taskType, taskData });

    console.log(`[DEBUG] handleTaskCompletion 被调用!`, { taskType, taskData });

    if (taskType === 'summarize_knowledge_points') {
      console.log('[ExamTake] 轮询任务完成！收到的数据:', taskData);
      setAlert({ open: true, message: '知识点总结报告已生成！', severity: 'success' });
      
      let finalResult = null;
      
      // **直接使用 taskData.result，因为后端已经返回了完整的对象**
      if (taskData && taskData.result) {
        finalResult = taskData.result; 
        
        // 安全起见，如果后端因为某些原因返回了字符串，我们尝试解析
        if (typeof finalResult === 'string') {
          try {
            finalResult = JSON.parse(finalResult);
          } catch (e) {
            console.error("解析 taskData.result 字符串失败:", e);
            handleTaskFailure(taskData, taskType); // 如果无法解析，则视为失败
            return;
          }
        }
      } else {
          console.error("任务完成数据中缺少 'result' 字段。", taskData);
          handleTaskFailure(taskData, taskType); // 没有结果也视为失败
          return;
      }
      
      // 更新状态以触发UI重新渲染
      setKnowledgeReport(finalResult);
      setExamResult(prev => {
        if (!prev) return null;
        return {
          ...prev,
          knowledge_summary_status: 'completed', // 更新状态
          merge_kp_result: finalResult // 将完整结果存入
        }
      });
    }
  }, []); // 空依赖，因为它不依赖组件内的可变状态

  const handleTaskFailure = useCallback((taskData, taskType) => {
    setAlert({ 
        open: true, 
        message: `知识点报告生成失败: ${taskData.meta?.message || taskData.error_message || '未知错误'}`, 
        severity: 'error' 
    });
    setExamResult(prev => {
      if (!prev) return null;
      return { ...prev, knowledge_summary_status: 'failed' };
    });
  }, []);

  const { pollingTask, isPolling, startPolling } = useTaskPolling(handleTaskCompletion, handleTaskFailure);

  useEffect(() => {
    if (!tokenData) {
      navigate('/login', { state: { from: { pathname: `/exams/${examId}/take` } } });
      return;
    }
    setPreview(new URLSearchParams(window.location.search).get('preview') === 'true');
    
    const fetchExamAndUser = async () => {
      setLoading(true);
      setError(null);
      try {
        const [examRes, userRes] = await Promise.all([
          api.get(`/exams/${examId}/take`),
          api.get(`/users/${tokenData.sub}/details`)
        ]);
        const examData = examRes.data;
        setUserInfo(userRes.data);
        const processedQuestions = [
          ...(examData.questions.single || []).map(q => ({ ...q, question_type: '单选题', options: q.options.map(opt => ({...opt, option_text: opt.content})) })),
          ...(examData.questions.multiple || []).map(q => ({ ...q, question_type: '多选题', options: q.options.map(opt => ({...opt, option_text: opt.content})) }))
        ].map((q, index) => ({ ...q, uniqueId: `${examId}-${q.id}-${index}` }));
        
        setExam({
          ...examData.exam,
          questions: processedQuestions
        });
      } catch (err) {
        setError(err.response?.data?.error || err.message || '获取考试数据失败');
      } finally {
        setLoading(false);
      }
    };
    fetchExamAndUser();
  }, [examId, navigate, tokenData]);

  const loadTempAnswers = useCallback(async (userId) => {
    if (!exam) return;
    try {
      const response = await api.get(`/exams/${examId}/temp-answers/${userId}`);
      const data = response.data;
      if (data.success && data.temp_answers) {
        const tempAnswers = {};
        data.temp_answers.forEach(answer => {
          const question = exam.questions.find(q => q.id === answer.question_id);
          if (!question) return;
          const optionIds = Array.isArray(answer.selected_option_ids) ? answer.selected_option_ids : [];
          if (question.question_type === '多选题') {
            tempAnswers[answer.question_id] = { question_type: '多选题', selected: optionIds.reduce((acc, id) => ({...acc, [id]: true}), {}) };
          } else {
            tempAnswers[answer.question_id] = { question_type: '单选题', selected: optionIds[0] };
          }
        });
        setAnswers(tempAnswers);
      }
    } catch (error) { console.error('加载临时答案失败:', error); }
  }, [exam, examId]);

  useEffect(() => {
    if (exam && tokenData?.sub && !preview) {
      loadTempAnswers(tokenData.sub);
    }
  }, [exam, tokenData, preview, loadTempAnswers]);
  
  const saveAnswerToServer = useCallback(debounce(async (questionId, answerData) => {
    if (!tokenData?.sub) return;
    try {
      const selected_options = answerData.question_type === '单选题'
        ? (answerData.selected ? [answerData.selected] : [])
        : Object.entries(answerData.selected || {}).filter(([, sel]) => sel).map(([id]) => id);
      if(selected_options.length === 0) return;
      await api.post(`/exams/${examId}/temp-answers`, { user_id: tokenData.sub, question_id: questionId, selected_options });
    } catch (err) { console.error('自动保存失败：', err); }
  }, 500), [examId, tokenData]);

  const handleAnswerChange = (questionId, optionId, type) => {
    let newAnswers;
    if (type === '多选题') {
      newAnswers = { ...answers, [questionId]: { question_type: type, selected: { ...answers[questionId]?.selected, [optionId]: !answers[questionId]?.selected?.[optionId] } } };
    } else {
      newAnswers = { ...answers, [questionId]: { question_type: type, selected: optionId } };
    }
    setAnswers(newAnswers);
    if (tokenData?.sub) saveAnswerToServer(questionId, newAnswers[questionId]);
  };
  
  const checkIncompleteQuestions = () => {
    return exam.questions.map((question, index) => {
      const answer = answers[question.id];
      const isAnswered = question.question_type === '单选题' ? !!answer?.selected : (!!answer?.selected && Object.values(answer.selected).some(Boolean));
      return isAnswered ? null : { ...question, index: index + 1 };
    }).filter(Boolean);
  };

  const calculateDuration = (startTime, endTime) => {
    const diff = Math.floor((new Date(endTime) - new Date(startTime)) / 1000);
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;
    if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`;
    if (minutes > 0) return `${minutes}分${seconds}秒`;
    return `${seconds}秒`;
  };

  const handleSubmit = async () => {
    console.log('[DEBUG] handleSubmit: 按钮被点击!');
    const incomplete = checkIncompleteQuestions();
    if (incomplete.length > 0) {
      setIncompleteQuestions(incomplete);
      setShowIncompleteDialog(true);
      return;
    }
    setIsSubmitting(true);
    try {
      const formattedAnswers = Object.entries(answers).map(([questionId, answer]) => ({
        question_id: questionId,
        selected_options: answer.question_type === '单选题'
          ? (answer.selected ? [answer.selected] : [])
          : Object.entries(answer.selected || {}).filter(([, sel]) => sel).map(([id]) => id),
      }));

      const response = await api.post(`/exams/${examId}/submit`, { user_id: tokenData.sub, answers: formattedAnswers });
      const result = response.data;
      console.log('[DEBUG] handleSubmit: 收到后端响应:', result);

      
      setExamResult(result);
      setSubmitted(true);

      if (result.knowledge_summary_status === 'generating' && result.task_id) {
        console.log(`[DEBUG] handleSubmit: 成功获取到任务ID: ${result.task_id}。即将调用 startPolling...`);

        setAlert({ show: true, message: '考试结果已保存！知识点总结报告正在后台生成...', severity: 'info' });
        setKnowledgeReport(null);
        startPolling(result.task_id, 'summarize_knowledge_points', '知识点报告生成中...');
      } else if (result.merge_kp_result) {
        setKnowledgeReport(result.merge_kp_result);
      }
      
      if (result.start_time && result.submit_time) {
        setExamDuration(calculateDuration(result.start_time, result.submit_time));
      }
      
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);

    } catch (err) {
      setAlert({ open: true, message: `提交失败: ${err.response?.data?.error || err.message}`, severity: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh"><CircularProgress /></Box>;
  }

  if (error) {
    return <Container><Alert severity="error">{error}</Alert></Container>;
  }

  return (
    <Container>
      <AlertMessage open={alert.show} message={alert.message} severity={alert.severity} onClose={handleAlertClose} />
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', mb: 4, mt: 2 }}>
        <img src={logoSvg} alt="考试题库系统" style={{ width: '200px' }} />
      </Box>

      {exam && !submitted && (
        <Paper elevation={3} sx={{ p: {xs: 2, sm: 4}, mb: 4, backgroundColor: '#f8f9fa', borderRadius: 2, border: '1px solid #e0e0e0' }}>
          <Box sx={{ textAlign: 'center', mb: 4, borderBottom: '1px solid #e0e0e0', pb: 1 }}>
            <Typography variant="h3" gutterBottom sx={{ fontWeight: 'bold', color: theme.palette.primary.main }}>{exam?.title || '考试'}</Typography>
            {exam?.description && (<Typography variant="subtitle1" sx={{ color: 'text.secondary', maxWidth: '800px', margin: '0 auto', mb: 3 }}>{exam.description}</Typography>)}
          </Box>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}><Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}><Typography variant="body1"><Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>考生姓名：</Box><Box component="span" sx={{ fontWeight: 'bold' }}>{userInfo?.username || '-'}</Box></Typography><Typography variant="body1"><Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>手机号码：</Box><Box component="span">{userInfo?.phone_number || '-'}</Box></Typography></Box></Grid>
            <Grid item xs={12} md={6}><Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}><Typography variant="body1"><Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>题目数量：</Box><Box component="span">{exam?.questions?.length || 0}题</Box></Typography><Typography variant="body1"><Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>考试时间：</Box><Box component="span">{new Date().toLocaleString()}</Box></Typography></Box></Grid>
          </Grid>
        </Paper>
      )}

      <Dialog open={showIncompleteDialog} onClose={() => setShowIncompleteDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle><Typography variant="h6" color="error">还有未完成的题目</Typography></DialogTitle>
        <DialogContent>
          <Typography variant="body1" gutterBottom>以下题目尚未作答：</Typography>
          {incompleteQuestions.map((question) => (
            <Box key={question.id} sx={{ mt: 2 }}>
              <Typography variant="body2" color="error">第 {question.index} 题：{question.question_text}</Typography>
              <Button size="small" variant="outlined" color="primary" sx={{ mt: 1 }} onClick={() => {
                  setShowIncompleteDialog(false);
                  document.getElementById(`question-${question.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}>前往作答</Button>
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowIncompleteDialog(false)} color="primary">继续答题</Button>
        </DialogActions>
      </Dialog>

      {exam && (
        <Paper sx={{ p: {xs: 2, sm: 3}, my: 3 }}>
          {submitted && examResult ? (
            <Box>
              <Box sx={{ textAlign: 'center', mb: 4, borderBottom: '1px solid #e0e0e0', pb: 1 }}>
                <Typography variant="h3" gutterBottom sx={{ fontWeight: 'bold', color: theme.palette.primary.main }}>{exam?.title || '考试结果'}</Typography>
              </Box>
              <Paper elevation={3} sx={{ p: 4, mb: 4, backgroundColor: '#f8f9fa', borderRadius: 2, border: '1px solid #e0e0e0' }}>
                <Grid container spacing={3} alignItems="center">
                  <Grid item xs={12} md={8}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Typography variant="body1"><Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>考生姓名：</Box><Box component="span" sx={{ fontWeight: 'bold' }}>{examResult?.username || '-'}</Box></Typography>
                      <Typography variant="body1"><Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>提交时间：</Box><Box component="span">{new Date(examResult?.submit_time).toLocaleString()}</Box></Typography>
                      <Typography variant="body1"><Box component="span" sx={{ color: 'text.secondary', mr: 2 }}>考试用时：</Box><Box component="span">{examDuration || '-'}</Box></Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: examResult.total_score >= 60 ? 'linear-gradient(87deg, #2dce89 0%, #2fcca0 100%)' : 'linear-gradient(87deg, #f5365c 0%, #f56036 100%)', borderRadius: 2, p: 3, boxShadow: '0 4px 20px 0 rgba(0,0,0,0.14)', color: 'white' }}>
                      <Typography variant="h2" sx={{ mb: 1, opacity: 0.9 }}>总分</Typography>
                      <Typography variant="h2" sx={{ fontWeight: 'bold', fontSize: '3rem', textShadow: '2px 2px 4px rgba(0,0,0,0.2)' }}>{examResult.total_score}</Typography>
                    </Box>
                  </Grid>
                </Grid>
              </Paper>

              {/* 知识点掌握情况 */}
              {(examResult.knowledge_summary_status === 'generating' || isPolling) && (
                <Paper sx={{ p: 4, mt: 4, textAlign: 'center', backgroundColor: '#e3f2fd' }}>
                  <CircularProgress sx={{mb: 2}}/>
                  <Typography variant="h6">{pollingTask?.message || '知识点总结报告生成中...'}</Typography>
                  <Typography variant="body2" color="text.secondary">请稍候，结果会自动显示。</Typography>
                  <Typography variant="caption" display="block" sx={{mt: 1}}>
                    [Debug: isPolling: {isPolling.toString()}, status: {pollingTask?.status || 'N/A'}]
                  </Typography>
                </Paper>
              )}
              
              {knowledgeReport && (
                <Paper sx={{ p: 4, backgroundColor: 'background.paper', borderRadius: 2, boxShadow: 3, mb: 4, mt: 4 }}>
              <Typography variant="h3" sx={{ mb: 3, fontWeight: 600, color: 'primary.main', textAlign: 'center' }}>
                知识点掌握情况分析
              </Typography>
              {/* --- 在这里加入最终的调试日志 --- */}
              {console.log('[DEBUG] Rendering Report. knowledgeReport is:', knowledgeReport)}
              {console.log('[DEBUG] Type of knowledgeReport is:', typeof knowledgeReport)}
              {console.log('[DEBUG] Is knowledgeReport an array?', Array.isArray(knowledgeReport))}
              {/* ---------------------------------- */}
              {/* **核心修正：检查 knowledgeReport 是否为数组，如果不是，则使用其内部的数组** */}
              {Array.isArray(knowledgeReport) || (knowledgeReport.result_preview && Array.isArray(knowledgeReport.result_preview)) ? (
                <>
                  <Box sx={{ height: 300, mb: 4 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={Array.isArray(knowledgeReport) ? knowledgeReport : knowledgeReport.result_preview}>
                        <PolarGrid stroke={theme.palette.divider} />
                        <PolarAngleAxis dataKey="subject" tick={{ fill: theme.palette.text.primary }} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: theme.palette.text.secondary }} />
                        <Radar name="掌握程度" dataKey="value" stroke={theme.palette.primary.main} fill={theme.palette.primary.main} fillOpacity={0.2} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </Box>
                  <Grid container spacing={2}>
                    {(Array.isArray(knowledgeReport) ? knowledgeReport : knowledgeReport.result_preview)
                      .sort((a, b) => b.value - a.value)
                      .map((item) => (
                        <Grid item xs={12} sx={{ mb: 2 }} key={item.subject}>
                          <Paper elevation={1} sx={{ p: 3, height: '100%', backgroundColor: theme.palette.background.default, borderRadius: 2 }}>
                            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, mb: 2 }}>
                              <Typography variant="h3" sx={{ fontWeight: 600, color: theme.palette.text.primary, mb: { xs: 1, sm: 0 } }}>
                                {item.subject}
                              </Typography>
                              <Typography variant="subtitle1" sx={{ fontWeight: 500, color: item.value >= 80 ? theme.palette.success.main : item.value >= 60 ? theme.palette.warning.main : theme.palette.error.main }}>
                                {item.value}% - {item.value >= 80 ? '掌握良好' : item.value >= 60 ? '掌握一般' : '未掌握'}
                              </Typography>
                            </Box>
                            <Box component="ul" sx={{ listStyleType: 'disc', pl: 3, m: 0 }}>
                              {item.details.map((detail, index) => (
                                <Typography component="li" variant="body1" key={index} sx={{ color: theme.palette.text.secondary, mb: 1 }}>
                                  {detail}
                                </Typography>
                              ))}
                            </Box>
                          </Paper>
                        </Grid>
                      ))}
                  </Grid>
                </>
              ) : (
                <Typography sx={{ textAlign: 'center', color: 'text.secondary' }}>报告内容格式不正确，无法显示图表。</Typography>
              )}
            </Paper>
              )}

              {/* 错题/全对提示 */}
              <Box mt={4}>
                {examResult.questions.every(q => q.is_correct) ? (
                  !isPolling && knowledgeReport && (
                    <Paper elevation={3} sx={{ p: 4, textAlign: 'center', backgroundColor: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 2 }}>
                      <Typography variant="h2" color="success.main" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>🎉 恭喜你！完美通过本次考试 🎉</Typography>
                      <Typography variant="subtitle1" sx={{ mt: 2, color: 'success.dark' }}>你已经完全掌握了这些知识点，继续保持！</Typography>
                    </Paper>
                  )
                ) : (
                  <>
                    {examResult.questions.filter(q => !q.is_correct).length > 0 && <Typography variant="h3" sx={{ mb: 3, fontWeight: 'bold', color: '#d32f2f', textAlign:'center'}}>错题解析</Typography>}
                    {examResult.questions.filter(question => !question.is_correct).map((question, index) => (
                      <Paper key={question.uniqueId || index} sx={{ mt: 3, p: 3, border: '1px solid #ffcdd2', borderRadius: 2, backgroundColor: '#fff' }}>
                        <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 500, display: 'flex' }}><Box component="span" sx={{ color: '#f44336', mr: 1, minWidth: '4rem', fontWeight: 'bold' }}>错题 {index + 1}</Box><Box component="span" sx={{ flex: 1 }}>{question.question_text}</Box></Typography>
                        <Box sx={{ ml: 2, mt: 2 }}>{question.options?.map((option, optIndex) => {
                          const isSelected = question.selected_option_ids?.includes(option.id);
                          const isCorrect = option.is_correct;
                          return (<Box key={option.id || optIndex} sx={{ display: 'flex', alignItems: 'center', mb: 1, p: 1, backgroundColor: isCorrect ? 'rgba(76, 175, 80, 0.1)' : isSelected ? 'rgba(255, 82, 82, 0.1)' : 'transparent', borderRadius: 1 }}><Typography sx={{ minWidth: 24, color: isCorrect ? '#4CAF50' : isSelected ? '#FF5252' : 'text.primary' }}>{String.fromCharCode(65 + (option.index || optIndex))}.</Typography><Typography sx={{ flex: 1, color: isCorrect ? '#4CAF50' : isSelected ? '#FF5252' : 'text.primary' }}>{option.text}</Typography>{isCorrect && <Typography sx={{ color: '#4CAF50', fontWeight: 'bold', ml: 1 }}>✓</Typography>}{!isCorrect && isSelected && <Typography sx={{ color: '#FF5252', fontWeight: 'bold', ml: 1 }}>✗</Typography>}</Box>);
                        })}</Box>
                        {question.explanation && (<Box sx={{ mt: 2, p: 2, backgroundColor: 'rgba(25, 118, 210, 0.05)', borderRadius: 1 }}><Typography variant="subtitle2" color="primary" gutterBottom>答案解析：</Typography><Typography variant="body2">{question.explanation}</Typography></Box>)}
                      </Paper>
                    ))}
                  </>
                )}
              </Box>
            </Box>
          ) : (
            <Box>
              {exam.questions.filter(q => q.question_type === '单选题').length > 0 && (<><Typography variant="h5" sx={{ mt: 4, mb: 3, fontWeight: 'bold' }}>一、单选题</Typography>{exam.questions.filter(q => q.question_type === '单选题').map((question, index) => (<Box key={question.id} id={`question-${question.id}`} sx={{ mt: 3, transition: 'background-color 0.5s ease' }}><FormControl component="fieldset" sx={{ width: '100%' }}><FormLabel component="legend" sx={{ mb: 1, display: 'flex', alignItems: 'flex-start' }}><Box component="span" sx={{ mr: 1, flexShrink: 0 }}>{index + 1}.</Box><MarkdownTypography component="span" sx={{ display: 'inline', '& p': { display: 'inline', mt: 0, mb: 0 } }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{question.question_text}</ReactMarkdown></MarkdownTypography></FormLabel><RadioGroup value={answers[question.id]?.selected || ''} onChange={(e) => handleAnswerChange(question.id, e.target.value, '单选题')}>{question.options.map((option, optionIndex) => (<FormControlLabel key={option.id} value={option.id} control={<Radio sx={{ mt: '-3px', p: '9px' }} />} sx={{ alignItems: 'flex-start', margin: '4px 0', '& .MuiFormControlLabel-label': { mt: '3px' } }} label={<Box component="span" sx={{ display: 'flex', alignItems: 'flex-start' }}><Box component="span" sx={{ mr: 1, flexShrink: 0, minWidth: '20px' }}>{String.fromCharCode(65 + optionIndex)}.</Box><MarkdownTypography component="span" sx={{ flex: 1, '& p': { mt: 0, mb: 0 } }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{option.option_text}</ReactMarkdown></MarkdownTypography></Box>} />))}</RadioGroup></FormControl></Box>))}</>)}
              {exam.questions.filter(q => q.question_type === '多选题').length > 0 && (<><Typography variant="h5" sx={{ mt: 4, mb: 3, fontWeight: 'bold' }}>二、多选题</Typography>{exam.questions.filter(q => q.question_type === '多选题').map((question, index) => (<Box key={question.id} id={`question-${question.id}`} sx={{ mt: 3, transition: 'background-color 0.5s ease' }}><FormControl component="fieldset" sx={{ width: '100%' }}><FormLabel component="legend" sx={{ mb: 1, display: 'flex', alignItems: 'flex-start' }}><Box component="span" sx={{ mr: 1, flexShrink: 0 }}>{index + 1}.</Box><MarkdownTypography component="span" sx={{ display: 'inline', '& p': { display: 'inline', mt: 0, mb: 0 } }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{question.question_text}</ReactMarkdown></MarkdownTypography></FormLabel><FormGroup>{question.options.map((option, optionIndex) => (<FormControlLabel key={option.id} control={<Checkbox checked={answers[question.id]?.selected?.[option.id] || false} onChange={() => handleAnswerChange(question.id, option.id, '多选题')} sx={{ mt: '-3px', p: '9px' }} />} sx={{ alignItems: 'flex-start', margin: '4px 0', '& .MuiFormControlLabel-label': { mt: '3px' } }} label={<Box component="span" sx={{ display: 'flex', alignItems: 'flex-start' }}><Box component="span" sx={{ mr: 1, flexShrink: 0, minWidth: '20px' }}>{String.fromCharCode(65 + optionIndex)}.</Box><MarkdownTypography component="span" sx={{ flex: 1, '& p': { mt: 0, mb: 0 } }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{option.option_text}</ReactMarkdown></MarkdownTypography></Box>} />))}</FormGroup></FormControl></Box>))}</>)}
              <Box sx={{ mt: 4, display: 'flex', justifyContent: 'center' }}><Button variant="contained" color="primary" onClick={handleSubmit} disabled={isSubmitting} sx={{ position: 'relative', minWidth: '240px', height: '36px', '&.Mui-disabled': { color: '#fff', backgroundColor: '#1976d2' } }}>{isSubmitting ? <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress size={20} sx={{ color: '#fff', mr: 1 }} /><Typography sx={{ color: '#fff', fontSize: '0.875rem' }}>正在提交考卷，请勿重复点击</Typography></Box> : '提交答案'}</Button></Box>
            </Box>
          )}
        </Paper>
      )}
    </Container>
  );
};

export default ExamTake;