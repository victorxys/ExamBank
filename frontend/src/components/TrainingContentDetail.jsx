// frontend/src/components/TrainingContentDetail.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, CircularProgress, Chip, Grid, Card, CardHeader, CardContent,
  TableContainer, Table, TableHead, TableRow, TableCell, TableBody, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  List, ListItem, ListItemText, Divider, IconButton, TextField, Stack, TextareaAutosize,
  LinearProgress, // 确保导入 LinearProgress
  TablePagination // 确保导入 TablePagination
} from '@mui/material';

import {
    PlayArrow as PlayArrowIcon,
    Download as DownloadIcon,
    Refresh as RefreshIcon,
    Edit as EditIcon,
    Save as SaveIcon,
    SpeakerNotes as SpeakerNotesIcon,
    Audiotrack as AudiotrackIcon,
    PlaylistPlay as PlaylistPlayIcon,
    CloudUpload as CloudUploadIcon, // 用于合并
    DynamicFeed as DynamicFeedIcon, // 用于重新合并
    Article as ArticleIcon,
    StopCircleOutlined as StopCircleOutlinedIcon,
    CheckCircle as CheckCircleIcon,
    HourglassEmpty as HourglassEmptyIcon,
    Error as ErrorIcon,
    RadioButtonUnchecked as RadioButtonUncheckedIcon,
    KeyboardArrowRight as KeyboardArrowRightIcon,
    Search as SearchIcon,
    Delete as DeleteIcon,
    Cached as CachedIcon,
    Subtitles as SubtitlesIcon // 新增字幕图标
} from '@mui/icons-material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { ttsApi } from '../api/tts';
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';
import { formatRelativeTime } from '../api/dateUtils';
import { API_BASE_URL } from '../config';
import useTaskPolling from '../utils/useTaskPolling';


// 时间格式化辅助函数
const formatMsToTime = (ms) => {
  if (typeof ms !== 'number' || isNaN(ms) || ms < 0) return '00:00.000';
  const totalSeconds = Math.floor(ms / 1000);
  const milliseconds = String(ms % 1000).padStart(3, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${minutes}:${seconds}.${milliseconds}`;
  }
  return `${minutes}:${seconds}.${milliseconds}`;
};

// SentenceList 子组件
const SentenceList = ({ 
    sentences, 
    playingAudio, 
    actionLoading, 
    onPlayAudio, 
    onGenerateAudio, 
    onUpdateSentenceText, 
    onDeleteSentence,
    mergedAudioSegments // 新增：传递合并后的分段信息
}) => {
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(50);
    const [searchTerm, setSearchTerm] = useState('');

    // 为所有句子预计算 segmentInfo
    const sentencesWithSegmentInfo = useMemo(() => {
        if (!mergedAudioSegments || mergedAudioSegments.length === 0) {
            return sentences.map(s => ({ ...s, segmentInfo: null }));
        }
        return sentences.map(sentence => {
            const segment = mergedAudioSegments.find(
                seg => seg.tts_sentence_id === sentence.id && seg.original_order_index === sentence.order_index
            );
            return { ...sentence, segmentInfo: segment || null };
        });
    }, [sentences, mergedAudioSegments]);

    const filteredSentences = useMemo(() => {
        if (!searchTerm) return sentencesWithSegmentInfo; // 使用带有 segmentInfo 的句子
        return sentencesWithSegmentInfo.filter(sentence =>
            sentence.text.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [sentencesWithSegmentInfo, searchTerm]); // 依赖 sentencesWithSegmentInfo

    // const filteredSentences = useMemo(() => {
    //     if (!searchTerm) return sentences;
    //     return sentences.filter(sentence =>
    //         sentence.text.toLowerCase().includes(searchTerm.toLowerCase())
    //     );
    // }, [sentences, searchTerm]);

    const [editSentenceDialogOpen, setEditSentenceDialogOpen] = useState(false);
    const [sentenceToEdit, setSentenceToEdit] = useState(null);
    const [editingSentenceText, setEditingSentenceText] = useState('');
    const [deleteSentenceConfirmOpen, setDeleteSentenceConfirmOpen] = useState(false);
    const [sentenceToDelete, setSentenceToDelete] = useState(null);

    const handleChangePage = (event, newPage) => setPage(newPage);
    const handleChangeRowsPerPage = (event) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
    };

    const paginatedSentences = useMemo(() => {
        return filteredSentences.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
    }, [filteredSentences, page, rowsPerPage]);

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
            alert("句子内容不能为空！");
            return;
        }
        if (typeof onUpdateSentenceText === 'function') {
            await onUpdateSentenceText(sentenceToEdit.id, editingSentenceText.trim());
        }
        handleCloseEditSentenceDialog();
    };

    const handleOpenDeleteSentenceDialog = (sentence) => {
        setSentenceToDelete(sentence);
        setDeleteSentenceConfirmOpen(true);
    };

    const handleCloseDeleteSentenceDialog = () => {
        setDeleteSentenceConfirmOpen(false);
        setSentenceToDelete(null);
    };

    const handleConfirmDeleteSentence = async () => {
        if (sentenceToDelete && typeof onDeleteSentence === 'function') {
            await onDeleteSentence(sentenceToDelete.id);
        }
        handleCloseDeleteSentenceDialog();
    };

    return (
        <>
            <Card sx={{ mt: 2 }}>
                <CardHeader
                    title="最终TTS脚本句子列表"
                    action={
                        <Box sx={{display: 'flex', gap: 1, alignItems: 'center'}}>
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
                        </Box>
                    }
                />
                <CardContent sx={{ pt: 0 }}>
                    <TableContainer component={Paper} elevation={0}>
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ width: '5%', fontWeight: 'bold' }}>序号</TableCell>
                                    <TableCell sx={{ fontWeight: 'bold' }}>句子文本</TableCell>
                                    <TableCell sx={{ width: '10%', fontWeight: 'bold', textAlign: 'center' }}>语音状态</TableCell>
                                    <TableCell sx={{ width: '15%', fontWeight: 'bold', textAlign: 'center' }}>合并时间戳</TableCell>
                                    <TableCell sx={{ width: '25%', fontWeight: 'bold', textAlign: 'center' }}>操作</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {paginatedSentences.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} align="center">
                                            <Typography color="textSecondary" sx={{ p: 2 }}>
                                                {searchTerm ? '未找到匹配的句子' : '暂无句子，请先拆分脚本。'}
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    // paginatedSentences 中的每个 sentence 对象现在都预先计算了 segmentInfo
                                    paginatedSentences.map(sentence => (
                                        <TableRow key={sentence.id} hover>
                                            <TableCell>{sentence.order_index + 1}</TableCell>
                                            <TableCell sx={{whiteSpace: "pre-wrap", wordBreak: "break-word"}}>{sentence.text}</TableCell>
                                            <TableCell align="center">
                                                <Chip
                                                    label={sentence.audio_status || '未知'}
                                                    size="small"
                                                    color={sentence.audio_status === 'generated' ? 'success' : (sentence.audio_status === 'generating' || sentence.audio_status === 'processing_request' || sentence.audio_status === 'queued' ? 'info' : (sentence.audio_status?.startsWith('error') ? 'error' : 'default'))}
                                                />
                                            </TableCell>
                                            <TableCell align="center">
                                                {/* 直接使用预计算的 sentence.segmentInfo */}
                                                {sentence.segmentInfo ? 
                                                    <Tooltip title={`开始: ${sentence.segmentInfo.start_ms}ms, 结束: ${sentence.segmentInfo.end_ms}ms, 时长: ${sentence.segmentInfo.duration_ms}ms`}>
                                                        <span>{`${formatMsToTime(sentence.segmentInfo.start_ms)} - ${formatMsToTime(sentence.segmentInfo.end_ms)}`}</span>
                                                    </Tooltip>
                                                    : '-'}
                                            </TableCell>
                                            <TableCell align="right">
                                                {/* 操作按钮部分，直接使用 sentence 对象 */}
                                                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                                    <Tooltip title="编辑句子">
                                                        {/* 传递的是包含了 segmentInfo 的 sentence 对象，但不影响 dialog 的逻辑 */}
                                                        <IconButton size="small" onClick={() => handleOpenEditSentenceDialog(sentence)} color="default">
                                                            <EditIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title="删除句子">
                                                        <IconButton size="small" onClick={() => handleOpenDeleteSentenceDialog(sentence)} color="error">
                                                            <DeleteIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                    {sentence.audio_status === 'generated' && sentence.latest_audio_url && (
                                                        <Tooltip title={playingAudio && playingAudio.sentenceId === sentence.id ? "停止" : "播放"}>
                                                            <IconButton size="small" onClick={() => onPlayAudio(sentence.id, sentence.latest_audio_url)} color={playingAudio && playingAudio.sentenceId === sentence.id ? "error" : "primary"}>
                                                                {playingAudio && playingAudio.sentenceId === sentence.id ? <StopCircleOutlinedIcon /> : <PlayArrowIcon />}
                                                            </IconButton>
                                                        </Tooltip>
                                                    )}
                                                    {sentence.audio_status === 'generated' && sentence.latest_audio_url && (
                                                        <Tooltip title="下载">
                                                            <IconButton size="small" href={sentence.latest_audio_url.startsWith('http') ? sentence.latest_audio_url : `${API_BASE_URL.replace('/api', '')}/media/tts_audio/${sentence.latest_audio_url}`} download={`sentence_${sentence.order_index + 1}.wav`} color="primary">
                                                                <DownloadIcon />
                                                            </IconButton>
                                                        </Tooltip>
                                                    )}
                                                    {(['pending_generation', 'error_generation', 'pending_regeneration', 'error_submission', 'error_polling', 'queued'].includes(sentence.audio_status) || !sentence.audio_status) && (
                                                        <Button size="small" variant="outlined" onClick={() => onGenerateAudio(sentence.id)} disabled={actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating'} startIcon={(actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating') ? <CircularProgress size={16} /> : <AudiotrackIcon />}>
                                                            {sentence.audio_status?.startsWith('error') ? '重试' : '生成'}
                                                        </Button>
                                                    )}
                                                    {sentence.audio_status === 'generated' && (
                                                        <Tooltip title="重新生成语音">
                                                            <span>
                                                                <IconButton size="small" onClick={() => onGenerateAudio(sentence.id)} disabled={actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating'} sx={{ ml: 0.5 }}>
                                                                    {(actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating') ? <CircularProgress size={20} color="inherit" /> : <RefreshIcon />}
                                                                </IconButton>
                                                            </span>
                                                        </Tooltip>
                                                    )}
                                                    {(sentence.audio_status === 'generating' || sentence.audio_status === 'processing_request') && <CircularProgress size={20} sx={{ ml: 1 }} />}
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
                            count={filteredSentences.length} // 使用 filteredSentences.length
                            page={page}
                            onPageChange={handleChangePage}
                            rowsPerPage={rowsPerPage}
                            onRowsPerPageChange={handleChangeRowsPerPage}
                            rowsPerPageOptions={[10, 25, 50, 100, 200]}
                            labelRowsPerPage="每页句数:"
                            labelDisplayedRows={({ from, to, count }) => `${from}-${to} 共 ${count}`}
                        />
                    )}
                </CardContent>
            </Card>

            <Dialog open={editSentenceDialogOpen} onClose={handleCloseEditSentenceDialog} maxWidth="sm" fullWidth>
                <DialogTitle>编辑句子 (序号: {sentenceToEdit?.order_index != null ? sentenceToEdit.order_index + 1 : ''})</DialogTitle>
                <DialogContent>
                    <TextField autoFocus margin="dense" label="句子内容" type="text" fullWidth multiline rows={4} value={editingSentenceText} onChange={(e) => setEditingSentenceText(e.target.value)} sx={{ mt: 1 }}/>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseEditSentenceDialog}>取消</Button>
                    <Button onClick={handleSaveEditedSentence} variant="contained">保存更改</Button>
                </DialogActions>
            </Dialog>
            <Dialog open={deleteSentenceConfirmOpen} onClose={handleCloseDeleteSentenceDialog} maxWidth="xs" fullWidth>
                <DialogTitle>确认删除句子</DialogTitle>
                <DialogContent>
                    <Typography>确定要删除这句话及其对应的语音文件吗？</Typography>
                    <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                        序号: {sentenceToDelete?.order_index != null ? sentenceToDelete.order_index + 1 : ''} <br />
                        内容: "{sentenceToDelete?.text}"
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDeleteSentenceDialog}>取消</Button>
                    <Button onClick={handleConfirmDeleteSentence} color="error" variant="contained">确认删除</Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

// 时间格式化辅助函数 (毫秒转 HH:MM:SS,mmm)
const formatMsToSrtTime = (ms) => {
    if (typeof ms !== 'number' || isNaN(ms) || ms < 0) return '00:00:00,000';
    const totalSeconds = Math.floor(ms / 1000);
    const milliseconds = String(ms % 1000).padStart(3, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = String(totalMinutes % 60).padStart(2, '0');
    const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    return `${hours}:${minutes}:${seconds},${milliseconds}`;
};

// Main Component
const TrainingContentDetail = () => {
  const { contentId } = useParams();
  const navigate = useNavigate();
  const [contentDetail, setContentDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState({});
  const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
  
  const [showFullScriptDialog, setShowFullScriptDialog] = useState({ open: false, title: '', content: '', scriptId: null, scriptType: '', isOriginalContent: false });
  const [editingDialogScriptContent, setEditingDialogScriptContent] = useState('');

  const [activeStepKey, setActiveStepKey] = useState('generateOralScript');
  const [editingStepInputContent, setEditingStepInputContent] = useState('');
  const [isEditingInput, setIsEditingInput] = useState(false);
  const [currentInputScriptId, setCurrentInputScriptId] = useState(null);

  const [errorStateForDisplay, setErrorStateForDisplay] = useState(null);
  const [playingAudio, setPlayingAudio] = useState(null);
  const audioRef = useRef(null);
  const pollingIntervalsRef = useRef({}); // 用于存储所有轮询的 interval ID
  const [overallProgress, setOverallProgress] = useState(null); // 用于批量语音生成
  const [mergeProgress, setMergeProgress] = useState(null); // 新增：用于语音合并进度

  const handleTaskCompletion = (taskData, taskType) => {
    setAlert({ open: true, message: `任务 (${taskType}) 已成功完成！`, severity: 'success' });
    fetchContentDetail(false); // 刷新数据
  };

  const handleTaskFailure = (taskData, taskType) => {
    setAlert({ open: true, message: `任务 (${taskType}) 失败: ${taskData.meta?.message || taskData.error_message}`, severity: 'error' });
    fetchContentDetail(false); // 同样刷新以获取最终的错误状态
  };
  
  const { pollingTask, isPolling, startPolling } = useTaskPolling(handleTaskCompletion, handleTaskFailure);



  const workflowSteps = useMemo(() => [
    { 
      key: 'generateOralScript', label: '1. 生成口播稿', actionName: 'generateOralScript',
      inputLabel: '原始培训文档', outputLabel: '口播稿',
      inputScriptTypeKey: 'original_content',
      outputScriptTypeKey: 'oral_script',
      isPending: (s) => s === 'pending_oral_script', 
      isInProgress: (s) => s === 'processing_oral_script', 
      isCompleted: (s, scripts) => !['pending_oral_script', 'processing_oral_script'].includes(s) && !!scripts?.find(sc => sc.script_type === 'oral_script'), 
      isEnabled: (s) => s === 'pending_oral_script' || (contentDetail && !contentDetail.scripts?.find(sc => sc.script_type === 'oral_script')),
    },
    { 
      key: 'triggerTtsRefine', label: '2. TTS初步优化', actionName: 'triggerTtsRefine',
      inputLabel: '口播稿', outputLabel: 'TTS优化稿',
      inputScriptTypeKey: 'oral_script', 
      outputScriptTypeKey: 'tts_refined_script',
      isPending: (s) => s === 'pending_tts_refine', 
      isInProgress: (s) => s === 'processing_tts_refine', 
      isCompleted: (s, scripts) => !['pending_tts_refine', 'processing_tts_refine'].includes(s) && !!scripts?.find(sc => sc.script_type === 'tts_refined_script'), 
      isEnabled: (s, prevCompleted) => prevCompleted && (s === 'pending_tts_refine' || (contentDetail && !contentDetail.scripts?.find(sc => sc.script_type === 'tts_refined_script'))),
    },
    { 
      key: 'triggerLlmRefine', label: '3. LLM最终修订', actionName: 'triggerLlmRefine',
      inputLabel: 'TTS优化稿', outputLabel: '最终TTS脚本',
      inputScriptTypeKey: 'tts_refined_script', 
      outputScriptTypeKey: 'final_tts_script',
      isPending: (s) => s === 'pending_llm_final_refine', 
      isInProgress: (s) => s === 'processing_llm_final_refine', 
      isCompleted: (s, scripts) => !['pending_llm_final_refine', 'processing_llm_final_refine'].includes(s) && !!scripts?.find(sc => sc.script_type === 'final_tts_script'), 
      isEnabled: (s, prevCompleted) => prevCompleted && (s === 'pending_llm_final_refine' || (contentDetail && !contentDetail.scripts?.find(sc => sc.script_type === 'final_tts_script'))),
    },
    {
        key: 'splitSentences', label: '4. 脚本拆分句子', actionName: 'splitSentences',
        inputLabel: '最终TTS脚本', 
        outputLabel: '句子列表',
        inputScriptTypeKey: 'final_tts_script', 
        isPending: (s) => s === 'pending_sentence_split',
        isInProgress: (s) => s === 'processing_sentence_split',
        isCompleted: (s, scripts, sentences) => !['pending_sentence_split', 'processing_sentence_split'].includes(s) && (sentences && sentences.length > 0),
        isEnabled: (s, prevCompleted) => prevCompleted && (s === 'pending_sentence_split' || (contentDetail && (!contentDetail.final_script_sentences || contentDetail.final_script_sentences.length === 0))),
    },
    {
      key: 'generateAndMergeAudio', label: '5. 生成与合并语音',
      isCompleted: (status, scripts, sentences, mergedAudio) => 
            status === 'audio_merge_complete' && !!mergedAudio && mergedAudio.segments && mergedAudio.segments.length > 0,
      isEnabled: (status, prevCompleted, sentences) => 
            prevCompleted && sentences && sentences.length > 0 && 
            (status === 'pending_audio_generation' || status === 'audio_generation_complete' || status === 'partial_audio_generated' || status === 'audio_merge_queued' || status === 'merging_audio' || status === 'audio_merge_complete' || status === 'merge_failed_no_script' || status === 'merge_failed_no_sentences' || status === 'merge_failed_audio_missing' || status === 'merge_failed_file_missing' || status === 'merge_failed_decode_error_sent_' || status === 'merge_failed_no_segments_processed' || status === 'merge_failed_exception'),
    }
  ], [contentDetail]); // 确保 contentDetail 在依赖中，以便 isEnabled/isCompleted 正确响应变化

const fetchContentDetail = useCallback(async (showLoadingIndicator = true) => {
    if (!contentId) return;
    if (showLoadingIndicator) setLoading(true);
    setErrorStateForDisplay(null);
    try {
      const response = await ttsApi.getTrainingContentDetail(contentId);
      let fullOriginalContent = response.data.original_content;
      if (!fullOriginalContent && response.data.id && response.data.original_content_preview && response.data.original_content_preview.endsWith('...')) {
        try {
          const originalContentRes = await ttsApi.getOriginalTrainingContent(response.data.id);
          fullOriginalContent = originalContentRes.data.original_content;
        } catch (originalErr) {
          console.warn("获取完整原始文本失败:", originalErr);
          fullOriginalContent = response.data.original_content_preview || '';
        }
      }
  
      const sortedData = {
        ...response.data,
        original_content: fullOriginalContent,
        scripts: response.data.scripts ? [...response.data.scripts].sort((a, b) => {
          const typeOrder = { 'original_text': 0, 'oral_script': 1, 'tts_refined_script': 2, 'final_tts_script': 3 }; // original_text 是隐式的
          if (typeOrder[a.script_type] !== undefined && typeOrder[b.script_type] !== undefined && typeOrder[a.script_type] !== typeOrder[b.script_type]) {
            return typeOrder[a.script_type] - typeOrder[b.script_type];
          }
          return b.version - a.version; // 同类型内，版本高的在前
        }) : [],
        final_script_sentences: response.data.final_script_sentences // 后端应该返回已排序的
          ? [...response.data.final_script_sentences].sort((a, b) => a.order_index - b.order_index) 
          : [],
        latest_merged_audio: response.data.latest_merged_audio // 确保 segments 也包含在内
      };
      setContentDetail(sortedData);
    } catch (err) {
      console.error("获取培训内容详情失败:", err.response || err);
      const extractedErrorMessage = err.response?.data?.error || err.message || '获取详情失败，请稍后重试';
      setAlert({ open: true, message: '获取详情失败: ' + extractedErrorMessage, severity: 'error' });
      setErrorStateForDisplay(extractedErrorMessage);
    } finally {
      if (showLoadingIndicator) setLoading(false);
    }
  }, [contentId]); 

  const initializeStepInput = useCallback((step, detail) => {
    if (!step || !detail) {
      setEditingStepInputContent('');
      setCurrentInputScriptId(null);
      return;
    }
    let inputContent = '';
    let inputId = null;
  
    if (step.inputScriptTypeKey === 'original_content') {
      inputContent = detail.original_content || '';
    } else if (step.inputScriptTypeKey && detail.scripts) {
      // 获取最新版本的输入脚本
      const inputScriptsOfType = detail.scripts
        .filter(s => s.script_type === step.inputScriptTypeKey)
        .sort((a, b) => b.version - a.version); // 版本高的在前
      const inputScript = inputScriptsOfType.length > 0 ? inputScriptsOfType[0] : null;
  
      if (inputScript) {
        // 尝试从 API 获取完整内容，如果详情只返回预览
        if (inputScript.content_preview && inputScript.content_preview.endsWith('...') && !inputScript.content) {
            ttsApi.getScriptContent(inputScript.id)
                .then(res => {
                    setEditingStepInputContent(res.data.content || '');
                    // 更新 contentDetail 中的脚本内容，避免下次重复获取
                    setContentDetail(prev => ({
                        ...prev,
                        scripts: prev.scripts.map(s => s.id === inputScript.id ? {...s, content: res.data.content} : s)
                    }));
                })
                .catch(err => {
                    console.error("获取完整输入脚本内容失败:", err);
                    setEditingStepInputContent(inputScript.content_preview || ''); // Fallback
                });
        } else {
            inputContent = inputScript.content || inputScript.content_preview || '';
        }
        inputId = inputScript.id;
      }
    }
    setEditingStepInputContent(inputContent);
    setCurrentInputScriptId(inputId);
  }, [setEditingStepInputContent, setCurrentInputScriptId]); // 移除 setContentDetail
  
  useEffect(() => {
    const currentActiveStep = workflowSteps.find(step => step.key === activeStepKey);
    if (currentActiveStep && contentDetail) {
      if (!isEditingInput || activeStepKey !== workflowSteps.find(s => s.key === activeStepKey)?.key) { 
          initializeStepInput(currentActiveStep, contentDetail);
      }
    }
  }, [activeStepKey, contentDetail, workflowSteps, initializeStepInput, isEditingInput]);

  useEffect(() => {
    fetchContentDetail();
    return () => {
        Object.values(pollingIntervalsRef.current).forEach(val => {
            if (val && typeof val === 'object' && val.intervalId) { // 假设存储的是对象 { taskId, intervalId }
                 clearInterval(val.intervalId);
            } else if (typeof val === 'number') { // 旧的直接存储 intervalId
                 clearInterval(val);
            }
        });
        pollingIntervalsRef.current = {};
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
            audioRef.current.load();
            audioRef.current = null;
        }
    };
  }, [fetchContentDetail]); // fetchContentDetail 已被 useCallback 包裹

  // 修改 stopPollingForTask 以处理不同类型的任务存储
  const stopPollingForTask = (taskId, taskType = 'default') => {
    const pollingKey = `${taskType}_${taskId}`;
    if (pollingIntervalsRef.current[pollingKey]) {
      clearInterval(pollingIntervalsRef.current[pollingKey]);
      const newIntervals = { ...pollingIntervalsRef.current };
      delete newIntervals[pollingKey];
      pollingIntervalsRef.current = newIntervals;
      console.log(`Stopped polling for task: ${pollingKey}`);
    } else if (pollingIntervalsRef.current[taskId] && taskType === 'default') { // 兼容旧的只用 taskId 作为 key
        clearInterval(pollingIntervalsRef.current[taskId]);
        const newIntervals = { ...pollingIntervalsRef.current };
        delete newIntervals[taskId];
        pollingIntervalsRef.current = newIntervals;
        console.log(`Stopped polling for task (legacy key): ${taskId}`);
    }
  };

  const handleWorkflowStepClick = (stepKey) => {
    if (activeStepKey !== stepKey) {
      setActiveStepKey(stepKey);
      setIsEditingInput(false); 
    }
  };

  const handleEditInputScript = () => setIsEditingInput(true);

  const handleSaveEditedInputScript = async () => {
    if (!currentInputScriptId) {
        setAlert({ open: true, message: '没有可保存的输入脚本ID。', severity: 'warning' });
        return;
    }
    if (!editingStepInputContent.trim()) {
        setAlert({ open: true, message: '输入脚本内容不能为空。', severity: 'warning' });
        return;
    }
    const loadingKey = `save_input_script_${currentInputScriptId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    try {
        await ttsApi.updateScriptContent(currentInputScriptId, editingStepInputContent.trim());
        setAlert({ open: true, message: '输入脚本保存成功！', severity: 'success' });
        setIsEditingInput(false);
        fetchContentDetail(false); // 重新获取详情以更新所有数据
    } catch (error) {
        console.error("保存输入脚本失败:", error);
        setAlert({ open: true, message: `保存输入脚本失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };
  
  const handleRecreateOutput = (actionName, inputScriptIdForAction) => {
    const currentStepDetails = workflowSteps.find(s => s.key === activeStepKey);
    let scriptIdToUse = inputScriptIdForAction;

    if (!currentStepDetails) return;

    if (currentStepDetails.inputScriptTypeKey && currentStepDetails.inputScriptTypeKey !== 'original_content') {
        const inputScripts = contentDetail?.scripts
            .filter(s => s.script_type === currentStepDetails.inputScriptTypeKey)
            .sort((a,b) => b.version - a.version);
        if (inputScripts && inputScripts.length > 0) {
            scriptIdToUse = inputScripts[0].id;
        } else if (actionName !== 'generateOralScript') { 
            setAlert({open: true, message: `无法重新生成：未找到 ${currentStepDetails.inputLabel}。`, severity: 'warning'});
            return;
        }
    }
    // 对于 splitSentences，它需要最新的 final_tts_script ID
    if (actionName === 'splitSentences') {
        const finalScripts = contentDetail?.scripts?.filter(s => s.script_type === 'final_tts_script').sort((a,b) => b.version - a.version);
        if (finalScripts && finalScripts.length > 0) {
            scriptIdToUse = finalScripts[0].id;
        } else {
            setAlert({open: true, message: `无法拆分句子：未找到最终TTS脚本。`, severity: 'warning'});
            return;
        }
    }


    handleAction(actionName, scriptIdToUse, contentId);
  };

  const handleOpenFullScriptDialog = async (scriptOrOriginalData) => {
    if (!scriptOrOriginalData || !scriptOrOriginalData.script_type) {
        setAlert({ open: true, message: '无效的数据用于显示对话框', severity: 'error' });
        return;
    }
    const isOriginal = scriptOrOriginalData.script_type === 'Original Content';
    let fullContentToDisplay = '';
    let dialogTitle = '';
    let scriptId = null;
    let scriptTypeForDialog = scriptOrOriginalData.script_type;

    if (isOriginal) {
        fullContentToDisplay = contentDetail?.original_content || scriptOrOriginalData.content || "加载原文中...";
        dialogTitle = '原始培训内容 - 查看/编辑';
    } else if (scriptOrOriginalData.id) {
        scriptId = scriptOrOriginalData.id;
        scriptTypeForDialog = scriptOrOriginalData.script_type; // 确保使用从对象获取的类型
        try {
            const response = await ttsApi.getScriptContent(scriptId);
            fullContentToDisplay = response.data.content;
            dialogTitle = `${response.data.script_type} (v${response.data.version}) - 查看/编辑`;
        } catch (error) {
            setAlert({ open: true, message: '获取脚本完整内容失败', severity: 'error' });
            return;
        }
    } else {
        setAlert({ open: true, message: '无效的脚本信息或类型', severity: 'error' });
        return;
    }
    setEditingDialogScriptContent(fullContentToDisplay);
    setShowFullScriptDialog({
        open: true,
        title: dialogTitle,
        content: fullContentToDisplay, // 仅用于初始显示，编辑通过 editingDialogScriptContent
        scriptId: scriptId,
        scriptType: scriptTypeForDialog,
        isOriginalContent: isOriginal
    });
  };

  const handleSaveDialogEditedScript = async () => {
    if (!editingDialogScriptContent.trim() && !showFullScriptDialog.isOriginalContent) {
        setAlert({open: true, message: '脚本内容不能为空。', severity: 'warning'});
        return;
    }
    const loadingKey = showFullScriptDialog.isOriginalContent 
        ? `save_original_content_${contentId}` 
        : `save_dialog_script_${showFullScriptDialog.scriptId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    try {
        if (showFullScriptDialog.isOriginalContent) {
            if (!contentId) throw new Error("内容ID丢失。");
            await ttsApi.updateOriginalTrainingContent(contentId, editingDialogScriptContent); // 使用 editingDialogScriptContent
            setAlert({ open: true, message: '原始培训内容保存成功！', severity: 'success' });
        } else if (showFullScriptDialog.scriptId) {
            await ttsApi.updateScriptContent(showFullScriptDialog.scriptId, editingDialogScriptContent.trim());
            setAlert({ open: true, message: '脚本保存成功！', severity: 'success' });
        } else {
             throw new Error("无法确定保存目标。");
        }
        setShowFullScriptDialog({ open: false, title: '', content: '', scriptId: null, scriptType: '', isOriginalContent: false });
        fetchContentDetail(false); // 重新获取数据
    } catch (error) {
        console.error("保存内容失败:", error);
        setAlert({ open: true, message: `保存失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };
  
  const handleAction = async (actionType, scriptIdForAction = null, associatedContentId = null) => {
    const currentContentId = associatedContentId || contentId;
    const loadingKey = scriptIdForAction ? `${actionType}_${scriptIdForAction}` : `${actionType}_${currentContentId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));

    try {
        let apiCall;
        let taskType = actionType; // 用于轮询分类
        let successMessage = ''; // 将 successMessage 定义在 switch 外部

        switch (actionType) {
            case 'generateOralScript':
                apiCall = ttsApi.generateOralScript(currentContentId);
                successMessage = '口播稿生成任务已提交。';
                break;
            case 'triggerTtsRefine':
                if (!scriptIdForAction) throw new Error("需要口播稿ID来优化");
                apiCall = ttsApi.triggerTtsRefine(scriptIdForAction);
                successMessage = 'LLM最终修订任务已提交。';
                break;
            case 'triggerLlmRefine':
                if (!scriptIdForAction) throw new Error("需要TTS Refine稿ID来进行LLM润色");
                apiCall = ttsApi.triggerLlmRefine(scriptIdForAction);
                successMessage = 'TTS Refine 任务已提交。';
                break;
            case 'splitSentences':
                if (!scriptIdForAction) throw new Error("需要最终脚本ID来拆分句子");
                apiCall = ttsApi.splitSentences(scriptIdForAction);
                successMessage = '句子拆分任务已提交。'; // 后端是同步的，但前端可以先显示这个
                break;
            default:
                throw new Error("未知的操作类型");
        }
        
        const response = await apiCall; // 等待API调用返回任务ID
        
        setAlert({ open: true, message: response.data.message || '任务已提交', severity: 'info' });

        if (response.data.task_id) {
            // 使用 startPolling 启动轮询
            startPolling(response.data.task_id, taskType, `正在处理: ${actionType}`);
            // 立即更新UI状态
            if (contentDetail) {
                let newStatus = contentDetail.status;
                if(actionType === 'generateOralScript') newStatus = 'processing_oral_script';
                if(actionType === 'triggerTtsRefine') newStatus = 'processing_tts_refine';
                if(actionType === 'triggerLlmRefine') newStatus = 'processing_llm_final_refine';
                setContentDetail(prev => ({...prev, status: newStatus}));
            }
        } else {
            fetchContentDetail(false); // 如果没有task_id，直接刷新
        }

    } catch (error) {
        console.error(`操作 ${actionType} 失败:`, error);
        const apiError = error.response?.data?.error || error.message;
        setAlert({ open: true, message: `操作失败: ${apiError}`, severity: 'error' });
        fetchContentDetail(false); // 失败时也刷新状态
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
};

  
  const handlePlayAudio = (sentenceIdOrMergedUrl, audioUrlOrType) => {
    let fullAudioUrl;
    let playingId;

    if (typeof audioUrlOrType === 'string' && audioUrlOrType.startsWith('merged_')) { // 播放合并的音频
        fullAudioUrl = sentenceIdOrMergedUrl; //此时第一个参数是 URL
        playingId = 'merged_audio';
    } else { // 播放单句
        if (!audioUrlOrType) {
            setAlert({ open: true, message: '该句子还没有可播放的语音。', severity: 'warning' });
            return;
        }
        fullAudioUrl = audioUrlOrType.startsWith('http') ? audioUrlOrType : `${API_BASE_URL.replace('/api', '')}/media/tts_audio/${audioUrlOrType}`;
        playingId = sentenceIdOrMergedUrl; // 此时第一个参数是 sentenceId
    }
    
    if (playingAudio && playingAudio.id === playingId) {
      if (audioRef.current) audioRef.current.pause();
      setPlayingAudio(null);
    } else {
      if (audioRef.current) audioRef.current.pause();
      const newAudio = new Audio(fullAudioUrl);
      audioRef.current = newAudio;
      newAudio.play()
        .then(() => setPlayingAudio({ id: playingId, url: fullAudioUrl }))
        .catch(err => {
          setAlert({ open: true, message: `播放音频失败: ${err.message || '无法加载音频资源。'}`, severity: 'error' });
          setPlayingAudio(null);
        });
      newAudio.onended = () => setPlayingAudio(null);
      newAudio.onerror = (e) => {
        setAlert({ open: true, message: `无法播放音频: ${e.target.error?.message || '未知播放错误。'}`, severity: 'error' });
        setPlayingAudio(null);
      };
    }
  };

  const handleUpdateSentence = async (sentenceId, newText) => {
    const loadingKey = `update_sentence_${sentenceId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    try {
        await ttsApi.updateSentence(sentenceId, { sentence_text: newText });
        setAlert({ open: true, message: '句子更新成功！语音状态已重置，请重新生成。', severity: 'success' });
        fetchContentDetail(false); 
    } catch (error) {
        setAlert({ 
            open: true, 
            message: `更新句子失败: ${error.response?.data?.error || error.message || '未知错误'}`, 
            severity: 'error' 
        });
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };

  const pollTaskStatus = useCallback((taskId, isBatchTask = false, taskType = 'default') => {
    const pollingKey = `${taskType}_${taskId}`;
    stopPollingForTask(taskId, taskType); // 确保使用正确的 key 停止
    
    const intervalId = setInterval(async () => {
      try {
        const response = await ttsApi.getTaskStatus(taskId);
        const taskData = response.data;

        if (taskType === 'merge') {
            setMergeProgress(prev => ({
                ...(prev || { task_id: taskId }), // 确保 task_id 存在
                status: taskData.status,
                current_step: taskData.meta?.current_step || prev?.current_step,
                total_sentences: taskData.meta?.total_sentences ?? prev?.total_sentences ?? 0,
                processed_count: taskData.meta?.merged_count ?? taskData.meta?.checked_sentences ?? prev?.processed_count ?? 0,
                message: taskData.meta?.message || taskData.result?.message || prev?.message || '状态更新中...',
                merged_audio_id: taskData.result?.merged_audio_id || prev?.merged_audio_id,
            }));

            if (taskData.status === 'SUCCESS' || taskData.status === 'FAILURE') {
                stopPollingForTask(taskId, taskType);
                setAlert({
                    open: true,
                    message: `合并任务 ${taskData.status === 'SUCCESS' ? '完成' : '失败'}: ${taskData.meta?.message || taskData.result?.message || taskData.error_message || ''}`,
                    severity: taskData.status === 'SUCCESS' ? 'success' : 'error'
                });
                fetchContentDetail(false); 
            }
        } else if (isBatchTask) { // 批量语音生成
            if (taskData.meta && typeof taskData.meta === 'object') {
                const currentMeta = taskData.meta;
                setOverallProgress(prev => ({
                  total_in_batch: currentMeta.total_in_batch ?? prev?.total_in_batch ?? 0,
                  processed_in_batch: currentMeta.processed_in_batch ?? prev?.processed_in_batch ?? 0,
                  succeeded_in_batch: currentMeta.succeeded_in_batch ?? prev?.succeeded_in_batch ?? 0,
                  failed_in_batch: currentMeta.failed_in_batch ?? prev?.failed_in_batch ?? 0,
                  current_sentence_text: currentMeta.current_sentence_text || currentMeta.current_sentence_id || prev?.current_sentence_text, // 使用 current_sentence_id 作为备选
                  message: currentMeta.message || prev?.message || '状态更新中...'
                }));
                // ... (您原有的批量任务中更新单个句子状态的逻辑，如果后端 meta 中包含)
                const { last_processed_sentence_id, last_processed_sentence_status, current_sentence_id } = currentMeta;
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
                } else if (current_sentence_id && taskData.status === 'PROGRESS' && overallProgress && currentMeta.processed_in_batch !== overallProgress.processed_in_batch) {
                    // 如果只有 current_sentence_id，且进度有变化，也刷新一下列表，以便单句状态（如 generating）能更新
                    fetchContentDetail(false);
                }
            }
            if (taskData.status === 'SUCCESS' || taskData.status === 'FAILURE') {
                stopPollingForTask(taskId, taskType);
                const finalStats = taskData.result || taskData.meta;
                setOverallProgress({
                    total_in_batch: finalStats?.total_in_batch ?? 0,
                    processed_in_batch: finalStats?.processed_in_batch ?? 0,
                    succeeded_in_batch: finalStats?.succeeded_in_batch ?? 0,
                    failed_in_batch: finalStats?.failed_in_batch ?? 0,
                    message: finalStats?.message || (taskData.status === 'FAILURE' ? (taskData.error_message || '任务处理失败') : '处理完毕')
                });
                setAlert({
                    open: true,
                    message: `批量语音生成任务 ${taskId.substring(0,6)}... ${taskData.status === 'SUCCESS' ? '完成' : '失败'}: ${finalStats?.message || taskData.error_message || ''}`,
                    severity: taskData.status === 'SUCCESS' ? 'success' : 'error'
                });
                fetchContentDetail(false); 
            }
        } else { // 普通脚本处理, 单句语音生成
            if (taskData.status === 'SUCCESS' || taskData.status === 'FAILURE') {
                stopPollingForTask(taskId, taskType);
                fetchContentDetail(false); // 总是刷新以获取最新状态
                setAlert({
                    open: true,
                    message: `${taskData.task_name || '处理操作'} ${taskData.status === 'SUCCESS' ? '成功' : '失败'}。${taskData.result?.message || taskData.error_message || ''}`,
                    severity: taskData.status === 'SUCCESS' ? 'success' : 'error'
                });
            } else if (taskData.status === 'PROGRESS' && taskData.meta) {
                 // 对于这类任务，如果进度有变化，也可能需要刷新列表
                 if (taskType === 'single_audio_gen' && overallProgress && taskData.meta?.current_sentence_id !== overallProgress.current_sentence_id) {
                    fetchContentDetail(false);
                 }
            }
        }
      } catch (error) {
        console.error(`轮询任务 ${taskId} (类型: ${taskType}) 状态失败:`, error);
        stopPollingForTask(taskId, taskType);
        setAlert({open: true, message: `轮询任务 ${taskId.substring(0,6)}... 进度失败`, severity: 'error'});
        if (taskType === 'merge') {
            setMergeProgress(prev => ({ ...(prev || { task_id: taskId }), message: "轮询合并进度失败"}));
        } else if (isBatchTask) {
            setOverallProgress(prev => ({ ...(prev || {}), message: "轮询批量生成进度失败"}));
        }
      }
    }, 2500); 
    pollingIntervalsRef.current = { ...pollingIntervalsRef.current, [pollingKey]: intervalId };
    console.log(`Started polling for task: ${pollingKey}`);
  }, [fetchContentDetail, overallProgress]); // 移除 mergeProgress

  const handleBatchGenerateAudio = async () => {
    if (!contentId || !contentDetail || !contentDetail.final_script_sentences) {
        setAlert({ open: true, message: '无法启动批量任务：内容数据不完整。', severity: 'error' });
        return;
    }
    const loadingKey = `batch_generate_${contentId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    const sentencesForBatch = contentDetail.final_script_sentences.filter(s =>
        ['pending_generation', 'error_generation', 'pending_regeneration', 'error_submission', 'error_polling', 'queued', undefined, null, ''].includes(s.audio_status)
    );
    const initialTotalInBatch = sentencesForBatch.length;

    if (initialTotalInBatch === 0) {
        setOverallProgress({ 
            total_in_batch: 0, processed_in_batch: 0, succeeded_in_batch: 0,
            failed_in_batch: 0, message: "没有需要生成语音的句子。"
        });
        setAlert({ open: true, message: "所有句子的语音都已是最新或正在处理中。", severity: 'info' });
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
        return;
    }
    setOverallProgress({ // 初始化进度条
        total_in_batch: initialTotalInBatch, processed_in_batch: 0, succeeded_in_batch: 0,
        failed_in_batch: 0, current_sentence_text: null,
        message: `正在提交 ${initialTotalInBatch} 个句子的生成任务...`
    });
    setContentDetail(prev => { // 立即更新前端句子状态为 "queued"
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
            setOverallProgress(prev => ({
                ...prev,
                task_id: response.data.task_id, // 保存 task_id 到进度对象
                message: response.data.initial_message || "任务已提交，等待 Worker 处理...",
            }));
            pollTaskStatus(response.data.task_id, true, 'batch_audio_gen'); // true 表示批量, 指定类型
        } else {
            setOverallProgress(null); // 如果没有 task_id，清除进度
            fetchContentDetail(false); // 刷新获取真实状态
        }
    } catch (error) {
        setAlert({ open: true, message: `批量生成语音失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        setOverallProgress(null);
        fetchContentDetail(false);
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };

  const handleGenerateSentenceAudio = async (sentenceId) => {
    const loadingKey = `sentence_${sentenceId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
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
        pollTaskStatus(response.data.task_id, false, 'single_audio_gen'); // false 表示非批量, 指定类型
      } else {
        fetchContentDetail(false);
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

  const handleDeleteSentence = async (sentenceId) => {
    const loadingKey = `delete_sentence_${sentenceId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    try {
        await ttsApi.deleteSentence(sentenceId);
        setAlert({ open: true, message: '句子删除成功！', severity: 'success' });
        fetchContentDetail(false); // 重新获取详情
    } catch (error) {
        setAlert({ open: true, message: `删除句子失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };

  // 新增：处理语音合并的函数
  const handleMergeAudio = async () => {
    if (!contentId) return;
    const loadingKey = `merge_audio_${contentId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    setMergeProgress({ // 初始化合并进度
        task_id: null,
        status: 'PENDING',
        current_step: 'submitting_task',
        message: '正在提交合并任务...',
        total_sentences: contentDetail?.final_script_sentences?.length || 0,
        processed_count: 0,
    });

    try {
        // 前端预检：所有句子是否都已生成语音
        const allSentencesGenerated = contentDetail?.final_script_sentences?.every(s => s.audio_status === 'generated');
        if (!allSentencesGenerated) {
            setAlert({ open: true, message: '并非所有句子都已成功生成语音，请先完成所有句子的语音生成。', severity: 'warning' });
            setMergeProgress(null);
            setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
            return;
        }

        const response = await ttsApi.mergeAudio(contentId); // 调用 API
        setAlert({ open: true, message: response.data.message || '语音合并任务已提交。', severity: 'info' });
        if (response.data.task_id) {
            setMergeProgress(prev => ({
                ...prev,
                task_id: response.data.task_id,
                message: "任务已提交，等待 Worker 处理...",
            }));
            pollTaskStatus(response.data.task_id, false, 'merge'); // 使用 'merge' 类型轮询
        } else {
            setMergeProgress(null);
            fetchContentDetail(false); // 如果没有 task_id，直接刷新
        }
    } catch (error) {
        setAlert({ open: true, message: `语音合并失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        setMergeProgress(null); // 出错时清除进度
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };

  const handleExportSrt = () => {
    if (!contentDetail || !contentDetail.final_script_sentences || !contentDetail.latest_merged_audio?.segments) {
        setAlert({ open: true, message: '没有足够的数扰生成SRT文件。', severity: 'warning' });
        return;
    }

    let srtContent = '';
    let counter = 1;

    // 确保句子按 order_index 排序，以匹配 segments 的顺序 (如果 segments 保证了这一点)
    const sortedSentences = [...contentDetail.final_script_sentences].sort((a, b) => a.order_index - b.order_index);

    sortedSentences.forEach(sentence => {
        const segment = contentDetail.latest_merged_audio.segments.find(
            seg => seg.tts_sentence_id === sentence.id && seg.original_order_index === sentence.order_index
        );

        if (segment) {
            const startTime = formatMsToSrtTime(segment.start_ms);
            const endTime = formatMsToSrtTime(segment.end_ms);
            // 使用 segment 中的 original_sentence_text_ref，因为它是在合并时记录的文本
            const text = segment.original_sentence_text_ref || sentence.text; // Fallback to current text if ref is missing

            srtContent += `${counter}\n`;
            srtContent += `${startTime} --> ${endTime}\n`;
            srtContent += `${text}\n\n`;
            counter++;
        }
    });

    if (!srtContent) {
        setAlert({ open: true, message: '未能生成SRT内容，可能是时间戳信息不完整。', severity: 'warning' });
        return;
    }

    const blob = new Blob([srtContent], { type: 'text/srt;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${contentDetail.content_name || 'audio_subtitle'}.srt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setAlert({ open: true, message: 'SRT字幕文件已开始下载。', severity: 'success' });
  };

  // TODO: 实现 handleRemergeAudio 函数
  const handleRemergeAudio = async () => {
    setAlert({open: true, message: "智能重新合并功能待实现。", severity: "info"});
    // 类似 handleMergeAudio，但调用不同的 API，可能需要传递更多参数
    // 例如： ttsApi.remergeAudio(contentId, { modified_sentence_id: '...' })
  };


  const currentActiveStepDetails = workflowSteps.find(s => s.key === activeStepKey);
  
  // 为当前活动步骤的输入区准备脚本内容
  let inputScriptForDisplay = null;
  if (contentDetail && currentActiveStepDetails && currentActiveStepDetails.key !== 'generateAndMergeAudio') {
    if (currentActiveStepDetails.inputScriptTypeKey === 'original_content') {
        // 对于原文，如果正在编辑，显示编辑中的内容，否则显示 contentDetail 中的内容
        inputScriptForDisplay = { 
            content: isEditingInput && activeStepKey === currentActiveStepDetails.key ? editingStepInputContent : (contentDetail.original_content || "加载原始文本..."), 
            id: null, 
            script_type: 'Original Content' 
        };
    } else if (currentActiveStepDetails.inputScriptTypeKey && contentDetail.scripts) {
        const inputScriptsOfType = contentDetail.scripts
            .filter(s => s.script_type === currentActiveStepDetails.inputScriptTypeKey)
            .sort((a, b) => b.version - a.version); // 最新版本优先
        if (inputScriptsOfType.length > 0) {
            const latestInputScript = inputScriptsOfType[0];
            // 如果正在编辑当前活动步骤的输入，且currentInputScriptId匹配，则显示编辑中的内容
            inputScriptForDisplay = {
                ...latestInputScript,
                content: (isEditingInput && activeStepKey === currentActiveStepDetails.key && currentInputScriptId === latestInputScript.id) 
                           ? editingStepInputContent 
                           : (latestInputScript.content || latestInputScript.content_preview || "加载输入脚本内容...")
            };
        }
    }
  }


  if (loading && !contentDetail) { // 初始加载时显示菊花图
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}><CircularProgress /></Box>;
  }
  if (errorStateForDisplay) {
    return <Typography color="error" sx={{p:2}}>{errorStateForDisplay}</Typography>;
  }
  if (!contentDetail) {
    return <Typography sx={{p:2}}>未找到培训内容或正在加载...</Typography>;
  }

  const canTriggerMerge = contentDetail?.final_script_sentences?.length > 0 && 
                          contentDetail.final_script_sentences.every(s => s.audio_status === 'generated');
  const mergedAudioExists = !!contentDetail?.latest_merged_audio;


  return (
    <Box>
      <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({ ...prev, open: false }))} />
      <PageHeader
        title={`培训内容: ${contentDetail?.content_name || '...'}`}
        description={`状态: ${contentDetail?.status || '未知'} | 创建于: ${contentDetail?.created_at ? formatRelativeTime(contentDetail.created_at) : ''} by ${contentDetail?.uploader_username || 'N/A'}`}
        actionButton={
            <Button onClick={() => navigate(-1)} startIcon={<ArrowBackIcon />}>返回</Button>
        }
      />
      {isPolling && pollingTask && (
        <Paper elevation={2} sx={{ p: 2, mb: 2, backgroundColor: '#e3f2fd' }}>
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
                后台任务处理中...
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <CircularProgress size={20} />
                <Box>
                    <Typography variant="body2">
                        任务类型: <strong>{pollingTask.type}</strong>
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        状态: {pollingTask.message}
                    </Typography>
                </Box>
            </Box>
            <LinearProgress variant="indeterminate" sx={{ mt: 1 }} />
        </Paper>
    )}
      
      {/* 批量语音生成进度条 (仅当不处于合并步骤时显示，避免重复) */}
      {overallProgress && activeStepKey !== 'generateAndMergeAudio' && (
        <Paper sx={{ p: 2, mb: 2, backgroundColor: '#e3f2fd' }}>
          <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
            批量语音生成进度 (任务ID: {overallProgress.task_id?.substring(0,8) || 'N/A'}):
          </Typography>
          <Box>
              <Typography variant="body2">
                  总共待处理: {overallProgress.total_in_batch ?? 'N/A'} |
                  已处理: {overallProgress.processed_in_batch ?? 0} |
                  成功: {overallProgress.succeeded_in_batch ?? 0} |
                  失败: {overallProgress.failed_in_batch ?? 0}
              </Typography>
              {overallProgress.current_sentence_text && (
                  <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
                  当前处理: {overallProgress.current_sentence_text.substring(0,50) + (overallProgress.current_sentence_text.length > 50 ? '...' : '')}
                  </Typography>
              )}
              {(overallProgress.message) && ( // 总是显示消息
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    状态信息: {overallProgress.message}
                </Typography>
              )}
              <LinearProgress
                  variant="determinate"
                  value={
                    (typeof overallProgress.total_in_batch === 'number' && overallProgress.total_in_batch > 0 && typeof overallProgress.processed_in_batch === 'number')
                      ? Math.round((overallProgress.processed_in_batch / overallProgress.total_in_batch) * 100)
                      : (overallProgress.status === 'SUCCESS' && overallProgress.total_in_batch > 0 &&
                         (overallProgress.succeeded_in_batch + overallProgress.failed_in_batch) === overallProgress.total_in_batch)
                        ? 100
                        : 0
                  }
                  sx={{ mt: 1, height: 10, borderRadius: 5, backgroundColor: '#b3e5fc' }}
                  color={ (overallProgress.failed_in_batch ?? 0) > 0 ? "error" : "primary" }
              />
          </Box>
        </Paper>
      )}

      {/* 语音合并进度条 (仅当处于合并步骤时显示) */}
      {mergeProgress && activeStepKey === 'generateAndMergeAudio' && (
        <Paper variant="outlined" sx={{ p: 2, mt:2, mb: 3, backgroundColor: '#e8f5e9' }}>
            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
              语音合并进度 (任务ID: {mergeProgress.task_id?.substring(0,8) || 'N/A'}):
            </Typography>
            <Box>
                <Typography variant="body2">
                    状态: {mergeProgress.status || '未知'} | 
                    步骤: {mergeProgress.current_step || 'N/A'}
                </Typography>
                {typeof mergeProgress.total_sentences === 'number' && (
                    <Typography variant="body2">
                        总句子数: {mergeProgress.total_sentences} | 
                        已处理: {mergeProgress.processed_count || 0}
                    </Typography>
                )}
                  <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
                    信息: {mergeProgress.message || '等待更新...'}
                </Typography>
                {(mergeProgress.status === 'PROGRESS' || mergeProgress.status === 'PENDING') && typeof mergeProgress.total_sentences === 'number' && mergeProgress.total_sentences > 0 && (
                    <LinearProgress
                        variant="determinate"
                        value={Math.round(((mergeProgress.processed_count || 0) / mergeProgress.total_sentences) * 100)}
                        sx={{ mt: 1, height: 10, borderRadius: 5 }}
                        color={mergeProgress.status === 'FAILURE' ? "error" : "success"} // 用 success 或 primary
                    />
                )}
                {mergeProgress.status === 'SUCCESS' && mergeProgress.merged_audio_id && contentDetail?.latest_merged_audio?.id === mergeProgress.merged_audio_id && (
                      <Chip icon={<CheckCircleIcon />} label="合并完成！" color="success" sx={{mt:1}} />
                )}
                  {mergeProgress.status === 'FAILURE' && (
                      <Chip icon={<ErrorIcon />} label="合并失败" color="error" sx={{mt:1}} />
                  )}
            </Box>
        </Paper>
      )}


      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>工作流程</Typography>
        <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 1, mb: 2, alignItems: 'center' }}>
          {workflowSteps.map((step, index) => {
            const isStepActive = activeStepKey === step.key;
            let prevStepCompleted = index === 0; 
            if (index > 0) {
                const prevStep = workflowSteps[index-1];
                prevStepCompleted = prevStep.isCompleted ? 
                    prevStep.isCompleted(contentDetail?.status, contentDetail?.scripts, contentDetail?.final_script_sentences, contentDetail?.latest_merged_audio)
                    : false;
            }
            const isThisStepItselfCompleted = step.isCompleted ? 
                step.isCompleted(contentDetail?.status, contentDetail?.scripts, contentDetail?.final_script_sentences, contentDetail?.latest_merged_audio)
                : false;
            const isStepEnabled = step.isEnabled ? 
                step.isEnabled(contentDetail?.status, prevStepCompleted, contentDetail?.final_script_sentences) 
                : prevStepCompleted; 

            return (
              <React.Fragment key={step.key}>
                <Button
                  variant={isStepActive ? "contained" : "outlined"}
                  onClick={() => handleWorkflowStepClick(step.key)}
                  disabled={!isStepEnabled && !isThisStepItselfCompleted} 
                  sx={{textTransform: 'none', flexShrink: 0, whiteSpace: 'nowrap'}}
                  color={isThisStepItselfCompleted ? "success" : (isStepActive ? "primary" : "inherit")}
                >
                  {isThisStepItselfCompleted && !isStepActive && <CheckCircleIcon fontSize="small" sx={{mr: 0.5}}/>}
                  {step.label}
                </Button>
                {index < workflowSteps.length - 1 && <KeyboardArrowRightIcon color="disabled" />}
              </React.Fragment>
            );
          })}
        </Stack>

        {currentActiveStepDetails && contentDetail && (
          <Box mt={2}>
            <Typography variant="h5" gutterBottom sx={{mb:2}}>{currentActiveStepDetails.label}</Typography>
            
            {currentActiveStepDetails.key === 'splitSentences' ? ( // 第四步：脚本拆分句子
              <Box>
                <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h6">
                      {currentActiveStepDetails.inputLabel} (最新版本)
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      {isEditingInput ? ( // 如果正在编辑输入脚本
                        <Button 
                            variant="contained" size="small" startIcon={<SaveIcon />} 
                            onClick={handleSaveEditedInputScript} // 调用保存函数
                            disabled={actionLoading[`save_input_script_${currentInputScriptId}`] || !currentInputScriptId}
                        >
                            {actionLoading[`save_input_script_${currentInputScriptId}`] ? <CircularProgress size={16}/> : "保存更改"} {/* 修改按钮文本 */}
                        </Button>
                      ) : ( // 如果不在编辑状态
                        <Button 
                            variant="outlined" size="small" startIcon={<EditIcon />} 
                            onClick={handleEditInputScript} // 点击后 isEditingInput 会变为 true
                            disabled={!currentInputScriptId || actionLoading[`${currentActiveStepDetails.actionName}_${currentInputScriptId}`]} // 如果正在拆分，也禁用编辑
                        > 编辑脚本 </Button> // 修改按钮文本
                      )}
                      {isEditingInput && ( // 仅在编辑时显示取消按钮
                          <Button variant="outlined" size="small" onClick={() => {setIsEditingInput(false); initializeStepInput(currentActiveStepDetails, contentDetail); }}>
                              取消编辑
                          </Button>
                      )}
                      {/* “重新拆分”按钮 */}
                      <Tooltip title={isEditingInput ? "请先保存对输入脚本的修改" : "使用当前显示的最终脚本内容进行拆分"}>
                        <span> {/* Tooltip 需要一个子元素来包裹 disabled 按钮 */}
                            <Button
                                variant="contained" color="primary" size="small"
                                startIcon={actionLoading[`${currentActiveStepDetails.actionName}_${currentInputScriptId}`] ? <CircularProgress size={16} color="inherit"/> : <CachedIcon />}
                                onClick={() => {
                                    // 如果选择方案2（自动保存），则在这里先调用 handleSaveEditedInputScript
                                    // if (isEditingInput) {
                                    //   await handleSaveEditedInputScript(); // 需要处理异步和保存失败的情况
                                    // }
                                    // if (!isEditingInput) { // 确保不是在编辑状态下，或者保存成功后
                                    //   handleRecreateOutput(currentActiveStepDetails.actionName, currentInputScriptId)
                                    // }
                                    handleRecreateOutput(currentActiveStepDetails.actionName, currentInputScriptId);
                                }}
                                disabled={
                                    isEditingInput || // 如果正在编辑，则禁用“重新拆分”
                                    actionLoading[`${currentActiveStepDetails.actionName}_${currentInputScriptId}`] || 
                                    !contentDetail?.scripts?.find(s => s.script_type === 'final_tts_script') // 确保有最终脚本
                                }
                            > 重新拆分 </Button>
                        </span>
                      </Tooltip>
                    </Stack>
                  </Box>
                  {isEditingInput ? ( // 如果正在编辑，显示 Textarea
                    <TextareaAutosize
                      minRows={10}
                      style={{ width: '100%', padding: '8px', fontFamily: 'monospace', border: '1px solid #ccc', borderRadius: '4px', flexGrow: 1, fontSize:'0.9rem' }}
                      value={editingStepInputContent}
                      onChange={(e) => setEditingStepInputContent(e.target.value)}
                    />
                  ) : ( // 否则显示只读的脚本内容
                    <Box sx={{ flexGrow: 1, overflowY: 'auto', whiteSpace: 'pre-wrap', p:1, border: '1px solid #eee', borderRadius: 1, maxHeight: 300, minHeight: 150, backgroundColor: '#f9f9f9' }}>
                      {inputScriptForDisplay?.content || "无最终脚本内容或等待加载..."}
                    </Box>
                  )}
                </Paper>
                {contentDetail.final_script_sentences && contentDetail.final_script_sentences.length > 0 && (
                    <SentenceList // 假设 SentenceList 已根据方案一或方案二修改好
                        sentences={contentDetail.final_script_sentences}
                        playingAudio={playingAudio} actionLoading={actionLoading}
                        onPlayAudio={handlePlayAudio} onGenerateAudio={handleGenerateSentenceAudio}
                        onUpdateSentenceText={handleUpdateSentence} onDeleteSentence={handleDeleteSentence}
                        mergedAudioSegments={contentDetail?.latest_merged_audio?.segments}
                    />
                )}
              </Box>

            ) : currentActiveStepDetails.key === 'generateAndMergeAudio' ? (
              <Box>
                <Stack direction={{xs: 'column', sm: 'row'}} spacing={2} sx={{mb:2, alignItems: 'flex-start'}}>
                    <Button 
                        variant="contained" 
                        onClick={handleBatchGenerateAudio} 
                        disabled={actionLoading[`batch_generate_${contentId}`] || loading || !contentDetail?.final_script_sentences?.length} 
                        startIcon={(actionLoading[`batch_generate_${contentId}`] || (overallProgress && (overallProgress.status === 'PROGRESS' || overallProgress.status === 'PENDING'))) ? <CircularProgress size={16} /> : <PlaylistPlayIcon />}
                    >
                        {overallProgress && (overallProgress.status === 'PROGRESS' || overallProgress.status === 'PENDING') ? "批量生成中..." : "批量生成所有待处理语音"}
                    </Button>
                    <Button 
                        variant="contained" 
                        color="secondary" 
                        onClick={handleMergeAudio} 
                        disabled={
                            actionLoading[`merge_audio_${contentId}`] || 
                            (mergeProgress && (mergeProgress.status === 'PROGRESS' || mergeProgress.status === 'PENDING')) ||
                            !canTriggerMerge // 使用计算好的状态
                        } 
                        startIcon={(actionLoading[`merge_audio_${contentId}`] || (mergeProgress && (mergeProgress.status === 'PROGRESS' || mergeProgress.status === 'PENDING'))) ? <CircularProgress size={16} /> : <CloudUploadIcon />}
                    >
                        {(mergeProgress && (mergeProgress.status === 'PROGRESS' || mergeProgress.status === 'PENDING')) ? '合并中...' : '合并所有语音'}
                    </Button>
                    {/* 新增导出 SRT 按钮 */}
                    <Button
                        variant="outlined"
                        color="info"
                        startIcon={<SubtitlesIcon />}
                        onClick={handleExportSrt}
                        disabled={!mergedAudioExists || loading || (mergeProgress && (mergeProgress.status === 'PROGRESS' || mergeProgress.status === 'PENDING'))}
                    >
                        导出 SRT 字幕
                    </Button>
                    
                </Stack>
                {/* 合并音频的播放器 */}
                {contentDetail?.latest_merged_audio?.file_path && (
                    <Paper variant="outlined" sx={{ p: 2, mb: 2, mt: 2, backgroundColor: '#f0f4c3' }}>
                        <Typography variant="h6" gutterBottom>
                            最新合并语音 (v{contentDetail.latest_merged_audio.version})
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <IconButton 
                                onClick={() => handlePlayAudio(
                                    contentDetail.latest_merged_audio.file_path.startsWith('http') ? contentDetail.latest_merged_audio.file_path : `${API_BASE_URL.replace('/api', '')}/media/tts_audio/${contentDetail.latest_merged_audio.file_path}`,
                                    'merged_audio' // 特殊类型标记
                                )}
                                color={playingAudio && playingAudio.id === 'merged_audio' ? "error" : "primary"}
                                size="large"
                            >
                                {playingAudio && playingAudio.id === 'merged_audio' ? <StopCircleOutlinedIcon fontSize="large" /> : <PlayArrowIcon fontSize="large" />}
                            </IconButton>
                            <Box>
                                <Typography variant="body1">
                                    总时长: {formatMsToTime(contentDetail.latest_merged_audio.duration_ms)}
                                </Typography>
                                <Typography variant="caption" color="textSecondary">
                                    文件大小: {contentDetail.latest_merged_audio.file_size_bytes ? (contentDetail.latest_merged_audio.file_size_bytes / (1024*1024)).toFixed(2) + ' MB' : 'N/A'}
                                </Typography>
                            </Box>
                             <Button 
                                size="small" 
                                variant="outlined"
                                href={contentDetail.latest_merged_audio.file_path.startsWith('http') ? contentDetail.latest_merged_audio.file_path : `${API_BASE_URL.replace('/api', '')}/media/tts_audio/${contentDetail.latest_merged_audio.file_path}`}
                                download={`merged_audio_v${contentDetail.latest_merged_audio.version}.mp3`} // 假设是mp3
                                startIcon={<DownloadIcon />}
                                sx={{ml: 'auto'}}
                            >
                                下载合并语音
                            </Button>
                        </Box>
                    </Paper>
                )}

                {/* 批量语音生成进度条 (仅当处于此步骤且有进度时显示) */}
                {overallProgress && activeStepKey === 'generateAndMergeAudio' && ( 
                  <Paper variant="outlined" sx={{ p: 2, mb: 3, mt: 2, backgroundColor: '#e3f2fd' }}>
                    <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
                        批量语音生成进度 (任务ID: {overallProgress.task_id?.substring(0,8) || 'N/A'}):
                    </Typography>
                    <Box>
                        {/* ... (与上面相同的 overallProgress 显示逻辑) ... */}
                        <Typography variant="body2">
                            总共待处理: {overallProgress.total_in_batch ?? 'N/A'} |
                            已处理: {overallProgress.processed_in_batch ?? 0} |
                            成功: {overallProgress.succeeded_in_batch ?? 0} |
                            失败: {overallProgress.failed_in_batch ?? 0}
                        </Typography>
                        {overallProgress.current_sentence_text && (
                            <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
                            当前处理: {overallProgress.current_sentence_text.substring(0,50) + (overallProgress.current_sentence_text.length > 50 ? '...' : '')}
                            </Typography>
                        )}
                        {(overallProgress.message) && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                状态信息: {overallProgress.message}
                            </Typography>
                        )}
                        <LinearProgress
                            variant="determinate"
                            value={
                                (typeof overallProgress.total_in_batch === 'number' && overallProgress.total_in_batch > 0 && typeof overallProgress.processed_in_batch === 'number')
                                ? Math.round((overallProgress.processed_in_batch / overallProgress.total_in_batch) * 100)
                                : (overallProgress.status === 'SUCCESS' && overallProgress.total_in_batch > 0 &&
                                    (overallProgress.succeeded_in_batch + overallProgress.failed_in_batch) === overallProgress.total_in_batch)
                                    ? 100
                                    : 0
                            }
                            sx={{ mt: 1, height: 10, borderRadius: 5, backgroundColor: '#b3e5fc' }}
                            color={ (overallProgress.failed_in_batch ?? 0) > 0 ? "error" : "primary" }
                        />
                    </Box>
                  </Paper>
                )}

                {contentDetail.final_script_sentences && contentDetail.final_script_sentences.length > 0 && (
                  <SentenceList
                      sentences={contentDetail.final_script_sentences}
                      playingAudio={playingAudio} actionLoading={actionLoading}
                      onPlayAudio={handlePlayAudio} onGenerateAudio={handleGenerateSentenceAudio}
                      onUpdateSentenceText={handleUpdateSentence} onDeleteSentence={handleDeleteSentence}
                      mergedAudioSegments={contentDetail?.latest_merged_audio?.segments}
                  />
                )}
              </Box>

            ) : ( // 默认的网格布局，用于步骤 1, 2, 3 (口播稿, TTS优化, LLM修订)
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Paper variant="outlined" sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb:1}}>
                        <Typography variant="h6">{currentActiveStepDetails.inputLabel} {currentActiveStepDetails.inputScriptTypeKey !== 'original_content' && inputScriptForDisplay ? `(v${inputScriptForDisplay.version || 'N/A'})` : ''}</Typography>
                        {currentActiveStepDetails.inputScriptTypeKey !== 'original_content' && (
                            <Stack direction="row" spacing={1}>
                                {isEditingInput ? (
                                <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={handleSaveEditedInputScript} disabled={actionLoading[`save_input_script_${currentInputScriptId}`] || !currentInputScriptId}>
                                     {actionLoading[`save_input_script_${currentInputScriptId}`] ? <CircularProgress size={16}/> : "保存"}
                                </Button>
                                ) : (
                                <Button variant="outlined" size="small" startIcon={<EditIcon />} onClick={handleEditInputScript} disabled={!currentInputScriptId}> 编辑 </Button>
                                )}
                                {isEditingInput && (
                                    <Button variant="outlined" size="small" onClick={() => {setIsEditingInput(false); initializeStepInput(currentActiveStepDetails, contentDetail);}}>取消</Button>
                                )}
                            </Stack>
                        )}
                        {currentActiveStepDetails.inputScriptTypeKey === 'original_content' && (
                            <Button variant="outlined" size="small" startIcon={<EditIcon />} onClick={() => handleOpenFullScriptDialog({script_type: 'Original Content'})}>
                                查看/编辑原文
                            </Button>
                        )}
                    </Box>
                    {isEditingInput && currentActiveStepDetails.inputScriptTypeKey !== 'original_content' ? (
                      <TextareaAutosize
                        minRows={15}
                        style={{ width: '100%', padding: '8px', fontFamily: 'monospace', border: '1px solid #ccc', borderRadius: '4px', flexGrow: 1, fontSize:'0.9rem' }}
                        value={editingStepInputContent}
                        onChange={(e) => setEditingStepInputContent(e.target.value)}
                      />
                    ) : (
                      <Box sx={{ flexGrow: 1, overflowY: 'auto', whiteSpace: 'pre-wrap', p:1, border: '1px solid #eee', borderRadius: 1, minHeight: 300, backgroundColor: '#f9f9f9' }}>
                        {inputScriptForDisplay?.content || (currentActiveStepDetails.inputScriptTypeKey === 'original_content' ? "原始培训内容加载中或不可用..." : "无输入内容")}
                      </Box>
                    )}
                  </Paper>
                </Grid>

                <Grid item xs={12} md={6}>
                  <Paper variant="outlined" sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                     <Box sx={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb:1}}>
                        <Typography variant="h6">
                            {currentActiveStepDetails.outputLabel} 
                            {(() => { // 显示输出脚本的版本
                                if (currentActiveStepDetails.outputScriptTypeKey && contentDetail.scripts) {
                                    const outputScriptsOfType = contentDetail.scripts
                                     .filter(s => s.script_type === currentActiveStepDetails.outputScriptTypeKey)
                                     .sort((a,b) => b.version - a.version);
                                   if(outputScriptsOfType.length > 0) return `(v${outputScriptsOfType[0].version})`;
                                }
                                return '';
                            })()}
                        </Typography>
                        <Button
                            variant="contained"
                            color="primary"
                            size="small"
                            startIcon={actionLoading[`${currentActiveStepDetails.actionName}_${currentInputScriptId}`] ? <CircularProgress size={16} color="inherit"/> : <CachedIcon />}
                            onClick={() => handleRecreateOutput(currentActiveStepDetails.actionName, currentInputScriptId)}
                            disabled={isPolling || actionLoading[`${currentActiveStepDetails.actionName}_${currentInputScriptId}`] || (currentActiveStepDetails.inputScriptTypeKey !== 'original_content' && !currentInputScriptId && currentActiveStepDetails.actionName !== 'generateOralScript')} // generateOralScript 不需要 inputScriptId
                        >
                            {isPolling ? '任务处理中' : '重新生成输出'}

                        </Button>
                    </Box>
                    <Box sx={{ flexGrow: 1, overflowY: 'auto', whiteSpace: 'pre-wrap', p:1, border: '1px solid #eee', borderRadius: 1, minHeight: 300, backgroundColor: '#f9f9f9' }}>
                      {(() => {
                          let outputScriptForStep = null;
                          if (currentActiveStepDetails.outputScriptTypeKey && contentDetail.scripts) {
                               const outputScriptsOfType = contentDetail.scripts
                                .filter(s => s.script_type === currentActiveStepDetails.outputScriptTypeKey)
                                .sort((a,b) => b.version - a.version); 
                              if(outputScriptsOfType.length > 0) outputScriptForStep = outputScriptsOfType[0];
                          }
                          // 如果脚本内容是预览且很长，提示用户点击查看
                          if (outputScriptForStep && outputScriptForStep.content_preview && outputScriptForStep.content_preview.endsWith('...') && !outputScriptForStep.content) {
                              return outputScriptForStep.content_preview + " (点击下方按钮查看完整内容)";
                          }
                          return outputScriptForStep && outputScriptForStep.content ? 
                                 outputScriptForStep.content : 
                                 "无输出内容或等待生成...";
                      })()}
                    </Box>
                     <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
                        {(() => {
                            let outputScriptForStep = null;
                            if (currentActiveStepDetails.outputScriptTypeKey && contentDetail.scripts) {
                                const outputScriptsOfType = contentDetail.scripts
                                 .filter(s => s.script_type === currentActiveStepDetails.outputScriptTypeKey)
                                 .sort((a,b) => b.version - a.version);
                               if(outputScriptsOfType.length > 0) outputScriptForStep = outputScriptsOfType[0];
                            }
                            return outputScriptForStep ? 
                                   <Button size="small" onClick={() => handleOpenFullScriptDialog(outputScriptForStep)}>查看/编辑输出脚本</Button> : 
                                   null;
                        })()}
                    </Box>
                  </Paper>
                </Grid>
              </Grid>
            )}
          </Box>
        )}
      </Paper>
    
      <Dialog 
        open={showFullScriptDialog.open} 
        onClose={() => setShowFullScriptDialog({open: false, title: '', content: '', scriptId: null, scriptType: '', isOriginalContent: false})} 
        maxWidth="lg"
        fullWidth 
        scroll="paper"
      >
          <DialogTitle>{showFullScriptDialog.title}</DialogTitle>
          <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', minHeight: '60vh' }}>
              <TextField
                  autoFocus
                  fullWidth
                  multiline
                  value={editingDialogScriptContent}
                  onChange={(e) => setEditingDialogScriptContent(e.target.value)}
                  variant="outlined"
                  sx={{ fontFamily: 'monospace', fontSize: '0.9rem', whiteSpace: 'pre-wrap', flexGrow: 1 }}
                  InputProps={{ sx: { height: '100%' } }} 
              />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowFullScriptDialog({open: false, title: '', content: '', scriptId: null, scriptType: '', isOriginalContent: false})}>取消</Button>
            <Button 
              onClick={handleSaveDialogEditedScript} 
              variant="contained"
              disabled={
                actionLoading[`save_original_content_${contentId}`] || 
                actionLoading[`save_dialog_script_${showFullScriptDialog.scriptId}`]
              }
            >
              {(actionLoading[`save_original_content_${contentId}`] || actionLoading[`save_dialog_script_${showFullScriptDialog.scriptId}`]) 
                ? <CircularProgress size={20}/> 
                : "保存更改"}
            </Button>
          </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TrainingContentDetail;