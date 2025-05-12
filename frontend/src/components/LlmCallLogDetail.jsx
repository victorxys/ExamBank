// frontend/src/components/LlmCallLogDetail.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import {
  Box, Typography, Paper, CircularProgress,Chip, Button, Grid, Divider, Accordion, AccordionSummary, AccordionDetails
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon, ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { llmApi } from '../api/llm';
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';
import { useTheme } from '@mui/material/styles';
import ReactMarkdown from 'react-markdown'; // 用于渲染Markdown
import remarkGfm from 'remark-gfm';       // GFM插件

// 辅助函数：美化JSON输出
const JsonPrettyPrint = ({ data }) => {
  if (data === null || data === undefined) return <Typography variant="body2" color="text.secondary">无数据</Typography>;
  try {
    // 尝试解析，如果已经是对象则直接格式化
    const jsonData = typeof data === 'string' ? JSON.parse(data) : data;
    return <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', backgroundColor: '#f5f5f5', padding: '10px', borderRadius: '4px', fontSize: '0.8rem' }}>{JSON.stringify(jsonData, null, 2)}</pre>;
  } catch (e) {
    // 如果解析失败，可能已经是格式化好的字符串，或者就是普通字符串
    return <Typography variant="body2" sx={{whiteSpace: 'pre-wrap', wordBreak: 'break-all'}}>{typeof data === 'object' ? JSON.stringify(data) : String(data)}</Typography>;
  }
};


const LlmCallLogDetail = () => {
  const { logId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const [logDetail, setLogDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });

  const fetchLogDetail = useCallback(async () => {
    if (!logId) return;
    setLoading(true);
    try {
      const response = await llmApi.getCallLogDetail(logId);
      setLogDetail(response.data);
    } catch (error) {
      console.error("获取日志详情失败:", error);
      setAlert({ open: true, message: '获取日志详情失败: ' + (error.response?.data?.error || error.message), severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [logId]);

  useEffect(() => {
    fetchLogDetail();
  }, [fetchLogDetail]);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>;
  }

  if (!logDetail) {
    return (
      <Box>
        <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({...prev, open: false}))} />
        <Typography variant="h6" color="error" sx={{p:2}}>日志未找到或加载失败。</Typography>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ml:2}}>返回列表</Button>
      </Box>
    );
  }

  return (
    <Box>
      <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({...prev, open: false}))} />
      <PageHeader title={`LLM 调用日志详情 (ID: ${logId.substring(0,8)}...)`} description="查看单次 LLM 调用的完整信息。" />
      
      <Paper sx={{ p: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ mb: 2 }}>
          返回日志列表
        </Button>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}><Typography variant="body1"><strong>时间戳:</strong> {logDetail.timestamp ? new Date(logDetail.timestamp).toLocaleString() : '-'}</Typography></Grid>
          <Grid item xs={12} sm={6}><Typography variant="body1"><strong>函数名:</strong> {logDetail.function_name || '-'}</Typography></Grid>
          <Grid item xs={12} sm={6}><Typography variant="body1"><strong>模型名称:</strong> {logDetail.model_name || '-'}</Typography></Grid>
          <Grid item xs={12} sm={6}><Typography variant="body1"><strong>模型标识符:</strong> {logDetail.model_identifier || '-'}</Typography></Grid>
          <Grid item xs={12} sm={6}><Typography variant="body1"><strong>提示词名称:</strong> {logDetail.prompt_name || '-'}</Typography></Grid>
          <Grid item xs={12} sm={6}><Typography variant="body1"><strong>提示词版本:</strong> {logDetail.prompt_version || '-'}</Typography></Grid>
          <Grid item xs={12} sm={6}><Typography variant="body1"><strong>API Key 名称:</strong> {logDetail.api_key_name || '-'}</Typography></Grid>
          <Grid item xs={12} sm={6}><Typography variant="body1" component="div" ><strong>状态:</strong> 
            <Chip label={logDetail.status} color={logDetail.status === 'success' ? 'success' : 'error'} size="small" sx={{ ml: 1 }} />
            </Typography>
          </Grid>
          <Grid item xs={12} sm={6}><Typography variant="body1"><strong>耗时 (ms):</strong> {logDetail.duration_ms || '-'}</Typography></Grid>
          <Grid item xs={12} sm={6}><Typography variant="body1"><strong>触发用户:</strong> {logDetail.user_username || (logDetail.user_id ? `ID: ${logDetail.user_id.substring(0,8)}...` : '系统触发')}</Typography></Grid>
        </Grid>

        {logDetail.error_message && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6" color="error" gutterBottom>错误信息:</Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: theme.palette.error.dark, bgcolor: alpha(theme.palette.error.light, 0.1), p:1, borderRadius:1 }}>{logDetail.error_message}</Typography>
          </Box>
        )}

        <Accordion sx={{ mt: 3 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="h6">提示词模板内容</Typography>
          </AccordionSummary>
          <AccordionDetails>
            {logDetail.prompt_template ? (
                <Box sx={{ maxHeight: '400px', overflowY: 'auto', backgroundColor: '#f5f5f5', p: 2, borderRadius: 1, border: '1px solid #eee' }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{logDetail.prompt_template}</ReactMarkdown>
                </Box>
            ) : (
                <Typography variant="body2" color="text.secondary">无提示词模板内容。</Typography>
            )}
          </AccordionDetails>
        </Accordion>

        <Accordion sx={{ mt: 2 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="h6">输入数据 (Input Data)</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <JsonPrettyPrint data={logDetail.input_data} />
          </AccordionDetails>
        </Accordion>

        <Accordion sx={{ mt: 2 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="h6">原始输出数据 (Raw Output)</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <JsonPrettyPrint data={logDetail.output_data} />
          </AccordionDetails>
        </Accordion>

        <Accordion sx={{ mt: 2 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="h6">解析后输出数据 (Parsed Output)</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <JsonPrettyPrint data={logDetail.parsed_output_data} />
          </AccordionDetails>
        </Accordion>

      </Paper>
    </Box>
  );
};

export default LlmCallLogDetail;