import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
    Grid,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    IconButton,
    Breadcrumbs,
    TextField
} from '@mui/material';
import PageHeader from './PageHeader';
import FolderCard from './FolderCard';
import FormCard from './FormCard';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import HomeIcon from '@mui/icons-material/Home';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import { QRCodeSVG } from 'qrcode.react';
import {
    DndContext,
    DragOverlay,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';

// Draggable Form Card Wrapper
const DraggableFormCard = ({ form, isFavorite, onToggleFavorite }) => {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `form-${form.id}`,
        data: { type: 'form', form }
    });

    return (
        <div ref={setNodeRef} {...listeners} {...attributes}>
            <FormCard 
                form={form} 
                isDragging={isDragging} 
                isFavorite={isFavorite}
                onToggleFavorite={onToggleFavorite}
            />
        </div>
    );
};

// Droppable Folder Card Wrapper
const DroppableFolderCard = ({ folder, onClick, onEdit, onDelete, isOver }) => {
    const { setNodeRef } = useDroppable({
        id: `folder-${folder.id}`,
        data: { type: 'folder', folder }
    });

    return (
        <div ref={setNodeRef} style={{
            border: isOver ? '2px dashed #2196f3' : '2px dashed transparent',
            borderRadius: '8px',
            transition: 'all 0.2s ease',
            width: '168px',
            height: '200px'
        }}>
            <FolderCard
                folder={folder}
                onClick={onClick}
                onEdit={onEdit}
                onDelete={onDelete}
            />
        </div>
    );
};

const FormListPage = () => {
    const navigate = useNavigate();
    const [forms, setForms] = useState([]);
    const [folders, setFolders] = useState([]);
    const [favorites, setFavorites] = useState({ pinned: [], recent: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentFolder, setCurrentFolder] = useState(null);
    const [activeId, setActiveId] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    // QR Code Modal State for sidebar
    const [activeQrForm, setActiveQrForm] = useState(null);

    // Dialog States
    const [createFolderOpen, setCreateFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [newFolderDescription, setNewFolderDescription] = useState('');
    const [editFolderOpen, setEditFolderOpen] = useState(false);
    const [selectedFolder, setSelectedFolder] = useState(null);
    const [editFolderName, setEditFolderName] = useState('');
    const [editFolderDescription, setEditFolderDescription] = useState('');

    // Drag and Drop Sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    const fetchData = async () => {
        try {
            setLoading(true);
            const [formsRes, foldersRes, favoritesRes] = await Promise.all([
                api.get('/dynamic_forms/'),
                api.get('/form-folders'),
                api.get('/dynamic_forms/favorites')
            ]);
            setForms(formsRes.data);
            setFolders(foldersRes.data);
            setFavorites(favoritesRes.data || { pinned: [], recent: [] });
        } catch (err) {
            console.error('获取数据失败:', err);
            setError(err.response?.data?.message || err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleFavorite = async (form) => {
        try {
            await api.post('/dynamic_forms/favorites/toggle', { form_id: form.id });
            // 重新拉取最新列表，保证绝对的一致性
            const favoritesRes = await api.get('/dynamic_forms/favorites');
            setFavorites(favoritesRes.data || { pinned: [], recent: [] });
        } catch (err) {
            console.error('切换收藏状态失败:', err);
            alert('操作失败: ' + (err.response?.data?.message || err.message));
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Unified logic for displaying items with recursive search
    const itemsToDisplay = useMemo(() => {
        const lowerCaseSearchTerm = searchTerm.toLowerCase().trim();

        if (lowerCaseSearchTerm) {
            console.log(`[Recursive Search] Searching for: "${lowerCaseSearchTerm}"`);
            // --- SEARCH MODE (with recursion) ---
            const matchingForms = forms.filter(f =>
                f.name && f.name.toLowerCase().includes(lowerCaseSearchTerm)
            );

            const matchingFolders = folders.filter(f =>
                f.name && f.name.toLowerCase().includes(lowerCaseSearchTerm)
            );

            // For each matching form, find its parent folders and add them to the display set
            const parentFoldersToShow = new Set();
            matchingForms.forEach(form => {
                let parentId = form.folder_id;
                while (parentId) {
                    const parentFolder = folders.find(f => f.id === parentId);
                    if (parentFolder) {
                        parentFoldersToShow.add(parentFolder.id);
                        parentId = parentFolder.parent_id;
                    } else {
                        parentId = null;
                    }
                }
            });

            // Combine directly matched folders and parent folders
            const finalFolders = folders.filter(f => matchingFolders.some(mf => mf.id === f.id) || parentFoldersToShow.has(f.id));

            console.log(`[Recursive Search] Found ${matchingForms.length} forms and ${finalFolders.length} folders (including parents).`);

            return { forms: matchingForms, folders: finalFolders, isSearching: true };
        } else {
            // --- BROWSE MODE ---
            const formsInFolder = currentFolder
                ? forms.filter(f => f.folder_id === currentFolder.id)
                : forms.filter(f => !f.folder_id);

            const foldersInFolder = currentFolder
                ? folders.filter(f => f.parent_id === currentFolder.id)
                : folders.filter(f => !f.parent_id);

            return { forms: formsInFolder, folders: foldersInFolder, isSearching: false };
        }
    }, [forms, folders, currentFolder, searchTerm]);

    const { forms: displayedForms, folders: displayedFolders, isSearching } = itemsToDisplay;

    // Folder Actions
    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;
        try {
            await api.post('/form-folders', {
                name: newFolderName,
                description: newFolderDescription,
                parent_id: currentFolder ? currentFolder.id : null
            });
            setCreateFolderOpen(false);
            setNewFolderName('');
            setNewFolderDescription('');
            fetchData();
        } catch (err) {
            alert('创建文件夹失败: ' + err.message);
        }
    };

    const handleEditFolder = (folder) => {
        setSelectedFolder(folder);
        setEditFolderName(folder.name);
        setEditFolderDescription(folder.description || '');
        setEditFolderOpen(true);
    };

    const handleUpdateFolder = async () => {
        if (!editFolderName.trim() || !selectedFolder) return;
        try {
            await api.put(`/form-folders/${selectedFolder.id}`, {
                name: editFolderName,
                description: editFolderDescription
            });
            setEditFolderOpen(false);
            setSelectedFolder(null);
            fetchData();
        } catch (err) {
            alert('更新文件夹失败: ' + err.message);
        }
    };

    const handleDeleteFolder = async (folder) => {
        if (!window.confirm(`确定要删除文件夹 "${folder.name}" 吗?\n\n注意:删除文件夹会同时删除其所有子文件夹,但文件夹内的表单会被移到根目录。`)) {
            return;
        }
        try {
            await api.delete(`/form-folders/${folder.id}`);
            if (currentFolder && currentFolder.id === folder.id) {
                setCurrentFolder(null);
            }
            fetchData();
        } catch (err) {
            alert('删除文件夹失败: ' + err.message);
        }
    };

    // Navigation
    const handleNavigateBack = () => {
        if (currentFolder && currentFolder.parent_id) {
            const parent = folders.find(f => f.id === currentFolder.parent_id);
            setCurrentFolder(parent || null);
        } else {
            setCurrentFolder(null);
        }
    };

    const getBreadcrumbs = () => {
        const crumbs = [];
        let temp = currentFolder;
        while (temp) {
            crumbs.unshift(temp);
            if (temp.parent_id) {
                temp = folders.find(f => f.id === temp.parent_id);
            } else {
                temp = null;
            }
        }
        return crumbs;
    };

    // Drag and Drop Handlers
    const handleDragStart = (event) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) return;

        const activeData = active.data.current;
        const overData = over.data.current;

        // Only handle form dragged onto folder
        if (activeData?.type === 'form' && overData?.type === 'folder') {
            const form = activeData.form;
            const targetFolder = overData.folder;

            try {
                await api.patch(`/dynamic_forms/${form.id}`, {
                    folder_id: targetFolder.id
                });
                fetchData(); // Refresh data
            } catch (err) {
                alert('移动表单失败: ' + err.message);
            }
        }
    };

    const handleDragCancel = () => {
        setActiveId(null);
    };

    if (loading) {
        return <Container sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Container>;
    }

    if (error) {
        return <Container sx={{ mt: 4 }}><Alert severity="error">加载失败: {error}</Alert></Container>;
    }

    const activeForm = activeId ? forms.find(f => `form-${f.id}` === activeId) : null;

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            <Box sx={{ width: '100%', height: '100%' }}>
                <PageHeader
                    title="表单与考试"
                    description="这里列出了所有的表单和考试,您可以创建、编辑或查看数据。拖拽表单到文件夹中进行整理。"
                    actions={
                        <Box display="flex" gap={2}>
                            <Button
                                variant="outlined"
                                startIcon={<CreateNewFolderIcon />}
                                onClick={() => setCreateFolderOpen(true)}
                                sx={{ backgroundColor: 'white' }}
                            >
                                新建文件夹
                            </Button>
                            <Button
                                variant="outlined"
                                color="secondary"
                                component="a"
                                href="/forms/new"
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{
                                    backgroundColor: 'white',
                                    color: 'primary.main',
                                    '&:hover': { backgroundColor: '#f6f9fc' },
                                }}
                            >
                                创建新表单
                            </Button>
                        </Box>
                    }
                />

                {/* Double Column Layout */}
                <div className="flex flex-col lg:flex-row gap-6 mt-6 w-full items-start">
                    
                    {/* Left Sidebar: Pinned Shortcut Menu (shadcn Minimalist style) */}
                    <div className="w-full lg:w-[280px] flex-shrink-0 bg-white rounded-xl border border-slate-200/60 p-5 shadow-sm self-start space-y-6">
                        
                        {/* 1. 置顶项目 (Pinned Section) */}
                        <div>
                            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                                <div className="flex items-center gap-1.5">
                                    <span className="p-1 bg-amber-50 text-amber-600 rounded flex items-center justify-center">
                                        <StarIcon sx={{ fontSize: 13 }} />
                                    </span>
                                    <h4 className="font-bold text-xs text-slate-800 tracking-tight">置顶项目</h4>
                                </div>
                                <span className="text-[9px] text-slate-400 font-medium">
                                    {(favorites.pinned || []).length} 个已固顶
                                </span>
                            </div>

                            {(favorites.pinned || []).length > 0 ? (
                                <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                                    {(favorites.pinned || []).map(fav => (
                                        <div
                                            key={fav.id}
                                            onClick={() => {
                                                const targetPath = fav.form_type === 'EXAM' 
                                                    ? `/exams/${fav.form_token}/results` 
                                                    : `/forms/${fav.form_token}/data`;
                                                navigate(targetPath);
                                            }}
                                            className="p-3 bg-slate-50/50 hover:bg-slate-100/70 border border-slate-200/30 hover:border-slate-300/60 rounded-xl cursor-pointer transition-all relative group flex flex-col justify-between"
                                        >
                                            <div className="flex justify-between items-start">
                                                <h5 className="font-bold text-[13px] text-slate-800 pr-14 leading-snug truncate-2-lines group-hover:text-blue-600 transition-colors">
                                                    {fav.name}
                                                </h5>
                                                <div className="absolute top-2.5 right-2 flex items-center gap-0.5 z-10">
                                                    {/* 二维码分享按钮：Hover 时显现 */}
                                                    <IconButton
                                                        size="small"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setActiveQrForm(fav);
                                                        }}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                                                        sx={{
                                                            color: '#8898aa',
                                                            p: '2px',
                                                            '&:hover': { color: 'primary.main', transform: 'scale(1.15)' }
                                                        }}
                                                    >
                                                        <QrCode2Icon sx={{ fontSize: 16 }} />
                                                    </IconButton>
                                                    {/* 置顶星星按钮：常驻显示，易于点击，绝无遮挡 */}
                                                    <IconButton
                                                        size="small"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleToggleFavorite(fav);
                                                        }}
                                                        sx={{
                                                            color: '#feb236',
                                                            p: '2px',
                                                            '&:hover': { transform: 'scale(1.2)' }
                                                        }}
                                                    >
                                                        <StarIcon sx={{ fontSize: 16 }} />
                                                    </IconButton>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between mt-2.5 text-[9px] text-slate-400">
                                                <span>{fav.form_type === 'EXAM' ? '考试' : '问卷'}</span>
                                                <span className="text-blue-600 font-semibold group-hover:underline">填报</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-6 px-4 border border-dashed border-slate-100 rounded-xl">
                                    <span className="text-[10px] text-slate-400 block font-medium">暂无置顶项目</span>
                                </div>
                            )}
                        </div>

                        {/* 2. 最近使用 (Recent Section) */}
                        <div>
                            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                                <div className="flex items-center gap-1.5">
                                    <span className="p-1 bg-slate-100 text-slate-600 rounded flex items-center justify-center">
                                        <i className="fa-solid fa-clock-rotate-left text-[11px]"></i>
                                    </span>
                                    <h4 className="font-bold text-xs text-slate-800 tracking-tight">最近使用</h4>
                                </div>
                                <span className="text-[9px] text-slate-400 font-medium">无感记录</span>
                            </div>

                            {(favorites.recent || []).length > 0 ? (
                                <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                                    {(favorites.recent || []).map(fav => (
                                        <div
                                            key={fav.id}
                                            onClick={() => {
                                                const targetPath = fav.form_type === 'EXAM' 
                                                    ? `/exams/${fav.form_token}/results` 
                                                    : `/forms/${fav.form_token}/data`;
                                                navigate(targetPath);
                                            }}
                                            className="p-3 bg-slate-50/30 hover:bg-slate-100/50 border border-slate-200/20 hover:border-slate-300/40 rounded-xl cursor-pointer transition-all relative group flex flex-col justify-between"
                                        >
                                            <div className="flex justify-between items-start">
                                                <h5 className="font-bold text-[13px] text-slate-700 pr-14 leading-snug truncate-2-lines group-hover:text-blue-600 transition-colors">
                                                    {fav.name}
                                                </h5>
                                                <div className="absolute top-2.5 right-2 flex items-center gap-0.5 z-10">
                                                    {/* 二维码分享按钮：Hover 时显现 */}
                                                    <IconButton
                                                        size="small"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setActiveQrForm(fav);
                                                        }}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                                                        sx={{
                                                            color: '#8898aa',
                                                            p: '2px',
                                                            '&:hover': { color: 'primary.main', transform: 'scale(1.15)' }
                                                        }}
                                                    >
                                                        <QrCode2Icon sx={{ fontSize: 16 }} />
                                                    </IconButton>
                                                    {/* 描边收藏星星按钮：常驻显示，鼠标 hover 时呈现黄色微动 */}
                                                    <IconButton
                                                        size="small"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleToggleFavorite(fav);
                                                        }}
                                                        sx={{
                                                            color: '#cbd5e1',
                                                            p: '2px',
                                                            '&:hover': { color: '#feb236', transform: 'scale(1.2)' }
                                                        }}
                                                    >
                                                        <StarBorderIcon sx={{ fontSize: 16 }} />
                                                    </IconButton>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between mt-2.5 text-[9px] text-slate-400">
                                                <span>{fav.form_type === 'EXAM' ? '考试' : '问卷'}</span>
                                                <span className="text-blue-600 font-semibold group-hover:underline">填报</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-6 px-4 border border-dashed border-slate-100 rounded-xl text-[10px] text-slate-400 leading-normal">
                                    暂无最近记录，系统将无感记录您的最新访问。
                                </div>
                            )}
                        </div>
                        
                        <div className="p-3 bg-slate-50/80 border border-slate-100 rounded-xl text-[9px] text-slate-400 leading-normal">
                            <i className="fa-solid fa-circle-info mr-1 text-slate-500"></i>
                            系统会自动根据您的最新表单填写与访问行为，无感刷新“最近使用”项目。星标用作永久置顶。
                        </div>
                    </div>

                    {/* Right Directory Explorer */}
                    <div className="flex-grow w-full lg:w-0">
                        <Card sx={{
                            boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)',
                            backgroundColor: 'white',
                            borderRadius: '0.375rem'
                        }}>
                            <CardHeader
                                sx={{ p: 3, borderBottom: '1px solid rgba(0, 0, 0, 0.1)' }}
                                title={
                                    <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
                                        {/* Breadcrumbs / Navigation (hidden during search) */}
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, visibility: isSearching ? 'hidden' : 'visible' }}>
                                            {currentFolder && (
                                                <IconButton onClick={handleNavigateBack} size="small">
                                                    <ArrowBackIcon />
                                                </IconButton>
                                            )}
                                            <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="breadcrumb">
                                                <Link
                                                    color="inherit"
                                                    onClick={() => setCurrentFolder(null)}
                                                    style={{ cursor: 'pointer', textDecoration: 'none', color: currentFolder ? 'inherit' : 'black', fontWeight: currentFolder ? 'normal' : 'bold' }}
                                                >
                                                    根目录
                                                </Link>
                                                {getBreadcrumbs().map((folder, index) => {
                                                    const isLast = index === getBreadcrumbs().length - 1;
                                                    return (
                                                        <Link
                                                            key={folder.id}
                                                            color="inherit"
                                                            onClick={() => !isLast && setCurrentFolder(folder)}
                                                            style={{
                                                                cursor: isLast ? 'default' : 'pointer',
                                                                textDecoration: 'none',
                                                                color: isLast ? 'black' : 'inherit',
                                                                fontWeight: isLast ? 'bold' : 'normal'
                                                            }}
                                                        >
                                                            {folder.name}
                                                        </Link>
                                                    );
                                                })}
                                            </Breadcrumbs>
                                        </Box>
                                        {/* Search Field */}
                                        <TextField
                                            size="small"
                                            placeholder="全局搜索表单和文件夹"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            sx={{
                                                width: '250px',
                                                '& .MuiOutlinedInput-root': {
                                                    borderRadius: '0.375rem',
                                                },
                                            }}
                                        />
                                    </Box>
                                }
                            />
                            <CardContent sx={{ p: 3 }}>
                                {isSearching && (
                                    <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
                                        全局搜索结果:
                                    </Typography>
                                )}
                                {/* Unified Grid View */}
                                {(displayedFolders.length > 0 || displayedForms.length > 0) ? (
                                    <Box sx={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        gap: 4,
                                        justifyContent: 'flex-start',
                                        alignItems: 'flex-start',
                                        minHeight: '400px'
                                    }}>
                                        {/* Folders */}
                                        {displayedFolders.map(folder => {
                                            const formCount = forms.filter(f => f.folder_id === folder.id).length;
                                            const subfolderCount = folders.filter(f => f.parent_id === folder.id).length;
                                            return (
                                                <Box key={folder.id}>
                                                    <DroppableFolderCard
                                                        folder={{ ...folder, itemCount: formCount + subfolderCount }}
                                                        onClick={() => {
                                                            // When clicking a folder from search results, clear search and navigate
                                                            setSearchTerm('');
                                                            setCurrentFolder(folder);
                                                        }}
                                                        onEdit={handleEditFolder}
                                                        onDelete={handleDeleteFolder}
                                                        isOver={activeId && activeId.startsWith('form-')}
                                                    />
                                                </Box>
                                            );
                                        })}

                                        {/* Forms */}
                                        {displayedForms.map(form => (
                                            <Box key={form.id}>
                                                <DraggableFormCard 
                                                    form={form} 
                                                    isFavorite={(favorites.pinned || []).some(fav => fav.id === form.id)}
                                                    onToggleFavorite={handleToggleFavorite}
                                                />
                                            </Box>
                                        ))}
                                    </Box>
                                ) : (
                                    /* Empty State */
                                    <Box sx={{ textAlign: 'center', width: '100%', py: 8, minHeight: '400px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                                        <Typography variant="h6" color="text.secondary">
                                            {isSearching ? '没有找到匹配的项目' : (currentFolder ? '此文件夹为空' : '暂无表单或文件夹')}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                            {isSearching ? '尝试更换搜索关键词' : '点击上方按钮创建新的表单或文件夹'}
                                        </Typography>
                                    </Box>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {/* Create Folder Dialog */}
                <Dialog open={createFolderOpen} onClose={() => setCreateFolderOpen(false)}>
                    <DialogTitle>新建文件夹</DialogTitle>
                    <DialogContent>
                        <TextField
                            autoFocus
                            margin="dense"
                            label="文件夹名称"
                            fullWidth
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                        />
                        <TextField
                            margin="dense"
                            label="描述(可选)"
                            fullWidth
                            multiline
                            rows={2}
                            value={newFolderDescription}
                            onChange={(e) => setNewFolderDescription(e.target.value)}
                        />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setCreateFolderOpen(false)}>取消</Button>
                        <Button onClick={handleCreateFolder} variant="contained">创建</Button>
                    </DialogActions>
                </Dialog>

                {/* Edit Folder Dialog */}
                <Dialog open={editFolderOpen} onClose={() => setEditFolderOpen(false)}>
                    <DialogTitle>编辑文件夹</DialogTitle>
                    <DialogContent>
                        <TextField
                            autoFocus
                            margin="dense"
                            label="文件夹名称"
                            fullWidth
                            value={editFolderName}
                            onChange={(e) => setEditFolderName(e.target.value)}
                        />
                        <TextField
                            margin="dense"
                            label="描述(可选)"
                            fullWidth
                            multiline
                            rows={2}
                            value={editFolderDescription}
                            onChange={(e) => setEditFolderDescription(e.target.value)}
                        />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setEditFolderOpen(false)}>取消</Button>
                        <Button onClick={handleUpdateFolder} variant="contained">保存</Button>
                    </DialogActions>
                </Dialog>

                {/* QR Code Dialog for Sidebar */}
                <Dialog 
                    open={activeQrForm !== null} 
                    onClose={() => setActiveQrForm(null)}
                >
                    <DialogTitle>扫码填写表单</DialogTitle>
                    <DialogContent sx={{ textAlign: 'center', pt: 3, minWidth: '320px' }}>
                        {activeQrForm && (
                            <Box display="flex" flexDirection="column" alignItems="center" gap={1.5}>
                                <QRCodeSVG
                                    value={`${window.location.origin}/forms/${activeQrForm.form_token}`}
                                    size={220}
                                    level="H"
                                    includeMargin={true}
                                />
                                <Typography variant="subtitle1" sx={{ mt: 1, fontWeight: 'bold' }}>
                                    {activeQrForm.name}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: '280px' }}>
                                    使用微信或其他扫码工具扫描二维码，即可直接在手机端填写此表单。
                                </Typography>
                            </Box>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setActiveQrForm(null)}>关闭</Button>
                    </DialogActions>
                </Dialog>
            </Box>

            {/* Drag Overlay */}
            <DragOverlay>
                {activeForm ? <FormCard form={activeForm} isDragging={true} /> : null}
            </DragOverlay>
        </DndContext>
    );
};

export default FormListPage;

