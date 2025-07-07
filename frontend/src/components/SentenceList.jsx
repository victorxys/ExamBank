// frontend/src/components/SentenceList.jsx

import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, CircularProgress, Chip, Grid, Card, CardHeader, CardContent,
  TableContainer, Table, TableHead, TableRow, TableCell, TableBody, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions,  FormControl, InputLabel, Select, MenuItem, // 用于引擎选择
  List, ListItem, ListItemText, Divider, IconButton, TextField, Stack, TextareaAutosize,FormControlLabel,Checkbox,Collapse,
  Badge,FormHelperText,Slider,
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
    Settings as SettingsIcon,
    MergeType as MergeTypeIcon,
    GraphicEq as GraphicEqIcon, // 一个示例图标 for Gemini
    Movie as MovieIcon, // 用于视频合成步骤
    Subtitles as SubtitlesIcon // 新增字幕图标
} from '@mui/icons-material';
import { API_BASE_URL } from '../config';
import formatMsToTime from '../utils/timeUtils'; // 确保有这个工具函数来格式化时间戳
import { formatRelativeTime } from '../api/dateUtils';
import MiniAudioPlayer from './MiniAudioPlayer'; // 导入新的迷你播放器组件


// SentenceList 子组件
const SentenceList = ({ 
    sentences, 
    // playingAudio, 
    actionLoading, 
    // onPlayAudio, 
    globalTtsConfig,
    onGenerateAudio, 
    onUpdateSentenceText, 
    onDeleteSentence,
    onSaveSentenceConfig,
    mergedAudioSegments // 新增：传递合并后的分段信息
}) => {
    // --- 1. 新增 State ---
    const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'generated', 'pending', 'error'
    const [showModifiedOnly, setShowModifiedOnly] = useState(false); // 控制是否只显示修改过的句子
    // --- ----------------- ---
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(50);
    const [searchTerm, setSearchTerm] = useState('');

    const [expandedSentenceId, setExpandedSentenceId] = useState(null); // <-- State for expansion
    const [editingConfig, setEditingConfig] = useState(null); // <-- State for the config being edited

    
    // 迷你播放器相关
    const [playerDialogOpen, setPlayerDialogOpen] = useState(false);
    const [currentPlayingSentence, setCurrentPlayingSentence] = useState(null); // 存储 { id, text, url }
    const [activeMiniPlayerId, setActiveMiniPlayerId] = useState(null);
    
    const handleOpenPlayerDialog = (sentence) => {
        const audioRelativePath = sentence.latest_audio_url; // 这是数据库中的 file_path，例如 "CONTENT_ID/SENTENCE_ID/audio.wav"

        if (audioRelativePath) {
            // ++++++ 关键修改：构建指向 /static/tts_audio/ 的 URL ++++++
            // 假设您的 Flask 应用将 tts_audio 目录放在了其 static 文件夹下。
            // API_BASE_URL 通常是 http://.../api
            // API_BASE_URL.replace('/api', '') 得到 http://...
            const baseUrl = API_BASE_URL.replace('/api', '');
            
            // 拼接成标准 Flask 静态文件 URL: /static/<sub-folder>/<file>
            // 您在后端保存文件时，保存到了 'static/tts_audio'，而 file_path 是 'CONTENT_ID/SENTENCE_ID/audio.wav'
            // 所以 URL 应该是 /static/tts_audio/CONTENT_ID/SENTENCE_ID/audio.wav
            // 这里的 audioRelativePath 已经包含了 CONTENT_ID/SENTENCE_ID/audio.wav
            
            // 我们需要确保音频文件确实在 Flask 认为的 'static' 目录下的 'tts_audio' 子目录中。
            // 您 Celery 任务中的 _save_audio_file 函数保存路径是：
            // storage_base_path = app.config.get('TTS_AUDIO_STORAGE_PATH', os.path.join(app.root_path, 'static', 'tts_audio'))
            // app.root_path 通常是 'backend/'，所以物理路径是 'backend/static/tts_audio'。这是正确的。

            // Flask 默认会服务 'static' 文件夹下的内容，URL 路径是 '/static'
            // 所以，我们需要构建的 URL 是: <base_url>/static/tts_audio/<relative_path_from_db>
            
            // 注意：您之前使用的 /media/tts_audio/ 是不正确的，因为没有对应的 Nginx location 或 Flask 路由。
            const fullAudioUrl = `${baseUrl}/static/tts_audio/${audioRelativePath}`;
            // ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

            console.log("Corrected audio URL pointing to Flask static path:", fullAudioUrl);

            setCurrentPlayingSentence({
                id: sentence.id,
                text: sentence.text,
                url: fullAudioUrl
            });
            setPlayerDialogOpen(true);
            } else {
                // 如果因为某种原因没有 URL，可以给一个提示
                // 理论上这个按钮在这种情况下不应该被渲染
                alert('该句子没有可播放的音频URL。'); 
            }
        };

    const handleClosePlayerDialog = () => {
        setPlayerDialogOpen(false);
        // 关闭对话框时，可以考虑停止音频，但这通常由 MiniAudioPlayer 的 unmount 处理
        setCurrentPlayingSentence(null); // 清空当前播放的句子信息
    };
    
    const handleToggleMiniPlayer = (sentenceId) => {
        const currentlyActive = activeMiniPlayerId === sentenceId;
        
        // 如果我们即将打开一个新的迷你播放器，
        // 最好通知父组件停止任何正在全局播放的音频。
        if (!currentlyActive) {
            onPlayAudio(null, null); // 传递 null 来停止全局播放器
        }
        
        setActiveMiniPlayerId(currentlyActive ? null : sentenceId);
    };

    const handleMiniPlayerEnded = () => {
        setActiveMiniPlayerId(null); // 当迷你播放器播放结束时自动关闭
    };

    
    


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
                                    (statusFilter === 'not_generated' && (sentence.audio_status?.includes('pending') || sentence.audio_status?.includes('generating') || sentence.audio_status?.includes('queued') || sentence.audio_status?.startsWith('error'))) ||
                                    (statusFilter === 'pending' && (sentence.audio_status?.includes('pending') || sentence.audio_status?.includes('generating') || sentence.audio_status?.includes('queued'))) ||
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

    const handleToggleSettings = (sentence) => {
        const isCurrentlyExpanded = expandedSentenceId === sentence.id;
        if (isCurrentlyExpanded) {
            setExpandedSentenceId(null);
            setEditingConfig(null);
        } else {
            // Priority: sentence.tts_config > globalTtsConfig
            const initialConfig = {
                ...globalTtsConfig,
                ...(sentence.tts_config || {}),
            };
            initialConfig.engine = 'gemini_tts'; 
            setEditingConfig(initialConfig);
            setExpandedSentenceId(sentence.id);
        }
    };

    const handleConfigChange = (field, value) => {
        if (editingConfig) {
            const finalValue = field === 'temperature' ? parseFloat(value) : value;
            setEditingConfig(prev => ({ ...prev, [field]: finalValue }));
        }
    };
    
    const handleSaveConfigClick = (sentenceId) => {
        if (editingConfig && onSaveSentenceConfig) {
            onSaveSentenceConfig(sentenceId, editingConfig);
            // Optionally close panel after saving
            // setExpandedSentenceId(null); 
        }
    };

    const handleGenerateClick = (sentenceId) => {
        if (editingConfig && onGenerateAudio) {
            onGenerateAudio(sentenceId,'gemini_tts', editingConfig);
            // Optionally close panel after generating
            // setExpandedSentenceId(null);
        }
    };

    const renderModelChip = (modelUsed) => {
        if (!modelUsed) {
            return null;
        }

        let chipLabel = modelUsed;
        let chipColor = 'info'; // 默认颜色
        let chipVariant = 'outlined';

        if (modelUsed.includes('pro')) {
            chipLabel = 'Pro';
            chipColor = 'primary'; // 蓝色
            chipVariant = 'filled'; // 使用实心填充，更醒目
        } else if (modelUsed.includes('flash')) {
            chipLabel = 'Flash';
            chipColor = 'success'; // 绿色
            chipVariant = 'filled';
        }

        return (
            <Tooltip title={`使用模型: ${modelUsed}`}>
                <Chip
                    label={chipLabel}
                    size="small"
                    color={chipColor}
                    variant={chipVariant}
                    sx={{ 
                        color: chipVariant === 'filled' ? '#fff' : undefined, // 填充模式下字体设为白色
                        fontWeight: 'bold',
                        letterSpacing: '0.5px'
                    }}
                />
            </Tooltip>
        );
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
                                    <MenuItem value="generated">已生成</MenuItem>not_generated
                                    <MenuItem value="not_generated">未生成</MenuItem>
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
                                    <TableCell sx={{ width: '10%', fontWeight: 'bold', textAlign: 'center' }}>状态与模型</TableCell>
                                    <TableCell sx={{ width: '15%', fontWeight: 'bold', textAlign: 'center' }}>时间信息</TableCell>
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
                                   paginatedSentences.map(sentence => {
                                        const isMiniPlayerActive = activeMiniPlayerId === sentence.id;
                                        const fullAudioUrl = sentence.latest_audio_url 
                                        ? (sentence.latest_audio_url.startsWith('http') 
                                            ? sentence.latest_audio_url 
                                            : `${API_BASE_URL.replace('/api', '')}/media/tts_audio/${sentence.latest_audio_url}`)
                                        : null;

                                        return (
                                            <React.Fragment key={sentence.id}>
                                            <TableRow hover>
                                                <TableCell>
                                                    {/* --- 4. 添加小红点标记 --- */}
                                                    <Badge color="error" variant="dot" invisible={!sentence.modified_after_merge}>
                                                        {sentence.order_index + 1}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell sx={{whiteSpace: "pre-wrap", wordBreak: "break-word"}}>{sentence.text}</TableCell>
                                                <TableCell align="center">
                                                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                                                        {/* 状态 Chip */}
                                                        <Chip 
                                                            label={sentence.audio_status || '未知'} 
                                                            size="small" 
                                                            color={sentence.audio_status === 'generated' ? 'success' : 'default'}
                                                        />
                                                        
                                                        {/* --- 这里是关键修改 --- */}
                                                        {/* 调用新的辅助函数来渲染模型Chip */}
                                                        {renderModelChip(sentence.model_used)}
                                                        {/* --- 修改结束 --- */}

                                                        {/* 自定义配置的提示 Chip */}
                                                        {sentence.tts_config && (
                                                            <Tooltip title="此句有单独配置">
                                                            <Chip label="自定义" size="small" variant="outlined" />
                                                            </Tooltip>
                                                        )}
                                                    </Box>
                                                </TableCell>
                                                <TableCell align="center">
                                                    {/* 第一行：语音更新时间 */}
                                                    {sentence.latest_audio_created_at ? (
                                                        <Tooltip title={`生成于: ${new Date(sentence.latest_audio_created_at).toLocaleString('zh-CN')}`}>
                                                        <Typography variant="caption" color="text.secondary" display="block">
                                                            {/* 使用一个前缀来标识，例如一个图标 */}
                                                            <RefreshIcon sx={{ fontSize: '0.9rem', verticalAlign: 'middle', mr: 0.5, color: 'text.disabled' }} />
                                                            {formatRelativeTime(sentence.latest_audio_created_at)}
                                                        </Typography>
                                                        </Tooltip>
                                                    ) : (
                                                        // 如果没有更新时间，可以显示一个占位符或空内容，以保持对齐
                                                        <Typography variant="caption" color="text.disabled" display="block">-</Typography>
                                                    )}
                                                    
                                                    {/* 直接使用预计算的 sentence.segmentInfo */}
                                                    {sentence.segmentInfo ? 
                                                        <Tooltip title={`开始: ${sentence.segmentInfo.start_ms}ms, 结束: ${sentence.segmentInfo.end_ms}ms, 时长: ${sentence.segmentInfo.duration_ms}ms`}>
                                                            <span>{`${formatMsToTime(sentence.segmentInfo.start_ms)} - ${formatMsToTime(sentence.segmentInfo.end_ms)}`}</span>
                                                        </Tooltip>
                                                        : '-'}
                                                </TableCell>
                                                <TableCell align="right">
                                                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                                        <Tooltip title="编辑句子">
                                                            <span>
                                                            {/* 传递的是包含了 segmentInfo 的 sentence 对象，但不影响 dialog 的逻辑 */}
                                                            <IconButton size="small" onClick={() => handleOpenEditSentenceDialog(sentence)} color="default">
                                                                <EditIcon fontSize="small" />
                                                            </IconButton>
                                                            </span>
                                                        </Tooltip>
                                                        <Tooltip title="删除句子">
                                                            <span>
                                                            <IconButton size="small" onClick={() => handleOpenDeleteSentenceDialog(sentence)}             color={isMiniPlayerActive ? "secondary" : "primary"}
>
                                                                <DeleteIcon fontSize="small" />
                                                            </IconButton>
                                                            </span>
                                                        </Tooltip>
                                                        {/* +++++ 修改播放按钮的行为以打开对话框 +++++ */}
                                                        {sentence.audio_status === 'generated' && sentence.latest_audio_url && (
                                                            <Tooltip title="预览语音">
                                                                <span> {/* 解决 disabled 按钮的 Tooltip 警告 */}
                                                                    <IconButton 
                                                                        size="small" 
                                                                        onClick={() => handleOpenPlayerDialog(sentence)} 
                                                                        color="primary"
                                                                        disabled={!sentence.latest_audio_url} // 如果没有 URL 则禁用
                                                                    >
                                                                        <PlayArrowIcon />
                                                                    </IconButton>
                                                                </span>
                                                            </Tooltip>
                                                        )}
                                                        {/* +++++++++++++++++++++++++++++++++++++++++++ */}
                                                        {sentence.audio_status === 'generated' && sentence.latest_audio_url && (
                                                            <Tooltip title="下载">
                                                                <IconButton size="small" href={sentence.latest_audio_url.startsWith('http') ? sentence.latest_audio_url : `${API_BASE_URL.replace('/api', '')}/media/tts_audio/${sentence.latest_audio_url}`} download={`sentence_${sentence.order_index + 1}.wav`} color="primary">
                                                                    <DownloadIcon />
                                                                </IconButton>
                                                            </Tooltip>
                                                        )}
                                                        {(['pending_generation', 'error_generation', 'pending_regeneration', 'error_submission', 'error_polling', 'queued'].includes(sentence.audio_status) || !sentence.audio_status) && (
                                                            <span>
                                                            <Button size="small" variant="outlined" onClick={() => onGenerateAudio(sentence.id,'gemini_tts')} disabled={actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating'} startIcon={(actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating') ? <CircularProgress size={16} /> : <AudiotrackIcon />}>
                                                                {sentence.audio_status?.startsWith('error') ? '重试' : '生成'}
                                                            </Button>
                                                            </span>
                                                        )}
                                                        <Tooltip title="生成设置">
                                                            <IconButton size="small" onClick={() => handleToggleSettings(sentence)} color={expandedSentenceId === sentence.id ? "primary" : "default"}>
                                                                <SettingsIcon fontSize="small" />
                                                            </IconButton>
                                                        </Tooltip>
                                                        {sentence.audio_status === 'generated' && (
                                                            <Tooltip title="重新生成语音">
                                                                <span>
                                                                    <IconButton size="small" onClick={() => onGenerateAudio(sentence.id,'gemini_tts')} disabled={actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating'} sx={{ ml: 0.5 }}>
                                                                        {(actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating') ? <CircularProgress size={20} color="inherit" /> : <RefreshIcon />}
                                                                    </IconButton>
                                                                </span>
                                                            </Tooltip>
                                                        )}
                                                        {(sentence.audio_status === 'generating' || sentence.audio_status === 'processing_request') && <CircularProgress size={20} sx={{ ml: 1 }} />}
                                                    </Box>
                                                </TableCell>
                                            </TableRow>
                                            
                                            <TableRow>
                                                <TableCell style={{ padding: 0, border: 0 }} colSpan={5}>
                                                    <Collapse in={expandedSentenceId === sentence.id} timeout="auto" unmountOnExit>
                                                        <Box sx={{ p: 2, backgroundColor: 'rgba(0, 150, 136, 0.05)', borderTop: '1px solid', borderColor: 'divider' }}>
                                                            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
                                                                单句语音生成设置 (序号 {sentence.order_index + 1})
                                                            </Typography>
                                                            {editingConfig && (
                                                                <Grid container spacing={2}>
                                                                    <Grid item xs={12} md={6}>
                                                                        <FormControl fullWidth size="small" margin="dense">
                                                                            <InputLabel>TTS 模型</InputLabel>
                                                                            <Select
                                                                                value={editingConfig.model || ''}
                                                                                label="TTS 模型"
                                                                                onChange={(e) => handleConfigChange('model', e.target.value)}
                                                                            >
                                                                                <MenuItem value="gemini-2.5-flash-preview-tts">Gemini Flash (速度快)</MenuItem>
                                                                                <MenuItem value="gemini-2.5-pro-preview-tts">Gemini Pro (质量高)</MenuItem>
                                                                            </Select>
                                                                        </FormControl>
                                                                        <TextField
                                                                            fullWidth multiline rows={3} margin="dense" size="small"
                                                                            label="系统提示词 (留空则使用全局)"
                                                                            value={editingConfig.system_prompt || ''}
                                                                            placeholder={globalTtsConfig.system_prompt}
                                                                            onChange={(e) => handleConfigChange('system_prompt', e.target.value)}
                                                                        />
                                                                    </Grid>
                                                                    <Grid item xs={12} md={6}>
                                                                        <Typography gutterBottom variant="body2">温度</Typography>
                                                                        <Stack spacing={2} direction="row" alignItems="center">
                                                                            <Slider
                                                                                value={typeof editingConfig.temperature === 'number' ? editingConfig.temperature : 0}
                                                                                onChange={(e, val) => handleConfigChange('temperature', val)}
                                                                                aria-labelledby="sentence-temperature-slider"
                                                                                valueLabelDisplay="auto"
                                                                                // --- 修改点 ---
                                                                                step={0.01}
                                                                                marks={[
                                                                                    { value: 0, label: '0.0' },
                                                                                    { value: 1, label: '1.0' },
                                                                                    { value: 2, label: '2.0' },
                                                                                ]}
                                                                                min={0}
                                                                                max={2}
                                                                                // --- 修改结束 ---
                                                                            />
                                                                            <Chip label={editingConfig.temperature.toFixed(2)} />
                                                                        </Stack>
                                                                    </Grid>
                                                                    <Grid item xs={12} sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, pt: 1 }}>
                                                                        <Button size="small" onClick={() => handleToggleSettings(sentence)}>取消</Button>
                                                                        <Button size="small" variant="outlined" onClick={() => handleSaveConfigClick(sentence.id)} disabled={actionLoading[`save_config_${sentence.id}`]} startIcon={actionLoading[`save_config_${sentence.id}`] ? <CircularProgress size={16}/> : <SaveIcon />}>保存配置</Button>
                                                                        <Button size="small" variant="contained" onClick={() => handleGenerateClick(sentence.id)} disabled={actionLoading[`sentence_${sentence.id}`]} startIcon={actionLoading[`sentence_${sentence.id}`] ? <CircularProgress size={16}/> : <AudiotrackIcon />}>使用此配置生成</Button>
                                                                    </Grid>
                                                                </Grid>
                                                            )}
                                                        </Box>
                                                    </Collapse>
                                                </TableCell>
                                            </TableRow>
                                        </React.Fragment>
                                    )}
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                    {/* +++++ 播放器对话框 +++++ */}
                    <Dialog 
                        open={playerDialogOpen} 
                        onClose={handleClosePlayerDialog}
                        maxWidth="sm" // 可以调整对话框宽度: 'xs', 'sm', 'md', 'lg', 'xl'
                        fullWidth
                    >
                        <DialogTitle sx={{ pb: 1 }}>
                            语音预览
                            <Typography variant="body2" color="text.secondary">
                                {currentPlayingSentence?.text.substring(0, 500) + (currentPlayingSentence?.text.length > 500 ? '...' : '')}
                            </Typography>
                        </DialogTitle>
                        <DialogContent>
                            {currentPlayingSentence && (
                                <Box sx={{ pt: 2 }}> {/* 给播放器一些上边距 */}
                                    <MiniAudioPlayer 
                                        src={currentPlayingSentence.url} 
                                        onEnded={handleClosePlayerDialog} // 播放结束后自动关闭对话框
                                    />
                                </Box>
                            )}
                        </DialogContent>
                       <DialogActions>
                            <Button onClick={handleClosePlayerDialog} autoFocus> {/* <--- 在关闭按钮上使用 autoFocus */}
                                关闭
                            </Button>
                        </DialogActions>
                    </Dialog>
                    {/* ++++++++++++++++++++++++ */}
                
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