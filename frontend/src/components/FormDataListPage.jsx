import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/axios';
import {
    Container,
    Card,
    CardContent,
    CardHeader,
    Typography,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TablePagination,
    TextField,
    CircularProgress,
    Alert,
    Button,
    Box
} from '@mui/material';
import PageHeader from './PageHeader';
import { format } from 'date-fns';

const FormDataListPage = () => {
    const { formToken } = useParams();
    const [formDataEntries, setFormDataEntries] = useState([]);
    const [formName, setFormName] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchFormData = async () => {
            try {
                setLoading(true);
                // 1. 获取表单信息以获取 form_id 和 formName
                const formResponse = await api.get(`/dynamic_forms/${formToken}`);
                const formId = formResponse.data.id;
                setFormName(formResponse.data.name);

                // 2. 获取该表单的所有提交数据
                const dataResponse = await api.get(`/form-data/list/${formId}`);
                // Sort by created_at descending (newest first)
                const sortedData = dataResponse.data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                setFormDataEntries(sortedData);
            } catch (err) {
                console.error('获取表单数据列表失败:', err);
                setError(err.response?.data?.message || err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchFormData();
    }, [formToken]);

    // Filter and Search Logic
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    const filteredEntries = formDataEntries.filter(entry => {
        const name = entry.data?.['field_1'] || entry.data?.['姓名'] || entry.user_id || '匿名';
        return name.toLowerCase().includes(searchTerm.toLowerCase());
    });

    const paginatedEntries = filteredEntries.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

    const handleChangePage = (event, newPage) => {
        setPage(newPage);
    };

    const handleChangeRowsPerPage = (event) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
    };

    if (loading) {
        return <Container sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Container>;
    }

    if (error) {
        return <Container sx={{ mt: 4 }}><Alert severity="error">加载表单数据列表失败: {error}</Alert></Container>;
    }

    return (
        <Box sx={{ width: '100%', height: '100%' }}>
            <PageHeader
                title={`"${formName}" 的提交数据`}
                description="查看所有用户提交的表单数据。"
                actions={
                    <Button
                        variant="outlined"
                        component={Link}
                        to={`/forms/${formToken}`}
                        sx={{
                            backgroundColor: 'white',
                            color: 'primary.main',
                            '&:hover': {
                                backgroundColor: '#f6f9fc',
                            },
                        }}
                    >
                        填写新表单
                    </Button>
                }
            />

            <Card sx={{
                boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)',
                backgroundColor: 'white',
                borderRadius: '0.375rem'
            }}>
                <CardHeader
                    sx={{ p: 3 }}
                    title={
                        <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
                            <Box display="flex" gap={2} flex={1}>
                                <TextField
                                    size="small"
                                    placeholder="搜索提交者姓名"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    fullWidth
                                    sx={{
                                        '& .MuiOutlinedInput-root': {
                                            borderRadius: '0.375rem',
                                        }
                                    }}
                                />
                            </Box>
                        </Box>
                    }
                />
                <CardContent sx={{ p: 0 }}>
                    <TableContainer>
                        <Table sx={{ minWidth: 650 }} aria-label="form data table">
                            <TableHead>
                                <TableRow>
                                    <TableCell>提交时间</TableCell>
                                    <TableCell>提交人</TableCell>
                                    <TableCell align="center">操作</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {paginatedEntries.length > 0 ? (
                                    paginatedEntries.map((entry) => (
                                        <TableRow
                                            key={entry.id}
                                            hover
                                            sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                                        >
                                            <TableCell component="th" scope="row">
                                                {format(new Date(entry.created_at), 'yyyy-MM-dd HH:mm')}
                                            </TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>
                                                {entry.data?.['field_1'] || entry.data?.['姓名'] || entry.user_id || '匿名'}
                                            </TableCell>
                                            <TableCell align="center">
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    component={Link}
                                                    to={`/forms/${formToken}/${entry.id}`}
                                                >
                                                    查看/编辑
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={3} align="center" sx={{ py: 3 }}>
                                            <Typography>此表单暂无提交数据。</Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                    <TablePagination
                        component="div"
                        count={filteredEntries.length}
                        page={page}
                        onPageChange={handleChangePage}
                        rowsPerPage={rowsPerPage}
                        onRowsPerPageChange={handleChangeRowsPerPage}
                        rowsPerPageOptions={[5, 10, 25]}
                        labelRowsPerPage="每页行数:"
                        labelDisplayedRows={({ from, to, count }) => `${from}-${to} 共 ${count}`}
                    />
                </CardContent>
            </Card>
        </Box>
    );
};

export default FormDataListPage;
