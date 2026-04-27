import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, CircularProgress, Alert } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ReactMarkdown from 'react-markdown';
import api from '../api/axios';

const ViewTemplateModal = ({ open, onClose, templateId }) => {
    const [template, setTemplate] = useState(null);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
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

    const handleExportPdf = async () => {
        if (!template?.id) return;

        setExporting(true);
        setError(null);

        try {
            const response = await api.get(`/contract_templates/${template.id}/export-pdf`, {
                responseType: 'blob',
            });

            let filename = `${(template.template_name || '合同模板').replace(/[\\/:*?"<>|]/g, '_').trim() || '合同模板'}.pdf`;
            const contentDisposition = response.headers['content-disposition'];
            if (contentDisposition) {
                const utf8FilenameMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
                const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
                if (utf8FilenameMatch?.[1]) {
                    filename = decodeURIComponent(utf8FilenameMatch[1]);
                } else if (filenameMatch?.[1]) {
                    filename = decodeURIComponent(filenameMatch[1]);
                }
            }

            const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Error exporting template PDF:", err);
            setError(err.response?.data?.error || "导出PDF失败。");
        } finally {
            setExporting(false);
        }
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
                <Button
                    onClick={handleExportPdf}
                    color="primary"
                    variant="contained"
                    startIcon={exporting ? <CircularProgress size={18} color="inherit" /> : <DownloadIcon />}
                    disabled={!template || loading || exporting}
                >
                    导出PDF
                </Button>
                <Button onClick={onClose} color="primary">
                    关闭
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ViewTemplateModal;
