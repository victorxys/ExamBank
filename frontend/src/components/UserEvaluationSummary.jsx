import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Container,
  Paper,
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
import api from '../api/axios';
import { hasToken } from '../api/auth-utils';
import PageHeader from './PageHeader'

const UserEvaluationSummary = () => {
  const { userId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [evaluationSummary, setEvaluationSummary] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [selectedEvaluation, setSelectedEvaluation] = useState(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [evaluationToDelete, setEvaluationToDelete] = useState(null);
  const tokenData = hasToken();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 获取用户基本信息
        const userResponse = await api.get(`/users/${userId}/details`);
        setUserInfo(userResponse.data);

        // 获取评价汇总信息
        const summaryResponse = await api.get(`/users/${userId}/evaluations`);
        
        setEvaluationSummary(summaryResponse.data);
      } catch (error) {
        console.error('获取评价信息失败:', error);
        setError('获取评价信息失败: ' + (error.response?.data?.message || error.message));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [userId]);

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
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <PageHeader
        title="员工评价汇总"
        description="展示此员工的平均评价分数，同时可查看历史评价结果"
      />
      
      
      {/* 用户基本信息卡片 */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Typography variant="h2" gutterBottom>{userInfo?.username}</Typography>
              <Typography variant="body1" color="text.secondary">
                手机号码：{userInfo?.phone_number || '未设置'}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                角色：{userInfo?.role === 'admin' ? '管理员' : '普通用户'}
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <Box display="flex" justifyContent="flex-end" gap={2}>
                <Button
                  variant="contained"
                  color="primary"
                  component={Link}
                  to={`/user-evaluation/${userId}`}
                >
                  添加新评价
                </Button>
                <Button
                  variant="outlined"
                  color="primary"
                  onClick={() => {
                    if (!evaluationSummary || !userInfo) return;

                    // 生成markdown内容
                    let markdown = `# ${userInfo.username} 的评价汇总\n\n`;

                    // 添加用户基本信息
                    markdown += `## 基本信息\n\n`;
                    markdown += `- 用户名：${userInfo.username}\n`;
                    

                    // 添加评价汇总信息
                    evaluationSummary.aspects?.forEach(aspect => {
                      markdown += `## ${aspect.name}\n\n`;
                      markdown += `总体评分：${aspect.average_score?.toFixed(1) || '暂无'}\n\n`;

                      aspect.categories?.forEach(category => {
                        markdown += `### ${category.name}\n\n`;

                        category.items?.forEach(item => {
                          markdown += `#### ${item.name}\n`;
                          markdown += `- 平均得分：${item.average_score?.toFixed(1) || '暂无'}\n`;
                          if (item.description) {
                            markdown += `- 说明：${item.description}\n`;
                          }
                          markdown += '\n';
                        });
                      });
                    });

                    // 创建并下载文件
                    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `${userInfo.username}_评价汇总.md`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                  }}
                >
                  导出评价
                </Button>
                <Button
                  variant="outlined"
                  color="primary"
                  onClick={() => {
                    if (!evaluationSummary || !userInfo) return;

                    // 生成markdown内容
                    let markdown = `# ${userInfo.username} 的评价汇总\n\n`;

                    // 添加用户基本信息
                    markdown += `## 基本信息\n\n`;
                    markdown += `- 用户名：${userInfo.username}\n`;
                    

                    // 添加评价汇总信息
                    evaluationSummary.aspects?.forEach(aspect => {
                      markdown += `## ${aspect.name}\n\n`;
                      markdown += `总体评分：${aspect.average_score?.toFixed(1) || '暂无'}\n\n`;

                      aspect.categories?.forEach(category => {
                        markdown += `### ${category.name}\n\n`;

                        category.items?.forEach(item => {
                          markdown += `#### ${item.name}\n`;
                          markdown += `- 平均得分：${item.average_score?.toFixed(1) || '暂无'}\n`;
                          if (item.description) {
                            markdown += `- 说明：${item.description}\n`;
                          }
                          markdown += '\n';
                        });
                      });
                    });

                    // 复制到剪贴板
                    navigator.clipboard.writeText(markdown).then(() => {
                      alert('评价内容已复制到剪贴板');
                    }).catch(err => {
                      console.error('复制失败:', err);
                      alert('复制失败，请重试');
                    });
                  }}
                >
                  复制评价
                </Button>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* 评价汇总信息 */}
      {evaluationSummary?.aspects?.map(aspect => (
        <Card key={aspect.id} sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h2" gutterBottom textAlign="center">
              {aspect.name}
            </Typography>
            <Typography variant="h3" color="primary" textAlign="center" gutterBottom>
              平均得分：{aspect.average_score?.toFixed(1) || '暂无'}
            </Typography>
            
            <Divider sx={{ my: 2 }} />
            
            {aspect.categories?.map(category => (
              <Box key={category.id} sx={{ mb: 3 }}>
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
                          <Typography component="div" variant="body2" color="text.secondary">
                            <Typography component="div" variant="body2" color="text.secondary">
                              平均得分：
                              <Chip
                                label={`${item.average_score?.toFixed(1) || '暂无'}`}
                                color={item.average_score >= 80 ? 'success' : item.average_score >= 60 ? 'warning' : 'error'}
                                size="small"
                                sx={{ ml: 1 }}
                              />
                            </Typography>
                            {item.description && (
                              <Typography component="div" variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                {item.description}
                              </Typography>
                            )}
                          </Typography>
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

      {/* 评价历史记录 */}
      <Card>
        <CardContent>
          <Typography variant="h2" gutterBottom>评价历史</Typography>
          <List>
            {evaluationSummary?.evaluations?.map(evaluation => (
              <ListItem
                key={evaluation.id}
                sx={{
                  borderRadius: 1,
                  mb: 2,
                  backgroundColor: 'background.paper',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  p: 2
                }}
              >
                {/* 评价基本信息 */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="subtitle1">
                    评价人：{evaluation.evaluator_name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {new Date(evaluation.evaluation_time).toLocaleString()}
                  </Typography>
                </Box>

                {/* 总体评分 */}
                <Box sx={{ mb: 2 }}>                  
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>                    
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Typography variant="body2" component="span" color="text.secondary">
                        总体评分：
                      </Typography>
                      <Chip
                        label={`${evaluation.average_score?.toFixed(1) || '暂无'}`}
                        color={evaluation.average_score >= 80 ? 'success' : evaluation.average_score >= 60 ? 'warning' : 'error'}
                        size="small"
                        sx={{ ml: 1 }}
                      />
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        startIcon={<VisibilityIcon />}
                        size="small"
                        onClick={async () => {
                          try {
                            const response = await api.get(`/evaluation/${evaluation.id}`);
                            setSelectedEvaluation(response.data);
                            setDetailDialogOpen(true);
                          } catch (error) {
                            console.error('获取评价详情失败:', error);
                            // 可以添加错误提示
                          }
                        }}
                      >
                        查看详情
                      </Button>
                      <Button
                        startIcon={<EditIcon />}
                        size="small"
                        color="primary"
                        onClick={() => navigate(`/user-evaluation/${userId}?edit=${evaluation.id}`)}
                      >
                        编辑
                      </Button>
                      <Button
                        startIcon={<DeleteIcon />}
                        size="small"
                        color="error"
                        onClick={() => {
                          setEvaluationToDelete(evaluation);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        删除
                      </Button>
                    </Box>
                  </Box>
                </Box>

                {/* 评价详情 */}
                {evaluation.aspects?.map(aspect => (
                  <Box key={aspect.id} sx={{ mb: 2 }}>
                    <Typography variant="h3" gutterBottom>
                      {aspect.name}
                      <Chip
                        label={`${aspect.score?.toFixed(1) || '暂无'}`}
                        color={aspect.score >= 80 ? 'success' : aspect.score >= 60 ? 'warning' : 'error'}
                        size="small"
                        sx={{ ml: 2 }}
                      />
                    </Typography>

                    {aspect.categories?.map(category => (
                      <Box key={category.id} sx={{ ml: 2, mb: 2 }}>
                        <Typography variant="h4" gutterBottom>
                          {category.name}
                        </Typography>

                        <List dense>
                          {category.items?.filter(item => item.score !== null && item.score !== undefined).map(item => (
                            <ListItem
                              key={item.id}
                              sx={{
                                borderRadius: 1,
                                mb: 1,
                                backgroundColor: 'background.default',
                                py: 1
                              }}
                            >
                              <ListItemText
                                primary={
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="body1">{item.name}</Typography>
                                    <Chip
                                      label={`${item.score?.toFixed(1) || '暂无'}`}
                                      color={item.score >= 80 ? 'success' : item.score >= 60 ? 'warning' : 'error'}
                                      size="small"
                                    />
                                  </Box>
                                }
                                secondary={
                                  item.description && (
                                    <Typography variant="body2" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                                      {item.description}
                                    </Typography>
                                  )
                                }
                              />
                            </ListItem>
                          ))}
                        </List>
                      </Box>
                    ))}
                  </Box>
                ))}
              </ListItem>
            ))}
          </List>
        </CardContent>
      </Card>

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
                  评价人：{selectedEvaluation.evaluator_name}
                </Typography>
                <Chip
                  label={`总体评分：${selectedEvaluation.average_score?.toFixed(1) || '暂无'}`}
                  color={selectedEvaluation.average_score >= 80 ? 'success' : selectedEvaluation.average_score >= 60 ? 'warning' : 'error'}
                  sx={{ mt: 1 }}
                />
              </Box>
              
              <Divider sx={{ my: 2 }} />
              
              {selectedEvaluation.aspects?.map(aspect => (
                <Box key={aspect.id} sx={{ mb: 4 }}>
                  <Typography variant="h3" gutterBottom>
                    {aspect.name}
                    <Chip
                      label={`${aspect.score?.toFixed(1) || '暂无'}`}
                      color={aspect.score >= 80 ? 'success' : aspect.score >= 60 ? 'warning' : 'error'}
                      size="small"
                      sx={{ ml: 2 }}
                    />
                  </Typography>
                  
                  {aspect.categories?.map(category => (
                    <Box key={category.id} sx={{ ml: 2, mb: 3 }}>
                      <Typography variant="h4" gutterBottom>
                        {category.name}
                      </Typography>
                      
                      <List>
                        {category.items?.filter(item => item.score !== null && item.score !== undefined).map(item => (
                          <ListItem
                            key={item.id}
                            sx={{
                              borderRadius: 1,
                              mb: 1,
                              backgroundColor: 'background.default',
                            }}
                          >
                            <ListItemText
                              primary={item.name}
                              secondary={
                                <Box component="div" sx={{ mt: 1 }}>
                                  <Typography variant="body2" component="div" color="text.secondary">
                                    平均得分：
                                    <Chip
                                      label={`${item.score?.toFixed(1) || '暂无'}`}
                                      color={item.score >= 80 ? 'success' : item.score >= 60 ? 'warning' : 'error'}
                                      size="small"
                                    />
                                  </Typography>
                                  {item.description && (
                                    <Typography variant="body2" component="div" color="text.secondary" sx={{ mt: 0.5 }}>
                                      {item.description}
                                    </Typography>
                                  )}
                                </Box>
                              }
                            />
                          </ListItem>
                        ))}
                      </List>
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
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
            确定要删除这条评价记录吗？此操作无法撤销。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button
            color="error"
            onClick={async () => {
              try {
                await api.delete(`/evaluation/${evaluationToDelete.id}`);
                // 刷新评价列表
                const summaryResponse = await api.get(`/users/${userId}/evaluations`);
                setEvaluationSummary(summaryResponse.data);
                setDeleteDialogOpen(false);
              } catch (error) {
                console.error('删除评价失败:', error);
                alert('删除评价失败: ' + (error.response?.data?.message || error.message));
              }
            }}
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default UserEvaluationSummary;