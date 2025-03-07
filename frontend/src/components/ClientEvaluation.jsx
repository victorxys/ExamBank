import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Avatar,
  Container,
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
  TextField,
  Grid,
  Select,
  MenuItem,
} from '@mui/material';
import AlertMessage from './AlertMessage';
import api from '../api/axios';
import PageHeader from './PageHeader';
import logoSvg from '../assets/logo.svg';
import { useTheme } from '@mui/material/styles';

const ClientEvaluation = () => {
  const navigate = useNavigate();
  const { userId } = useParams();
  const location = useLocation();
  const [userInfo, setUserInfo] = useState(null);
  const searchParams = new URLSearchParams(location.search);
  const isEditMode = searchParams.get('edit');
  const theme = useTheme();

  const [loading, setLoading] = useState(true);
  const [alertMessage, setAlertMessage] = useState(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [evaluations, setEvaluations] = useState({});
  const [additionalComments, setAdditionalComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [evaluationStructure, setEvaluationStructure] = useState([]);
  const [clientName, setClientName] = useState('');
  const [clientTitle, setClientTitle] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 修改API调用，移除认证头部
        const userResponse = await fetch(`${api.defaults.baseURL}/users/${userId}/details`);
        const userData = await userResponse.json();
        setUserInfo(userData);

        // 获取评价结构（仅可见项）
        const response = await fetch(`${api.defaults.baseURL}/evaluation/structure?client_visible=true`);
        const structureData = await response.json();
        if (Array.isArray(structureData)) {
          setEvaluationStructure(structureData);

          // 如果是编辑模式，获取历史评价数据
          if (isEditMode) {
            const evaluationResponse = await fetch(`${api.defaults.baseURL}/evaluation/${isEditMode}`);
            const evaluationData = await evaluationResponse.json();

            // 设置客户信息
            setClientName(evaluationData.evaluator_name || '');
            setClientTitle(evaluationData.evaluator_title || '');

            // 设置评分
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

            // 设置补充评价
            setAdditionalComments(evaluationData.additional_comments || '');
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
  }, [isEditMode]);

  const handleSubmit = async () => {
    if (!clientName.trim()) {
      setAlertMessage({
        severity: 'error',
        message: '请输入您的姓氏'
      });
      setAlertOpen(true);
      return;
    }

    setSubmitting(true);
    try {
      const filteredEvaluations = Object.entries(evaluations)
        .filter(([, score]) => {
          const parsedScore = parseInt(score);
          return !isNaN(parsedScore) && parsedScore != null;
        })
        .map(([itemId, score]) => ({
          item_id: itemId,
          score: parseInt(score),
        }));

      const evaluationData = {
        client_name: clientName,
        client_title: clientTitle,
        evaluations: filteredEvaluations,
        evaluation_type: "client",
        evaluated_user_id: userId,
        evaluator_user_id: '',
        additional_comments: additionalComments
      };

      // 修改API调用，移除认证头部
      const response = isEditMode
        ? await fetch(`${api.defaults.baseURL}/evaluation/${isEditMode}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(evaluationData)
          })
        : await fetch(`${api.defaults.baseURL}/evaluation`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(evaluationData)
          });
      
      const responseData = await response.json();
      if (responseData.success) {
        setAlertMessage({
          severity: 'success',
          message: isEditMode ? '评价更新成功！' : '感谢您的评价！'
        });
        setAlertOpen(true);

        if (!isEditMode) {
          // 仅在新建评价时清空表单
          setEvaluations({});
          setAdditionalComments('');
          setClientName('');
          setClientTitle('');
          // 跳转到感谢页面
          navigate('/thank-you', { state: { username: userInfo?.username } });
        }
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
    if (evaluations[itemId] === value) {
      e.preventDefault();
      handleScoreChange(itemId, '');
    } else {
      handleScoreChange(itemId, value);
    }
  };

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
    <Container maxWidth="100%" sx={{ px: { xs: 2, sm: 3 } }}>
      <AlertMessage
        open={alertOpen}
        message={alertMessage?.message}
        severity={alertMessage?.severity || 'info'}
        onClose={handleAlertClose}
      />
      
      
      <Box
        component="img"
        src={logoSvg}
        alt="Logo"
        sx={{
          width: 100,
          height: 'auto',
          display: 'block',
          margin: '0 auto',
          mb: 0
        }}
      />
        <Box
        sx={{
            background: `linear-gradient(87deg, ${theme.palette.primary.main} 0, ${theme.palette.primary.dark} 100%)`,
            borderRadius: '0.375rem',
            p: 3,
            mb: 3,
            color: 'white',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
        }}
        >
      <Box>
        <Typography variant="h1" component="h1" color="white" gutterBottom>
        欢迎对 {userInfo?.username}进行评价
        </Typography>
        
        <Typography variant="body1" color="white" sx={{ opacity: 0.8 }}>
        您的评价对我们至关重要，对于不了解的内容可以不做选择。
        </Typography>
      </Box>

    </Box>
    
          


      {/* 评价项目 */}
      {evaluationStructure.map((aspect) => (
        <React.Fragment key={aspect.id}>
          {aspect.children && Array.isArray(aspect.children) && aspect.children.map((category) => (
            category.children && Array.isArray(category.children) && category.children.length > 0 ? (
              <Card key={category.id} sx={{ mb: 3, boxShadow: { xs: '0 2px 4px rgba(0,0,0,0.1)', sm: '0 4px 8px rgba(0,0,0,0.1)' } }}>
                <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                  <Typography variant="h2" gutterBottom textAlign="center" sx={{ fontSize: { xs: '1.5rem', sm: '2rem' } }}>
                    {category.name}
                  </Typography>
                  {category.children && Array.isArray(category.children) && category.children.map((item) => (
                    <Box key={item.id} sx={{ mb: { xs: 2, sm: 3 }, p: { xs: 2, sm: 3 }, bgcolor: 'background.paper', borderRadius: '8px' }}>
                      <FormControl component="fieldset" sx={{ width: '100%' }}>
                        <FormLabel component="legend" sx={{ mb: 1, fontSize: { xs: '1.1rem', sm: '1.1rem' }, fontWeight: 500 }}>
                          {item.name}
                        </FormLabel>
                        <RadioGroup
                          value={evaluations[item.id] || ''}
                          onChange={(e) => handleScoreChange(item.id, e.target.value)}
                          sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 0.5
                          }}
                        >
                          {[
                            { value: "100", label: "非常好 (100分)" },
                            { value: "80", label: "好 (80分)" },
                            { value: "60", label: "一般 (60分)" },
                            { value: "40", label: "不好 (40分)" },
                            { value: "0", label: "不具备 (0分)" }
                          ].map(option => (
                            <FormControlLabel
                              key={option.value}
                              value={option.value}
                              control={<Radio onClick={(e) => handleRadioClick(e, item.id, option.value)} />}
                              label={option.label}
                              sx={{
                                margin: 0,
                                
                                p: { xs: 0, sm: 0.5 },
                                borderRadius: '4px',
                                '&:hover': {
                                  bgcolor: 'action.hover'
                                }
                              }}
                            />
                          ))}
                        </RadioGroup>
                      </FormControl>
                      {item.description && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontSize: { xs: '0.875rem', sm: '1rem' } }}>
                          {item.description}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </CardContent>
              </Card>
            ) : null
          ))}
        </React.Fragment>
      ))}
      
      {/* 补充评价 */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h2" gutterBottom textAlign="center">补充评价（非必填）</Typography>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="如果您有其他评价，可在此处进行补充。"
            placeholder="请在此处添加您的补充评价内容..."
            value={additionalComments}
            onChange={(e) => setAdditionalComments(e.target.value)}
            variant="outlined"
            sx={{ mb: 2 }}
          />
        </CardContent>
      </Card>

      {/* 姓氏填写 */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'center' }}>
            <TextField
              label="您的姓氏"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              sx={{ width: { xs: '100%', sm: 200 } }}
              required
              size="medium"
            />
            <FormControl sx={{ width: { xs: '100%', sm: 'auto' } }}>
              <RadioGroup
                row
                value={clientTitle}
                onChange={(e) => setClientTitle(e.target.value)}
                sx={{
                  justifyContent: { xs: 'space-around', sm: 'flex-start' },
                  '& .MuiFormControlLabel-root': {
                    flex: { xs: 1, sm: 'none' },
                    margin: { xs: 0, sm: 2 }
                  }
                }}
              >
                <FormControlLabel value="先生" control={<Radio />} label="先生" />
                <FormControlLabel value="女士" control={<Radio />} label="女士" />
              </RadioGroup>
            </FormControl>
          </Box>
        </CardContent>
      </Card>

      <Box display="flex" justifyContent="center" mt={4} mb={4}>
        <Button
          variant="contained"
          color="primary"
          onClick={handleSubmit}
          disabled={submitting}
          sx={{
            py: { xs: 1.5, sm: 2 },
            px: { xs: 4, sm: 6 },
            fontSize: { xs: '1rem', sm: '1.1rem' },
            width: { xs: '100%', sm: 'auto' },
            borderRadius: '8px'
          }}
        >
          {submitting ? '提交中...' : isEditMode ? '更新评价' : '提交评价'}
        </Button>
      </Box>
    </Container>
  );
};

export default ClientEvaluation;