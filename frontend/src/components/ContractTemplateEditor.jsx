import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Button, TextField, Typography, CircularProgress, Alert,
    ToggleButton, ToggleButtonGroup, Grid, Paper, MenuItem
} from '@mui/material';
import ReactMarkdown from 'react-markdown';
import api from '../api/axios';
import PageHeader from './PageHeader'; // 引入PageHeader

const ContractTemplateEditor = () => {
    const { templateId } = useParams();
    const navigate = useNavigate();

    const [template, setTemplate] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [editorMode, setEditorMode] = useState('split'); // 'split' or 'source'
    const [isSaving, setIsSaving] = useState(false);
    const [isTemplateInUse, setIsTemplateInUse] = useState(false);

    useEffect(() => {
        const fetchTemplateData = async () => {
            try {
                const response = await api.get(`/contract_templates/${templateId}`);
                setTemplate(response.data);
                setIsTemplateInUse(response.data.is_in_use);
            } catch (err) {
                console.error('Error fetching template data:', err);
                setError('加载模板数据失败。');
            } finally {
                setLoading(false);
            }
        };

        fetchTemplateData();
    }, [templateId]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setTemplate(prev => ({ ...prev, [name]: value }));
    };

    const handleEditorModeChange = (event, newMode) => {
        if (newMode !== null) {
            setEditorMode(newMode);
        }
    };

    const handleOverwriteSave = async () => {
        setIsSaving(true);
        setError(null);
        try {
            await api.put(`/contract_templates/${templateId}`, {
                template_name: template.template_name,
                contract_type: template.contract_type,
                content: template.content,
                remark: template.remark
            });
            alert('模板覆盖保存成功！');
            navigate('/contract-templates');
        } catch (err) {
            console.error('Error overwriting template:', err);
            setError('覆盖保存失败。' + (err.response?.data?.error || err.message));
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveNewVersion = async () => {
        setIsSaving(true);
        setError(null);
        try {
            const response = await api.post(`/contract_templates/${templateId}/save_new_version`, {
                content: template.content,
                remark: template.remark,
            });
            alert('模板另存为新版本成功！新版本ID: ' + response.data.id);
            navigate('/contract-templates');
        } catch (err) {
            console.error('Error saving new version:', err);
            setError('另存为新版本失败。' + (err.response?.data?.error || err.message));
        } finally {
            setIsSaving(false);
        }
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="error">{error}</Alert>
                <Button onClick={() => navigate('/contract-templates')} sx={{ mt: 2 }}>返回模板列表</Button>
            </Box>
        );
    }

    if (!template) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="warning">模板数据为空。</Alert>
                <Button onClick={() => navigate('/contract-templates')} sx={{ mt: 2 }}>返回模板列表</Button>
            </Box>
        );
    }

    const headerActions = (
        <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
                variant="outlined"
                onClick={() => navigate('/contract-templates')}
                disabled={isSaving}
            >
                取消
            </Button>
            <Button
                variant="contained"
                color="secondary"
                onClick={handleSaveNewVersion}
                disabled={isSaving}
            >
                {isSaving ? <CircularProgress size={24} /> : '另存为新版'}
            </Button>
            <Button
                variant="contained"
                color="primary"
                onClick={handleOverwriteSave}
                disabled={isSaving || isTemplateInUse}
            >
                {isSaving ? <CircularProgress size={24} /> : '覆盖保存'}
            </Button>
        </Box>
    );

    return (
        <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
            <PageHeader
                title="编辑合同模板"
                description={`模板: ${template.template_name} (v${template.version})`}
                actions={headerActions}
            />

            {isTemplateInUse && (
                <Alert severity="warning" sx={{ mt: 2, mb: 1 }}>
                    此模板已被现有合同使用，为避免影响已生效合同，您只能“另存为新版”。
                </Alert>
            )}

            <Paper sx={{ p: 3, mt: 2, display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="模板名称"
                            name="template_name"
                            value={template.template_name || ''}
                            onChange={handleInputChange}
                            margin="dense"
                            required
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            select
                            fullWidth
                            label="合同类型"
                            name="contract_type"
                            value={template.contract_type || ''}
                            onChange={handleInputChange}
                            margin="dense"
                            required
                        >
                            <MenuItem value="nanny">育儿嫂合同</MenuItem>
                            <MenuItem value="maternity_nurse">月嫂合同</MenuItem>
                            <MenuItem value="nanny_trial">试工合同</MenuItem>
                        </TextField>
                    </Grid>
                    <Grid item xs={12}>
                        <TextField
                            fullWidth
                            label="备注"
                            name="remark"
                            multiline
                            rows={2}
                            value={template.remark || ''}
                            onChange={handleInputChange}
                            margin="dense"
                        />
                    </Grid>
                </Grid>

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3, mb: 2 }}>
                    <Typography variant="h6">模板内容 (Markdown)</Typography>
                    <ToggleButtonGroup
                        value={editorMode}
                        exclusive
                        onChange={handleEditorModeChange}
                        aria-label="text editor mode"
                        size="small"
                    >
                        <ToggleButton value="split" aria-label="split view">
                            分屏预览
                        </ToggleButton>
                        <ToggleButton value="source" aria-label="source view">
                            源码模式
                        </ToggleButton>
                    </ToggleButtonGroup>
                </Box>

                <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                    {editorMode === 'split' ? (
                        <Grid container spacing={2} sx={{ flexGrow: 1 }}>
                            <Grid item xs={12} md={6} sx={{ display: 'flex', flexDirection: 'column' }}>
                                <TextField
                                    fullWidth
                                    label="Markdown 源码"
                                    name="content"
                                    multiline
                                    value={template.content || ''}
                                    onChange={handleInputChange}
                                    variant="outlined"
                                    sx={{
                                        flexGrow: 1,
                                        '& .MuiInputBase-root': {
                                            height: '100%',
                                            alignItems: 'flex-start'
                                        }
                                    }}
                                />
                            </Grid>
                            <Grid item xs={12} md={6} sx={{ display: 'flex', flexDirection: 'column' }}>
                                <Paper sx={{ p: 2, flexGrow: 1, overflow: 'auto', border: '1px solid #e0e0e0' }}>
                                    <Typography variant="subtitle1" gutterBottom>预览</Typography>
                                    <ReactMarkdown>{template.content || ''}</ReactMarkdown>
                                </Paper>
                            </Grid>
                        </Grid>
                    ) : (
                        <TextField
                            fullWidth
                            label="Markdown 源码"
                            name="content"
                            multiline
                            value={template.content || ''}
                            onChange={handleInputChange}
                            variant="outlined"
                            sx={{
                                flexGrow: 1,
                                '& .MuiInputBase-root': {
                                    height: '100%',
                                    alignItems: 'flex-start'
                                }
                            }}
                        />
                    )}
                </Box>
            </Paper>
        </Box>
    );
};

export default ContractTemplateEditor;
