// frontend/src/components/VideoSynthesisStep.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, CircularProgress, Select, MenuItem, FormControl, InputLabel,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip,TextField,
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
  Edit as EditIcon,
  Save as SaveIcon,
  Visibility as VisibilityIcon, // <<<--- 新增：预览图标
  Cancel as CancelIcon, // 新增：取消图标
  Replay as ReplayIcon, // <<<--- 新增：导入重试图标
  RestartAlt as RestartAltIcon // <<<--- 新增：一个更适合“重置/重新开始”的图标

} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import { ttsApi } from '../api/tts';
import VideoScriptPreviewDialog from './VideoScriptPreviewDialog'; 


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


const VideoSynthesisStep = ({ contentId, setSynthesisTask, synthesisTask, allSentences, progressData, isSubmitting, onStartTask, onResetTask, onAlert 
    }) => {
        const navigate = useNavigate();
        const theme = useTheme();
        
        const [pptFile, setPptFile] = useState(null);
        const [prompts, setPrompts] = useState([]);
        const [selectedPromptId, setSelectedPromptId] = useState('');
        const [loadingPrompts, setLoadingPrompts] = useState(true);

        // ---用于编辑视频脚本的 state ---
        const [isEditingScript, setIsEditingScript] = useState(false);
        const [editableScript, setEditableScript] = useState([]);
        const [isSavingScript, setIsSavingScript] = useState(false);

        const status = synthesisTask?.status || 'idle';
        const analysisResult = synthesisTask?.video_script_json;
        const finalVideoResourceId = synthesisTask?.generated_resource_id;
        // const progress = synthesisTask?.progress || 0; // <<<--- 新增：从任务状态中获取进度
        // const progressMessage = synthesisTask?.message || ''; // <<<--- 新增：获取进度消息
        // const [progress, setProgress] = useState(0);       // <<<--- 新增：存储数值进度
        const [progressMessage, setProgressMessage] = useState(''); // <<<--- 新增：存储阶段信息
        // const { progress, message } = progressData || { progress: 0, message: '' };
        const { progress, message, status: progressStatus } = progressData || { progress: 0, message: '', status: 'idle' };
        
        // 用于脚本预览的 state
        const [isPreviewDialogOpen, setIsPreviewDialogOpen] = useState(false);

        const [dialogKey, setDialogKey] = useState(0);

        const handleOpenPreviewDialog = () => {
            // 每次打开时，都更新key的值，强制重新挂载Dialog
            setDialogKey(prevKey => prevKey + 1); 
            setIsPreviewDialogOpen(true);
        };

        // <<< --- 增加调试日志 --- >>>
        // useEffect(() => {
        //     console.log('[VideoSynthesisStep] 状态更新，当前的 synthesisTask:', synthesisTask);
        // }, [synthesisTask]);
        // <<< -------------------- >>>

        // useEffect(() => {
        //     console.log("================ 调试点 2: VideoSynthesisStep ================");
        //     console.log("中间组件接收到的 prop allSentences:", allSentences);
        //     console.log("==========================================================");
        // }, [allSentences]); // 当 allSentences prop 变化时打印


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

        // 当分析结果从父组件更新时，初始化可编辑脚本的状态
        useEffect(() => {
            const scripts = analysisResult?.video_scripts;
            if (scripts && Array.isArray(scripts)) {
            setEditableScript(JSON.parse(JSON.stringify(scripts)));
            } else {
            setEditableScript([]);
            }
            // 如果进入编辑模式后，父组件的 analysisResult 更新了（例如重新分析），则退出编辑模式
            if (isEditingScript) {
                setIsEditingScript(false);
            }
        }, [analysisResult]);

        const handleScriptSave = (newScriptJson) => {
            // 当预览对话框中保存成功后，更新这里的状态
            setSynthesisTask(prev => ({
                ...prev,
                video_script_json: newScriptJson
            }));
            onAlert({ open: true, message: '脚本已更新，请继续操作。', severity: 'success' });
        };

        const handleSynthesisProgress = useCallback((taskData) => {
            if (taskData && taskData.meta) {
                setProgress(taskData.meta.progress || 0);
                setProgressMessage(taskData.meta.message || '');
            }
        }, []); // 这个回调本身没有依赖，是稳定的

        const handleTaskFailure = (taskData, taskType) => {
            onAlert({ open: true, message: `任务 (${taskType}) 失败: ${taskData.meta?.message || '请稍后重试'}`, severity: 'error' });
            setSynthesisTask(prev => ({...prev, status: `error_${taskType}`}));
        };

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
            try {
                // 先调用API提交任务
                const response = await ttsApi.startVideoAnalysis(contentId, pptFile, selectedPromptId);
                // 然后使用父组件的 onStartTask 启动轮询
                if (response.data.task_id) {
                    onStartTask(response.data.task_id, 'analysis', 'AI 脚本分析中...');
                }
            } catch (error) {
                onAlert({ open: true, message: `分析任务提交失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
            }
        };
        
        const handleSynthesize = async () => {
            if (!synthesisTask || !synthesisTask.id) return;
            try {
                const response = await ttsApi.startVideoSynthesis(synthesisTask.id, analysisResult);
                if (response.data.task_id) {
                    onStartTask(response.data.task_id, 'synthesis', '视频合成中...');
                }
            } catch (error) {
                onAlert({ open: true, message: `合成任务提交失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
            }
        };

        
        const handleReset = () => {
            if (!synthesisTask || !synthesisTask.id) return;
            // 直接调用从父组件传入的 onResetTask 函数
            if (onResetTask) {
                onResetTask();
            }
        };

        // --- 处理脚本编辑的函数 ---
        const handleScriptChange = (index, field, value) => {
            const newScript = [...editableScript];
            if (field === 'ppt_page') {
            newScript[index][field] = parseInt(value, 10) || 0;
            } else {
            newScript[index][field] = value;
            }
            setEditableScript(newScript);
        };

        const handleCancelEdit = () => {
            // 恢复为原始脚本数据
            setEditableScript(JSON.parse(JSON.stringify(analysisResult?.video_scripts || [])));
            setIsEditingScript(false);
        };

        const handleSaveScript = async () => {
            if (!synthesisTask?.id) return;
            setIsSavingScript(true);
            try {
                const updatedAnalysisResult = { ...analysisResult, video_scripts: editableScript };
                // 调用新的 API 来保存脚本
                const response = await ttsApi.updateVideoScript(synthesisTask.id, updatedAnalysisResult);
                
                // 用后端返回的最新数据更新父组件的状态
                setSynthesisTask(response.data.updated_task);
                
                setIsEditingScript(false);
                onAlert({ open: true, message: "视频脚本已保存！", severity: "success" });
            } catch (error) {
                onAlert({ open: true, message: `保存脚本失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
            } finally {
                setIsSavingScript(false);
            }
        };
        
        // console.log("~~~~~~~~分析结果~~~~~~~:", editableScript);
        // UI渲染逻辑现在完全依赖于从props传入的status，并且是正确的
        const renderUIByStatus = () => {
            
            if (progressStatus === 'in_progress' || progressStatus === 'completed') {
                return (
                    <Box textAlign="center" py={5}>
                        <Typography sx={{ mb: 2 }}>{message || '处理中...'}</Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <LinearProgress 
                                variant="determinate" 
                                value={progress} 
                                sx={{ height: 10, borderRadius: 5, flexGrow: 1 }}
                                color={progressStatus === 'completed' ? 'success' : 'primary'}
                            />
                            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{`${Math.round(progress)}%`}</Typography>
                        </Box>
                        {progressStatus === 'completed' && <CheckCircleIcon color="success" sx={{mt:2}} />}
                    </Box>
                );
            }

            if (progressStatus === 'failed') {
                return (
                    <Alert severity="error" action={
                        <Button color="inherit" size="small" onClick={onResetTask} startIcon={<ReplayIcon/>} disabled={isSubmitting}>
                            {isSubmitting ? '...' : '重试'}
                        </Button>
                    }>
                    {message || '任务处理失败，请重试。'}
                    </Alert>
                );
            }
            switch (status) {
                case 'analyzing':
                case 'synthesizing':
                    return (
                        <Box textAlign="center" py={5}>
                            <Typography sx={{ mb: 2 }}>{progressMessage || (status === 'analyzing' ? 'AI脚本分析中...' : '视频合成中...')}</Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <LinearProgress 
                                    variant="determinate" 
                                    value={progress} 
                                    sx={{ height: 10, borderRadius: 5, flexGrow: 1 }}
                                />
                                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{`${Math.round(progress)}%`}</Typography>
                            </Box>
                        </Box>
                    );
                
                case 'analysis_complete':
                case 'complete':
                    if (!analysisResult || typeof analysisResult !== 'object') {
                        return <Alert severity="warning">分析结果数据格式不正确或为空，请尝试重新分析。</Alert>;
                    }
                    return (
                        <Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                <Typography variant="h6">分析结果预览</Typography>
                                {isEditingScript ? (
                                <Box>
                                    <Button size="small" startIcon={<CancelIcon />} onClick={handleCancelEdit} disabled={isSavingScript}>取消</Button>
                                    <Button size="small" variant="contained" startIcon={isSavingScript ? <CircularProgress size={16}/> : <SaveIcon />} onClick={handleSaveScript} disabled={isSavingScript}>保存脚本</Button>
                                </Box>
                                ) : (
                                <Box sx={{ display: 'flex', gap: 2 }}>
                                <Button 
                                    variant="outlined" 
                                    color="primary" 
                                    startIcon={<VisibilityIcon />}
                                    onClick={() => {
                                        // <<< --- 增加调试日志 --- >>>
                                        // console.log('[VideoSynthesisStep] "预览"按钮点击，准备打开Dialog，传递的synthesisTask:', synthesisTask);
                                        // <<< -------------------- >>>
                                        handleOpenPreviewDialog(true)
                                    }}
                                    disabled={isSubmitting}
                                >
                                    预览和调整
                                </Button>
                                <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={() => setIsEditingScript(true)} disabled={isSubmitting}>编辑脚本</Button>
                                </Box>
                                )}
                            </Box>
                            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
                                <Table stickyHeader size="small">
                                    
                                    <TableHead><TableRow><TableCell>PPT页码</TableCell><TableCell>时间范围 (HH:MM:SS,ms)</TableCell></TableRow></TableHead>
                                    <TableBody>
                                        {editableScript.map((script, i) => (
                                            <TableRow key={i}>
                                                <TableCell>
                                                    {isEditingScript ? <TextField size="small" type="number" sx={{width: '80px'}} value={script.ppt_page} onChange={(e) => handleScriptChange(i, 'ppt_page', e.target.value)} /> : script.ppt_page}
                                                </TableCell>
                                                <TableCell>
                                                    {isEditingScript ? <TextField size="small" fullWidth value={script.time_range} onChange={(e) => handleScriptChange(i, 'time_range', e.target.value)} /> : script.time_range}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
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
                                        <Box sx={{display: 'flex', justifyContent: 'center', gap: 2}}>
                                            <Button variant="contained" startIcon={<PlayCircleOutlineIcon />} onClick={() => navigate(`/my-courses/${contentId}/resource/${finalVideoResourceId}/play`)}>在线预览</Button>
                                            <Button variant="outlined" color="primary" onClick={onResetTask} startIcon={<RestartAltIcon />} disabled={isSubmitting}>重新分析</Button>
                                        </Box>
                                    </Box>
                                ) : (
                                    <Box sx={{ display: 'flex', justifyContent: 'flex-end',gap: 2 }}>
                                        <Button variant="contained"   size="small" onClick={onResetTask} startIcon={<ReplayIcon/>} disabled={isSubmitting}>
                                            {isSubmitting ? '...' : '重试'}
                                        </Button>
                                        <Button variant="contained" color="success" onClick={handleSynthesize} disabled={isSubmitting || isEditingScript} startIcon={isSubmitting ? <CircularProgress size={20}/> : <SynthesizeIcon />}>
                                            {isSubmitting ? '处理中...' : '确认并合成视频'}
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
                <VideoScriptPreviewDialog
                    key={dialogKey}
                    open={isPreviewDialogOpen}
                    onClose={() => setIsPreviewDialogOpen(false)}
                    synthesisTask={synthesisTask}
                    allSentences={allSentences} 
                    onScriptSave={handleScriptSave}
                />
            </Paper>
        );
};

export default VideoSynthesisStep;