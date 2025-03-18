import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Typography,
  Box,
  Card,
  CardContent,
  Divider,
  CircularProgress,
  Button,
  Grid,
  Rating,
  Chip,
  List,
  ListItem,
  ListItemText,
  Avatar,
  useTheme,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AlertMessage from './AlertMessage';
import api from '../api/axios';
import PageHeader from './PageHeader';

const EmployeeSelfEvaluationDetail = () => {
  const theme = useTheme();
  const { evaluationId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [evaluation, setEvaluation] = useState(null);
  const [alertMessage, setAlertMessage] = useState(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [organizedDetails, setOrganizedDetails] = useState(null);

  useEffect(() => {
    fetchEvaluationDetail();
  }, [evaluationId]);

  const fetchEvaluationDetail = async () => {
    try {
      const response = await api.get(`/employee-self-evaluation/${evaluationId}`);
      setEvaluation(response.data);
      
      // 组织评价详情数据
      if (response.data && response.data.details) {
        organizeDetails(response.data.details);
      }
    } catch (error) {
      console.error('获取员工自评详情失败:', error);
      setAlertMessage({
        severity: 'error',
        message: '获取员工自评详情失败: ' + (error.response?.data?.message || error.message)
      });
      setAlertOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const organizeDetails = (details) => {
    const organized = {};
    
    details.forEach(detail => {
      if (!organized[detail.aspect_name]) {
        organized[detail.aspect_name] = {
          name: detail.aspect_name,
          categories: {},
          scores: []
        };
      }
      
      if (!organized[detail.aspect_name].categories[detail.category_name]) {
        organized[detail.aspect_name].categories[detail.category_name] = {
          name: detail.category_name,
          items: []
        };
      }
      
      organized[detail.aspect_name].categories[detail.category_name].items.push({
        id: detail.id,
        name: detail.item_name,
        score: detail.score
      });
      
      // 添加分数到aspect的scores数组中
      organized[detail.aspect_name].scores.push(detail.score);
    });
    
    // 转换为数组格式并计算平均分
    const aspectsArray = Object.values(organized).map(aspect => {
      // 计算每个aspect的平均分
      const validScores = aspect.scores.filter(score => score !== null && score !== undefined);
      const avgScore = validScores.length > 0 
        ? validScores.reduce((sum, score) => sum + score, 0) / validScores.length 
        : null;
      
      return {
        ...aspect,
        average_score: avgScore,
        categories: Object.values(aspect.categories)
      };
    });
    
    setOrganizedDetails({
      aspects: aspectsArray
    });
  };

  const handleAlertClose = () => {
    setAlertOpen(false);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleBack = () => {
    navigate('/employee-self-evaluations');
  };
  
  // 计算总平均分
  const calculateTotalAverage = (aspects) => {
    if (!aspects || aspects.length === 0) return 'N/A';
    
    const validScores = aspects
      .map(aspect => aspect.average_score)
      .filter(score => score !== null && score !== undefined);
    
    if (validScores.length === 0) return 'N/A';
    
    const sum = validScores.reduce((acc, score) => acc + score, 0);
    return (sum / validScores.length).toFixed(1);
  };
  
  // 根据分数获取颜色
  const getScoreColor = (score) => {
    if (score >= 80) return 'success';
    if (score >= 60) return 'primary';
    if (score >= 40) return 'warning';
    return 'error';
  };
  
  // 获取总分颜色
  const getTotalScoreColor = (score) => {
    if (score === 'N/A') return 'default';
    return getScoreColor(parseFloat(score));
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (!evaluation) {
    return (
      <Container maxWidth="lg">
        <AlertMessage
          open={alertOpen}
          message={alertMessage?.message}
          severity={alertMessage?.severity || 'info'}
          onClose={handleAlertClose}
        />
        <Box display="flex" flexDirection="column" alignItems="center" mt={4}>
          <Typography variant="h5" gutterBottom>未找到员工自评信息</Typography>
          <Button
            variant="contained"
            startIcon={<ArrowBackIcon />}
            onClick={handleBack}
            sx={{ mt: 2 }}
          >
            返回列表
          </Button>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <AlertMessage
        open={alertOpen}
        message={alertMessage?.message}
        severity={alertMessage?.severity || 'info'}
        onClose={handleAlertClose}
      />
      
      <PageHeader
        title="员工自评详情"
        description={`查看 ${evaluation.employee_name} 的自评信息`}
      />
      
      {/* 总体评价分数卡片 */}
      {organizedDetails?.aspects?.length > 0 && (
        <Card sx={{ mb: 4 }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h2" gutterBottom>
              总体评价
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', gap: 2, py: 1 }}>
              {/* 总平均分 */}
              <Box 
                sx={{ 
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  minWidth: '120px',
                  p: 1,
                  borderRight: '1px solid rgba(0, 0, 0, 0.12)',
                  pr: 2
                }}
              >
                <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'medium', textAlign: 'center' }}>
                  总平均分
                </Typography>
                <Chip
                  label={calculateTotalAverage(organizedDetails.aspects)}
                  color={getTotalScoreColor(calculateTotalAverage(organizedDetails.aspects))}
                  sx={{ 
                    fontWeight: 'bold',
                    minWidth: '60px'
                  }}
                />
              </Box>
              
              {/* 各项平均分 */}
              {organizedDetails.aspects.map(aspect => (
                <Box 
                  key={aspect.name} 
                  sx={{ 
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    minWidth: '120px',
                    p: 1
                  }}
                >
                  <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'medium', textAlign: 'center' }}>
                    {aspect.name}
                  </Typography>
                  <Chip
                    label={aspect.average_score?.toFixed(1) || 'N/A'}
                    color={getScoreColor(aspect.average_score)}
                    sx={{ 
                      fontWeight: 'bold',
                      minWidth: '60px'
                    }}
                  />
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>
      )}
      
      {/* 用户基本信息卡片 */}
      <Card sx={{ mb: 4 }}>
        <CardContent sx={{ p: 3 }}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 2 }}>
                <Avatar
                  sx={{
                    width: 100,
                    height: 100,
                    border: '4px solid white',
                    boxShadow: '0 8px 16px rgba(38, 166, 154, 0.1)',
                    bgcolor: '#F5F5F5',
                    color: theme.palette.primary.main
                  }}
                  alt={evaluation.employee_name}
                >
                  {evaluation.employee_name?.[0]?.toUpperCase()}
                </Avatar>
                <Box>
                  <Typography variant="h2" gutterBottom>{evaluation.employee_name}</Typography>
                  <Typography variant="body1" color="text.secondary">
                    手机号码：{evaluation.phone_number || '未设置'}
                  </Typography>
                  <Typography variant="body1" color="text.secondary">
                    评价时间：{formatDate(evaluation.evaluation_time)}
                  </Typography>
                </Box>
              </Box>
            </Grid>
            <Grid item xs={12} md={6}>
              <Box display="flex" justifyContent="flex-end" gap={2}>
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={<ArrowBackIcon />}
                  onClick={handleBack}
                  sx={{
                    background: 'linear-gradient(87deg, #5e72e4 0, #825ee4 100%)',
                    '&:hover': {
                      background: 'linear-gradient(87deg, #4050e0 0, #6f4ed4 100%)',
                    },
                  }}
                >
                  返回列表
                </Button>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
      
      {/* 评价详情信息 */}
      {organizedDetails?.aspects?.map(aspect => (
        <Card key={aspect.name} sx={{ mb: 3 }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h2" gutterBottom textAlign="center">
              {aspect.name}
            </Typography>
            <Typography variant="h3" color="primary" textAlign="center" gutterBottom>
              平均得分：{aspect.average_score?.toFixed(1) || '暂无'}
            </Typography>
            
            <Divider sx={{ my: 2 }} />
            
            {aspect.categories?.map(category => (
              <Box key={category.name} sx={{ mb: 3 }}>
                <Typography variant="h3" gutterBottom>
                  {category.name}
                </Typography>
                
                <List>
                  {category.items?.map(item => (
                    <ListItem
                      key={item.id}
                      sx={{
                        borderRadius: 1,
                        mb: 1,
                        backgroundColor: 'background.paper',
                      }}
                    >
                      <ListItemText
                        primary={item.name}
                        secondary={
                          <>
                            <Typography variant="body2" color="text.secondary" component="div" sx={{ mb: 1 }}>
                              得分：
                              <Chip
                                label={`${item.score?.toFixed(1) || '暂无'}`}
                                color={item.score >= 80 ? 'success' : item.score >= 60 ? 'primary' : item.score >= 40 ? 'warning' : 'error'}
                                size="small"
                                sx={{ ml: 1 }}
                              />
                            </Typography>
                          </>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              </Box>
            ))}
          </CardContent>
        </Card>
      ))}
      
      {/* 补充说明 */}
      {evaluation.comments && (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h2" gutterBottom>补充说明</Typography>
            <Typography variant="body1" sx={{ whiteSpace: 'pre-line', p: 2, bgcolor: 'background.paper', borderRadius: 1 }}>
              {evaluation.comments}
            </Typography>
          </CardContent>
        </Card>
      )}
    </Container>
  );
};

export default EmployeeSelfEvaluationDetail;
