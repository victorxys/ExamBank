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
    Save as SaveIcon, // Added Save Icon
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
    Cached as CachedIcon, // For Re-Create
} from '@mui/icons-material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { ttsApi } from '../api/tts';
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';
import { formatRelativeTime } from '../api/dateUtils';
import { API_BASE_URL } from '../config';
// import ReactMarkdown from 'react-markdown'; // Keep if you plan to render markdown output
// import remarkGfm from 'remark-gfm';

// SentenceList Sub-component (remains largely the same as your provided version)
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
                             {/* Batch/Merge buttons will be handled by parent based on active step */}
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
  
  // Dialog for viewing/editing any script (kept from original)
  const [showFullScriptDialog, setShowFullScriptDialog] = useState({ open: false, title: '', content: '', scriptId: null, scriptType: '' });
  const [editingDialogScriptContent, setEditingDialogScriptContent] = useState('');

  // For inline input editing based on active step
  const [activeStepKey, setActiveStepKey] = useState('generateOralScript'); // Default to first processing step
  const [editingStepInputContent, setEditingStepInputContent] = useState('');
  const [isEditingInput, setIsEditingInput] = useState(false);
  const [currentInputScriptId, setCurrentInputScriptId] = useState(null);


  const [errorStateForDisplay, setErrorStateForDisplay] = useState(null);
  const [playingAudio, setPlayingAudio] = useState(null);
  const audioRef = useRef(null);
  const pollingIntervalsRef = useRef({});
  const [overallProgress, setOverallProgress] = useState(null);

  // --- Workflow Steps Definition ---
  const workflowSteps = useMemo(() => [
    { 
      key: 'generateOralScript', label: '1. Create Oral', actionName: 'generateOralScript',
      inputLabel: 'Origin Doc', outputLabel: 'Oral Scripts',
      inputScriptTypeKey: 'original_content', // Special key for original content
      outputScriptTypeKey: 'oral_script',
      isPending: (s) => s === 'pending_oral_script', 
      isInProgress: (s) => s === 'processing_oral_script', 
      isCompleted: (s, scripts) => !['pending_oral_script', 'processing_oral_script'].includes(s) && !!scripts?.find(sc => sc.script_type === 'oral_script'), 
      isEnabled: (s) => s === 'pending_oral_script' || (contentDetail && !contentDetail.scripts?.find(sc => sc.script_type === 'oral_script')), // Enable if pending or no oral script exists
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
        outputLabel: 'Sentences', // 这个标签仍然有用，用于面板标题
        inputScriptTypeKey: 'final_tts_script', 
        outputScriptTypeKey: undefined, // 明确它没有输出脚本类型，或者直接不写这行
        isPending: (s) => s === 'pending_sentence_split',
        isInProgress: (s) => s === 'processing_sentence_split',
        isCompleted: (s, scripts, sentences) => !['pending_sentence_split', 'processing_sentence_split'].includes(s) && (sentences && sentences.length > 0),
        isEnabled: (s, prevCompleted) => prevCompleted && (s === 'pending_sentence_split' || (contentDetail && (!contentDetail.final_script_sentences || contentDetail.final_script_sentences.length === 0))),
    },
    {
      key: 'generateAndMergeAudio', label: '5. Generate & Merge Audio',
      // This step's completion and enabling logic are different
      isCompleted: (status, scripts, sentences, mergedAudio) => !!mergedAudio,
      isEnabled: (status, prevCompleted, sentences) => prevCompleted && sentences && sentences.length > 0,
    }
  ], [contentDetail]); // Depend on contentDetail to re-evaluate enablement

  // frontend/src/components/TrainingContentDetail.jsx

const fetchContentDetail = useCallback(async (showLoadingIndicator = true) => {
    if (!contentId) return;
    if (showLoadingIndicator) setLoading(true);
    setErrorStateForDisplay(null);
    setAlert({ open: false, message: '', severity: 'info' });
    try {
      console.log("[FETCH_START] 调用 ttsApi.getTrainingContentDetail for contentId:", contentId);
      const response = await ttsApi.getTrainingContentDetail(contentId);
      console.log("[FETCH_RESPONSE] API 原始响应:", JSON.parse(JSON.stringify(response.data))); // 深拷贝打印，避免后续修改影响日志
  
      let fullOriginalContent = response.data.original_content;
      if (!fullOriginalContent && response.data.id) {
        try {
          console.log("[FETCH_ORIGINAL] original_content 不完整, 单独获取 for contentId:", response.data.id);
          const originalContentRes = await ttsApi.getOriginalTrainingContent(response.data.id);
          fullOriginalContent = originalContentRes.data.original_content;
          console.log("[FETCH_ORIGINAL_SUCCESS] 单独获取的 original_content:", fullOriginalContent ? fullOriginalContent.substring(0,100) + '...' : 'null/undefined');
        } catch (originalErr) {
          console.warn("[FETCH_ORIGINAL_ERROR] 获取完整原始文本失败:", originalErr);
          fullOriginalContent = response.data.original_content_preview || '';
        }
      }
  
      const sortedData = {
        ...response.data,
        original_content: fullOriginalContent,
        scripts: response.data.scripts ? [...response.data.scripts].sort((a, b) => {
          const typeOrder = { 'oral_script': 1, 'tts_refined_script': 2, 'final_tts_script': 3 };
          // 移除 'original_content' 从 typeOrder，因为它不应该出现在 scripts 数组中
          if (typeOrder[a.script_type] !== undefined && typeOrder[b.script_type] !== undefined && typeOrder[a.script_type] !== typeOrder[b.script_type]) {
            return typeOrder[a.script_type] - typeOrder[b.script_type];
          }
          return b.version - a.version;
        }) : [],
        final_script_sentences: response.data.final_script_sentences
          ? [...response.data.final_script_sentences].sort((a, b) => a.order_index - b.order_index)
          : []
      };
      console.log("[SET_CONTENT_DETAIL] 处理并排序后的数据 (sortedData):", JSON.parse(JSON.stringify(sortedData)));
      console.log("[SET_CONTENT_DETAIL] sortedData.scripts 内容预览:");
      sortedData.scripts.forEach(s => console.log(`  - Type: ${s.script_type}, Ver: ${s.version}, Content Preview: '${s.content ? s.content.substring(0,50) : "NO CONTENT FIELD"}'`));
  
      setContentDetail(sortedData);
  
      // 后续的 initializeStepInput 调用逻辑保持不变 (确保它在 setContentDetail 之后，或者在依赖 contentDetail 的 useEffect 中)
  
    } catch (err) {
      console.error("[FETCH_ERROR] 获取培训内容详情失败:", err.response || err);
      const extractedErrorMessage = err.response?.data?.error || err.message || '获取详情失败，请稍后重试';
      setAlert({ open: true, message: '获取详情失败: ' + extractedErrorMessage, severity: 'error' });
      setErrorStateForDisplay(extractedErrorMessage);
    } finally {
      if (showLoadingIndicator) setLoading(false);
      console.log("[FETCH_END] fetchContentDetail 完成.");
    }
  // 依赖项应该稳定，这里你的依赖是 [contentId, setContentDetail, setAlert, setErrorStateForDisplay, setLoading]
  // 这是正确的，因为 setContentDetail 等是 useState 返回的稳定函数
  }, [contentId]); // 移除了其他不必要的依赖，确保 fetchContentDetail 本身的引用是稳定的

  const initializeStepInput = useCallback((step, detail) => { // 移除 detail 的默认值，调用时必须传入
    if (!step || !detail) {
      // console.log("initializeStepInput: 缺少 step 或 detail", step, detail);
      setEditingStepInputContent('');
      setCurrentInputScriptId(null);
      // setIsEditingInput(false); // 不在这里设置，由调用者决定
      return;
    }
    let inputContent = '';
    let inputId = null;
  
    // console.log("Initializing input for step:", step.key, "with detail status:", detail.status);
  
    if (step.inputScriptTypeKey === 'original_content') {
      const originalContentFull = detail.original_content;
      setEditingStepInputContent(originalContentFull || '');
      // setIsEditingInput(false); // 由调用处控制
      setCurrentInputScriptId(null);
    } else if (step.inputScriptTypeKey && detail.scripts) {
      const inputScriptsOfType = detail.scripts
        .filter(s => s.script_type === step.inputScriptTypeKey)
        .sort((a, b) => b.version - a.version);
      const inputScript = inputScriptsOfType.length > 0 ? inputScriptsOfType[0] : null;
  
      if (inputScript) {
        // console.log(`为步骤 ${step.key} 找到输入脚本: ${inputScript.id}, 版本: ${inputScript.version}`);
        inputContent = inputScript.content || '';
        inputId = inputScript.id;
      } else {
        // console.log(`未找到 '${step.inputScriptTypeKey}' 类型的输入脚本 for step ${step.key}`);
        inputContent = ''; 
        inputId = null;
      }
      setEditingStepInputContent(inputContent);
      setCurrentInputScriptId(inputId);
    } else {
      // console.log(`步骤 ${step.key} 不满足脚本输入条件`);
      setEditingStepInputContent(''); 
      setCurrentInputScriptId(null);
    }
  }, [setEditingStepInputContent, setCurrentInputScriptId]); // 移除了 setIsEditingInput 和 contentDetail
                                                          // contentDetail 将通过参数传入
  
  // Effect to initialize or update input panel when activeStepKey or contentDetail changes
  useEffect(() => {
    const currentActiveStep = workflowSteps.find(step => step.key === activeStepKey);
    if (currentActiveStep && contentDetail) {
      // 只要 activeStepKey 或 contentDetail 变化，并且用户当前没有在编辑，就尝试初始化/刷新输入区
      // isEditingInput 的重置主要由 handleWorkflowStepClick (切换步骤时) 控制
      // 如果 contentDetail 更新了，但用户正在编辑，我们不应该覆盖他的编辑
      if (!isEditingInput) {
          // console.log(`Effect: 为步骤 ${activeStepKey} 初始化/刷新输入区 (用户未编辑)`);
          initializeStepInput(currentActiveStep, contentDetail);
      }
    }
  // 依赖项中包含 isEditingInput，这样当 isEditingInput 变为 false 时（例如切换步骤后），
  // 如果其他条件满足，也会触发此 effect 来加载输入。
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

  // ... (handleAction, pollTaskStatus, batch/single audio generation, play audio, update sentence, delete sentence - KEEP AS IS) ...
  // You might need to adjust handleAction to take the INPUT script's ID for re-creation steps.
  const stopPollingForTask = (taskId) => {
    if (pollingIntervalsRef.current[taskId]) {
      clearInterval(pollingIntervalsRef.current[taskId]);
      const newIntervals = { ...pollingIntervalsRef.current };
      delete newIntervals[taskId];
      pollingIntervalsRef.current = newIntervals;
      console.log(`Polling stopped for task ${taskId}`);
    }
  };
  const handleWorkflowStepClick = (stepKey) => {
    if (activeStepKey !== stepKey) { // 只有当步骤真正改变时才操作
      setActiveStepKey(stepKey);
      setIsEditingInput(false); // 切换步骤时，总是退出编辑模式
      // initializeStepInput 会由上面的 useEffect 触发
    }
  };

  const handleEditInputScript = () => {
    setIsEditingInput(true);
    // Content is already in editingStepInputContent
  };

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
        fetchContentDetail(false); // Refresh to get updated script version and potentially affect next steps
    } catch (error) {
        console.error("保存输入脚本失败:", error);
        setAlert({ open: true, message: `保存输入脚本失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };
  
  const handleRecreateOutput = (actionName, inputScriptId) => {
    if (!inputScriptId && actionName !== 'generateOralScript') { // generateOralScript uses contentId
        setAlert({open: true, message: "缺少用于重新生成操作的输入脚本ID。", severity: 'warning'});
        return;
    }
    // `handleAction` is your existing function to call backend APIs for processing steps
    // It needs to be robust to take either contentId (for first step) or scriptId
    if (actionName === 'generateOralScript') {
        handleAction(actionName, null, contentId);
    } else {
        handleAction(actionName, inputScriptId, contentId);
    }
  };


  // --- Dialog for viewing/editing ANY script (kept from original) ---
  const handleOpenFullScriptDialog = async (scriptOrOriginalData) => {
    // scriptOrOriginalData 可以是脚本对象 {id, script_type, content_preview}
    // 或者用于原始文本的对象 {script_type: 'Original Content', content: '...', id: null}
    
    if (!scriptOrOriginalData || !scriptOrOriginalData.script_type) {
        setAlert({ open: true, message: '无效的数据用于显示对话框', severity: 'error' });
        return;
    }

    const isOriginal = scriptOrOriginalData.script_type === 'Original Content';
    let fullContentToDisplay = '';
    let dialogTitle = '';

    if (isOriginal) {
        // 对于原始文本，我们期望 contentDetail.original_content 已经包含了完整内容
        fullContentToDisplay = contentDetail?.original_content || scriptOrOriginalData.content || "加载原文中..."; // scriptOrOriginalData.content 是备用
        dialogTitle = '原始培训内容 - 查看/编辑';
        setEditingDialogScriptContent(fullContentToDisplay);
        setShowFullScriptDialog({
            open: true,
            title: dialogTitle,
            content: fullContentToDisplay, // 初始显示内容
            scriptId: null, // 原始文本没有脚本 ID
            scriptType: 'Original Content',
            isOriginalContent: true
        });
    } else if (scriptOrOriginalData.id) { // 是一个脚本对象
        try {
            const response = await ttsApi.getScriptContent(scriptOrOriginalData.id);
            fullContentToDisplay = response.data.content;
            dialogTitle = `${response.data.script_type} (v${response.data.version}) - 查看/编辑`;
            setEditingDialogScriptContent(fullContentToDisplay);
            setShowFullScriptDialog({
                open: true,
                title: dialogTitle,
                content: fullContentToDisplay,
                scriptId: response.data.id,
                scriptType: response.data.script_type,
                isOriginalContent: false
            });
        } catch (error) {
            setAlert({ open: true, message: '获取脚本完整内容失败', severity: 'error' });
        }
    } else {
        // 如果 script_type 不是 'Original Content' 但又没有 script.id，这是预料之外的情况
        setAlert({ open: true, message: '无效的脚本信息或类型', severity: 'error' });
    }
  };

  const handleSaveDialogEditedScript = async () => {
    if (!editingDialogScriptContent.trim() && !showFullScriptDialog.isOriginalContent) { // 脚本内容不能为空
        setAlert({open: true, message: '脚本内容不能为空。', severity: 'warning'});
        return;
    }
    // 对于原始文本，允许保存为空（如果业务逻辑允许）
    // if (showFullScriptDialog.isOriginalContent && !editingDialogScriptContent.trim()) {
    //    setAlert({open: true, message: '原始培训内容不能为空。', severity: 'warning'});
    //    return;
    // }


    const loadingKey = showFullScriptDialog.isOriginalContent 
        ? `save_original_content_${contentId}` 
        : `save_dialog_script_${showFullScriptDialog.scriptId}`;
    
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    try {
        if (showFullScriptDialog.isOriginalContent) {
            // 保存原始培训内容
            if (!contentId) {
                setAlert({open: true, message: '无法保存原始文本：内容ID缺失。', severity: 'error'});
                throw new Error("Content ID is missing for saving original content.");
            }
            await ttsApi.updateOriginalTrainingContent(contentId, editingDialogScriptContent); // 注意这里可能不需要 .trim()，根据业务需求
            setAlert({ open: true, message: '原始培训内容保存成功！后续步骤可能需要重新生成。', severity: 'success' });
        } else if (showFullScriptDialog.scriptId) {
            // 保存普通脚本
            await ttsApi.updateScriptContent(showFullScriptDialog.scriptId, editingDialogScriptContent.trim());
            setAlert({ open: true, message: '脚本保存成功！', severity: 'success' });
        } else {
             throw new Error("无法确定保存目标。");
        }
        
        setShowFullScriptDialog({ open: false, title: '', content: '', scriptId: null, scriptType: '', isOriginalContent: false });
        fetchContentDetail(false); // 刷新数据
    } catch (error) {
        console.error("保存内容失败:", error);
        setAlert({ open: true, message: `保存失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };
  
  // --- All your existing handlers like handlePlayAudio, handleUpdateSentence, pollTaskStatus, etc. ---
  // --- Make sure handleAction is robust enough. Example: ---
  const handleAction = async (actionType, scriptId = null, associatedContentId = null) => {
    const currentContentId = associatedContentId || contentId;
    // ... (rest of your existing handleAction logic)
    // Ensure that the 'scriptId' passed to backend calls is correct for the action.
    // For example, 'triggerTtsRefine' needs the ID of the 'oral_script'.
    // 'triggerLlmRefine' needs the ID of the 'tts_refined_script'.
    let actualScriptIdForAction = scriptId;
    if (actionType === 'generateOralScript'){
        // This action uses contentId, not a scriptId as input for the API call.
        // The `scriptId` param might be null or the contentId, ensure API receives contentId.
        actualScriptIdForAction = currentContentId; // API expects contentId
    }
    // ... (your switch case) ...
    // e.g., for case 'triggerTtsRefine':
    // response = await ttsApi.triggerTtsRefine(actualScriptIdForAction); // actualScriptIdForAction should be oral_script_id

    const loadingKey = scriptId ? `${actionType}_${scriptId}` : `${actionType}_${currentContentId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    setAlert({ open: false, message: '', severity: 'info' });
    try {
        let response;
        let successMessage = '';
        let isNonBatchProgressTask = false;

        let effectiveScriptId = scriptId; // This is the ID of the *input* script for the step

        switch (actionType) {
            case 'generateOralScript':
                response = await ttsApi.generateOralScript(currentContentId); // Uses contentId
                successMessage = response.data.message || '口播稿生成任务已启动。';
                isNonBatchProgressTask = true;
                break;
            case 'triggerTtsRefine':
                if (!effectiveScriptId) throw new Error("需要口播稿ID来优化");
                response = await ttsApi.triggerTtsRefine(effectiveScriptId);
                successMessage = response.data.message || 'TTS Refine 任务已启动。';
                isNonBatchProgressTask = true;
                break;
            case 'triggerLlmRefine':
                if (!effectiveScriptId) throw new Error("需要TTS Refine稿ID来进行LLM润色");
                response = await ttsApi.triggerLlmRefine(effectiveScriptId);
                successMessage = response.data.message || 'LLM最终修订任务已启动。';
                isNonBatchProgressTask = true;
                break;
            case 'splitSentences':
                if (!effectiveScriptId) throw new Error("需要最终脚本ID来拆分句子");
                response = await ttsApi.splitSentences(effectiveScriptId);
                successMessage = response.data.message || '句子拆分任务已启动。';
                isNonBatchProgressTask = true;
                break;
            default:
                throw new Error("未知的操作类型");
        }
        setAlert({ open: true, message: successMessage, severity: 'success' });
        
        if (isNonBatchProgressTask && response.data.task_id) {
            // ... (your existing status update and polling logic) ...
            if (contentDetail) {
                let newStatus = contentDetail.status;
                if(actionType === 'generateOralScript') newStatus = 'processing_oral_script';
                if(actionType === 'triggerTtsRefine') newStatus = 'processing_tts_refine';
                if(actionType === 'triggerLlmRefine') newStatus = 'processing_llm_final_refine';
                if(actionType === 'splitSentences') newStatus = 'processing_sentence_split';
                setContentDetail(prev => ({...prev, status: newStatus}));
            }
            pollTaskStatus(response.data.task_id, false); // Assuming pollTaskStatus is correctly defined
        } else if (!isNonBatchProgressTask) { // For non-async success or immediate async failure without task_id
             setTimeout(() => fetchContentDetail(false), 1000); 
        } else if (response.data && response.data.task_id === undefined && response.status >= 200 && response.status < 300) { // Sync success
            setTimeout(() => fetchContentDetail(false), 1000);
        }

    } catch (error) {
        console.error(`操作 ${actionType} 失败:`, error);
        setAlert({ open: true, message: `操作失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        // Optionally update contentDetail status to an error state if applicable
         if (contentDetail) {
            setContentDetail(prev => ({...prev, status: `error_${actionType}`}));
        }
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };
  // Your existing pollTaskStatus, handleBatchGenerateAudio, handleGenerateSentenceAudio,
  
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
          console.error("播放音频失败:", err);
          setAlert({ open: true, message: `播放音频失败: ${err.message || '无法加载音频资源。'}`, severity: 'error' });
          setPlayingAudio(null);
        });
      newAudio.onended = () => setPlayingAudio(null);
      newAudio.onerror = (e) => {
        console.error("音频播放器错误:", e);
        setAlert({ open: true, message: `无法播放音频: ${e.target.error?.message || '未知播放错误。'}`, severity: 'error' });
        setPlayingAudio(null);
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
  // handlePlayAudio, handleUpdateSentence, handleDeleteSentence should largely remain the same.
  // Ensure pollTaskStatus correctly updates contentDetail or triggers fetchContentDetail on completion.
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

  const handleDeleteSentence = async (sentenceId) => {
    const loadingKey = `delete_sentence_${sentenceId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    setAlert({ open: false, message: '', severity: 'info' });
    try {
        await ttsApi.deleteSentence(sentenceId); // 假设有这个API
        setAlert({ open: true, message: '句子删除成功！', severity: 'success' });
        fetchContentDetail(false); // 刷新数据
    } catch (error) {
        console.error(`删除句子 ${sentenceId} 失败:`, error);
        setAlert({ open: true, message: `删除句子失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
    } finally {
        setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };



  // --- 计算 inputScriptForDisplay 和 outputScriptForDisplay 的逻辑保持不变 ---
  const currentActiveStepDetails = workflowSteps.find(s => s.key === activeStepKey);
  let inputScriptForDisplay = null;
  // let outputScriptForDisplay = null; // 对于 splitSentences，我们不再特别关注这个用于面板显示

  if (contentDetail && currentActiveStepDetails) {
    if (currentActiveStepDetails.inputScriptTypeKey === 'original_content') {
        inputScriptForDisplay = { content: editingStepInputContent || contentDetail.original_content || "加载原始文本...", id: null, script_type: 'original_content' };
    } else if (currentActiveStepDetails.inputScriptTypeKey && contentDetail.scripts) {
        const inputScriptsOfType = contentDetail.scripts
            .filter(s => s.script_type === currentActiveStepDetails.inputScriptTypeKey)
            .sort((a, b) => b.version - a.version);
        if (inputScriptsOfType.length > 0) {
            inputScriptForDisplay = inputScriptsOfType[0];
        }
    }
    // 对于 outputScriptForDisplay，我们之前的逻辑是：
    // if (currentActiveStepDetails.outputScriptTypeKey && contentDetail.scripts) {
    //     outputScriptForDisplay = contentDetail.scripts.find(s => s.script_type === currentActiveStepDetails.outputScriptTypeKey);
    // }
    // 这个逻辑对于非 splitSentences 步骤仍然有用，但 splitSentences 会特殊处理。
  }


  return (
    <Box>
      <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({ ...prev, open: false }))} />
      <PageHeader
        title={`培训内容: ${contentDetail?.content_name || 'Loading...'}`}
        description={`Status: ${contentDetail?.status || '未知'} | Created: ${contentDetail?.created_at ? formatRelativeTime(contentDetail.created_at) : ''} by ${contentDetail?.uploader_username || ''}`}
      />
      {overallProgress && (
        <Paper sx={{ p: 2, mb: 2, backgroundColor: '#e3f2fd' }}>
          <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
            批量语音生成进度:
          </Typography>
          {/* 调试：直接打印 overallProgress 对象 */}
          {/* <pre>{JSON.stringify(overallProgress, null, 2)}</pre> */}
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
        <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 1, mb: 2, alignItems: 'center' }}>
          {workflowSteps.map((step, index) => {
            const isStepActive = activeStepKey === step.key;
            let prevStepCompleted = true;
            if (index > 0) {
                const prevStep = workflowSteps[index-1];
                prevStepCompleted = prevStep.isCompleted ? 
                    prevStep.isCompleted(contentDetail?.status, contentDetail?.scripts, contentDetail?.final_script_sentences, contentDetail?.latest_merged_audio)
                    : false;
            }
            const isStepEnabled = step.isEnabled ? 
                step.isEnabled(contentDetail?.status, prevStepCompleted, contentDetail?.final_script_sentences) 
                : prevStepCompleted;

            return (
              <React.Fragment key={step.key}>
                <Button
                  variant={isStepActive ? "contained" : "outlined"}
                  onClick={() => handleWorkflowStepClick(step.key)}
                  disabled={!isStepEnabled && !isStepActive && !(step.isCompleted && step.isCompleted(contentDetail?.status, contentDetail?.scripts, contentDetail?.final_script_sentences, contentDetail?.latest_merged_audio))}
                  sx={{textTransform: 'none', flexShrink: 0, whiteSpace: 'nowrap'}}
                >
                  {step.label}
                </Button>
                {index < workflowSteps.length - 1 && <KeyboardArrowRightIcon color="disabled" />}
              </React.Fragment>
            );
          })}
        </Stack>

        {/* Dynamic Content Area based on activeStepKey */}
        {currentActiveStepDetails && contentDetail && (
          <Box mt={2}>
            <Typography variant="h5" gutterBottom sx={{mb:2}}>{currentActiveStepDetails.label}</Typography>
            
            {/* --- 特殊布局 for 'splitSentences' step --- */}
            {currentActiveStepDetails.key === 'splitSentences' ? (
              <Box>
                {/* 1. 输入区域: Final TTS Script */}
                <Paper variant="outlined" sx={{ p: 2, mb: 3 }}> {/* mb:3 给下方列表留出空间 */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h6">
                      {currentActiveStepDetails.inputLabel} {/* "Final TTS Script" */}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      {isEditingInput ? (
                        <Button 
                            variant="contained" 
                            size="small"
                            startIcon={<SaveIcon />} 
                            onClick={handleSaveEditedInputScript} // 假设这个函数已适配保存 inputScriptForDisplay
                            disabled={actionLoading[`save_input_script_${inputScriptForDisplay?.id}`] || !inputScriptForDisplay}
                        >
                            {actionLoading[`save_input_script_${inputScriptForDisplay?.id}`] ? <CircularProgress size={16}/> : "Save"}
                        </Button>
                      ) : (
                        <Button 
                            variant="outlined" 
                            size="small"
                            startIcon={<EditIcon />} 
                            onClick={handleEditInputScript} // 切换到编辑模式
                            disabled={!inputScriptForDisplay} // 如果没有输入脚本，则禁用编辑
                        >
                            Edit
                        </Button>
                      )}
                      {isEditingInput && ( // 取消编辑按钮仅在编辑模式下显示
                          <Button variant="outlined" size="small" onClick={() => {setIsEditingInput(false); initializeStepInput(currentActiveStepDetails, contentDetail); }}>
                              Cancel
                          </Button>
                      )}
                      <Button
                          variant="contained"
                          color="primary" // 或者你想要的颜色
                          size="small"
                          startIcon={actionLoading[`${currentActiveStepDetails.actionName}_${inputScriptForDisplay?.id}`] ? <CircularProgress size={16} color="inherit"/> : <CachedIcon />}
                          onClick={() => handleRecreateOutput(currentActiveStepDetails.actionName, inputScriptForDisplay?.id)} // 这个应该是“重新拆分”
                          disabled={actionLoading[`${currentActiveStepDetails.actionName}_${inputScriptForDisplay?.id}`] || !inputScriptForDisplay}
                      >
                          Re-split
                      </Button>
                    </Stack>
                  </Box>
                  
                  {/* 文本显示/编辑区域 */}
                  {isEditingInput ? (
                    <TextareaAutosize
                      minRows={10}
                      style={{ width: '100%', padding: '8px', fontFamily: 'monospace', border: '1px solid #ccc', borderRadius: '4px', flexGrow: 1, fontSize:'0.9rem' }}
                      value={editingStepInputContent}
                      onChange={(e) => setEditingStepInputContent(e.target.value)}
                    />
                  ) : (
                    <Box sx={{ 
                        flexGrow: 1, 
                        overflowY: 'auto', 
                        whiteSpace: 'pre-wrap', 
                        p:1, 
                        border: '1px solid #eee', 
                        borderRadius: 1, 
                        maxHeight: 300, // 或根据需要调整
                        minHeight: 150, // 给一个最小高度
                        backgroundColor: '#f9f9f9' 
                    }}>
                      {inputScriptForDisplay?.content || editingStepInputContent || "无最终脚本内容或等待加载..."}
                    </Box>
                  )}
                </Paper>

                {/* 2. 输出区域: Final TTS Sentences List */}
                {/* SentenceList 组件会在这里渲染，它本身就是一个 Card */}
                {contentDetail.final_script_sentences && ( // 只有当有句子时才渲染列表
                    <SentenceList
                        sentences={contentDetail.final_script_sentences}
                        playingAudio={playingAudio}
                        actionLoading={actionLoading}
                        onPlayAudio={handlePlayAudio}
                        onGenerateAudio={handleGenerateSentenceAudio}
                        onUpdateSentenceText={handleUpdateSentence}
                        onDeleteSentence={handleDeleteSentence}
                    />
                )}
              </Box>
            ) : (
              // --- 默认的左右布局 for other steps ---
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}> {/* Input Panel */}
                  <Paper variant="outlined" sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="h6" gutterBottom>{currentActiveStepDetails.inputLabel}</Typography>
                    {isEditingInput && currentActiveStepDetails.inputScriptTypeKey !== 'original_content' ? (
                      <TextareaAutosize /* ... */ />
                    ) : (
                      <Box /* ... */ >
                        {inputScriptForDisplay?.content || editingStepInputContent || (currentActiveStepDetails.inputScriptTypeKey === 'original_content' ? "原始培训内容加载中或不可用..." : "无输入内容")}
                      </Box>
                    )}
                    <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between' }}>
                        {/* ... (Edit/Save/Cancel buttons for input panel) ... */}
                    </Box>
                  </Paper>
                </Grid>

                <Grid item xs={12} md={6}> {/* Output Panel */}
                  <Paper variant="outlined" sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="h6" gutterBottom>{currentActiveStepDetails.outputLabel}</Typography>
                    <Box sx={{ flexGrow: 1, /* ... */ }}>
                      {(() => { // IIFE 来处理 outputScriptForDisplay 的查找
                          let outputScriptForStep = null;
                          if (currentActiveStepDetails.outputScriptTypeKey && contentDetail.scripts) {
                              outputScriptForStep = contentDetail.scripts.find(s => s.script_type === currentActiveStepDetails.outputScriptTypeKey);
                          }
                          return outputScriptForStep && outputScriptForStep.content ? 
                                 outputScriptForStep.content : 
                                 "无输出内容或等待生成...";
                      })()}
                    </Box>
                     <Box sx={{ mt: 1, display: 'flex', /* ... */ }}>
                        <Button /* Re-create Output Button */ > {/* ... */} </Button>
                        {(() => { // IIFE 来处理 outputScriptForDisplay 的查找
                            let outputScriptForStep = null;
                            if (currentActiveStepDetails.outputScriptTypeKey && contentDetail.scripts) {
                                outputScriptForStep = contentDetail.scripts.find(s => s.script_type === currentActiveStepDetails.outputScriptTypeKey);
                            }
                            return outputScriptForStep ? 
                                   <Button size="small" onClick={() => handleOpenFullScriptDialog(outputScriptForStep)}>查看/编辑输出</Button> : 
                                   null;
                        })()}
                    </Box>
                  </Paper>
                </Grid>
              </Grid>
            )}

            {/* Sentence List for relevant steps */}
            { currentActiveStepDetails.key === 'generateAndMergeAudio' && contentDetail.final_script_sentences && (
              <Box sx={{mt: 2}}>
                 {currentActiveStepDetails.key === 'generateAndMergeAudio' && (
                     <Stack direction="row" spacing={2} sx={{mb:2}}>
                         <Button variant="contained" onClick={handleBatchGenerateAudio} disabled={actionLoading[`batch_generate_${contentId}`]} startIcon={actionLoading[`batch_generate_${contentId}`] ? <CircularProgress size={16} /> : <PlaylistPlayIcon />}>
                            批量生成语音
                        </Button>
                        <Button variant="contained" color="secondary" onClick={() => {/* TODO: handleMergeAudio(); */}} disabled={actionLoading['merge_audio'] /*|| !all_sentences_generated*/ } startIcon={actionLoading['merge_audio'] ? <CircularProgress size={16} /> : <CloudUploadIcon />}>
                            合并所有语音
                        </Button>
                     </Stack>
                 )}
                <SentenceList
                    sentences={contentDetail.final_script_sentences}
                    playingAudio={playingAudio}
                    actionLoading={actionLoading}
                    onPlayAudio={handlePlayAudio}
                    onGenerateAudio={handleGenerateSentenceAudio}
                    onUpdateSentenceText={handleUpdateSentence}
                    onDeleteSentence={handleDeleteSentence}
                />
              </Box>
            )}
          </Box>
        )}
      </Paper>
    
      {/* Dialog for viewing/editing ANY script (kept from original) */}
      {/* 查看/编辑脚本/原文对话框 */}
      <Dialog 
        open={showFullScriptDialog.open} 
        onClose={() => setShowFullScriptDialog({open: false, title: '', content: '', scriptId: null, scriptType: '', isOriginalContent: false})} 
        maxWidth="lg" // 或者 "xl" 使其更大
        fullWidth 
        scroll="paper"
      >
          <DialogTitle>{showFullScriptDialog.title}</DialogTitle>
          <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column' }}> {/* 允许内容增长 */}
              <TextField
                  fullWidth
                  multiline
                  value={editingDialogScriptContent}
                  onChange={(e) => setEditingDialogScriptContent(e.target.value)}
                  variant="outlined"
                  sx={{ 
                    fontFamily: 'monospace', 
                    fontSize: '0.9rem', 
                    whiteSpace: 'pre-wrap',
                    flexGrow: 1, // 使 TextField 占据可用空间
                    minHeight: '60vh', // 至少占据视口高度的60%
                  }}
                  // InputProps={{ sx: { height: '100%' } }} // 尝试让输入框本身也增长
                  // 如果用 TextareaAutosize:
                  // component={TextareaAutosize}
                  // minRows={20} // 至少20行
                  // style={{ width: '100%', padding: '8px', fontFamily: 'monospace', border: '1px solid #ccc', borderRadius: '4px', flexGrow: 1, fontSize: '0.9rem' }}
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