// frontend/src/components/TrainingContentDetail.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'; // 引入 useMemo
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, CircularProgress, Chip, Grid, Card, CardHeader, CardContent,
  TableContainer, Table, TableHead, TableRow, TableCell, TableBody, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  List, ListItem, ListItemText, Divider, IconButton, TextField // 确保 TextField 已导入
} from '@mui/material';
import TablePagination from '@mui/material/TablePagination'; // 导入 TablePagination
import LinearProgress from '@mui/material/LinearProgress'; // 确保导入 LinearProgress

import { 
    PlayArrow as PlayArrowIcon, 
    Download as DownloadIcon, 
    Refresh as RefreshIcon, 
    Edit as EditIcon, 
    SpeakerNotes as SpeakerNotesIcon, 
    // TextFields as TextFieldsIcon, // 如果不再单独使用，可以注释
    Audiotrack as AudiotrackIcon, 
    PlaylistPlay as PlaylistPlayIcon, // 如果不再单独使用，可以注释
    CloudUpload as CloudUploadIcon, // 如果不再单独使用，可以注释
    Article as ArticleIcon, 
    // SendToMobile as SendToMobileIcon, // 如果不再单独使用，可以注释
    // OndemandVideo as OndemandVideoIcon, // 如果不再单独使用，可以注释
    StopCircleOutlined as StopCircleOutlinedIcon,
    CheckCircle as CheckCircleIcon,
    HourglassEmpty as HourglassEmptyIcon,
    Error as ErrorIcon,
    RadioButtonUnchecked as RadioButtonUncheckedIcon,
    KeyboardArrowRight as KeyboardArrowRightIcon,
    Search as SearchIcon, // 引入搜索图标
} from '@mui/icons-material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack'; // 正确的方式
import { ttsApi } from '../api/tts';
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';
import { formatRelativeTime } from '../api/dateUtils';
import { API_BASE_URL } from '../config';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// 子组件：用于渲染句子列表和分页
const SentenceList = ({ sentences, playingAudio, actionLoading, onPlayAudio, onGenerateAudio,onUpdateSentenceText }) => {
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(50); // 每页默认50句
    const [searchTerm, setSearchTerm] = useState('');

    // 使用 useMemo 优化过滤逻辑，仅在 sentences 或 searchTerm 变化时重新计算
    const filteredSentences = useMemo(() => {
        if (!searchTerm) return sentences;
        return sentences.filter(sentence =>
            sentence.text.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [sentences, searchTerm]);

    const handleChangePage = (event, newPage) => {
        setPage(newPage);
    };

    // --- 新增编辑句子相关的状态 ---
    const [editSentenceDialogOpen, setEditSentenceDialogOpen] = useState(false);
    const [sentenceToEdit, setSentenceToEdit] = useState(null); // 存储 { id: string, text: string, order_index: number }
    const [editingSentenceText, setEditingSentenceText] = useState('');
    // ---------------------------------

    const handleChangeRowsPerPage = (event) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0); // 更改每页行数时，回到第一页
    };

    // 使用 useMemo 优化分页逻辑
    const paginatedSentences = useMemo(() => {
        return filteredSentences.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
    }, [filteredSentences, page, rowsPerPage]);
    
    // --- 编辑句子处理函数 ---
    const handleOpenEditSentenceDialog = (sentence) => {
        setSentenceToEdit(sentence);
        setEditingSentenceText(sentence.text);
        setEditSentenceDialogOpen(true);
    };

    const handleCloseEditSentenceDialog = () => {
        setEditSentenceDialogOpen(false);
        setSentenceToEdit(null);
        setEditingSentenceText('');
    };
    const handleSaveEditedSentence = async () => {
        if (!sentenceToEdit || !editingSentenceText.trim()) {
            // 可以在这里触发一个 alert
            alert("句子内容不能为空！");
            return;
        }
        // 确保 onUpdateSentenceText 是一个函数再调用
        if (typeof onUpdateSentenceText === 'function') {
            onUpdateSentenceText(sentenceToEdit.id, editingSentenceText.trim()); // <--- 通过 props 调用
        } else {
            console.error("onUpdateSentenceText prop is not a function or not provided!");
        }
        handleCloseEditSentenceDialog(); // 这个函数应该在 SentenceList 内部定义
    };
    // --------------------------

    return (
        <> {/* 使用 Fragment 包裹，因为 Dialog 需要在 Card 外部 */}
        <Card>
            <CardHeader
                title="最终TTS脚本句子列表"
                action={
                    <TextField
                        size="small"
                        variant="outlined"
                        placeholder="搜索句子..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
                            ),
                        }}
                        sx={{ width: { xs: '100%', sm: 300 } }}
                    />
                }
            />
            {/* 移除 CardHeader 和 CardContent 之间的额外上边距 */}
            <CardContent sx={{pt: 0}}> 
                <TableContainer component={Paper} elevation={0}>
                    <Table size="small" stickyHeader> 
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ width: '5%', fontWeight: 'bold' }}>序号</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>句子文本</TableCell>
                                <TableCell sx={{ width: '15%', fontWeight: 'bold' }}>语音状态</TableCell>
                                <TableCell sx={{ width: '25%', fontWeight: 'bold', textAlign:'center' }}>操作</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {paginatedSentences.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} align="center">
                                        <Typography color="textSecondary" sx={{p:2}}>
                                            {searchTerm ? '未找到匹配的句子' : '暂无句子，请先拆分脚本。'}
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                paginatedSentences.map(sentence => (
                                    <TableRow key={sentence.id} hover>
                                        <TableCell>{sentence.order_index + 1}</TableCell>
                                        <TableCell>{sentence.text}</TableCell>
                                        <TableCell>
                                            <Chip
                                                label={sentence.audio_status || '未知'}
                                                size="small"
                                                color={sentence.audio_status === 'generated' ? 'success' : (sentence.audio_status === 'generating' || sentence.audio_status === 'processing_request' ? 'info' : (sentence.audio_status?.startsWith('error') ? 'error' : 'default'))}
                                            />
                                        </TableCell>
                                        <TableCell align="right"> {/* 操作按钮靠右 */}
                                            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', justifyContent: 'flex-end' }}>
                                                {/* 编辑按钮 */}
                                                <Tooltip title="编辑句子">
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => handleOpenEditSentenceDialog(sentence)}
                                                            color="default" // 或者 "action"
                                                        >
                                                            <EditIcon fontSize="small"/>
                                                        </IconButton>
                                                </Tooltip>
                                                {sentence.audio_status === 'generated' && sentence.latest_audio_url && (
                                                    <Tooltip title={playingAudio && playingAudio.sentenceId === sentence.id ? "停止" : "播放"}>
                                                      <IconButton
                                                        size="small"
                                                        onClick={() => onPlayAudio(sentence.id, sentence.latest_audio_url)}
                                                        color={playingAudio && playingAudio.sentenceId === sentence.id ? "error" : "primary"}
                                                      >
                                                        {playingAudio && playingAudio.sentenceId === sentence.id ? <StopCircleOutlinedIcon /> : <PlayArrowIcon />}
                                                      </IconButton>
                                                    </Tooltip>
                                                )}
                                                {sentence.audio_status === 'generated' && sentence.latest_audio_url && (
                                                   <Tooltip title="下载">
                                                      <IconButton
                                                        size="small"
                                                        href={sentence.latest_audio_url.startsWith('http') ? sentence.latest_audio_url : `${API_BASE_URL.replace('/api', '')}/media/tts_audio/${sentence.latest_audio_url}`}
                                                        download={`sentence_${sentence.order_index + 1}.wav`} //  您可以自定义下载的文件名
                                                        color="primary"
                                                      >
                                                        <DownloadIcon />
                                                      </IconButton>
                                                   </Tooltip>
                                                )}
                                                {(sentence.audio_status === 'pending_generation' || sentence.audio_status === 'error_generation' || sentence.audio_status === 'pending_regeneration' || sentence.audio_status === 'error_submission' || sentence.audio_status === 'error_polling') && (
                                                    <Button
                                                        size="small"
                                                        variant="outlined"
                                                        onClick={() => onGenerateAudio(sentence.id)}
                                                        disabled={actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating'}
                                                        startIcon={(actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating') ? <CircularProgress size={16} /> : <AudiotrackIcon />}
                                                    >
                                                        {sentence.audio_status?.startsWith('error') ? '重试' : '生成'}
                                                    </Button>
                                                )}
                                                {sentence.audio_status === 'generated' && (
                                                    <Tooltip title="重新生成语音">
                                                      <span> {/* Tooltip 需要一个可以接受 ref 的子元素，IconButton 可以，但如果 disabled 了就不行，所以用 span 包裹 */}
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => onGenerateAudio(sentence.id)}
                                                            disabled={actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating'}
                                                            sx={{ml:0.5}} // 调整间距
                                                        >
                                                            {(actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating') ? <CircularProgress size={20} color="inherit"/> : <RefreshIcon />}
                                                        </IconButton>
                                                      </span>
                                                    </Tooltip>
                                                )}
                                                {(sentence.audio_status === 'generating' || sentence.audio_status === 'processing_request') && <CircularProgress size={20} sx={{ml:1}} />}
                                            </Box>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
                {filteredSentences.length > 0 && (
                    <TablePagination
                        component="div"
                        count={filteredSentences.length} // 总数应该是过滤后的句子数量
                        page={page}
                        onPageChange={handleChangePage}
                        rowsPerPage={rowsPerPage}
                        onRowsPerPageChange={handleChangeRowsPerPage}
                        rowsPerPageOptions={[10, 25, 50, 100, 200]} // 可以增加更多选项
                        labelRowsPerPage="每页句数:"
                        labelDisplayedRows={({ from, to, count }) => `${from}-${to} 共 ${count}`}
                        // sx={{ '.MuiTablePagination-toolbar': { justifyContent: 'flex-start' } }} // 可选：让分页控件靠左
                    />
                )}
            </CardContent>
        </Card>
        {/* 编辑句子对话框 */}
            <Dialog open={editSentenceDialogOpen} onClose={handleCloseEditSentenceDialog} maxWidth="sm" fullWidth>
                <DialogTitle>编辑句子 (序号: {sentenceToEdit?.order_index != null ? sentenceToEdit.order_index + 1 : ''})</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        margin="dense"
                        label="句子内容"
                        type="text"
                        fullWidth
                        multiline
                        rows={4} // 增加行数以便编辑较长句子
                        value={editingSentenceText}
                        onChange={(e) => setEditingSentenceText(e.target.value)}
                        sx={{ mt: 1 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseEditSentenceDialog}>取消</Button>
                    <Button onClick={handleSaveEditedSentence} variant="contained">保存更改</Button>
                </DialogActions>
            </Dialog>
        </>
    );
};


const TrainingContentDetail = () => {
  const { contentId } = useParams();
  const navigate = useNavigate();
  const [contentDetail, setContentDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState({});
  const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
  const [showFullScript, setShowFullScript] = useState({ open: false, title: '', content: '' });
  const [errorStateForDisplay, setErrorStateForDisplay] = useState(null);
  const [playingAudio, setPlayingAudio] = useState(null);
  const audioRef = useRef(null);
  const pollingIntervalsRef = useRef({});
  const [overallProgress, setOverallProgress] = useState(null); // { total_in_batch: number, processed_in_batch: number, succeeded_in_batch: number, failed_in_batch: number, message?: string }

  // ... (fetchContentDetail, useEffect for fetching, stopPollingForTask, handleAction, handleViewFullScript, handlePlayAudio, pollTaskStatus, handleGenerateSentenceAudio 和 workflowSteps, getStepStatusIcon, getStepButton 函数保持不变) ...
  // ** fetchContentDetail, useEffect for fetching, stopPollingForTask, handleAction, handleViewFullScript, pollTaskStatus, handleGenerateSentenceAudio, workflowSteps, getStepStatusIcon, getStepButton 等函数保持之前的定义 **
  const fetchContentDetail = useCallback(async (showLoadingIndicator = true) => {
    if (!contentId) return;
    if (showLoadingIndicator) setLoading(true);
    
    setErrorStateForDisplay(null); 
    setAlert({ open: false, message: '', severity: 'info' }); 

    try {
      const response = await ttsApi.getTrainingContentDetail(contentId);
      setContentDetail(response.data);
    } catch (err) { 
      console.error("获取培训内容详情失败:", err); 
      const extractedErrorMessage = err.response?.data?.error || err.message || '获取详情失败，请稍后重试';
      setAlert({ open: true, message: '获取详情失败: ' + extractedErrorMessage, severity: 'error' });
      setErrorStateForDisplay(extractedErrorMessage); 
    } finally {
      if (showLoadingIndicator) setLoading(false);
    }
  }, [contentId]); 

  useEffect(() => {
    fetchContentDetail();
    return () => {
        Object.values(pollingIntervalsRef.current).forEach(clearInterval);
        pollingIntervalsRef.current = {};
        if (audioRef.current) { // 组件卸载时停止并清理音频
            audioRef.current.pause();
            audioRef.current.src = ''; // 清除音频源，防止继续下载
            audioRef.current.load();  // 重新加载以应用更改
            audioRef.current = null;
        }
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
  const handleAction = async (actionType, scriptId = null, associatedContentId = null) => {
    const currentContentId = associatedContentId || contentId; 
    if (!currentContentId) {
        setAlert({ open: true, message: '内容ID缺失，无法执行操作。', severity: 'error' });
        return;
    }
    const loadingKey = scriptId ? `${actionType}_${scriptId}` : actionType;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    setAlert({ open: false, message: '', severity: 'info' });
    try {
        let response;
        let successMessage = '';
        let isNonBatchProgressTask = false; // 标记是否是需要轮询进度的非批量任务

        switch (actionType) {
            case 'generateOralScript':
                response = await ttsApi.generateOralScript(currentContentId);
                successMessage = response.data.message || '口播稿生成任务已启动。';
                isNonBatchProgressTask = true;
                break;
            case 'triggerTtsRefine':
                if (!scriptId) throw new Error("需要口播稿ID来优化");
                response = await ttsApi.triggerTtsRefine(scriptId);
                successMessage = response.data.message || 'TTS Refine 任务已启动。';
                isNonBatchProgressTask = true; // <--- 标记为需要轮询
                break;
            case 'triggerLlmRefine':
                if (!scriptId) throw new Error("需要TTS Refine稿ID来进行LLM润色");
                response = await ttsApi.triggerLlmRefine(scriptId);
                successMessage = response.data.message || 'LLM最终修订任务已启动。';
                isNonBatchProgressTask = true; // <--- 标记为需要轮询
                break;
            case 'splitSentences':
                if (!scriptId) throw new Error("需要最终脚本ID来拆分句子");
                response = await ttsApi.splitSentences(scriptId);
                successMessage = response.data.message || '句子拆分任务已启动。';
                isNonBatchProgressTask = true; // <--- 标记为需要轮询
                break;
            default:
                throw new Error("未知的操作类型");
        }
        setAlert({ open: true, message: successMessage, severity: 'success' });
        
        // **关键：为非批量但需要轮询的任务启动轮询**
        if (isNonBatchProgressTask && response.data.task_id) {
            // 更新 TrainingContent 的 status 为处理中，例如 'processing_tts_refine'
            // 这一步最好由后端任务在开始时自己更新，或者API调用后立即更新
            if (contentDetail) { // 乐观更新UI
                let newStatus = contentDetail.status;
                if(actionType === 'generateOralScript') newStatus = 'processing_oral_script';
                if(actionType === 'triggerTtsRefine') newStatus = 'processing_tts_refine';
                if(actionType === 'triggerLlmRefine') newStatus = 'processing_llm_final_refine';
                if(actionType === 'splitSentences') newStatus = 'processing_sentence_split';
                setContentDetail(prev => ({...prev, status: newStatus}));
            }
            pollTaskStatus(response.data.task_id, false); // isBatchTask 为 false
        } else {
            // 对于不需要轮询或没有task_id的，直接刷新
            setTimeout(() => fetchContentDetail(false), 1000); 
        }

    } catch (error) {
        console.error(`操作 ${actionType} 失败:`, error);
        setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };

  const handleViewFullScript = async (script) => {
    if (!script || !script.id) {
      setAlert({ open: true, message: '无效的脚本信息', severity: 'error' });
      return;
    }
    try {
      if (script.content_preview && !script.content_preview.endsWith('...')) {
        setShowFullScript({ open: true, title: `${script.script_type} (v${script.version}) - 完整内容`, content: script.content_preview });
        return;
      }
      const response = await ttsApi.getScriptContent(script.id);
      setShowFullScript({ open: true, title: `${response.data.script_type} (v${response.data.version}) - 完整内容`, content: response.data.content });
    } catch (error) {
      setAlert({ open: true, message: '获取脚本完整内容失败', severity: 'error' });
    }
  };

  const handlePlayAudio = (sentenceId, audioUrl) => {
    if (!audioUrl) {
      setAlert({ open: true, message: '该句子还没有可播放的语音。', severity: 'warning' });
      return;
    }
    let fullAudioUrl = audioUrl.startsWith('http') ? audioUrl : `${API_BASE_URL.replace('/api', '')}/media/tts_audio/${audioUrl}`;

    if (playingAudio && playingAudio.sentenceId === sentenceId) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingAudio(null); // 清除播放状态
    } else {
      if (audioRef.current) { // 如果当前有音频在播放，先暂停它
        audioRef.current.pause();
      }
      const newAudio = new Audio(fullAudioUrl);
      audioRef.current = newAudio; // 更新 audioRef 指向新的音频对象
      newAudio.play()
        .then(() => setPlayingAudio({ sentenceId, audioUrl: fullAudioUrl }))
        .catch(err => {
          console.error("播放音频失败:", err);
          setAlert({ open: true, message: `播放音频失败: ${err.message || '无法加载音频资源。请检查URL和网络连接。'}`, severity: 'error' });
          setPlayingAudio(null); // 出错时也清除播放状态
        });
      newAudio.onended = () => {
        setPlayingAudio(null); // 播放结束时清除播放状态
      };
      newAudio.onerror = (e) => {
        console.error("音频播放器错误:", e);
        setAlert({ open: true, message: `无法播放音频: ${e.target.error?.message || '未知播放错误，请检查控制台获取详细信息。'}`, severity: 'error' });
        setPlayingAudio(null); // 出错时也清除播放状态
      };
    }
  };
  // --- 新增/修改：处理句子文本更新的函数 ---更新句子失败: ttsApi.updateSentence is not a function

  const handleUpdateSentence = async (sentenceId, newText) => {
    const loadingKey = `update_sentence_${sentenceId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    setAlert({ open: false, message: '', severity: 'info' });
    try {
    // 调用 API 更新句子
    await ttsApi.updateSentence(sentenceId, { sentence_text: newText });
    setAlert({ open: true, message: '句子更新成功！语音状态已重置，请重新生成。', severity: 'success' });
    
    // 关键：成功后，调用 fetchContentDetail 刷新整个页面的数据
    // (false) 表示在后台刷新，不显示全局的 loading 指示器，避免页面闪烁
    fetchContentDetail(false); 

    } catch (error) {
    console.error(`更新句子 ${sentenceId} 失败:`, error);
    setAlert({ 
        open: true, 
        message: `更新句子失败: ${error.response?.data?.error || error.message || '未知错误'}`, 
        severity: 'error' 
    });
    // 出错时也可以考虑刷新一下，以获取服务器的真实状态，或者让用户手动刷新
    // fetchContentDetail(false); 
    } finally {
    setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };
  // 修改 pollTaskStatus 以处理整体进度和最终的 contentDetail 刷新

  const pollTaskStatus = useCallback((taskId, isBatchTask = false) => {
    stopPollingForTask(taskId);
    // let lastProcessedCountForProgressUpdate = -1; // 不再需要这个了

    const intervalId = setInterval(async () => {
      try {
        const response = await ttsApi.getTaskStatus(taskId);
        const taskData = response.data;

        if (isBatchTask) {
          if (taskData.meta && typeof taskData.meta === 'object') {
            const currentMeta = taskData.meta;
            
            // 直接使用后端返回的计数值更新 overallProgress
            setOverallProgress(prev => ({
              total_in_batch: currentMeta.total_in_batch ?? prev?.total_in_batch ?? 0,
              processed_in_batch: currentMeta.processed_in_batch ?? prev?.processed_in_batch ?? 0,
              succeeded_in_batch: currentMeta.succeeded_in_batch ?? prev?.succeeded_in_batch ?? 0,
              failed_in_batch: currentMeta.failed_in_batch ?? prev?.failed_in_batch ?? 0,
              current_sentence_text: currentMeta.current_sentence_text || prev?.current_sentence_text,
              message: currentMeta.message || prev?.message || '状态更新中...'
            }));

            // **关键：如果后端meta中包含了 last_processed_sentence_id 和 status，则更新单个句子**
            const { last_processed_sentence_id, last_processed_sentence_status } = currentMeta;
            if (last_processed_sentence_id && last_processed_sentence_status) {
              setContentDetail(prevDetail => {
                if (!prevDetail || !prevDetail.final_script_sentences) return prevDetail;
                return {
                  ...prevDetail,
                  final_script_sentences: prevDetail.final_script_sentences.map(s =>
                    s.id === last_processed_sentence_id
                      ? { ...s, audio_status: last_processed_sentence_status }
                      : s
                  )
                };
              });
            }
            // **如果后端 meta 中没有 last_processed_sentence_id，但 processed_in_batch 变化了，就刷新整个列表**
            // 这是一个降级方案，如果单个句子状态更新不可靠，至少总表能刷新
            else if (overallProgress && currentMeta.processed_in_batch !== overallProgress.processed_in_batch && taskData.status === 'PROGRESS') {
                fetchContentDetail(false);
            }
          }

          if (taskData.status === 'SUCCESS' || taskData.status === 'FAILURE') {
            stopPollingForTask(taskId);
            const finalStats = taskData.result || taskData.meta;
            setOverallProgress({ /* ... 设置最终 overallProgress (使用 taskData.meta) ... */
                total_in_batch: finalStats?.total_in_batch ?? 0,
                processed_in_batch: finalStats?.processed_in_batch ?? 0,
                succeeded_in_batch: finalStats?.succeeded_in_batch ?? 0,
                failed_in_batch: finalStats?.failed_in_batch ?? 0,
                message: finalStats?.message || (taskData.status === 'FAILURE' ? (taskData.error_message || '任务处理失败') : '处理完毕')
            });
            setAlert({
                open: true,
                message: `批量任务 ${taskId.substring(0,6)}... ${taskData.status === 'SUCCESS' ? '完成' : '失败'}: ${finalStats?.message || taskData.error_message || ''}`,
                severity: taskData.status === 'SUCCESS' ? 'success' : 'error'
              });
            fetchContentDetail(false); 
          }
        } else { // 单句任务
            if (taskData.status === 'SUCCESS' || taskData.status === 'FAILURE') {
                console.log(`[Polling] Non-batch Task ${taskId} finished with status: ${taskData.status}. Stopping poll and fetching details.`); // 添加日志
                stopPollingForTask(taskId);
                fetchContentDetail(false); // <--- 确保这里被调用
                setAlert({
                    open: true,
                    // 根据任务类型给出更具体的成功/失败消息
                    message: `处理操作 ${taskData.status === 'SUCCESS' ? '成功' : '失败'}。${taskData.result?.message || taskData.error_message || ''}`,
                    severity: taskData.status === 'SUCCESS' ? 'success' : 'error'
                });
            }
        }
      } catch (error) {
        console.error(`轮询任务 ${taskId} 状态失败:`, error);
        stopPollingForTask(taskId);
        setAlert({open: true, message: `轮询任务 ${taskId.substring(0,6)}... 进度失败`, severity: 'error'});
        if (isBatchTask) {
            setOverallProgress(prev => ({ ...prev, message: "轮询进度失败"}));
        }
      }
    }, 2000); 
    pollingIntervalsRef.current = { ...pollingIntervalsRef.current, [taskId]: intervalId };
  }, [fetchContentDetail, overallProgress]); // overallProgress 需要作为依赖项，以便在 else if 中比较

  const handleBatchGenerateAudio = async () => {
    if (!contentId || !contentDetail || !contentDetail.final_script_sentences) {
        setAlert({ open: true, message: '无法启动批量任务：内容数据不完整。', severity: 'error' });
        return;
    }
    const loadingKey = `batch_generate_${contentId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    setAlert({ open: false, message: '', severity: 'info' });

    const sentencesForBatch = contentDetail.final_script_sentences.filter(s =>
        ['pending_generation', 'error_generation', 'pending_regeneration', 'error_submission', 'error_polling', 'queued'].includes(s.audio_status) // 不包括 'processing_request' 或 'generating'
    );
    const initialTotalInBatch = sentencesForBatch.length;

    if (initialTotalInBatch === 0) {
        setOverallProgress({ 
            total_in_batch: 0, processed_in_batch: 0, succeeded_in_batch: 0,
            failed_in_batch: 0, message: "没有需要生成语音的句子。"
        });
        setAlert({ open: true, message: "没有需要生成语音的句子。", severity: 'info' });
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
        return;
    }

    setOverallProgress({
        total_in_batch: initialTotalInBatch,
        processed_in_batch: 0,
        succeeded_in_batch: 0,
        failed_in_batch: 0,
        current_sentence_text: null,
        message: `正在提交 ${initialTotalInBatch} 个句子的生成任务...`
    });

    // 乐观更新前端UI上句子的状态
    setContentDetail(prev => {
        if (!prev || !prev.final_script_sentences) return prev;
        return {
            ...prev,
            final_script_sentences: prev.final_script_sentences.map(s =>
                sentencesForBatch.find(sfb => sfb.id === s.id)
                    ? { ...s, audio_status: 'queued' } // 或 'processing_request'
                    : s
            )
        };
    });

    try {
        const response = await ttsApi.batchGenerateAudioForContent(contentId);
        setAlert({ open: true, message: response.data.message || '批量语音生成任务已提交。', severity: 'info' });

        if (response.data.task_id) {
            setOverallProgress(prev => ({ // 确保这里的 message 被API调用后的信息覆盖，如果API有返回的话
                ...prev,
                message: response.data.initial_message || "任务已提交，等待 Worker 处理...", // 可以考虑后端也返回一个初始 message
            }));
            pollTaskStatus(response.data.task_id, true);
            // 这里的 setTimeout(fetchContentDetail) 可以考虑移除，因为轮询会处理状态
        } else {
            setOverallProgress(null); // 如果没有 task_id，清除进度
            fetchContentDetail(false); // 获取真实状态
        }
    } catch (error) {
        console.error(`批量生成语音失败:`, error);
        setAlert({ open: true, message: `批量生成语音失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        setOverallProgress(null); // 失败时清除进度
        fetchContentDetail(false); // 恢复状态
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };

  const handleGenerateSentenceAudio = async (sentenceId) => {
    const loadingKey = `sentence_${sentenceId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    setAlert({ open: false, message: '', severity: 'info' });
    try {
      if (contentDetail) {
        setContentDetail(prev => (!prev || !prev.final_script_sentences) ? prev : {
            ...prev,
            final_script_sentences: prev.final_script_sentences.map(s => 
                s.id === sentenceId ? { ...s, audio_status: 'processing_request' } : s
            )
        });
      }
      const response = await ttsApi.generateSentenceAudio(sentenceId, {});
      setAlert({ open: true, message: response.data.message || '单句语音生成任务已提交。', severity: 'info' });
      if (response.data.task_id) {
        pollTaskStatus(response.data.task_id, sentenceId);
      }
    } catch (error) {
      setAlert({ open: true, message: `生成语音失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
      if (contentDetail) { 
        setContentDetail(prev => (!prev || !prev.final_script_sentences) ? prev : {
            ...prev,
            final_script_sentences: prev.final_script_sentences.map(s => 
                s.id === sentenceId ? { ...s, audio_status: 'error_submission' } : s
            )
        });
      }
    } finally {
      setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };

  // 为单句任务优化的轮询，主要用于刷新父组件数据
  const pollTaskStatusForSingleSentence = useCallback((taskId, sentenceId) => {
    stopPollingForTask(taskId);
    console.log(`[Polling] Starting poll for task ${taskId}, isBatch: ${isBatchTask}`);
    const intervalId = setInterval(async () => {
        try {
            console.log(`[Polling] Task ${taskId} finished with status: ${taskData.status}. Stopping poll.`);
            stopPollingForTask(taskId);
            const finalMessageSource = taskData.result || taskData.meta;
            setAlert({
              open: true,
              message: `批量任务 ${taskId.substring(0,6)} ${taskData.status === 'SUCCESS' ? '完成' : '失败'}: ${finalMessageSource?.message || taskData.error || ''}`,
              severity: taskData.status === 'SUCCESS' ? 'success' : 'error'
            });
            fetchContentDetail(false); // 确保获取所有句子的最终状态
        } catch (error) {
            console.error(`轮询单句任务 ${taskId} 状态失败:`, error);
            stopPollingForTask(taskId);
        }
    }, 3000);
    pollingIntervalsRef.current = { ...pollingIntervalsRef.current, [taskId]: intervalId };
  }, [fetchContentDetail]);

  const workflowSteps = [
    { key: 'originalContent', label: '原始培训内容', icon: <ArticleIcon />, output: contentDetail?.original_content, outputPreview: contentDetail?.original_content?.substring(0, 200) + (contentDetail?.original_content?.length > 200 ? '...' : '') },
    { key: 'generateOralScript', label: '1. 生成口播稿', action: () => handleAction('generateOralScript', null, contentId), isPending: (s) => s === 'pending_oral_script', isInProgress: (s) => s === 'processing_oral_script', isCompleted: (s, scripts) => !['pending_oral_script', 'processing_oral_script'].includes(s) && !!scripts?.find(sc => sc.script_type === 'oral_script'), isEnabled: (s) => s === 'pending_oral_script', outputScript: contentDetail?.scripts?.find(s => s.script_type === 'oral_script') },
    { key: 'triggerTtsRefine', label: '2. TTS Refine优化', action: (id) => handleAction('triggerTtsRefine', id, contentId), isPending: (s) => s === 'pending_tts_refine', isInProgress: (s) => s === 'processing_tts_refine', isCompleted: (s, scripts) => !['pending_oral_script', 'processing_oral_script', 'pending_tts_refine', 'processing_tts_refine'].includes(s) && !!scripts?.find(sc => sc.script_type === 'tts_refined_script'), isEnabled: (s, prevCompleted) => prevCompleted && s === 'pending_tts_refine', requiresScriptIdFrom: 'oral_script', outputScript: contentDetail?.scripts?.find(s => s.script_type === 'tts_refined_script') },
    { key: 'triggerLlmRefine', label: '3. LLM最终修订', action: (id) => handleAction('triggerLlmRefine', id, contentId), isPending: (s) => s === 'pending_llm_final_refine', isInProgress: (s) => s === 'processing_llm_final_refine', isCompleted: (s, scripts) => !['pending_oral_script', 'processing_oral_script', 'pending_tts_refine', 'processing_tts_refine', 'pending_llm_final_refine', 'processing_llm_final_refine'].includes(s) && !!scripts?.find(sc => sc.script_type === 'final_tts_script'), isEnabled: (s, prevCompleted) => prevCompleted && s === 'pending_llm_final_refine', requiresScriptIdFrom: 'tts_refined_script', outputScript: contentDetail?.scripts?.find(s => s.script_type === 'final_tts_script') },
    {
      key: 'splitSentences',
      label: '4. 拆分句子',
      action: (scriptId) => handleAction('splitSentences', scriptId, contentId),
      isPending: (s) => s === 'pending_sentence_split',
      isInProgress: (s) => s === 'processing_sentence_split',
      isCompleted: (s, scripts, sentences) => !['pending_oral_script', 'processing_oral_script', 'pending_tts_refine', 'processing_tts_refine', 'pending_llm_final_refine', 'processing_llm_final_refine', 'pending_sentence_split', 'processing_sentence_split'].includes(s) && (sentences && sentences.length > 0),
      isEnabled: (s, prevCompleted) => prevCompleted && s === 'pending_sentence_split',
      requiresScriptIdFrom: 'final_tts_script'
    },
    {
      key: 'generateAndMergeAudio', // 将步骤合并为一个概念上的步骤，实际操作由下方按钮触发
      label: '5. 生成与合并语音',
      // 这个步骤的完成状态可以基于最终合并音频是否存在
      isCompleted: (status, scripts, sentences, mergedAudio) => !!mergedAudio,
      // 这个步骤的是否启用可以基于句子是否已拆分
      isEnabled: (status, prevCompleted, sentences) => prevCompleted && sentences && sentences.length > 0,
      // 这里不直接放 action，因为操作是批量的或针对合并的
    }
  ];

  const getStepStatusIcon = (step, currentStatus, scripts, sentences) => {
    if (step.key === 'originalContent') return <CheckCircleIcon color="success" />; // 原始稿件总是完成的
    if (step.isCompleted && step.isCompleted(currentStatus, scripts, sentences)) return <CheckCircleIcon color="success" />;
    if (step.isInProgress && step.isInProgress(currentStatus)) return <CircularProgress size={20} thickness={5} />;
    if (step.isPending && step.isPending(currentStatus)) return <HourglassEmptyIcon color="action" />;
    return <RadioButtonUncheckedIcon color="disabled" />;
  };

  const getStepButton = (step, currentStatus, scripts, sentences) => {
    let previousStepCompleted = true;
    if (step.key !== 'originalContent' && step.key !== 'generateOralScript') {
      const previousStepIndex = workflowSteps.findIndex(s => s.key === step.key) - 1;
      if (previousStepIndex >= 0) {
          const previousStep = workflowSteps[previousStepIndex];
          previousStepCompleted = previousStep.isCompleted ? previousStep.isCompleted(currentStatus, scripts, sentences) : false;
      }
    }
    
    const isEnabled = step.isEnabled ? step.isEnabled(currentStatus, previousStepCompleted) : previousStepCompleted;
    const isLoading = actionLoading[step.key] || (step.isInProgress && step.isInProgress(currentStatus));

    if (step.action) {
      let scriptIdForAction = null;
      if (step.requiresScriptIdFrom) {
        const sourceScript = scripts?.find(s => s.script_type === step.requiresScriptIdFrom);
        if (!sourceScript) {
          if (step.key !== 'generateOralScript') return <Button variant="outlined" size="small" disabled sx={{mt:1}}>等待前置脚本</Button>;
        }
        scriptIdForAction = sourceScript?.id;
      }
      return (
        <Button variant="contained" size="small" onClick={() => step.action(scriptIdForAction)} disabled={!isEnabled || isLoading} sx={{ mt: 1 }} >
          {isLoading ? <CircularProgress size={20} color="inherit" /> : step.label.split('. ')[1]}
        </Button>
      );
    }
    return null;
  };

  if (loading && !contentDetail) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>;
  }

  if (errorStateForDisplay || (!loading && !contentDetail)) {
    return (
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ m: 2 }}>返回列表</Button>
        <AlertMessage open={true} message={errorStateForDisplay || "内容未找到或数据加载不完整。"} severity="error" onClose={() => setErrorStateForDisplay(null)} />
      </Box>
    );
  }

  return (
    <Box>
      <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({ ...prev, open: false }))} />
      <PageHeader
        title={`培训内容: ${contentDetail.content_name}`}
        description={`状态: ${contentDetail.status || '未知'} | 创建于: ${formatRelativeTime(contentDetail.created_at)} by ${contentDetail.uploader_username}`}
      />
      {overallProgress && (
        <Paper sx={{ p: 2, mb: 2, backgroundColor: '#e3f2fd' }}>
          <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
            批量语音生成进度:
          </Typography>
          {/* 调试：直接打印 overallProgress 对象 */}
          <pre>{JSON.stringify(overallProgress, null, 2)}</pre>
          <Box>
              <Typography variant="body2">
                  总共待处理: {overallProgress.total_in_batch ?? 'N/A'} |
                  已处理: {overallProgress.processed_in_batch ?? 0} |
                  成功: {overallProgress.succeeded_in_batch ?? 0} |
                  失败: {overallProgress.failed_in_batch ?? 0}
              </Typography>
              {overallProgress.current_sentence_text && (
                  <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
                  当前: {overallProgress.current_sentence_text}
                  </Typography>
              )}
              {(overallProgress.message && (overallProgress.processed_in_batch === 0 && overallProgress.total_in_batch > 0)) && ( // 仅在初始或特定消息时显示
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    状态: {overallProgress.message}
                </Typography>
              )}
              <LinearProgress
                  variant="determinate"
                  value={
                    (typeof overallProgress.total_in_batch === 'number' && overallProgress.total_in_batch > 0 && typeof overallProgress.processed_in_batch === 'number')
                      ? Math.round((overallProgress.processed_in_batch / overallProgress.total_in_batch) * 100)
                      : (overallProgress.status === 'SUCCESS' && 
                         (overallProgress.succeeded_in_batch + overallProgress.failed_in_batch) === overallProgress.total_in_batch && 
                         overallProgress.total_in_batch > 0) // 确保 total_in_batch > 0
                        ? 100
                        : 0
                  }
                  sx={{ mt: 1, height: 10, borderRadius: 5, backgroundColor: '#b3e5fc' /*浅一点的背景*/ }}
                  color={ (overallProgress.failed_in_batch ?? 0) > 0 ? "error" : "primary" } // 如果有失败，进度条显示红色
              />
          </Box>
        </Paper>
      )}

    <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>工作流程</Typography>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', overflowX: 'auto', pb: 1 }}>
          {workflowSteps.map((step, index) => {
            let previousStepActuallyCompleted = true;
            if (index > 0) {
                const prevStepDefinition = workflowSteps[index-1];
                if (prevStepDefinition && prevStepDefinition.isCompleted) {
                    previousStepActuallyCompleted = prevStepDefinition.isCompleted(
                        contentDetail.status,
                        contentDetail.scripts,
                        contentDetail.final_script_sentences,
                        contentDetail.latest_merged_audio
                    );
                } else if (prevStepDefinition && prevStepDefinition.key === 'originalContent') {
                    previousStepActuallyCompleted = true;
                } else {
                    previousStepActuallyCompleted = step.key === 'generateOralScript';
                }
            }
            // ---- 提前计算 CardContent 的内容 ----
            let cardContentOutput = null;
            if (step.outputScript) {
              cardContentOutput = (
                <>
                  <Typography variant="caption" color="textSecondary" component="div" noWrap>
                    版本: v{step.outputScript.version} | {formatRelativeTime(step.outputScript.created_at)}
                  </Typography>
                  <Tooltip title={step.outputScript.content_preview} placement="top">
                    <Typography variant="body2" sx={{ maxHeight: '60px', overflow: 'hidden', textOverflow: 'ellipsis', mb: 0.5, whiteSpace: 'pre-wrap' }}>
                      {step.outputScript.content_preview}
                    </Typography>
                  </Tooltip>
                  <Button size="small" onClick={() => handleViewFullScript(step.outputScript)}>查看/编辑</Button>
                </>
              );
            } else if (step.key === 'originalContent' && step.output) {
              cardContentOutput = (
                <>
                  <Tooltip title={step.outputPreview} placement="top">
                    <Typography variant="body2" sx={{ maxHeight: '60px', overflow: 'hidden', textOverflow: 'ellipsis', mb: 0.5, whiteSpace: 'pre-wrap' }}>
                      {step.outputPreview}
                    </Typography>
                  </Tooltip>
                  <Button size="small" onClick={() => setShowFullScript({open: true, title: '完整原始培训内容', content: step.output})}>查看原文</Button>
                </>
              );
            } else if (step.key === 'splitSentences' && step.isCompleted && step.isCompleted(contentDetail.status, contentDetail.scripts, contentDetail.final_script_sentences)) {
              cardContentOutput = <Typography variant="body2" color="textSecondary">句子已拆分，详情见下方列表。</Typography>;
            } else if (step.key === 'generateAndMergeAudio' && step.isCompleted && step.isCompleted(contentDetail.status, contentDetail.scripts, contentDetail.final_script_sentences, contentDetail.latest_merged_audio)) {
              cardContentOutput = <Typography variant="body2" color="text.success">语音已生成并合并。</Typography>;
            }
            // ---- CardContent 内容计算结束 ----
            return (
              <React.Fragment key={step.key}>
                <Card sx={{ minWidth: 200, maxWidth:300, mr: 2, flexShrink: 0, display:'flex', flexDirection:'column', height: '100%' }}>
                  <CardHeader
                    avatar={getStepStatusIcon(step, contentDetail.status, contentDetail.scripts, contentDetail.final_script_sentences, contentDetail.latest_merged_audio)}
                    title={<Typography variant="subtitle1" sx={{fontWeight: 'medium'}}>{step.label}</Typography>}
                    sx={{pb:0, pt:1.5, px:1.5}}
                  />
                  <CardContent sx={{flexGrow:1, pt:0.5, pb: '8px !important', px:1.5}}>
                    {cardContentOutput} {/* 使用计算好的内容 */}
                  </CardContent>
                   <Box sx={{p:1.5, pt:0}}>
                    {step.key === 'generateAndMergeAudio' && workflowSteps.find(s => s.key === 'splitSentences')?.isCompleted(contentDetail.status, contentDetail.scripts, contentDetail.final_script_sentences) && (
                        <Box sx={{mt:1, display: 'flex', flexDirection: 'column', gap: 1}}>
                             <Button
                                variant="contained"
                                size="small"
                                onClick={handleBatchGenerateAudio}
                                disabled={actionLoading[`batch_generate_${contentId}`]}
                                startIcon={actionLoading[`batch_generate_${contentId}`] ? <CircularProgress size={16} /> : <PlaylistPlayIcon />}
                            >
                                生成所有句子语音
                            </Button>
                            <Button
                                variant="contained"
                                size="small"
                                color="secondary"
                                // onClick={handleMergeAudio} // 待实现
                                // disabled={actionLoading['merge_audio'] || !canMergeAudio} // 待实现
                                startIcon={actionLoading['merge_audio'] ? <CircularProgress size={16} /> : <CloudUploadIcon />}
                            >
                                合并语音
                            </Button>
                        </Box>
                    )}
                    {step.key !== 'generateAndMergeAudio' && step.action && getStepButton(step, contentDetail.status, contentDetail.scripts, contentDetail.final_script_sentences)}
                  </Box>
                </Card>
                {index < workflowSteps.length - 1 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mr: 2, minHeight: '100%' }}>
                    <KeyboardArrowRightIcon color="disabled" sx={{fontSize: '2rem'}}/>
                  </Box>
                )}
              </React.Fragment>
            );
          })}
        </Box>
      </Paper>
      
      {/* 最终TTS脚本句子列表 (使用新的 SentenceList 子组件) */}
      {contentDetail.final_script_sentences && contentDetail.final_script_sentences.length > 0 && (
        <Grid item xs={12}>
          <SentenceList
            sentences={contentDetail.final_script_sentences}
            playingAudio={playingAudio}
            actionLoading={actionLoading}
            onPlayAudio={handlePlayAudio}
            onGenerateAudio={handleGenerateSentenceAudio}
            onUpdateSentenceText={handleUpdateSentence}
          />
        </Grid>
      )}

    <Dialog open={showFullScript.open} onClose={() => setShowFullScript({open: false, title: '', content: ''})} maxWidth="md" fullWidth scroll="paper">
        <DialogTitle>{showFullScript.title}</DialogTitle>
        <DialogContent dividers>
            <Box sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.875rem' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{showFullScript.content}</ReactMarkdown>
            </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowFullScript({open: false, title: '', content: ''})}>关闭</Button>
        </DialogActions>
    </Dialog>

    </Box>
  );
};

export default TrainingContentDetail;