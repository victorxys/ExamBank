import React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Grid,
    Typography,
    Box,
    Paper,
    List,
    ListItem,
    ListItemText,
    Divider,
    Alert,
    IconButton
} from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import { getFinancialAdjustmentById } from '../api/financial_adjustment';

const AdjustmentGroup = ({ title, items, navigateToAdjustment }) => {
    if (!items || items.length === 0) return null;
    
    return (
        <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle1" gutterBottom>{title}</Typography>
            <List dense>
                {items.map((item, index) => (
                    <ListItem
                        key={index}
                        secondaryAction={
                            item.mirrored_adjustment_id && (
                                <IconButton
                                    edge="end"
                                    aria-label="跳转"
                                    onClick={() => navigateToAdjustment(item.mirrored_adjustment_id)}
                                    size="small"
                                >
                                    <LinkIcon />
                                </IconButton>
                            )
                        }
                    >
                        <ListItemText
                            primary={item.description}
                            secondary={`¥${item.amount} (${new Date(item.date).toLocaleDateString()})`}
                        />
                    </ListItem>
                ))}
            </List>
        </Box>
    );
};

const BillMergePreviewDialog = ({ open, onClose, onConfirm, previewData, onNavigateToAdjustment }) => {
    const handleNavigateToAdjustment = async (adjustmentId) => {
        if (onNavigateToAdjustment) {
            const adjustment = await getFinancialAdjustmentById(adjustmentId);
            onNavigateToAdjustment(adjustment);
        }
    };
    if (!previewData) return null;

    const {
        source_info,
        target_info,
        transfer_amounts,
        adjustments
    } = previewData;

    // 计算要删除的调整项总数
    const totalToBeDeleted = 
        adjustments?.to_be_deleted?.company_paid_salary +
        adjustments?.to_be_deleted?.deposit_paid_salary || 0;

    // 计算要转移的调整项总数
    const totalToBeTransferred = 
        Object.values(adjustments?.to_be_transferred || {})
            .reduce((sum, group) => sum + group.length, 0);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>账单合并预览</DialogTitle>
            <DialogContent>
                {/* 源和目标账单信息 */}
                <Grid container spacing={2} sx={{ mb: 3 }}>
                    <Grid item xs={6}>
                        <Paper sx={{ p: 2 }}>
                            <Typography variant="h6" gutterBottom>源账单</Typography>
                            <Typography>{source_info.contract_name}</Typography>
                            <Typography variant="body2" color="text.secondary">
                                账期: {source_info.period}
                            </Typography>
                        </Paper>
                    </Grid>
                    <Grid item xs={6}>
                        <Paper sx={{ p: 2 }}>
                            <Typography variant="h6" gutterBottom>目标账单</Typography>
                            <Typography>{target_info.contract_name}</Typography>
                            <Typography variant="body2" color="text.secondary">
                                账期: {target_info.period}
                            </Typography>
                        </Paper>
                    </Grid>
                </Grid>

                {/* 基础转移金额 */}
                {/* <Paper sx={{ p: 2, mb: 3 }}>
                    <Typography variant="h6" gutterBottom>基础转移金额</Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={6}>
                            <Typography>保证金: ¥{transfer_amounts.deposit}</Typography>
                        </Grid>
                        <Grid item xs={6}>
                            <Typography>工资总额: ¥{transfer_amounts.salary}</Typography>
                        </Grid>
                    </Grid>
                </Paper> */}

                {/* 调整项变更 */}
                <Paper sx={{ p: 2 }}>
                    <Typography variant="h6" gutterBottom>调整项变更</Typography>
                    
                    {/* 将被删除的调整项 */}
                    {totalToBeDeleted > 0 && (
                        <>
                            <Alert severity="warning" sx={{ mb: 2 }}>
                                以下调整项将被删除：
                                {adjustments.to_be_deleted.company_paid_salary > 0 && 
                                    <div>- {adjustments.to_be_deleted.company_paid_salary} 个公司代付工资调整项</div>
                                }
                                {adjustments.to_be_deleted.deposit_paid_salary > 0 && 
                                    <div>- {adjustments.to_be_deleted.deposit_paid_salary} 个保证金代付工资调整项</div>
                                }
                            </Alert>
                            <Divider sx={{ my: 2 }} />
                        </>
                    )}

                    {/* 将被转移的调整项 */}
                    {totalToBeTransferred > 0 && (
                        <Box>
                            <Typography variant="subtitle1" gutterBottom>
                                以下调整项将被转移到新账单：
                            </Typography>
                            
                            {/* 客户账单调整项 */}
                            <AdjustmentGroup
                                title="客户账单增款"
                                items={adjustments.to_be_transferred.customer_increase}
                                navigateToAdjustment={handleNavigateToAdjustment}
                            />
                            <AdjustmentGroup
                                title="客户账单减款"
                                items={adjustments.to_be_transferred.customer_decrease}
                                navigateToAdjustment={handleNavigateToAdjustment}
                            />
                            
                            {/* 员工工资单调整项 */}
                            <AdjustmentGroup
                                title="员工工资增款"
                                items={adjustments.to_be_transferred.employee_increase}
                                navigateToAdjustment={handleNavigateToAdjustment}
                            />
                            <AdjustmentGroup
                                title="员工工资减款"
                                items={adjustments.to_be_transferred.employee_decrease}
                                navigateToAdjustment={handleNavigateToAdjustment}
                            />
                            
                            {/* 其他类型的调整项 */}
                            <AdjustmentGroup
                                title="介绍费"
                                items={adjustments.to_be_transferred.introduction_fee}
                                navigateToAdjustment={handleNavigateToAdjustment}
                            />
                            <AdjustmentGroup
                                title="延期费"
                                items={adjustments.to_be_transferred.deferred_fee}
                                navigateToAdjustment={handleNavigateToAdjustment}
                            />
                            <AdjustmentGroup
                                title="提成"
                                items={adjustments.to_be_transferred.employee_commission}
                                navigateToAdjustment={handleNavigateToAdjustment}
                            />
                        </Box>
                    )}
                </Paper>

            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>取消</Button>
                <Button onClick={onConfirm} variant="contained" color="primary">
                    确认合并
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default BillMergePreviewDialog;