import React from 'react';
import { Box, LinearProgress, Tooltip } from '@mui/material';

const PaymentProgress = ({ totalPaid, totalDue }) => {
    if (totalPaid <= 0 || totalDue <= 0) {
        return null; // 如果没有应付款或已付款，则不显示
    }

    // 如果超额付款，进度也只显示100%
    const progress = Math.min((totalPaid / totalDue) * 100, 100);

    let progressColor = 'info'; // 默认颜色 (50-99%)
    if (progress < 50) {
        progressColor = 'warning'; // 黄色
    } else if (progress >= 100) {
        progressColor = 'success'; // 绿色
    }

    const tooltipTitle = `客户已付公司: ¥${parseFloat(totalPaid).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return (
        <Tooltip title={tooltipTitle} arrow>
            <Box sx={{ width: '100%', mb: 0.5 }}>
                <LinearProgress
                    variant="determinate"
                    value={progress}
                    color={progressColor}
                    sx={{ height: 6, borderRadius: 3 }}
                />
            </Box>
        </Tooltip>
    );
};

export default PaymentProgress;