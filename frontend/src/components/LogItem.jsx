// frontend/src/components/LogItem.jsx (最终的、无嵌套警告版)

import React from 'react';
import { Box, Typography, Chip, List, ListItem, ListItemText } from '@mui/material';
import { TimelineItem, TimelineSeparator, TimelineConnector, TimelineContent, TimelineDot } from '@mui/lab';
import { History as HistoryIcon } from '@mui/icons-material';
import { Link as LinkIcon } from '@mui/icons-material';

import { AdjustmentTypes } from './AdjustmentDialog';

const formatMiniAmount = (amount) => {
    const num = Number(amount);
    return isNaN(num) ? String(amount) : `¥${num.toLocaleString('zh-CN')}`;
};

const LogItem = ({ log, isLast, navigate, onClose }) => {

    const renderActionDetails = () => {
        const details = log.details;

        // **核心修正**: 基础文本容器，确保它是一个 div
        const MainActionContainer = ({ children }) => (
            <Typography variant="body2" component="div" color="text.primary">
                {children}
            </Typography>
        );

        const UserSpan = () => (
            <Box component="span" sx={{ fontWeight: 'bold' }}>{log.user}</Box>
        );

                // --- 新增：处理顺延日志 ---
        if (details?.next_bill_id) {
            const handleLinkClick = () => {
                if (onClose) onClose(); // 先关闭当前弹窗
                // 使用 navigate 跳转，并带上 open_bill_id 参数
                // 注意：这里的路径是根据 BillingDashboard 的路由猜测的，如果您的路由不同，请修改
                navigate(`/billing-dashboard?open_bill_id=${details.next_bill_id}`);
            };

            return (
                <MainActionContainer>
                    <UserSpan /> {log.action}
                    <Chip
                        icon={<LinkIcon />}
                        label="查看该账单"
                        onClick={handleLinkClick}
                        size="small"
                        variant="outlined"
                        color="primary"
                        clickable
                    />
                </MainActionContainer>
            );
        }
        // --- 新增结束 ---

        // 如果 details 不存在或为空对象
        if (!details || Object.keys(details).length === 0) {
            return <MainActionContainer><UserSpan /> {log.action}</MainActionContainer>;
        }

        // 场景1: “修改型”日志 (包含 from 和 to)
        if (details.hasOwnProperty('from') && details.hasOwnProperty('to')) {
            const unit = details.unit || '';
            const fromValue = `${details.from}${unit}`;
            const toValue = `${details.to}${unit}`;

            return (
                <MainActionContainer>
                    <UserSpan /> {log.action} 从 
                    <Chip label={fromValue} size="small" sx={{ mx: 0.5, bgcolor: 'error.light', color: 'white', fontWeight: 500, height: '22px' }} />
                    修改为 
                    <Chip label={toValue} size="small" sx={{ mx: 0.5, bgcolor: 'success.light', color: 'white', fontWeight: 500, height: '22px' }} />
                </MainActionContainer>
            );
        }

        // 场景2: “新增/删除财务调整”日志 (包含 amount 和 type)
        if (details.hasOwnProperty('amount') && details.hasOwnProperty('type')) {
            const typeLabel = AdjustmentTypes[details.type]?.label || details.type;
            const amountStr = formatMiniAmount(details.amount);
            
            return (
                <MainActionContainer>
                    <UserSpan /> {log.action}: 
                    <Chip label={typeLabel} size="small" variant="outlined" sx={{ mx: 0.5, height: '22px' }} />
                    <Chip label={amountStr} size="small" color="primary" variant="outlined" sx={{ height: '22px', fontWeight: 500 }} />
                </MainActionContainer>
            );
        }
        
        // 场景3: 聚合型变更
        const isAggregateChange = Object.values(details).some(
            value => typeof value === 'object' && value !== null && value.hasOwnProperty('from') && value.hasOwnProperty('to')
        );
        
        if (isAggregateChange) {
            return (
                <Box>
                    <Typography variant="body2" component="div" color="text.primary">
                         <UserSpan /> {log.action}:
                    </Typography>
                    <List dense disablePadding sx={{ borderLeft: '2px solid', borderColor: 'grey.200', pl: 2, ml: 1, mt: 0.5 }}>
                        {Object.entries(details).map(([key, value]) => (
                             <ListItem key={key} disableGutters sx={{py: 0.25}}>
                                 <ListItemText
                                     primaryTypographyProps={{ variant: 'body2', component: 'div' }} // 确保 ListItemText 不渲染 <p>
                                     primary={
                                         <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
                                             <Typography variant="body2" component="span" color="text.secondary">- {key} 从</Typography>
                                             <Chip label={value.from || '空'} size="small" variant="outlined" sx={{ height: '20px', bgcolor: 'grey.100' }} />
                                             <Typography variant="body2" component="span" color="text.secondary">改为</Typography>
                                             <Chip label={value.to || '空'} size="small" variant="outlined" color="primary" sx={{ height: '20px' }} />
                                         </Box>
                                     }
                                 />
                             </ListItem>
                        ))}
                    </List>
                </Box>
            );
        }

        // 其他所有后备情况
        return <MainActionContainer><UserSpan /> {log.action}</MainActionContainer>;
    };

    return (
        <TimelineItem sx={{ '&::before': { content: 'none', minWidth: 0 } }}>
            <TimelineSeparator>
                <TimelineDot sx={{ m: 0, boxShadow: 'none', p: 0.5 }} color="grey" variant="outlined">
                    <HistoryIcon sx={{ fontSize: '1rem' }} />
                </TimelineDot>
                {!isLast && <TimelineConnector sx={{ bgcolor: 'grey.300' }} />}
            </TimelineSeparator>
            <TimelineContent sx={{ pt: 0, pb: 3, pl: 2, mt: '-4px' }}>
                {renderActionDetails()}
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                    {new Date(log.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </Typography>
            </TimelineContent>
        </TimelineItem>
    );
};

export default LogItem;