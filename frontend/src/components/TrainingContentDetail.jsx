// frontend/src/components/TrainingContentDetail.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, CircularProgress, Chip,Grid,Card,CardHeader,CardContent,
  TableContainer, Table, TableHead, TableRow, TableCell, TableBody,Tooltip,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  List, ListItem, ListItemText, Divider, IconButton
} from '@mui/material';

import { 
    PlayArrow as PlayArrowIcon, 
    Download as DownloadIcon, 
    Refresh as RefreshIcon, 
    Edit as EditIcon, 
    SpeakerNotes as SpeakerNotesIcon, 
    TextFields as TextFieldsIcon, 
    Audiotrack as AudiotrackIcon,
    PlaylistPlay as PlaylistPlayIcon, 
    CloudUpload as CloudUploadIcon, 
    Article as ArticleIcon, 
    SendToMobile as SendToMobileIcon, 
    OndemandVideo as OndemandVideoIcon,
    StopCircleOutlined as StopCircleOutlinedIcon,
} from '@mui/icons-material';
import { ttsApi } from '../api/tts'; // 确保路径正确
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';
import { formatRelativeTime } from '../api/dateUtils';
import { API_BASE_URL } from '../config'; // 引入 API_BASE_URL


const TrainingContentDetail = () => {
  const { contentId } = useParams();
  const navigate = useNavigate();
  const [contentDetail, setContentDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState({}); // 用于跟踪不同按钮的加载状态
  const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
  const [showFullOriginal, setShowFullOriginal] = useState(false);
  const [showFullScript, setShowFullScript] = useState({ id: null, content: '' });
  const [errorStateForDisplay, setErrorStateForDisplay] = useState(null);
  const [playingAudio, setPlayingAudio] = useState(null); // { sentenceId: string, audioUrl: string } | null
  const audioRef = useRef(null); // 用于控制 HTMLAudioElement
  const [pollingIntervals, setPollingIntervals] = useState({}); // 存储轮询的interval ID
  const pollingIntervalsRef = useRef({}); // 改用 useRef 来存储 intervals，避免因 state 更新导致不必要的依赖变化

  const fetchContentDetail = useCallback(async (showLoadingIndicator = true) => {
    if (!contentId) return;
    if (showLoadingIndicator) setLoading(true);
    
    setErrorStateForDisplay(null); // 清除上一次的错误信息
    setAlert({ open: false, message: '', severity: 'info' }); // 清除上一次的 alert

    try {
      const response = await ttsApi.getTrainingContentDetail(contentId);
      setContentDetail(response.data);
    } catch (err) { // 将捕获的错误对象命名为 'err'
      console.error("获取培训内容详情失败:", err); 
      
      // 从 'err' 对象中提取错误信息
      const extractedErrorMessage = err.response?.data?.error || err.message || '获取详情失败，请稍后重试';
      
      // 更新 alert state 以显示错误消息给用户
      setAlert({ 
        open: true, 
        message: '获取详情失败: ' + extractedErrorMessage, 
        severity: 'error' 
      });
      
      // 更新 errorStateForDisplay state，用于条件渲染错误UI
      setErrorStateForDisplay(extractedErrorMessage); 
    } finally {
      if (showLoadingIndicator) setLoading(false);
    }
  }, [contentId]); // 依赖项是 contentId
  useEffect(() => {
    fetchContentDetail();
    // 组件卸载时清除所有轮询
    return () => {
        Object.values(pollingIntervalsRef.current).forEach(clearInterval);
        pollingIntervalsRef.current = {};
    };
  }, [fetchContentDetail]);

  const stopPollingForTask = (taskId) => {
    if (pollingIntervalsRef.current[taskId]) {
      clearInterval(pollingIntervalsRef.current[taskId]);
      const newIntervals = { ...pollingIntervalsRef.current };
      delete newIntervals[taskId];
      pollingIntervalsRef.current = newIntervals;
      console.log(`Polling stopped for task ${taskId}`);
    }
  };
  const handleAction = async (actionType, scriptId = null) => {
    setActionLoading(prev => ({ ...prev, [actionType]: true }));
    setAlert({ open: false, message: '', severity: 'info' });
    try {
      let response;
      let successMessage = '';
      switch (actionType) {
        case 'generateOralScript':
          response = await ttsApi.generateOralScript(contentId);
          successMessage = response.data.message || '口播稿生成任务已启动。';
          break;
        case 'triggerTtsRefine':
          if (!scriptId) throw new Error("需要口播稿ID来优化");
          response = await ttsApi.triggerTtsRefine(scriptId);
          successMessage = response.data.message || 'TTS Refine 任务已启动。';
          break;
        case 'triggerLlmRefine':
          if (!scriptId) throw new Error("需要TTS Refine稿ID来进行LLM润色");
          response = await ttsApi.triggerLlmRefine(scriptId);
          successMessage = response.data.message || 'LLM最终修订任务已启动。';
          break;
        case 'splitSentences':
          if (!scriptId) throw new Error("需要最终脚本ID来拆分句子");
          response = await ttsApi.splitSentences(scriptId);
          successMessage = response.data.message || '句子拆分任务已启动。';
          break;
        default:
          throw new Error("未知的操作类型");
      }
      setAlert({ open: true, message: successMessage, severity: 'success' });
      // 短暂延迟后刷新数据，给后端一点处理时间（如果是异步任务，这里可能需要轮询或WebSocket）
      setTimeout(() => fetchContentDetail(false), 2000); 
    } catch (error) {
      console.error(`操作 ${actionType} 失败:`, error);
      setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
    } finally {
      setActionLoading(prev => ({ ...prev, [actionType]: false }));
    }
  };
  
  const getActionButton = (contentStatus, scripts) => {
    const oralScript = scripts?.find(s => s.script_type === 'oral_script');
    const ttsRefinedScript = scripts?.find(s => s.script_type === 'tts_refined_script');
    const finalTtsScript = scripts?.find(s => s.script_type === 'final_tts_script');

    switch (contentStatus) {
      case 'pending_oral_script':
        return <Button variant="contained" onClick={() => handleAction('generateOralScript')} disabled={actionLoading['generateOralScript']}> {actionLoading['generateOralScript'] ? <CircularProgress size={24}/> : '1. 生成口播稿'} </Button>;
      case 'pending_tts_refine':
        if (oralScript) {
          return <Button variant="contained" onClick={() => handleAction('triggerTtsRefine', oralScript.id)} disabled={actionLoading['triggerTtsRefine']}> {actionLoading['triggerTtsRefine'] ? <CircularProgress size={24}/> : '2. TTS Refine优化'} </Button>;
        }
        return <Typography color="textSecondary">等待口播稿...</Typography>;
      case 'pending_llm_final_refine':
        if (ttsRefinedScript) {
          return <Button variant="contained" onClick={() => handleAction('triggerLlmRefine', ttsRefinedScript.id)} disabled={actionLoading['triggerLlmRefine']}> {actionLoading['triggerLlmRefine'] ? <CircularProgress size={24}/> : '3. LLM最终修订'} </Button>;
        }
        return <Typography color="textSecondary">等待TTS Refine稿...</Typography>;
      case 'pending_sentence_split':
        if (finalTtsScript) {
          return <Button variant="contained" onClick={() => handleAction('splitSentences', finalTtsScript.id)} disabled={actionLoading['splitSentences']}> {actionLoading['splitSentences'] ? <CircularProgress size={24}/> : '4. 拆分句子'} </Button>;
        }
        return <Typography color="textSecondary">等待最终脚本...</Typography>;
      case 'pending_audio_generation':
        return <Typography color="textSecondary">等待语音生成...</Typography>; // 后续添加批量生成按钮
      case 'completed':
        return <Chip label="处理完成" color="success" />;
      default:
        return <Typography color="textSecondary">状态未知: {contentStatus}</Typography>;
    }
  };

  const handleViewFullScript = async (scriptId) => {
    try {
      const response = await ttsApi.getScriptContent(scriptId);
      setShowFullScript({ id: scriptId, content: response.data.content });
    } catch (error) {
      setAlert({ open: true, message: '获取脚本内容失败', severity: 'error' });
    }
  };
   // 确保在 handlePlayAudio 中也使用 API_BASE_URL
   const handlePlayAudio = (sentenceId, audioUrl) => {
    if (!audioUrl) {
      setAlert({ open: true, message: '该句子还没有可播放的语音。', severity: 'warning' });
      return;
    }
    
    let fullAudioUrl;
    if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
        fullAudioUrl = audioUrl;
    } else {
        // 假设 audioUrl 是类似 'training_content_id/sentence_id/file.wav' 的相对路径
        // 并且 API_BASE_URL 是 'http://127.0.0.1:5000/api'
        // 我们需要媒体服务路径，例如 'http://127.0.0.1:5000/media/tts_audio/'
        const mediaBase = API_BASE_URL.replace('/api', ''); // -> 'http://127.0.0.1:5000'
        fullAudioUrl = `${mediaBase}/media/tts_audio/${audioUrl}`;
    }

    console.log("Attempting to play audio from URL:", fullAudioUrl);

    if (playingAudio && playingAudio.sentenceId === sentenceId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setPlayingAudio(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const newAudio = new Audio(fullAudioUrl);
      audioRef.current = newAudio;
      newAudio.play()
        .then(() => setPlayingAudio({ sentenceId, audioUrl: fullAudioUrl }))
        .catch(err => {
          console.error("播放音频失败:", err);
          setAlert({ open: true, message: `播放音频失败: ${err.message || '无法加载音频资源。请检查URL和网络连接。'}`, severity: 'error' });
          setPlayingAudio(null);
        });
      newAudio.onended = () => {
        setPlayingAudio(null);
      };
      newAudio.onerror = (e) => {
        console.error("音频播放器错误:", e);
        setAlert({ open: true, message: `无法播放音频: ${e.target.error?.message || '未知播放错误，请检查控制台获取详细信息。'}`, severity: 'error' });
        setPlayingAudio(null);
      };
    }
  };

  // 停止所有轮询
  const stopAllPolling = () => {
    Object.values(pollingIntervals).forEach(clearInterval);
    setPollingIntervals({});
  };
  useEffect(() => {
    return () => { // 组件卸载时清除所有轮询
      stopAllPolling();
    };
  }, []); // 空依赖数组，只在挂载和卸载时运行

  const pollTaskStatus = useCallback((taskId, sentenceIdToUpdate = null) => {
    // 如果这个 taskId 已经有一个正在运行的 interval，先清除它
    stopPollingForTask(taskId);

    console.log(`Starting polling for task ${taskId}, sentence: ${sentenceIdToUpdate}`);
    const intervalId = setInterval(async () => {
      console.log(`Polling status for task ${taskId}...`);
      try {
        const response = await ttsApi.getTaskStatus(taskId);
        const task = response.data;

        // 更新特定句子的状态（如果提供了 sentenceIdToUpdate）
        if (sentenceIdToUpdate && contentDetail) {
            setContentDetail(prev => {
                if (!prev) return prev; // 如果 prev 是 null，直接返回
                return {
                    ...prev,
                    final_script_sentences: prev.final_script_sentences?.map(s =>
                        s.id === sentenceIdToUpdate ? { ...s, audio_status: task.status === 'PENDING' || task.status === 'STARTED' || task.status === 'PROGRESS' ? 'generating' : (task.status === 'SUCCESS' && task.result?.status === 'Success' ? 'generated' : (task.status === 'FAILURE' || (task.status === 'SUCCESS' && task.result?.status === 'Error')) ? 'error_generation' : s.audio_status) } : s
                    ) || []
                }
            });
        }


        if (task.status === 'SUCCESS' || task.status === 'FAILURE') {
          stopPollingForTask(taskId); // 清除 interval

          if (task.status === 'SUCCESS') {
            // 检查任务内部是否也成功
            if (task.result && task.result.status === 'Success') {
              setAlert({ open: true, message: `任务 ${taskId.substring(0, 6)}... 处理成功! 音频ID: ${task.result.audio_id}`, severity: 'success' });
              // 任务成功后，强制刷新整个内容详情，以获取最新的音频URL等信息
              fetchContentDetail(false); 
            } else {
              // Celery 任务成功，但业务逻辑失败
              setAlert({ open: true, message: `任务 ${taskId.substring(0, 6)}... 处理完成但出现内部错误: ${task.result?.message || task.error || '未知业务错误'}`, severity: 'error' });
              // 即使业务失败，如果提供了 sentenceIdToUpdate，上面的 setContentDetail 已经将其状态标记为 error_generation
            }
          } else { // task.status === 'FAILURE'
            setAlert({ open: true, message: `任务 ${taskId.substring(0, 6)}... 处理失败: ${task.error_message || '未知错误'}`, severity: 'error' });
            // 失败时，上面的 setContentDetail 已更新句子状态为 error_generation
          }
        }
        // 如果是 PENDING, STARTED, PROGRESS，则继续轮询 (不需要做额外操作，setInterval 会继续)
      } catch (error) {
        console.error(`轮询任务 ${taskId} 状态失败:`, error);
        setAlert({ open: true, message: `轮询任务状态时出错: ${error.message}`, severity: 'error' });
        stopPollingForTask(taskId); // 出错也停止轮询，避免无限循环
        if (sentenceIdToUpdate && contentDetail) {
            setContentDetail(prev => ({
                ...prev,
                final_script_sentences: prev.final_script_sentences.map(s => 
                    s.id === sentenceIdToUpdate ? { ...s, audio_status: 'error_polling' } : s // 新增一个轮询错误状态
                )
            }));
        }
      }
    }, 3000); // 每3秒轮询一次

    pollingIntervalsRef.current = { ...pollingIntervalsRef.current, [taskId]: intervalId };

  }, [fetchContentDetail, contentDetail]); // 移除 pollingIntervals，使用 pollingIntervalsRef.current

  const handleGenerateSentenceAudio = async (sentenceId) => {
    setActionLoading(prev => ({ ...prev, [`sentence_${sentenceId}`]: true }));
    setAlert({ open: false, message: '', severity: 'info' });
    try {
      // 先将前端状态乐观更新为 "请求中"
      if (contentDetail) {
        setContentDetail(prev => ({
            ...prev,
            final_script_sentences: prev.final_script_sentences.map(s => 
                s.id === sentenceId ? { ...s, audio_status: 'processing_request' } : s
            )
        }));
      }

      const response = await ttsApi.generateSentenceAudio(sentenceId, {}); // 第二个参数是可选的tts_engine_params
      setAlert({ open: true, message: response.data.message || '单句语音生成任务已提交。', severity: 'info' });
      if (response.data.task_id) {
        pollTaskStatus(response.data.task_id, sentenceId); // 开始轮询
      }
    } catch (error) {
      console.error(`生成句子 ${sentenceId} 语音失败:`, error);
      setAlert({ open: true, message: `生成语音失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
      if (contentDetail) { // 失败时也更新状态
        setContentDetail(prev => ({
            ...prev,
            final_script_sentences: prev.final_script_sentences.map(s => 
                s.id === sentenceId ? { ...s, audio_status: 'error_submission' } : s
            )
        }));
      }
    } finally {
      setActionLoading(prev => ({ ...prev, [`sentence_${sentenceId}`]: false }));
    }
  };

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>;
  }
  // ******** 正确的修改在这里 ********
  if (errorStateForDisplay || (!loading && !contentDetail)) { 
    return (
      <AlertMessage 
        open={true} 
        message={errorStateForDisplay || "内容未找到或数据加载不完整"} // 使用 errorStateForDisplay
        severity="error" 
        onClose={() => setErrorStateForDisplay(null)} // 清除这个 state
      />
    );
  }
  // **********************************

  return (
    <Box>
      <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({ ...prev, open: false }))} />
      <PageHeader 
        title={`培训内容: ${contentDetail.content_name}`}
        description={`状态: ${contentDetail.status || '未知'}`} 
      />

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>操作流程</Typography>
        <Box sx={{display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap'}}>
            {getActionButton(contentDetail.status, contentDetail.scripts)}
        </Box>
         {/* 如果有最终脚本，且状态不是等待拆分，则可以允许重新触发拆分 */}
        {contentDetail.status !== 'pending_sentence_split' && contentDetail.scripts?.find(s => s.script_type === 'final_tts_script') && (
             <Button 
                variant="outlined" 
                onClick={() => handleAction('splitSentences', contentDetail.scripts.find(s => s.script_type === 'final_tts_script').id)} 
                disabled={actionLoading['splitSentences']}
                size="small"
                sx={{ml: 2, mt: {xs: 1, sm: 0} }}
             >
                {actionLoading['splitSentences'] ? <CircularProgress size={20}/> : '重新拆分句子'}
             </Button>
        )}
      </Paper>

      <Grid container spacing={3}>
        {/* 原始文本 */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="原始培训内容" />
            <CardContent>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto', mb:1 }}>
                {contentDetail.original_content_preview}
              </Typography>
              <Button size="small" onClick={() => setShowFullOriginal(true)}>查看完整原文</Button>
            </CardContent>
          </Card>
        </Grid>

        {/* 脚本列表 */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="处理脚本" />
            <CardContent>
              {contentDetail.scripts && contentDetail.scripts.length > 0 ? (
                <List dense>
                  {contentDetail.scripts.map(script => (
                    <ListItem key={script.id} disablePadding sx={{mb:1, border: '1px solid #eee', borderRadius:1, p:1}}>
                      <ListItemText 
                        primary={`${script.script_type} (v${script.version})`}
                        secondary={
                          <Typography variant="caption" color="textSecondary" component="div">
                            创建于: {formatRelativeTime(script.created_at)} <br/>
                            预览: {script.content_preview}
                          </Typography>
                        }
                      />
                      <Button size="small" onClick={() => handleViewFullScript(script.id)}>查看完整脚本</Button>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography>暂无处理脚本。</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* 句子列表 (如果已拆分) */}
        {contentDetail.final_script_sentences && contentDetail.final_script_sentences.length > 0 && (
          <Grid item xs={12}>
            <Card>
              <CardHeader title="最终TTS脚本句子列表" />
              <CardContent>
                <TableContainer component={Paper} elevation={0}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{width: '5%'}}>序号</TableCell>
                        <TableCell>句子文本</TableCell>
                        <TableCell sx={{width: '15%'}}>语音状态</TableCell>
                        <TableCell sx={{width: '15%'}}>操作</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {contentDetail.final_script_sentences.map(sentence => (
                        <TableRow key={sentence.id}>
                          <TableCell>{sentence.order_index + 1}</TableCell>
                          <TableCell>{sentence.text}</TableCell>
                          <TableCell>
                            <Chip 
                              label={sentence.audio_status || '未知'} 
                              size="small" 
                              color={sentence.audio_status === 'generated' ? 'success' : 'default'}
                            />
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                              {sentence.audio_status === 'generated' && sentence.latest_audio_url && (
                                <IconButton 
                                  size="small" 
                                  onClick={() => handlePlayAudio(sentence.id, sentence.latest_audio_url)}
                                  color={playingAudio && playingAudio.sentenceId === sentence.id ? "error" : "primary"}
                                  title={playingAudio && playingAudio.sentenceId === sentence.id ? "停止" : "播放"}
                                >
                                  {/* 正确显示播放/停止图标 */}
                                  {playingAudio && playingAudio.sentenceId === sentence.id ? <StopCircleOutlinedIcon /> : <PlayArrowIcon />}
                                </IconButton>
                              )}
                              {/* 下载按钮 */}
                              {sentence.audio_status === 'generated' && sentence.latest_audio_url && (
                                <IconButton
                                  size="small"
                                  href={sentence.latest_audio_url.startsWith('http') ? sentence.latest_audio_url : `${API_BASE_URL.replace('/api', '')}/media/tts_audio/${sentence.latest_audio_url}`}
                                  download={`sentence_${sentence.order_index + 1}.wav`} //  您可以自定义下载的文件名
                                  title="下载"
                                  color="primary"
                                >
                                  <DownloadIcon />
                                </IconButton>
                              )}
                              {(sentence.audio_status === 'pending_generation' || sentence.audio_status === 'error_generation' || sentence.audio_status === 'pending_regeneration' || sentence.audio_status === 'error_submission' || sentence.audio_status === 'error_polling') && (
                                <Button 
                                  size="small" 
                                  variant="outlined" 
                                  onClick={() => handleGenerateSentenceAudio(sentence.id)} 
                                  disabled={actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating'}
                                  startIcon={(actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating') ? <CircularProgress size={16} /> : <AudiotrackIcon />}
                                >
                                  {sentence.audio_status?.startsWith('error') ? '重试生成' : '生成语音'}
                                </Button>
                              )}
                              {/* {sentence.audio_status === 'generated' && (
                              <Button 
                                    size="small" 
                                    variant="text" 
                                    color="secondary"
                                    onClick={() => handleGenerateSentenceAudio(sentence.id)}
                                    disabled={actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating'}
                                    startIcon={(actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating') ? <CircularProgress size={16} /> : <RefreshIcon />}
                                    sx={{ml:1}}
                                    title="重新生成"
                                  >
                                    重新生成
                                  </Button>
                              )} */}
                               {/* 重新生成按钮 (改为 IconButton) */}
                               {sentence.audio_status === 'generated' && (
                                <Tooltip title="重新生成语音">
                                  <span> {/* Tooltip 需要一个可以接受 ref 的子元素，IconButton 可以，但如果 disabled 了就不行，所以用 span 包裹 */}
                                    <IconButton
                                      size="small"
                                    //   color="secondary" // 或者 "primary" 如果 secondary 颜色不明显
                                      onClick={() => handleGenerateSentenceAudio(sentence.id)}
                                      disabled={actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating'}
                                      sx={{ml:0.5}} // 调整间距
                                    >
                                      {(actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating') ? <CircularProgress size={20} color="inherit"/> : <RefreshIcon />}
                                    </IconButton>
                                  </span>
                                </Tooltip>
                               )}
                               {sentence.audio_status === 'generating' && <CircularProgress size={20} sx={{ml:1}} />}
                               {sentence.audio_status === 'processing_request' && <Typography variant="caption" sx={{ml:1, color: 'text.secondary'}}>请求中...</Typography>}
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      {/* 查看完整原文对话框 */}
      <Dialog open={showFullOriginal} onClose={() => setShowFullOriginal(false)} maxWidth="md" fullWidth>
        <DialogTitle>完整原始培训内容</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{contentDetail.original_content}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowFullOriginal(false)}>关闭</Button>
        </DialogActions>
      </Dialog>

      {/* 查看完整脚本对话框 */}
      <Dialog open={Boolean(showFullScript.id)} onClose={() => setShowFullScript({id: null, content: ''})} maxWidth="md" fullWidth>
        <DialogTitle>完整脚本内容</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{showFullScript.content}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowFullScript({id: null, content: ''})}>关闭</Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
};

export default TrainingContentDetail;