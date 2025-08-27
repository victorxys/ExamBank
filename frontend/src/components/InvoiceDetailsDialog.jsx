// frontend/src/components/InvoiceDetailsDialog.jsx (全新版本，支持多发票)

import React, { useState, useEffect } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle,
  TextField, Grid, Box, Typography, List, ListItem, ListItemText,
  IconButton, Divider, Tooltip
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon, Save as SaveIcon, Cancel as CancelIcon, Info as InfoIcon } from '@mui/icons-material';
import { v4 as uuidv4 } from 'uuid';

const InvoiceDetailsDialog = ({ open, onClose, onSave, invoices: initialInvoices = [],invoiceBalance }) => {
    const [invoices, setInvoices] = useState([]);
    const [isEditing, setIsEditing] = useState(false);
    const [currentItem, setCurrentItem] = useState(null);

    useEffect(() => {
        if (open) {
            setInvoices(initialInvoices.map(inv => ({ ...inv, listId: inv.id || uuidv4() })));
        }
    }, [initialInvoices, open]);

    const renderBalanceInfo = () => {
        if (!invoiceBalance) return null;

        const handleAmountClick = (amount) => {
            if (isEditing && currentItem) {
                const numericAmount = parseFloat(amount);
                if (!isNaN(numericAmount)) {
                    setCurrentItem(prev => ({ ...prev, amount: numericAmount.toFixed(2) }));
                }
            }
        };

        const balanceItems = [
            { label: '本期应开', value: invoiceBalance.total_invoiceable_amount },
            { label: '历史欠票', value: invoiceBalance.total_carried_forward, details:invoiceBalance.carried_forward_breakdown },
            { label: '总计待开', value: invoiceBalance.remaining_un_invoiced, isBold: true },
        ];

        return (
            <Box sx={{ p: 2, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1,bgcolor: 'grey.50' }}>
                <Grid container spacing={1} alignItems="center">
                    {balanceItems.map(({ label, value, details, isBold }) => (
                        <Grid item xs={4} key={label}>
                            <Typography variant="caption" color="text.secondary">{label}</Typography>
                            <Typography
                                variant="body1"
                                sx={{
                                    fontWeight: isBold ? 'bold' : 500,
                                    color: isBold ? 'error.main' : 'text.primary',
                                    cursor: isEditing ? 'pointer' : 'default',
                                    '&:hover': { color: isEditing ? 'primary.main' : 'inherit' }
                                }}
                                onClick={() => handleAmountClick(value)}
                            >
                                ¥{parseFloat(value || 0).toFixed(2)}
                                {details && details.length > 0 && (
                                    <Tooltip
                                        arrow
                                        title={
                                            <React.Fragment>
                                                <Typography variant="caption" sx={{ fontWeight:'bold', color: 'common.white', display: 'block', mb: 1 }}>历史欠票明细</Typography>
                                                {details.map((item, index) => (
                                                    <Typography key={index} variant="body2" sx={{fontFamily: 'monospace', color: 'grey.200' }}>{item.month}月: ¥{item.unpaid_amount}</Typography>
                                                ))}
                                            </React.Fragment>
                                        }
                                    >
                                        <InfoIcon sx={{ fontSize: '1rem', color: 'action.active',ml: 0.5, verticalAlign: 'middle', cursor: 'help' }} />
                                    </Tooltip>
                                )}
                            </Typography>
                        </Grid>
                    ))}
                </Grid>
            </Box>
        );
    };

    const handleAddNew = () => {
        const defaultAmount = parseFloat(invoiceBalance?.remaining_un_invoiced || 0).toFixed(2);
        setCurrentItem({ listId: uuidv4(), invoice_number: '', amount: defaultAmount, issue_date:new Date(), notes: '' });
        setIsEditing(true);
    };

    const handleEdit = (invoice) => {
        setCurrentItem({ ...invoice, issue_date: invoice.issue_date ? new Date(invoice.issue_date) : new Date() });
        setIsEditing(true);
    };

    const handleDelete = (listIdToDelete) => {
        if (window.confirm('确定要删除这条发票记录吗？')) {
            setInvoices(prev => prev.filter(inv => inv.listId !== listIdToDelete));
        }
    };

    const handleSaveItem = () => {
        const isNew = !invoices.some(inv => inv.listId === currentItem.listId);
        let updatedInvoices;
        if (isNew) {
            updatedInvoices = [...invoices, currentItem];
        } else {
            updatedInvoices = invoices.map(inv => (inv.listId === currentItem.listId ? currentItem : inv));
        }
        setInvoices(updatedInvoices);
        setIsEditing(false);
        setCurrentItem(null);
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setCurrentItem(null);
    };

    const handleDialogClose = () => {
        setIsEditing(false);
        setCurrentItem(null);
        onClose();
    };

    const handleDialogSave = () => {
        const finalInvoices = invoices.map(({ listId, ...rest }) => ({
            ...rest,
            issue_date: rest.issue_date ? new Date(rest.issue_date).toISOString().split('T')[0] : null
        }));
        onSave(finalInvoices);
        handleDialogClose();
    };

    const renderInvoiceForm = () => (
        <>
            <DialogTitle>{currentItem?.id ? '编辑发票记录' : '新增发票记录'}</DialogTitle>
            <DialogContent>
                <Grid container spacing={2} sx={{ pt: 1 }}>
                    <Grid item xs={12}><TextField fullWidth label="发票号码" value={currentItem.invoice_number || ''} onChange={(e) =>setCurrentItem(p => ({ ...p, invoice_number: e.target.value }))} /></Grid>
                    <Grid item xs={12}><TextField fullWidth label="发票金额" type="number" value={currentItem.amount || ''} onChange={(e) => setCurrentItem(p => ({ ...p, amount: e.target.value }))} InputProps={{ startAdornment: '¥' }} /></Grid>
                    <Grid item xs={12}><DatePicker label="开票日期" value={currentItem.issue_date} onChange={(d) => setCurrentItem(p => ({...p, issue_date: d }))} sx={{ width: '100%' }} /></Grid>
                    <Grid item xs={12}><TextField multiline rows={2} fullWidth label="备注" value={currentItem.notes || ''} onChange={(e) => setCurrentItem(p => ({ ...p, notes: e.target.value }))} /></Grid>
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleCancelEdit} startIcon={<CancelIcon />}>取消</Button>
                <Button onClick={handleSaveItem} variant="contained" startIcon={<SaveIcon />}>保存此条记录</Button>
            </DialogActions>
        </>
    );

    const renderInvoiceList = () => (
        <>
            <DialogTitle>管理发票记录</DialogTitle>
            <DialogContent>
                {renderBalanceInfo()}
                <List>
                    {invoices.length === 0 ? (
                        <Typography color="text.secondary" align="center" sx={{ p: 2 }}>暂无发票记录</Typography>
                    ) : (
                        invoices.map(inv => (
                            <ListItem key={inv.listId} secondaryAction={
                                <>
                                    <Tooltip title="编辑">
                                        <IconButton edge="end" onClick={() => handleEdit(inv)}><EditIcon /></IconButton>
                                    </Tooltip>
                                    <Tooltip title="删除">
                                        <IconButton edge="end" onClick={() => handleDelete(inv.listId)}><DeleteIcon /></IconButton>
                                    </Tooltip>
                                </>
                            }>
                                <ListItemText
                                    primary={`¥ ${inv.amount || '0.00'}`}
                                    secondary={`号码: ${inv.invoice_number || '无'} | 日期: ${inv.issue_date ? new Date(inv.issue_date).toLocaleDateString() : '无'} | 备注: ${inv.notes || '无'}`}
                                />
                            </ListItem>
                        ))
                    )}
                </List>
                <Divider />
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                    <Button onClick={handleAddNew} startIcon={<AddIcon />}>添加一张新发票</Button>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleDialogClose}>关闭</Button>
                <Button onClick={handleDialogSave} variant="contained">确认并保存所有更改</Button>
            </DialogActions>
        </>
    );

    return (
        <Dialog open={open} onClose={handleDialogClose} maxWidth="sm" fullWidth>
            {isEditing ? renderInvoiceForm() : renderInvoiceList()}
        </Dialog>
    );
};

export default InvoiceDetailsDialog;