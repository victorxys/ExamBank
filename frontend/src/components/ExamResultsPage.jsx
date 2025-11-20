import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
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
    Paper,
    CircularProgress,
    Alert,
    Button,
    Box
} from '@mui/material';
import PageHeader from './PageHeader';

// Helper function to format duration from seconds to a readable string
const formatDuration = (seconds) => {
    if (seconds === null || seconds === undefined) {
        return 'N/A';
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}分 ${remainingSeconds}秒`;
};


const ExamResultsPage = () => {
    const { form_token } = useParams();
    const [form, setForm] = useState(null);
    const [submissions, setSubmissions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchResults = async () => {
            try {
                setLoading(true);
                // 1. 根据 token 获取表单详情 (包括 form_id)
                const formResponse = await api.get(`/dynamic_forms/${form_token}`);
                setForm(formResponse.data);
                const formId = formResponse.data.id;

                // 2. 使用 form_id 获取提交列表
                const submissionsResponse = await api.get(`/form-data/list/${formId}`);
                setSubmissions(submissionsResponse.data);

            } catch (err) {
                console.error('获取考试结果失败:', err);
                setError(err.response?.data?.message || err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchResults();
    }, [form_token]);

    // Filter and Search Logic
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    const filteredSubmissions = submissions.filter(submission => {
        const name = submission.data?.['field_1'] || submission.data?.['姓名'] || submission.user_id || '匿名';
        return name.toLowerCase().includes(searchTerm.toLowerCase());
    });

    const paginatedSubmissions = filteredSubmissions.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

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
        return <Container sx={{ mt: 4 }}><Alert severity="error">加载考试结果失败: {error}</Alert></Container>;
    }

    return (
        <Box sx={{ width: '100%', height: '100%' }}>
            <PageHeader
                title={form ? `考试结果: ${form.name}` : '考试结果'}
                description="查看所有考生的考试成绩、用时和提交时间。"
                actions={
                    <Button
                        variant="contained"
                        component={Link}
                        to={`/forms/${form_token}`}
                        sx={{
                            backgroundColor: 'white',
                            color: 'primary.main',
                            '&:hover': {
                                backgroundColor: '#f6f9fc',
                            },
                        }}
                    >
                        参加考试
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
                        <Table sx={{ minWidth: 650 }} aria-label="exam results table">
                            <TableHead>
                                <TableRow>
                                    <TableCell>提交者</TableCell>
                                    <TableCell align="right">分数</TableCell>
                                    <TableCell align="right">考试用时</TableCell>
                                    <TableCell align="right">提交时间</TableCell>
                                    <TableCell align="center">操作</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {paginatedSubmissions.length > 0 ? (
                                    paginatedSubmissions.map((submission) => (
                                        <TableRow
                                            key={submission.id}
                                            hover
                                            sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                                        >
                                            <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                                                {submission.data?.['field_1'] || submission.data?.['姓名'] || submission.user_id || '匿名'}
                                            </TableCell>
                                            <TableCell align="right">
                                                <Typography color={submission.score >= form?.passing_score ? 'green' : 'red'} fontWeight="bold">
                                                    {submission.score !== null ? `${submission.score}` : '未评分'}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right">{formatDuration(submission.data?.info_filling_duration)}</TableCell>
                                            <TableCell align="right">{new Date(submission.created_at).toLocaleString()}</TableCell>
                                            <TableCell align="center">
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    component={Link}
                                                    to={`/results/${submission.id}`} // 链接到单次提交的详情页
                                                >
                                                    查看详情
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={5} align="center" sx={{ py: 3 }}>
                                            <Typography>暂无提交记录。</Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                    <TablePagination
                        component="div"
                        count={filteredSubmissions.length}
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

export default ExamResultsPage;
