// frontend/src/components/TransferDepositDialog.jsx

import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography,
    Box, CircularProgress, FormControl, InputLabel, Select, MenuItem, Alert
} from '@mui/material';
import api from '../api/axios';

const TransferDepositDialog = ({ open, onClose, adjustment, sourceContract, onConfirm }) => {
    const [eligibleContracts, setEligibleContracts] = useState([]);
    const [selectedContractId, setSelectedContractId] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (open && sourceContract) {
            setIsLoading(true);
            setError('');
            setEligibleContracts([]);
            setSelectedContractId('');

            api.get('/billing/contracts/eligible-for-transfer', {
                params: {
                    customer_name: sourceContract.customer_name,
                    exclude_contract_id: sourceContract.contract_id
                }
            })
            .then(response => {
                setEligibleContracts(response.data);
                if (response.data.length === 0) {
                    setError('该客户名下没有其他可供转移的有效合同。');
                }
            })
            .catch(err => {
                console.error("获取可转移合同列表失败:", err);
                setError('加载合同列表失败，请检查网络或联系管理员。');
            })
            .finally(() => {
                setIsLoading(false);
            });
        }
    }, [open, sourceContract]);

    const handleConfirm = () => {
        if (selectedContractId) {
            onConfirm(selectedContractId);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>转移保证金</DialogTitle>
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
                <Box sx={{ mt: 3 }}>
                    {isLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100px' }}>
                            <CircularProgress />
                            <Typography sx={{ ml: 2 }}>正在加载可选合同...</Typography>
                        </Box>
                    ) : error ? (
                        <Alert severity="warning">{error}</Alert>
                    ) : (
                        <FormControl fullWidth>
                            <InputLabel id="destination-contract-select-label">请选择一个目标合同</InputLabel>
                            <Select
                                labelId="destination-contract-select-label"
                                id="destination-contract-select"
                                value={selectedContractId}
                                label="请选择一个目标合同"
                                onChange={(e) => setSelectedContractId(e.target.value)}
                            >
                                {eligibleContracts.map(contract => (
                                    <MenuItem key={contract.id} value={contract.id}>
                                        {contract.label}
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
                    disabled={!selectedContractId || isLoading}
                >
                    确认转移
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default TransferDepositDialog;