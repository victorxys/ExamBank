import React, { useState, useEffect } from 'react';
import {
    Box, Typography, TextField, Button, IconButton, Chip, Dialog, DialogTitle,
    DialogContent, DialogActions, List, ListItem, ListItemText, ListItemSecondaryAction,
    Alert, Autocomplete, Divider
} from '@mui/material';
import {
    Edit as EditIcon, Save as SaveIcon, Cancel as CancelIcon, 
    Add as AddIcon, Link as LinkIcon, Group as GroupIcon
} from '@mui/icons-material';
import api from '../api/axios';

const FamilyIdManager = ({ contract, onUpdate }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [familyId, setFamilyId] = useState(contract.family_id || '');
    const [newFamilyId, setNewFamilyId] = useState('');
    const [loading, setLoading] = useState(false);
    const [familyContracts, setFamilyContracts] = useState([]);
    const [showFamilyDialog, setShowFamilyDialog] = useState(false);
    const [existingFamilies, setExistingFamilies] = useState([]);

    // 当contract更新时，同步更新familyId状态
    useEffect(() => {
        setFamilyId(contract.family_id || '');
    }, [contract.family_id]);

    // 获取现有家庭列表
    useEffect(() => {
        const fetchExistingFamilies = async () => {
            try {
                const response = await api.get('/contracts/families');
                setExistingFamilies(response.data.families || []);
            } catch (error) {
                console.error('Failed to fetch existing families:', error);
            }
        };
        fetchExistingFamilies();
    }, []);

    // 获取同一家庭的其他合同
    useEffect(() => {
        if (familyId) {
            fetchFamilyContracts();
        } else {
            setFamilyContracts([]);
        }
    }, [familyId]);

    const fetchFamilyContracts = async () => {
        if (!familyId) return;
        
        try {
            const response = await api.get(`/contracts/family/${familyId}`);
            // 排除当前合同
            const otherContracts = response.data.contracts.filter(c => c.id !== contract.id);
            setFamilyContracts(otherContracts);
        } catch (error) {
            console.error('Failed to fetch family contracts:', error);
            setFamilyContracts([]);
        }
    };

    const handleSave = async () => {
        try {
            setLoading(true);
            await api.put(`/contracts/${contract.id}/family`, {
                family_id: newFamilyId || null
            });
            
            setFamilyId(newFamilyId);
            setIsEditing(false);
            onUpdate?.();
            
            // 重新获取家庭合同列表
            if (newFamilyId) {
                await fetchFamilyContracts();
            }
        } catch (error) {
            console.error('Failed to update family ID:', error);
            alert('更新家庭ID失败：' + (error.response?.data?.error || error.message));
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = () => {
        setNewFamilyId(familyId);
        setIsEditing(false);
    };

    const handleEdit = () => {
        setNewFamilyId(familyId);
        setIsEditing(true);
    };

    const generateFamilyId = () => {
        // 基于客户姓名生成家庭ID建议
        const customerName = contract.customer_name || '';
        const timestamp = Date.now().toString().slice(-4);
        const suggestion = `${customerName.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, '')}_${timestamp}`;
        setNewFamilyId(suggestion);
    };

    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <GroupIcon fontSize="small" color="action" />
                <Typography variant="body2" color="text.secondary">
                    家庭ID
                </Typography>
                {!isEditing && (
                    <IconButton size="small" onClick={handleEdit}>
                        <EditIcon fontSize="small" />
                    </IconButton>
                )}
            </Box>

            {isEditing ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Autocomplete
                        freeSolo
                        options={existingFamilies}
                        value={newFamilyId}
                        onInputChange={(event, newValue) => setNewFamilyId(newValue || '')}
                        renderInput={(params) => (
                            <TextField
                                {...params}
                                size="small"
                                placeholder="输入或选择家庭ID"
                                helperText="可以输入新的家庭ID或选择现有的家庭"
                            />
                        )}
                    />
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={generateFamilyId}
                            startIcon={<AddIcon />}
                        >
                            生成建议
                        </Button>
                        <Button
                            size="small"
                            variant="contained"
                            onClick={handleSave}
                            disabled={loading}
                            startIcon={<SaveIcon />}
                        >
                            保存
                        </Button>
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={handleCancel}
                            startIcon={<CancelIcon />}
                        >
                            取消
                        </Button>
                    </Box>
                </Box>
            ) : (
                <Box>
                    {familyId ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Chip
                                label={familyId}
                                size="small"
                                color="primary"
                                variant="outlined"
                                icon={<GroupIcon />}
                            />
                            {familyContracts.length > 0 && (
                                <Button
                                    size="small"
                                    variant="text"
                                    onClick={() => setShowFamilyDialog(true)}
                                    startIcon={<LinkIcon />}
                                >
                                    查看家庭合同 ({familyContracts.length})
                                </Button>
                            )}
                        </Box>
                    ) : (
                        <Typography variant="body1" color="text.secondary">
                            未设置家庭ID
                        </Typography>
                    )}
                </Box>
            )}

            {/* 家庭合同列表对话框 */}
            <Dialog
                open={showFamilyDialog}
                onClose={() => setShowFamilyDialog(false)}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle>
                    家庭合同列表 - {familyId}
                </DialogTitle>
                <DialogContent>
                    <Alert severity="info" sx={{ mb: 2 }}>
                        以下是同一家庭的其他合同，考勤表将会合并显示
                    </Alert>
                    <List>
                        {familyContracts.map((familyContract, index) => (
                            <React.Fragment key={familyContract.id}>
                                <ListItem>
                                    <ListItemText
                                        primary={`${familyContract.customer_name} - ${familyContract.employee_name}`}
                                        secondary={
                                            <Box>
                                                <Typography variant="body2" color="text.secondary">
                                                    合同类型: {familyContract.contract_type_label}
                                                </Typography>
                                                <Typography variant="body2" color="text.secondary">
                                                    服务期间: {familyContract.start_date} ~ {familyContract.end_date}
                                                </Typography>
                                                <Typography variant="body2" color="text.secondary">
                                                    状态: {familyContract.status}
                                                </Typography>
                                            </Box>
                                        }
                                    />
                                    <ListItemSecondaryAction>
                                        <Chip
                                            label={familyContract.status}
                                            size="small"
                                            color={familyContract.status === 'active' ? 'success' : 'default'}
                                        />
                                    </ListItemSecondaryAction>
                                </ListItem>
                                {index < familyContracts.length - 1 && <Divider />}
                            </React.Fragment>
                        ))}
                    </List>
                    {familyContracts.length === 0 && (
                        <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ py: 2 }}>
                            暂无其他家庭合同
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowFamilyDialog(false)}>
                        关闭
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default FamilyIdManager;