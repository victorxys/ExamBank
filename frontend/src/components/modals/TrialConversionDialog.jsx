import React from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, Alert,
    TextField, MenuItem, Box, CircularProgress, Typography,
    List, ListItem, ListItemText, Divider
} from '@mui/material';

const formatDate = (isoString) => {
    if (!isoString) return '—';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '无效日期';
        return date.toLocaleDateString('zh-CN', { year: 'numeric', month:'2-digit', day: '2-digit' });
    } catch (e) { return '无效日期'; }
};

const TrialConversionDialog = ({
    isConversionDialogOpen,
    closeConversionDialog,
    handleConfirmConversion,
    eligibleContracts,
    isLoadingEligible,
    selectedFormalContractId,
    setSelectedFormalContractId,
    contractToProcess,
    conversionCosts,
    isLoadingCosts,
    conversionSuccess,
    handleStay,
    handleNavigate,
}) => {
    const hasCosts = conversionCosts && Object.keys(conversionCosts).length> 0;

    return (
        <Dialog open={isConversionDialogOpen}onClose={closeConversionDialog} fullWidth maxWidth="sm">
            <DialogTitle>{conversionSuccess ? "转换成功" : "关联到正式合同"}</DialogTitle>
            <DialogContent>
                {conversionSuccess ? (
                    <Alert severity="success" sx={{ mt: 1 }}>
                        试工合同已成功转换！相关费用已附加到正式合同的第一期账单中。
                    </Alert>
                ) : (
                    <>
                        <Typography variant="body2" color="text.secondary"sx={{ mb: 2 }}>
                            请为这个成功的试工合同选择一个要转入的正式育儿嫂合同。
                        </Typography>
                        <Box sx={{ my: 2, p: 2, bgcolor: 'grey.50',borderRadius: 2 }}>
                            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>费用转移预览</Typography>
                            <Typography variant="caption" color="text.secondary" display="block" sx={{mb: 1}}>
                                以下费用将被自动创建为财务调整项，并附加到所选正式合同的首期账单中。
                            </Typography>
                            <Divider sx={{mb: 1}}/>
                            {isLoadingCosts ? (
                                <Box sx={{ display: 'flex', justifyContent:'center', my: 2 }}>
                                    <CircularProgress size={24} />
                                </Box>
                            ) : hasCosts ? (
                                <List dense disablePadding>
                                    {conversionCosts.introduction_fee && (
                                        <ListItem>
                                            <ListItemText
                                                primary={<span>介绍费: <Typography component="span" sx={{ fontWeight: 'bold' }}>¥{conversionCosts.introduction_fee.amount}</Typography></span>}
                                                secondary={conversionCosts.introduction_fee.description}
                                            />
                                        </ListItem>
                                    )}
                                    {conversionCosts.trial_service_fee && (
                                        <ListItem>
                                            <ListItemText
                                                primary={<span>试工服务费: <Typography component="span" sx={{ fontWeight: 'bold' }}>¥{conversionCosts.trial_service_fee.amount}</Typography></span>}
                                                secondary={conversionCosts.trial_service_fee.description}
                                            />
                                        </ListItem>
                                    )}
                                    {conversionCosts.management_fee && (
                                        <ListItem>
                                            <ListItemText
                                                primary={<span>试工管理费: <Typography component="span" sx={{ fontWeight: 'bold' }}>¥{conversionCosts.management_fee.amount}</Typography></span>}
                                                secondary={conversionCosts.management_fee.description}
                                            />
                                        </ListItem>
                                    )}
                                </List>
                            ) : (
                                <Typography variant="body2" color="text.secondary">（无待转移费用）</Typography>
                            )}
                        </Box>
                        {isLoadingEligible ? (
                            <Box sx={{ display: 'flex', justifyContent:'center', my: 3 }}>
                                <CircularProgress />
                            </Box>
                        ) : eligibleContracts.length > 0 ? (
                            <TextField
                                select
                                fullWidth
                                variant="outlined"
                                label="选择一个正式合同"
                                value={selectedFormalContractId}
                                onChange={(e) => setSelectedFormalContractId(e.target.value)}
                            >
                                {eligibleContracts.map((c) => (
                                    <MenuItem key={c.id} value={c.id}>
                                        {`合同 (员工: ${c.employee_name}, 开始日期: ${formatDate(c.start_date)})`}
                                    </MenuItem>
                                ))}
                            </TextField>
                        ) : (
                            <Alert severity="warning">
                                客户({contractToProcess?.customer_name})-员工({contractToProcess?.employee_name}):尚未签订正式育儿嫂合同,无法关联。
                                <br/>
                                请先签署正式合同后再执行此操作。
                            </Alert>
                        )}
                    </>
                )}
            </DialogContent>
            <DialogActions>
                {conversionSuccess ? (
                    <>
                        <Button onClick={handleStay}>留在当前页面</Button>
                        <Button onClick={handleNavigate} variant="contained">查看正式合同</Button>
                    </>
                ) : (
                    <>
                        <Button onClick={closeConversionDialog}>取消</Button>
                        <Button
                            onClick={handleConfirmConversion}
                            variant="contained"
                            color="primary"
                            disabled={!selectedFormalContractId ||isLoadingEligible || isLoadingCosts}
                        >
                            确认并转换
                        </Button>
                    </>
                )}
            </DialogActions>
        </Dialog>
    );
};

export default TrialConversionDialog;