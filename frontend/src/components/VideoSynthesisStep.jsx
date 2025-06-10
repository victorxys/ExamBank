// frontend/src/components/VideoSynthesisStep.jsx

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, CircularProgress, Select, MenuItem, FormControl, InputLabel,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip,
  Grid, Alert, Chip, Avatar,LinearProgress
} from '@mui/material';
import {
  CloudUpload as CloudUploadIcon,
  AutoAwesome as AnalyzeIcon,
  Theaters as SynthesizeIcon,
  CheckCircle as CheckCircleIcon,
  PlayCircleOutline as PlayCircleOutlineIcon,
  FilePresent as FilePresentIcon,
  Movie as MovieIcon,
  Replay as ReplayIcon // <<<--- 新增：导入重试图标
} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import { ttsApi } from '../api/tts';

const ResultRow = ({ icon, title, data, renderItem }) => {
    const theme = useTheme();
    return (
        <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1.5, display: 'flex', alignItems: 'center' }}>
                {React.cloneElement(icon, { sx: { mr: 1, fontSize: '1.25rem' } })}
                {title}
            </Typography>
            <Box sx={{ maxHeight: 240, overflowY: 'auto', pr: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {data && data.length > 0 ? data.map(renderItem) : (
                    <Typography variant="body2" sx={{ color: 'text.secondary', p: 2, textAlign: 'center' }}>无</Typography>
                )}
            </Box>
        </Box>
    );
};


const VideoSynthesisStep = ({ contentId, synthesisTask, setSynthesisTask, onTaskStart, onAlert }) => {
    const navigate = useNavigate();
    const theme = useTheme();
    
    const [pptFile, setPptFile] = useState(null);
    const [prompts, setPrompts] = useState([]);
    const [selectedPromptId, setSelectedPromptId] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loadingPrompts, setLoadingPrompts] = useState(true);

    const status = synthesisTask?.status || 'idle';
    const analysisResult = synthesisTask?.video_script_json;
    const finalVideoResourceId = synthesisTask?.generated_resource_id;
    const progress = synthesisTask?.progress || 0; // <<<--- 新增：从任务状态中获取进度
    const progressMessage = synthesisTask?.message || ''; // <<<--- 新增：获取进度消息

    useEffect(() => {
        const fetchPrompts = async () => {
            setLoadingPrompts(true);
            try {
                const response = await ttsApi.getLlmPrompts();
                const filteredPrompts = response.data.filter(p => p.prompt_identifier.includes('VIDEO_SCRIPT') && p.status === 'active');
                setPrompts(filteredPrompts || []);
                if (filteredPrompts.length > 0) {
                    setSelectedPromptId(filteredPrompts[0].id);
                }
            } catch (err) {
                console.error("获取提示词失败:", err);
            } finally {
                setLoadingPrompts(false);
            }
        };
        fetchPrompts();
    }, []); // 这个 effect 只在组件挂载时运行一次，是安全的

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (file && file.type === 'application/pdf') {
            setPptFile(file);
        } else {
            setPptFile(null);
            onAlert({ open: true, message: '请选择一个PDF格式的文件。', severity: 'warning' });
        }
    };

    const handleAnalyze = async () => {
        if (!pptFile || !selectedPromptId) {
            onAlert({ open: true, message: '请先上传PDF并选择分析提示词。', severity: 'warning' });
            return;
        }
        setIsSubmitting(true);
        try {
            const response = await ttsApi.startVideoAnalysis(contentId, pptFile, selectedPromptId);
            // 关键：在成功提交后，用后端返回的信息更新父组件状态
            setSynthesisTask({ status: 'analyzing', id: response.data.synthesis_id, ...response.data });
            if (response.data.task_id) {
                onTaskStart(response.data.task_id, 'analysis', 'AI 脚本分析中...');
            }
            onAlert({ open: true, message: '分析任务已提交，请稍候...', severity: 'info' });
        } catch (error) {
            onAlert({ open: true, message: `分析任务提交失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleSynthesize = async () => {
        if (!synthesisTask || !synthesisTask.id) return;
        setIsSubmitting(true);
        try {
            const response = await ttsApi.startVideoSynthesis(synthesisTask.id, analysisResult);
            setSynthesisTask(prev => ({ ...prev, status: 'synthesizing' }));
            if (response.data.task_id) {
                onTaskStart(response.data.task_id, 'synthesis', '视频合成中...');
            }
            onAlert({ open: true, message: '视频合成任务已提交，这可能需要一些时间...', severity: 'info' });
        } catch (error) {
            onAlert({ open: true, message: `合成任务提交失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally {
            setIsSubmitting(false);
        }
    };

    // <<<--- 新增：处理重置的函数 ---<<<
    const handleReset = async () => {
        if (!synthesisTask || !synthesisTask.id) return;
        setIsSubmitting(true);
        try {
            const response = await ttsApi.resetSynthesisTask(synthesisTask.id);
            // 用后端返回的最新、已重置的状态来更新父组件的状态
            setSynthesisTask(response.data.updated_task);
            onAlert({ open: true, message: '任务已重置，您可以重新操作。', severity: 'success' });
        } catch (error) {
            onAlert({ open: true, message: `重置失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally {
            setIsSubmitting(false);
        }
    };
    // --------------------------------->>>

    // UI渲染逻辑现在完全依赖于从props传入的status，并且是正确的
    const renderUIByStatus = () => {
        switch (status) {
            case 'analyzing':
            // <<<--- 修改 'synthesizing' 状态的UI ---<<<
            // case 'synthesizing':
            //     return (
            //         <Box textAlign="center" py={5}>
            //             <Typography sx={{ mb: 2 }}>{progressMessage || '视频合成中...'}</Typography>
            //             <LinearProgress variant="determinate" value={progress} sx={{ height: 10, borderRadius: 5 }} />
            //             <Typography variant="body2" sx={{ mt: 1 }}>{progress}%</Typography>
            //         </Box>
            //     );
            // ---------------------------------------->>>
            
            case 'analysis_complete':
            case 'complete':
                if (!analysisResult || typeof analysisResult !== 'object') {
                    return <Alert severity="warning">分析结果数据格式不正确或为空，请尝试重新分析。</Alert>;
                }
                return (
                    <Box>
                        <Typography variant="h6" gutterBottom>分析结果预览</Typography>
                        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                             <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>已匹配视频脚本</Typography>
                             <TableContainer sx={{ maxHeight: 300 }}>
                                 <Table stickyHeader size="small">
                                     <TableHead><TableRow><TableCell>PPT页码</TableCell><TableCell>时间范围</TableCell></TableRow></TableHead>
                                     <TableBody>
                                         {(analysisResult.video_scripts || []).map((script, i) => (
                                             <TableRow key={i}><TableCell>{script.ppt_page}</TableCell><TableCell>{script.time_range}</TableCell></TableRow>
                                         ))}
                                     </TableBody>
                                 </Table>
                             </TableContainer>
                        </Paper>
                        <Grid container spacing={3}>
                            <Grid item xs={12} md={6}>
                                 <ResultRow
                                    icon={<FilePresentIcon sx={{ color: theme.palette.warning.main }} />}
                                    title="未匹配的PPT页面"
                                    data={analysisResult.unmatched_ppts || []}
                                    renderItem={(item, i) => (
                                        <Paper key={i} variant="outlined" sx={{ p: 1.5, bgcolor: 'warning.lightest', borderColor: 'warning.light' }}>
                                            <Typography variant="body2" sx={{color: 'warning.darker'}}><b>第 {item.ppt_page} 页:</b> {item.explanation}</Typography>
                                        </Paper>
                                    )}
                                />
                            </Grid>
                            <Grid item xs={12} md={6}>
                                <ResultRow
                                    icon={<i className="fa-solid fa-closed-captioning" style={{color: theme.palette.info.main}}></i>}
                                    title="未匹配的音频/字幕"
                                    data={analysisResult.unmatched_srts || []}
                                    renderItem={(item, i) => (
                                         <Paper key={i} variant="outlined" sx={{ p: 1.5, bgcolor: 'info.lightest', borderColor: 'info.light' }}>
                                            <Typography variant="body2" sx={{color: 'info.darker'}}><b>片段 {item.srt_num}:</b> {item.explanation}</Typography>
                                        </Paper>
                                    )}
                                />
                            </Grid>
                        </Grid>
                        <Box sx={{ mt: 3, pt: 3, borderTop: 1, borderColor: 'divider' }}>
                            {status === 'complete' && finalVideoResourceId ? (
                                <Box textAlign="center" py={2}>
                                    <Chip icon={<CheckCircleIcon />} label="视频已生成！" color="success" sx={{mb: 3, fontSize: '1rem', p: 2}}/>
                                    <Box sx={{display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap'}}>
                                        <Button variant="contained" startIcon={<PlayCircleOutlineIcon />} onClick={() => navigate(`/my-courses/${contentId}/resource/${finalVideoResourceId}/play`)}>在线预览</Button>
                                        {/* <<< 新增重置按钮 >>> */}
                                        <Button variant="outlined" color="primary" onClick={handleReset} startIcon={<ReplayIcon />} disabled={isSubmitting}>
                                            重新生成
                                        </Button>
                                    </Box>
                                </Box>
                            ) : (
                                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <Button 
                                        variant="contained" color="success" onClick={handleSynthesize} 
                                        disabled={isSubmitting || status === 'synthesizing'} startIcon={<SynthesizeIcon />}
                                    >
                                        {isSubmitting || status === 'synthesizing' ? '合成中...' : '确认并合成视频'}
                                    </Button>
                                </Box>
                            )}
                        </Box>
                    </Box>
                );

            case 'error_analysis':
            case 'error_synthesis':
                return (
                    <Alert 
                        severity="error"
                        action={
                            <Button 
                                color="inherit" 
                                size="small" 
                                onClick={handleReset} // 点击时调用重置函数
                                startIcon={<ReplayIcon/>}
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? '重置中...' : '重试'}
                            </Button>
                        }
                    >
                        任务处理失败，请检查后台日志或重试。
                    </Alert>
                );

            default: // idle 状态
                return (
                    <Grid container spacing={3} alignItems="center">
                        <Grid item xs={12} sm={6}>
                            <Typography variant="subtitle1" gutterBottom>1. 上传PPT (PDF格式)</Typography>
                            <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />}>
                                {pptFile ? pptFile.name : '选择文件'}
                                <input type="file" hidden accept=".pdf" onChange={handleFileChange} />
                            </Button>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <FormControl fullWidth disabled={loadingPrompts}>
                                <InputLabel>2. 选择分析提示词</InputLabel>
                                <Select value={selectedPromptId} label="2. 选择分析提示词" onChange={(e) => setSelectedPromptId(e.target.value)}>
                                    {prompts.map(p => <MenuItem key={p.id} value={p.id}>{p.prompt_name} (v{p.version})</MenuItem>)}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid item xs={12} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button variant="contained" onClick={handleAnalyze} disabled={!pptFile || !selectedPromptId || isSubmitting || loadingPrompts}>
                                {isSubmitting ? <CircularProgress size={24}/> : <AnalyzeIcon sx={{mr:1}}/> }
                                {isSubmitting ? '请求中...' : '开始分析'}
                            </Button>
                        </Grid>
                    </Grid>
                );
        }
    };
    
    return (
        <Paper elevation={3} sx={{ mt: 3, p: { xs: 2, md: 3 }, borderRadius: '12px' }}>
            <Box display="flex" alignItems="center" mb={3}>
                <Avatar sx={{ bgcolor: 'primary.main', mr: 2 }}><MovieIcon /></Avatar>
                <Box>
                    <Typography variant="h5" component="h3" sx={{ fontWeight: 'bold' }}>第六步：合成视频</Typography>
                    <Typography variant="body2" color="text.secondary">将音频、字幕与PPT结合，生成教学视频。</Typography>
                </Box>
            </Box>
            {renderUIByStatus()}
        </Paper>
    );
};

export default VideoSynthesisStep;