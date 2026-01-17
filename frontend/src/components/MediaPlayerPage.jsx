// frontend/src/components/MediaPlayerPage.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';

import {
  Box, Typography, CircularProgress, Alert, Paper, IconButton,
  Select, MenuItem, FormControl, InputLabel, Slider, Grid, Tooltip, Chip,
  useTheme, useMediaQuery, Container, Button
} from '@mui/material';
import { Accordion, AccordionSummary, AccordionDetails, List, ListItem, ListItemText, ListItemAvatar, Avatar, Divider, TablePagination } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PersonIcon from '@mui/icons-material/Person';
import { PlayArrow, Pause, Replay10, Forward10, VolumeUp, VolumeOff, VolumeDown, VolumeMute, Fullscreen, FullscreenExit, Speed } from '@mui/icons-material';

import api from '../api/axios';
import ReactPlayer from 'react-player';
import PageHeader from './PageHeader';
import { API_BASE_URL } from '../config';
import { getToken } from '../api/auth-utils';
import { jwtDecode } from 'jwt-decode';
import Hls from 'hls.js';
import { getVideoUrl, isQiniuVideoUrl, isHLSUrl } from '../utils/videoUtils';

import { format, parseISO, isValid, isFuture, differenceInDays, differenceInHours, differenceInMinutes, differenceInSeconds } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import './MediaPlayerPage.css'; // <--- 1. 引入一个新的 CSS 文件



// 时间格式化辅助函数 (转换为 HH:MM:SS)
const formatSecondsToHHMMSS = (totalSecondsValue) => {
  if (typeof totalSecondsValue !== 'number' || isNaN(totalSecondsValue) || totalSecondsValue < 0) {
    return '00:00:00';
  }
  const hours = Math.floor(totalSecondsValue / 3600);
  const minutes = String(Math.floor((totalSecondsValue % 3600) / 60)).padStart(2, '0');
  const seconds = String(Math.floor(totalSecondsValue % 60)).padStart(2, '0');
  return `${String(hours).padStart(2, '0')}:${minutes}:${seconds}`;
};


// 时间格式化辅助函数 (转换为 MM:SS)
const formatTime = (totalSecondsValue) => {
  if (typeof totalSecondsValue !== 'number' || isNaN(totalSecondsValue) || totalSecondsValue < 0) {
    return '00:00';
  }
  const minutes = String(Math.floor(totalSecondsValue / 60)).padStart(2, '0');
  const seconds = String(Math.floor(totalSecondsValue % 60)).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const HEARTBEAT_INTERVAL = 30;

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

  const playerRef = useRef(null);
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

  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef(null);
  const [isMediaReady, setIsMediaReady] = useState(false);
  const [buffering, setBuffering] = useState(true);

  const [userRole, setUserRole] = useState(null);
  const [userId, setUserId] = useState(null);

  const [streamUrlWithToken, setStreamUrlWithToken] = useState('');
  const [hlsInstance, setHlsInstance] = useState(null);
  const [useHLS, setUseHLS] = useState(false);

  const [sessionId, setSessionId] = useState(null);
  const heartbeatTimerRef = useRef(null);

  const isAudio = resourceInfo?.file_type === 'audio';
  const isVideo = resourceInfo?.file_type === 'video';

  useEffect(() => {
    const token = getToken();
    if (token) {
      try {
        const decodedToken = jwtDecode(token);
        setUserRole(decodedToken?.role);
        setUserId(decodedToken?.sub);
      } catch (e) {
        console.error("Failed to decode JWT", e);
      }
    } else {
      console.warn("[MediaPlayerPage] No JWT token found.");
    }
    setSessionId(uuidv4());
  }, [resourceId]);

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

  const [groupedPlayHistory, setGroupedPlayHistory] = useState([]);
  const [rawPlayHistory, setRawPlayHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyPage, setHistoryPage] = useState(0);
  const [historyRowsPerPage, setHistoryRowsPerPage] = useState(10);
  const [historyTotalGroups, setHistoryTotalGroups] = useState(0);
  const [showPlayHistory, setShowPlayHistory] = useState(false);

  const groupLogsBySession = useCallback((logs) => {
    if (!logs || logs.length === 0) return [];
    const sessionsMap = new Map();

    logs.forEach(log => {
      const sessionKey = `${log.user_id}_${log.session_id || 'NULL_SESSION'}`; // Use a placeholder for null session_id

      if (!sessionsMap.has(sessionKey)) {
        sessionsMap.set(sessionKey, {
          id: sessionKey,
          userId: log.user_id,
          username: log.username || log.user_id?.substring(0, 8), // Fallback to part of user_id if username is missing
          sessionId: log.session_id || null,
          startTime: log.played_at,
          latestTime: log.played_at,
          latestWatchTimeSeconds: log.watch_time_seconds || 0,
          latestPercentageWatched: log.percentage_watched || 0,
          eventTypes: new Set([log.event_type]),
          rawLogsCount: 1,
        });
      } else {
        const existingSession = sessionsMap.get(sessionKey);
        if (log.played_at && (!existingSession.startTime || new Date(log.played_at) < new Date(existingSession.startTime))) {
          existingSession.startTime = log.played_at;
        }
        if (log.played_at && (!existingSession.latestTime || new Date(log.played_at) >= new Date(existingSession.latestTime))) { // Use >= to capture the very latest progress
          existingSession.latestTime = log.played_at;
          existingSession.latestWatchTimeSeconds = log.watch_time_seconds !== null ? log.watch_time_seconds : existingSession.latestWatchTimeSeconds;
          existingSession.latestPercentageWatched = log.percentage_watched !== null ? log.percentage_watched : existingSession.latestPercentageWatched;
        }
        existingSession.eventTypes.add(log.event_type);
        existingSession.rawLogsCount++;
      }
    });

    const groupedSessions = Array.from(sessionsMap.values()).map(session => {
      const startDate = parseISO(session.startTime);
      const latestDate = parseISO(session.latestTime);
      let sessionDurationSeconds = 0;
      if (isValid(startDate) && isValid(latestDate)) {
        sessionDurationSeconds = differenceInSeconds(latestDate, startDate);
      }
      return {
        ...session,
        eventTypes: Array.from(session.eventTypes),
        sessionDurationSeconds: sessionDurationSeconds,
      };
    });

    groupedSessions.sort((a, b) => {
      if (!a.latestTime) return 1;
      if (!b.latestTime) return -1;
      return new Date(b.latestTime) - new Date(a.latestTime);
    });
    return groupedSessions;
  }, []);

  const fetchAllPlayHistoryForGrouping = useCallback(async () => {
    if (!resourceId || (userRole !== 'admin' && userRole !== 'teacher')) {
      setGroupedPlayHistory([]);
      setHistoryTotalGroups(0);
      return;
    }
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await api.get(`/resources/${resourceId}/play-history`, {
        params: { page: 1, per_page: 1000 } // Fetch a large number of records
      });
      if (!response.data || !Array.isArray(response.data.logs)) {
        throw new Error("无效的播放历史数据格式");
      }
      setRawPlayHistory(response.data.logs);
      const grouped = groupLogsBySession(response.data.logs);
      setGroupedPlayHistory(grouped);
      setHistoryTotalGroups(grouped.length);
    } catch (err) {
      console.error("获取所有播放历史失败:", err);
      setHistoryError(err.response?.data?.error || err.message || "获取播放历史失败。");
      setGroupedPlayHistory([]);
      setHistoryTotalGroups(0);
    } finally {
      setHistoryLoading(false);
    }
  }, [resourceId, userRole, groupLogsBySession]);

  useEffect(() => {
    if (showPlayHistory) {
      fetchAllPlayHistoryForGrouping();
    } else {
      setGroupedPlayHistory([]);
      setHistoryTotalGroups(0);
      setHistoryPage(0);
      setHistoryRowsPerPage(10);
    }
  }, [showPlayHistory, fetchAllPlayHistoryForGrouping]);

  const handleChangeHistoryPage = (event, newPage) => {
    setHistoryPage(newPage);
  };

  const handleChangeHistoryRowsPerPage = (event) => {
    const newRowsPerPage = parseInt(event.target.value, 10);
    setHistoryRowsPerPage(newRowsPerPage);
    setHistoryPage(0);
  };

  const logPlayEvent = useCallback(async (event_type, eventData = {}) => {
    if (!resourceId || !userId || !sessionId) {
      console.warn("Cannot log play event: Missing resourceId, userId, or sessionId.");
      return;
    }
    try {
      const payload = {
        session_id: sessionId,
        event_type: event_type,
        watch_time_seconds: Math.floor(playedSeconds),
        percentage_watched: parseFloat(playedRatio.toFixed(4)),
        ...eventData
      };
      await api.post(`/resources/${resourceId}/play-log`, payload);
      // console.log(`Play log recorded: Event='${event_type}', Session='${sessionId}', Time=${payload.watch_time_seconds}s, Percent=${payload.percentage_watched}%`);
      if (showPlayHistory && (userRole === 'admin' || userRole === 'teacher')) {
         setTimeout(() => {
             fetchAllPlayHistoryForGrouping();
         }, 500);
      }
    } catch (err) {
      console.error(`Failed to log play event '${event_type}':`, err.response || err);
    }
  }, [resourceId, userId, sessionId, playedSeconds, playedRatio, showPlayHistory, userRole, fetchAllPlayHistoryForGrouping]);

  useEffect(() => {
    if (playing && sessionId) {
      heartbeatTimerRef.current = setInterval(() => {
        logPlayEvent('heartbeat');
      }, HEARTBEAT_INTERVAL * 1000);
      // console.log(`Heartbeat timer started for session ${sessionId}, interval ${HEARTBEAT_INTERVAL}s.`);
    } else {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
        // console.log(`Heartbeat timer stopped for session ${sessionId}.`);
      }
    }
    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
        // console.log(`Heartbeat timer cleared on unmount for session ${sessionId}.`);
      }
    };
  }, [playing, sessionId, logPlayEvent]);

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
        setUseHLS(false);
        
        // Cleanup previous HLS instance
        if (hlsInstance) {
            hlsInstance.destroy();
            setHlsInstance(null);
        }
        
        // console.log("[MediaPlayerPage fetchData] Initiated. resourceId:", resourceId);

        try {
            const detailsRes = await api.get(`/resources/${resourceId}`, { signal: controller.signal });
            // console.log("[MediaPlayerPage fetchData] API response status:", detailsRes.status);
            // console.log("[MediaPlayerPage fetchData] API response data:", JSON.stringify(detailsRes.data, null, 2));

            if (detailsRes.data && typeof detailsRes.data.error === 'string') {
                throw new Error(detailsRes.data.error);
            }

            if (detailsRes.data && detailsRes.data.id && detailsRes.data.file_path && detailsRes.data.can_access_now) {
                setResourceInfo(detailsRes.data);
                setCanAccess(true);
                // console.log("[MediaPlayerPage fetchData] Resource info set, canAccess set to true.");

                // Get video information from backend to determine streaming method
                try {
                    const videoInfoRes = await api.get(`/resources/${resourceId}/qiniu-info`);
                    const videoInfo = videoInfoRes.data;
                    
                    if (videoInfo.is_qiniu) {
                        // For Qiniu Cloud videos, use HLS streaming
                        const hlsUrl = videoInfo.recommended_url || videoInfo.direct_hls_url;
                        setStreamUrlWithToken(hlsUrl);
                        setUseHLS(true);
                        console.log("[MediaPlayerPage fetchData] Qiniu Cloud video detected, HLS URL set:", hlsUrl);
                    } else {
                        // For local videos, use the existing token-based streaming
                        let streamUrl = videoInfo.recommended_url || videoInfo.stream_url;
                        // Handle relative URLs properly
                        if (streamUrl.startsWith('/')) {
                            // For relative URLs starting with /, add the API_BASE_URL
                            streamUrl = `${API_BASE_URL}${streamUrl}`;
                        } else if (!streamUrl.startsWith('http')) {
                            // For other relative URLs, add the full API_BASE_URL with /
                            streamUrl = `${API_BASE_URL}/${streamUrl}`;
                        }
                        setStreamUrlWithToken(streamUrl);
                        setUseHLS(false);
                        console.log("[MediaPlayerPage fetchData] Local stream URL set:", streamUrl);
                    }
                } catch (videoInfoError) {
                    console.warn("[MediaPlayerPage fetchData] Failed to get video info, falling back to legacy method:", videoInfoError);
                    
                    // Fallback to legacy method
                    const filePath = detailsRes.data.file_path;
                    const isQiniuVideo = isQiniuVideoUrl(filePath);
                    
                    if (isQiniuVideo) {
                        // For Qiniu Cloud videos, convert to HLS URL
                        const hlsUrl = getVideoUrl(filePath);
                        setStreamUrlWithToken(hlsUrl);
                        setUseHLS(isHLSUrl(hlsUrl));
                        console.log("[MediaPlayerPage fetchData] Fallback: Qiniu Cloud video detected, HLS URL set:", hlsUrl);
                    } else {
                        // For local videos, use the existing token-based streaming
                        const token = getToken();
                        if (token) {
                            const streamUrl = `${API_BASE_URL}/resources/${resourceId}/stream?access_token=${token}`;
                            setStreamUrlWithToken(streamUrl);
                            setUseHLS(false);
                            console.log("[MediaPlayerPage fetchData] Fallback: Local stream URL set:", streamUrl);
                        } else {
                            setError("无法获取认证Token进行播放。请确保您已登录。");
                            setCanAccess(false);
                            console.warn("[MediaPlayerPage fetchData] No token found, cannot play protected stream.");
                        }
                    }
                }
            } else if (detailsRes.data && !detailsRes.data.can_access_now) {
                 const expiryMsg = detailsRes.data.user_access_expires_at ? `已于 ${format(parseISO(detailsRes.data.user_access_expires_at), 'yyyy-MM-dd HH:mm', { locale: zhCN })} 过期。` : '您没有当前访问权限。';
                 setError(`权限过期或不足。${expiryMsg}`);
                 setCanAccess(false);
                 setResourceInfo(detailsRes.data);
                 console.warn("[MediaPlayerPage fetchData] User has no current access permission.");
            } else {
                console.error("[MediaPlayerPage fetchData] Resource data from API is not valid or missing essential fields (id, file_path, can_access_now):", detailsRes.data);
                throw new Error("从服务器获取的资源数据格式不正确或不完整。");
            }
        } catch (err) {
            if (err.name === 'CanceledError' || err.name === 'AbortError') {
                console.log('[MediaPlayerPage fetchData] 获取资源详情请求被中止');
            } else {
                console.error("[MediaPlayerPage fetchData] Error fetching resource details or access:", err.response || err);
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

  // Cleanup HLS instance on unmount
  useEffect(() => {
    return () => {
      if (hlsInstance) {
        hlsInstance.destroy();
        setHlsInstance(null);
      }
    };
  }, [hlsInstance]);

  const handleReactPlayerReady = useCallback(() => {
    // console.log('[ReactPlayer Event] "onReady"');
    setIsMediaReady(true);
    setBuffering(false);
    if (playerRef.current) {
      const currentDuration = playerRef.current.getDuration();
      if (currentDuration && currentDuration > 0) {
        setDuration(currentDuration);
      }
    }
  }, []);

  const handleReactPlayerBuffer = useCallback(() => { setBuffering(true); }, []);
  const handleReactPlayerBufferEnd = useCallback(() => { setBuffering(false); }, []);

  const handlePlay = () => {
    setPlaying(true);
    logPlayEvent('start_play');
  };
  const handlePauseFromPlayer = () => {
    setPlaying(false);
    logPlayEvent('paused');
  };
  const handleEnded = () => {
    setPlaying(false);
    logPlayEvent('ended');
    setPlayedRatio(0);
    setPlayedSeconds(0);
    if (playerRef.current) playerRef.current.seekTo(0, 'fraction');
  };
  const handleReactPlayerError = (e) => {
    console.error('ReactPlayer Error:', e);
    let displayErrorMessage = `无法播放媒体，请稍后重试。`;
    
    // Handle HLS-specific errors
    if (useHLS && e && typeof e === 'object') {
      if (e.type === 'hlsError' || e.message?.includes('HLS')) {
        displayErrorMessage = `HLS视频流播放错误，请检查网络连接或稍后重试。`;
      } else if (e.type === 'networkError') {
        displayErrorMessage = `网络连接错误，无法加载视频流。`;
      }
    }
    
    if (typeof e === 'object' && e !== null) {
      if (e.type) {
        displayErrorMessage = `媒体播放错误: ${e.type}`;
      }
    } else if (typeof e === 'string') {
      displayErrorMessage = `媒体播放错误: ${e}`;
    }
    
    if (error && (error.toLowerCase().includes("权限") || error.toLowerCase().includes("认证"))) {
      displayErrorMessage = error;
    } else if (e && typeof e === 'object' && e.message && (e.message.toLowerCase().includes("401") || e.message.toLowerCase().includes("403"))) {
      displayErrorMessage = "权限不足或认证失败，请刷新页面或重新登录。";
      console.error("ReactPlayer reported potential HTTP permission error:", e.message);
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
    if (isFullScreen && playerRef.current) {
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
  const handleSeekMouseUp = () => {
    setSeeking(false);
  };
  const handleSliderSeekCommitted = (event, newValue) => {
    if (!isMediaReady || buffering) { return; }
    const newRatio = parseFloat(newValue);
    setSeeking(false);
    if (playerRef.current && duration > 0) {
      // console.log(`[SeekCommitted] Calling ReactPlayer.seekTo(${newRatio}, 'fraction')`);
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
    const currentFullScreenState = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
    if (!currentFullScreenState) {
      try {
        if (elem.requestFullscreen) { await elem.requestFullscreen(); }
        else if (elem.mozRequestFullScreen) { await elem.mozRequestFullScreen(); }
      } catch (err_fullscreen) {
        console.error(`Error attempting to enable full-screen: ${err_fullscreen.message}`);
      }
    } else {
      try {
        if (document.exitFullscreen) { await document.exitFullscreen(); }
      } catch (err_exit_fullscreen) {
         console.error(`Error attempting to exit full-screen: ${err_exit_fullscreen.message}`);
      }
    }
  };

  useEffect(() => {
    const handleActualFullscreenChange = () => {
      const currentFullScreenState = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
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

  const hideControls = () => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => { if (playing && isVideo) setControlsVisible(false); }, 3000);
  };
  const hideControlsIfVideoPlaying = () => { if (isVideo && playing) hideControls(); };
  const showControls = () => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    setControlsVisible(true);
    if (playing && isVideo) hideControls();
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
      if (days > 7) return `至 ${format(expiryDate, 'yyyy-MM-dd HH:mm', { locale: zhCN })}`;
      if (days > 0) return `剩余 ${days}天 (至 ${format(expiryDate, 'MM-dd HH:mm', { locale: zhCN })})`;
      const hours = differenceInHours(expiryDate, now);
      if (hours > 0) return `剩余 ${hours}小时`;
      const minutes = differenceInMinutes(expiryDate, now);
      return minutes > 0 ? `剩余 ${minutes}分钟` : "即将过期";
    }
    return `已于 ${format(expiryDate, 'yyyy-MM-dd HH:mm', { locale: zhCN })} 过期`;
  };

  const paginatedGroupedHistory = useMemo(() => {
      const startIndex = historyPage * historyRowsPerPage;
      const endIndex = startIndex + historyRowsPerPage;
      return groupedPlayHistory.slice(startIndex, endIndex);
  }, [groupedPlayHistory, historyPage, historyRowsPerPage]);

  if (loading) { return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}><CircularProgress /></Box>; }
  if (error && !resourceInfo) {
      return <Container sx={{py:3, textAlign: 'center'}}><Alert severity="error" sx={{mb:2}}>{error}</Alert><Button variant="outlined" onClick={() => navigate(-1)} sx={{mt:2}}>返回</Button></Container>;
  }
  if (!canAccess && resourceInfo) {
       return <Container sx={{py:3, textAlign: 'center'}}><Alert severity="warning" sx={{mb:2}}>{error || "您没有权限访问此资源。"}</Alert>
         {resourceInfo?.user_access_expires_at && (<Typography variant="caption" color="text.secondary" component="div" sx={{mt:1}}>资源有效期: {formatExpiryDisplay(resourceInfo.user_access_expires_at)}</Typography>)}
       <Button variant="outlined" onClick={() => navigate(-1)} sx={{mt:2}}>返回</Button></Container>;
  }
  if (!streamUrlWithToken && canAccess && resourceInfo) {
      return <Container sx={{py:3}}><Alert severity="info">正在准备播放链接...</Alert></Container>;
  }

  if (canAccess && resourceInfo && streamUrlWithToken) {
    return (
      <Box sx={{ pt: { xs: 1, sm: 2 }, pb: { xs: 1, sm: 2 }, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', minHeight: 'calc(100vh - 56px)', boxSizing: 'border-box' }}>
        <Typography variant={isMobile ? "h6" : "h4"} gutterBottom sx={{mt: 2, textAlign:'center'}}>{resourceInfo?.name}</Typography>

        {resourceInfo?.user_access_expires_at && (
             <Chip
              label={`授权有效期: ${formatExpiryDisplay(resourceInfo.user_access_expires_at)}`}
              size="small"
              color={resourceInfo.user_access_expires_at && !isFuture(parseISO(resourceInfo.user_access_expires_at)) ? "error" : "info"}
              variant="outlined"
              sx={{ fontWeight: 'medium', mb: 1 }}
            />
        )}

        {/* Video streaming type indicator */}
        {streamUrlWithToken && (
          <Box sx={{ display: 'flex', gap: 1, mb: 2, justifyContent: 'center' }}>
            <Chip
              label={useHLS ? "HLS流媒体" : "本地视频"}
              size="small"
              color={useHLS ? "success" : "default"}
              variant="outlined"
              sx={{ fontSize: '0.75rem' }}
            />
            {useHLS && (
              <Chip
                label="七牛云"
                size="small"
                color="primary"
                variant="outlined"
                sx={{ fontSize: '0.75rem' }}
              />
            )}
          </Box>
        )}

        <Paper 
          elevation={isMobile ? 0 : 3} 
          ref={playerContainerRef} 
          onMouseMove={showControls} 
          onMouseLeave={hideControlsIfVideoPlaying}
          className={`media-player-paper-container ${isFullScreen ? 'fullscreen-active' : ''}`}
          sx={{ 
            width: '100%', 
            maxWidth: '960px', 
            bgcolor: '#000', 
            borderRadius: isMobile ? 0 : '8px', 
            overflow: 'hidden', 
            position: 'relative',
            // 全屏时的基础样式，主要由CSS文件控制，这里可以保留一些JS驱动的改变
            ...(isFullScreen && {
              maxWidth: 'none',
              borderRadius: 0,
            })
          }}>

          <Box className="player-wrapper"
            sx={{ 
              position: 'relative',
              width: '100%',
              // 高度和 paddingTop 由 CSS 控制，以响应全屏状态
              // backgroundColor: '#000', // 已由 Paper 控制
              // display: 'flex', // 将在 CSS 中处理
              // alignItems: 'center',
              // justifyContent: 'center',
              // 对于视频，使用aspect-ratio的CSS技巧，或让其在flex容器中自然适应
              // 对于音频，保持原有逻辑或简化
              ...(isVideo ? {
                // 非全屏时保持宽高比 (如果 fullscreen-active 类不存在时生效)
                // 全屏时，依赖 .fullscreen-active .player-wrapper 的样式
                aspectRatio: '16 / 9', // 示例：默认16:9，全屏时CSS会覆盖
                height: 'auto', // 与aspectRatio配合
                display: 'flex', // 始终 flex 以便内部 ReactPlayer 居中
                alignItems: 'center',
                justifyContent: 'center',
              } : { // 音频样式
                height: isMobile ? '50px' : '150px', // 或您希望的音频播放器高度
              }),
              // 全屏时，CSS将优先处理尺寸和布局
            }}
          >
            <ReactPlayer
              ref={playerRef} className="react-player" url={streamUrlWithToken} playing={playing} controls={false}
              volume={volume} muted={muted} playbackRate={playbackRate}
              onPlay={handlePlay} onPause={handlePauseFromPlayer} onEnded={handleEnded}
              onError={handleReactPlayerError} onProgress={handleReactPlayerProgress}
              onDuration={handleReactPlayerDuration} onReady={handleReactPlayerReady}
              onBuffer={handleReactPlayerBuffer} onBufferEnd={handleReactPlayerBufferEnd}
              width="100%" height="100%"
              // style={{ position: isVideo ? 'absolute' : 'relative', top: 0, left: 0 }}
              style={{
                // ReactPlayer 内部的 video 标签的 object-fit 将由 CSS 控制
                // maxWidth 和 maxHeight 也由 CSS 控制
                display: 'block', // 有助于 video 表现如预期
              }}
              config={{ 
                file: {
                  attributes: { controlsList: 'nodownload' },
                  forceAudio: isAudio,
                  forceVideo: isVideo,
                },
                // HLS configuration for Qiniu Cloud videos
                ...(useHLS && {
                  file: {
                    attributes: { controlsList: 'nodownload' },
                    forceAudio: isAudio,
                    forceVideo: isVideo,
                    hlsOptions: {
                      debug: false,
                      enableWorker: true,
                      lowLatencyMode: false,
                      backBufferLength: 90,
                      // 优化缓冲设置
                      maxBufferLength: 30,        // 最大缓冲30秒
                      maxMaxBufferLength: 60,     // 绝对最大缓冲60秒
                      maxBufferSize: 60 * 1000 * 1000, // 60MB缓冲大小
                      maxBufferHole: 0.5,         // 允许0.5秒的缓冲空洞
                      highBufferWatchdogPeriod: 2, // 高缓冲监控周期
                      nudgeOffset: 0.1,           // 微调偏移
                      nudgeMaxRetry: 3,           // 最大重试次数
                      maxFragLookUpTolerance: 0.25, // 片段查找容差
                      liveSyncDurationCount: 3,   // 直播同步片段数
                      liveMaxLatencyDurationCount: 10, // 最大延迟片段数
                      enableSoftwareAES: true,    // 启用软件AES解密
                      manifestLoadingTimeOut: 10000, // manifest加载超时10秒
                      manifestLoadingMaxRetry: 1, // manifest最大重试1次
                      manifestLoadingRetryDelay: 1000, // 重试延迟1秒
                      fragLoadingTimeOut: 20000,  // 片段加载超时20秒
                      fragLoadingMaxRetry: 3,     // 片段最大重试3次
                      fragLoadingRetryDelay: 1000, // 片段重试延迟1秒
                    }
                  }
                })
              }}
            />
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

          <Box sx={{ p: isMobile ? 1 : 1.5, backgroundColor: 'rgba(0, 0, 0, 0.7)', color: 'white',
                position: (isVideo || (isAudio && !isMobile) ) ? 'absolute' : 'relative',
                bottom: (isVideo || (isAudio && !isMobile) ) ? 0 : 'auto',
                left: 0, right: 0,
                opacity: (isVideo && !controlsVisible) ? 0 : 1,
                visibility: (isVideo && !controlsVisible) ? 'hidden' : 'visible',
                transition: 'opacity 0.3s ease-in-out, visibility 0.3s ease-in-out',
                zIndex: 3,
                pointerEvents: (!isMediaReady || buffering) ? 'none' : 'auto',
                filter: (!isMediaReady || buffering) ? 'grayscale(80%) opacity(0.7)' : 'none',
            }}>
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
        {/* --- 播放历史记录区域 --- */}
        {(userRole === 'admin' || userRole === 'teacher') && resourceId && (
          <Paper elevation={2} sx={{ width: '100%', maxWidth: '960px', mt: 3, mb: 2 }}>
            <Accordion expanded={showPlayHistory} onChange={() => setShowPlayHistory(!showPlayHistory)}>
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                aria-controls="play-history-content"
                id="play-history-header"
              >
                <Typography variant="h6">播放历史 ({historyTotalGroups} 个会话)</Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}>
                {historyLoading && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}><CircularProgress size={24} /></Box>
                )}
                {historyError && !historyLoading && (
                  <Alert severity="error" sx={{ m: 2 }}>{historyError}</Alert>
                )}
                {!historyLoading && !historyError && groupedPlayHistory.length === 0 && (
                  <Typography sx={{ p: 2, textAlign: 'center' }} color="textSecondary">暂无播放记录。</Typography>
                )}
                {!historyLoading && !historyError && paginatedGroupedHistory.length > 0 && (
                  <List dense sx={{ width: '100%', bgcolor: 'background.paper', pt:0 }}>
                    {paginatedGroupedHistory.map((session, index) => (
                      <React.Fragment key={session.id}>
                        <ListItem alignItems="flex-start" sx={{ py: 1.5 }}>
                          <ListItemAvatar sx={{mt:0.5}}>
                            <Avatar sx={{ bgcolor: theme.palette.primary.light, color: theme.palette.primary.contrastText }}>
                              <PersonIcon />
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText
                            primary={
                              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                用户: {session.username || session.userId?.substring(0,8) || '未知用户'}
                              </Typography>
                            }
                            secondary={
                              <Box component="div" sx={{ fontSize: '0.8rem', color: theme.palette.text.secondary }}>
                                <Typography component="span" variant="caption" sx={{ mr: 1 }}>
                                  会话ID: {session.sessionId ? session.sessionId.substring(0,8) + '...' : '无会话ID'}
                                </Typography>
                                <Typography component="span" variant="caption" sx={{ mr: 1 }}>
                                  开始于: {session.startTime ? format(parseISO(session.startTime), 'MM-dd HH:mm', { locale: zhCN }) : '-'}
                                </Typography>
                                <Typography component="span" variant="caption">
                                  结束于: {session.latestTime ? format(parseISO(session.latestTime), 'HH:mm', { locale: zhCN }) : '-'}
                                </Typography>
                                {session.sessionDurationSeconds > 0 && (
                                    <Typography component="span" variant="caption" sx={{ ml: 1 }}>
                                        | 会话时长: {formatSecondsToHHMMSS(session.sessionDurationSeconds)}
                                    </Typography>
                                )}
                                <Box sx={{ mt: 0.5 }}>
                                    <Typography component="span" variant="caption" sx={{ mr: 1 }}>
                                      最终播放时长: {formatTime(session.latestWatchTimeSeconds || 0)}
                                    </Typography>
                                     <Typography component="span" variant="caption" sx={{ mr: 1 }}>
                                      | 最终播放比例: {((session.latestPercentageWatched || 0) * 100).toFixed(1)}%
                                    </Typography>
                                     {/* <Typography component="span" variant="caption">
                                        包含事件: {session.eventTypes?.join(', ') || '无'}
                                    </Typography> */}
                                </Box>
                              </Box>
                            }
                            secondaryTypographyProps={{ component: 'div' }}
                          />
                        </ListItem>
                        {/* Don't add divider after the last item */}
                        {index < paginatedGroupedHistory.length - 1 && (
                            <Divider variant="inset" component="li" />
                        )}
                      </React.Fragment>
                    ))}
                  </List>
                )}
                {historyTotalGroups > 0 && !historyLoading && !historyError && (
                    <TablePagination
                        component="div"
                        count={historyTotalGroups}
                        page={historyPage}
                        onPageChange={handleChangeHistoryPage}
                        rowsPerPage={historyRowsPerPage}
                        onRowsPerPageChange={handleChangeHistoryRowsPerPage}
                        rowsPerPageOptions={[5, 10, 20, 50]}
                        labelRowsPerPage="每页会话数:"
                        labelDisplayedRows={({ from, to, count }) => `${from}-${to} 共 ${count}`}
                        sx={{borderTop: `1px solid ${theme.palette.divider}`}}
                    />
                )}
              </AccordionDetails>
            </Accordion>
          </Paper>
        )}
      </Box>
    );
  }

  return <Container sx={{py:3}}><Alert severity="info">正在加载播放器...</Alert></Container>;
};

export default MediaPlayerPage;