// frontend/src/components/TransferDepositDialog.jsx

import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography,
    Box, CircularProgress, FormControl, InputLabel, Select, MenuItem, Alert,
    FormControlLabel, Switch, Chip
} from '@mui/material';
import api from '../api/axios';

const TransferDepositDialog = ({ open, onClose, adjustment, sourceContract, onConfirm, sourceBillEndDate }) => {
    const [eligibleItems, setEligibleItems] = useState([]);
    const [familyMembers, setFamilyMembers] = useState([]);
    const [selectedId, setSelectedId] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [transferToSubstitute, setTransferToSubstitute] = useState(false);

    useEffect(() => {
        if (open && sourceContract) {
            setIsLoading(true);
            setError('');
            setEligibleItems([]);
            setFamilyMembers([]);
            setSelectedId('');

            const endpoint = transferToSubstitute 
                ? '/billing/contracts/substitute-bills' 
                : '/billing/contracts/eligible-for-transfer';
            
            const params = {
                customer_name: sourceContract.customer_name,
                exclude_contract_id: sourceContract.contract_id,
                family_id: sourceContract.family_id || null
            };

            api.get(endpoint, { params })
            .then(response => {
                // 处理新的响应格式
                let items, members;
                if (transferToSubstitute) {
                    // 替班账单API返回数组
                    items = response.data;
                    members = [];
                } else {
                    // 合同API返回对象 { contracts, family_members }
                    items = response.data.contracts || response.data;
                    members = response.data.family_members || [];
                }

                if (!transferToSubstitute && sourceBillEndDate) {
                    const currentBillEndDate = new Date(sourceBillEndDate);
                    currentBillEndDate.setHours(0, 0, 0, 0);

                    items = items.filter(contract => {
                        const match = contract.label.match(/\((\d{4}-\d{2}-\d{2})生效\)/);
                        if (!match || !match[1]) {
                            console.warn(`Could not parse date from contract label: "${contract.label}"`);
                            return false;
                        }
                        
                        const targetContractStartDate = new Date(match[1]);
                        targetContractStartDate.setHours(0, 0, 0, 0);

                        return targetContractStartDate >= currentBillEndDate;
                    });
                }

                setEligibleItems(items);
                setFamilyMembers(members);
                
                if (items.length === 0) {
                    const baseMsg = transferToSubstitute 
                        ? '该客户名下没有可供转移的替班账单。' 
                        : '该客户名下没有其他符合条件的有效合同。';
                    const familyHint = sourceContract.family_id 
                        ? '' 
                        : '（提示：如果需要转移到其他家庭成员的合同，请先设置家庭ID）';
                    setError(baseMsg + familyHint);
                }
            })
            .catch(err => {
                console.error(`获取可转移列表失败 (mode: ${transferToSubstitute ? 'substitute' : 'contract'}):`, err);
                setError('加载列表失败，请检查网络或联系管理员。');
            })
            .finally(() => {
                setIsLoading(false);
            });
        }
    }, [open, sourceContract, sourceBillEndDate, transferToSubstitute]);

    const handleConfirm = () => {
        if (selectedId) {
            onConfirm({
                destinationType: transferToSubstitute ? 'bill' : 'contract',
                destinationId: selectedId
            });
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>转移保证金或余额</DialogTitle>
            <DialogContent>
                {adjustment && (
                    <Typography gutterBottom>
                        您正准备将一笔金额为
                        <Box component="span" sx={{ fontWeight: 'bold', color: 'error.main', mx: 0.5 }}>
                            ¥{parseFloat(adjustment.amount).toFixed(2)}
                        </Box>
                        的保证金退款进行转移。
                    </Typography>
                )}
                
                {sourceContract?.family_id && (
                    <Alert severity="info" sx={{ mt: 1, mb: 1 }}>
                        <Typography variant="body2">
                            已启用家庭关联（{sourceContract.family_id}），可转移到同一家庭下其他客户的合同
                        </Typography>
                        {familyMembers.length > 0 && (
                            <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                <Typography variant="caption" sx={{ mr: 0.5 }}>家庭成员：</Typography>
                                {familyMembers.map((member, idx) => (
                                    <Chip 
                                        key={idx} 
                                        label={member} 
                                        size="small" 
                                        variant="outlined"
                                        color="info"
                                    />
                                ))}
                            </Box>
                        )}
                    </Alert>
                )}
                
                <FormControlLabel
                    control={
                        <Switch
                            checked={transferToSubstitute}
                            onChange={(e) => {
                                setTransferToSubstitute(e.target.checked);
                                setSelectedId('');
                            }}
                            name="transferToSubstituteSwitch"
                        />
                    }
                    label="转移到客户名下其他替班账单"
                    sx={{ mt: 1, mb: 1, color: 'text.secondary' }}
                />

                <Box sx={{ mt: 2 }}>
                    {isLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100px' }}>
                            <CircularProgress />
                            <Typography sx={{ ml: 2 }}>正在加载可选目标...</Typography>
                        </Box>
                    ) : error ? (
                        <Alert severity="warning">{error}</Alert>
                    ) : (
                        <FormControl fullWidth>
                            <InputLabel id="destination-select-label">
                                {transferToSubstitute ? '请选择一个目标替班账单' : '请选择一个目标合同'}
                            </InputLabel>
                            <Select
                                labelId="destination-select-label"
                                id="destination-select"
                                value={selectedId}
                                label={transferToSubstitute ? '请选择一个目标替班账单' : '请选择一个目标合同'}
                                onChange={(e) => setSelectedId(e.target.value)}
                            >
                                {eligibleItems.map(item => (
                                    <MenuItem 
                                        key={item.id} 
                                        value={item.id}
                                        sx={{
                                            ...(item.is_same_customer === false && {
                                                borderLeft: '3px solid',
                                                borderLeftColor: 'info.main',
                                                pl: 1.5
                                            })
                                        }}
                                    >
                                        {item.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>取消</Button>
                <Button
                    onClick={handleConfirm}
                    variant="contained"
                    disabled={!selectedId || isLoading}
                >
                    确认转移
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default TransferDepositDialog;
