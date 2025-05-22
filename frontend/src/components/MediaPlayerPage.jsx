// frontend/src/components/MediaPlayerPage.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, CircularProgress, Alert, Paper, IconButton,
  Select, MenuItem, FormControl, InputLabel, Slider, Grid, Tooltip,
  useTheme, useMediaQuery,Container // <<<--- 新增 useMediaQuery
} from '@mui/material';
import {
  PlayArrow, Pause, Replay10, Forward10,
  VolumeUp, VolumeOff, VolumeDown, VolumeMute,
  Fullscreen, FullscreenExit, Speed
} from '@mui/icons-material';
import api from '../api/axios';
import ReactPlayer from 'react-player';
import WaveSurfer from 'wavesurfer.js'; // <<<--- 新增导入 Wavesurfer.js
import PageHeader from './PageHeader';
import { API_BASE_URL } from '../config';
import { getToken } from '../api/auth-utils';

// 时间格式化辅助函数
const formatTime = (totalSecondsValue) => { // 参数名改为 totalSecondsValue 以示区分
  if (typeof totalSecondsValue !== 'number' || isNaN(totalSecondsValue) || totalSecondsValue < 0) {
    return '00:00'; // 默认值
  }

  const hours = Math.floor(totalSecondsValue / 3600);
  const minutes = String(Math.floor((totalSecondsValue % 3600) / 60)).padStart(2, '0');
  const seconds = String(Math.floor(totalSecondsValue % 60)).padStart(2, '0'); // 使用 Math.floor 避免小数

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
  const isMobile = useMediaQuery(theme.breakpoints.down('sm')); // 检测是否为移动设备

  const [resourceInfo, setResourceInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [canAccess, setCanAccess] = useState(false);
  // const [isFullScreen, setIsFullScreen] = useState(false);


  const isAudio = resourceInfo?.file_type === 'audio';
  const isVideo = resourceInfo?.file_type === 'video';
  
  const playerRef = useRef(null); // For ReactPlayer
  const wavesurferRef = useRef(null); // For WaveSurfer instance
  const waveformContainerRef = useRef(null); // For WaveSurfer DOM mount point
  const playerContainerRef = useRef(null); 

  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [previousVolume, setPreviousVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [playedRatio, setPlayedRatio] = useState(0);
  const [playedSeconds, setPlayedSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [hasLoggedPlay, setHasLoggedPlay] = useState(false);
  const [streamUrlWithToken, setStreamUrlWithToken] = useState('');
  // const [streamUrl, setStreamUrl] = useState(''); // 不再叫 streamUrlWithToken

  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef(null);
  const [isMediaReady, setIsMediaReady] = useState(false); // <<<--- 新增：媒体是否准备好播放的状态
  const [buffering, setBuffering] = useState(true); // <<<--- 新增：是否正在缓冲（用于初始加载）

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

  const fetchResourceDetailsAndCheckAccess = useCallback(async () => {
    // ... (与之前基本相同，确保设置 streamUrlWithToken) ...
    if (!resourceId) return;
    setLoading(true); setError('');
    try {
      const detailsRes = await api.get(`/resources/${resourceId}`);
      setResourceInfo(detailsRes.data);
      setCanAccess(true);
      const token = getToken();
      // console.log("[MediaPlayerPage fetchData] Token for stream URL:", token ? "Exists" : "NOT FOUND");
      if (token) {
        setStreamUrlWithToken(`${API_BASE_URL}/resources/${resourceId}/stream?access_token=${token}`);
      } else {
        setError("无法获取认证Token进行播放。请先登录。"); setCanAccess(false);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || '加载资源失败。');
      setCanAccess(false);
    } finally { setLoading(false); }
  }, [resourceId]);

  useEffect(() => {
    const controller = new AbortController();
    const fetchData = async () => {
        if (!resourceId) {
            setLoading(false); 
            setError("无效的资源ID。"); 
            setCanAccess(false); // <<<--- 确保这里设置了 canAccess
            return;
        }
        setLoading(true); 
        setError(''); // 清空错误
        setCanAccess(false); // <<<--- 初始设为 false
        setResourceInfo(null);
        setStreamUrlWithToken('');
        // console.log("[MediaPlayerPage fetchData] Initiated. resourceId:", resourceId); // 调试日志

        try {
            const detailsRes = await api.get(`/resources/${resourceId}`, {
                signal: controller.signal 
            });
            
            // console.log("[MediaPlayerPage fetchData] API response status:", detailsRes.status);
            // console.log("[MediaPlayerPage fetchData] API response data:", JSON.stringify(detailsRes.data, null, 2)); // 打印完整的响应数据

            // 1. 检查后端是否返回了错误结构 (例如 { "error": "some message" })
            if (detailsRes.data && typeof detailsRes.data.error === 'string') { 
                console.error("[MediaPlayerPage fetchData] Backend returned an error in data:", detailsRes.data.error);
                throw new Error(detailsRes.data.error); // 抛出错误，会被下面的 catch 捕获
            }
            
            // 2. 检查后端是否返回了表示成功的资源对象 (例如，包含 id 和 file_path)
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
                // console.log('[MediaPlayerPage fetchData] 获取资源详情请求被中止');
            } else {
                console.error("[MediaPlayerPage fetchData] Error fetching resource details or checking access:", err);
                let errMsg = err.response?.data?.error || err.message || '加载资源失败。';
                // 根据 HTTP 状态码细化错误提示
                if (err.response?.status === 403) {
                    errMsg = "您没有权限访问此资源，请联系管理员。"; // <<<--- 友好的 403 提示
                } else if (err.response?.status === 404) {
                    errMsg = "请求的资源未找到。";
                } else if (err.response?.status === 401) { 
                    errMsg = "认证失败，请刷新页面或重新登录。"; // 如果是 Token 过期等
                }
                setError(errMsg); // <<<--- 设置 error 状态
                setCanAccess(false); 
            }
        } finally {
            setLoading(false);
        }
    };

    fetchData();

    return () => {
      controller.abort(); 
    };
  }, [resourceId]);
  
  // logPlayEvent: 它的依赖项可以是它实际用到的状态
  const logPlayEvent = useCallback(async (eventData = {}) => {
    if (resourceId && !hasLoggedPlay) { // 或者您的其他记录逻辑
      try {
        const payload = {
          watch_time_seconds: Math.floor(playedSeconds),
          percentage_watched: parseFloat(playedRatio.toFixed(4)),
          ...eventData
        };
        await api.post(`/resources/${resourceId}/play-log`, payload);
        // 根据 eventData.event_type 决定是否设置 setHasLoggedPlay
        if (eventData.event_type === 'start_play' || eventData.event_type === 'milestone_reached') {
             setHasLoggedPlay(true); // 例如，这些事件后标记为已记录
        }
        // console.log("播放行为已记录:", payload);
      } catch (err) {
        console.error("记录播放行为失败:", err.response || err);
      }
    }
  }, [resourceId, hasLoggedPlay, playedSeconds, playedRatio]); // 保持这些依赖

  const [isWaveSurferReady, setIsWaveSurferReady] = useState(false);
  // --- Wavesurfer Initialization and Event Handling ---
  useEffect(() => {
    // 这个 effect 只在 resourceInfo (特别是 file_type), streamUrlWithToken, 或 waveformContainer 变化时执行
    if (resourceInfo?.file_type === 'audio' && streamUrlWithToken && waveformContainerRef.current) {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
      }
      // console.log("[WaveSurfer Init] Creating new instance with URL:", streamUrlWithToken);
      setIsMediaReady(false); // <<<--- 在加载新音频前，重置准备状态
      setBuffering(true);     // <<<--- 开始加载时，设置为正在缓冲
      const ws = WaveSurfer.create({
        container: waveformContainerRef.current,
        backend: 'MediaElement', // <<<--- 关键：使用 MediaElement 后端
        waveColor: theme.palette.mode === 'dark' ? theme.palette.grey[700] : theme.palette.grey[300],
        progressColor: theme.palette.primary.main,
        cursorWidth: 1,
        cursorColor: theme.palette.text.primary,
        // barWidth: 2,
        // barGap: 1,
        // barRadius: 10,
        responsive: true,
        height: isMobile ? 50 : 70,
        normalize: true,
        partialRender: true, // <<<--- 对于长音频，可以尝试开启部分渲染，提高初始加载速度
      });
      wavesurferRef.current = ws;
      setIsWaveSurferReady(false); // <<<--- 初始化/重置为 false


      ws.load(streamUrlWithToken);

      const onReady = () => {
        // console.log('[WaveSurfer Event] "ready", Duration:', ws.getDuration());
        setDuration(ws.getDuration());
        setIsWaveSurferReady(true); // <<<--- 在 ready 事件中设置为 true
        setIsMediaReady(true); // <<<--- 音频元数据准备好
        setBuffering(false);   // <<<--- 缓冲结束（至少初始缓冲完成）
        if (playing && ws.getDuration() > 0) { // 确保有有效时长再尝试播放
              ws.play();
          } else {
              setPlaying(false); // 如果之前是 true 但不能播放，则更新为 false
          }
      };
      const onLoading = (percent) => { // Wavesurfer 的 loading 事件可以提供加载百分比
        // console.log(`[WaveSurfer Event] "loading", Percent: ${percent}`);
        if (percent < 100) {
          setBuffering(true);
        } else {
          // 即使 percent 是 100，也最好等 'ready' 事件来确认完全准备好
        }
      };
      const onAudioProcess = (currentTime) => {
        if (!seeking && wavesurferRef.current && wavesurferRef.current.isPlaying()) { // 只在播放且非拖动时更新
          setPlayedSeconds(currentTime);
          const currentDuration = wavesurferRef.current.getDuration();
          setPlayedRatio(currentDuration > 0 ? currentTime / currentDuration : 0);
        }
      };
      const onSeek = (progress) => {
        const currentDuration = wavesurferRef.current ? wavesurferRef.current.getDuration() : duration; // 获取最新的duration
        const newTime = progress * currentDuration;
        // console.log(`[WaveSurfer Event] "seek" event. Progress: ${progress}, NewTime: ${newTime}`);
        setPlayedSeconds(newTime);
        setPlayedRatio(progress);
        setSeeking(false); // 标记 seek 完成
        // 如果 seek 后期望播放（如果之前是播放状态）
        // if (playing) wavesurferRef.current.play(); // Wavesurfer 的 seekTo 通常会自动处理播放状态
      };
      const onWsPlay = () => { 
        console.log('[WaveSurfer Event] "play" event triggered'); 
        setPlaying(true); // <<<--- 当 Wavesurfer 开始播放，设置 playing 为 true
        handlePlay(); // 调用通用的 handlePlay (用于日志等)
      };
      const onWsPause = () => { 
        console.log('[WaveSurfer Event] "pause" event triggered');
        setPlaying(false); // <<<--- 当 Wavesurfer 暂停，设置 playing 为 false
      };
      const onPlay = () => { // 这个 play 是 Wavesurfer 的事件
          setPlaying(true); // 更新 React 的 playing 状态
          // logPlayEvent 应该在这里或 handlePlay 中被调用，但要注意依赖
      };
      const onPause = () => setPlaying(false); // 更新 React 的 playing 状态
      const onFinish = () => { // 这个 finish 是 Wavesurfer 的事件
          setPlaying(false);
          // logPlayEvent({event_type: 'ended'}); // 可以在这里记录结束
          setHasLoggedPlay(false); // 允许下次播放时重新记录
          setPlayedRatio(0); 
          setPlayedSeconds(0);
          ws.seekTo(0);
      };
      const onError = (err) => {
        setError(`Wavesurfer Error: ${err}`);
        setCanAccess(false);
      };

      ws.on('ready', onReady);
      ws.on('loading', onLoading);
      ws.on('audioprocess', onAudioProcess);
      ws.on('seek', onSeek);
      ws.on('play', onPlay);
      ws.on('pause', onPause);
      ws.on('finish', onFinish);
      ws.on('error', onError);

      return () => {
        // console.log("[WaveSurfer Cleanup] Destroying instance");
        ws.unAll(); // 移除所有事件监听器
        ws.destroy();
        setIsWaveSurferReady(false);
        wavesurferRef.current = null; // 确保引用也被清除
      };
    } else if (wavesurferRef.current && resourceInfo?.file_type !== 'audio') {
        // 如果文件类型不再是音频，销毁实例
        // console.log("[WaveSurfer Cleanup] File type changed, destroying audio player.");
        wavesurferRef.current.destroy();
        wavesurferRef.current = null;
    }
  // Wavesurfer 的初始化主要依赖于 streamUrl 和容器，以及影响其外观的 theme 和 isMobile
  // resourceInfo?.file_type 决定是否创建它
  }, [resourceInfo?.file_type, streamUrlWithToken, theme.palette.primary.main, theme.palette.grey, isMobile]); 
  // ^^^ 从依赖中移除了 logPlayEvent 和 hasLoggedPlay，因为它们不应该触发 Wavesurfer 重建
  // seeking 也加入，因为 onAudioProcess 依赖它

  // --- 播放日志逻辑现在可以与 Wavesurfer 的事件或 ReactPlayer 的事件解耦 ---
  useEffect(() => {
    // 这个 effect 专门处理播放日志的触发条件
    if (playing && duration > 0 && !hasLoggedPlay) {
      if (playedSeconds > 5 || playedRatio > 0.1) { // 播放超过5秒或10%
        logPlayEvent({ event_type: 'milestone_reached' });
      }
    }
  }, [playing, duration, playedSeconds, playedRatio, hasLoggedPlay, logPlayEvent]);

  // --- ReactPlayer 事件处理 (视频) ---
  const handleReactPlayerReady = useCallback(() => { // ReactPlayer 的 onReady
    // console.log('[ReactPlayer Event] "ready"');
    setIsMediaReady(true);
    setBuffering(false); // 视频准备好
    if (playerRef.current) {
      setDuration(playerRef.current.getDuration());
    }
  }, []);

  const handleReactPlayerBuffer = useCallback(() => { // ReactPlayer 的 onBuffer
    // console.log('[ReactPlayer Event] "onBuffer" - Buffering started');
    setBuffering(true);
  }, []);

  const handleReactPlayerBufferEnd = useCallback(() => { // ReactPlayer 的 onBufferEnd
    // console.log('[ReactPlayer Event] "onBufferEnd" - Buffering ended');
    setBuffering(false);
  }, []);

  // --- Universal Playback Controls ---
  const handlePlayPause = () => {
    // console.log(
    //   `[handlePlayPause] Clicked. States before action: ` +
    //   `playing: ${playing}, isMediaReady: ${isMediaReady}, ` +
    //   `resourceInfo.file_type: ${resourceInfo?.file_type}, ` +
    //   `wavesurferRef.current exists: ${!!wavesurferRef.current}, ` +
    //   `wavesurferRef.current.isReady (if exists): ${wavesurferRef.current?.isReady}, ` + // 直接访问属性
    //   `isWaveSurferReady (state): ${isWaveSurferReady}, ` + // 我们设置的 state
    //   `playerRef.current exists: ${!!playerRef.current}`
    // );

    if (!isMediaReady) {
      console.warn("[handlePlayPause] Media not ready (isMediaReady state is false), action ignored.");
      return;
    }

    const newExpectedPlayingState = !playing;

    if (resourceInfo?.file_type === 'audio' && wavesurferRef.current && isWaveSurferReady) { // 使用 isWaveSurferReady state
      // console.log(`[handlePlayPause] Audio: Attempting to set to: ${newExpectedPlayingState ? 'play' : 'pause'}`);
      wavesurferRef.current.playPause();
    } else if (resourceInfo?.file_type === 'video' && playerRef.current) {
      // console.log(`[handlePlayPause] Video: Setting playing state to: ${newExpectedPlayingState}`);
      setPlaying(newExpectedPlayingState);
    } else {
      console.warn(
          "[handlePlayPause] No valid player branch taken. Debug info: " +
          `isAudio: ${resourceInfo?.file_type === 'audio'}, wavesurfer: ${!!wavesurferRef.current}, isWaveSurferReady: ${isWaveSurferReady}, ` +
          `isVideo: ${resourceInfo?.file_type === 'video'}, playerRef: ${!!playerRef.current}`
      );
    }
  };
  // --- 修改 Slider 的事件处理 ---
  const handleSliderChange = (event, newValue) => {
    const newRatio = parseFloat(newValue);
    if (!seeking) setSeeking(true); // 开始拖动时标记
    setPlayedRatio(newRatio); 
    if (duration > 0) { // 确保 duration 有效
        setPlayedSeconds(newRatio * duration); 
    }
  };
  
  // frontend/src/components/MediaPlayerPage.jsx

  const handleSliderSeekCommitted = (event, newValue) => {
    if (!isMediaReady || buffering) { // 如果还没准备好或正在缓冲，不允许 seek
        // console.warn("Media not ready or buffering, seek action ignored.");
        // 可以选择将滑块值重置回 playedRatio，或者给用户提示
        // 为了简单，这里只是忽略操作
        return; 
    }
    const newRatio = parseFloat(newValue);
    // console.log("[SeekCommitted] Called. newRatio:", newRatio, "wavesurferRef.current:", wavesurferRef.current);
    setSeeking(false); 
    
    if (resourceInfo?.file_type === 'audio' && wavesurferRef.current) {
      if (isWaveSurferReady && duration > 0) { // <<<--- 使用 isWaveSurferReady state
        // console.log(`[Audio SeekCommitted] Wavesurfer is ready (from state). Seeking to progress: ${newRatio}`);
        wavesurferRef.current.seekTo(newRatio);
      } else {
        // console.warn("[Audio SeekCommitted] Wavesurfer not ready (from state) or duration invalid, seekTo might not be effective.", `isReadyState: ${isWaveSurferReady}, duration: ${duration}`);
      }
    } else if (resourceInfo?.file_type === 'video' && playerRef.current && duration > 0) {
      // console.log(`[Video SeekCommitted] Calling ReactPlayer.seekTo(${newRatio}, 'fraction')`);
      playerRef.current.seekTo(newRatio, 'fraction');
    }
  };

  const handleVolumeChange = (event, newValue) => {
    const newVolume = parseFloat(newValue);
    setVolume(newVolume);
    setMuted(newVolume === 0);
    if (resourceInfo?.file_type === 'audio' && wavesurferRef.current) {
      wavesurferRef.current.setVolume(newVolume);
      wavesurferRef.current.setMute(newVolume === 0);
    }
    // ReactPlayer 的 volume prop 会自动处理
  };
  
  const handleToggleMute = () => {
    const newMuted = !muted;
    setMuted(newMuted);
    if (newMuted) {
      setPreviousVolume(volume);
      setVolume(0);
      if (resourceInfo?.file_type === 'audio' && wavesurferRef.current) wavesurferRef.current.setMute(true);
    } else {
      const volToRestore = previousVolume > 0 ? previousVolume : 0.5;
      setVolume(volToRestore);
      if (resourceInfo?.file_type === 'audio' && wavesurferRef.current) {
        wavesurferRef.current.setMute(false);
        wavesurferRef.current.setVolume(volToRestore);
      }
    }
  };

  const handlePlaybackRateChange = (event) => {
    const rate = parseFloat(event.target.value);
    // console.log("[MediaPlayerPage] Playback rate changed to:", rate); // <<<--- 添加日志
    setPlaybackRate(rate);
    if (resourceInfo?.file_type === 'audio' && wavesurferRef.current) {
      wavesurferRef.current.setPlaybackRate(rate);
    }
    if (isVideo && playerRef.current) {
      const internalPlayer = playerRef.current.getInternalPlayer();
      if (internalPlayer && typeof internalPlayer.playbackRate === 'number') {
        internalPlayer.playbackRate = rate; // rate 是新选择的倍速
        // console.log("[MediaPlayerPage] Directly set internal player playbackRate in fullscreen to:", rate, "Actual:", internalPlayer.playbackRate);
      }
    }
    // ReactPlayer 的 playbackRate prop 会自动处理
  };

  const handleSeekChange = (event, newValue) => { // For Slider (0-1 range)
    const newRatio = parseFloat(newValue);
    setPlayedRatio(newRatio);
    const newTime = newRatio * duration;
    setPlayedSeconds(newTime);
    if (resourceInfo?.file_type === 'audio' && wavesurferRef.current) {
      if (!seeking) setSeeking(true); // 标记开始拖动
      wavesurferRef.current.seekTo(newRatio);
    } else if (playerRef.current) {
      if (!seeking) setSeeking(true);
      playerRef.current.seekTo(newRatio);
    }
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
  const handlePlay = () => { 
    console.log("[Common handlePlay] Player has started playing.");
    // setPlaying(true); // 这个应该由具体的播放器 onPlay 事件来设置，以确保同步
    if (!hasLoggedPlay) { 
        logPlayEvent({event_type: 'start_play'});
    }
  };
  const handleEnded = () => {
    setPlaying(false);
    logPlayEvent({event_type: 'ended'});
    setHasLoggedPlay(false);
    setPlayedRatio(0); // 播放结束后重置进度
    setPlayedSeconds(0);
    if (resourceInfo?.file_type === 'audio' && wavesurferRef.current) {
        wavesurferRef.current.seekTo(0); // WaveSurfer 也回到开头
    }
  };

  const handleFastForward = () => {
    const newTime = Math.min(playedSeconds + 10, duration);
    if (resourceInfo?.file_type === 'audio' && wavesurferRef.current) {
      wavesurferRef.current.seekTo(newTime / duration);
    } else if (playerRef.current) {
      playerRef.current.seekTo(newTime);
    }
    setPlayedSeconds(newTime);
    setPlayedRatio(duration > 0 ? newTime / duration : 0);
  };

  const handleRewind = () => {
    const newTime = Math.max(playedSeconds - 10, 0);
    if (resourceInfo?.file_type === 'audio' && wavesurferRef.current) {
      wavesurferRef.current.seekTo(newTime / duration);
    } else if (playerRef.current) {
      playerRef.current.seekTo(newTime);
    }
    setPlayedSeconds(newTime);
    setPlayedRatio(duration > 0 ? newTime / duration : 0);
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

  // ... (showControls, hideControls, useEffect for controls visibility 保持不变) ...
// 自动隐藏控件的逻辑
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
    if (playing && isVideo) {
      hideControls(); // 开始播放时，启动隐藏控件的计时器
    } else {
      showControls(); // 暂停时，显示控件并清除计时器
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    }
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [playing,isVideo]);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}><CircularProgress /></Box>;
  }
  if (error) {
    return <Container sx={{py:3}}><Alert severity="error">{error}</Alert></Container>;
  }
  
 
  // if (!canAccess || !resourceInfo || !streamUrlWithToken) { // 确保 streamUrlWithToken 有值
  if (!canAccess || !resourceInfo) { // 确保 streamUrlWithToken 有值
      // ... (loading 和 error 显示逻辑)
      if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}><CircularProgress /></Box>; // 应该在上面处理了
      if (error) return <Container sx={{py:3}}><Alert severity="error">{error}</Alert></Container>; // 应该在上面处理了
       // 如果 canAccess 是 false，但没有 error，也应该给个提示
      if (!canAccess && !error) return <Container sx={{py:3}}><Alert severity="warning">您可能没有权限访问此资源或资源不存在。</Alert></Container>;
       // 如果 resourceInfo 没有加载，即使没有错误，也提示
      if (!resourceInfo && !error) return <Container sx={{py:3}}><Alert severity="info">正在加载资源信息...</Alert></Container>;
  }
  if (!streamUrlWithToken && canAccess && resourceInfo) {
      return <Container sx={{py:3}}><Alert severity="info">正在准备播放链接...</Alert></Container>;
  }
  
  // console.log("[MediaPlayerPage Render States]", { 
  //   loading, 
  //   error, 
  //   canAccess, 
  //   resourceInfoExists: !!resourceInfo, 
  //   streamUrlExists: !!streamUrlWithToken,
  //   isMediaReady, // <<<--- 关键
  //   buffering     // <<<--- 关键
  // });

  return (
    <Box 
      sx={{
        // p: { xs: 1, sm: 2, md: 3 }, // 可以考虑将整体页面的 padding 减小或移除
        pt: { xs: 1, sm: 2 }, // 只保留顶部和底部的一些间距
        pb: { xs: 1, sm: 2 },
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center',
        width: '100%', // 确保 Box 占满宽度
        minHeight: 'calc(100vh - 56px)', // 减去可能的底部导航栏高度 (如果您的应用有的话)
                                        // 或者使用 100vh 如果没有固定页脚
        boxSizing: 'border-box'
      }}
    >
       
      <Typography variant={isMobile ? "h5" : "h4"} gutterBottom sx={{mt: 2, textAlign:'center'}}>{resourceInfo?.name}</Typography>
      
      <Paper 
        elevation={3} 
        ref={playerContainerRef}
        onMouseMove={showControls}
        onMouseLeave={hideControlsIfVideoPlaying} // <<<--- 修改这里

        sx={{ 
            width: '100%', 
            maxWidth: '960px', 
            bgcolor: '#000', 
            borderRadius: '8px', 
            overflow: 'hidden',
            position: 'relative',
        }}
      >
        {/* 播放器区域 */}
        {isAudio && (
          <Box 
          className="player-area-wrapper" // 给一个类名
          ref={waveformContainerRef} 
          sx={{ 
            position: 'relative', 
            width: '100%', 
            height: isMobile ? '60px' : '80px', 
            p: isMobile ? 1: 0, 
            boxSizing: 'border-box' ,
            paddingTop: isVideo ? '56.25%' : '0',
            height: isAudio ? (isMobile ? '60px' : '80px') : 'auto',
            backgroundColor: '#000', // 播放器区域背景
          }} />
        )}
        {isVideo && waveformContainerRef && (
          <Box className="player-wrapper" sx={{ position: 'relative', paddingTop: '56.25%' }}>
            <ReactPlayer
              ref={playerRef}
              className="react-player"
              url={streamUrlWithToken}
              playing={playing}
              controls={false} 
              volume={volume}
              muted={muted}
              playbackRate={playbackRate}
              onPlay={handlePlay}
              onPause={() => setPlaying(false)}
              onEnded={handleEnded}
              onError={handleError}
              onProgress={handleProgress}
              onDuration={handleDuration}
              onReady={handleReactPlayerReady} // <<<--- 监听 onReady
              onBuffer={handleReactPlayerBuffer} // <<<--- 监听 onBuffer
              onBufferEnd={handleReactPlayerBufferEnd} // <<<--- 监听 onBufferEnd
              width="100%"
              height="100%"
              style={{ position: 'absolute', top: 0, left: 0 }}
              config={{ file: { attributes: { controlsList: 'nodownload' }}}}
            />
            {/* 缓冲提示层 */}
            {(buffering || !isMediaReady) && streamUrlWithToken && ( // 只有当 streamUrl 有了才可能缓冲
              <Box 
                sx={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: 'rgba(0,0,0,0.7)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  zIndex: 2, 
                  textAlign: 'center', // 确保文字居中
                  padding: 2 // 给一点内边距
                }}
              >
                <CircularProgress color="inherit" size={isMobile ? 30 : 40} sx={{ mb: 2 }} /> {/* 增加底部边距 */}
                <Typography variant="body1"> {/* 使用 body1 可能更清晰 */}
                  {loading ? '媒体加载中...' : // 如果 fetchData 还在 loading
                    (isMediaReady && buffering ? '正在缓冲...' : // 已 ready 但仍在缓冲
                      (!isMediaReady && streamUrlWithToken ? '正在准备播放器...' : // 未 ready 但已开始加载流
                        '请稍候...' // 其他情况
                      )
                    )
                  }
                </Typography>
              </Box>
            )}
          </Box>
        )}
        
        {/* 自定义控件 - 只有当 isMediaReady 且控件可见时才启用 */}
        <Box 
            sx={{ 
                p: isMobile ? 1 : 1.5, 
                backgroundColor: 'rgba(0,0,0,0.7)', 
                color: 'white',
                position: isVideo ? 'absolute' : 'relative', // 视频时绝对定位，音频时相对定位
                bottom: isVideo ? 0 : 'auto',
                left: 0,
                right: 0,
                opacity: (isVideo && !controlsVisible) ? 0 : 1, // <<<--- 确保只在视频且 controlsVisible 为 false 时才隐藏
                visibility: (isVideo && !controlsVisible) ? 'hidden' : 'visible', // <<<--- 配合 opacity
                transition: 'opacity 0.3s ease-in-out, visibility 0.3s ease-in-out',
                zIndex: 3,
                pointerEvents: (!isMediaReady || buffering) ? 'none' : 'auto', 
                filter: (!isMediaReady || buffering) ? 'grayscale(80%) opacity(0.7)' : 'none',
            }}
        >
          {/* 进度条 (通用) */}
          <Grid container spacing={isMobile ? 1 : 2} alignItems="center" sx={{mb: isMobile ? 0.5 : 1}}>
            <Grid item xs>
              <Slider
                value={playedRatio} // 使用 0-1 的比例值
                disabled={!isMediaReady || buffering}  // <<<--- 禁用 Slider
                min={0} max={1} step={0.0001}
                onChange={handleSliderChange} // onChange 实时更新播放器
                onChangeCommitted={handleSliderSeekCommitted} // <<<--- 使用 onChangeCommitted

                onMouseDown={handleSeekMouseDown}
                onMouseUp={handleSeekMouseUp}
                aria-labelledby="playback-progress-slider"
                sx={{ /* ... 样式 ... */ height: isMobile ? 2 : 4, padding: '13px 0' }}
              />
            </Grid>
            <Grid item>
              <Typography variant="caption" sx={{minWidth: isMobile? '70px' : '85px', textAlign: 'right', fontSize: isMobile ? '0.7rem' : '0.75rem'}}>
                {formatTime(playedSeconds)} / {formatTime(duration)}
              </Typography>
            </Grid>
          </Grid>
          {/* 控制按钮 (通用) */}
          <Grid container spacing={isMobile ? 0.5 : 1} alignItems="center" justifyContent="space-between" wrap="nowrap">
            <Grid item sx={{display: 'flex', alignItems: 'center'}}>
              <Tooltip title="后退10秒"><IconButton onClick={handleRewind} color="inherit" size={isMobile ? "small" : "medium"}><Replay10 /></IconButton></Tooltip>
              <IconButton onClick={handlePlayPause} disabled={!isMediaReady || buffering} color="inherit" size={isMobile ? "small" : "large"}>{playing ? <Pause /> : <PlayArrow />}</IconButton>
              <Tooltip title="快进10秒"><IconButton onClick={handleFastForward} color="inherit" size={isMobile ? "small" : "medium"}><Forward10 /></IconButton></Tooltip>
            </Grid>
            <Grid item sx={{display: 'flex', alignItems: 'center', flexWrap: 'nowrap'}}>
                <Tooltip title={muted || volume === 0 ? "取消静音" : "静音"}>
                    <IconButton onClick={handleToggleMute} color="inherit" size="small">
                        {muted || volume === 0 ? <VolumeOff /> : (volume < 0.1 ? <VolumeMute /> : (volume < 0.6 ? <VolumeDown /> : <VolumeUp />) )}
                    </IconButton>
                </Tooltip>
                <Slider 
                    value={muted ? 0 : volume} 
                    min={0} max={1} step={0.01} 
                    onChange={handleVolumeChange} 
                    aria-labelledby="volume-slider"
                    sx={{width: isMobile ? 50 : 70, /* ... */ mx: isMobile ? 0.5 : 1}} 
                />
                <FormControl size="small" variant="standard" sx={{ minWidth: isMobile ? 60 : 70, mx: isMobile ? 0.5 : 1 }}>
                    <Select 
                      value={playbackRate} 
                      onChange={handlePlaybackRateChange} 
                      onClick={() => console.log("Select clicked in fullscreen!")}
                      MenuProps={{
                        container: playerContainerRef.current 
                      }}
                      sx={{fontSize: isMobile ? '0.75rem' : '0.8rem'}}
                      disableUnderline
                    >
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => (
                        <MenuItem key={rate} value={rate} sx={{fontSize: isMobile ? '0.75rem' : '0.8rem'}}>{rate}x</MenuItem>
                        ))}
                    </Select>
                </FormControl>
                 {isVideo && ( // 全屏只对视频有意义
                     <Tooltip title="全屏">
                        <IconButton onClick={handleToggleFullscreen} color="inherit" size="small">
                            {document.fullscreenElement ? <FullscreenExit /> : <Fullscreen />}
                        </IconButton>
                     </Tooltip>
                 )}
            </Grid>
          </Grid>
          {(buffering || !isMediaReady) && streamUrlWithToken && ( // 只有当 streamUrl 有了才可能缓冲
          <Box 
                sx={{
                  position: 'absolute',
                  top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: 'rgba(0,0,0,0.7)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  zIndex: 2, 
                  textAlign: 'center', // 确保文字居中
                  padding: 2 // 给一点内边距
                }}
              >
                <CircularProgress color="inherit" size={isMobile ? 30 : 40} sx={{ mb: 2 }} /> {/* 增加底部边距 */}
                <Typography variant="body1"> {/* 使用 body1 可能更清晰 */}
                  {loading ? '媒体加载中...' : // 如果 fetchData 还在 loading
                    (isMediaReady && buffering ? '正在缓冲...' : // 已 ready 但仍在缓冲
                      (!isMediaReady && streamUrlWithToken ? '正在准备播放器...' : // 未 ready 但已开始加载流
                        '请稍候...' // 其他情况
                      )
                    )
                  }
                </Typography>
              </Box>
          )}
        </Box>
      </Paper>
      {/* AI 对话框 (需求4) */}
    </Box>
  );
};

export default MediaPlayerPage;