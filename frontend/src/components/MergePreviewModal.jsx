import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, Grid, Paper, Divider, CircularProgress, Alert, List, ListItem, ListItemText, Chip, IconButton, Tooltip
} from '@mui/material';
import {
    ArrowForward as ArrowForwardIcon,
    WarningAmber as WarningAmberIcon,
    OpenInNew as OpenInNewIcon
} from '@mui/icons-material';
import { mergeBills } from '../api/bill_merge';
import { useNavigate } from 'react-router-dom'; // 1. 导入 useNavigate

const formatAmount = (amount) => {
    const num = Number(amount);
    if (isNaN(num)) return '¥0.00';
    const color = num > 0 ? 'success.main' : num < 0 ? 'error.main' : 'text.primary';
    const sign = num > 0 ? '+' : '';
    return <Box component="span" sx={{ color }}>{`${sign}¥${num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</Box>;
};

const ActionItem = ({ action }) => (
    <ListItem divider>
        <ListItemText
            primary={action.description}
            secondary={
                <React.Fragment>
                    金额: {formatAmount(action.amount)}
                </React.Fragment>
            }
        />
        <Chip label={action.location} size="small" variant="outlined" />
    </ListItem>
);

const MergePreviewModal = ({
    open,
    onClose,
    onConfirm,
    previewData,
    sourceBillId,
    targetContractId,
}) => {
  const [error, setError] = useState('');
  const [isMerging, setIsMerging] = useState(false);
  const navigate = useNavigate(); // 2. 初始化 navigate

  const handleConfirmMerge = async () => {
    setIsMerging(true);
    setError('');
    try {
      await mergeBills(sourceBillId, targetContractId, false);
      onConfirm();
    } catch (err) {
      const apiError = err.response?.data?.message || err.message || '未知错误';
      setError(`合并失败: ${apiError}`);
    } finally {
      setIsMerging(false);
    }
  };

  const renderPreviewContent = () => {
    if (!previewData || !previewData.preview) {
        return <Alert severity="info">正在加载预览数据...</Alert>;
    }
    const { customer_bill, employee_payroll, to_be_deleted } = previewData.preview;
    return (
        <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
                <Typography variant="h6" gutterBottom>客户账单变更</Typography>
                <Paper variant="outlined" sx={{ p: 1, maxHeight: 300, overflow: 'auto' }}>
                    <List dense>
                        {customer_bill.actions.map((action, index) => <ActionItem key={`cust-${ index}`} action={action} />)}
                    </List>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="body2" sx={{ p: 1, textAlign: 'right' }}>
                        源账单最终应收: <strong>{formatAmount(0)}</strong>
                    </Typography>
                </Paper>
            </Grid>
            <Grid item xs={12} md={6}>
                <Typography variant="h6" gutterBottom>员工工资单变更</Typography>
                <Paper variant="outlined" sx={{ p: 1, maxHeight: 300, overflow: 'auto' }}>
                    <List dense>
                        {employee_payroll.actions.map((action, index) => <ActionItem key={`emp- ${index}`} action={action} />)}
                        {employee_payroll.commission_actions.map((action, index) => <ActionItem key={`comm-${index}`} action={action} />)}
                    </List>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="body2" sx={{ p: 1, textAlign: 'right' }}>
                        源工资单最终应付: <strong>{formatAmount(0)}</strong>
                    </Typography>
                </Paper>
            </Grid>
            {to_be_deleted && to_be_deleted.length > 0 && (
                <Grid item xs={12}>
                    <Divider sx={{mt: 2, mb: 1}}><Chip label="将被删除的代付项" /></Divider>
                    <List dense>
                        {to_be_deleted.map((item, index) => (
                            <ListItem key={`del-${index}`}>
                                <ListItemText
                                    primary={`${item.scope}中的调整项: ${item.description}`}
                                    secondary={ <React.Fragment> 金额: {formatAmount(item.amount)} </React.Fragment> }
                                />
                            </ListItem>
                        ))}
                    </List>
                </Grid>
            )}
        </Grid>
    );
  }

  const renderContent = () => {
    if (error) {
      return <Alert severity="error">{error}</Alert>;
    }

    const sourceInfo = previewData?.source_info;
    const targetInfo = previewData?.target_info;

    // 3. 修改跳转逻辑
    const handleOpenContract = (contractId) => {
        if (!contractId) return;
        // 在新窗口中打开合同详情页
        window.open(`/contract/detail/${contractId}`, '_blank');
    };

    return (
      <>
        <Typography variant="subtitle1" gutterBottom>
          您即将执行账单合并操作，所有源账单的余额将被清零并转移到目标账单，请仔细确认。
        </Typography>
        <Grid container spacing={2} sx={{ mt: 2, mb: 3, alignItems: 'stretch' }}>
          <Grid item xs={5}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
              <Typography variant="h6" gutterBottom>源账单</Typography>
              <Typography variant="body2">客户: {sourceInfo?.customer_name || '...'}</Typography >
              {/* 4. 显示员工姓名 */}
              <Typography variant="body2">员工: {sourceInfo?.employee_name || '...'}</Typography >
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>合同: {sourceInfo?. contract_name || '...'}</Typography>
              <Typography variant="body2" color="text.secondary">账单期间: {sourceInfo?.period || '...'}</Typography>
              <Typography variant="body2" color="text.secondary">合同有效期: {sourceInfo?. start_date || '...'} ~ {sourceInfo?.end_date || '...'}</Typography>
            </Paper>
          </Grid>

          <Grid item xs={2} sx={{ textAlign: 'center', alignSelf: 'center' }}>
            <ArrowForwardIcon color="primary" sx={{ fontSize: 40 }} />
          </Grid>

          <Grid item xs={5}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6" gutterBottom>目标账单</Typography>
                    {/* 5. 修改按钮的 onClick 事件和 disabled 条件 */}
                    <Tooltip title="在新窗口中查看目标合同">
                        <IconButton size="small" onClick={() => handleOpenContract(targetInfo?. contract_id)} disabled={!targetInfo?.contract_id}>
                            <OpenInNewIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
              <Typography variant="body2">客户: {targetInfo?.customer_name || '...'}</Typography >
              {/* 4. 显示员工姓名 */}
              <Typography variant="body2">员工: {targetInfo?.employee_name || '...'}</Typography >
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>合同: {targetInfo?. contract_name || '...'}</Typography>
              <Typography variant="body2" color="text.secondary">账单期间: {targetInfo?.period || '...'}</Typography>
              <Typography variant="body2" color="text.secondary">合同有效期: {targetInfo?. start_date || '...'} ~ {targetInfo?.end_date || '...'}</Typography>
            </Paper>
          </Grid>
        </Grid>

        <Divider sx={{mb: 2}}><Typography variant="overline">合并详情</Typography></Divider>

        {renderPreviewContent()}

        <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mt: 3 }}>
          此操作不可逆，将永久修改相关账单的财务数据。
        </Alert>
      </>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>确认账单合并</DialogTitle>
      <DialogContent dividers>
        {renderContent()}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isMerging}>取消</Button>
        <Button
          onClick={handleConfirmMerge}
          variant="contained"
          color="primary"
          disabled={isMerging || !previewData}
        >
          {isMerging ? <CircularProgress size={24} color="inherit" /> : `确认并执行合并`}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MergePreviewModal;