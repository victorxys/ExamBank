// frontend/src/components/SentenceList.jsx

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, CircularProgress, Chip, Grid, Card, CardHeader, CardContent,
  TableContainer, Table, TableHead, TableRow, TableCell, TableBody, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions,  FormControl, InputLabel, Select, MenuItem, // 用于引擎选择
  List, ListItem, ListItemText, Divider, IconButton, TextField, Stack, TextareaAutosize,FormControlLabel,Checkbox,
  Badge,
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
    CloudUpload as CloudUploadIcon,
    MergeType as MergeTypeIcon,
    GraphicEq as GraphicEqIcon, // 一个示例图标 for Gemini
    Movie as MovieIcon, // 用于视频合成步骤
    Subtitles as SubtitlesIcon // 新增字幕图标
} from '@mui/icons-material';
import { API_BASE_URL } from '../config';
import formatMsToTime from '../utils/timeUtils'; // 确保有这个工具函数来格式化时间戳

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
    // --- 1. 新增 State ---
    const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'generated', 'pending', 'error'
    const [showModifiedOnly, setShowModifiedOnly] = useState(false); // 控制是否只显示修改过的句子
    // --- ----------------- ---
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

    // --- 2. 增强的 useMemo 过滤逻辑 ---
    const filteredSentences = useMemo(() => {
        return sentences
            .map(sentence => { // 首先，为每个句子附加 segmentInfo
                const segment = mergedAudioSegments?.find(
                    seg => seg.tts_sentence_id === sentence.id && seg.original_order_index === sentence.order_index
                );
                return { ...sentence, segmentInfo: segment || null };
            })
            .filter(sentence => {
                // 状态筛选
                const statusMatch = statusFilter === 'all' ||
                                    (statusFilter === 'generated' && sentence.audio_status === 'generated') ||
                                    (statusFilter === 'pending' && (sentence.audio_status?.includes('pending') || sentence.audio_status?.includes('generating') || sentence.audio_status === 'queued')) ||
                                    (statusFilter === 'error' && sentence.audio_status?.startsWith('error'));
                if (!statusMatch) return false;

                // 修改标记筛选
                if (showModifiedOnly && !sentence.modified_after_merge) {
                    return false;
                }

                // 搜索筛选 (现在可以搜索句子内容或ID)
                if (searchTerm.trim() === '') return true;
                const lowerSearchTerm = searchTerm.toLowerCase();
                const isIdMatch = sentence.id.toLowerCase().startsWith(lowerSearchTerm);
                const isTextMatch = sentence.text.toLowerCase().includes(lowerSearchTerm);
                return isIdMatch || isTextMatch;
            });
    }, [sentences, mergedAudioSegments, statusFilter, showModifiedOnly, searchTerm]);
    // --- ----------------------------- ---


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
                    // --- 3. 添加新的筛选和搜索UI ---
                    action={
                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={showModifiedOnly}
                                        onChange={(e) => setShowModifiedOnly(e.target.checked)}
                                        color="primary"
                                    />
                                }
                                label="仅显示新修改的句子"
                                sx={{ mr: 2 }}
                            />
                            <FormControl size="small" sx={{ minWidth: 150 }}>
                                <InputLabel>状态筛选</InputLabel>
                                <Select
                                    value={statusFilter}
                                    label="状态筛选"
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                >
                                    <MenuItem value="all">所有状态</MenuItem>
                                    <MenuItem value="generated">已生成</MenuItem>
                                    <MenuItem value="pending">待处理</MenuItem>
                                    <MenuItem value="error">失败</MenuItem>
                                </Select>
                            </FormControl>
                            <TextField
                                size="small"
                                variant="outlined"
                                placeholder="搜索内容或ID..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                InputProps={{
                                    startAdornment: (<SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />),
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
                                            <TableCell>
                                                {/* --- 4. 添加小红点标记 --- */}
                                                <Badge color="error" variant="dot" invisible={!sentence.modified_after_merge}>
                                                    {sentence.order_index + 1}
                                                </Badge>
                                            </TableCell>
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
                                                        <Button size="small" variant="outlined" onClick={() => onGenerateAudio(sentence.id,'gemini_tts')} disabled={actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating'} startIcon={(actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating') ? <CircularProgress size={16} /> : <AudiotrackIcon />}>
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
export default SentenceList;