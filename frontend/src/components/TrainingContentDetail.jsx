// frontend/src/components/TrainingContentDetail.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, CircularProgress, Chip, Grid, Card, CardHeader, CardContent,
  TableContainer, Table, TableHead, TableRow, TableCell, TableBody, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions,  FormControl, InputLabel, Select, MenuItem, // 用于引擎选择
  List, ListItem, ListItemText, Divider, IconButton, TextField, Stack, TextareaAutosize,Collapse,FormHelperText,Slider,
  LinearProgress, // 确保导入 LinearProgress
  TablePagination, // 确保导入 TablePagination
  FormControlLabel, Checkbox // 添加SSML配置所需的组件
} from '@mui/material';

import {
    PlayArrow as PlayArrowIcon,
    ExpandLess as ExpandLessIcon,
    ExpandMore as ExpandMoreIcon, // 确保导入 ExpandLess
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
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { ttsApi } from '../api/tts';
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';
import { formatRelativeTime } from '../api/dateUtils';
import { API_BASE_URL } from '../config';
import useTaskPolling from '../utils/useTaskPolling';
import VideoSynthesisStep from './VideoSynthesisStep'; // <<<--- 导入新组件
import SentenceList from './SentenceList';
import formatMsToTime from '../utils/timeUtils'; // 确保有这个工具函数来格式化时间戳
import SkipNextIcon from '@mui/icons-material/SkipNext'
import FileUploadIcon from '@mui/icons-material/FileUpload';
import ImportExternalTtsDialog from './ImportExternalTtsDialog';

// +++ 把这个辅助函数放在组件外部或一个单独的 utils 文件中 +++
function formatMsToSrtTime(ms) {
    if (typeof ms !== 'number' || isNaN(ms)) return '00:00:00,000';
    const date = new Date(ms);
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds},${milliseconds}`;
}


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

  // 视频合成相关的状态 ---
  const [pptFile, setPptFile] = useState(null); // 存储用户选择的PDF文件
  const [selectedPromptId, setSelectedPromptId] = useState(''); // 存储用户选择的提示词ID
  const [synthesisTask, setSynthesisTask] = useState(null); // 存储整个视频合成任务的状态和结果

  const [isAnalyzing, setIsAnalyzing] = useState(false); // 控制分析按钮的加载状态
  const [isSynthesizing, setIsSynthesizing] = useState(false); // 控制合成按钮的加载状态


  // -- 进度相关的 state ---
  const [synthesisProgress, setSynthesisProgress] = useState({
    progress: 0,
    message: '',
    status: 'idle' // 'idle', 'in_progress', 'completed', 'failed'
  });

  // New states for Global TTS Settings
  const [isGlobalSettingsOpen, setIsGlobalSettingsOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false); // 第三方导入对话框
  const [globalTtsConfig, setGlobalTtsConfig] = useState({
    engine: 'gemini_tts',
    system_prompt: '',
    gemini_model: 'gemini-2.5-pro-preview-tts', // Gemini TTS 模型
    server_model: 'cosyvoice-v3-flash', // TTS Server 模型
    temperature: 0.58,
  });
  
//   // onProgress 回调函数 ---<<<
//     const handleTaskProgress = useCallback((taskData, taskType) => {
//     // console.log(`[Parent] Progress for ${taskType}:`, taskData);
//     if (taskType === 'synthesis' || taskType === 'analysis') {
//       setSynthesisTask(prev => {
//         // 如果 prev 不存在，从 taskData 初始化
//         if (!prev) return { 
//             id: taskData.task_id, 
//             status: taskData.status.toLowerCase(), 
//             progress: taskData.meta?.progress || 0,
//             message: taskData.meta?.message || ''
//         };
//         // 否则，更新现有状态
//         return {
//             ...prev,
//             status: taskData.status.toLowerCase(),
//             progress: taskData.meta?.progress !== undefined ? taskData.meta.progress : prev.progress,
//             message: taskData.meta?.message || prev.message
//         }
//       });
//     }
//     // 这里可以添加对其他任务类型的进度处理
//   }, []); // 这个回调没有外部依赖，是安全的
const enhancedSentences = useMemo(() => {
    const sentences = contentDetail?.final_script_sentences;
    const segments = contentDetail?.latest_merged_audio?.segments;

    if (!sentences || !segments) {
        return []; // 如果缺少任何一部分数据，返回空数组
    }

    // 创建一个以 tts_sentence_id 为键的 segments 映射，方便快速查找
    const segmentsMap = new Map(segments.map(seg => [seg.tts_sentence_id, seg]));

    return sentences.map(sentence => {
        const segment = segmentsMap.get(sentence.id);
        return {
            ...sentence,
            // 如果找到匹配的segment，就构造time_range，否则为null
            time_range: segment 
                ? `${formatMsToSrtTime(segment.start_ms)} ~ ${formatMsToSrtTime(segment.end_ms)}` 
                : null
        };
    });
}, [contentDetail]); // 依赖 contentDetail

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
    },
    { // 新增第六步
      key: 'synthesizeVideo',
      label: '6. 合成视频',
      isCompleted: (s) => s === 'complete',
      isEnabled: (s, prevCompleted) => prevCompleted,
    }
  ], [contentDetail]); // 确保 contentDetail 在依赖中，以便 isEnabled/isCompleted 正确响应变化



const fetchContentDetail = useCallback(async (showLoadingIndicator = true) => {
    if (!contentId) return;
    if (showLoadingIndicator) setLoading(true);
    setErrorStateForDisplay(null);
    try {
    //   const response = await ttsApi.getTrainingContentDetail(contentId);
        const [response, synthesisRes] = await Promise.all([
                    ttsApi.getTrainingContentDetail(contentId),
                    ttsApi.getLatestSynthesisTask(contentId) // <<<--- 调用新接口
                ]);

        const detail = response.data;
        setContentDetail(detail);

        // Initialize global TTS config from fetched data or set defaults
        if (detail.default_tts_config) {
          // 合并后端返回的配置和环境变量配置
          const envConfig = detail.tts_server_env_config || {};
          setGlobalTtsConfig(prev => ({ 
            ...prev, 
            ...detail.default_tts_config,
            // 从环境变量获取TTS-Server配置
            server_url: envConfig.tts_server_base_url || 'http://localhost:5002',
            api_key: envConfig.tts_server_api_key || '',
          }));
        } else {
          // Reset to default if no config is saved for this content
          const envConfig = detail.tts_server_env_config || {};
          setGlobalTtsConfig({
            engine: 'gemini_tts',
            // Gemini TTS 参数
            gemini_model: 'gemini-2.5-flash-preview-tts',
            system_prompt: '你是一名专业的育儿嫂培训师，请用口语化的培训师的口吻以及标准的普通话来讲解以下内容：',
            temperature: 0.7,
            // IndexTTS2 默认参数
            voice_reference_path: '',
            emo_control_method: 'Same as the voice reference',
            emo_weight: 0.8,
            emo_text: '',
            max_text_tokens_per_segment: 120,
            // TTS-Server 默认参数（从环境变量获取）
            server_url: envConfig.tts_server_base_url || 'http://localhost:5002',
            api_key: envConfig.tts_server_api_key || '',
            server_model: 'cosyvoice-v3-flash',
            voice: 'longanling_v3',
          });
        }
        setLoading(false);
                
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

        // <<< 新增逻辑：获取最新的视频合成任务状态 >>>
        // 假设后端提供了一个接口来获取某个内容最新的合成任务
        // 例如：GET /api/tts/content/{contentId}/video-synthesis/latest
        // const synthesisResponse = await ttsApi.getLatestSynthesisTask(contentId);
        // if (synthesisResponse.data) {
        //   setSynthesisTask(synthesisResponse.data);
        // }
        // 设置合成任务状态
        if (synthesisRes.data) {
            setSynthesisTask(synthesisRes.data);
            // 可以在这里添加如果任务正在进行中，则自动开始轮询的逻辑
            if (synthesisRes.data.status === 'analyzing' || synthesisRes.data.status === 'synthesizing') {
                setIsSynthesizing(true);
                startPolling(synthesisRes.data.celery_task_id, synthesisRes.data.status); // 假设后端返回 celery_task_id
            } else {
                setIsSynthesizing(false);
            }
        } else {
            setSynthesisTask(null); // 确保如果没有任务，状态被清空
            setIsSynthesizing(false);
        }

    } catch (err) {
      console.error("获取培训内容详情失败:", err.response || err);
      const extractedErrorMessage = err.response?.data?.error || err.message || '获取详情失败，请稍后重试';
      setAlert({ open: true, message: '获取详情失败: ' + extractedErrorMessage, severity: 'error' });
      setErrorStateForDisplay(extractedErrorMessage);
      setLoading(false);
    } finally {
      if (showLoadingIndicator) setLoading(false);
    }
  }, [contentId]); 

  // <<<--- 新增：useEffect 用于在数据加载后设置默认激活的步骤 ---<<<
  useEffect(() => {
    if (contentDetail) {
      // 从后往前找到第一个未完成的步骤并激活它
      let lastCompletedIndex = -1;
      for (let i = 0; i < workflowSteps.length; i++) {
        const step = workflowSteps[i];
        const prevStep = i > 0 ? workflowSteps[i - 1] : null;
        const prevCompleted = prevStep ? prevStep.isCompleted(contentDetail.status, contentDetail.scripts, contentDetail.final_script_sentences, contentDetail.latest_merged_audio) : true;
        
        if (step.isCompleted(contentDetail.status, contentDetail.scripts, contentDetail.final_script_sentences, contentDetail.latest_merged_audio, synthesisTask) && prevCompleted) {
          lastCompletedIndex = i;
        } else {
          break; // 找到第一个未完成的就停止
        }
      }
      // 计算下一个应该被激活的步骤索引
      let nextStepIndex = lastCompletedIndex + 1;
      
      // *** 核心修改点：在这里添加判断逻辑 ***
      // 如果计算出的下一个步骤是最后一个步骤（视频合成），并且当前激活的不是最后一个步骤，
      // 那么我们就停留在倒数第二个步骤（音频合并），而不是自动跳转。
      // 这给了用户一个明确的停留点。
      const finalStepIndex = workflowSteps.length - 1;
      if (nextStepIndex === finalStepIndex && activeStepKey !== workflowSteps[finalStepIndex].key) {
        // 停留在上一步（音频合并步骤）
        const stayAtIndex = Math.max(0, finalStepIndex - 1);
        setActiveStepKey(workflowSteps[stayAtIndex].key);
      } else {
        // 对于其他所有情况（包括用户已经手动点击了第六步），保持自动激活逻辑
        nextStepIndex = Math.min(nextStepIndex, finalStepIndex);
        setActiveStepKey(workflowSteps[nextStepIndex].key);
      }
    }
  }, [contentDetail, synthesisTask, workflowSteps]);
  // ------------------------------------------------------------>>>

// 现在一个 hook 处理所有类型的任务
    const handleTaskCompletion = useCallback((taskData, taskType) => {
        // 使用 setAlert 而不是 onAlert
        setAlert({ open: true, message: `任务 (${taskType}) 已成功完成！`, severity: 'success' });
        
        // 步骤1: 更新进度条到100%，让用户看到明确的完成状态
        setSynthesisProgress({ status: 'completed', progress: 100, message: '处理完成！' });

        // 步骤2: 稍作停留，然后更新最终的UI
        setTimeout(() => {
            // 步骤2a: 获取最新的数据（包含视频资源ID等）
            fetchContentDetail(false); 
            
            // 步骤2b: 结束“提交中”的通用加载状态
            setIsSynthesizing(false);
            
            // <<<--- 关键新增：重置进度条UI状态 ---<<<
            // 这一步会告诉 VideoSynthesisStep 组件：“我的进度条使命完成了，
            // 请根据父组件传下来的最新的 synthesisTask 状态来决定下一步显示什么。”
            setSynthesisProgress({ status: 'idle', progress: 0, message: '' }); 
            // ------------------------------------->>>

        }, 1500); // 延迟1.5秒，给用户看“完成”状态的时间

    }, [fetchContentDetail]); // 依赖项现在是正确的

  const handleSkipStep = async (stepToSkipKey, inputScriptId) => {
    if (!stepToSkipKey) {
        setAlert({open: true, message: '无法执行跳过操作：缺少步骤信息。', severity: 'error'});
        return;
    }

    const actionKey = `skip_${stepToSkipKey}_${inputScriptId || 'no_input'}`;
    setActionLoading(prev => ({ ...prev, [actionKey]: true }));
    setAlert({ open: false, message: '', severity: 'info' });

    try {
        let response;
        if (stepToSkipKey === 'generateOralScript') {
            // 跳过口播稿生成，直接使用原始内容作为口播稿
            response = await ttsApi.skipOralScriptGeneration(contentId);
            setAlert({ open: true, message: response.data.message || '口播稿生成已跳过，使用原始内容。', severity: 'success' });
        } else if (stepToSkipKey === 'triggerTtsRefine') {
            if (!inputScriptId) {
                setAlert({open: true, message: '跳过TTS优化需要口播稿ID。', severity: 'error'});
                return;
            }
            response = await ttsApi.skipTtsRefine(inputScriptId);
            setAlert({ open: true, message: response.data.message || 'TTS优化步骤已跳过。', severity: 'success' });
        } else if (stepToSkipKey === 'triggerLlmRefine') {
            if (!inputScriptId) {
                setAlert({open: true, message: '跳过LLM修订需要TTS优化稿ID。', severity: 'error'});
                return;
            }
            response = await ttsApi.skipLlmRefine(inputScriptId);
            setAlert({ open: true, message: response.data.message || 'LLM修订步骤已跳过。', severity: 'success' });
        } else if (stepToSkipKey === 'splitSentences') {
            if (!inputScriptId) {
                setAlert({open: true, message: '跳过句子拆分需要最终脚本ID。', severity: 'error'});
                return;
            }
            response = await ttsApi.skipSentenceSplit(inputScriptId);
            setAlert({ open: true, message: response.data.message || '句子拆分已跳过。', severity: 'success' });
        } else if (stepToSkipKey === 'generateAndMergeAudio') {
            // 跳过语音生成和合并
            response = await ttsApi.skipAudioGeneration(contentId);
            setAlert({ open: true, message: response.data.message || '语音生成和合并已跳过。', severity: 'success' });
        } else if (stepToSkipKey === 'synthesizeVideo') {
            // 跳过视频合成
            response = await ttsApi.skipVideoSynthesis(contentId);
            setAlert({ open: true, message: response.data.message || '视频合成已跳过。', severity: 'success' });
        } else {
            setAlert({open: true, message: '此步骤当前不支持跳过。', severity: 'warning'});
            return;
        }
        
        fetchContentDetail(false); // 跳过后直接刷新数据，UI会根据新的状态流转
    } catch (error) {
        console.error(`跳过步骤 ${stepToSkipKey} 失败:`, error);
        setAlert({ open: true, message: `跳过步骤失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
    } finally {
        setActionLoading(prev => ({ ...prev, [actionKey]: false }));
    }
  };

  // Helper function to render skip button for each step
  const renderSkipButton = (step, inputScriptId = null) => {
    const actionKey = `skip_${step.key}_${inputScriptId || 'no_input'}`;
    const isLoading = actionLoading[actionKey];
    
    // Don't show skip button if step is already completed
    const isCompleted = step.isCompleted ? 
      step.isCompleted(contentDetail?.status, contentDetail?.scripts, contentDetail?.final_script_sentences, contentDetail?.latest_merged_audio)
      : false;
    
    if (isCompleted) return null;

    return (
      <Button
        variant="outlined"
        size="small"
        color="warning"
        startIcon={isLoading ? <CircularProgress size={16} /> : <SkipNextIcon />}
        onClick={() => handleSkipStep(step.key, inputScriptId)}
        disabled={isLoading || isPolling}
        sx={{ ml: 1 }}
      >
        {isLoading ? '跳过中...' : '跳过当前'}
      </Button>
    );
  };

   const handleTaskFailure = useCallback((taskData, taskType) => {
        const errorMessage = taskData.meta?.message || taskData.error_message || '未知错误，请检查后台日志。';
        setAlert({ open: true, message: `任务 (${taskType}) 失败: ${errorMessage}`, severity: 'error' });
        setSynthesisProgress({ status: 'failed', progress: synthesisProgress.progress, message: `失败: ${errorMessage}` });
        setIsSynthesizing(false);
    }, [synthesisProgress.progress]); // 依赖上一次的进度

    const handleTaskProgress = useCallback((taskData, taskType) => {
        if (taskData.meta) {
            setSynthesisProgress(prev => ({
                ...prev,
                status: 'in_progress',
                progress: taskData.meta.progress || prev.progress,
                message: taskData.meta.message || prev.message
            }));
        }
    }, []);

    // --- 新增：专门用于启动任务的回调函数 ---
    const handleStartTask = (taskId, taskType, initialMessage) => {
        setIsSynthesizing(true);
        setSynthesisProgress({ status: 'in_progress', progress: 0, message: initialMessage });
        startPolling(taskId, taskType, initialMessage);
    };

    const handleResetTask = async () => {
        if (!synthesisTask || !synthesisTask.id) return;
        
        setIsSynthesizing(true); // 使用通用加载状态，防止用户重复点击
        
        try {
            const response = await ttsApi.resetSynthesisTask(synthesisTask.id);
            
            // 用后端返回的已重置的状态来更新UI
            setSynthesisTask(response.data.updated_task);
            
            // 重置进度条状态
            setSynthesisProgress({ status: 'idle', progress: 0, message: '' });
            
            setAlert({ open: true, message: '任务已重置，您可以重新开始。', severity: 'success' });

        } catch (error) {
            setAlert({ open: true, message: `重置失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        } finally {
            setIsSynthesizing(false);
        }
    };
  
  const { pollingTask, isPolling, startPolling } = useTaskPolling(handleTaskCompletion, handleTaskFailure, handleTaskProgress);

    // --- 判断是否可以开始视频合成 ---
    // const canStartVideoSynthesis = useMemo(() => {
    //     // 条件：内容状态是 'audio_merge_complete' 并且有合并后的音频
    //     // 或者，已经存在一个合成任务了 (无论什么状态)
    //     console.log('Checking if video synthesis can start:', contentDetail, synthesisTask);
    //     return (contentDetail?.status === 'audio_merge_complete' && contentDetail?.latest_merged_audio) || !!synthesisTask;
    // }, [contentDetail, synthesisTask]); // 依赖 synthesisTask
    // const canStartVideoSynthesis = (contentDetail?.status === 'audio_merge_complete' && contentDetail?.latest_merged_audio) || !!synthesisTask;

    // --- 新增：处理合并当前以生成部分语音的函数 ---
    const handleMergeCurrentAudios = async () => {
        if (!contentDetail || !contentDetail.id) return;
        
        const actionKey = 'merge_current_audio';
        setActionLoading(prev => ({ ...prev, [actionKey]: true }));
        setMergeProgress({ task_id: null, status: 'PENDING', message: '正在提交合并任务...', total_sentences: 0, merged_count: 0 });
        setAlert({ open: false, message: '', severity: 'info' });

        try {
        const response = await ttsApi.mergeCurrentGeneratedAudios(contentDetail.id);
        setAlert({ open: true, message: response.data.message || '合并当前语音任务已提交。', severity: 'info' });
        if (response.data.task_id) {
            setMergeProgress(prev => ({ ...prev, task_id: response.data.task_id, status: 'QUEUED' }));
            pollTaskStatus(response.data.task_id, false, 'merge'); // 传递 'merge' 作为 taskType
        }
        } catch (error) {
        console.error("合并当前语音失败:", error);
        setAlert({ open: true, message: `合并当前语音失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        setMergeProgress(prev => ({ ...(prev || {}), status: 'FAILURE', message: `提交合并任务失败: ${error.response?.data?.error || error.message}`}));
        } finally {
        setActionLoading(prev => ({ ...prev, [actionKey]: false }));
        }
    };

    // --- 新增：传递给子组件的回调函数 ---
    const handleStartAnalysis = async (pptFile, promptId) => {
        setIsSynthesizing(true);
        setSynthesisProgress({ progress: 0, message: '正在提交分析任务...', status: 'in_progress' });
        try {
        const response = await ttsApi.startVideoAnalysis(contentId, pptFile, promptId);
        setSynthesisTask({ status: 'analyzing', id: response.data.synthesis_id, ...response.data });
        if (response.data.task_id) {
            startPolling(response.data.task_id, 'analysis', 'AI 脚本分析中...');
        }setAlert
        setAlert({ open: true, message: '分析任务已提交...', severity: 'info' });
        } catch (error) {
        setAlert({ open: true, message: `分析任务提交失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        setIsSynthesizing(false);
        setSynthesisProgress({ progress: 0, message: '提交失败', status: 'failed' });
        }
    };

    const handleStartSynthesis = async (synthesisId, finalScriptData) => {
        setIsSynthesizing(true);
        setSynthesisProgress({ progress: 0, message: '正在提交合成任务...', status: 'in_progress' });
        try {
        const response = await ttsApi.startVideoSynthesis(synthesisId, finalScriptData);
        setSynthesisTask(prev => ({ ...prev, status: 'synthesizing' }));
        if (response.data.task_id) {
            startPolling(response.data.task_id, 'synthesis', '视频合成中...');
        }
        setAlert({ open: true, message: '视频合成任务已提交...', severity: 'info' });
        } catch (error) {
        setAlert({ open: true, message: `合成任务提交失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
        setIsSynthesizing(false);
        setSynthesisProgress({ progress: 0, message: '提交失败', status: 'failed' });
        }
    };

  
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
      // console.log(`Stopped polling for task: ${pollingKey}`);
    } else if (pollingIntervalsRef.current[taskId] && taskType === 'default') { // 兼容旧的只用 taskId 作为 key
        clearInterval(pollingIntervalsRef.current[taskId]);
        const newIntervals = { ...pollingIntervalsRef.current };
        delete newIntervals[taskId];
        pollingIntervalsRef.current = newIntervals;
        // console.log(`Stopped polling for task (legacy key): ${taskId}`);
    }
  };

  // --- New Handlers for Global TTS Settings ---
  const handleGlobalConfigChange = (field, value) => {
    setGlobalTtsConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveGlobalConfig = async () => {
    const loadingKey = 'global_config';
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    try {
      await ttsApi.updateTrainingContentTtsConfig(contentId, globalTtsConfig);
      setAlert({ open: true, message: '全局TTS配置已保存！', severity: 'success' });
      setIsGlobalSettingsOpen(false); // 保存后自动收起
      
      // 同步个别句子的配置：将全局配置应用到所有句子的默认配置
      if (contentDetail?.final_script_sentences?.length > 0) {
        try {
          // 为每个句子更新配置，使其继承全局配置
          const updatePromises = contentDetail.final_script_sentences.map(sentence => {
            // 合并全局配置和句子特定配置，全局配置作为基础
            const mergedConfig = {
              ...globalTtsConfig,
              ...(sentence.tts_config || {}) // 保留句子特定的覆盖配置
            };
            return ttsApi.updateSentenceTtsConfig(sentence.id, mergedConfig);
          });
          
          await Promise.all(updatePromises);
          
          // 刷新数据以显示更新后的配置
          fetchContentDetail(false);
          setAlert({ open: true, message: '全局TTS配置已保存并同步到所有句子！', severity: 'success' });
        } catch (syncError) {
          console.warn('同步句子配置时出现部分错误:', syncError);
          setAlert({ open: true, message: '全局配置已保存，但同步到句子时出现部分错误。', severity: 'warning' });
        }
      }
    } catch (error) {
      setAlert({ open: true, message: `保存失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
    } finally {
      setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
    }
  };

  const handleWorkflowStepClick = (stepKey) => {
    if (activeStepKey !== stepKey) {
      setActiveStepKey(stepKey);
      setIsEditingInput(false); 
    }
  };

  const handleEditInputScript = () => setIsEditingInput(true);

  // 保存拆分前 tts 终稿
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
            // 调用 API 更新句子
            await ttsApi.updateSentence(sentenceId, { sentence_text: newText });
            
            // 显示成功提示
            setAlert({ open: true, message: '句子更新成功！语音状态已重置，请重新生成。', severity: 'success' });
            
            // <<<--- 关键修复：在这里调用 fetchContentDetail 来刷新整个页面的数据 ---<<<
            // 传入 false 表示不需要显示全局的 loading 菊花图，让页面内容保持可见
            await fetchContentDetail(false); 
            // --------------------------------------------------------------------->>>

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


  const pollTaskStatus = useCallback((taskId, isBatchTask = false, taskType = 'default', associatedSentenceId = null) => {
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
        } else if (taskType === 'batch_audio_main') { // 特殊处理批量主任务
            setOverallProgress(prev => ({ // 更新整体批量进度UI
                // ... (使用 taskData.meta 更新 overallProgress state)
                total_in_batch: taskData.meta?.total_sentences ?? prev?.total_in_batch ?? 0,
                processed_in_batch: taskData.meta?.submitted_subtasks ?? prev?.processed_in_batch ?? 0,
                // succeeded_in_batch: 批量主任务不直接知道成功数，由子任务轮询更新
                // failed_in_batch: 批量主任务不直接知道失败数
                message: taskData.meta?.message || prev?.message || '批量任务状态更新中...'
            }));

            if (taskData.status === 'SUCCESS') {
                stopPollingForTask(taskId, taskType);
                setAlert({
                    open: true,
                    message: `批量任务 ${taskId.substring(0,6)}... 派发完成: ${taskData.result?.message || taskData.meta?.message || ''}`,
                    severity: 'success'
                });
                // 批量主任务成功后，从其结果中获取子任务列表并开始轮询它们
                if (taskData.result && taskData.result.sub_tasks && Array.isArray(taskData.result.sub_tasks)) {
                    taskData.result.sub_tasks.forEach(subTask => {
                        // console.log(`Starting polling for sub_task: ${subTask.task_id} for sentence: ${subTask.sentence_id}`);
                        pollTaskStatus(subTask.task_id, false, 'single_sentence_audio', subTask.sentence_id); // 为每个子任务启动轮询
                    });
                }
                // 初始刷新一次，让句子的 queued_for_generation 状态显示出来
                fetchContentDetail(false); 
            } else if (taskData.status === 'FAILURE') {
                stopPollingForTask(taskId, taskType);
                // ... (处理批量主任务失败的情况)
                setAlert({ /* ... */ });
                fetchContentDetail(false);
            }

        } else if (taskType === 'single_sentence_audio') { // 处理单句语音生成子任务 (或手动触发的单句)
            if (taskData.status === 'SUCCESS' || taskData.status === 'FAILURE') {
                stopPollingForTask(taskId, taskType);
                // 当单个子任务完成时，我们期望数据库中对应的句子状态已更新
                // 所以调用 fetchContentDetail() 来刷新整个列表是最可靠的
                fetchContentDetail(false); 
                setAlert({
                    open: true,
                    message: `句子 ${associatedSentenceId ? associatedSentenceId.substring(0,6) : taskId.substring(0,6)}... 语音处理 ${taskData.status === 'SUCCESS' ? '成功' : '失败'}。${taskData.result?.message || taskData.meta?.error_message || taskData.error || ''}`,
                    severity: taskData.status === 'SUCCESS' ? 'success' : 'error'
                });
            } else if (taskData.status === 'PROGRESS' && taskData.meta && associatedSentenceId) {
                // 如果子任务的 meta 中有更详细的进度，可以在这里乐观更新UI
                // 但通常依赖 fetchContentDetail 来获取后端更新的 audio_status
                 setContentDetail(prevDetail => {
                    if (!prevDetail || !prevDetail.final_script_sentences) return prevDetail;
                    return {
                        ...prevDetail,
                        final_script_sentences: prevDetail.final_script_sentences.map(s =>
                            s.id === associatedSentenceId
                            ? { ...s, audio_status: taskData.meta.current_sentence_status || 'generating' } // 假设 meta 中有状态
                            : s
                        )
                    };
                });
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
    // console.log(`Started polling for task: ${pollingKey}`);
  }, [fetchContentDetail, overallProgress]); // 移除 mergeProgress

  const handleBatchGenerateAudio = async (engineToUse = null) => {
    
    if (!contentDetail || !contentDetail.id) return;
    
    // 如果没有指定引擎，使用全局配置中的引擎
    const finalEngine = engineToUse || globalTtsConfig.engine || 'gemini_tts';
    
    const apiParams = {
      tts_engine: finalEngine,
      tts_params: {}, 
    };
    
    // 根据引擎类型设置特定参数
    if (finalEngine === 'gemini_tts') {
      apiParams.tts_params = {
        model: globalTtsConfig.gemini_model || 'gemini-2.5-flash-preview-tts',
        system_prompt: globalTtsConfig.system_prompt || '',
        temperature: globalTtsConfig.temperature || 0.7,
      };
    } else if (finalEngine === 'indextts') {
      apiParams.tts_params = {
        voice_reference_path: globalTtsConfig.voice_reference_path || 'default_voice.wav',
        emo_control_method: globalTtsConfig.emo_control_method || 'Same as the voice reference',
        emo_weight: globalTtsConfig.emo_weight || 0.8,
        emo_text: globalTtsConfig.emo_text || '',
        temperature: globalTtsConfig.temperature || 0.8,
        max_text_tokens_per_segment: globalTtsConfig.max_text_tokens_per_segment || 120,
      };
    } else if (finalEngine === 'tts_server') {
      apiParams.tts_params = {
        model: globalTtsConfig.server_model || 'cosyvoice-v3-flash',
        voice: globalTtsConfig.voice || 'longanling_v3',
        server_url: globalTtsConfig.server_url || 'http://localhost:5002',
        api_key: globalTtsConfig.api_key || '',
        format: 'mp3',
      };
    } else if (finalEngine === 'gradio_default') {
      // 保留原有的 gradio_default 逻辑
    }
    
    const actionKey = `batch_generate_${finalEngine}`;
    setActionLoading(prev => ({ ...prev, [actionKey]: true }));
    setAlert({ open: false, message: '', severity: 'info' });
    try {
    //   console.log("Value of apiParams before sending:", JSON.stringify(apiParams)); // 打印JSON字符串形式，看是否能正确序列化
      const response = await ttsApi.batchGenerateAudioForContent(contentDetail.id, apiParams);
      setAlert({ open: true, message: response.data.message || `批量语音生成任务 (${finalEngine}) 已提交。`, severity: 'info' });
      if (response.data.task_id) {
        pollTaskStatus(response.data.task_id, true, 'batch_audio_main'); 
      }
    } catch (error) {
      console.error(`批量生成语音 (${finalEngine}) 失败:`, error);
      setAlert({ open: true, message: `批量生成语音 (${finalEngine}) 失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
    } finally {
      setActionLoading(prev => ({ ...prev, [actionKey]: false }));
    }
  };

  const handleGenerateSentenceAudio = async (sentenceId, engineToUse = null, config = null) => {
    const loadingKey = `sentence_${sentenceId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    
    // 如果没有指定引擎，使用全局配置中的引擎
    const finalEngine = engineToUse || globalTtsConfig.engine || 'gemini_tts';
    
    // 准备参数
    let apiParams = {
      tts_engine: finalEngine,
      tts_params: {},
    };

    // 根据引擎类型设置特定参数
    if (finalEngine === 'gemini_tts') {
      apiParams.tts_params = {
        model: config?.gemini_model || globalTtsConfig.gemini_model || 'gemini-2.5-flash-preview-tts',
        system_prompt: config?.system_prompt || globalTtsConfig.system_prompt || '',
        temperature: config?.temperature || globalTtsConfig.temperature || 0.7,
      };
    } else if (finalEngine === 'indextts') {
      apiParams.tts_params = {
        voice_reference_path: config?.voice_reference_path || globalTtsConfig.voice_reference_path || 'default_voice.wav',
        emo_control_method: config?.emo_control_method || globalTtsConfig.emo_control_method || 'Same as the voice reference',
        emo_weight: config?.emo_weight || globalTtsConfig.emo_weight || 0.8,
        emo_text: config?.emo_text || globalTtsConfig.emo_text || '',
        temperature: config?.temperature || globalTtsConfig.temperature || 0.8,
        max_text_tokens_per_segment: config?.max_text_tokens_per_segment || globalTtsConfig.max_text_tokens_per_segment || 120,
      };
    } else if (finalEngine === 'tts_server') {
      apiParams.tts_params = {
        model: config?.server_model || globalTtsConfig.server_model || 'cosyvoice-v3-flash',
        voice: config?.voice || globalTtsConfig.voice || 'longanling_v3',
        server_url: config?.server_url || globalTtsConfig.server_url || 'http://localhost:5002',
        api_key: config?.api_key || globalTtsConfig.api_key || '',
        format: config?.format || 'mp3',
      };
    } else if (finalEngine === 'gradio_default') {
      apiParams.tts_params = config || {};
    }
    try {
      if (contentDetail) {
        setContentDetail(prev => (!prev || !prev.final_script_sentences) ? prev : {
            ...prev,
            final_script_sentences: prev.final_script_sentences.map(s => 
                s.id === sentenceId ? { ...s, audio_status: 'processing_request' } : s
            )
        });
      }
      const response = await ttsApi.generateSentenceAudio(sentenceId, apiParams,config); 
      setAlert({ open: true, message: response.data.message || '单句语音生成任务已提交。', severity: 'info' });
      if (response.data.task_id) {
        pollTaskStatus(response.data.task_id, false, 'single_sentence_audio', sentenceId); // 传递句子ID
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

  const handleSaveSentenceConfig = async (sentenceId, config) => {
    const loadingKey = `save_config_${sentenceId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    try {
        await ttsApi.updateSentenceTtsConfig(sentenceId, config);
        setAlert({ open: true, message: '单句配置已保存!', severity: 'success' });
        fetchContentDetail(false); // Refresh to show updated state
    } catch (error) {
        setAlert({ open: true, message: `保存配置失败: ${error.response?.data?.error || error.message}`, severity: 'error' });
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

  // 新增：导出培训资料（音频、图片、manifest.json）
  const handleExportMaterials = async () => {
    if (!contentId) return;
    
    const loadingKey = `export_materials_${contentId}`;
    setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
    
    try {
      const response = await ttsApi.exportTrainingMaterials(contentId);
      
      // 创建下载链接
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${contentDetail?.content_name || 'training'}_materials.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      setAlert({ open: true, message: '资料导出成功！', severity: 'success' });
    } catch (error) {
      console.error('导出资料失败:', error);
      setAlert({ 
        open: true, 
        message: `导出资料失败: ${error.response?.data?.error || error.message}`, 
        severity: 'error' 
      });
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

  // 第三方TTS数据导入成功的回调
  const handleImportSuccess = (result) => {
    setAlert({ 
      open: true, 
      message: result.message || '导入成功！', 
      severity: 'success' 
    });
    fetchContentDetail(false); // 刷新页面数据
  };

  const handleVideoTaskStart = (taskId, taskType, initialMessage) => {
      // 当 VideoSynthesisStep 调用 onTaskStart 时，我们在这里启动轮询
      startPolling(taskId, taskType, initialMessage);
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

  // if (contentDetail) {
  //     console.log("================ 调试点 1: TrainingContentDetail ================");
  //     console.log("父组件状态 contentDetail:", contentDetail);
  //     console.log("父组件状态 contentDetail.final_script_sentences:", contentDetail.final_script_sentences);
  //     console.log("==========================================================");
  // }

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
      {/* <<<--- 在这里新增视频合成任务的进度条 ---<<< */}
        {synthesisTask && (synthesisTask.status === 'analyzing' || synthesisTask.status === 'synthesizing') && (
            <Paper 
                elevation={2} 
                sx={{ 
                    p: 2, 
                    mb: 3, 
                    border: 1,
                    borderColor: 'info.light',
                    backgroundColor: 'info.lightest',
                }}
            >
                <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
                    视频生成进度
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <CircularProgress size={24} color="info" />
                    <Box sx={{ width: '100%' }}>
                        <Typography variant="body2" color="text.secondary">
                            {synthesisTask.status === 'analyzing' ? 'AI脚本分析中...' : '视频编码合成中...'}
                        </Typography>
                        {/* 检查是否有具体的进度信息可以显示 */}
                        {synthesisTask.status === 'synthesizing' && typeof pollingTask.meta?.progress === 'number' ? (
                           <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                                <LinearProgress 
                                    variant="determinate" 
                                    value={pollingTask.meta.progress} 
                                    sx={{ flexGrow: 1, height: 8, borderRadius: 4 }} 
                                />
                                <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                                    {`${pollingTask.meta.progress}%`}
                                </Typography>
                            </Box>
                        ) : (
                            <LinearProgress variant="indeterminate" sx={{ mt: 1.5, borderRadius: 2 }} color="info"/>
                        )}
                    </Box>
                </Box>
            </Paper>
        )}
        {/* ---------------------------------------------------->>> */}


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
            
             {  currentActiveStepDetails.key === 'splitSentences' ? (
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
                      {renderSkipButton(currentActiveStepDetails, currentInputScriptId)}
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
                <Paper elevation={1} sx={{ mb: 3, border: '1px solid', borderColor: 'divider' }}>
                  <Box 
                      sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, cursor: 'pointer' }} 
                      onClick={() => setIsGlobalSettingsOpen(!isGlobalSettingsOpen)}
                  >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <SettingsIcon color="primary" />
                          <Typography variant="h3" component="h3">全局TTS生成设置</Typography>
                      </Box>
                      <IconButton>
                          {isGlobalSettingsOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      </IconButton>
                  </Box>
                  <Collapse in={isGlobalSettingsOpen}>
                      <Divider />
                      <Box sx={{ p: 2 }}>
                          <Grid container spacing={3}>
                              <Grid item xs={12} md={6}>
                                  {/* TTS 引擎选择 */}
                                  <FormControl fullWidth margin="dense">
                                      <InputLabel>TTS 引擎</InputLabel>
                                      <Select
                                          value={globalTtsConfig.engine || 'gemini_tts'}
                                          label="TTS 引擎"
                                          onChange={(e) => handleGlobalConfigChange('engine', e.target.value)}
                                      >
                                          <MenuItem value="gemini_tts">Gemini TTS (Google AI)</MenuItem>
                                          <MenuItem value="indextts">IndexTTS2 (本地部署)</MenuItem>
                                          <MenuItem value="tts_server">TTS-Server (微服务)</MenuItem>
                                      </Select>
                                      <FormHelperText>选择语音合成引擎</FormHelperText>
                                  </FormControl>

                                  {/* Gemini TTS 特有配置 */}
                                  {globalTtsConfig.engine === 'gemini_tts' && (
                                      <>
                                          <FormControl fullWidth margin="dense" sx={{ mt: 2 }}>
                                              <InputLabel>TTS 模型</InputLabel>
                                              <Select
                                                  value={globalTtsConfig.gemini_model || 'gemini-2.5-flash-preview-tts'}
                                                  label="TTS 模型"
                                                  onChange={(e) => handleGlobalConfigChange('gemini_model', e.target.value)}
                                              >
                                                  <MenuItem value="gemini-2.5-flash-preview-tts">Gemini Flash (速度快)</MenuItem>
                                                  <MenuItem value="gemini-2.5-pro-preview-tts">Gemini Pro (质量高)</MenuItem>
                                              </Select>
                                              <FormHelperText>为所有未单独设置的句子选择默认的语音合成模型。</FormHelperText>
                                          </FormControl>

                                          <TextField
                                              fullWidth
                                              margin="dense"
                                              label="系统提示词 (System Prompt)"
                                              multiline
                                              rows={4}
                                              value={globalTtsConfig.system_prompt}
                                              onChange={(e) => handleGlobalConfigChange('system_prompt', e.target.value)}
                                              placeholder="例如：你是一名专业的育儿嫂培训师..."
                                              variant="outlined"
                                              sx={{ mt: 2 }}
                                          />
                                      </>
                                  )}

                                  {/* TTS-Server 特有配置 */}
                                  {globalTtsConfig.engine === 'tts_server' && (
                                      <>
                                          <FormControl fullWidth margin="dense" sx={{ mt: 2 }}>
                                              <InputLabel>语音模型</InputLabel>
                                              <Select
                                                  value={globalTtsConfig.server_model || 'cosyvoice-v3-flash'}
                                                  label="语音模型"
                                                  onChange={(e) => handleGlobalConfigChange('server_model', e.target.value)}
                                              >
                                                  <MenuItem value="cosyvoice-v3-flash">CosyVoice V3 Flash</MenuItem>
                                                  <MenuItem value="cosyvoice-v1">CosyVoice V1</MenuItem>
                                              </Select>
                                              <FormHelperText>选择TTS-Server语音合成模型</FormHelperText>
                                          </FormControl>

                                          <FormControl fullWidth margin="dense" sx={{ mt: 2 }}>
                                              <InputLabel>语音音色</InputLabel>
                                              <Select
                                                  value={globalTtsConfig.voice || 'longanling_v3'}
                                                  label="语音音色"
                                                  onChange={(e) => handleGlobalConfigChange('voice', e.target.value)}
                                              >
                                                  <MenuItem value="longanling_v3">龙安灵 V3 (温柔女声)</MenuItem>
                                                  <MenuItem value="longwan">龙湾 (温柔女声)</MenuItem>
                                                  <MenuItem value="longyuan">龙渊 (磁性男声)</MenuItem>
                                              </Select>
                                              <FormHelperText>选择语音音色</FormHelperText>
                                          </FormControl>

                                          <TextField
                                              fullWidth
                                              margin="dense"
                                              label="TTS服务器地址"
                                              value={globalTtsConfig.server_url || 'http://localhost:5002'}
                                              variant="outlined"
                                              sx={{ mt: 2 }}
                                              helperText="TTS微服务的基础URL地址（从环境变量获取）"
                                              InputProps={{
                                                  readOnly: true,
                                              }}
                                          />

                                          <TextField
                                              fullWidth
                                              margin="dense"
                                              label="API密钥"
                                              type="password"
                                              value={globalTtsConfig.api_key ? '••••••••••••' : '未设置'}
                                              variant="outlined"
                                              sx={{ mt: 2 }}
                                              helperText="用于访问TTS微服务的API密钥（从环境变量获取）"
                                              InputProps={{
                                                  readOnly: true,
                                              }}
                                          />
                                      </>
                                  )}
                                  {globalTtsConfig.engine === 'indextts' && (
                                      <>
                                          <TextField
                                              fullWidth
                                              margin="dense"
                                              label="参考音频文件名"
                                              value={globalTtsConfig.voice_reference_path || ''}
                                              onChange={(e) => handleGlobalConfigChange('voice_reference_path', e.target.value)}
                                              placeholder="例如：default_voice.wav"
                                              helperText="放置在 backend/static/tts_voices/ 目录下的参考音频文件"
                                              variant="outlined"
                                              sx={{ mt: 2 }}
                                          />

                                          <FormControl fullWidth margin="dense" sx={{ mt: 2 }}>
                                              <InputLabel>情感控制方式</InputLabel>
                                              <Select
                                                  value={globalTtsConfig.emo_control_method || 'Same as the voice reference'}
                                                  label="情感控制方式"
                                                  onChange={(e) => handleGlobalConfigChange('emo_control_method', e.target.value)}
                                              >
                                                  <MenuItem value="Same as the voice reference">与参考音频相同</MenuItem>
                                                  <MenuItem value="Use emotion reference audio">使用情感参考音频</MenuItem>
                                                  <MenuItem value="Use emotion vectors">使用情感向量</MenuItem>
                                                  <MenuItem value="Use text description to control emotion">使用文本描述控制</MenuItem>
                                              </Select>
                                              <FormHelperText>控制生成语音的情感表达方式</FormHelperText>
                                          </FormControl>

                                          {globalTtsConfig.emo_control_method === 'Use text description to control emotion' && (
                                              <TextField
                                                  fullWidth
                                                  margin="dense"
                                                  label="情感描述"
                                                  value={globalTtsConfig.emo_text || ''}
                                                  onChange={(e) => handleGlobalConfigChange('emo_text', e.target.value)}
                                                  placeholder="例如：温柔、专业、亲切"
                                                  variant="outlined"
                                                  sx={{ mt: 2 }}
                                              />
                                          )}
                                      </>
                                  )}
                              </Grid>
                              <Grid item xs={12} md={6}>
                                  <Typography gutterBottom>温度 (Temperature)</Typography>
                                  <Stack spacing={2} direction="row" sx={{ alignItems: 'center' }}>
                                      <Slider
                                          value={typeof globalTtsConfig.temperature === 'number' ? globalTtsConfig.temperature : 0}
                                          onChange={(e, newValue) => handleGlobalConfigChange('temperature', newValue)}
                                          aria-labelledby="temperature-slider"
                                          valueLabelDisplay="auto"
                                          step={0.01}
                                          marks={[
                                              { value: 0, label: '0.0' },
                                              { value: 1, label: '1.0' },
                                              { value: 2, label: '2.0' },
                                          ]}
                                          min={0}
                                          max={2}
                                      />
                                      <Chip label={globalTtsConfig.temperature?.toFixed(2) || '0.00'} />
                                  </Stack>
                                  <FormHelperText>控制输出的随机性。值越高越随机，越低越确定。</FormHelperText>

                                  {/* IndexTTS2 额外参数 */}
                                  {globalTtsConfig.engine === 'indextts' && (
                                      <>
                                          <Typography gutterBottom sx={{ mt: 3 }}>情感权重 (Emotion Weight)</Typography>
                                          <Stack spacing={2} direction="row" sx={{ alignItems: 'center' }}>
                                              <Slider
                                                  value={globalTtsConfig.emo_weight || 0.8}
                                                  onChange={(e, newValue) => handleGlobalConfigChange('emo_weight', newValue)}
                                                  valueLabelDisplay="auto"
                                                  step={0.1}
                                                  min={0}
                                                  max={1.6}
                                              />
                                              <Chip label={(globalTtsConfig.emo_weight || 0.8).toFixed(1)} />
                                          </Stack>
                                          <FormHelperText>控制情感表达的强度</FormHelperText>

                                          <Typography gutterBottom sx={{ mt: 3 }}>每段最大Token数</Typography>
                                          <Stack spacing={2} direction="row" sx={{ alignItems: 'center' }}>
                                              <Slider
                                                  value={globalTtsConfig.max_text_tokens_per_segment || 120}
                                                  onChange={(e, newValue) => handleGlobalConfigChange('max_text_tokens_per_segment', newValue)}
                                                  valueLabelDisplay="auto"
                                                  step={10}
                                                  min={20}
                                                  max={600}
                                              />
                                              <Chip label={globalTtsConfig.max_text_tokens_per_segment || 120} />
                                          </Stack>
                                          <FormHelperText>推荐 80-200，值越大语音越流畅但需要更多显存</FormHelperText>
                                      </>
                                  )}
                              </Grid>
                          </Grid>
                          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                              <Button 
                                  variant="contained"
                                  onClick={handleSaveGlobalConfig}
                                  disabled={actionLoading['global_config']}
                                  startIcon={actionLoading['global_config'] ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
                              >
                                  保存全局设置
                              </Button>
                          </Box>
                      </Box>
                  </Collapse>
                </Paper>
                <Stack direction={{xs: 'column', sm: 'row'}} spacing={2} sx={{mb:2, alignItems: 'flex-start'}}>
                    {/* 批量生成语音按钮 - 使用当前选择的引擎 */}
                    <Button 
                        variant="contained" 
                        color="primary"
                        onClick={() => handleBatchGenerateAudio()}
                        disabled={
                            actionLoading[`batch_generate_${globalTtsConfig.engine || 'gemini_tts'}`] || 
                            loading || 
                            !contentDetail?.final_script_sentences?.length ||
                            (overallProgress && (overallProgress.status === 'PROGRESS' || overallProgress.status === 'PENDING'))
                        } 
                        startIcon={(actionLoading[`batch_generate_${globalTtsConfig.engine || 'gemini_tts'}`] || (overallProgress && (overallProgress.status === 'PROGRESS' || overallProgress.status === 'PENDING'))) ? <CircularProgress size={16} /> : <PlaylistPlayIcon />}
                    >
                        {overallProgress && (overallProgress.status === 'PROGRESS' || overallProgress.status === 'PENDING') 
                            ? "批量生成中..." 
                            : `批量生成 (${globalTtsConfig.engine === 'indextts' ? 'IndexTTS2' : globalTtsConfig.engine === 'tts_server' ? 'TTS-Server' : 'Gemini'})`}
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

                    {/* 新增：合并当前语音按钮 */}
                    <Button
                        variant="contained"
                        color="success" // 示例颜色
                        onClick={handleMergeCurrentAudios}
                        disabled={
                            actionLoading['merge_current_audio'] || 
                            mergeProgress?.status === 'PENDING' || 
                            mergeProgress?.status === 'QUEUED' || 
                            mergeProgress?.status === 'PROGRESS' ||
                            !contentDetail?.final_script_sentences?.some(s => s.audio_status === 'generated') 
                            // 只有当至少有一个句子已生成语音时才启用
                        }
                        startIcon={actionLoading['merge_current_audio'] || mergeProgress?.status === 'PROGRESS' ? <CircularProgress size={20} color="inherit" /> : <MergeTypeIcon />}
                      >
                        合并当前已生成语音
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

                    {/* 导入第三方TTS数据按钮 */}
                    <Button
                        variant="outlined"
                        color="secondary"
                        startIcon={<FileUploadIcon />}
                        onClick={() => setIsImportDialogOpen(true)}
                        disabled={loading}
                    >
                        导入第三方数据
                    </Button>

                    <Button
                        variant="contained"
                        onClick={() => handleBatchGenerateAudio('gemini_tts')}
                        disabled={actionLoading['batch_generate_gemini_tts'] || !contentDetail?.final_script_sentences?.length}
                        startIcon={actionLoading['batch_generate_gemini_tts'] ? <CircularProgress size={20} color="inherit" /> : <GraphicEqIcon />}
                        sx={{ 
                            backgroundColor: '#4CAF50', // 示例绿色，您可以选择您喜欢的颜色
                            '&:hover': { backgroundColor: '#388E3C' }
                        }}
                    >
                        批量生成 (Gemini)
                    </Button>

                    <Button
                        variant="contained"
                        onClick={() => handleBatchGenerateAudio('tts_server')}
                        disabled={actionLoading['batch_generate_tts_server'] || !contentDetail?.final_script_sentences?.length}
                        startIcon={actionLoading['batch_generate_tts_server'] ? <CircularProgress size={20} color="inherit" /> : <GraphicEqIcon />}
                        sx={{ 
                            backgroundColor: '#2196F3', // 蓝色
                            '&:hover': { backgroundColor: '#1976D2' }
                        }}
                    >
                        批量生成 (TTS-Server)
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
                            >
                                下载合并语音
                            </Button>
                            <Button 
                                size="small" 
                                variant="contained"
                                color="secondary"
                                onClick={handleExportMaterials}
                                disabled={actionLoading[`export_materials_${contentId}`]}
                                startIcon={actionLoading[`export_materials_${contentId}`] ? <CircularProgress size={16} color="inherit" /> : <CloudUploadIcon />}
                            >
                                {actionLoading[`export_materials_${contentId}`] ? '导出中...' : '导出资料'}
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
                      playingAudio={playingAudio} 
                      actionLoading={actionLoading}
                      onPlayAudio={handlePlayAudio} 
                      onGenerateAudio={handleGenerateSentenceAudio}
                      onUpdateSentenceText={handleUpdateSentence} 
                      onDeleteSentence={handleDeleteSentence}
                      mergedAudioSegments={contentDetail?.latest_merged_audio?.segments}
                      globalTtsConfig={globalTtsConfig}
                      onSaveSentenceConfig={handleSaveSentenceConfig}
                      onRefreshData={() => fetchContentDetail(false)}
                  />
                )}
              </Box>
            // ) : currentActiveStepDetails.key === 'generateAndMergeAudio' ? (
            
            ) : activeStepKey === 'synthesizeVideo' ?(
                    <VideoSynthesisStep 
                        contentId={contentId}
                        synthesisTask={synthesisTask}
                        allSentences={enhancedSentences}
                        progressData={synthesisProgress}
                        isSubmitting={isSynthesizing}
                        onStartTask={handleStartTask}
                        onResetTask={handleResetTask}
                        onAlert={setAlert}
                        setSynthesisTask={setSynthesisTask} // <<<--- 确保传递这个 prop
                        onSkipStep={handleSkipStep} // 传递跳过函数

                    />
            ) : ( // 默认的网格布局，用于步骤 1, 2, 3 (口播稿, TTS优化, LLM修订)
              <Box> {/* 外层容器 (可选) */}
                <Grid container spacing={2}> {/* 主 Grid Container */}
                  
                  {/* 条件渲染“跳过”按钮区域，作为一个占据整行的 Grid item */}
                  {currentActiveStepDetails?.key === 'triggerTtsRefine' && (
                    <Grid item xs={12}> {/* <--- 包裹在 Grid item 中，占据12列 (整行) */}
                      <Box sx={{ mb: 2 }}> {/* 原始的 Box，用于边距 */}
                        {(() => {
                          // ... (获取 latestOralScriptId 的逻辑不变)
                          const oralScripts = contentDetail?.scripts
                            ?.filter(s => s.script_type === 'oral_script')
                            .sort((a, b) => b.version - a.version);
                          const latestOralScript = (oralScripts && oralScripts.length > 0) ? oralScripts[0] : null;
                          const latestOralScriptId = latestOralScript?.id; // 获取 ID
                          const contentForSkipDisplay = latestOralScript?.content || "口播稿内容加载中...";


                          return (
                            <Paper variant="outlined" sx={{ p: 2 }}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb:1 }}>
                                <Typography variant="subtitle1">
                                  可选操作:
                                </Typography>
                                <Button
                                  variant="outlined"
                                  size="small"
                                  startIcon={<SkipNextIcon />}
                                  onClick={() => latestOralScriptId && handleSkipStep(currentActiveStepDetails.key, latestOralScriptId)}
                                  disabled={!latestOralScriptId || actionLoading[`skip_${currentActiveStepDetails.key}_${latestOralScriptId}`]}
                                >
                                  跳过 TTS 优化 (使用口播稿)
                                </Button>
                              </Box>
                              {/* 可以选择是否在这里显示口播稿预览 */}
                              <Typography variant="caption" sx={{display: 'block', mb:1}}>将使用以下口播稿内容作为优化稿：</Typography>
                              <Box sx={{ 
                                  flexGrow: 1, overflowY: 'auto', whiteSpace: 'pre-wrap', 
                                  p:1, border: '1px solid #eee', borderRadius: 1, 
                                  maxHeight: 100, backgroundColor: '#f9f9f9' // 减小预览高度
                              }}>
                                {contentForSkipDisplay.substring(0, 200) + (contentForSkipDisplay.length > 200 ? "..." : "")}
                              </Box>
                            </Paper>
                          );
                        })()}
                      </Box>
                    </Grid>
                  )}
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
                        <Box sx={{ display: 'flex', gap: 1 }}>
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
                            {renderSkipButton(currentActiveStepDetails, currentInputScriptId)}
                        </Box>
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
              </Box>
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

      {/* 第三方TTS数据导入对话框 */}
      <ImportExternalTtsDialog
        open={isImportDialogOpen}
        onClose={() => setIsImportDialogOpen(false)}
        contentId={contentId}
        onImportSuccess={handleImportSuccess}
      />
    </Box>
  );
};

export default TrainingContentDetail;