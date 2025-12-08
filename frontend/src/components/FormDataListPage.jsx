import React, { useEffect, useState, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import {
    Container,
    Card,
    CardContent,
    CardHeader,
    Typography,
    CircularProgress,
    Alert,
    Button,
    Box,
    IconButton,
    Tooltip,
    Modal,
    Skeleton,
} from '@mui/material';
import {
    Visibility as VisibilityIcon,
    Close as CloseIcon,
    ChevronLeft as ChevronLeftIcon,
    ChevronRight as ChevronRightIcon,
    ImageNotSupported as ImageNotSupportedIcon,
} from '@mui/icons-material';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { MaterialReactTable } from 'material-react-table';
import PageHeader from './PageHeader';
import { format } from 'date-fns';

// 优化的图片组件，支持多种格式和错误处理
const OptimizedThumbnail = ({ src, alt, onClick, index, totalImages }) => {
    const [imageError, setImageError] = useState(false);
    
    // 生成 srcset 支持响应式图片
    const generateSrcSet = (url) => {
        const baseUrl = url.split('?')[0];
        return `${baseUrl} 1x, ${baseUrl}?w=80 2x`;
    };

    // 生成 WebP 版本的 src
    const generateWebPSrc = (url) => {
        // 检查是否是外部 URL
        if (url.startsWith('http')) {
            // 对于外部 URL，假设服务器支持 WebP
            return url.replace(/\.(jpg|jpeg|png)$/i, '.webp');
        }
        // 对于本地 URL，添加格式参数
        return `${url}?format=webp&w=40`;
    };

    if (imageError) {
        return (
            <Box
                sx={{
                    width: '40px',
                    height: '40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '4px',
                    border: '1px solid #dee2e6',
                }}
                onClick={onClick}
            >
                <ImageNotSupportedIcon sx={{ fontSize: 20, color: '#6c757d' }} />
            </Box>
        );
    }

    return (
        <LazyLoadImage
            src={src}
            srcSet={generateSrcSet(src)}
            placeholderSrc="/data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjRjhGOUZBIi8+CjxwYXRoIGQ9Ik0xNSAyMkgyMkwxNy4zIDE2LjhWMjVaIiBzdHJva2U9IiNEREVFMkYiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPGNpcmNsZSBjeD0iMjUiIGN5PSIxNSIgcj0iMiIgZmlsbD0iI0RERUUyRiIvPgo8L3N2Zz4K"
            alt={alt}
            effect="blur"
            width={40}
            height={40}
            onClick={onClick}
            onError={() => setImageError(true)}
            style={{
                width: '40px',
                height: '40px',
                objectFit: 'cover',
                borderRadius: '4px',
                border: '1px solid #dee2e6',
                cursor: 'pointer',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            }}
            onMouseEnter={(e) => {
                e.target.style.transform = 'scale(1.1)';
                e.target.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
            }}
            onMouseLeave={(e) => {
                e.target.style.transform = 'scale(1)';
                e.target.style.boxShadow = 'none';
            }}
        />
    );
};

const FormDataListPage = () => {
    const { formToken } = useParams();
    const navigate = useNavigate();
    const [formDataEntries, setFormDataEntries] = useState([]);
    const [formName, setFormName] = useState('');
    const [formSchema, setFormSchema] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Image lightbox state
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [lightboxImages, setLightboxImages] = useState([]);

    // Column visibility state with localStorage persistence
    const [columnVisibility, setColumnVisibility] = useState(() => {
        const saved = localStorage.getItem(`formDataList_${formToken}_columnVisibility`);
        return saved ? JSON.parse(saved) : {};
    });

    useEffect(() => {
        const fetchFormData = async () => {
            try {
                setLoading(true);
                // 1. 获取表单信息以获取 form_id 和 formName
                const formResponse = await api.get(`/dynamic_forms/${formToken}`);
                const formId = formResponse.data.id;
                setFormName(formResponse.data.name);
                setFormSchema(formResponse.data.surveyjs_schema);

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

    // 动态生成列定义
    const columns = useMemo(() => {
        if (!formSchema) return [];

        const baseColumns = [
            {
                accessorKey: 'created_at',
                header: '提交时间',
                size: 180,
                Cell: ({ cell }) => format(new Date(cell.getValue()), 'yyyy-MM-dd HH:mm'),
                enableColumnFilter: false,
            },
        ];

        // 从 schema 中提取字段作为列
        const schemaColumns = [];
        const pages = formSchema.pages || [];

        pages.forEach(page => {
            const elements = page.elements || [];
            elements.forEach(element => {
                const fullTitle = element.title || element.name;
                const truncatedTitle = fullTitle.length > 10 ? fullTitle.substring(0, 10) + '...' : fullTitle;

                // Handle file/image fields (including signatures)
                if (element.type === 'file' || element.type === 'image') {
                    schemaColumns.push({
                        accessorFn: (row) => {
                            const value = row.data?.[element.name];
                            return value;
                        },
                        id: element.name,
                        header: truncatedTitle,
                        Header: ({ column }) => (
                            <Tooltip title={fullTitle} arrow placement="top">
                                <span>{truncatedTitle}</span>
                            </Tooltip>
                        ),
                        Cell: ({ cell }) => {
                            const value = cell.getValue();
                            if (!value) return null;

                            // Handle array of image URLs
                            const urls = Array.isArray(value) ? value : [value];
                            const imageUrls = urls.filter(url =>
                                typeof url === 'string' &&
                                (url.startsWith('http') || url.startsWith('/'))
                            );

                            if (imageUrls.length === 0) return null;

                            return (
                                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                    {imageUrls.slice(0, 3).map((url, idx) => (
                                        <OptimizedThumbnail
                                            key={idx}
                                            src={url}
                                            alt={`${element.name}-${idx}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setLightboxImages(imageUrls);
                                                setCurrentImageIndex(idx);
                                                setLightboxOpen(true);
                                            }}
                                            index={idx}
                                            totalImages={imageUrls.length}
                                        />
                                    ))}
                                    {imageUrls.length > 3 && (
                                        <Box
                                            sx={{
                                                width: '40px',
                                                height: '40px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                backgroundColor: '#f8f9fa',
                                                borderRadius: '4px',
                                                border: '1px solid #dee2e6',
                                                fontSize: '0.75rem',
                                                color: '#6c757d',
                                            }}
                                        >
                                            +{imageUrls.length - 3}
                                        </Box>
                                    )}
                                </Box>
                            );
                        },
                        size: 150,
                        minSize: 100,
                        maxSize: 200,
                        enableColumnFilter: false,
                        enableSorting: false,
                    });
                }
                // 只为简单字段类型创建列（跳过复杂类型如 matrix, file 等）
                else if (['text', 'comment', 'radiogroup', 'dropdown', 'checkbox', 'rating'].includes(element.type)) {
                    schemaColumns.push({
                        accessorFn: (row) => {
                            const value = row.data?.[element.name];
                            if (value === null || value === undefined) return '';

                            // For choice-based fields, map value to text
                            if (['radiogroup', 'dropdown', 'checkbox'].includes(element.type) && element.choices) {
                                if (Array.isArray(value)) {
                                    // For checkbox (multiple selection)
                                    return value.map(v => {
                                        const choice = element.choices.find(c => c.value === v || c.text === v);
                                        return choice ? choice.text : v;
                                    }).join(', ');
                                } else {
                                    // For radiogroup/dropdown (single selection)
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

        return [...baseColumns, ...schemaColumns];

    }, [formSchema, formToken]);

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
                <CardContent sx={{ p: 0 }}>
                    <MaterialReactTable
                        columns={columns}
                        data={formDataEntries}
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
                        }}
                        muiTablePaginationProps={{
                            rowsPerPageOptions: [20, 50, 100, { label: '全部', value: formDataEntries.length }],
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
                            localStorage.setItem(`formDataList_${formToken}_columnVisibility`, JSON.stringify(newVisibility));
                        }}
                        muiTableBodyRowProps={({ row }) => ({
                            onClick: () => navigate(`/forms/${formToken}/${row.original.id}`),
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

            {/* Image Lightbox Modal */}
            <Modal
                open={lightboxOpen}
                onClose={() => setLightboxOpen(false)}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') {
                        setCurrentImageIndex((prev) => (prev > 0 ? prev - 1 : lightboxImages.length - 1));
                    } else if (e.key === 'ArrowRight') {
                        setCurrentImageIndex((prev) => (prev < lightboxImages.length - 1 ? prev + 1 : 0));
                    } else if (e.key === 'Escape') {
                        setLightboxOpen(false);
                    }
                }}
            >
                <Box
                    sx={{
                        position: 'relative',
                        outline: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Close Button */}
                    <IconButton
                        onClick={() => setLightboxOpen(false)}
                        sx={{
                            position: 'absolute',
                            top: -50,
                            right: 0,
                            color: 'white',
                            backgroundColor: 'rgba(0, 0, 0, 0.5)',
                            '&:hover': {
                                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                            },
                        }}
                    >
                        <CloseIcon />
                    </IconButton>

                    {/* Previous Button */}
                    {lightboxImages.length > 1 && (
                        <IconButton
                            onClick={() => setCurrentImageIndex((prev) => (prev > 0 ? prev - 1 : lightboxImages.length - 1))}
                            sx={{
                                position: 'absolute',
                                left: -60,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'white',
                                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                '&:hover': {
                                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                },
                            }}
                        >
                            <ChevronLeftIcon fontSize="large" />
                        </IconButton>
                    )}

                    {/* Image - Optimized Lightbox */}
                    <LazyLoadImage
                        src={lightboxImages[currentImageIndex]}
                        alt={`Image ${currentImageIndex + 1}`}
                        placeholderSrc="/data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgdmlld0JveD0iMCAwIDgwMCA2MDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI4MDAiIGhlaWdodD0iNjAwIiBmaWxsPSIjRjhGOUZBIi8+CjxwYXRoIGQ9Ik0zMDAgMzAwIEg1MDAgTDQwMCAyNTBWNTAwWiIgc3Ryb2tlPSIjRERFRTJGIiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8Y2lyY2xlIGN4PSI0NTAiIGN5PSIyNTAiIHI9IjgiIGZpbGw9IiNEREVFMkYiLz4KPC9zdmc+Cg=="
                        effect="blur"
                        style={{
                            maxWidth: '90vw',
                            maxHeight: '90vh',
                            width: 'auto',
                            height: 'auto',
                            display: 'block',
                            borderRadius: '8px',
                            backgroundColor: 'white',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                            objectFit: 'contain',
                        }}
                        onError={(e) => {
                            e.target.src = "/data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgdmlld0JveD0iMCAwIDQwMCAzMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI0MDAiIGhlaWdodD0iMzAwIiBmaWxsPSIjRjhGOUZBIi8+CjxwYXRoIGQ9Ik0xNTAgMTUwIEgyNTBMMjAwIDEyMlYyNTBaIiBzdHJva2U9IiNEREVFMkYiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+CjxjaXJjbGUgY3g9IjIyNSIgY3k9IjEyNSIgcj0iNSIgZmlsbD0iI0RERUUyRiIvPgo8L3N2Zz4K";
                            e.target.style.width = '200px';
                            e.target.style.height = '150px';
                        }}
                    />

                    {/* Next Button */}
                    {lightboxImages.length > 1 && (
                        <IconButton
                            onClick={() => setCurrentImageIndex((prev) => (prev < lightboxImages.length - 1 ? prev + 1 : 0))}
                            sx={{
                                position: 'absolute',
                                right: -60,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'white',
                                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                '&:hover': {
                                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                },
                            }}
                        >
                            <ChevronRightIcon fontSize="large" />
                        </IconButton>
                    )}

                    {/* Image Counter */}
                    {lightboxImages.length > 1 && (
                        <Box
                            sx={{
                                position: 'absolute',
                                bottom: -40,
                                left: '50%',
                                transform: 'translateX(-50%)',
                                color: 'white',
                                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                padding: '8px 16px',
                                borderRadius: '20px',
                                fontSize: '0.875rem',
                            }}
                        >
                            {currentImageIndex + 1} / {lightboxImages.length}
                        </Box>
                    )}
                </Box>
            </Modal>
        </Box>
    );
};

export default FormDataListPage;
