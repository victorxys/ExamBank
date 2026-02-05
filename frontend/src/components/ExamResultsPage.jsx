import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import {
    Container,
    Card,
    CardContent,
    Typography,
    CircularProgress,
    Alert,
    Button,
    Box,
    Tooltip,
} from '@mui/material';
import PageHeader from './PageHeader';
import { MaterialReactTable } from 'material-react-table';
import { format } from 'date-fns';

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
    const navigate = useNavigate();
    const [form, setForm] = useState(null);
    const [submissions, setSubmissions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Column visibility state with localStorage persistence
    const [columnVisibility, setColumnVisibility] = useState(() => {
        const saved = localStorage.getItem(`examResults_${form_token}_columnVisibility`);
        return saved ? JSON.parse(saved) : {};
    });

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
                // Sort by created_at descending (newest first)
                const sortedData = submissionsResponse.data.sort((a, b) => 
                    new Date(b.created_at) - new Date(a.created_at)
                );
                setSubmissions(sortedData);

            } catch (err) {
                console.error('获取考试结果失败:', err);
                setError(err.response?.data?.message || err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchResults();
    }, [form_token]);

    // 动态生成列定义
    const columns = useMemo(() => {
        if (!form) return [];

        const baseColumns = [
            {
                accessorKey: 'created_at',
                header: '提交时间',
                size: 180,
                Cell: ({ cell }) => format(new Date(cell.getValue()), 'yyyy-MM-dd HH:mm'),
                enableColumnFilter: false,
            },
            {
                accessorFn: (row) => row.data?.['field_1'] || row.data?.['姓名'] || row.user_id || '匿名',
                id: 'submitter',
                header: '提交者',
                size: 150,
                Cell: ({ cell }) => (
                    <Typography sx={{ fontWeight: 'bold' }}>
                        {cell.getValue()}
                    </Typography>
                ),
            },
            {
                accessorKey: 'score',
                header: '分数',
                size: 100,
                Cell: ({ cell, row }) => {
                    const score = cell.getValue();
                    const passingScore = form?.passing_score || 60;
                    return (
                        <Typography 
                            color={score >= passingScore ? 'green' : 'red'} 
                            fontWeight="bold"
                        >
                            {score !== null ? `${score}` : '未评分'}
                        </Typography>
                    );
                },
                enableColumnFilter: false,
            },
            {
                accessorFn: (row) => row.data?.info_filling_duration,
                id: 'duration',
                header: '考试用时',
                size: 120,
                Cell: ({ cell }) => formatDuration(cell.getValue()),
                enableColumnFilter: false,
            },
        ];

        // 从 schema 中提取其他字段作为列
        const schemaColumns = [];
        if (form.surveyjs_schema) {
            const pages = form.surveyjs_schema.pages || [];
            
            pages.forEach(page => {
                const elements = page.elements || [];
                elements.forEach(element => {
                    // 跳过已经显示的字段
                    if (element.name === 'field_1' || element.name === '姓名') {
                        return;
                    }

                    const fullTitle = element.title || element.name;
                    const truncatedTitle = fullTitle.length > 10 ? fullTitle.substring(0, 10) + '...' : fullTitle;

                    // 只为简单字段类型创建列
                    if (['text', 'comment', 'radiogroup', 'dropdown', 'checkbox', 'rating'].includes(element.type)) {
                        schemaColumns.push({
                            accessorFn: (row) => {
                                const value = row.data?.[element.name];
                                if (value === null || value === undefined) return '';

                                // For choice-based fields, map value to text
                                if (['radiogroup', 'dropdown', 'checkbox'].includes(element.type) && element.choices) {
                                    if (Array.isArray(value)) {
                                        return value.map(v => {
                                            const choice = element.choices.find(c => c.value === v || c.text === v);
                                            return choice ? choice.text : v;
                                        }).join(', ');
                                    } else {
                                        const choice = element.choices.find(c => c.value === value || c.text === value);
                                        return choice ? choice.text : value;
                                    }
                                }

                                if (Array.isArray(value)) return value.join(', ');
                                if (typeof value === 'object') return JSON.stringify(value);
                                return String(value);
                            },
                            id: element.name,
                            header: truncatedTitle,
                            Header: ({ column }) => (
                                <Tooltip title={fullTitle} arrow placement="top">
                                    <span>{truncatedTitle}</span>
                                </Tooltip>
                            ),
                            size: 150,
                            minSize: 80,
                            maxSize: 400,
                            enableColumnFilter: true,
                            muiTableBodyCellProps: {
                                sx: {
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                },
                            },
                            Cell: ({ cell }) => (
                                <Tooltip title={cell.getValue()} arrow placement="top-start">
                                    <span style={{
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        display: 'block',
                                        width: '100%'
                                    }}>
                                        {cell.getValue()}
                                    </span>
                                </Tooltip>
                            ),
                        });
                    }
                });
            });
        }

        return [...baseColumns, ...schemaColumns];
    }, [form]);

    if (loading) {
        return <Container sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Container>;
    }

    if (error) {
        return <Container sx={{ mt: 4 }}><Alert severity="error">加载考试结果失败: {error}</Alert></Container>;
    }

    return (
        <Box sx={{ width: '100%', height: '100%' }}>
            <PageHeader
                title={form ? `${form.name}考试结果` : '考试结果'}
                description="查看所有考生的考试成绩、用时和提交时间。"
                actions={
                    <Button
                        variant="outlined"
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
                <CardContent sx={{ p: 0 }}>
                    <MaterialReactTable
                        columns={columns}
                        data={submissions}
                        enableColumnOrdering
                        enableColumnResizing
                        enableDensityToggle={false}
                        enableFullScreenToggle={false}
                        enableGlobalFilter
                        enablePinning
                        initialState={{
                            density: 'comfortable',
                            showGlobalFilter: true,
                            pagination: { pageSize: 20, pageIndex: 0 },
                            sorting: [{ id: 'created_at', desc: true }],
                        }}
                        muiTablePaginationProps={{
                            rowsPerPageOptions: [20, 50, 100, { label: '全部', value: submissions.length }],
                            showFirstButton: true,
                            showLastButton: true,
                        }}
                        state={{
                            columnVisibility,
                        }}
                        onColumnVisibilityChange={(updater) => {
                            const newVisibility = typeof updater === 'function'
                                ? updater(columnVisibility)
                                : updater;
                            setColumnVisibility(newVisibility);
                            localStorage.setItem(`examResults_${form_token}_columnVisibility`, JSON.stringify(newVisibility));
                        }}
                        muiTableBodyRowProps={({ row }) => ({
                            onClick: () => navigate(`/results/${row.original.id}`),
                            sx: {
                                cursor: 'pointer',
                                backgroundColor: 'white',
                                '&:hover': {
                                    backgroundColor: '#f8f9fa',
                                },
                                transition: 'all 0.2s ease',
                                borderBottom: '1px solid #e9ecef',
                            },
                        })}
                        muiTablePaperProps={{
                            elevation: 0,
                            sx: {
                                borderRadius: '0.375rem',
                                backgroundColor: 'white',
                                border: '1px solid #e9ecef',
                            }
                        }}
                        muiTableProps={{
                            sx: {
                                tableLayout: 'fixed',
                                backgroundColor: 'white',
                            }
                        }}
                        muiTableHeadCellProps={{
                            sx: {
                                backgroundColor: '#f8f9fa',
                                fontWeight: 600,
                                fontSize: '0.875rem',
                                color: '#495057',
                                borderBottom: '2px solid #dee2e6',
                                padding: '12px 16px',
                                '&:first-of-type': {
                                    borderTopLeftRadius: '0.375rem',
                                },
                                '&:last-of-type': {
                                    borderTopRightRadius: '0.375rem',
                                },
                            }
                        }}
                        muiTableBodyCellProps={{
                            sx: {
                                padding: '12px 16px',
                                fontSize: '0.875rem',
                                color: '#212529',
                            }
                        }}
                        muiTopToolbarProps={{
                            sx: {
                                backgroundColor: 'white',
                                borderBottom: '1px solid #e9ecef',
                                padding: '16px',
                                borderTopLeftRadius: '0.375rem',
                                borderTopRightRadius: '0.375rem',
                            }
                        }}
                        muiBottomToolbarProps={{
                            sx: {
                                backgroundColor: '#f8f9fa',
                                borderTop: '1px solid #e9ecef',
                                padding: '12px 16px',
                                borderBottomLeftRadius: '0.375rem',
                                borderBottomRightRadius: '0.375rem',
                            }
                        }}
                        muiTableContainerProps={{
                            sx: {
                                height: '100%',
                            }
                        }}
                        positionGlobalFilter="left"
                        muiSearchTextFieldProps={{
                            placeholder: '搜索所有列...',
                            sx: {
                                minWidth: '300px',
                                '& .MuiOutlinedInput-root': {
                                    borderRadius: '0.375rem',
                                    backgroundColor: 'white',
                                    '&:hover': {
                                        backgroundColor: '#f8f9fa',
                                    },
                                    '&.Mui-focused': {
                                        backgroundColor: 'white',
                                    }
                                }
                            },
                            variant: 'outlined',
                            size: 'small',
                        }}
                        muiPaginationProps={{
                            color: 'primary',
                            shape: 'rounded',
                            showRowsPerPage: true,
                            variant: 'outlined',
                        }}
                        localization={{
                            actions: '操作',
                            and: '和',
                            cancel: '取消',
                            changeFilterMode: '更改过滤模式',
                            changeSearchMode: '更改搜索模式',
                            clearFilter: '清除过滤',
                            clearSearch: '清除搜索',
                            clearSort: '清除排序',
                            clickToCopy: '点击复制',
                            columnActions: '列操作',
                            copiedToClipboard: '已复制到剪贴板',
                            dropToGroupBy: '拖放到此处以分组',
                            edit: '编辑',
                            expand: '展开',
                            expandAll: '展开全部',
                            filterArrIncludes: '包含',
                            filterArrIncludesAll: '包含全部',
                            filterArrIncludesSome: '包含部分',
                            filterBetween: '之间',
                            filterBetweenInclusive: '之间（包含）',
                            filterByColumn: '按 {column} 过滤',
                            filterContains: '包含',
                            filterEmpty: '为空',
                            filterEndsWith: '结尾是',
                            filterEquals: '等于',
                            filterEqualsString: '等于',
                            filterFuzzy: '模糊',
                            filterGreaterThan: '大于',
                            filterGreaterThanOrEqualTo: '大于等于',
                            filterInNumberRange: '在范围内',
                            filterIncludesString: '包含',
                            filterIncludesStringSensitive: '包含（区分大小写）',
                            filterLessThan: '小于',
                            filterLessThanOrEqualTo: '小于等于',
                            filterMode: '过滤模式: {filterType}',
                            filterNotEmpty: '不为空',
                            filterNotEquals: '不等于',
                            filterStartsWith: '开头是',
                            filterWeakEquals: '等于',
                            filteringByColumn: '按 {column} 过滤 - {filterType} {filterValue}',
                            goToFirstPage: '首页',
                            goToLastPage: '末页',
                            goToNextPage: '下一页',
                            goToPreviousPage: '上一页',
                            grab: '抓取',
                            groupByColumn: '按 {column} 分组',
                            groupedBy: '分组依据 ',
                            hideAll: '隐藏全部',
                            hideColumn: '隐藏 {column} 列',
                            max: '最大',
                            min: '最小',
                            move: '移动',
                            noRecordsToDisplay: '没有记录可显示',
                            noResultsFound: '未找到结果',
                            of: '/',
                            or: '或',
                            pin: '固定',
                            pinToLeft: '固定到左侧',
                            pinToRight: '固定到右侧',
                            resetColumnSize: '重置列大小',
                            resetOrder: '重置顺序',
                            rowActions: '行操作',
                            rowNumber: '#',
                            rowNumbers: '行号',
                            rowsPerPage: '每页行数',
                            save: '保存',
                            search: '搜索',
                            selectedCountOfRowCountRowsSelected: '已选择 {selectedCount} / {rowCount} 行',
                            select: '选择',
                            showAll: '显示全部',
                            showAllColumns: '显示全部列',
                            showHideColumns: '显示/隐藏列',
                            showHideFilters: '显示/隐藏过滤',
                            showHideSearch: '显示/隐藏搜索',
                            sortByColumnAsc: '按 {column} 升序',
                            sortByColumnDesc: '按 {column} 降序',
                            sortedByColumnAsc: '按 {column} 升序排序',
                            sortedByColumnDesc: '按 {column} 降序排序',
                            thenBy: ', 然后按 ',
                            toggleDensity: '切换密度',
                            toggleFullScreen: '切换全屏',
                            toggleSelectAll: '全选',
                            toggleSelectRow: '选择行',
                            toggleVisibility: '切换可见性',
                            ungroupByColumn: '取消按 {column} 分组',
                            unpin: '取消固定',
                            unpinAll: '取消全部固定',
                        }}
                    />
                </CardContent>
            </Card>
        </Box>
    );
};

export default ExamResultsPage;

