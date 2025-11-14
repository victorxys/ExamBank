import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Button, TextField, Typography, Paper, IconButton, MenuItem,
    Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
    Dialog, DialogTitle, DialogContent, DialogActions, Grid, InputAdornment,
    Select, FormControl, InputLabel, Checkbox, CircularProgress, Alert, Snackbar,
    TablePagination
} from '@mui/material';
import {
    Edit as EditIcon, Delete as DeleteIcon, Visibility as VisibilityIcon,
    CompareArrows as CompareArrowsIcon, Add as AddIcon, Search as SearchIcon
} from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { debounce } from 'lodash';
import api from '../api/axios';
import ViewTemplateModal from './ViewTemplateModal';
import DiffTemplateModal from './DiffTemplateModal';
import PageHeader from './PageHeader';

const ContractTemplateManager = () => {
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [totalTemplates, setTotalTemplates] = useState(0);
    const [newTemplate, setNewTemplate] = useState({
        template_name: '',
        contract_type: '',
        content: '',
        remark: ''
    });
    const [error, setError] = useState(null);
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // Search, Filter, and Selection states
    const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
    const [contractTypeFilter, setContractTypeFilter] = useState(searchParams.get('contract_type') || '');
    const [selectedTemplates, setSelectedTemplates] = useState([]);
    const [comparisonTemplates, setComparisonTemplates] = useState({ t1: null, t2: null });
    const [isComparing, setIsComparing] = useState(false);
    const [compareError, setCompareError] = useState(null);

    // Modals states
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [viewingTemplateId, setViewingTemplateId] = useState(null);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);

    const page = parseInt(searchParams.get('page') || '0', 10);
    const rowsPerPage = parseInt(searchParams.get('rowsPerPage') || '10', 10);

    const debouncedSetSearch = useCallback(debounce((value) => {
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            newParams.set('search', value);
            newParams.set('page', '0');
            return newParams;
        });
    }, 500), [setSearchParams]);

    useEffect(() => {
        // Sync URL search param to local state on initial load or URL change
        const urlSearch = searchParams.get('search') || '';
        if (urlSearch !== searchTerm) {
            setSearchTerm(urlSearch);
        }
    }, [searchParams]);

    useEffect(() => {
        // Debounce local search term changes to update URL
        if (searchTerm !== searchParams.get('search')) {
            debouncedSetSearch(searchTerm);
        }
        return () => debouncedSetSearch.cancel();
    }, [searchTerm, debouncedSetSearch, searchParams]);

    const fetchTemplates = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams(searchParams);
            params.set('page', page + 1);
            params.set('per_page', rowsPerPage);
            
            const response = await api.get('/contract_templates', { params });
            setTemplates(response.data.templates);
            setTotalTemplates(response.data.total);
        } catch (error) {
            console.error('Error fetching templates:', error);
            setError('无法加载模板列表。');
        } finally {
            setLoading(false);
        }
    }, [searchParams, page, rowsPerPage]);

    useEffect(() => {
        fetchTemplates();
    }, [fetchTemplates]);

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setSearchParams(prev => {
            const newParams = new URLSearchParams(prev);
            newParams.set(name, value);
            newParams.set('page', '0');
            return newParams;
        });
        if (name === 'contract_type') {
            setContractTypeFilter(value);
        }
    };

    const handleSelectTemplate = (template) => {
        const selectedIndex = selectedTemplates.findIndex(t => t.id === template.id);
        let newSelected = [];

        if (selectedIndex === -1) {
            if (selectedTemplates.length >= 2) {
                setCompareError("最多只能选择两个模板进行比较。");
                return;
            }
            if (selectedTemplates.length > 0 && selectedTemplates[0].contract_type !== template.contract_type) {
                setCompareError("只能选择相同合同类型的模板进行比较。");
                return;
            }
            newSelected = newSelected.concat(selectedTemplates, template);
        } else {
            newSelected = selectedTemplates.filter(t => t.id !== template.id);
        }
        setSelectedTemplates(newSelected);
    };

    const handleCompareSelected = async () => {
        if (selectedTemplates.length !== 2) return;
        setIsComparing(true);
        setCompareError(null);
        try {
            const [res1, res2] = await Promise.all([
                api.get(`/contract_templates/${selectedTemplates[0].id}`),
                api.get(`/contract_templates/${selectedTemplates[1].id}`)
            ]);
            setComparisonTemplates({ t1: res1.data, t2: res2.data });
            setIsDiffModalOpen(true);
        } catch (err) {
            console.error("Error fetching templates for comparison:", err);
            setCompareError("获取模板内容失败，无法比较。");
        } finally {
            setIsComparing(false);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setNewTemplate(prevState => ({ ...prevState, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        try {
            const response = await api.post('/contract_templates', newTemplate);
            if (response.status === 201) {
                fetchTemplates();
                setNewTemplate({ template_name: '', contract_type: '', content: '', remark: '' });
                setIsCreateModalOpen(false);
            }
        } catch (error) {
            console.error('Error creating template:', error);
            setError(error.response?.data?.error || '创建失败，请重试。');
        }
    };

    const handleView = (templateId) => {
        setViewingTemplateId(templateId);
        setIsViewModalOpen(true);
    };

    const handleEdit = (templateId) => {
        navigate(`/contract-templates/edit/${templateId}`);
    };

    const handleCompare = async (template) => {
        setIsComparing(true);
        setCompareError(null);
        try {
            const diffInfoResponse = await api.get(`/contract_templates/${template.id}/diff`);
            const previousTemplateId = diffInfoResponse.data.previous_template_id;
            if (!previousTemplateId) throw new Error("未找到可供对比的更早的模板");
            const [prevTemplateRes, currentTemplateRes] = await Promise.all([
                api.get(`/contract_templates/${previousTemplateId}`),
                api.get(`/contract_templates/${template.id}`)
            ]);
            setComparisonTemplates({ t1: prevTemplateRes.data, t2: currentTemplateRes.data });
            setIsDiffModalOpen(true);
        } catch (err) {
            console.error('Error fetching diff data:', err);
            setCompareError(err.response?.data?.error || '获取版本差异失败。');
        } finally {
            setIsComparing(false);
        }
    };

    const handleDelete = async (templateId) => {
        if (window.confirm('确定要删除这个模板吗？此操作不可撤销。')) {
            try {
                await api.delete(`/contract_templates/${templateId}`);
                fetchTemplates();
                setSelectedTemplates(prev => prev.filter(t => t.id !== templateId));
            } catch (error) {
                console.error('Error deleting template:', error);
                alert('删除失败: ' + (error.response?.data?.error || '未知错误'));
            }
        }
    };

    const headerActions = (
        <Box>
            <Button variant="contained" color="primary" onClick={handleCompareSelected} disabled={selectedTemplates.length !== 2 || isComparing} startIcon={isComparing ? <CircularProgress size={20} /> : <CompareArrowsIcon />} sx={{ mr: 2 }}>
                比较选中项
            </Button>
            <Button variant="contained" color="primary" startIcon={<AddIcon />} onClick={() => setIsCreateModalOpen(true)}>
                添加模板
            </Button>
        </Box>
    );

    return (
        <Box>
            <PageHeader title="合同模板管理" description="创建、编辑和管理所有合同模板。" actions={headerActions} />
            <Snackbar open={!!compareError} autoHideDuration={6000} onClose={() => setCompareError(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert onClose={() => setCompareError(null)} severity="error" sx={{ width: '100%' }}>{compareError}</Alert>
            </Snackbar>
            <Paper sx={{ p: 2, mb: 3 }}>
                <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} sm={8}>
                        <TextField fullWidth size="small" variant="outlined" placeholder="按模板名称、备注模糊搜索..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <FormControl fullWidth size="small">
                            <InputLabel>合同类型</InputLabel>
                            <Select name="contract_type" value={contractTypeFilter} onChange={handleFilterChange} label="合同类型">
                                <MenuItem value=""><em>全部类型</em></MenuItem>
                                <MenuItem value="nanny">育儿嫂合同</MenuItem>
                                <MenuItem value="maternity_nurse">月嫂合同</MenuItem>
                                <MenuItem value="nanny_trial">试工合同</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>
                </Grid>
            </Paper>
            <TableContainer component={Paper}>
                <Table aria-label="合同模板列表">
                    <TableHead>
                        <TableRow>
                            <TableCell padding="checkbox"></TableCell>
                            <TableCell>模板名称</TableCell>
                            <TableCell>合同类型</TableCell>
                            <TableCell>版本</TableCell>
                            <TableCell>备注</TableCell>
                            <TableCell>创建时间</TableCell>
                            <TableCell>更新时间</TableCell>
                            <TableCell align="right">操作</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={8} align="center" sx={{ py: 5 }}><CircularProgress /></TableCell></TableRow>
                        ) : (
                            templates.map((template) => {
                                const isSelected = selectedTemplates.some(t => t.id === template.id);
                                return (
                                    <TableRow hover key={template.id} selected={isSelected}>
                                        <TableCell padding="checkbox"><Checkbox color="primary" checked={isSelected} onChange={() => handleSelectTemplate(template)} /></TableCell>
                                        <TableCell>{template.template_name}</TableCell>
                                        <TableCell>{template.contract_type}</TableCell>
                                        <TableCell>{template.version}</TableCell>
                                        <TableCell>{template.remark}</TableCell>
                                        <TableCell>{new Date(template.created_at).toLocaleString()}</TableCell>
                                        <TableCell>{new Date(template.updated_at).toLocaleString()}</TableCell>
                                        <TableCell align="right">
                                            <IconButton size="small" onClick={() => handleView(template.id)}><VisibilityIcon /></IconButton>
                                            <IconButton size="small" onClick={() => handleEdit(template.id)}><EditIcon /></IconButton>
                                            <IconButton size="small" onClick={() => handleCompare(template)} disabled={template.version <= 1 || isComparing}><CompareArrowsIcon /></IconButton>
                                            <IconButton size="small" onClick={() => handleDelete(template.id)}><DeleteIcon /></IconButton>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
                <TablePagination
                    component="div"
                    count={totalTemplates}
                    page={page}
                    onPageChange={(e, newPage) => setSearchParams(prev => {
                        const newParams = new URLSearchParams(prev);
                        newParams.set('page', newPage.toString());
                        return newParams;
                    })}
                    rowsPerPage={rowsPerPage}
                    onRowsPerPageChange={(e) => setSearchParams(prev => {
                        const newParams = new URLSearchParams(prev);
                        newParams.set('rowsPerPage', parseInt(e.target.value, 10));
                        newParams.set('page', '0');
                        return newParams;
                    })}
                    labelRowsPerPage="每页行数:"
                />
            </TableContainer>
            <Dialog open={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} fullWidth maxWidth="md">
                <DialogTitle>创建新模板</DialogTitle>
                <DialogContent>
                    <Box component="form" id="create-template-form" onSubmit={handleSubmit} sx={{ pt: 1 }}>
                        {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}
                        <Grid container spacing={2}>
                            <Grid item xs={12} sm={6}><TextField fullWidth label="模板名称" name="template_name" value={newTemplate.template_name} onChange={handleInputChange} margin="normal" required autoFocus /></Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField select fullWidth label="合同类型" name="contract_type" value={newTemplate.contract_type} onChange={handleInputChange} margin="normal" required>
                                    <MenuItem value="nanny">育儿嫂合同</MenuItem>
                                    <MenuItem value="maternity_nurse">月嫂合同</MenuItem>
                                    <MenuItem value="nanny_trial">试工合同</MenuItem>
                                </TextField>
                            </Grid>
                            <Grid item xs={12}><TextField fullWidth label="备注" name="remark" multiline rows={2} value={newTemplate.remark} onChange={handleInputChange} margin="normal" /></Grid>
                            <Grid item xs={12}><TextField fullWidth label="内容 (Markdown)" name="content" multiline rows={15} value={newTemplate.content} onChange={handleInputChange} margin="normal" required /></Grid>
                        </Grid>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setIsCreateModalOpen(false)}>取消</Button>
                    <Button type="submit" form="create-template-form" variant="contained">创建</Button>
                </DialogActions>
            </Dialog>
            <ViewTemplateModal open={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} templateId={viewingTemplateId} />
            <DiffTemplateModal open={isDiffModalOpen} onClose={() => setIsDiffModalOpen(false)} template1={comparisonTemplates.t1} template2={comparisonTemplates.t2} />
        </Box>
    );
};

export default ContractTemplateManager;