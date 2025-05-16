// frontend/src/components/TrainingContentDetail.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, CircularProgress, Chip, Grid, Card, CardHeader, CardContent,
  TableContainer, Table, TableHead, TableRow, TableCell, TableBody, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  List, ListItem, ListItemText, Divider, IconButton, TextField, Stack, TextareaAutosize
} from '@mui/material';
import TablePagination from '@mui/material/TablePagination';
import LinearProgress from '@mui/material/LinearProgress';

import {
    PlayArrow as PlayArrowIcon,
    Download as DownloadIcon,
    Refresh as RefreshIcon,
    Edit as EditIcon,
    Save as SaveIcon,
    SpeakerNotes as SpeakerNotesIcon,
    Audiotrack as AudiotrackIcon,
    PlaylistPlay as PlaylistPlayIcon,
    CloudUpload as CloudUploadIcon,
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
} from '@mui/icons-material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { ttsApi } from '../api/tts';
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';
import { formatRelativeTime } from '../api/dateUtils';
import { API_BASE_URL } from '../config';

// SentenceList Sub-component
const SentenceList = ({ sentences, playingAudio, actionLoading, onPlayAudio, onGenerateAudio, onUpdateSentenceText, onDeleteSentence }) => {
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(50);
    const [searchTerm, setSearchTerm] = useState('');

    const filteredSentences = useMemo(() => {
        if (!searchTerm) return sentences;
        return sentences.filter(sentence =>
            sentence.text.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [sentences, searchTerm]);

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
                                    <TableCell sx={{ width: '15%', fontWeight: 'bold' }}>语音状态</TableCell>
                                    <TableCell sx={{ width: '30%', fontWeight: 'bold', textAlign: 'center' }}>操作</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {paginatedSentences.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} align="center">
                                            <Typography color="textSecondary" sx={{ p: 2 }}>
                                                {searchTerm ? '未找到匹配的句子' : '暂无句子，请先拆分脚本。'}
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    paginatedSentences.map(sentence => (
                                        <TableRow key={sentence.id} hover>
                                            <TableCell>{sentence.order_index + 1}</TableCell>
                                            <TableCell sx={{whiteSpace: "pre-wrap", wordBreak: "break-word"}}>{sentence.text}</TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={sentence.audio_status || '未知'}
                                                    size="small"
                                                    color={sentence.audio_status === 'generated' ? 'success' : (sentence.audio_status === 'generating' || sentence.audio_status === 'processing_request' ? 'info' : (sentence.audio_status?.startsWith('error') ? 'error' : 'default'))}
                                                />
                                            </TableCell>
                                            <TableCell align="right">
                                                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                                    <Tooltip title="编辑句子">
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
                                                    {(['pending_generation', 'error_generation', 'pending_regeneration', 'error_submission', 'error_polling', 'queued'].includes(sentence.audio_status)) && (
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
                            count={filteredSentences.length}
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
  const pollingIntervalsRef = useRef({});
  const [overallProgress, setOverallProgress] = useState(null);

  const workflowSteps = useMemo(() => [
    { 
      key: 'generateOralScript', label: '1. Create Oral', actionName: 'generateOralScript',
      inputLabel: 'Origin Doc', outputLabel: 'Oral Scripts',
      inputScriptTypeKey: 'original_content',
      outputScriptTypeKey: 'oral_script',
      isPending: (s) => s === 'pending_oral_script', 
      isInProgress: (s) => s === 'processing_oral_script', 
      isCompleted: (s, scripts) => !['pending_oral_script', 'processing_oral_script'].includes(s) && !!scripts?.find(sc => sc.script_type === 'oral_script'), 
      isEnabled: (s) => s === 'pending_oral_script' || (contentDetail && !contentDetail.scripts?.find(sc => sc.script_type === 'oral_script')),
    },
    { 
      key: 'triggerTtsRefine', label: '2. TTS Refine', actionName: 'triggerTtsRefine',
      inputLabel: 'Oral Scripts', outputLabel: 'TTS Refine Output',
      inputScriptTypeKey: 'oral_script', 
      outputScriptTypeKey: 'tts_refined_script',
      isPending: (s) => s === 'pending_tts_refine', 
      isInProgress: (s) => s === 'processing_tts_refine', 
      isCompleted: (s, scripts) => !['pending_tts_refine', 'processing_tts_refine'].includes(s) && !!scripts?.find(sc => sc.script_type === 'tts_refined_script'), 
      isEnabled: (s, prevCompleted) => prevCompleted && (s === 'pending_tts_refine' || (contentDetail && !contentDetail.scripts?.find(sc => sc.script_type === 'tts_refined_script'))),
    },
    { 
      key: 'triggerLlmRefine', label: '3. LLM Refine', actionName: 'triggerLlmRefine',
      inputLabel: 'TTS Refine Output', outputLabel: 'Final TTS Script',
      inputScriptTypeKey: 'tts_refined_script', 
      outputScriptTypeKey: 'final_tts_script',
      isPending: (s) => s === 'pending_llm_final_refine', 
      isInProgress: (s) => s === 'processing_llm_final_refine', 
      isCompleted: (s, scripts) => !['pending_llm_final_refine', 'processing_llm_final_refine'].includes(s) && !!scripts?.find(sc => sc.script_type === 'final_tts_script'), 
      isEnabled: (s, prevCompleted) => prevCompleted && (s === 'pending_llm_final_refine' || (contentDetail && !contentDetail.scripts?.find(sc => sc.script_type === 'final_tts_script'))),
    },
    {
        key: 'splitSentences', label: '4. Split Sentence', actionName: 'splitSentences',
        inputLabel: 'Final TTS Script', 
        outputLabel: 'Sentences',
        inputScriptTypeKey: 'final_tts_script', 
        isPending: (s) => s === 'pending_sentence_split',
        isInProgress: (s) => s === 'processing_sentence_split',
        isCompleted: (s, scripts, sentences) => !['pending_sentence_split', 'processing_sentence_split'].includes(s) && (sentences && sentences.length > 0),
        isEnabled: (s, prevCompleted) => prevCompleted && (s === 'pending_sentence_split' || (contentDetail && (!contentDetail.final_script_sentences || contentDetail.final_script_sentences.length === 0))),
    },
    {
      key: 'generateAndMergeAudio', label: '5. Generate & Merge Audio',
      isCompleted: (status, scripts, sentences, mergedAudio) => !!mergedAudio, // Or more complex logic for when this step is "done"
      isEnabled: (status, prevCompleted, sentences) => prevCompleted && sentences && sentences.length > 0,
      // This step won't have typical input/output script panels
    }
  ], [contentDetail]);

const fetchContentDetail = useCallback(async (showLoadingIndicator = true) => {
    if (!contentId) return;
    if (showLoadingIndicator) setLoading(true);
    setErrorStateForDisplay(null);
    // setAlert({ open: false, message: '', severity: 'info' }); // Don't reset alert on background fetches
    try {
      const response = await ttsApi.getTrainingContentDetail(contentId);
      let fullOriginalContent = response.data.original_content;
      // Ensure original content is fully fetched if only preview was initially sent
      if (!fullOriginalContent && response.data.id && response.data.original_content_preview && response.data.original_content_preview.endsWith('...')) {
        try {
          const originalContentRes = await ttsApi.getOriginalTrainingContent(response.data.id);
          fullOriginalContent = originalContentRes.data.original_content;
        } catch (originalErr) {
          console.warn("获取完整原始文本失败:", originalErr);
          // Fallback to preview if full fetch fails
          fullOriginalContent = response.data.original_content_preview || '';
        }
      }
  
      const sortedData = {
        ...response.data,
        original_content: fullOriginalContent,
        scripts: response.data.scripts ? [...response.data.scripts].sort((a, b) => {
          const typeOrder = { 'oral_script': 1, 'tts_refined_script': 2, 'final_tts_script': 3 };
          if (typeOrder[a.script_type] !== undefined && typeOrder[b.script_type] !== undefined && typeOrder[a.script_type] !== typeOrder[b.script_type]) {
            return typeOrder[a.script_type] - typeOrder[b.script_type];
          }
          return b.version - a.version;
        }) : [],
        final_script_sentences: response.data.final_script_sentences
          ? [...response.data.final_script_sentences].sort((a, b) => a.order_index - b.order_index)
          : []
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
      const inputScriptsOfType = detail.scripts
        .filter(s => s.script_type === step.inputScriptTypeKey)
        .sort((a, b) => b.version - a.version);
      const inputScript = inputScriptsOfType.length > 0 ? inputScriptsOfType[0] : null;
  
      if (inputScript) {
        inputContent = inputScript.content || '';
        inputId = inputScript.id;
      }
    }
    setEditingStepInputContent(inputContent);
    setCurrentInputScriptId(inputId);
  }, [setEditingStepInputContent, setCurrentInputScriptId]);
  
  useEffect(() => {
    const currentActiveStep = workflowSteps.find(step => step.key === activeStepKey);
    if (currentActiveStep && contentDetail) {
      if (!isEditingInput || activeStepKey !== workflowSteps.find(s => s.key === activeStepKey)?.key) { // If not editing or step changed
          initializeStepInput(currentActiveStep, contentDetail);
      }
    }
  }, [activeStepKey, contentDetail, workflowSteps, initializeStepInput, isEditingInput]);

  useEffect(() => {
    fetchContentDetail();
    return () => {
        Object.values(pollingIntervalsRef.current).forEach(clearInterval);
        pollingIntervalsRef.current = {};
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
            audioRef.current.load();
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
        fetchContentDetail(false);
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

    // If the actionName is for the current step, and it needs an input script
    // ensure we have the correct input script ID.
    // For 'generateOralScript', it uses contentId.
    if (currentStepDetails.inputScriptTypeKey && currentStepDetails.inputScriptTypeKey !== 'original_content') {
        const inputScripts = contentDetail?.scripts
            .filter(s => s.script_type === currentStepDetails.inputScriptTypeKey)
            .sort((a,b) => b.version - a.version);
        if (inputScripts && inputScripts.length > 0) {
            scriptIdToUse = inputScripts[0].id;
        } else if (actionName !== 'generateOralScript') { // if not first step and no input script, warn
            setAlert({open: true, message: `无法重新生成：未找到 ${currentStepDetails.inputLabel}。`, severity: 'warning'});
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

    if (isOriginal) {
        fullContentToDisplay = contentDetail?.original_content || scriptOrOriginalData.content || "加载原文中...";
        dialogTitle = '原始培训内容 - 查看/编辑';
    } else if (scriptOrOriginalData.id) {
        scriptId = scriptOrOriginalData.id;
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
        content: fullContentToDisplay,
        scriptId: scriptId,
        scriptType: scriptOrOriginalData.script_type,
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
            if (!contentId) throw new Error("Content ID is missing.");
            await ttsApi.updateOriginalTrainingContent(contentId, editingDialogScriptContent);
            setAlert({ open: true, message: '原始培训内容保存成功！', severity: 'success' });
        } else if (showFullScriptDialog.scriptId) {
            await ttsApi.updateScriptContent(showFullScriptDialog.scriptId, editingDialogScriptContent.trim());
            setAlert({ open: true, message: '脚本保存成功！', severity: 'success' });
        } else {
             throw new Error("无法确定保存目标。");
        }
        setShowFullScriptDialog({ open: false, title: '', content: '', scriptId: null, scriptType: '', isOriginalContent: false });
        fetchContentDetail(false);
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
    // setAlert({ open: false, message: '', severity: 'info' }); // Keep existing alerts visible during action

    try {
        let response;
        let successMessage = '';
        let isNonBatchProgressTask = false;

        switch (actionType) {
            case 'generateOralScript':
                response = await ttsApi.generateOralScript(currentContentId);
                successMessage = response.data.message || '口播稿生成任务已启动。';
                isNonBatchProgressTask = true;
                break;
            case 'triggerTtsRefine':
                if (!scriptIdForAction) throw new Error("需要口播稿ID来优化");
                response = await ttsApi.triggerTtsRefine(scriptIdForAction);
                successMessage = response.data.message || 'TTS Refine 任务已启动。';
                isNonBatchProgressTask = true;
                break;
            case 'triggerLlmRefine':
                if (!scriptIdForAction) throw new Error("需要TTS Refine稿ID来进行LLM润色");
                response = await ttsApi.triggerLlmRefine(scriptIdForAction);
                successMessage = response.data.message || 'LLM最终修订任务已启动。';
                isNonBatchProgressTask = true;
                break;
            case 'splitSentences':
                if (!scriptIdForAction) throw new Error("需要最终脚本ID来拆分句子");
                response = await ttsApi.splitSentences(scriptIdForAction);
                successMessage = response.data.message || '句子拆分任务已启动。';
                isNonBatchProgressTask = true;
                break;
            default:
                throw new Error("未知的操作类型");
        }
        setAlert({ open: true, message: successMessage, severity: 'success' });
        
        if (isNonBatchProgressTask && response.data.task_id) {
            if (contentDetail) {
                let newStatus = contentDetail.status;
                if(actionType === 'generateOralScript') newStatus = 'processing_oral_script';
                if(actionType === 'triggerTtsRefine') newStatus = 'processing_tts_refine';
                if(actionType === 'triggerLlmRefine') newStatus = 'processing_llm_final_refine';
                if(actionType === 'splitSentences') newStatus = 'processing_sentence_split';
                setContentDetail(prev => ({...prev, status: newStatus}));
            }
            pollTaskStatus(response.data.task_id, false);
        } else if (response.status >= 200 && response.status < 300) {
            setTimeout(() => fetchContentDetail(false), 1000); 
        }

    } catch (error) {
        console.error(`操作 ${actionType} 失败:`, error);
        const apiError = error.response?.data?.error || error.message;
        setAlert({ open: true, message: `操作失败: ${apiError}`, severity: 'error' });
         if (contentDetail) {
            // Optionally revert status or set to a specific error status
            // For now, just log and show alert. User can retry.
            // setContentDetail(prev => ({...prev, status: `error_${actionType}`}));
        }
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };
  
  const handlePlayAudio = (sentenceId, audioUrl) => {
    if (!audioUrl) {
      setAlert({ open: true, message: '该句子还没有可播放的语音。', severity: 'warning' });
      return;
    }
    let fullAudioUrl = audioUrl.startsWith('http') ? audioUrl : `${API_BASE_URL.replace('/api', '')}/media/tts_audio/${audioUrl}`;

    if (playingAudio && playingAudio.sentenceId === sentenceId) {
      if (audioRef.current) audioRef.current.pause();
      setPlayingAudio(null);
    } else {
      if (audioRef.current) audioRef.current.pause();
      const newAudio = new Audio(fullAudioUrl);
      audioRef.current = newAudio;
      newAudio.play()
        .then(() => setPlayingAudio({ sentenceId, audioUrl: fullAudioUrl }))
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

  const pollTaskStatus = useCallback((taskId, isBatchTask = false) => {
    stopPollingForTask(taskId);
    const intervalId = setInterval(async () => {
      try {
        const response = await ttsApi.getTaskStatus(taskId);
        const taskData = response.data;

        if (isBatchTask) {
          if (taskData.meta && typeof taskData.meta === 'object') {
            const currentMeta = taskData.meta;
            setOverallProgress(prev => ({
              total_in_batch: currentMeta.total_in_batch ?? prev?.total_in_batch ?? 0,
              processed_in_batch: currentMeta.processed_in_batch ?? prev?.processed_in_batch ?? 0,
              succeeded_in_batch: currentMeta.succeeded_in_batch ?? prev?.succeeded_in_batch ?? 0,
              failed_in_batch: currentMeta.failed_in_batch ?? prev?.failed_in_batch ?? 0,
              current_sentence_text: currentMeta.current_sentence_text || prev?.current_sentence_text,
              message: currentMeta.message || prev?.message || '状态更新中...'
            }));
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
            } else if (overallProgress && currentMeta.processed_in_batch !== overallProgress.processed_in_batch && taskData.status === 'PROGRESS') {
                fetchContentDetail(false);
            }
          }
          if (taskData.status === 'SUCCESS' || taskData.status === 'FAILURE') {
            stopPollingForTask(taskId);
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
                message: `批量任务 ${taskId.substring(0,6)}... ${taskData.status === 'SUCCESS' ? '完成' : '失败'}: ${finalStats?.message || taskData.error_message || ''}`,
                severity: taskData.status === 'SUCCESS' ? 'success' : 'error'
              });
            fetchContentDetail(false); 
          }
        } else { // Non-batch task (script processing, sentence split)
            if (taskData.status === 'SUCCESS' || taskData.status === 'FAILURE') {
                stopPollingForTask(taskId);
                fetchContentDetail(false);
                setAlert({
                    open: true,
                    message: `${taskData.task_name || '处理操作'} ${taskData.status === 'SUCCESS' ? '成功' : '失败'}。${taskData.result?.message || taskData.error_message || ''}`,
                    severity: taskData.status === 'SUCCESS' ? 'success' : 'error'
                });
            } else if (taskData.status === 'PROGRESS' && taskData.meta) {
                 // For non-batch tasks, if there's progress meta, you might update UI.
                 // For now, just let it poll until success/failure.
            }
        }
      } catch (error) {
        console.error(`轮询任务 ${taskId} 状态失败:`, error);
        stopPollingForTask(taskId);
        setAlert({open: true, message: `轮询任务 ${taskId.substring(0,6)}... 进度失败`, severity: 'error'});
        if (isBatchTask) {
            setOverallProgress(prev => ({ ...(prev || {}), message: "轮询进度失败"}));
        }
        // fetchContentDetail(false); // Refresh to get the latest server state even on polling error
      }
    }, 2500); 
    pollingIntervalsRef.current = { ...pollingIntervalsRef.current, [taskId]: intervalId };
  }, [fetchContentDetail, overallProgress]); // Added overallProgress

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
        setAlert({ open: true, message: "没有需要生成语音的句子。", severity: 'info' });
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
        return;
    }
    setOverallProgress({
        total_in_batch: initialTotalInBatch, processed_in_batch: 0, succeeded_in_batch: 0,
        failed_in_batch: 0, current_sentence_text: null,
        message: `正在提交 ${initialTotalInBatch} 个句子的生成任务...`
    });
    setContentDetail(prev => {
        if (!prev || !prev.final_script_sentences) return prev;
        return {
            ...prev,
            final_script_sentences: prev.final_script_sentences.map(s =>
                sentencesForBatch.find(sfb => sfb.id === s.id)
                    ? { ...s, audio_status: 'queued' }
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
                message: response.data.initial_message || "任务已提交，等待 Worker 处理...",
            }));
            pollTaskStatus(response.data.task_id, true);
        } else {
            setOverallProgress(null);
            fetchContentDetail(false);
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
      // Pass an empty object or specific params if your API expects a body for POST
      const response = await ttsApi.generateSentenceAudio(sentenceId, {}); 
      setAlert({ open: true, message: response.data.message || '单句语音生成任务已提交。', severity: 'info' });
      if (response.data.task_id) {
        // For single sentence, we might not need a dedicated poll function,
        // as the main pollTaskStatus (non-batch) can handle it.
        // However, the `isBatchTask` parameter is important.
        pollTaskStatus(response.data.task_id, false); // false indicates non-batch
      } else {
        // If no task_id, refresh to see immediate changes (e.g., if API was synchronous or failed before task creation)
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
        fetchContentDetail(false);
    } catch (error) {
        setAlert({ open: true, message: `删除句子失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };

  const currentActiveStepDetails = workflowSteps.find(s => s.key === activeStepKey);
  let inputScriptForDisplay = null;
  
  if (contentDetail && currentActiveStepDetails && currentActiveStepDetails.key !== 'generateAndMergeAudio') {
    if (currentActiveStepDetails.inputScriptTypeKey === 'original_content') {
        inputScriptForDisplay = { content: editingStepInputContent || contentDetail.original_content || "加载原始文本...", id: null, script_type: 'Original Content' };
    } else if (currentActiveStepDetails.inputScriptTypeKey && contentDetail.scripts) {
        const inputScriptsOfType = contentDetail.scripts
            .filter(s => s.script_type === currentActiveStepDetails.inputScriptTypeKey)
            .sort((a, b) => b.version - a.version);
        if (inputScriptsOfType.length > 0) {
            inputScriptForDisplay = inputScriptsOfType[0];
        }
    }
  }

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}><CircularProgress /></Box>;
  }
  if (errorStateForDisplay) {
    return <Typography color="error" sx={{p:2}}>{errorStateForDisplay}</Typography>;
  }
  if (!contentDetail) {
    return <Typography sx={{p:2}}>未找到培训内容或正在加载...</Typography>;
  }

  return (
    <Box>
      <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({ ...prev, open: false }))} />
      <PageHeader
        title={`培训内容: ${contentDetail?.content_name || '...'}`}
        description={`Status: ${contentDetail?.status || '未知'} | Created: ${contentDetail?.created_at ? formatRelativeTime(contentDetail.created_at) : ''} by ${contentDetail?.uploader_username || 'N/A'}`}
        actionButton={
            <Button onClick={() => navigate(-1)} startIcon={<ArrowBackIcon />}>返回</Button>
        }
      />
      
      {overallProgress && activeStepKey !== 'generateAndMergeAudio' && (
        <Paper sx={{ p: 2, mb: 2, backgroundColor: '#e3f2fd' }}>
          <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
            批量语音生成进度:
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
                  当前: {overallProgress.current_sentence_text}
                  </Typography>
              )}
              {(overallProgress.message && (overallProgress.processed_in_batch === 0 && overallProgress.total_in_batch > 0)) && (
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
                         overallProgress.total_in_batch > 0)
                        ? 100
                        : 0
                  }
                  sx={{ mt: 1, height: 10, borderRadius: 5, backgroundColor: '#b3e5fc' }}
                  color={ (overallProgress.failed_in_batch ?? 0) > 0 ? "error" : "primary" }
              />
          </Box>
        </Paper>
      )}

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>工作流程</Typography>
        <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 1, mb: 2, alignItems: 'center' }}>
          {workflowSteps.map((step, index) => {
            const isStepActive = activeStepKey === step.key;
            let prevStepCompleted = index === 0; // First step has no previous step to check
            if (index > 0) {
                const prevStep = workflowSteps[index-1];
                prevStepCompleted = prevStep.isCompleted ? 
                    prevStep.isCompleted(contentDetail?.status, contentDetail?.scripts, contentDetail?.final_script_sentences, contentDetail?.latest_merged_audio)
                    : false;
            }
            const isStepEnabled = step.isEnabled ? 
                step.isEnabled(contentDetail?.status, prevStepCompleted, contentDetail?.final_script_sentences) 
                : prevStepCompleted; // Fallback if isEnabled is not defined (though all yours are)

            const isThisStepItselfCompleted = step.isCompleted ? 
                step.isCompleted(contentDetail?.status, contentDetail?.scripts, contentDetail?.final_script_sentences, contentDetail?.latest_merged_audio)
                : false;

            return (
              <React.Fragment key={step.key}>
                <Button
                  variant={isStepActive ? "contained" : "outlined"}
                  onClick={() => handleWorkflowStepClick(step.key)}
                  disabled={!isStepEnabled && !isThisStepItselfCompleted} // Enable if it's the active flow point OR if already completed
                  sx={{textTransform: 'none', flexShrink: 0, whiteSpace: 'nowrap'}}
                >
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
            
            {currentActiveStepDetails.key === 'splitSentences' ? (
              <Box>
                <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h6">
                      {currentActiveStepDetails.inputLabel}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      {isEditingInput ? (
                        <Button 
                            variant="contained" size="small" startIcon={<SaveIcon />} 
                            onClick={handleSaveEditedInputScript}
                            disabled={actionLoading[`save_input_script_${currentInputScriptId}`] || !currentInputScriptId}
                        >
                            {actionLoading[`save_input_script_${currentInputScriptId}`] ? <CircularProgress size={16}/> : "Save"}
                        </Button>
                      ) : (
                        <Button 
                            variant="outlined" size="small" startIcon={<EditIcon />} 
                            onClick={handleEditInputScript}
                            disabled={!currentInputScriptId}
                        > Edit </Button>
                      )}
                      {isEditingInput && (
                          <Button variant="outlined" size="small" onClick={() => {setIsEditingInput(false); initializeStepInput(currentActiveStepDetails, contentDetail); }}>
                              Cancel
                          </Button>
                      )}
                      <Button
                          variant="contained" color="primary" size="small"
                          startIcon={actionLoading[`${currentActiveStepDetails.actionName}_${currentInputScriptId}`] ? <CircularProgress size={16} color="inherit"/> : <CachedIcon />}
                          onClick={() => handleRecreateOutput(currentActiveStepDetails.actionName, currentInputScriptId)}
                          disabled={actionLoading[`${currentActiveStepDetails.actionName}_${currentInputScriptId}`] || !currentInputScriptId}
                      > Re-split </Button>
                    </Stack>
                  </Box>
                  {isEditingInput ? (
                    <TextareaAutosize
                      minRows={10}
                      style={{ width: '100%', padding: '8px', fontFamily: 'monospace', border: '1px solid #ccc', borderRadius: '4px', flexGrow: 1, fontSize:'0.9rem' }}
                      value={editingStepInputContent}
                      onChange={(e) => setEditingStepInputContent(e.target.value)}
                    />
                  ) : (
                    <Box sx={{ flexGrow: 1, overflowY: 'auto', whiteSpace: 'pre-wrap', p:1, border: '1px solid #eee', borderRadius: 1, maxHeight: 300, minHeight: 150, backgroundColor: '#f9f9f9' }}>
                      {editingStepInputContent || "无最终脚本内容或等待加载..."}
                    </Box>
                  )}
                </Paper>
                {contentDetail.final_script_sentences && contentDetail.final_script_sentences.length > 0 && (
                    <SentenceList
                        sentences={contentDetail.final_script_sentences}
                        playingAudio={playingAudio} actionLoading={actionLoading}
                        onPlayAudio={handlePlayAudio} onGenerateAudio={handleGenerateSentenceAudio}
                        onUpdateSentenceText={handleUpdateSentence} onDeleteSentence={handleDeleteSentence}
                    />
                )}
              </Box>
            
            ) : currentActiveStepDetails.key === 'generateAndMergeAudio' ? (
              <Box>
                <Stack direction={{xs: 'column', sm: 'row'}} spacing={2} sx={{mb:2}}>
                    <Button variant="contained" onClick={handleBatchGenerateAudio} disabled={actionLoading[`batch_generate_${contentId}`] || loading} startIcon={(actionLoading[`batch_generate_${contentId}`] || loading) ? <CircularProgress size={16} /> : <PlaylistPlayIcon />}>
                        批量生成语音
                    </Button>
                    <Button variant="contained" color="secondary" onClick={() => {
                        setAlert({open: true, message: "合并功能待实现", severity: "info"});
                    }} 
                    disabled={actionLoading['merge_audio'] || loading /* Add other conditions like !all_sentences_generated */} 
                    startIcon={(actionLoading['merge_audio'] || loading) ? <CircularProgress size={16} /> : <CloudUploadIcon />}>
                        合并所有语音
                    </Button>
                </Stack>

                {overallProgress && ( // Display progress here for the 5th step
                  <Paper variant="outlined" sx={{ p: 2, mb: 3, backgroundColor: '#e3f2fd' }}>
                    <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
                        批量语音生成进度:
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
                            当前: {overallProgress.current_sentence_text}
                            </Typography>
                        )}
                        {(overallProgress.message && (overallProgress.processed_in_batch === 0 && overallProgress.total_in_batch > 0)) && (
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
                                   overallProgress.total_in_batch > 0)
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
                  />
                )}
              </Box>

            ) : ( // Default Grid layout for steps 1, 2, 3
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Paper variant="outlined" sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb:1}}>
                        <Typography variant="h6">{currentActiveStepDetails.inputLabel}</Typography>
                        {currentActiveStepDetails.inputScriptTypeKey !== 'original_content' && ( // Original content edited via dialog
                            <Stack direction="row" spacing={1}>
                                {isEditingInput ? (
                                <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={handleSaveEditedInputScript} disabled={actionLoading[`save_input_script_${currentInputScriptId}`] || !currentInputScriptId}>
                                     {actionLoading[`save_input_script_${currentInputScriptId}`] ? <CircularProgress size={16}/> : "Save"}
                                </Button>
                                ) : (
                                <Button variant="outlined" size="small" startIcon={<EditIcon />} onClick={handleEditInputScript} disabled={!currentInputScriptId}> Edit </Button>
                                )}
                                {isEditingInput && (
                                    <Button variant="outlined" size="small" onClick={() => {setIsEditingInput(false); initializeStepInput(currentActiveStepDetails, contentDetail);}}>Cancel</Button>
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
                        {editingStepInputContent || (currentActiveStepDetails.inputScriptTypeKey === 'original_content' ? "原始培训内容加载中或不可用..." : "无输入内容")}
                      </Box>
                    )}
                  </Paper>
                </Grid>

                <Grid item xs={12} md={6}>
                  <Paper variant="outlined" sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                     <Box sx={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb:1}}>
                        <Typography variant="h6">{currentActiveStepDetails.outputLabel}</Typography>
                        <Button
                            variant="contained"
                            color="primary"
                            size="small"
                            startIcon={actionLoading[`${currentActiveStepDetails.actionName}_${currentInputScriptId}`] ? <CircularProgress size={16} color="inherit"/> : <CachedIcon />}
                            onClick={() => handleRecreateOutput(currentActiveStepDetails.actionName, currentInputScriptId)}
                            disabled={actionLoading[`${currentActiveStepDetails.actionName}_${currentInputScriptId}`] || (currentActiveStepDetails.inputScriptTypeKey !== 'original_content' && !currentInputScriptId)}
                        >
                            重新生成输出
                        </Button>
                    </Box>
                    <Box sx={{ flexGrow: 1, overflowY: 'auto', whiteSpace: 'pre-wrap', p:1, border: '1px solid #eee', borderRadius: 1, minHeight: 300, backgroundColor: '#f9f9f9' }}>
                      {(() => {
                          let outputScriptForStep = null;
                          if (currentActiveStepDetails.outputScriptTypeKey && contentDetail.scripts) {
                               const outputScriptsOfType = contentDetail.scripts
                                .filter(s => s.script_type === currentActiveStepDetails.outputScriptTypeKey)
                                .sort((a,b) => b.version - a.version); // Get latest version
                              if(outputScriptsOfType.length > 0) outputScriptForStep = outputScriptsOfType[0];
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
                  fullWidth
                  multiline
                  value={editingDialogScriptContent}
                  onChange={(e) => setEditingDialogScriptContent(e.target.value)}
                  variant="outlined"
                  sx={{ fontFamily: 'monospace', fontSize: '0.9rem', whiteSpace: 'pre-wrap', flexGrow: 1 }}
                  InputProps={{ sx: { height: '100%' } }} // Make TextField input area fill DialogContent
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