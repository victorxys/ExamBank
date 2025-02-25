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
  Alert,
} from '@mui/material';
import api from '../api/axios';
import { hasToken } from '../api/auth-utils';

const UserEvaluation = () => {
  const { userId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [evaluations, setEvaluations] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [evaluationStructure, setEvaluationStructure] = useState([]);
  const [userInfo, setUserInfo] = useState(null);
  const tokenData = hasToken();
  const evaluator_user_id = tokenData.sub;

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
        } else {
          throw new Error('评价结构数据格式不正确');
        }
      } catch (error) {
        console.error('获取评价结构失败:', error);
        setError('获取评价结构失败: ' + (error.response?.data?.message || error.message));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [userId]);

  const handleScoreChange = (itemId, value) => {
    setEvaluations(prev => ({
      ...prev,
      [itemId]: parseInt(value)
    }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const response = await api.post('/evaluation', {
        evaluated_user_id: userId,
        evaluator_user_id: evaluator_user_id,
        evaluations: Object.entries(evaluations).map(([itemId, score]) => ({
          item_id: itemId,
          score
        }))
      });
      
      if (response.data && response.data.success) {
        // 清空当前评价
        setEvaluations({});
        alert('评价提交成功');
      } else {
        throw new Error(response.data?.message || '提交评价失败');
      }
    } catch (error) {
      console.error('提交评价失败:', error);
      setError(
        error.response?.data?.message ||
        error.message ||
        '提交评价失败，请稍后重试'
      );
      // 不清空评价数据，让用户可以修改后重试
    } finally {
      setSubmitting(false);
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

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
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
                        <FormControlLabel value="100" control={<Radio />} label="好 (100分)" />
                        <FormControlLabel value="80" control={<Radio />} label="一般 (80分)" />
                        <FormControlLabel value="60" control={<Radio />} label="差 (60分)" />
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