import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import {
  Container,
  Typography,
  Paper,
  Box,
  Divider,
  List,
  ListItem,
  ListItemText,
  Chip,
  CircularProgress,
} from '@mui/material';
import SchoolIcon from '@mui/icons-material/School';
import LocalLibraryIcon from '@mui/icons-material/LocalLibrary';

const ExamDetail = () => {
  const { examId } = useParams();
  const [exam, setExam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!examId) {
      setError('试卷ID不能为空');
      setLoading(false);
      return;
    }
    const fetchExamDetail = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/exams/${examId}/detail`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '获取试卷详情失败');
        }
        setExam(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchExamDetail();
  }, [examId]);

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
        <Typography color="error" variant="h6" align="center">
          {error}
        </Typography>
      </Container>
    );
  }

  if (!exam) {
    return (
      <Container>
        <Typography variant="h6" align="center">
          试卷不存在
        </Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg">
      <Paper elevation={3} sx={{ p: 3, my: 3 }}>
        {/* 试卷基本信息 */}
        <Typography variant="h4" gutterBottom>
          {exam?.title}
        </Typography>
        <Typography variant="body1" color="text.secondary" paragraph>
          {exam?.description || '无描述'}
        </Typography>
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle1" gutterBottom>
            课程：
            {exam?.course_names?.length > 0 ? (
              <Box component="span" sx={{ color: 'primary.main' }}>
                {exam.course_names.map((courseName, index) => (
                  <React.Fragment key={index}>
                    {courseName}
                    {index < exam.course_names.length - 1 && '、'}
                  </React.Fragment>
                ))}
              </Box>
            ) : (
              <Box component="span" sx={{ color: 'text.secondary' }}>
                无课程
              </Box>
            )}
          </Typography>
          <Typography variant="subtitle1" gutterBottom>
            题目数量：
            <Box component="span" sx={{ color: 'primary.main' }}>
              单选题 {exam?.questions?.filter(q => q.question_type === '单选题').length || 0} 题，
              多选题 {exam?.questions?.filter(q => q.question_type === '多选题').length || 0} 题
            </Box>
          </Typography>
          <Typography variant="subtitle1" gutterBottom>
            创建时间：
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {exam?.created_at ? new Date(exam.created_at).toLocaleString() : ''}
            </Box>
          </Typography>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* 按题型分组显示题目 */}
        {exam?.questions && (
          <>
            {/* 单选题部分 */}
            <Box sx={{ mb: 4 }}>
              <Typography 
                variant="h5" 
                sx={{ 
                  mb: 2, 
                  color: 'primary.main', 
                  fontWeight: 'bold',
                  fontSize: '1.5rem'  
                }}
              >
                一、单选题
              </Typography>
              <List>
                {exam.questions
                  .filter(q => q.question_type === '单选题')
                  .map((question, index) => (
                    <QuestionItem 
                      key={question.id} 
                      question={question} 
                      index={index + 1} 
                    />
                  ))}
              </List>
            </Box>

            {/* 多选题部分 */}
            {exam.questions.some(q => q.question_type === '多选题') && (
              <Box>
                <Typography 
                  variant="h5" 
                  sx={{ 
                    mb: 2, 
                    color: 'primary.main', 
                    fontWeight: 'bold',
                    fontSize: '1.5rem'  
                  }}
                >
                  二、多选题
                </Typography>
                <List>
                  {exam.questions
                    .filter(q => q.question_type === '多选题')
                    .map((question, index) => (
                      <QuestionItem 
                        key={question.id} 
                        question={question} 
                        index={index + 1} 
                      />
                    ))}
                </List>
              </Box>
            )}
          </>
        )}
      </Paper>
    </Container>
  );
};

const QuestionItem = ({ question, index }) => {
  const options = Array.isArray(question.options) ? question.options : [];
  const answers = Array.isArray(question.answer) ? question.answer : [];

  return (
    <React.Fragment>
      <ListItem
        alignItems="flex-start"
        sx={{
          flexDirection: 'column',
          bgcolor: 'background.paper',
          mb: 2,
          p: 2,
          borderRadius: 1,
        }}
      >
        <Box sx={{ width: '100%' }}>
          {/* 题目标题和内容放在同一行 */}
          <Box sx={{ display: 'flex', mb: 2 }}>
            <Typography 
              variant="subtitle1" 
              sx={{ 
                minWidth: '3em',  
                flexShrink: 0,
                fontWeight: 'bold'
              }}
            >
              {index}.
            </Typography>
            <Typography variant="body1" sx={{ flex: 1 }}>
              {question.question_text}
            </Typography>
          </Box>

          {/* 选项 */}
          <Box sx={{ ml: '3em' }}>  
            <List dense disablePadding>
              {options.map((option, optIndex) => {
                const optionLetter = String.fromCharCode(65 + optIndex);
                const isCorrect = option.is_correct;
                return (
                  <ListItem key={optIndex} sx={{ py: 0.5 }} disableGutters>
                    <ListItemText
                      primary={`${optionLetter}. ${option.option_text}`}
                      sx={{
                        '& .MuiListItemText-primary': {
                          color: isCorrect ? 'success.main' : 'text.primary',
                          fontWeight: isCorrect ? 'bold' : 'normal',
                        },
                      }}
                    />
                  </ListItem>
                );
              })}
            </List>

            {/* 答案和解释 */}
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="success.main" sx={{ fontWeight: 'bold' }}>
                正确答案：{options.filter(opt => opt.is_correct).map((_, idx) => String.fromCharCode(65 + idx)).join('、')}
              </Typography>
              {question.explanation && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  解释：{question.explanation}
                </Typography>
              )}
            </Box>

            {/* 课程和知识点标签移到最下方 */}
            <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
              <Chip
                icon={<SchoolIcon />}
                label={question.course_name || '未知课程'}
                size="small"
                color="primary"
                variant="outlined"
              />
              <Chip
                icon={<LocalLibraryIcon />}
                label={question.knowledge_point_name || '未知知识点'}
                size="small"
                color="primary"
                variant="outlined"
              />
            </Box>
          </Box>
        </Box>
      </ListItem>
      <Divider />
    </React.Fragment>
  );
};

export default ExamDetail;
