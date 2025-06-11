// frontend/src/utils/useTaskPolling.js

import { useState, useEffect, useRef, useCallback } from 'react';
import { ttsApi } from '../api/tts';

const useTaskPolling = (onTaskCompletion, onTaskFailure, onProgress) => {
    // 内部状态，只由这个钩子管理
    const [isPolling, setIsPolling] = useState(false);
    const [pollingTask, setPollingTask] = useState(null); // 存储当前轮询任务的信息
    
    // 使用 useRef 来存储回调函数，确保 setInterval 中总能拿到最新的函数引用，
    // 同时避免它们成为 useEffect 的依赖项。
    const onTaskCompletionRef = useRef(onTaskCompletion);
    const onTaskFailureRef = useRef(onTaskFailure);
    const onProgressRef = useRef(onProgress);

    // 每次组件渲染时，都更新 ref 中的函数引用
    useEffect(() => {
        onTaskCompletionRef.current = onTaskCompletion;
        onTaskFailureRef.current = onTaskFailure;
        onProgressRef.current = onProgress;
    });

    const pollingIntervalRef = useRef(null);

    const stopPolling = useCallback(() => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
        setIsPolling(false);
        // 保留 pollingTask 的最终状态，直到下一次 startPolling
        // setPollingTask(null); 
    }, []);

    const startPolling = useCallback((taskId, taskType = 'default', initialMessage = '...') => {
        // 先确保停止任何正在进行的轮询
        stopPolling();

        const initialTaskState = { id: taskId, type: taskType, message: initialMessage, status: 'PENDING', meta: {} };
        setPollingTask(initialTaskState); // 设置初始任务状态
        setIsPolling(true);
        
        pollingIntervalRef.current = setInterval(async () => {
            try {
                const response = await ttsApi.getTaskStatus(taskId);
                const taskData = response.data;

                // 更新内部状态
                setPollingTask(prev => ({ ...prev, ...taskData }));

                // 根据任务状态调用对应的外部回调函数
                if (taskData.status === 'SUCCESS') {
                    stopPolling();
                    onTaskCompletionRef.current?.(taskData, taskType);
                } else if (taskData.status === 'FAILURE') {
                    stopPolling();
                    onTaskFailureRef.current?.(taskData, taskType);
                } else if (taskData.status === 'PROGRESS') {
                    onProgressRef.current?.(taskData, taskType);
                }
                // 其他状态（PENDING, STARTED）会继续轮询

            } catch (error) {
                console.error(`轮询任务 ${taskId} 状态失败:`, error);
                stopPolling();
                const failureData = { 
                    status: 'FAILURE', 
                    error_message: '轮询任务状态时网络或服务器错误。',
                    meta: { message: '轮询任务状态时出错。' }
                  };
                setPollingTask(prev => ({...prev, ...failureData}));
                onTaskFailureRef.current?.(failureData, taskType);
            }
        }, 2500); // 轮询间隔设为2.5秒
    }, [stopPolling]); // startPolling 只依赖于 stopPolling，是稳定的

    // 组件卸载时自动停止轮询
    useEffect(() => {
      return () => {
        stopPolling();
      };
    }, [stopPolling]);

    return { pollingTask, isPolling, startPolling, stopPolling };
};

export default useTaskPolling;