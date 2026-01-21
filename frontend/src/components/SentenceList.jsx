// frontend/src/components/SentenceList.jsx

import React, { useState, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Button, Typography, Paper, CircularProgress, Chip, Grid, Card, CardHeader, CardContent,
  TableContainer, Table, TableHead, TableRow, TableCell, TableBody, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions,  FormControl, InputLabel, Select, MenuItem, Menu, // 用于引擎选择
  List, ListItem, ListItemText, Divider, IconButton, TextField, Stack, TextareaAutosize,FormControlLabel,Checkbox,Collapse,
  Badge,FormHelperText,Slider,ToggleButtonGroup,ToggleButton,
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
    Subtitles as SubtitlesIcon, // 新增字幕图标
    AddCircleOutline as AddCircleOutlineIcon, // 新增：插入句子图标
    ArrowUpward as ArrowUpwardIcon, // 新增：向前插入图标
    ArrowDownward as ArrowDownwardIcon // 新增：向后插入图标
} from '@mui/icons-material';
import FormatBoldIcon from '@mui/icons-material/FormatBold'; // 导入加粗图标

import { API_BASE_URL } from '../config';
import formatMsToTime from '../utils/timeUtils'; // 确保有这个工具函数来格式化时间戳
import { formatRelativeTime } from '../api/dateUtils';
import MiniAudioPlayer from './MiniAudioPlayer'; // 导入新的迷你播放器组件
import { pinyin } from 'pinyin-pro'; // 1. 导入 pinyin-pro
import FontDownloadIcon from '@mui/icons-material/FontDownload'; // 示例图标 for 拼音
import { ttsApi } from '../api/tts'; // 新增：导入API
import InsertSentenceDialog from './InsertSentenceDialog'; // 新增：导入插入句子对话框




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
    mergedAudioSegments, // 新增：传递合并后的分段信息
    onRefreshData // 新增：刷新数据的回调函数
}) => {
    // --- 1. 新增 State ---
    const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'generated', 'pending', 'error'
    const [showModifiedOnly, setShowModifiedOnly] = useState(false); // 控制是否只显示修改过的句子
    
    // 新增：插入句子相关的state
    const [insertDialogOpen, setInsertDialogOpen] = useState(false);
    const [insertReferenceSentence, setInsertReferenceSentence] = useState(null);
    const [insertLoading, setInsertLoading] = useState(false);
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
    const triggerButtonRef = useRef(null);


    // +++++ 新增：管理播放速度的 state +++++
    const [currentPlaybackRate, setCurrentPlaybackRate] = useState(1.0);
    // +++++++++++++++++++++++++++++++++++++++

    const handlePlaybackRateChange = (event, newRate) => {
        if (newRate !== null) { // ToggleButton 在取消选择时可能返回 null
            setCurrentPlaybackRate(newRate);
        }
    };
    
    const handleClosePlayerDialog = () => {
        setPlayerDialogOpen(false);
        // setCurrentPlayingSentence(null);
        // setCurrentPlaybackRate(1.0); // 关闭对话框时重置播放速度
    };

    const handleDialogExited = () => {
        // 这个函数在对话框完全消失后被调用
        setCurrentPlayingSentence(null);
        setCurrentPlaybackRate(1.0);
        if (triggerButtonRef.current) {
            triggerButtonRef.current.focus();
        }
    };
    
    const handleOpenPlayerDialog = (sentence) => {
        const audioRelativePath = sentence.latest_audio_url; // 这是数据库中的 file_path，例如 "CONTENT_ID/SENTENCE_ID/audio.wav"

        if (audioRelativePath) {
            // --- 从环境变量获取音频路径前缀 ---
            const audioBasePath = import.meta.env.VITE_AUDIO_BASE_PATH || '/static/tts_audio'; 
            // 提供一个默认值以防环境变量未设置
            // ------------------------------------
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
            // const fullAudioUrl = `${baseUrl}/static/tts_audio/${audioRelativePath}`;
            // +++++ 使用配置化的路径构建 URL +++++
            const fullAudioUrl = `${baseUrl}${audioBasePath}/${audioRelativePath}`;
     

            // console.log("Corrected audio URL pointing to Flask static path:", fullAudioUrl);

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
    const [isSSMLMode, setIsSSMLMode] = useState(false); // 新增：SSML模式状态
    const [deleteSentenceConfirmOpen, setDeleteSentenceConfirmOpen] = useState(false);
    const [sentenceToDelete, setSentenceToDelete] = useState(null);

    // +++++ 1. 创建 ref +++++
    const editTextAreaRef = useRef(null);
    // +++++++++++++++++++++++

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
        setIsSSMLMode(false); // 重置SSML模式
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

    // SSML相关功能函数
    const insertSSMLTag = (tag, hasClosingTag = true) => {
        const textarea = editTextAreaRef.current;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = editingSentenceText.substring(start, end);

        let insertText;
        if (hasClosingTag) {
            insertText = selectedText ? `<${tag}>${selectedText}</${tag}>` : `<${tag}></${tag}>`;
        } else {
            insertText = `<${tag}/>`;
        }

        const newText = editingSentenceText.substring(0, start) + insertText + editingSentenceText.substring(end);
        setEditingSentenceText(newText);

        setTimeout(() => {
            textarea.focus();
            if (hasClosingTag && !selectedText) {
                // 将光标放在标签中间
                const newPos = start + tag.length + 2;
                textarea.setSelectionRange(newPos, newPos);
            } else {
                const newPos = start + insertText.length;
                textarea.setSelectionRange(newPos, newPos);
            }
        }, 0);
    };

    const insertBreakTag = (duration = '500ms') => {
        const textarea = editTextAreaRef.current;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const insertText = `<break time="${duration}"/>`;
        const newText = editingSentenceText.substring(0, start) + insertText + editingSentenceText.substring(start);
        setEditingSentenceText(newText);

        setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(start + insertText.length, start + insertText.length);
        }, 0);
    };

    const wrapWithSpeak = () => {
        if (editingSentenceText.includes('<speak')) return;
        const newText = `<speak>\n${editingSentenceText}\n</speak>`;
        setEditingSentenceText(newText);
    };

    // 检查文本是否已经包含speak标签
    const ensureSpeakWrapper = (text) => {
        if (text.includes('<speak')) {
            return text;
        }
        return `<speak>\n${text}\n</speak>`;
    };

    // 检测文本是否包含SSML标签
    const hasSSMLTags = editingSentenceText.includes('<') && editingSentenceText.includes('>');

    // 获取纯文本预览（移除SSML标签）
    const getPlainTextPreview = (text) => {
        return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    };

    // 处理拼音标记的函数

    const [pinyinMenu, setPinyinMenu] = useState({
        anchorEl: null,      // 菜单的锚点元素
        options: [],         // 多音字选项 ['chong', 'chòng']
        selectionInfo: null, // 选中的文本信息 { start, end, text }
    });

    // 新增状态变量用于多字符拼音选择
    const [pinyinOptions, setPinyinOptions] = useState([]); // 每个字符的拼音选项
    const [selectedPinyins, setSelectedPinyins] = useState({}); // 用户选择的拼音
    const [showPinyinPicker, setShowPinyinPicker] = useState(false); // 拼音选择器显示状态
    const [selectionInfo, setSelectionInfo] = useState(null); // 选中的文本信息

    // 获取汉字的所有可能读音
    const getPinyinOptions = (char) => {
        if (!char || !/[\u4e00-\u9fa5]/.test(char)) {
            return [];
        }
        
        const result = pinyin(char, { 
            toneType: 'num', // 使用数字标示音调，例如 wu2 wu4
            multiple: true,
            type: 'array'
        });
        
        return [...new Set(result)];
    };
    const handleApplyPinyin = (event) => {
        const textArea = editTextAreaRef.current;
        if (!textArea) return;

        const start = textArea.selectionStart;
        const end = textArea.selectionEnd;
        const selectedText = editingSentenceText.substring(start, end);

        if (!selectedText) {
            alert('请先选择要注音的文字');
            return;
        }

        // 支持多字符选择 - 按照参考文档要求
        if (selectedText.length === 1 && /[\u4e00-\u9fa5]/.test(selectedText)) {

        // 2. 获取所有可能的拼音
        // pinyin-pro 返回类似 [['chong1'], ['chong4']] 的多音字数组
        const pinyinResult = pinyin(selectedText, {
            toneType: 'num', // 使用数字标示音调，例如 chong1 chong4
            multiple: true,     // 启用多音字模式
            type: 'array'
        });
        
        const pinyinOptions = Array.from(new Set(pinyinResult)); // 去重

        if (pinyinOptions.length > 1) {
            // 3. 如果是多音字，打开选择菜单
            setPinyinMenu({
                anchorEl: event.currentTarget, // 将“标注拼音”按钮作为锚点
                options: pinyinOptions,
                selectionInfo: { start, end, text: selectedText }
            });
        } else if (pinyinOptions.length === 1) {
            // 4. 如果是单音字，直接替换
            replaceTextWithPinyin(selectedText, pinyinOptions[0], start, end);
        } else {
            // alert('无法获取该汉字的拼音。');
        }
        } else {
            // 多字符选择的处理逻辑 - 按照参考文档实现
            const options = [];
            const initialSelected = {};
            
            for (let i = 0; i < selectedText.length; i++) {
                const char = selectedText[i];
                if (/[\u4e00-\u9fa5]/.test(char)) {
                    const pinyins = getPinyinOptions(char);
                    if (pinyins.length > 0) {
                        options.push({ char, pinyins });
                        initialSelected[i] = pinyins[0]; // 默认选择第一个读音
                    } else {
                        options.push({ char, pinyins: [] });
                    }
                } else {
                    // 非汉字字符，不需要拼音
                    options.push({ char, pinyins: [] });
                }
            }

            if (options.some(opt => opt.pinyins.length > 0)) {
                setPinyinOptions(options);
                setSelectedPinyins(initialSelected);
                setSelectionInfo({ start, end, text: selectedText });
                setShowPinyinPicker(true);
            } else {
                alert('选中的文本中没有汉字需要注音');
            }
        }
    };

    const handlePinyinSelect = (selectedPinyin) => {
        const { start, end, text } = pinyinMenu.selectionInfo;
        handleClosePinyinMenu(); // 关闭菜单
        replaceTextWithPinyin(text, selectedPinyin, start, end); // 执行替换
    };

    const handleClosePinyinMenu = () => {
        setPinyinMenu({ anchorEl: null, options: [], selectionInfo: null });
    };

    const replaceTextWithPinyin = (originalText, pinyin, start, end) => {
        // 对于单字符，使用SSML phoneme标签格式
        const replacement = `<phoneme alphabet="py" ph="${pinyin}">${originalText}</phoneme>`;
        
        const newText = 
            editingSentenceText.substring(0, start) +
            replacement +
            editingSentenceText.substring(end);

        // 确保整个文本包含在speak标签内
        const finalText = ensureSpeakWrapper(newText);
        setEditingSentenceText(finalText);
        
        setTimeout(() => {
            const textArea = editTextAreaRef.current;
            if (textArea) {
                textArea.focus();
                // 计算新的光标位置，考虑可能添加的speak标签
                const speakOffset = finalText.startsWith('<speak>') && !editingSentenceText.includes('<speak') ? 8 : 0; // "<speak>\n".length
                textArea.selectionStart = textArea.selectionEnd = start + replacement.length + speakOffset;
            }
        }, 0);
    };

    // 新增：多字符拼音选择相关函数
    const handlePinyinSelectMulti = (charIndex, selectedPinyin) => {
        setSelectedPinyins(prev => ({ 
            ...prev, 
            [charIndex]: selectedPinyin 
        }));
    };

    const handleClosePinyinPicker = () => {
        setShowPinyinPicker(false);
        setPinyinOptions([]);
        setSelectedPinyins({});
        setSelectionInfo(null);
    };

    const confirmPinyinSelection = () => {
        if (!selectionInfo) return;

        const { start, end, text: selectedText } = selectionInfo;
        
        // 构建拼音字符串 - 只包含有拼音的字符
        const pinyinArray = [];
        for (let i = 0; i < selectedText.length; i++) {
            const char = selectedText[i];
            if (/[\u4e00-\u9fa5]/.test(char) && selectedPinyins[i]) {
                pinyinArray.push(selectedPinyins[i]);
            }
        }

        if (pinyinArray.length === 0) {
            handleClosePinyinPicker();
            return;
        }

        const pinyinStr = pinyinArray.join(' ');
        
        // 使用SSML phoneme标签格式
        const insertText = `<phoneme alphabet="py" ph="${pinyinStr}">${selectedText}</phoneme>`;
        const newText = editingSentenceText.substring(0, start) + insertText + editingSentenceText.substring(end);
        
        // 确保整个文本包含在speak标签内
        const finalText = ensureSpeakWrapper(newText);
        setEditingSentenceText(finalText);
        handleClosePinyinPicker();

        // 恢复光标位置
        setTimeout(() => {
            const textArea = editTextAreaRef.current;
            if (textArea) {
                textArea.focus();
                // 计算新的光标位置，考虑可能添加的speak标签
                const speakOffset = finalText.startsWith('<speak>') && !editingSentenceText.includes('<speak') ? 8 : 0; // "<speak>\n".length
                const newPos = start + insertText.length + speakOffset;
                textArea.setSelectionRange(newPos, newPos);
            }
        }, 0);
    };

    // +++++ 2. 创建格式化处理函数 +++++
    const handleApplyMarkdownToSentence = (markdownChars) => {
        const textArea = editTextAreaRef.current; // 获取 DOM 元素
        if (!textArea) return;

        const start = textArea.selectionStart;
        const end = textArea.selectionEnd;
        const selectedText = editingSentenceText.substring(start, end);

        if (!selectedText) {
            const newText = 
                editingSentenceText.substring(0, start) +
                markdownChars + markdownChars +
                editingSentenceText.substring(end);
            
            setEditingSentenceText(newText);
            
            setTimeout(() => {
                textArea.focus();
                textArea.selectionStart = textArea.selectionEnd = start + markdownChars.length;
            }, 0);

            return;
        }

        const newText = 
            editingSentenceText.substring(0, start) +
            markdownChars + selectedText + markdownChars +
            editingSentenceText.substring(end);

        setEditingSentenceText(newText);

        setTimeout(() => {
            textArea.focus();
            textArea.selectionStart = start;
            textArea.selectionEnd = end + (markdownChars.length * 2);
        }, 0);
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

    // 新增：插入句子相关的处理函数
    const handleOpenInsertDialog = (sentence) => {
        setInsertReferenceSentence(sentence);
        setInsertDialogOpen(true);
    };

    const handleCloseInsertDialog = () => {
        setInsertDialogOpen(false);
        setInsertReferenceSentence(null);
    };

    const handleInsertSentences = async (insertData) => {
        if (!insertReferenceSentence) return;
        
        setInsertLoading(true);
        try {
            // 添加全局TTS配置到请求数据中
            const requestData = {
                ...insertData,
                tts_config: globalTtsConfig  // 传递全局TTS配置
            };
            
            const response = await ttsApi.insertSentences(insertReferenceSentence.id, requestData);
            
            // 显示成功消息
            alert(`成功插入 ${response.data.inserted_count} 个句子！`);
            
            // 关闭对话框
            handleCloseInsertDialog();
            
            // 刷新数据
            if (typeof onRefreshData === 'function') {
                await onRefreshData();
            }
        } catch (error) {
            console.error('插入句子失败:', error);
            alert(`插入句子失败: ${error.response?.data?.error || error.message}`);
        } finally {
            setInsertLoading(false);
        }
    };

    const handleToggleSettings = (sentence) => {
        const isCurrentlyExpanded = expandedSentenceId === sentence.id;
        if (isCurrentlyExpanded) {
            setExpandedSentenceId(null);
            setEditingConfig(null);
        } else {
            // Priority: sentence.tts_config > globalTtsConfig
            // 先使用全局配置作为基础，然后用句子特定配置覆盖
            const initialConfig = {
                ...globalTtsConfig,
                ...(sentence.tts_config || {}),
            };
            // 如果没有设置引擎，使用全局配置的引擎或默认值
            if (!initialConfig.engine) {
                initialConfig.engine = globalTtsConfig.engine || 'gemini_tts';
            }
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
            // 传递引擎类型和完整配置
            onGenerateAudio(sentenceId, editingConfig.engine || 'gemini_tts', editingConfig);
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
                                                        <Tooltip title="插入句子">
                                                            <span>
                                                            <IconButton 
                                                                size="small" 
                                                                onClick={() => handleOpenInsertDialog(sentence)}
                                                                color="primary"
                                                            >
                                                                <AddCircleOutlineIcon fontSize="small" />
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
                                                            <Button size="small" variant="outlined" onClick={() => onGenerateAudio(sentence.id, globalTtsConfig.engine || 'gemini_tts')} disabled={actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating'} startIcon={(actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating') ? <CircularProgress size={16} /> : <AudiotrackIcon />}>
                                                                {sentence.audio_status?.startsWith('error') ? '重试' : '生成'}
                                                            </Button>
                                                            </span>
                                                        )}
                                                        <Tooltip title="生成设置">
                                                            <IconButton size="small" onClick={() => handleToggleSettings(sentence)} color={expandedSentenceId === sentence.id ? "primary" : "default"}>
                                                                <SettingsIcon fontSize="small" />
                                                            </IconButton>
                                                        </Tooltip>
                                                        {/* 生成/重新生成按钮 */}
                                                        {(sentence.audio_status === 'pending' || sentence.audio_status === 'error' || sentence.audio_status === 'generated') && (
                                                            <Tooltip title={sentence.audio_status === 'generated' ? "重新生成语音" : "生成语音"}>
                                                                <span>
                                                                    <IconButton 
                                                                        size="small" 
                                                                        onClick={() => onGenerateAudio(sentence.id, globalTtsConfig.engine || 'gemini_tts')} 
                                                                        disabled={actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating'} 
                                                                        sx={{ ml: 0.5 }}
                                                                        color={sentence.audio_status === 'pending' ? "primary" : "default"}
                                                                    >
                                                                        {(actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating') ? (
                                                                            <CircularProgress size={20} color="inherit" />
                                                                        ) : sentence.audio_status === 'generated' ? (
                                                                            <RefreshIcon />
                                                                        ) : (
                                                                            <AudiotrackIcon />
                                                                        )}
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
                                                                        {/* TTS 引擎选择 */}
                                                                        <FormControl fullWidth size="small" margin="dense">
                                                                            <InputLabel>TTS 引擎</InputLabel>
                                                                            <Select
                                                                                value={editingConfig.engine || 'gemini_tts'}
                                                                                label="TTS 引擎"
                                                                                onChange={(e) => handleConfigChange('engine', e.target.value)}
                                                                            >
                                                                                <MenuItem value="gemini_tts">Gemini TTS</MenuItem>
                                                                                <MenuItem value="indextts">IndexTTS2</MenuItem>
                                                                                <MenuItem value="tts_server">TTS-Server</MenuItem>
                                                                            </Select>
                                                                        </FormControl>

                                                                        {/* Gemini TTS 配置 */}
                                                                        {editingConfig.engine === 'gemini_tts' && (
                                                                            <>
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
                                                                            </>
                                                                        )}

                                                                        {/* IndexTTS2 配置 */}
                                                                        {editingConfig.engine === 'indextts' && (
                                                                            <>
                                                                                <TextField
                                                                                    fullWidth margin="dense" size="small"
                                                                                    label="参考音频文件名"
                                                                                    value={editingConfig.voice_reference_path || ''}
                                                                                    placeholder={globalTtsConfig.voice_reference_path || 'default_voice.wav'}
                                                                                    onChange={(e) => handleConfigChange('voice_reference_path', e.target.value)}
                                                                                    helperText="留空则使用全局配置"
                                                                                />
                                                                                <FormControl fullWidth size="small" margin="dense">
                                                                                    <InputLabel>情感控制方式</InputLabel>
                                                                                    <Select
                                                                                        value={editingConfig.emo_control_method || 'Same as the voice reference'}
                                                                                        label="情感控制方式"
                                                                                        onChange={(e) => handleConfigChange('emo_control_method', e.target.value)}
                                                                                    >
                                                                                        <MenuItem value="Same as the voice reference">与参考音频相同</MenuItem>
                                                                                        <MenuItem value="Use text description to control emotion">使用文本描述</MenuItem>
                                                                                    </Select>
                                                                                </FormControl>
                                                                                {editingConfig.emo_control_method === 'Use text description to control emotion' && (
                                                                                    <TextField
                                                                                        fullWidth margin="dense" size="small"
                                                                                        label="情感描述"
                                                                                        value={editingConfig.emo_text || ''}
                                                                                        placeholder="例如：温柔、专业"
                                                                                        onChange={(e) => handleConfigChange('emo_text', e.target.value)}
                                                                                    />
                                                                                )}
                                                                            </>
                                                                        )}

                                                                        {/* TTS-Server 配置 */}
                                                                        {editingConfig.engine === 'tts_server' && (
                                                                            <>
                                                                                <FormControl fullWidth size="small" margin="dense">
                                                                                    <InputLabel>TTS模型</InputLabel>
                                                                                    <Select
                                                                                        value={editingConfig.model || 'cosyvoice-v3-flash'}
                                                                                        label="TTS模型"
                                                                                        onChange={(e) => handleConfigChange('model', e.target.value)}
                                                                                    >
                                                                                        <MenuItem value="cosyvoice-v3-flash">CosyVoice V3 Flash</MenuItem>
                                                                                        <MenuItem value="cosyvoice-v1">CosyVoice V1</MenuItem>
                                                                                    </Select>
                                                                                    <FormHelperText>选择TTS-Server语音合成模型</FormHelperText>
                                                                                </FormControl>
                                                                                <FormControl fullWidth size="small" margin="dense">
                                                                                    <InputLabel>语音音色</InputLabel>
                                                                                    <Select
                                                                                        value={editingConfig.voice || 'longanling_v3'}
                                                                                        label="语音音色"
                                                                                        onChange={(e) => handleConfigChange('voice', e.target.value)}
                                                                                    >
                                                                                        <MenuItem value="longanling_v3">龙安灵 V3 (温柔女声)</MenuItem>
                                                                                        <MenuItem value="longwan">龙湾 (温柔女声)</MenuItem>
                                                                                        <MenuItem value="longyuan">龙渊 (磁性男声)</MenuItem>
                                                                                    </Select>
                                                                                    <FormHelperText>选择语音音色</FormHelperText>
                                                                                </FormControl>
                                                                                <TextField
                                                                                    fullWidth margin="dense" size="small"
                                                                                    label="服务器地址"
                                                                                    value={editingConfig.server_url || globalTtsConfig.server_url || 'http://localhost:5002'}
                                                                                    placeholder={globalTtsConfig.server_url || 'http://localhost:5002'}
                                                                                    onChange={(e) => handleConfigChange('server_url', e.target.value)}
                                                                                    helperText="TTS-Server微服务地址 (从环境变量读取)"
                                                                                    InputProps={{ readOnly: true }}
                                                                                    sx={{ '& .MuiInputBase-input': { color: 'text.secondary' } }}
                                                                                />
                                                                                <TextField
                                                                                    fullWidth margin="dense" size="small"
                                                                                    label="API密钥"
                                                                                    value={editingConfig.api_key || globalTtsConfig.api_key || ''}
                                                                                    placeholder="从环境变量读取"
                                                                                    onChange={(e) => handleConfigChange('api_key', e.target.value)}
                                                                                    helperText="API认证密钥 (从环境变量读取)"
                                                                                    InputProps={{ readOnly: true }}
                                                                                    sx={{ '& .MuiInputBase-input': { color: 'text.secondary' } }}
                                                                                />
                                                                            </>
                                                                        )}
                                                                    </Grid>
                                                                    <Grid item xs={12} md={6}>
                                                                        <Typography gutterBottom variant="body2">温度</Typography>
                                                                        <Stack spacing={2} direction="row" alignItems="center">
                                                                            <Slider
                                                                                value={typeof editingConfig.temperature === 'number' ? editingConfig.temperature : 0}
                                                                                onChange={(e, val) => handleConfigChange('temperature', val)}
                                                                                aria-labelledby="sentence-temperature-slider"
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
                                                                            <Chip label={(editingConfig.temperature || 0).toFixed(2)} />
                                                                        </Stack>

                                                                        {/* IndexTTS2 额外参数 */}
                                                                        {editingConfig.engine === 'indextts' && (
                                                                            <>
                                                                                <Typography gutterBottom variant="body2" sx={{ mt: 2 }}>情感权重</Typography>
                                                                                <Stack spacing={2} direction="row" alignItems="center">
                                                                                    <Slider
                                                                                        value={editingConfig.emo_weight || 0.8}
                                                                                        onChange={(e, val) => handleConfigChange('emo_weight', val)}
                                                                                        valueLabelDisplay="auto"
                                                                                        step={0.1}
                                                                                        min={0}
                                                                                        max={1.6}
                                                                                    />
                                                                                    <Chip label={(editingConfig.emo_weight || 0.8).toFixed(1)} />
                                                                                </Stack>
                                                                            </>
                                                                        )}
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
                        disableRestoreFocus
                        TransitionProps={{ onExited: handleDialogExited }}
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
                                // +++++ 使用 Flexbox 布局来并排显示播放器和速度按钮 +++++
                                <Box sx={{ 
                                    pt: 2, 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: 2, // 播放器和按钮组之间的间距
                                    flexWrap: 'wrap' // 在小屏幕上可以换行
                                }}>
                                    <Box sx={{ flexGrow: 1, minWidth: '320px' }}> {/* 让播放器占据大部分空间 */}
                                        <MiniAudioPlayer 
                                        src={currentPlayingSentence.url} 
                                        playbackRate={currentPlaybackRate} // 传递速度
                                        onEnded={handleClosePlayerDialog} 
                                        />
                                    </Box>
                                    
                                    <ToggleButtonGroup
                                        value={currentPlaybackRate}
                                        exclusive // 确保一次只能选一个
                                        onChange={handlePlaybackRateChange}
                                        aria-label="playback speed"
                                        size="small"
                                    >
                                        <ToggleButton value={1.0} aria-label="1x speed">1.0x</ToggleButton>
                                        <ToggleButton value={1.5} aria-label="1.5x speed">1.5x</ToggleButton>
                                        <ToggleButton value={2.0} aria-label="2x speed">2.0x</ToggleButton>
                                    </ToggleButtonGroup>
                                </Box>
                                // +++++++++++++++++++++++++++++++++++++++++++++++++++++++
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

            <Dialog open={editSentenceDialogOpen} disableRestoreFocus onClose={handleCloseEditSentenceDialog} maxWidth="md" fullWidth>
                <DialogTitle>
                    编辑句子 (序号: {sentenceToEdit?.order_index != null ? sentenceToEdit.order_index + 1 : ''})
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Button
                                variant={isSSMLMode ? "contained" : "outlined"}
                                size="small"
                                onClick={() => setIsSSMLMode(!isSSMLMode)}
                                startIcon={<ArticleIcon />}
                            >
                                SSML模式
                            </Button>
                            {hasSSMLTags && !isSSMLMode && (
                                <Chip 
                                    label="包含SSML标记" 
                                    size="small" 
                                    color="primary" 
                                    variant="outlined"
                                />
                            )}
                        </Box>
                        {hasSSMLTags && (
                            <Typography variant="caption" color="text.secondary">
                                预览: {getPlainTextPreview(editingSentenceText).substring(0, 30)}...
                            </Typography>
                        )}
                    </Box>
                </DialogTitle>
                <DialogContent>
                    {/* SSML工具栏 - 只在SSML模式下显示 */}
                    {isSSMLMode && (
                        <Box sx={{ 
                            mb: 2, 
                            p: 2, 
                            bgcolor: 'grey.50', 
                            border: '1px solid', 
                            borderColor: 'grey.300',
                            borderRadius: 1,
                            borderBottom: 0,
                            borderBottomLeftRadius: 0,
                            borderBottomRightRadius: 0
                        }}>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                SSML工具栏:
                            </Typography>
                            
                            {/* TTS-Server SSML兼容性警告 */}
                            {globalTtsConfig?.engine === 'tts_server' && (
                                <Box sx={{ 
                                    mb: 2, 
                                    p: 1.5, 
                                    bgcolor: 'warning.light', 
                                    borderRadius: 1,
                                    border: '1px solid',
                                    borderColor: 'warning.main'
                                }}>
                                    <Typography variant="caption" color="warning.contrastText" sx={{ fontWeight: 'bold' }}>
                                        ⚠️ 注意：TTS-Server (DashScope) 目前不支持SSML标记
                                    </Typography>
                                    <Typography variant="caption" color="warning.contrastText" sx={{ display: 'block', mt: 0.5 }}>
                                        建议使用Gemini TTS引擎以获得完整的SSML支持，或者关闭SSML模式使用纯文本
                                    </Typography>
                                </Box>
                            )}
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                {/* 基础SSML标签 */}
                                <Tooltip title="插入停顿 - <break time='500ms'/>">
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => insertBreakTag('500ms')}
                                        sx={{ minWidth: 'auto', px: 1 }}
                                    >
                                        停顿
                                    </Button>
                                </Tooltip>
                                
                                <Tooltip title="插入1秒停顿">
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => insertBreakTag('1s')}
                                        sx={{ minWidth: 'auto', px: 1 }}
                                    >
                                        1秒
                                    </Button>
                                </Tooltip>
                                
                                <Tooltip title="插入2秒停顿">
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => insertBreakTag('2s')}
                                        sx={{ minWidth: 'auto', px: 1 }}
                                    >
                                        2秒
                                    </Button>
                                </Tooltip>

                                <Tooltip title="电话号码读法 - 选中文字后点击">
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => insertSSMLTag('say-as interpret-as="telephone"')}
                                        sx={{ minWidth: 'auto', px: 1 }}
                                    >
                                        电话
                                    </Button>
                                </Tooltip>

                                <Tooltip title="数字逐个读 - 选中文字后点击">
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => insertSSMLTag('say-as interpret-as="digits"')}
                                        sx={{ minWidth: 'auto', px: 1 }}
                                    >
                                        逐字
                                    </Button>
                                </Tooltip>

                                <Tooltip title="数值读法 - 选中文字后点击">
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={() => insertSSMLTag('say-as interpret-as="cardinal"')}
                                        sx={{ minWidth: 'auto', px: 1 }}
                                    >
                                        数值
                                    </Button>
                                </Tooltip>

                                <Tooltip title="标注拼音 (支持多字符选择)">
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={handleApplyPinyin}
                                        sx={{ minWidth: 'auto', px: 1 }}
                                        startIcon={<FontDownloadIcon sx={{ fontSize: '14px !important' }} />}
                                    >
                                        注音
                                    </Button>
                                </Tooltip>

                                <Tooltip title="包裹speak标签">
                                    <Button
                                        size="small"
                                        variant="contained"
                                        color="primary"
                                        onClick={wrapWithSpeak}
                                        disabled={hasSSMLTags}
                                        sx={{ minWidth: 'auto', px: 1, ml: 1 }}
                                    >
                                        &lt;speak&gt;
                                    </Button>
                                </Tooltip>
                            </Box>
                            
                            {/* SSML使用说明 */}
                            <Box sx={{ mt: 1, p: 1, bgcolor: 'info.light', borderRadius: 1 }}>
                                <Typography variant="caption" color="info.contrastText">
                                    💡 SSML使用提示: 选中文字后点击相应按钮添加标记，或直接在文本框中编辑SSML标签
                                    {globalTtsConfig?.engine === 'tts_server' && (
                                        <span style={{ display: 'block', marginTop: '4px', fontWeight: 'bold' }}>
                                            注意：当前使用TTS-Server引擎，SSML标记将被自动转换为纯文本
                                        </span>
                                    )}
                                </Typography>
                            </Box>
                        </Box>
                    )}

                    {/* 普通工具栏 - 在非SSML模式下显示 */}
                    {!isSSMLMode && (
                        <Box sx={{ mt: 2, mb: 1 }}>
                            <Tooltip title="加粗 (选中文字后点击)">
                                <IconButton 
                                    size="small" 
                                    onClick={() => handleApplyMarkdownToSentence('**')}
                                    sx={{ border: '1px solid #ddd', borderRadius: 1 }}
                                >
                                    <FormatBoldIcon />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="标注拼音 (支持多字符选择)">
                                <IconButton size="small" onClick={handleApplyPinyin} sx={{ ml: 1, border: '1px solid #ddd', borderRadius: 1 }}>
                                    <FontDownloadIcon />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    )}

                    <Box sx={{ mt: 2, mb: 1 }}>
                        <Tooltip title="加粗 (选中文字后点击)">
                            <IconButton 
                                size="small" 
                                onClick={() => handleApplyMarkdownToSentence('**')}
                                sx={{ border: '1px solid #ddd', borderRadius: 1 }}
                            >
                                <FormatBoldIcon />
                            </IconButton>
                        </Tooltip>
                        {/* +++++ 5. 新增“标注拼音”按钮 +++++ */}
                        <Tooltip title="标注拼音 (支持多字符选择)">
                            <IconButton size="small" onClick={handleApplyPinyin} sx={{ ml: 1, border: '1px solid #ddd', borderRadius: 1 }}>
                                <FontDownloadIcon />
                            </IconButton>
                        </Tooltip>
                        {/* ++++++++++++++++++++++++++++++ */}
                        {/* 在这里可以添加更多按钮，例如：
                        <Tooltip title="斜体">
                            <IconButton size="small" onClick={() => handleApplyMarkdownToSentence('*')} sx={{ ml: 1, ... }}>
                                <FormatItalicIcon />
                            </IconButton>
                        </Tooltip>
                        */}
                    </Box>
                    {/* ++++++++++++++++++++++++++++++++ */}

                    <TextField 
                        autoFocus 
                        margin="dense" 
                        label={isSSMLMode ? "SSML内容" : "句子内容"}
                        type="text" 
                        fullWidth 
                        multiline 
                        rows={isSSMLMode ? 6 : 4}
                        value={editingSentenceText} 
                        onChange={(e) => setEditingSentenceText(e.target.value)} 
                        inputRef={editTextAreaRef}
                        placeholder={isSSMLMode ? '<speak>\n  在这里输入带SSML标记的文本...\n</speak>' : '输入句子内容...'}
                        sx={{ 
                            '& .MuiInputBase-input': {
                                fontFamily: isSSMLMode ? 'monospace' : 'inherit',
                                fontSize: isSSMLMode ? '0.875rem' : 'inherit'
                            }
                        }}
                        helperText={
                            isSSMLMode && hasSSMLTags 
                                ? `纯文本预览: ${getPlainTextPreview(editingSentenceText).substring(0, 100)}${getPlainTextPreview(editingSentenceText).length > 100 ? '...' : ''}`
                                : `字符数: ${editingSentenceText.length}`
                        }
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseEditSentenceDialog}>取消</Button>
                    <Button onClick={handleSaveEditedSentence} variant="contained">保存更改</Button>
                </DialogActions>
                {/* +++++ 6. 多音字选择菜单 +++++ */}
                <Menu
                    anchorEl={pinyinMenu.anchorEl}
                    open={Boolean(pinyinMenu.anchorEl)}
                    onClose={handleClosePinyinMenu}
                >
                    {pinyinMenu.options.map((pinyinOption, index) => (
                        <MenuItem 
                            key={`${pinyinOption}_${index}`} 
                            onClick={() => handlePinyinSelect(pinyinOption)}
                        >
                            {pinyinOption}
                        </MenuItem>
                    ))}
                </Menu>
                
                {/* +++++ 7. 多字符拼音选择对话框 +++++ */}
                <Dialog 
                    open={showPinyinPicker} 
                    onClose={handleClosePinyinPicker} 
                    maxWidth="md" 
                    fullWidth
                >
                    <DialogTitle>
                        选择拼音读音
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            为选中的文字选择正确的拼音读音: "{selectionInfo?.text}"
                        </Typography>
                    </DialogTitle>
                    <DialogContent>
                        <Box sx={{ pt: 2 }}>
                            <Grid container spacing={2}>
                                {pinyinOptions.map((option, index) => (
                                    <Grid item xs={12} sm={6} md={4} key={index}>
                                        <Box sx={{ 
                                            display: 'flex', 
                                            flexDirection: 'column', 
                                            alignItems: 'center',
                                            p: 2,
                                            border: '1px solid',
                                            borderColor: 'grey.300',
                                            borderRadius: 1,
                                            bgcolor: 'grey.50'
                                        }}>
                                            <Typography 
                                                variant="h4" 
                                                sx={{ 
                                                    mb: 1, 
                                                    fontWeight: 'bold',
                                                    color: /[\u4e00-\u9fa5]/.test(option.char) ? 'primary.main' : 'text.disabled'
                                                }}
                                            >
                                                {option.char}
                                            </Typography>
                                            {option.pinyins.length > 0 ? (
                                                <FormControl size="small" fullWidth>
                                                    <Select
                                                        value={selectedPinyins[index] || ''}
                                                        onChange={(e) => handlePinyinSelectMulti(index, e.target.value)}
                                                        displayEmpty
                                                    >
                                                        {option.pinyins.map((py) => (
                                                            <MenuItem key={py} value={py}>
                                                                {py}
                                                            </MenuItem>
                                                        ))}
                                                    </Select>
                                                </FormControl>
                                            ) : (
                                                <Typography variant="caption" color="text.disabled">
                                                    无需拼音
                                                </Typography>
                                            )}
                                        </Box>
                                    </Grid>
                                ))}
                            </Grid>
                            
                            {/* 预览区域 */}
                            <Box sx={{ mt: 3, p: 2, bgcolor: 'info.light', borderRadius: 1 }}>
                                <Typography variant="subtitle2" gutterBottom>
                                    SSML预览:
                                </Typography>
                                <Typography 
                                    variant="body2" 
                                    sx={{ 
                                        fontFamily: 'monospace',
                                        bgcolor: 'background.paper',
                                        p: 1,
                                        borderRadius: 1,
                                        border: '1px solid',
                                        borderColor: 'grey.300'
                                    }}
                                >
                                    {(() => {
                                        const pinyinArray = [];
                                        for (let i = 0; i < (selectionInfo?.text.length || 0); i++) {
                                            const char = selectionInfo?.text[i];
                                            if (/[\u4e00-\u9fa5]/.test(char) && selectedPinyins[i]) {
                                                pinyinArray.push(selectedPinyins[i]);
                                            }
                                        }
                                        const pinyinStr = pinyinArray.join(' ');
                                        if (pinyinStr) {
                                            const phonemeTag = `<phoneme alphabet="py" ph="${pinyinStr}">${selectionInfo?.text}</phoneme>`;
                                            return `<speak>\n${phonemeTag}\n</speak>`;
                                        }
                                        return '请选择拼音...';
                                    })()}
                                </Typography>
                            </Box>
                        </Box>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={handleClosePinyinPicker}>
                            取消
                        </Button>
                        <Button 
                            onClick={confirmPinyinSelection} 
                            variant="contained"
                            disabled={!Object.values(selectedPinyins).some(p => p)}
                        >
                            确认插入
                        </Button>
                    </DialogActions>
                </Dialog>
                {/* +++++++++++++++++++++++++++ */}
            </Dialog>
            <Dialog open={deleteSentenceConfirmOpen} disableRestoreFocus onClose={handleCloseDeleteSentenceDialog} maxWidth="xs" fullWidth>
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
            
            {/* 新增：插入句子对话框 */}
            <InsertSentenceDialog
                open={insertDialogOpen}
                onClose={handleCloseInsertDialog}
                onInsert={handleInsertSentences}
                referenceSentence={insertReferenceSentence}
                loading={insertLoading}
            />
        </>
    );
};
export default SentenceList;