import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Paper,
  Typography,
  Box,
  Grid,
  useTheme
} from '@mui/material';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import api from '../api/axios';

const KnowledgeReportDialog = ({ open, onClose, examId, isPublic }) => {
  const theme = useTheme();
  const [knowledgeReport, setKnowledgeReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const knowledge_point_summary_array = null;

  useEffect(() => {
  const fetchKnowledgeReport = async () => {
    if (!examId || !open) return;
    
    setLoading(true);
    setError(null);
    setKnowledgeReport(null); // 每次打开时重置

    try {
      const response = await api.get(`/user-exams/knowledge-point-summary/${examId}${isPublic ? '?public=true' : ''}`);
      
      const responseData = response.data;
      if (responseData && responseData.length > 0 && responseData[0].knowledge_point_summary) {
        let summaryData = responseData[0].knowledge_point_summary;

        // <<<--- 核心修正：健壮地处理数据 ---<<<
        if (typeof summaryData === 'string') {
          // 如果是字符串，尝试解析它。这处理了第一种错误情况。
          try {
            summaryData = JSON.parse(summaryData);
            // 再次检查，如果解析后还是字符串，说明是双重编码
            if (typeof summaryData === 'string') {
                summaryData = JSON.parse(summaryData);
            }
          } catch (e) {
            console.error("解析 knowledge_point_summary 字符串失败:", e);
            throw new Error("报告数据格式损坏，无法解析。");
          }
        }
        
        // 现在，summaryData 应该是一个对象或数组了
        if (Array.isArray(summaryData)) {
          setKnowledgeReport(summaryData);
        } else if (summaryData && Array.isArray(summaryData.knowledge_points)) {
          // 如果是对象，我们提取其中的数组
          setKnowledgeReport(summaryData.knowledge_points);
        } else {
          throw new Error("报告数据结构不符合预期。");
        }
        // --- 修正结束 ---

      } else {
        // 如果后端没有返回总结，可以显示一个提示
        setError("暂无知识点分析报告。");
      }
    } catch (err) {
      console.error('获取知识点报告失败', err);
      setError(err.response?.data?.error || '获取知识点报告失败');
    } finally {
      setLoading(false);
    }
  };

  fetchKnowledgeReport();
}, [examId, open, isPublic]);

  // 在弹窗关闭时清空 knowledgeReport
  useEffect(() => {
    if (!open) {
      setKnowledgeReport(null);
    }
  }, [open]);

  const handleViewExamDetail = async (examId) => {
    try {
        setLoadingExamDetail(true);
        const response = await api.get(`/user-exams/knowledge-point-summary/${examId}`);
        if (response.data && response.data.length > 0 && response.data[0].knowledge_point_summary) {
            let knowledge_point_summary_array = null; // 在try...catch外部声明
            try {
                knowledge_point_summary_array = JSON.parse(response.data[0].knowledge_point_summary);
            } catch (error) {
                console.error("解析 JSON 失败:", error);
            }
            if (knowledge_point_summary_array){ //确保成功解析JSON后，再赋值
                setKnowledgeReport(knowledge_point_summary_array);
            } else{
                setKnowledgeReport([]); //如果解析JSON失败，则设置为空数组
            }

        } else {
            setKnowledgeReport([]);
        }
        setExamDetailDialogOpen(true);
    } catch (error) {
        console.error('获取考试详情失败1111:', error);
        alert('获取考试详情失败，请稍后重试');
    } finally {
        setLoadingExamDetail(false);
    }
};

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '20px',
          bgcolor: 'white',
          boxShadow: '0 8px 16px rgba(38, 166, 154, 0.1)'
        }
      }}
    >
      <DialogTitle sx={{ color: '#263339', fontWeight: 600, fontSize: theme.typography.h3.fontSize }}>
        知识点掌握情况
      </DialogTitle>
      <DialogContent sx={{padding: 0, borderWidth: 0}}>
        {loading && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography>加载中...</Typography>
          </Box>
        )}

        {error && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="error">{error}</Typography>
          </Box>
        )}

        {knowledgeReport && (
          <Paper sx={{ p: 4, backgroundColor: theme.palette.background.paper, borderRadius: 2, boxShadow: theme.shadows[2]}}>
            <Typography variant="h3" sx={{ mb: 3, fontWeight: 600, color: theme.palette.primary.main, textAlign: 'center' }}>
              知识点掌握情况分析
            </Typography>
            <Box sx={{ height: 300, mb: 4 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={knowledgeReport}>
                  <PolarGrid stroke={theme.palette.divider} />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: theme.palette.text.primary }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: theme.palette.text.secondary }} />
                  <Radar
                    name="掌握程度"
                    dataKey="value"
                    stroke={theme.palette.primary.main}
                    fill={theme.palette.primary.main}
                    fillOpacity={0.2}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </Box>
            <Grid container spacing={2}>
              {knowledgeReport.sort((a, b) => b.value - a.value).map((item) => (
                <Grid item xs={12} sx={{ mb: 2 }} key={item.subject}>
                  <Paper elevation={1} sx={{ p: 3, height: '100%', backgroundColor: theme.palette.background.default, borderRadius: 2 }}>
                    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, mb: 2 }}>
                      <Typography variant="h3" sx={{ fontWeight: 600, color: theme.palette.text.primary, mb: { xs: 1, sm: 0 } }}>
                        {item.subject}
                      </Typography>
                      <Typography
                        variant="subtitle1"
                        sx={{
                          fontWeight: 500,
                          color: item.value >= 80 ? theme.palette.success.main :
                                  item.value >= 60 ? theme.palette.warning.main :
                                  theme.palette.error.main
                        }}
                      >
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
          </Paper>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="primary">
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default KnowledgeReportDialog;