// frontend/src/utils/useTaskPolling.js
import { useState, useEffect, useRef, useCallback } from 'react';
import { ttsApi } from '../api/tts'; // 假设你的API客户端在这里

const useTaskPolling = (onTaskCompletion, onTaskFailure) => {
  const [pollingTask, setPollingTask] = useState(null); // { id, type, message }
  const [isPolling, setIsPolling] = useState(false);
  const pollingIntervalRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setIsPolling(false);
    setPollingTask(null);
  }, []);

  const startPolling = useCallback((taskId, taskType = 'default', initialMessage = '任务已提交，等待处理...') => {
    stopPolling(); // 先停止任何可能在运行的轮询

    const newTask = { id: taskId, type: taskType, message: initialMessage, status: 'PENDING' };
    setPollingTask(newTask);
    setIsPolling(true);
    
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const response = await ttsApi.getTaskStatus(taskId);
        const taskData = response.data;

        setPollingTask(prev => ({ ...prev, ...taskData, message: taskData.meta?.message || taskData.result?.message || prev.message }));

        if (taskData.status === 'SUCCESS' || taskData.status === 'FAILURE') {
          stopPolling();
          if (taskData.status === 'SUCCESS') {
            if (onTaskCompletion) onTaskCompletion(taskData, taskType);
          } else {
            if (onTaskFailure) onTaskFailure(taskData, taskType);
          }
        }
      } catch (error) {
        console.error(`轮询任务 ${taskId} 状态失败:`, error);
        stopPolling();
        if (onTaskFailure) {
          onTaskFailure({ 
            status: 'FAILURE', 
            error_message: '轮询任务状态时网络或服务器错误。',
            meta: { message: '轮询任务状态时出错。' }
          }, taskType);
        }
      }
    }, 2500); // 每2.5秒轮询一次
  }, [onTaskCompletion, onTaskFailure, stopPolling]);

  // 组件卸载时自动停止轮询
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return { pollingTask, isPolling, startPolling, stopPolling };
};

export default useTaskPolling;