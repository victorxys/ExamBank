    import React, { useState, useEffect } from 'react';
    import {
        Box, Button, Card, CardContent, CardActions, TextField, Typography,
        Grid, Paper, List, ListItem, ListItemText, IconButton, MenuItem
    } from '@mui/material';
    
    import { Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
    import ReactMarkdown from 'react-markdown';
    import api from '../api/axios'

    const ContractTemplateManager = () => {
        const [templates, setTemplates] = useState([]);
        const [newTemplate, setNewTemplate] = useState({
            template_name: '',
            contract_type: '',
            content: ''
        });
        const [editingTemplate, setEditingTemplate] = useState(null);
        const [error, setError] = useState(null);

        useEffect(() => {
            fetchTemplates();
        }, []);

        const fetchTemplates = async () => {
            try {
                const response = await api.get('/contract_templates');
                setTemplates(response.data);
            } catch (error) {
                console.error('Error fetching templates:', error);
            }
        };

        const handleInputChange = (e, isEditing = false) => {
            const { name, value } = e.target;
            if (isEditing) {
                setEditingTemplate(prevState => ({
                    ...prevState,
                    [name]: value
                }));
            } else {
                setNewTemplate(prevState => ({
                    ...prevState,
                    [name]: value
                }));
            }
        };

        const handleSubmit = async (e) => {
            setError(null);
            e.preventDefault();
            const url = editingTemplate ? `/api/contract_templates/${editingTemplate.id}` : '/api/contract_templates';
            const method = editingTemplate ? 'PUT' : 'POST';
            const body = editingTemplate ? JSON.stringify(editingTemplate) : JSON.stringify (newTemplate);

            try {
                let response;
                if (editingTemplate) {
                    response = await api.put(`/contract_templates/${editingTemplate.id}`, editingTemplate);
                } else {
                    response = await api.post('/contract_templates', newTemplate);
                }

                if (response.status === 200 || response.status === 201) {
                    fetchTemplates();
                    setNewTemplate({ template_name: '', contract_type: '', content: '' });
                    setEditingTemplate(null);
                }
            } catch (error) {
                console.error('Error saving template:', error);
                if (error.response && error.response.data && error.response.data.error) {
                    setError(error.response.data.error);
                } else {
                    setError('An unexpected error occurred. Please try again.');
                }
            }
        };

        const handleEdit = (template) => {
            setEditingTemplate(template);
        };

        const handleDelete = async (templateId) => {
            try {
                const response = await api.delete(`/contract_templates/${templateId}`);
                if (response.status === 200) {
                    fetchTemplates();
                }
            } catch (error) {
                console.error('Error deleting template:', error);
                if (error.response && error.response.data && error.response.data.error) {
                    setError(error.response.data.error);
                } else {
                    setError('An unexpected error occurred. Please try again.');
                }
            }
        };

        return (
            <Box sx={{ p: 3 }}>
                <Typography variant="h4" gutterBottom>
                    合同模板管理
                </Typography>
                <Grid container spacing={3}>
                    <Grid item xs={12} md={4}>
                        <Card>
                            <CardContent>
                                <Typography variant="h6">{editingTemplate ? '编辑模板' : '创建新模板'}</Typography>
                                <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
                                    {error && (
                                        <Typography color="error" sx={{ mb: 2 }}>
                                            {error}
                                        </Typography>
                                    )}
                                    <TextField
                                        fullWidth
                                        label="模板名称"
                                        name="template_name"
                                        value={editingTemplate ? editingTemplate.template_name : newTemplate.template_name}
                                        onChange={(e) => handleInputChange(e, !!editingTemplate)}
                                        margin="normal"
                                        required
                                    />
                                    <TextField
                                        select
                                        fullWidth
                                        label="合同类型"
                                        name="contract_type"
                                        value={editingTemplate ? editingTemplate.contract_type : newTemplate.contract_type}
                                        onChange={(e) => handleInputChange(e, !!editingTemplate)}
                                        margin="normal"
                                        required
                                    >
                                        <MenuItem value="nanny">育儿嫂合同</MenuItem>
                                        <MenuItem value="maternity_nurse">月嫂合同</MenuItem>
                                        <MenuItem value="nanny_trial">试工合同</MenuItem>
                                    </TextField>
                                    <TextField
                                        fullWidth
                                        label="内容 (Markdown)"
                                        name="content"
                                        multiline
                                        rows={10}
                                        value={editingTemplate ? editingTemplate.content : newTemplate.content}
                                        onChange={(e) => handleInputChange(e, !!editingTemplate)}
                                        margin="normal"
                                        required
                                    />
                                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt:2}}>
                                        {editingTemplate && (
                                            <Button onClick={() => setEditingTemplate(null)} sx={{ mr: 1 }}>
                                                取消
                                            </Button>
                                        )}
                                        <Button type="submit" variant="contained">
                                            {editingTemplate ? '更新模板' : '创建模板'}
                                        </Button>
                                    </Box>
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid item xs={12} md={8}>
                        <Paper>
                            <List>
                                {templates.map(template => (
                                    <ListItem
                                        key={template.id}
                                        secondaryAction={
                                            <Box>
                                                <IconButton edge="end" aria-label="edit" onClick={() => handleEdit(template)}>
                                                    <EditIcon />
                                                </IconButton>
                                                <IconButton edge="end" aria-label="delete" onClick={() => handleDelete(template.id)}>
                                                    <DeleteIcon />
                                                </IconButton>
                                            </Box>
                                        }
                                    >
                                        <ListItemText
                                            primary={template.template_name}
                                            secondary={`类型: ${template.contract_type} | 版本: ${template.version}`}
                                        />
                                    </ListItem>
                                ))}
                            </List>
                        </Paper>
                    </Grid>
                </Grid>
            </Box>
        );
    };

    export default ContractTemplateManager;