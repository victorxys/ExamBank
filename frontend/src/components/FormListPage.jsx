import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
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
const DraggableFormCard = ({ form }) => {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `form-${form.id}`,
        data: { type: 'form', form }
    });

    return (
        <div ref={setNodeRef} {...listeners} {...attributes}>
            <FormCard form={form} isDragging={isDragging} />
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
    const [forms, setForms] = useState([]);
    const [folders, setFolders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currentFolder, setCurrentFolder] = useState(null);
    const [activeId, setActiveId] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

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
            const [formsRes, foldersRes] = await Promise.all([
                api.get('/dynamic_forms/'),
                api.get('/form-folders')
            ]);
            setForms(formsRes.data);
            setFolders(foldersRes.data);
        } catch (err) {
            console.error('获取数据失败:', err);
            setError(err.response?.data?.message || err.message);
        } finally {
            setLoading(false);
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

                <Card sx={{ 
                    boxShadow: '0 0 2rem 0 rgba(136, 152, 170, .15)',
                    backgroundColor: 'white',
                    borderRadius: '0.375rem',
                    mt: 3
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
                                        <DraggableFormCard form={form} />
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
            </Box>

            {/* Drag Overlay */}
            <DragOverlay>
                {activeForm ? <FormCard form={activeForm} isDragging={true} /> : null}
            </DragOverlay>
        </DndContext>
    );
};

export default FormListPage;
