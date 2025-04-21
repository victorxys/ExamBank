import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Container,
  Paper,
  Avatar,
  Typography,
  Box,
  Card,
  CardContent,
  Divider,
  CircularProgress,
  Alert,
  Grid,
  List,
  ListItem,
  ListItemText,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
} from '@mui/material';
import { Visibility as VisibilityIcon, Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import api from '../api/axios'; // 确保路径正确
import { hasToken } from '../api/auth-utils'; // 确保路径正确
import ai from '../api/ai'; // 确保路径正确
import PageHeader from './PageHeader'; // 确保路径正确
import { useTheme } from '@mui/material/styles';

const UserEvaluationSummary = () => {
  const theme = useTheme();
  const { userId } = useParams();
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false); // 加载评价详情的状态
  const [error, setError] = useState(null);
  const [evaluationSummary, setEvaluationSummary] = useState(null); // 存储汇总数据
  const [userInfo, setUserInfo] = useState(null);
  const [selectedEvaluation, setSelectedEvaluation] = useState(null); // 存储基础信息+详细信息
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [evaluationToDelete, setEvaluationToDelete] = useState(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const tokenData = hasToken();
  const navigate = useNavigate();

  // 获取基础用户和评价汇总数据
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [userResponse, summaryResponse] = await Promise.all([
          api.get(`/users/${userId}/details`),
          api.get(`/users/${userId}/evaluations`)
        ]);
        setUserInfo(userResponse.data);
        setEvaluationSummary(summaryResponse.data);
      } catch (error) {
        console.error('获取基础信息或评价汇总失败:', error);
        setError('获取信息失败: ' + (error.response?.data?.message || error.message));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [userId]);

  // 获取单个评价的详细数据
  const fetchEvaluationDetail = async (evaluationId) => {
    if (!evaluationId) return;
    // 检查是否已经加载过详细数据
    if (selectedEvaluation?.hasDetailedData && selectedEvaluation?.id === evaluationId) {
      // console.log('详情数据已加载，跳过 fetch');
      return;
    }
    try {
      setLoadingDetail(true);
      setError(null);
      const response = await api.get(`/evaluation/${evaluationId}`);
      // 将详细数据合并到 selectedEvaluation 中
      setSelectedEvaluation(prev => ({ ...prev, ...response.data, hasDetailedData: true }));
    } catch (error) {
      console.error('获取详细评价失败:', error);
      setError('获取评价详情失败: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoadingDetail(false);
    }
  };

  // 处理查看详情按钮点击
  const handleViewDetailsClick = (evaluation) => {
    setSelectedEvaluation({
      ...evaluation, // 先设置列表中的基础信息
      hasDetailedData: false // 标记未加载详情
    });
    setDetailDialogOpen(true);
    // 触发详情加载
    fetchEvaluationDetail(evaluation.id);
  };

  // 计算总平均分
  const calculateTotalAverage = (aspects) => {
    if (!aspects || aspects.length === 0) return 'N/A';
    const validScores = aspects
      .map(aspect => Number(aspect.average_score))
      .filter(score => !isNaN(score));
    if (validScores.length === 0) return 'N/A';
    const sum = validScores.reduce((acc, score) => acc + score, 0);
    return (sum / validScores.length).toFixed(1);
  };

  // 根据分数获取颜色
  const getScoreColor = (score) => {
    const parsedScore = typeof score === 'string' ? parseFloat(score) : score;
    if (parsedScore === 'N/A' || isNaN(parsedScore)) return 'default';
    if (parsedScore >= 80) return 'success';
    if (parsedScore >= 60) return 'primary';
    if (parsedScore >= 40) return 'warning';
    return 'error';
  };

  // 获取总分颜色
  const getTotalScoreColor = (score) => {
    if (score === 'N/A') return 'default';
    const parsedScore = typeof score === 'string' ? parseFloat(score) : score;
    return getScoreColor(isNaN(parsedScore) ? 'N/A' : parsedScore);
  };

  // **********************************************
  // ** 问题 2 的核心改动：用于Dialog的renderCategory **
  // **********************************************
  const renderDetailCategory = (category) => ( // 重命名以区分
    <Box key={category.id || category.name} sx={{ ml: 2, mb: 3 }}>
      <Typography variant="h4" gutterBottom>
        {category.name}
      </Typography>

      {/* 显示 manual_input */}
      {category.manual_input && ( // 注意：接口返回的是 manual_input 字符串，不是数组
        <Paper
          elevation={0}
          sx={{
            mt: 1,
            mb: 2,
            p: 1.5,
            bgcolor: 'grey.100',
            borderRadius: 1,
            border: '1px dashed',
            borderColor: 'grey.400'
          }}
        >
          <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{fontWeight: 'bold'}}>
            补充评价：
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {category.manual_input}
          </Typography>
        </Paper>
      )}

      {/* 渲染评分项 */}
      {category.items?.length > 0 && (
        <List dense>
          {category.items.map(item => (
            <ListItem
              key={item.id}
              sx={{
                borderRadius: 1,
                mb: 1,
                backgroundColor: 'background.paper',
                py: 1,
                px: 1.5
              }}
            >
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body1" component="span">{item.name}</Typography>
                    {/* Dialog 中显示的是具体评价的 score */}
                    <Chip
                      label={item.average_score !== null && item.average_score !== undefined ? Number(item.average_score).toFixed(1) : '未评'}
                      color={getScoreColor(item.average_score)}
                      size="small"
                    />
                  </Box>
                }
                secondary={item.description}
              />
            </ListItem>
          ))}
        </List>
      )}
      {!category.manual_input && (!category.items || category.items.length === 0) && (
        <Typography variant="body2" color="text.secondary" sx={{ml: 1}}>此类别无评价项或补充。</Typography>
      )}
    </Box>
  );

  // 处理 AI 介绍生成
  const handleGenerateAIProfile = async () => {
    if (!evaluationSummary || !userInfo) {
        alert('评价汇总数据或用户信息缺失');
        return;
    }
    // 构建发送给 AI 的数据，与之前类似，但确保使用最新的 evaluationSummary
    const aiInputData = {
        name: userInfo.username,
        evaluated_user_id: userId,
        evaluations: evaluationSummary, // 直接传递后端返回的汇总数据
        // 如果需要补充说明历史，可以从 evaluationSummary.evaluations 提取
        // additional_comments_history: evaluationSummary.evaluations?.map(...)
    };

    try {
        setAiGenerating(true);
        const response = await ai.generateAIEvaluation(aiInputData, userId);
        alert('AI员工介绍已生成');
        navigate(`/employee-profile/${userId}`);
    } catch (error) {
        console.error('AI生成失败:', error);
        alert('AI生成失败，请稍后重试: ' + (error.response?.data?.error || error.message));
    } finally {
        setAiGenerating(false);
    }
  };

  // 处理删除评价
  const handleDeleteEvaluation = async () => {
    if (!evaluationToDelete) return;
    try {
      await api.delete(`/evaluation/${evaluationToDelete.id}`);
      // 刷新评价列表
      const summaryResponse = await api.get(`/users/${userId}/evaluations`);
      setEvaluationSummary(summaryResponse.data);
      setDeleteDialogOpen(false);
      setEvaluationToDelete(null);
    } catch (error) {
      console.error('删除评价失败:', error);
      alert('删除评价失败: ' + (error.response?.data?.message || error.message));
    }
  };

  // --- JSX ---
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error && !evaluationSummary) {
    return <Container maxWidth="lg" sx={{ py: 4 }}><Alert severity="error">{error}</Alert></Container>;
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <PageHeader
        title="员工评价汇总"
        description="展示此员工的平均评价分数，同时可查看历史评价结果"
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* 总体评价分数卡片 */}
      {evaluationSummary?.aspects?.length > 0 && (
        <Card sx={{ mb: 4 }}>
          <CardContent sx={{ p: 3 }}>
            <Typography variant="h2" gutterBottom>总体评价</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', gap: 2, py: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '120px', p: 1, borderRight: '1px solid rgba(0, 0, 0, 0.12)', pr: 2 }}>
                <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'medium', textAlign: 'center' }}>总平均分</Typography>
                <Chip
                  label={calculateTotalAverage(evaluationSummary.aspects)}
                  color={getTotalScoreColor(calculateTotalAverage(evaluationSummary.aspects))}
                  sx={{ fontWeight: 'bold', minWidth: '60px' }}
                />
              </Box>
              {evaluationSummary.aspects.map(aspect => (
                <Box key={aspect.id || aspect.name} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '120px', p: 1 }}>
                  <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'medium', textAlign: 'center' }}>{aspect.name}</Typography>
                  <Chip
                    label={Number(aspect.average_score)?.toFixed(1) || 'N/A'}
                    color={getScoreColor(Number(aspect.average_score))}
                    sx={{ fontWeight: 'bold', minWidth: '60px' }}
                  />
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* 用户基本信息卡片 */}
      <Card sx={{ mb: 4 }}>
          <CardContent>
              {/* ... 省略 Grid 和 Avatar 等基础信息布局 ... */}
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 2 }}>
                    <Avatar sx={{ /* ... 样式 ... */ }} alt={userInfo?.username} src={`/avatar/${userId}-avatar.jpg`}>
                      {userInfo?.username?.[0]?.toUpperCase()}
                    </Avatar>
                    <Box>
                      <Typography variant="h2" gutterBottom>{userInfo?.username}</Typography>
                      <Typography variant="body1" color="text.secondary">手机号码：{userInfo?.phone_number || '未设置'}</Typography>
                      <Typography variant="body1" color="text.secondary">角色：{userInfo?.role === 'admin' ? '管理员' : '普通用户'}</Typography>
                    </Box>
                  </Box>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Box display="flex" justifyContent="flex-end" gap={2} flexWrap="wrap">
                      <Button variant="contained" color="primary" component={Link} to={`/user-evaluation/${userId}`}>添加新评价</Button>
                      <Button variant="outlined" color="primary" /* onClick for Copy */ >复制评价</Button>
                      <Button variant="outlined" color="primary" disabled={aiGenerating} onClick={handleGenerateAIProfile}>
                          {aiGenerating ? <CircularProgress size={20} sx={{ mr: 1 }} /> : 'AI员工介绍'}
                      </Button>
                  </Box>
                </Grid>
            </Grid>
          </CardContent>
      </Card>

      {/* 评价汇总信息 */}
      {evaluationSummary?.aspects?.map(aspect => (
        <Card key={aspect.id || aspect.name} sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h2" gutterBottom textAlign="center">
              {aspect.name}
            </Typography>
            <Typography variant="h3" color="primary" textAlign="center" gutterBottom>
              平均得分：{Number(aspect.average_score)?.toFixed(1) || '暂无'}
            </Typography>
            <Divider sx={{ my: 2 }} />

            {/* ***************************************** */}
            {/* ** 问题 1 的核心改动：显示 manual_inputs ** */}
            {/* ***************************************** */}
            {aspect.categories?.map(category => (
              <Box key={category.id || category.name} sx={{ mb: 3 }}>
                <Typography variant="h3" gutterBottom>{category.name}</Typography>
                
                {/* 显示 Manual Inputs */}
                {category.manual_inputs && category.manual_inputs.length > 0 && (
                  <Paper 
                    elevation={0} 
                    sx={{ 
                      mt: 1, 
                      mb: 2, 
                      p: 1.5, 
                      bgcolor: 'grey.100', 
                      borderRadius: 1, 
                      border: '1px dashed', 
                      borderColor: 'grey.400' 
                    }}
                  >
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ fontWeight: 'bold' }}>
                      手动评价：
                    </Typography>
                    {category.manual_inputs.map((input, index) => (
                      <Typography key={index} variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 0.5 }}>
                        {input}
                      </Typography>
                    ))}
                  </Paper>
                )}
                
                {/* 显示 Items (Average Score) */}
                {category.items?.length > 0 && (
                  <List dense>
                    {category.items.map(item => (
                      <ListItem key={item.id} sx={{ borderRadius: 1, mb: 1, backgroundColor: 'background.paper', py: 1, px: 1.5 }}>
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <Typography variant="body1" component="span">{item.name}</Typography>
                              <Chip
                                label={item.average_score ? Number(item.average_score).toFixed(1) : '暂无'}
                                color={getScoreColor(item.average_score)} // 使用平均分
                                size="small"
                              />
                            </Box>
                          }
                          secondary={item.description}
                        />
                      </ListItem>
                    ))}
                  </List>
                )}
                {/* 如果都没有 */}
                {!category.manual_inputs?.length && !category.items?.length && (
                    <Typography variant="body2" color="text.secondary" sx={{ml: 1}}>此类别无评价项或手动输入。</Typography>
                )}
              </Box>
            ))}
          </CardContent>
        </Card>
      ))}

      {/* ********************************************** */}
      {/* ** 问题 2 的核心改动：恢复历史评价列表样式 ** */}
      {/* ********************************************** */}
      {evaluationSummary?.evaluations?.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="h2" gutterBottom>历史评价</Typography>
            {/* 内部评价 */}
            {evaluationSummary.evaluations.filter(e => e.evaluation_type === 'internal').length > 0 && (
              <>
                <Typography variant="h3" gutterBottom sx={{ mt: 3 }}>内部评价</Typography>
                <List>
                  {evaluationSummary.evaluations
                    .filter(e => e.evaluation_type === 'internal')
                    .map(evaluation => (
                      <ListItem
                        key={evaluation.id}
                        sx={{
                          borderRadius: 1,
                          mb: 2,
                          backgroundColor: 'background.paper',
                          flexDirection: 'column', // 恢复为列布局
                          alignItems: 'stretch',   // 恢复为拉伸对齐
                          p: 2
                        }}
                      >
                        {/* 恢复原始布局：评价人信息和时间在上面 */}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                          <Box>
                            <Typography variant="subtitle1">
                              评价人：{evaluation.evaluator_name || '匿名'}
                            </Typography>
                            {evaluation.additional_comments && (
                              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                补充说明：{evaluation.additional_comments}
                              </Typography>
                            )}
                          </Box>
                          <Typography variant="body2" color="text.secondary">
                            {new Date(evaluation.evaluation_time).toLocaleString()}
                          </Typography>
                        </Box>

                        {/* 恢复原始布局：总分和操作按钮在下面 */}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Typography variant="body2" component="span" color="text.secondary">总体评分：</Typography>
                            <Chip
                              label={evaluation.average_score ? Number(evaluation.average_score).toFixed(1) : '暂无'}
                              color={getTotalScoreColor(evaluation.average_score)}
                              size="small" sx={{ ml: 1 }}
                            />
                          </Box>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button startIcon={<VisibilityIcon />} size="small" onClick={() => handleViewDetailsClick(evaluation)}>查看详情</Button>
                            <Button startIcon={<EditIcon />} size="small" color="primary" onClick={() => navigate(`/user-evaluation/${userId}?edit=${evaluation.id}`)}>编辑</Button>
                            <Button startIcon={<DeleteIcon />} size="small" color="error" onClick={() => { setEvaluationToDelete(evaluation); setDeleteDialogOpen(true); }}>删除</Button>
                          </Box>
                        </Box>
                      </ListItem>
                    ))}
                </List>
              </>
            )}
            {/* 客户评价 */}
            {evaluationSummary.evaluations.filter(e => e.evaluation_type === 'client').length > 0 && (
              <>
                <Typography variant="h3" gutterBottom sx={{ mt: 3 }}>客户评价</Typography>
                <List>
                  {evaluationSummary.evaluations
                    .filter(e => e.evaluation_type === 'client')
                    .map(evaluation => (
                      <ListItem key={evaluation.id} sx={{ /* 恢复样式 */ }}>
                          {/* 恢复原始布局：评价人信息和时间在上面 */}
                         <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                             <Box>
                                <Typography variant="subtitle1">评价人：{evaluation.evaluator_name || '匿名客户'}{evaluation.evaluator_title}</Typography>
                                {evaluation.additional_comments && (
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>补充说明：{evaluation.additional_comments}</Typography>
                                )}
                            </Box>
                            <Typography variant="body2" color="text.secondary">{new Date(evaluation.evaluation_time).toLocaleString()}</Typography>
                         </Box>
                          {/* 恢复原始布局：总分和操作按钮在下面 */}
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                           <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                <Typography variant="body2" component="span" color="text.secondary">总体评分：</Typography>
                                <Chip
                                    label={evaluation.average_score ? Number(evaluation.average_score).toFixed(1) : '暂无'}
                                    color={getTotalScoreColor(evaluation.average_score)}
                                    size="small" sx={{ ml: 1 }}
                                />
                            </Box>
                           <Box sx={{ display: 'flex', gap: 1 }}>
                              <Button startIcon={<VisibilityIcon />} size="small" onClick={() => handleViewDetailsClick(evaluation)}>查看详情</Button>
                              <Button startIcon={<EditIcon />} size="small" color="primary" onClick={() => navigate(`/client-evaluation/${userId}?edit=${evaluation.id}`)}>编辑</Button>
                              <Button startIcon={<DeleteIcon />} size="small" color="error" onClick={() => { setEvaluationToDelete(evaluation); setDeleteDialogOpen(true); }}>删除</Button>
                           </Box>
                         </Box>
                      </ListItem>
                    ))}
                </List>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* 评价详情对话框 */}
      <Dialog
        open={detailDialogOpen}
        onClose={() => setDetailDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h2">评价详情</Typography>
            <Typography variant="body2" color="text.secondary">
              {selectedEvaluation && new Date(selectedEvaluation.evaluation_time).toLocaleString()}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedEvaluation && (
            <Box>
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle1" gutterBottom>
                  评价人：{selectedEvaluation.evaluator_name || (selectedEvaluation.evaluation_type === 'client' ? '匿名客户' : '匿名')} {selectedEvaluation.evaluator_title || ''}
                </Typography>
                <Chip
                  label={`总体评分：${selectedEvaluation.average_score ? Number(selectedEvaluation.average_score).toFixed(1) : '暂无'}`}
                  color={getTotalScoreColor(selectedEvaluation.average_score)}
                  sx={{ mt: 1 }}
                />
              </Box>

              <Divider sx={{ my: 2 }} />

              {loadingDetail ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
              ) : selectedEvaluation.hasDetailedData && selectedEvaluation.aspects ? (
                selectedEvaluation.aspects.map(aspect => (
                  <Box key={aspect.id || aspect.name} sx={{ mb: 4 }}>
                    <Typography variant="h3" gutterBottom>
                      {aspect.name}
                      {/* Aspect Chip */}
                      {aspect.average_score !== null && aspect.average_score !== undefined && !isNaN(Number(aspect.average_score)) ? (
                        <Chip
                          label={Number(aspect.average_score).toFixed(1)}
                          color={getScoreColor(Number(aspect.average_score))}
                          size="small" sx={{ ml: 2, fontWeight: 'bold' }}
                        />
                      ) : (
                        <Chip label="-" size="small" sx={{ ml: 2 }} />
                      )}
                    </Typography>
                    {/* 调用 renderDetailCategory */}
                    {aspect.categories?.map(category => renderDetailCategory(category))}
                  </Box>
                ))
              ) : !selectedEvaluation.hasDetailedData ? (
                 <Typography sx={{ p: 4, textAlign: 'center' }}>正在加载详细评价项...</Typography>
              ) : (
                <Typography sx={{ p: 4, textAlign: 'center' }}>无法加载详细评价项目。</Typography>
              )}

              {selectedEvaluation.additional_comments && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="h3" gutterBottom>补充说明</Typography>
                  <Typography variant="body1" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                    {selectedEvaluation.additional_comments}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailDialogOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            确定要删除这条由 "{evaluationToDelete?.evaluator_name || '匿名'}" 在 {evaluationToDelete?.evaluation_time ? new Date(evaluationToDelete.evaluation_time).toLocaleString() : ''} 进行的评价吗？此操作无法撤销。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button color="error" onClick={handleDeleteEvaluation}>删除</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default UserEvaluationSummary;