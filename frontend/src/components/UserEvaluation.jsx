import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Box,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormControl,
  FormLabel,
  Button,
  Card,
  CardContent,
  Divider,
  CircularProgress,
} from '@mui/material';
import AlertMessage from './AlertMessage';
import api from '../api/axios';
import { hasToken } from '../api/auth-utils';

const UserEvaluation = () => {
  const { userId } = useParams();
  const [loading, setLoading] = useState(true);
  const [alertMessage, setAlertMessage] = useState(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [evaluations, setEvaluations] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [evaluationStructure, setEvaluationStructure] = useState([]);
  const [userInfo, setUserInfo] = useState(null);
  const tokenData = hasToken();
  const evaluator_user_id = tokenData.sub;
  const searchParams = new URLSearchParams(window.location.search);
  const editEvaluationId = searchParams.get('edit');

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 获取用户信息
        const userResponse = await api.get(`/users/${userId}/details`);
        setUserInfo(userResponse.data);

        // 获取评价结构
        const response = await api.get('/evaluation/structure');
        // 确保返回的数据是数组
        if (Array.isArray(response.data)) {
          setEvaluationStructure(response.data);

          // 如果是编辑模式，获取已有评价内容
          if (editEvaluationId) {
            const evaluationResponse = await api.get(`/evaluation/${editEvaluationId}`);
            const evaluationData = evaluationResponse.data;

            // 将评价数据转换为表单所需的格式
            const formattedEvaluations = {};
            evaluationData.aspects?.forEach(aspect => {
              aspect.categories?.forEach(category => {
                category.items?.forEach(item => {
                  if (item.score !== null && item.score !== undefined) {
                    formattedEvaluations[item.id] = item.score.toString();
                  }
                });
              });
            });

            setEvaluations(formattedEvaluations);
          }
        } else {
          throw new Error('评价结构数据格式不正确');
        }
      } catch (error) {
        console.error('获取数据失败:', error);
        setAlertMessage({
          severity: 'error',
          message: '获取数据失败: ' + (error.response?.data?.message || error.message)
        });
        setAlertOpen(true);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [userId, editEvaluationId]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const endpoint = editEvaluationId ? `/evaluation/${editEvaluationId}` : '/evaluation';
      const method = editEvaluationId ? 'put' : 'post';

      const response = await api[method](endpoint, {
        evaluated_user_id: userId,
        evaluator_user_id: evaluator_user_id,
        evaluations: Object.entries(evaluations).map(([itemId, score]) => ({
          item_id: itemId,
          score: parseInt(score)
        }))
      });
      
      if (response.data && response.data.success) {
        // 显示成功消息，但保留评价内容
        setAlertMessage({
          severity: 'success',
          message: editEvaluationId ? '评价更新成功' : '评价提交成功'
        });
        setAlertOpen(true);
        // 保持表单内容不变，让用户可以继续查看已提交的评价

        // 添加页面滚动和焦点设置逻辑
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          const titleElement = document.querySelector('h1');
          if (titleElement) {
            titleElement.focus();
            titleElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      }
    } catch (error) {
      console.error('提交评价失败:', error);
      setAlertMessage({
        severity: 'error',
        message: error.response?.data?.message || error.message || '提交评价失败，请稍后重试'
      });
      setAlertOpen(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleScoreChange = (itemId, value) => {
    setEvaluations(prev => ({
      ...prev,
      [itemId]: value
    }));
  };

  const handleRadioClick = (e, itemId, value) => {
    // 如果当前值已经选中，再次点击时取消选择
    if (evaluations[itemId] === value) {
      e.preventDefault();
      handleScoreChange(itemId, '');
    } else {
      handleScoreChange(itemId, value);
    }
  };

  useEffect(() => {
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  const handleAlertClose = () => {
    setAlertOpen(false);
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <AlertMessage
        open={alertOpen}
        message={alertMessage?.message}
        severity={alertMessage?.severity || 'info'}
        onClose={handleAlertClose}
      />
      <Typography variant="h1" gutterBottom textAlign={'center'} color={'#999999'}>
        {userInfo ? `正在对 ${userInfo.username} 进行评价` : '用户评价'}
      </Typography>
      
      {evaluationStructure.map(aspect => (
        <Card key={aspect.id} sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h2" gutterBottom textAlign={'center'}>{aspect.name}</Typography>
            
            {aspect.children && Array.isArray(aspect.children) && aspect.children.map(category => (
              <Box key={category.id} sx={{ mb: 3 }}>
                <Typography variant="h3" gutterBottom>{category.name}</Typography>
                
                {category.children && Array.isArray(category.children) && category.children.map(item => (
                  <Box key={item.id} sx={{ mb: 2 }}>
                    <FormControl component="fieldset">
                      <FormLabel component="legend">
                        {item.name}
                      </FormLabel>
                      <RadioGroup
                        row
                        value={evaluations[item.id] || ''}
                        onChange={(e) => handleScoreChange(item.id, e.target.value)}
                      >
                        <FormControlLabel
                          value="80"
                          control={
                            <Radio
                              onClick={(e) => handleRadioClick(e, item.id, "80")}
                            />
                          }
                          label="好 (80分)"
                        />
                        <FormControlLabel
                          value="60"
                          control={
                            <Radio
                              onClick={(e) => handleRadioClick(e, item.id, "60")}
                            />
                          }
                          label="一般 (60分)"
                        />
                        <FormControlLabel
                          value="40"
                          control={
                            <Radio
                              onClick={(e) => handleRadioClick(e, item.id, "40")}
                            />
                          }
                          label="不好 (40分)"
                        />
                        <FormControlLabel
                          value="0"
                          control={
                            <Radio
                              onClick={(e) => handleRadioClick(e, item.id, "0")}
                            />
                          }
                          label="不具备 (0分)"
                        />
                      </RadioGroup>
                    </FormControl>
                    {item.description && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, ml: 2 }}>
                        {item.description}
                      </Typography>
                    )}
                  </Box>
                ))}
                <Divider sx={{ my: 2 }} />
              </Box>
            ))}
          </CardContent>
        </Card>
      ))}
      
      <Box display="flex" justifyContent="center" mt={4}>
        <Button
          variant="contained"
          color="primary"
          onClick={handleSubmit}
          disabled={submitting || Object.keys(evaluations).length === 0}
        >
          {submitting ? '提交中...' : '提交评价'}
        </Button>
      </Box>
    </Container>
  );
};

export default UserEvaluation;