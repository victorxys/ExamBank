// frontend/src/components/MediaPlayerPage.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, CircularProgress, Alert, Paper, IconButton,
  Select, MenuItem, FormControl, InputLabel, Slider, Grid, Tooltip, Chip,
  useTheme, useMediaQuery, Container
} from '@mui/material';
import { Accordion, AccordionSummary, AccordionDetails, List, ListItem, ListItemText, ListItemAvatar, Avatar, Divider, TablePagination } from '@mui/material'; // <<<--- 新增 Accordion 相关和 List/Avatar
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'; // 用于 Accordion
import PersonIcon from '@mui/icons-material/Person'; // 用于显示用户头像或图标

import {
  PlayArrow, Pause, Replay10, Forward10,
  VolumeUp, VolumeOff, VolumeDown, VolumeMute,
  Fullscreen, FullscreenExit, Speed
} from '@mui/icons-material';
import api from '../api/axios';
import ReactPlayer from 'react-player';
// WaveSurfer and its related refs/states are removed
import PageHeader from './PageHeader'; // 确保路径正确
import { API_BASE_URL } from '../config'; // 确保路径正确
// getToken is not directly used for streamUrl anymore, but might be for other things
import { getToken } from '../api/auth-utils'; 
import { jwtDecode } from 'jwt-decode'; // <<<--- 新增导入

import { format, parseISO, isValid, isFuture, differenceInDays, differenceInHours, differenceInMinutes } from 'date-fns';
import { zhCN } from 'date-fns/locale';


// 时间格式化辅助函数
const formatTime = (totalSecondsValue) => {
  if (typeof totalSecondsValue !== 'number' || isNaN(totalSecondsValue) || totalSecondsValue < 0) {
    return '00:00';
  }
  const hours = Math.floor(totalSecondsValue / 3600);
  const minutes = String(Math.floor((totalSecondsValue % 3600) / 60)).padStart(2, '0');
  const seconds = String(Math.floor(totalSecondsValue % 60)).padStart(2, '0');
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${minutes}:${seconds}`;
  } else {
    return `${minutes}:${seconds}`;
  }
};

const MediaPlayerPage = () => {
  const { courseId, resourceId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [resourceInfo, setResourceInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canAccess, setCanAccess] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  
  const playerRef = useRef(null); // For ReactPlayer (audio and video)
  const playerContainerRef = useRef(null); 

  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [previousVolume, setPreviousVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.3);
  const [playedRatio, setPlayedRatio] = useState(0);
  const [playedSeconds, setPlayedSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [hasLoggedPlay, setHasLoggedPlay] = useState(false);
  // const [streamUrl, setStreamUrl] = useState(''); // URL for ReactPlayer (no token in query)
  const [streamUrlWithToken, setStreamUrlWithToken] = useState('');

  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef(null);
  const [isMediaReady, setIsMediaReady] = useState(false);
  const [buffering, setBuffering] = useState(true);

  const [userRole, setUserRole] = useState(null);
  useEffect(() => {
    const token = getToken(); // 获取当前存储的 access_token
    if (token) {
      try {
        const decodedToken = jwtDecode(token); // 解码 Token
        setUserRole(decodedToken?.role);
        console.log("[MediaPlayerPage] User role from decoded JWT:", decodedToken?.role);
      } catch (e) {
        console.error("Failed to decode JWT", e);
      }
    } else {
        console.warn("[MediaPlayerPage] No JWT token found to decode role.");
    }
  }, []); // 只在挂载时执行

  const [playHistory, setPlayHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyPage, setHistoryPage] = useState(0); // 分页状态
  const [historyRowsPerPage, setHistoryRowsPerPage] = useState(10); // 每页10条
  const [historyTotal, setHistoryTotal] = useState(0);
  const [showPlayHistory, setShowPlayHistory] = useState(false); // 控制是否显示历史记录

  const isAudio = resourceInfo?.file_type === 'audio';
  const isVideo = resourceInfo?.file_type === 'video';
  useEffect(() => {
    const handleActualFullscreenChange = () => {
      const currentFullScreenState = !!(
        document.fullscreenElement || document.webkitFullscreenElement ||
        document.mozFullScreenElement || document.msFullscreenElement
      );
      setIsFullScreen(currentFullScreenState);
    };
    document.addEventListener('fullscreenchange', handleActualFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleActualFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleActualFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleActualFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleActualFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleActualFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleActualFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleActualFullscreenChange);
    };
  }, []);

  const fetchPlayHistory = useCallback(async (pageToFetch = 0, rows = 10) => {
    if (!resourceId || (userRole !== 'admin' && userRole !== 'teacher')) {
      setPlayHistory([]);
      return;
    }
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await api.get(`/resources/${resourceId}/play-history`, {
        params: {
          page: pageToFetch + 1, // API 是 1-based page
          per_page: rows
        }
      });
      setPlayHistory(response.data.logs || []);
      setHistoryTotal(response.data.total || 0);
      setHistoryPage(response.data.page -1); // 更新当前页 (0-based)
      setHistoryRowsPerPage(response.data.per_page || rows);
    } catch (err) {
      console.error("获取播放历史失败:", err);
      setHistoryError(err.response?.data?.error || err.message || "获取播放历史失败。");
    } finally {
      setHistoryLoading(false);
    }
  }, [resourceId, userRole]);

  // 当资源ID变化或者显示历史记录的开关变化时，获取第一页数据
  useEffect(() => {
    if (showPlayHistory && resourceId && (userRole === 'admin' || userRole === 'teacher')) {
      fetchPlayHistory(0, historyRowsPerPage); // 默认加载第一页
    } else {
      setPlayHistory([]); // 如果不显示或无权限，清空历史
    }
  }, [showPlayHistory, resourceId, userRole, fetchPlayHistory, historyRowsPerPage]); // 添加依赖

  const handleChangeHistoryPage = (event, newPage) => {
    fetchPlayHistory(newPage, historyRowsPerPage);
  };

  const handleChangeHistoryRowsPerPage = (event) => {
    const newRowsPerPage = parseInt(event.target.value, 10);
    fetchPlayHistory(0, newRowsPerPage); // 切换每页行数时回到第一页
  };

  useEffect(() => {
    const controller = new AbortController();
    const fetchData = async () => {
        if (!resourceId) {
            setLoading(false); setError("无效的资源ID。"); setCanAccess(false);
            return;
        }
        setLoading(true); setError('');
        setCanAccess(false); setResourceInfo(null);
        setStreamUrlWithToken(''); setIsMediaReady(false); setBuffering(true);
        console.log("[MediaPlayerPage fetchData] Initiated. resourceId:", resourceId);

        try {
            const detailsRes = await api.get(`/resources/${resourceId}`, { signal: controller.signal });
            console.log("[MediaPlayerPage fetchData] API response status:", detailsRes.status);
            console.log("[MediaPlayerPage fetchData] API response data:", JSON.stringify(detailsRes.data, null, 2));

            if (detailsRes.data && typeof detailsRes.data.error === 'string') { 
                throw new Error(detailsRes.data.error);
            }
            if (detailsRes.data && detailsRes.data.id && detailsRes.data.file_path) {
                setResourceInfo(detailsRes.data);
                setCanAccess(true); // <<<--- 关键：只有在获取到有效资源信息后才设置为 true
                // console.log("[MediaPlayerPage fetchData] Resource info set, canAccess set to true.");
                
                const token = getToken();
                // console.log("[MediaPlayerPage fetchData] Token for stream URL:", token ? "Exists" : "NOT FOUND");
                if (token) {
                    const streamUrlWithToken = `${API_BASE_URL}/resources/${resourceId}/stream?access_token=${token}`;
                    setStreamUrlWithToken(streamUrlWithToken);
                    // console.log("[MediaPlayerPage fetchData] Stream URL set:", streamUrlWithToken);
                } else {
                    // 如果没有 token，即使获取了资源信息，也无法播放受保护的流
                    setError("无法获取认证Token进行播放。请确保您已登录。");
                    setCanAccess(false); // <<<--- 没有 token，播放权限也应视为 false
                    // console.warn("[MediaPlayerPage fetchData] No token found, cannot play protected stream.");
                }
            } else {
                // 后端返回了200 OK，但响应体不是预期的资源对象
                console.error("[MediaPlayerPage fetchData] Resource data from API is not valid or missing essential fields (id, file_path):", detailsRes.data);
                throw new Error("从服务器获取的资源数据格式不正确或不完整。");
            }
        } catch (err) {
            if (err.name === 'CanceledError' || err.name === 'AbortError') {
                console.log('[MediaPlayerPage fetchData] 获取资源详情请求被中止');
            } else {
                console.error("[MediaPlayerPage fetchData] Error fetching resource details or access:", err);
                let errMsg = err.response?.data?.error || err.message || '加载资源失败。';
                if (err.response?.status === 403) errMsg = "您没有权限访问此资源，请联系管理员。";
                else if (err.response?.status === 404) errMsg = "请求的资源未找到。";
                else if (err.response?.status === 401) errMsg = "认证失败，请刷新页面或重新登录。";
                setError(errMsg);
                setCanAccess(false); 
            }
        } finally {
            setLoading(false);
        }
    };
    fetchData();
    return () => { controller.abort(); };
  }, [resourceId]);
  
  const logPlayEvent = useCallback(async (eventData = {}) => {
    if (resourceId && !hasLoggedPlay) { // Or adjust logic for multiple logs if needed
      try {
        const payload = {
          watch_time_seconds: Math.floor(playedSeconds),
          percentage_watched: parseFloat(playedRatio.toFixed(4)),
          ...eventData
        };
        await api.post(`/resources/${resourceId}/play-log`, payload);
        if (eventData.event_type === 'start_play' || eventData.event_type === 'milestone_reached') {
             setHasLoggedPlay(true);
        }
        console.log("播放行为已记录:", payload);
      } catch (err) {
        console.error("记录播放行为失败:", err.response || err);
      }
    }
  }, [resourceId, hasLoggedPlay, playedSeconds, playedRatio]);

  useEffect(() => {
    if (playing && duration > 0 && !hasLoggedPlay) {
      if (playedSeconds > 5 || playedRatio > 0.1) {
        logPlayEvent({ event_type: 'milestone_reached' });
      }
    }
  }, [playing, duration, playedSeconds, playedRatio, hasLoggedPlay, logPlayEvent]);

  const handleReactPlayerReady = useCallback(() => {
    console.log('[ReactPlayer Event] "onReady"');
    setIsMediaReady(true);
    setBuffering(false);
    if (playerRef.current) {
      const currentDuration = playerRef.current.getDuration();
      if (currentDuration && currentDuration > 0) {
        setDuration(currentDuration);
      }
    }
    // No autoplay by default
  }, []);

  const handleReactPlayerBuffer = useCallback(() => { setBuffering(true); }, []);
  const handleReactPlayerBufferEnd = useCallback(() => { setBuffering(false); }, []);
  
  const handlePlay = () => { 
    setPlaying(true); 
    if (!hasLoggedPlay) { logPlayEvent({event_type: 'start_play'}); }
  };
  const handlePauseFromPlayer = () => { setPlaying(false); };
  const handleEnded = () => { 
    setPlaying(false); 
    logPlayEvent({event_type: 'ended'});
    setHasLoggedPlay(false); // Allow re-logging if played again
    setPlayedRatio(0);
    setPlayedSeconds(0);
    if (playerRef.current) playerRef.current.seekTo(0, 'fraction');
  };
  const handleReactPlayerError = (e) => { 
    console.error('ReactPlayer Error:', e);
    let displayErrorMessage = `无法播放媒体，请稍后重试。`;
    if (typeof e === 'object' && e !== null && e.type) {
        displayErrorMessage = `媒体播放错误: ${e.type}`;
    } else if (typeof e === 'string') {
        displayErrorMessage = `媒体播放错误: ${e}`;
    }
    if (error && (error.toLowerCase().includes("权限") || error.toLowerCase().includes("认证"))) {
        displayErrorMessage = error; 
    }
    setError(displayErrorMessage);
    setCanAccess(false); 
    setPlaying(false); 
  };
  const handleReactPlayerProgress = (state) => { 
    if (!seeking) {
      setPlayedRatio(state.played);
      setPlayedSeconds(state.playedSeconds);
    }
  };
  const handleReactPlayerDuration = (d) => { 
    if (d && d > 0) { setDuration(d); }
  };

  const handlePlayPause = () => {
    if (!isMediaReady) { console.warn("[handlePlayPause] Media not ready"); return; }
    setPlaying(!playing);
  };
  
  const handleVolumeChange = (event, newValue) => { 
    const newVolume = parseFloat(newValue);
    setVolume(newVolume);
    setMuted(newVolume === 0);
  };
  const handleToggleMute = () => { 
    const newMuted = !muted;
    setMuted(newMuted);
    if (newMuted) {
      setPreviousVolume(volume);
      setVolume(0);
    } else {
      setVolume(previousVolume > 0 ? previousVolume : 0.5);
    }
  };
  const handlePlaybackRateChange = (event) => { 
    const rate = parseFloat(event.target.value);
    setPlaybackRate(rate);
    if (isFullScreen && playerRef.current) { // Special handling for some internal players in fullscreen
        const internalPlayer = playerRef.current.getInternalPlayer();
        if (internalPlayer && typeof internalPlayer.playbackRate === 'number') {
          internalPlayer.playbackRate = rate;
        }
    }
  };

  const handleSliderChange = (event, newValue) => {
    const newRatio = parseFloat(newValue);
    if (!seeking) setSeeking(true);
    setPlayedRatio(newRatio); 
    if (duration > 0) { setPlayedSeconds(newRatio * duration); }
  };
  const handleSeekMouseDown = () => setSeeking(true);
  const handleSeekMouseUp = () => { // For Slider, after drag ends
    setSeeking(false);
    // seekTo 已经在 onChange (handleSeekChange) 中处理了
  };

  const handleProgress = (state) => { // For ReactPlayer
    if (!seeking) {
      setPlayedRatio(state.played);
      setPlayedSeconds(state.playedSeconds);
    }
    if (playing && !hasLoggedPlay && duration > 0 && (state.playedSeconds > 5 || state.played > 0.1)) {
        logPlayEvent({event_type: 'milestone_reached'});
    }
  };
  // --- 确保 handleError 函数在这里定义 ---
  const handleError = (e) => { // 这个是用于 ReactPlayer 的
     console.error('ReactPlayer Error:', e); // 打印原始错误对象
     let displayErrorMessage = `无法播放媒体，请稍后重试。`;
     
     // ReactPlayer的错误对象 e 可能比较复杂，不一定直接包含 HTTP 状态码
     // 它的 `type` 属性可能指示错误类型，例如 'networkError', 'mediaError'
     // 我们可以尝试从 ReactPlayer 的错误中提取一些信息，或者依赖之前获取详情时设置的 error state
     
     if (typeof e === 'object' && e !== null) {
        if (e.type) {
            displayErrorMessage = `媒体播放错误: ${e.type}`;
        }
        // 如果 e 是一个更复杂的对象，可以尝试查找更具体的错误信息
        // 例如 e.playerError?.message 或类似
     } else if (typeof e === 'string') {
        displayErrorMessage = `媒体播放错误: ${e}`;
     }

     // 如果在获取资源详情时已经有权限错误，优先显示那个
     if (error && (error.toLowerCase().includes("权限") || error.toLowerCase().includes("认证"))) {
        // setError(error); // 如果 error state 已经设置了权限相关的，就不覆盖它
        // 或者，如果想统一错误提示：
        displayErrorMessage = error; // 使用之前 fetchResourceDetailsAndCheckAccess 设置的错误
     }
     
     setError(displayErrorMessage);
     setCanAccess(false); // 发生播放错误，也认为无法继续访问
     setPlaying(false); // 停止播放状态
  };
  // --- handleError 函数定义结束 ---
  const handleDuration = (d) => setDuration(d);
  
  // 通用的 handlePlay (由播放器实际开始播放时触发的事件调用)

 
  const handleSliderSeekCommitted = (event, newValue) => {
    if (!isMediaReady || buffering) { return; }
    const newRatio = parseFloat(newValue);
    setSeeking(false); 
    if (playerRef.current && duration > 0) {
      console.log(`[SeekCommitted] Calling ReactPlayer.seekTo(${newRatio}, 'fraction')`);
      playerRef.current.seekTo(newRatio, 'fraction');
    } else {
      console.warn("[SeekCommitted] ReactPlayer not ready or duration invalid for seek.");
    }
  };

  const handleFastForward = () => { 
    if (playerRef.current && duration > 0) {
      const newTime = Math.min(playedSeconds + 10, duration);
      playerRef.current.seekTo(newTime / duration, 'fraction');
      setPlayedSeconds(newTime);
      setPlayedRatio(newTime / duration);
    }
  };
  const handleRewind = () => { 
    if (playerRef.current && duration > 0) {
      const newTime = Math.max(playedSeconds - 10, 0);
      playerRef.current.seekTo(newTime / duration, 'fraction');
      setPlayedSeconds(newTime);
      setPlayedRatio(newTime / duration);
    }
  };
  
  const handleToggleFullscreen = async () => {
    const elem = playerContainerRef.current;
    if (!elem) return;

    const currentFullScreenState = !!(document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement);

    if (!currentFullScreenState) { // 如果当前不是全屏，则请求全屏并尝试横屏
      try {
        if (elem.requestFullscreen) { await elem.requestFullscreen(); }
        else if (elem.mozRequestFullScreen) { await elem.mozRequestFullScreen(); }
        // ... (其他浏览器前缀)

        // 进入全屏后，尝试锁定到横屏 (仅在支持且可能的情况下)
        // if (screen.orientation && typeof screen.orientation.lock === 'function') {
        //   try {
        //     await screen.orientation.lock('landscape-primary');
        //     console.log('Screen orientation locked to landscape.');
        //   } catch (err) {
        //     console.warn(`Could not lock screen orientation: ${err.message}`);
        //     // 即使无法锁定方向，全屏请求本身可能已经成功
        //   }
        // } else {
        //   console.warn('Screen Orientation API or lock() method not supported.');
        // }
      } catch (err_fullscreen) {
        console.error(`Error attempting to enable full-screen: ${err_fullscreen.message}`);
      }
    } else { // 如果当前是全屏，则退出全屏并尝试解锁方向
      try {
        if (document.exitFullscreen) { await document.exitFullscreen(); }
        // else if (document.mozCancelFullScreen) { await document.mozCancelFullScreen(); }
        // // ... (其他浏览器前缀)

        // // 退出全屏后，尝试解锁屏幕方向 (如果之前锁定了)
        // if (screen.orientation && typeof screen.orientation.unlock === 'function') {
        //   screen.orientation.unlock();
        //   console.log('Screen orientation unlocked.');
        // }
      } catch (err_exit_fullscreen) {
         console.error(`Error attempting to exit full-screen: ${err_exit_fullscreen.message}`);
      }
    }
  };

  // 监听全屏变化事件，以同步按钮图标 (可选但推荐)
  useEffect(() => {
    const handleActualFullscreenChange = () => {
      const currentFullScreenState = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
      setIsFullScreen(currentFullScreenState); // <<<--- 更新 isFullScreen state
      // console.log("Fullscreen state changed to (event listener):", currentFullScreenState);
    };
    // if (!currentFullScreenState && screen.orientation && typeof screen.orientation.unlock === 'function') {
    //     // 只有在之前明确锁定了方向，或者想要确保恢复默认时才调用 unlock
    //     screen.orientation.unlock(); 
    // }
    document.addEventListener('fullscreenchange', handleActualFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleActualFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleActualFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleActualFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleActualFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleActualFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleActualFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleActualFullscreenChange);
    };
  }, []); // 空依赖，只在挂载和卸载时执行

  const hideControls = () => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      // 只有在视频播放且鼠标没有悬停在播放器容器上时才隐藏
      // （鼠标悬停的逻辑是通过 playerContainerRef 的 onMouseMove/onMouseLeave 处理的）
      if (playing && isVideo) { 
        setControlsVisible(false);
      }
    }, 3000); 
  };
  const hideControlsIfVideoPlaying = () => {
      if (isVideo && playing) {
          hideControls();
      }
  };
  const showControls = () => {
  if (controlsTimeoutRef.current) {
    clearTimeout(controlsTimeoutRef.current);
  }
  setControlsVisible(true);
  if (playing && isVideo) { // 如果正在播放视频，重新设置隐藏计时器 (这部分可以保留)
    hideControls();
  }
};

  useEffect(() => {
    if (playing && isVideo) hideControls();
    else { showControls(); if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current); }
    return () => { if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current); };
  }, [playing, isVideo]);
  
  const formatExpiryDisplay = (isoString) => {
    if (!isoString) return "长期有效";
    const expiryDate = parseISO(isoString);
    if (!isValid(expiryDate)) return "长期有效 (日期无效)";

    if (isFuture(expiryDate)) {
      const now = new Date();
      const days = differenceInDays(expiryDate, now);
      if (days > 7) {
        return `至 ${format(expiryDate, 'yyyy-MM-dd HH:mm', { locale: zhCN })}`;
      } else if (days > 0) {
        return `剩余 ${days}天 (至 ${format(expiryDate, 'MM-dd HH:mm')})`;
      } else {
        const hours = differenceInHours(expiryDate, now);
        if (hours > 0) return `剩余 ${hours}小时`;
        const minutes = differenceInMinutes(expiryDate, now);
        return minutes > 0 ? `剩余 ${minutes}分钟` : "即将过期";
      }
    } else {
      return `已于 ${format(expiryDate, 'yyyy-MM-dd HH:mm', { locale: zhCN })} 过期`;
    }
  };

  if (loading) { return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}><CircularProgress /></Box>; }
  if (error) { return <Container sx={{py:3, textAlign: 'center'}}><Alert severity="error" sx={{mb:2}}>{error}</Alert>{resourceInfo?.user_access_expires_at && (<Typography variant="caption" color="text.secondary" component="div" sx={{mt:1}}>资源有效期: {formatExpiryDisplay(resourceInfo.user_access_expires_at)}</Typography>)}<Button variant="outlined" onClick={() => navigate(-1)} sx={{mt:2}}>返回</Button></Container>; }
  if (!canAccess || !resourceInfo) { 
       if (!error) {
           return <Container sx={{py:3}}><Alert severity="warning">您可能没有权限访问此资源或资源不存在。</Alert><Button variant="outlined" onClick={() => navigate(-1)} sx={{mt:2}}>返回</Button></Container>;
       }
  }
  if (!streamUrlWithToken && canAccess && resourceInfo) {
      return <Container sx={{py:3}}><Alert severity="info">正在准备播放链接...</Alert></Container>;
  }
  


  if (canAccess && resourceInfo && streamUrlWithToken) {
    return ( 
      <Box sx={{ pt: { xs: 1, sm: 2 }, pb: { xs: 1, sm: 2 }, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', minHeight: 'calc(100vh - 56px)', boxSizing: 'border-box' }}>
        <Typography variant={isMobile ? "h6" : "h4"} gutterBottom sx={{mt: 2, textAlign:'center'}}>{resourceInfo?.name}</Typography>
        {resourceInfo.user_access_expires_at && ( // 显示有效期 Chip
            <Chip label={`授权有效期: ${formatExpiryDisplay(resourceInfo.user_access_expires_at)}`} size="small"
                color={!isFuture(parseISO(resourceInfo.user_access_expires_at)) ? "error" : "info"}
                variant="outlined" sx={{ fontWeight: 'medium', mb: 2 }} />
        )}
        
        <Paper elevation={isMobile ? 0 : 3} ref={playerContainerRef} onMouseMove={showControls} onMouseLeave={hideControlsIfVideoPlaying}
          sx={{ width: '100%', maxWidth: '960px', bgcolor: '#000', borderRadius: isMobile ? 0 : '8px', overflow: 'hidden', position: 'relative'}}>
          
          {/* 播放器区域统一使用 ReactPlayer */}
          <Box className="player-wrapper" 
            sx={{ position: 'relative', 
                  paddingTop: isVideo ? '56.25%' : '0', // 视频保持宽高比
                  height: isAudio ? (isMobile? '50px' : '150px') : 'auto', // 音频给固定高度
                  backgroundColor: '#000' }}>
            <ReactPlayer
              ref={playerRef} className="react-player" url={streamUrlWithToken} playing={playing} controls={false} 
              volume={volume} muted={muted} playbackRate={playbackRate}
              onPlay={handlePlay} onPause={handlePauseFromPlayer} onEnded={handleEnded}
              onError={handleReactPlayerError} onProgress={handleReactPlayerProgress}
              onDuration={handleReactPlayerDuration} onReady={handleReactPlayerReady}
              onBuffer={handleReactPlayerBuffer} onBufferEnd={handleReactPlayerBufferEnd}
              width="100%" height="100%" 
              style={{ position: isVideo ? 'absolute' : 'relative', top: 0, left: 0 }}
              config={{ file: { 
                  attributes: { controlsList: 'nodownload' },
                  forceAudio: isAudio, 
                  forceVideo: isVideo,
              }}}
            />
            {/* 缓冲提示层 */}
            {(buffering || !isMediaReady) && streamUrlWithToken && resourceInfo && (
              <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white',
                  zIndex: 2, textAlign: 'center', padding: 2 }}>
                <CircularProgress color="inherit" size={isMobile ? 30 : 40} sx={{ mb: 2 }} />
                <Typography variant="body1">
                  {loading ? '媒体加载中...' : (isMediaReady && buffering ? '正在缓冲...' : (!isMediaReady && streamUrlWithToken ? '正在准备播放器...' : '请稍候...'))}
                </Typography>
              </Box>
            )}
          </Box>
          
          {/* 自定义控件 */}
          <Box sx={{ p: isMobile ? 1 : 1.5, backgroundColor: 'rgba(0, 0, 0, 0.7)', color: 'white',
                position: (isVideo || (isAudio && !isMobile) ) ? 'absolute' : 'relative', // 音频在非移动端也覆盖，移动端在下方
                bottom: (isVideo || (isAudio && !isMobile) ) ? 0 : 'auto',
                left: 0, right: 0, 
                opacity: (isVideo && !controlsVisible) ? 0 : 1,
                visibility: (isVideo && !controlsVisible) ? 'hidden' : 'visible',
                transition: 'opacity 0.3s ease-in-out, visibility 0.3s ease-in-out',
                zIndex: 3,
                // height: isMobile ? 60 : 200,
                pointerEvents: (!isMediaReady || buffering) ? 'none' : 'auto', 
                filter: (!isMediaReady || buffering) ? 'grayscale(80%) opacity(0.7)' : 'none',
            }}>
            {/* 进度条 */}
            <Grid container spacing={isMobile ? 2 : 4} alignItems="center" sx={{ mb: isMobile ? 0.5 : 1}}>
              <Grid item xs><Slider value={playedRatio} disabled={!isMediaReady || buffering} min={0} max={1} step={0.0001}
                  onChange={handleSliderChange} onChangeCommitted={handleSliderSeekCommitted}
                  onMouseDown={handleSeekMouseDown} onMouseUp={handleSeekMouseUp}
                  sx={{ height: isMobile ? 2 : 4, padding: '13px 0' }}/>
              </Grid>
              <Grid item><Typography variant="caption" sx={{minWidth: isMobile? '70px' : '85px', textAlign: 'right', fontSize: isMobile ? '0.7rem' : '0.75rem'}}>
                  {formatTime(playedSeconds)} / {formatTime(duration)}</Typography>
              </Grid>
            </Grid>
            {/* 控制按钮 */}
            <Grid container spacing={isMobile ? 0.5 : 1} alignItems="center" justifyContent="space-between" wrap="nowrap">
              <Grid item sx={{display: 'flex', alignItems: 'center'}}>
                <Tooltip title="后退10秒"><span><IconButton onClick={handleRewind} disabled={!isMediaReady || buffering} color="inherit" size={isMobile ? "small" : "medium"}><Replay10 /></IconButton></span></Tooltip>
                <IconButton onClick={handlePlayPause} disabled={!isMediaReady || buffering} color="inherit" size={isMobile ? "small" : "large"}>{playing ? <Pause /> : <PlayArrow />}</IconButton>
                <Tooltip title="快进10秒"><span><IconButton onClick={handleFastForward} disabled={!isMediaReady || buffering} color="inherit" size={isMobile ? "small" : "medium"}><Forward10 /></IconButton></span></Tooltip>
              </Grid>
              <Grid item sx={{display: 'flex', alignItems: 'center', flexWrap: 'nowrap'}}>
                  <Tooltip title={muted || volume === 0 ? "取消静音" : "静音"}>
                    <span>
                      <IconButton onClick={handleToggleMute} disabled={!isMediaReady || buffering} color="inherit" size="small">
                      {muted || volume === 0 ? <VolumeOff /> : (volume < 0.1 ? <VolumeMute /> : (volume < 0.6 ? <VolumeDown /> : <VolumeUp />) )}</IconButton>
                    </span>
                  </Tooltip>
                  <Slider value={muted ? 0 : volume} disabled={!isMediaReady || buffering} min={0} max={1} step={0.01} onChange={handleVolumeChange}
                      sx={{width: isMobile ? 50 : 70, mx: isMobile ? 0.5 : 1}} />
                  <FormControl size="small" variant="standard" sx={{ minWidth: isMobile ? 60 : 70, mx: isMobile ? 0.5 : 1 }}>
                      <Select value={playbackRate} onChange={handlePlaybackRateChange} disabled={!isMediaReady || buffering}
                          MenuProps={{ container: playerContainerRef.current }}
                          sx={{fontSize: isMobile ? '0.75rem' : '0.8rem', color: 'white', '&:before': {borderColor: 'rgba(255,255,255,0.42)'}, '&:after': {borderColor: 'white'}, '.MuiSvgIcon-root': { color: 'white'}}}
                          disableUnderline>
                          {[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => (
                          <MenuItem key={rate} value={rate} sx={{fontSize: isMobile ? '0.75rem' : '0.8rem'}}>{rate}x</MenuItem>
                          ))}
                      </Select>
                  </FormControl>
                   {isVideo && (
                       <Tooltip title={isFullScreen ? "退出全屏" : "全屏"}>
                        <span>
                          <IconButton onClick={handleToggleFullscreen} disabled={!isMediaReady || buffering} color="inherit" size="small">
                           {isFullScreen ? <FullscreenExit /> : <Fullscreen />}</IconButton>
                        </span>
                       </Tooltip>
                   )}
              </Grid>
            </Grid>
          </Box>
        </Paper>
        {/* --- 新增：播放历史记录区域 --- */}
        {(userRole === 'admin' || userRole === 'teacher') && resourceId && (
          <Paper elevation={2} sx={{ width: '100%', maxWidth: '960px', mt: 3, mb: 2 }}>
            <Accordion expanded={showPlayHistory} onChange={() => setShowPlayHistory(!showPlayHistory)}>
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                aria-controls="play-history-content"
                id="play-history-header"
              >
                <Typography variant="h6">播放记录 ({historyTotal} 条)</Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}> {/* 移除AccordionDetails的默认padding */}
                {historyLoading && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}><CircularProgress size={24} /></Box>
                )}
                {historyError && !historyLoading && (
                  <Alert severity="error" sx={{ m: 2 }}>{historyError}</Alert>
                )}
                {!historyLoading && !historyError && playHistory.length === 0 && (
                  <Typography sx={{ p: 2, textAlign: 'center' }} color="textSecondary">暂无播放记录。</Typography>
                )}
                {!historyLoading && !historyError && playHistory.length > 0 && (
                  <List dense sx={{ width: '100%', bgcolor: 'background.paper', pt:0 }}>
                    {playHistory.map((log) => (
                      <React.Fragment key={log.log_id}>
                        <ListItem alignItems="flex-start">
                          <ListItemAvatar sx={{mt:0.5}}>
                            <Avatar sx={{ bgcolor: theme.palette.secondary.light, color: theme.palette.secondary.contrastText }}>
                              <PersonIcon />
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText
                            primary={
                              <Typography variant="body2">
                                用户: <strong>{log.user_real_name || log.username || log.user_id.substring(0,8)}</strong>
                              </Typography>
                            }
                            secondary={
                              <>
                                <Typography component="span" variant="caption" color="textSecondary">
                                  播放于: {log.played_at ? format(parseISO(log.played_at), 'yyyy-MM-dd HH:mm:ss', { locale: zhCN }) : '未知时间'}
                                </Typography>
                                <br />
                                {log.watch_time_seconds !== null && (
                                  <Typography component="span" variant="caption" color="textSecondary">
                                    {resourceInfo?.file_type === 'audio' ? '收听时长' : '观看时长'}: {formatTime(log.watch_time_seconds)} 
                                  </Typography>
                                )}
                                {log.percentage_watched !== null && (
                                  <Typography component="span" variant="caption" color="textSecondary" sx={{ml:1}}>
                                    | {resourceInfo?.file_type === 'audio' ? '收听比例' : '观看比例'}: {(log.percentage_watched * 100).toFixed(1)}%
                                  </Typography>
                                )}
                              </>
                            }
                          />
                        </ListItem>
                        <Divider variant="inset" component="li" />
                      </React.Fragment>
                    ))}
                  </List>
                )}
                {/* 分页控件 */}
                {historyTotal > 0 && !historyLoading && !historyError && (
                    <TablePagination
                        component="div"
                        count={historyTotal}
                        page={historyPage}
                        onPageChange={handleChangeHistoryPage}
                        rowsPerPage={historyRowsPerPage}
                        onRowsPerPageChange={handleChangeHistoryRowsPerPage}
                        rowsPerPageOptions={[5, 10, 20, 50]}
                        labelRowsPerPage="每页条数:"
                        sx={{borderTop: '1px solid rgba(224, 224, 224, 1)'}}
                    />
                )}
              </AccordionDetails>
            </Accordion>
          </Paper>
        )}
        {/* --- 播放历史记录区域结束 --- */}
      </Box>
    );
  }

  return <Container sx={{py:3}}><Alert severity="info">正在加载播放器...</Alert></Container>;
};

export default MediaPlayerPage;