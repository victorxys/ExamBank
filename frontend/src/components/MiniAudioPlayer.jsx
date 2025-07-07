// frontend/src/components/MiniAudioPlayer.jsx (新建文件)
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, IconButton, Slider, Typography, Tooltip, CircularProgress, Menu, MenuItem, Paper} from '@mui/material';
import { PlayArrow as PlayArrowIcon, Pause as PauseIcon, VolumeUp as VolumeUpIcon, MoreVert as MoreVertIcon } from '@mui/icons-material';

// 时间格式化辅助函数 (MM:SS)
const formatTime = (totalSecondsValue) => {
  if (typeof totalSecondsValue !== 'number' || isNaN(totalSecondsValue) || totalSecondsValue < 0) {
    return '00:00';
  }
  const minutes = String(Math.floor(totalSecondsValue / 60)).padStart(2, '0');
  const seconds = String(Math.floor(totalSecondsValue % 60)).padStart(2, '0');
  return `${minutes}:${seconds}`;
};


const MiniAudioPlayer = ({ src, playbackRate = 1.0, onEnded }) => { // 接收 playbackRate prop
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [anchorEl, setAnchorEl] = useState(null); // For "more" menu
  

  // +++++ 新增：自动播放的 useEffect +++++
  useEffect(() => {
    // 当 src 有效且组件已准备好时，自动播放
    if (audioRef.current && src && isReady) {
      audioRef.current.play().catch(e => console.error("Autoplay failed:", e));
    }
  }, [src, isReady]); // 当 src 或 isReady 状态变化时触发
  // +++++++++++++++++++++++++++++++++++++

  const handlePlayPause = () => {
    if (!audioRef.current || !isReady) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(e => console.error("Audio play error:", e));
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (event, newValue) => {
    if (audioRef.current) {
      audioRef.current.currentTime = newValue;
    }
  };

  const handleVolumeChange = (event, newValue) => {
    if (audioRef.current) {
      audioRef.current.volume = newValue;
      setVolume(newValue);
    }
  };

  const handleOpenMoreMenu = (event) => {
    setAnchorEl(event.currentTarget);
  };
  const handleCloseMoreMenu = () => {
    setAnchorEl(null);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration);
    const onCanPlay = () => { setIsReady(true); setIsLoading(false); };
    const onWaiting = () => setIsLoading(true);
    const onPlaying = () => setIsLoading(false);
    const handleEnded = () => {
        setIsPlaying(false);
        if (onEnded) onEnded();
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [onEnded]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      // 应用传入的播放速度
      audio.playbackRate = playbackRate;
    }
  }, [playbackRate]); // 当 playbackRate prop 变化时，更新 audio 元素的播放速度

  return (
    <Paper 
        elevation={2}
        sx={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 12px',
            borderRadius: '50px',
            backgroundColor: '#f5f5f5',
            width: '100%',
            maxWidth: '320px',
            boxSizing: 'border-box'
        }}
    >
      <audio ref={audioRef} src={src} preload="metadata"></audio>
      
      <Tooltip title={isPlaying ? "暂停" : "播放"}>
        <span>
        <IconButton onClick={handlePlayPause} size="small" disabled={!isReady}>
            {isLoading ? <CircularProgress size={20} /> : (isPlaying ? <PauseIcon /> : <PlayArrowIcon />)}
        </IconButton>
        </span>
      </Tooltip>
      
      <Typography variant="caption" sx={{ mx: 1, minWidth: '75px' }}>
        {formatTime(currentTime)} / {formatTime(duration)}
      </Typography>
      
      <Slider
        size="small"
        value={currentTime}
        min={0}
        max={duration || 100} // Provide a fallback max if duration is 0
        onChange={handleSeek}
        disabled={!isReady}
        sx={{
          flexGrow: 1,
          mx: 1,
          '& .MuiSlider-thumb': { width: 12, height: 12 },
        }}
      />  
    </Paper>
  );
};

export default MiniAudioPlayer;