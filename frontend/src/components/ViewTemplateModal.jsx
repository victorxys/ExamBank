import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, CircularProgress, Alert } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import api from '../api/axios';

const ViewTemplateModal = ({ open, onClose, templateId }) => {
    const [template, setTemplate] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (open && templateId) {
            const fetchTemplate = async () => {
                setLoading(true);
                setError(null);
                setTemplate(null);
                try {
                    const response = await api.get(`/contract_templates/${templateId}`);
                    setTemplate(response.data);
                } catch (err) {
                    console.error("Error fetching template content:", err);
                    setError("无法加载模板内容。");
                } finally {
                    setLoading(false);
                }
            };
            fetchTemplate();
        }
    }, [open, templateId]);

    const renderContent = () => {
        if (loading) {
            return (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
                    <CircularProgress />
                </Box>
            );
        }
        if (error) {
            return <Alert severity="error">{error}</Alert>;
        }
        if (template) {
            return <ReactMarkdown>{template.content || '模板内容为空。'}</ReactMarkdown>;
        }
        return null;
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>
                查看模板: {template ? `${template.template_name} (v${template.version})` : '加载中...'}
            </DialogTitle>
            <DialogContent dividers>
                <Box sx={{ p: 1, border: '1px solid #e0e0e0', borderRadius: 1, minHeight: '300px', overflow: 'auto' }}>
                    {renderContent()}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} color="primary">
                    关闭
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ViewTemplateModal;
