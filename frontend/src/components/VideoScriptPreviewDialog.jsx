// frontend/src/components/VideoScriptPreviewDialog.jsx

import React, { useState, useEffect, useMemo } from 'react';
import {
    Box, Button, Typography, IconButton, CircularProgress,
    Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Alert, Paper
} from '@mui/material';
import {
    Close as CloseIcon, ArrowBack as ArrowBackIcon, ArrowForward as ArrowForwardIcon,
    ArrowUpward as ArrowUpwardIcon, ArrowDownward as ArrowDownwardIcon, Save as SaveIcon
} from '@mui/icons-material';
import { API_BASE_URL } from '../config';
import { ttsApi } from '../api/tts';

// 辅助函数：将 'HH:MM:SS,ms' 格式的时间字符串只显示到秒
// --- 辅助函数 ---
const formatTime = (timeStr) => {
    if (!timeStr || typeof timeStr !== 'string') return 'N/A';
    const separatorIndex = Math.max(timeStr.lastIndexOf(','), timeStr.lastIndexOf('.'));
    return separatorIndex !== -1 ? timeStr.substring(0, separatorIndex) : timeStr;
};
const timeStrToMs = (timeStr) => {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const parts = timeStr.replace(',', '.').split(':');
    if (parts.length !== 3) return 0;
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
};
const msToSrtTime = (ms) => {
    if (typeof ms !== 'number' || isNaN(ms)) return '00:00:00,000';
    const date = new Date(ms);
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds},${milliseconds}`;
};

const normalizeText = (text) => {
    if (typeof text !== 'string') return '';
    // 移除所有标点符号、空格、换行符，并转为小写
    return text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()\[\]\n\s]/g, "").toLowerCase();
};

const VideoScriptPreviewDialog = ({ open, onClose, synthesisTask, onScriptSave, allSentences }) => {
    const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [expandedSentences, setExpandedSentences] = useState({});
    const [editableScripts, setEditableScripts] = useState([]);
    
    const imagePaths = synthesisTask?.ppt_image_paths || [];

    useEffect(() => {
        if (open) {
            console.clear();
            // console.log("======================= 最终诊断开始 (双重验证版) =======================");
            
            const videoScriptsFromProp = synthesisTask?.video_script_json?.video_scripts || [];
            if (!allSentences || allSentences.length === 0 || videoScriptsFromProp.length === 0) {
                setEditableScripts([]);
                return;
            }

            // 1. 预处理原始句子，附加必要信息
            const allSentencesWithId = allSentences.map((s, i) => ({
                ...s,
                ui_id: `sentence-${i}`,
                normalizedText: normalizeText(s.text),
                // ++++++++++++++++ 核心修复：在这里添加 srt_num ++++++++++++++++
                // 我们将 order_index + 1 作为字幕的序号 (序号通常从1开始)
                srt_num: (s.order_index !== undefined && s.order_index !== null) ? s.order_index + 1 : i + 1,
                // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
            }));
            

            // <<< --- 全新的、基于时间和文本双重验证的匹配算法 --- >>>
            let processedScripts = [];
            const matchedSentenceIds = new Set(); 

            // 1. 预处理原始句子，添加毫秒和UI-ID
            const sentencesWithMs = allSentencesWithId.map((s, i) => {
                const timeRange = s.time_range || '';
                const [startStr, endStr] = timeRange.split('~').map(t => t.trim());
                return { 
                    ...s, 
                    ui_id: `sentence-${i}`,
                    startMs: timeStrToMs(startStr),
                    endMs: timeStrToMs(endStr)
                };
            });
            
            // 2. 遍历 LLM 返回的 "PPT页-时间范围" 映射
            videoScriptsFromProp.forEach(scriptMap => {
                const pageNum = parseInt(scriptMap.ppt_page, 10);
                const llmTimeRange = scriptMap.time_range;
                if (!pageNum || !llmTimeRange) return;

                const [llmStartStr, llmEndStr] = llmTimeRange.split('~').map(s => s.trim());
                const llmStartTimeMs = timeStrToMs(llmStartStr);
                const llmEndTimeMs = timeStrToMs(llmEndStr);

                // console.log(`\n--- 正在处理 PPT 第 ${pageNum} 页 (时间范围: ${llmStartTimeMs}ms ~ ${llmEndTimeMs}ms) ---`);

                // 3. 进行双重过滤
                const matchedSentences = sentencesWithMs.filter(sentence => {
                    // 条件1: 时间戳必须在LLM给定的范围内
                    const isTimeMatch = sentence.startMs >= llmStartTimeMs && sentence.startMs < llmEndTimeMs;
                    
                    // 条件2: 尚未被其他页匹配过
                    const isNotMatchedYet = !matchedSentenceIds.has(sentence.ui_id);
                    
                    if (isTimeMatch && isNotMatchedYet) {
                        // console.log(`    ✅ 匹配成功 (时间戳吻合): "${sentence.text}"`);
                        return true;
                    }
                    return false;
                });
                
                // 4. 为所有匹配到的句子打上正确的页码标签
                if (matchedSentences.length > 0) {
                    const pageScripts = matchedSentences.map(sentence => {
                        matchedSentenceIds.add(sentence.ui_id); // 标记为已匹配
                        return {
                            ...sentence,
                            ppt_page: pageNum,
                            id: sentence.ui_id
                        };
                    });
                    processedScripts.push(...pageScripts);
                }
            });
            
            setEditableScripts(processedScripts);
            // <<< -------------------------------------------------- >>>
            
            setCurrentSlideIndex(0);
            setExpandedSentences({});
        }
    }, [open, synthesisTask, allSentences]);

    const handleClose = () => { if (!isLoading) onClose(); };
    const handleNextPage = () => { if (currentSlideIndex < imagePaths.length - 1) setCurrentSlideIndex(currentSlideIndex + 1); };
    const handlePrevPage = () => { if (currentSlideIndex > 0) setCurrentSlideIndex(currentSlideIndex - 1); };
    const toggleSentenceExpansion = (sentenceId) => setExpandedSentences(prev => ({ ...prev, [sentenceId]: !prev[sentenceId] }));

    const moveSentenceToPrev = (sentenceId, currentPageNum) => {
        if (currentPageNum <= 1) return;
        setEditableScripts(prev => prev.map(s => s.id === sentenceId ? { ...s, ppt_page: currentPageNum - 1 } : s));
    };
    const moveSentenceToNext = (sentenceId, currentPageNum) => {
        if (currentPageNum >= imagePaths.length) return;
        setEditableScripts(prev => prev.map(s => s.id === sentenceId ? { ...s, ppt_page: currentPageNum + 1 } : s));
    };

    const handleSaveChanges = async () => {
        if (!synthesisTask?.id) { setError("任务ID丢失"); return; }
        setIsLoading(true);
        setError('');
        try {
            const scriptsByPage = editableScripts.reduce((acc, script) => {
                const page = script.ppt_page;
                if (page === undefined || page === null) return acc;
                if (!acc[page]) acc[page] = [];
                acc[page].push(script);
                return acc;
            }, {});

            const newVideoScripts = Object.keys(scriptsByPage).map(pageNum => {
                const sentencesOnPage = scriptsByPage[pageNum].filter(s => s && s.time_range);
                if (sentencesOnPage.length === 0) return null;
                
                sentencesOnPage.sort((a, b) => a.time_range.localeCompare(b.time_range));
                
                const combinedText = sentencesOnPage.map(s => s.text || '').join(' ').trim();
                const startTimeMs = timeStrToMs(sentencesOnPage[0].time_range.split('~')[0]);
                const endTimeMs = timeStrToMs(sentencesOnPage[sentencesOnPage.length - 1].time_range.split('~')[1]);
                const combinedTimeRange = `${msToSrtTime(startTimeMs)} ~ ${msToSrtTime(endTimeMs)}`;
                
                return { ppt_page: parseInt(pageNum, 10), text: combinedText, time_range: combinedTimeRange };
            }).filter(Boolean);

            const updatedJson = { ...synthesisTask.video_script_json, video_scripts: newVideoScripts };
            await ttsApi.updateVideoScript(synthesisTask.id, updatedJson);
            if (onScriptSave) onScriptSave(updatedJson);
            handleClose();
        } catch (err) {
            console.error("保存失败:", err);
            setError(err.response?.data?.error || err.message || "保存失败");
        } finally {
            setIsLoading(false);
        }
    };

    const currentPageNum = currentSlideIndex + 1;
    const currentImageUrl = (imagePaths[currentSlideIndex]) ? `${API_BASE_URL.replace('/api', '')}/media/${imagePaths[currentSlideIndex]}` : '';
    const currentSentences = editableScripts.filter(script => String(script.ppt_page) === String(currentPageNum))
                                       .sort((a, b) => (a.time_range || '').localeCompare(b.time_range || ''));



    if (!open) {
        return null; // 对话框关闭时不渲染任何东西
    }
    
    // 渲染主内容区域的函数
    const renderContent = () => {
        const hasImages = imagePaths && imagePaths.length > 0;
        // 如果没有任务数据或图片路径，显示加载或空状态
        if (!synthesisTask || !hasImages) {
             return (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    <Box textAlign="center" p={3}>
                        {isLoading ? <CircularProgress /> : <Typography color="text.secondary">无预览数据或PPT图片路径为空。</Typography>}
                    </Box>
                </Box>
            );
        }

        return (
            <>
                {/* 左侧: PPT 预览 */}
                <Box sx={{ width: { xs: '100%', lg: '60%' }, p: 3, display: 'flex', flexDirection: 'column', borderRight: { lg: '1px solid #eee' } }}>
                    <Box sx={{ flexGrow: 1, bgcolor: 'grey.200', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2, p: 1, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)' }}>
                        <img src={currentImageUrl} alt={`PPT 第 ${currentPageNum} 页`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px' }} />
                    </Box>
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Button onClick={handlePrevPage} disabled={currentSlideIndex === 0} startIcon={<ArrowBackIcon />}>前一页</Button>
                        <Typography variant="body1" fontWeight="medium">{currentPageNum} / {imagePaths.length}</Typography>
                        <Button onClick={handleNextPage} disabled={currentSlideIndex >= imagePaths.length - 1} endIcon={<ArrowForwardIcon />}>后一页</Button>
                    </Box>
                </Box>

                {/* 右侧: 字幕列表 */}
                <Box sx={{ width: { xs: '100%', lg: '40%' }, p: 3, display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="h3" gutterBottom>对应字幕</Typography>
                    <Box sx={{ flexGrow: 1, overflowY: 'auto', pr: 1 }}>
                        {currentSentences.length > 0 ? currentSentences.map((sentence, index) => {
                            const isFirst = index === 0;
                            const isLast = index === currentSentences.length - 1;
                            const isExpanded = !!expandedSentences[sentence.id];
                            const timeParts = (sentence.time_range || ' ~ ').split('~');

                            return (
                                <Paper key={sentence.id} variant="outlined" sx={{ p: 2, mb: 1.5, position: 'relative' }}>
                                    <Box display="flex" justifyContent="space-between" alignItems="start">
                                        <Typography variant="caption" color="text.secondary">#{sentence.srt_num || 'N/A'}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {formatTime(timeParts[0])} - {formatTime(timeParts[1])}
                                        </Typography>
                                    </Box>
                                    <Typography 
                                        variant="body2" 
                                        sx={{ 
                                            mt: 1, 
                                            whiteSpace: 'pre-wrap', 
                                            wordBreak: 'break-word',
                                            // 文本展开/折叠的样式
                                            maxHeight: isExpanded ? 'none' : '4.5em',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            display: '-webkit-box',
                                            WebkitLineClamp: isExpanded ? 'none' : 3,
                                            WebkitBoxOrient: 'vertical',
                                        }}
                                    >
                                        {sentence.text || '(空字幕)'}
                                    </Typography>
                                    {(sentence.text?.length || 0) > 100 && (
                                        <Button size="small" onClick={() => toggleSentenceExpansion(sentence.id)} sx={{ mt: 0.5, p: 0.2 }}>
                                            {isExpanded ? '收起' : '详情'}
                                        </Button>
                                    )}
                                    <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                                        {isFirst && <Button size="small" variant="outlined" startIcon={<ArrowUpwardIcon />} onClick={() => moveSentenceToPrev(sentence.id, currentPageNum)} disabled={currentPageNum <= 1}>上移</Button>}
                                        {isLast && <Button size="small" variant="outlined" startIcon={<ArrowDownwardIcon />} onClick={() => moveSentenceToNext(sentence.id, currentPageNum)} disabled={currentPageNum >= imagePaths.length}>下移</Button>}
                                    </Box>
                                </Paper>
                            );
                        }) : (
                            <Box display="flex" alignItems="center" justifyContent="center" height="100%" color="text.secondary">
                                <Typography>此页无对应字幕</Typography>
                            </Box>
                        )}
                    </Box>
                </Box>
            </>
        );
    };
    
    return (
        <Dialog 
            open={open} 
            onClose={handleClose} 
            fullWidth 
            maxWidth="xl"
            PaperProps={{ 
                sx: { 
                    height: '95vh', 
                    maxHeight: '900px',
                    borderRadius: '16px',
                    backgroundColor: 'rgba(255, 255, 255, 0.98)',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(0, 0, 0, 0.1)'
                }
            }}
        >
            <DialogTitle sx={{ p: 2, borderBottom: '1px solid #eee' }}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="h3" fontWeight="bold">视频脚本预览与调整</Typography>
                    <IconButton onClick={handleClose} size="small"><CloseIcon /></IconButton>
                </Box>
            </DialogTitle>
            <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: { xs: 'column', lg: 'row' } }}>
                {renderContent()}
            </DialogContent>
            <DialogActions sx={{ p: 2, borderTop: '1px solid #eee' }}>
                {error && <Alert severity="error" sx={{ width: '100%', mr: 2 }}>{error}</Alert>}
                <Button onClick={handleClose} disabled={isLoading}>取消</Button>
                <Button onClick={handleSaveChanges} variant="contained" disabled={isLoading} startIcon={isLoading ? <CircularProgress size={20} /> : <SaveIcon />}>
                    保存更改
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default VideoScriptPreviewDialog;