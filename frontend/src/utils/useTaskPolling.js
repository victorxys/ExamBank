// frontend/src/utils/useTaskPolling.js

import { useState, useEffect, useRef, useCallback } from 'react';
import { ttsApi } from '../api/tts';

const useTaskPolling = (onTaskCompletion, onTaskFailure, onProgress) => {
    const [pollingTask, setPollingTask] = useState(null);
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

    const startPolling = useCallback((taskId, taskType = 'default', initialMessage = '...') => {
        stopPolling();

        const initialTaskState = { id: taskId, type: taskType, message: initialMessage, status: 'PENDING', meta: {} };
        setPollingTask(initialTaskState);
        setIsPolling(true);
        
        pollingIntervalRef.current = setInterval(async () => {
            let currentTaskState = null; // 用于临时存储当前轮询获取的状态
            try {
                const response = await ttsApi.getTaskStatus(taskId);
                currentTaskState = response.data;

                // <<<--- 关键修改：直接用最新的 taskData 调用 onProgress ---<<<
                if (currentTaskState.status === 'PROGRESS' && onProgress) {
                    onProgress(currentTaskState, taskType);
                }
                // -------------------------------------------------------->>>

                // 更新内部状态，用于驱动 isPolling 等
                setPollingTask(prev => ({ ...prev, ...currentTaskState }));

                if (currentTaskState.status === 'SUCCESS' || currentTaskState.status === 'FAILURE') {
                    stopPolling();
                    if (currentTaskState.status === 'SUCCESS') {
                        if (onTaskCompletion) onTaskCompletion(currentTaskState, taskType);
                    } else {
                        if (onTaskFailure) onTaskFailure(currentTaskState, taskType);
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
        }, 2000);
    }, [onTaskCompletion, onTaskFailure, onProgress, stopPolling]);

    // 组件卸载时自动停止轮询
    useEffect(() => {
      return () => {
        stopPolling();
      };
    }, [stopPolling]);

    return { pollingTask, isPolling, startPolling, stopPolling };
};

export default useTaskPolling;