import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Typography, Box, FormControlLabel, Checkbox, Button,
  Card, CardContent, CardHeader, Divider, CircularProgress, Dialog,
  DialogTitle, DialogContent, DialogContentText, DialogActions, TextField,
  IconButton, Collapse,
  List, ListItem, ListItemIcon, ListItemText,
  Switch, // 导入 Switch 组件
  Select, MenuItem, InputLabel, FormControl, Paper
} from '@mui/material';
import {
  Edit as EditIcon, Delete as DeleteIcon, Add as AddIcon,
  ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon,
  DragIndicator as DragIndicatorIcon
} from '@mui/icons-material';
import AlertMessage from './AlertMessage';
import api from '../api/axios';
import PageHeader from './PageHeader';
import { useTheme } from '@mui/material/styles';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// --- API 调用函数 ---
const evaluationApi = {
    getStructure: () => api.get('/evaluation/structure'),
    saveVisibility: (settings) => api.put('/evaluation/visibility', { visibilitySettings: settings }),
    getAspects: () => api.get('/evaluation_aspects/'),
    createAspect: (data) => api.post('/evaluation_aspects/', data),
    updateAspect: (id, data) => api.put(`/evaluation_aspects/${id}`, data),
    deleteAspect: (id) => api.delete(`/evaluation_aspects/${id}`),
    getCategoriesByAspect: (aspectId) => api.get(`/evaluation_categories/by_aspect/${aspectId}`),
    createCategory: (data) => api.post('/evaluation_categories/', data),
    updateCategory: (id, data) => api.put(`/evaluation_categories/${id}`, data),
    deleteCategory: (id) => api.delete(`/evaluation_categories/${id}`),
    createItem: (data) => api.post('/evaluation_item/', data),
    updateItem: (id, data) => api.put(`/evaluation_item/${id}`, data),
    deleteItem: (id) => api.delete(`/evaluation_item/${id}`),
    updateOrder: (data) => api.put('/evaluation/order/', data),
};

// --- 可排序项组件 ---
function SortableItem({ id, children, level, data }) {
    const theme = useTheme();
    const sortableProps = useSortable({ id: id, data: { type: level, itemData: data } });
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortableProps;
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.8 : 1,
        position: 'relative',
        backgroundColor: isDragging ? theme.palette.action.hover : 'transparent',
        zIndex: isDragging ? 1 : 'auto',
        marginBottom: level === 'aspect' ? theme.spacing(2) : level === 'category' ? theme.spacing(1) : theme.spacing(0.5),
        marginLeft: level === 'category' ? theme.spacing(2) : level === 'item' ? theme.spacing(4) : 0,
    };
    if (typeof children === 'function') { return children({ ...sortableProps, style }); }
    return ( <div ref={setNodeRef} style={style} {...attributes} {...listeners}>{children}</div> );
}

// --- 主组件 ---
const EvaluationManagement = () => {
    const theme = useTheme();
    const [loading, setLoading] = useState(true);
    const [alert, setAlert] = useState({ open: false, message: '', severity: 'info' });
    const [evaluationStructure, setEvaluationStructure] = useState([]);
    const [visibilitySettings, setVisibilitySettings] = useState({});
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogMode, setDialogMode] = useState('create');
    const [dialogLevel, setDialogLevel] = useState('aspect');
    const [dialogData, setDialogData] = useState({});
    const [formData, setFormData] = useState({ name: '', description: '', parentId: null, aspect_id: null, category_id: null, allow_manual_input: false, is_visible_to_client: false }); // 添加 is_visible_to_client
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState({ id: null, level: null, name: '' });
    const [expandedCategories, setExpandedCategories] = useState({});
    const [aspects, setAspects] = useState([]);
    const [expandedAspects, setExpandedAspects] = useState({});

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const structureResponse = await evaluationApi.getStructure();
            const aspectsResponse = await evaluationApi.getAspects();

            if (Array.isArray(structureResponse.data) && Array.isArray(aspectsResponse.data)) {
                const structure = structureResponse.data;
                setEvaluationStructure(structure);
                setAspects(aspectsResponse.data);

                const initialVisibility = {};
                const initialExpandedAspects = {};
                const initialExpandedCategories = {};

                structure.forEach(aspect => {
                    initialExpandedAspects[aspect.id] = false;
                    aspect.children?.forEach(category => {
                        initialExpandedCategories[category.id] = false;
                        category.children?.forEach(item => {
                            initialVisibility[item.id] = item.is_visible_to_client || false;
                        });
                    });
                });
                setVisibilitySettings(initialVisibility);
                setExpandedAspects(initialExpandedAspects);
                setExpandedCategories(initialExpandedCategories);

            } else { throw new Error('Data format error'); }
        } catch (error) {
            console.error('获取数据失败:', error);
            setAlert({ open: true, severity: 'error', message: '获取评价结构失败' });
         }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const toggleAspectExpand = (aspectId) => { setExpandedAspects(prev => ({ ...prev, [aspectId]: !prev[aspectId] })); };
    const toggleCategoryExpand = (categoryId) => { setExpandedCategories(prev => ({ ...prev, [categoryId]: !prev[categoryId] })); };
    const handleVisibilityChange = (itemId) => (event) => { setVisibilitySettings(prev => ({ ...prev, [itemId]: event.target.checked })); };
    const handleSaveVisibility = async () => {
         try {
            await evaluationApi.saveVisibility(visibilitySettings);
            setAlert({ open: true, severity: 'success', message: '可见性设置保存成功' });
        } catch (error) {
            console.error('保存可见性失败:', error);
            setAlert({ open: true, severity: 'error', message: '保存可见性设置失败' });
        }
    };

    // --- 对话框处理 ---
    const handleOpenDialog = (mode, level, data = {}, parentData = null) => {
       setDialogMode(mode);
        setDialogLevel(level);
        setDialogData(data);

        if (mode === 'edit') {
            setFormData({
                name: data.name || '',
                description: data.description || '',
                parentId: level === 'category' ? data.aspect_id : level === 'item' ? data.category_id : null,
                aspect_id: level === 'category' ? data.aspect_id : (level === 'item' ? data.aspect_id : null), // item 也需要 aspect_id
                category_id: level === 'item' ? data.category_id : null,
                allow_manual_input: level === 'category' ? (data.allow_manual_input || false) : false,
                is_visible_to_client: level === 'item' ? (visibilitySettings[data.id] || data.is_visible_to_client || false) : false // 编辑 item 时加载可见性
            });
        } else { // 'create'
             setFormData({
                name: '', description: '', parentId: null, allow_manual_input: false, is_visible_to_client: false,
                aspect_id: level === 'category' ? data?.id : (level === 'item' ? parentData?.id : null), // 创建 Category 父是 Aspect, 创建 Item 需要父 Category 的 aspect_id
                category_id: level === 'item' ? data?.id : null, // 创建 Item 父是 Category
             });
        }
        setDialogOpen(true);
    };

    const handleCloseDialog = () => {
        setDialogOpen(false);
        setFormData({ name: '', description: '', parentId: null, aspect_id: null, category_id: null, allow_manual_input: false, is_visible_to_client: false });
    };

     const handleSaveDialog = async () => {
         if (!formData.name.trim()) { setAlert({ open: true, severity: 'warning', message: '名称不能为空' }); return; }
          let apiCall;
            const payload = { description: formData.description.trim() };
            try {
                if (dialogLevel === 'aspect') {
                    payload.aspect_name = formData.name.trim();
                    apiCall = dialogMode === 'create' ? evaluationApi.createAspect(payload) : evaluationApi.updateAspect(dialogData.id, payload);
                } else if (dialogLevel === 'category') {
                    payload.category_name = formData.name.trim();
                    payload.aspect_id = formData.aspect_id;
                    payload.allow_manual_input = formData.allow_manual_input;
                    if (!payload.aspect_id) throw new Error("缺少类别的方面ID");
                    apiCall = dialogMode === 'create' ? evaluationApi.createCategory(payload) : evaluationApi.updateCategory(dialogData.id, payload);
                } else { // item
                    payload.item_name = formData.name.trim();
                    payload.category_id = formData.category_id;
                    payload.is_visible_to_client = formData.is_visible_to_client; // 保存可见性
                    if (!payload.category_id) throw new Error("缺少项目的类别ID");
                    apiCall = dialogMode === 'create' ? evaluationApi.createItem(payload) : evaluationApi.updateItem(dialogData.id, payload);
                }
                await apiCall;
                setAlert({ open: true, severity: 'success', message: `${dialogMode === 'create' ? '创建' : '更新'}成功` });
                // 如果更新了 item 的可见性，需要更新 visibilitySettings state
                if(dialogLevel === 'item' && dialogMode === 'edit') {
                   setVisibilitySettings(prev => ({...prev, [dialogData.id]: formData.is_visible_to_client}));
                }
                handleCloseDialog();
                fetchData();
            } catch (error) {
                 console.error(`保存 ${dialogLevel} 失败:`, error);
                setAlert({ open: true, severity: 'error', message: `保存失败: ${error.response?.data?.error || error.message}` });
             }
    };

    // --- 删除处理 ---
     const handleOpenDeleteDialog = (id, level, name) => { setItemToDelete({ id, level, name }); setDeleteDialogOpen(true); };
    const handleCloseDeleteDialog = () => { setDeleteDialogOpen(false); setItemToDelete({ id: null, level: null, name: '' }); };
    const handleConfirmDelete = async () => {
        let apiCall;
            try {
                if (itemToDelete.level === 'aspect') { apiCall = evaluationApi.deleteAspect(itemToDelete.id); }
                else if (itemToDelete.level === 'category') { apiCall = evaluationApi.deleteCategory(itemToDelete.id); }
                else { apiCall = evaluationApi.deleteItem(itemToDelete.id); }
                await apiCall;
                setAlert({ open: true, severity: 'success', message: '删除成功' });
                handleCloseDeleteDialog();
                fetchData();
            } catch (error) {
                 console.error(`删除 ${itemToDelete.level} 失败:`, error);
                setAlert({ open: true, severity: 'error', message: `删除失败: ${error.response?.data?.error || error.message}` });
            }
    };

    // --- 拖拽结束处理 ---
    const handleDragEnd = async (event) => {
         const { active, over } = event;
            if (!over || active.id === over.id) { return; }
            const activeLevel = active.data.current?.type;
            const overLevel = over.data.current?.type;
            const activeData = active.data.current?.itemData;
            const overData = over.data.current?.itemData;
            if (activeLevel !== overLevel) { console.warn("跨层级拖拽暂未实现"); return; }
            let parentId = null;
            let itemsToReorder = [];
            let originalItems = [];
            if (activeLevel === 'aspect') {
                originalItems = [...evaluationStructure]; itemsToReorder = evaluationStructure;
            } else if (activeLevel === 'category') {
                parentId = activeData?.aspect_id;
                if (!parentId || parentId !== overData?.aspect_id) { console.warn("不能将类别移动到不同的方面"); return; }
                const aspect = evaluationStructure.find(a => a.id === parentId); if (!aspect) return;
                originalItems = [...(aspect.children || [])]; itemsToReorder = aspect.children || [];
            } else if (activeLevel === 'item') {
                parentId = activeData?.category_id;
                 if (!parentId || parentId !== overData?.category_id) { console.warn("不能将项目移动到不同的类别"); return; }
                let category = null; for(const aspect of evaluationStructure) { category = aspect.children?.find(c => c.id === parentId); if (category) break; }
                if (!category) return; originalItems = [...(category.children || [])]; itemsToReorder = category.children || [];
            } else { return; }
            if (!itemsToReorder) return;
            const oldIndex = itemsToReorder.findIndex((item) => item.id === active.id);
            const newIndex = itemsToReorder.findIndex((item) => item.id === over.id);
            if (oldIndex === -1 || newIndex === -1) return;
            const newOrderedItems = arrayMove(itemsToReorder, oldIndex, newIndex);
            const newStructure = updateStructureState(evaluationStructure, activeLevel, parentId, newOrderedItems);
            setEvaluationStructure(newStructure);
            try {
                const orderedIds = newOrderedItems.map(item => item.id);
                await evaluationApi.updateOrder({ level: activeLevel, orderedIds: orderedIds, parentId: parentId });
                 setAlert({ open: true, severity: 'success', message: '排序已保存' });
            } catch (error) {
                console.error(`更新 ${activeLevel} 排序失败:`, error);
                setAlert({ open: true, severity: 'error', message: `保存排序失败: ${error.response?.data?.error || error.message}` });
                const revertedStructure = updateStructureState(evaluationStructure, activeLevel, parentId, originalItems);
                setEvaluationStructure(revertedStructure);
            }
    };

    // --- 更新嵌套状态的辅助函数 ---
    const updateStructureState = (structure, level, parentId, newOrderedItems) => {
        const updateRecursively = (nodes) => {
            return nodes?.map(node => {
                 if (node.type === 'aspect' && level === 'category' && node.id === parentId) { return { ...node, children: newOrderedItems }; }
                if (node.type === 'category' && level === 'item' && node.id === parentId) { return { ...node, children: newOrderedItems }; }
                 if (node.children) { return { ...node, children: updateRecursively(node.children) }; }
                return node;
            });
        };
        if(level === 'aspect'){ return newOrderedItems; }
        else { return updateRecursively(structure); }
    };

    // --- 渲染函数 ---
    const renderItem = (item, aspect, category) => (
        <SortableItem key={item.id} id={item.id} level="item" data={item}>
           {({ setNodeRef: itemRef, style: itemStyle, attributes: itemAttributes, listeners: itemListeners, isDragging: isItemDragging }) => (
                <Paper ref={itemRef} style={itemStyle} elevation={0}
                    sx={{ ml: 0, p: 1.5, bgcolor: isItemDragging ? 'action.hover' : '#fafafa', borderLeft: `3px solid ${theme.palette.info.light}`, display: 'flex', alignItems: 'center', gap: 1 }} >
                    <IconButton {...itemAttributes} {...itemListeners} sx={{ cursor: 'grab', touchAction: 'none', p: 0.5 }} size="small"> <DragIndicatorIcon fontSize="small" /> </IconButton>
                    <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="body1">{item.name}</Typography>
                        {item.description && <Typography variant="body2" color="text.secondary">{item.description}</Typography>}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                        {/* 直接使用 Checkbox，编辑功能放入对话框 */}
                        <FormControlLabel
                            control={<Checkbox size="small" checked={visibilitySettings[item.id] || false} onChange={handleVisibilityChange(item.id)} />}
                            label="客户可见" labelPlacement="start"
                            sx={{ mr: 1, '& .MuiTypography-root': { fontSize: '0.8rem' } }}
                            onClick={(e) => e.stopPropagation()} />
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleOpenDialog('edit', 'item', item, category); }} title="编辑评价项"><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleOpenDeleteDialog(item.id, 'item', item.name); }} title="删除评价项"><DeleteIcon fontSize="small" /></IconButton>
                    </Box>
                </Paper>
           )}
        </SortableItem>
    );

    const renderCategory = (category, aspect) => (
         <SortableItem key={category.id} id={category.id} level="category" data={category}>
            {({ setNodeRef: categoryRef, style: categoryStyle, attributes: categoryAttributes, listeners: categoryListeners, isDragging: isCategoryDragging }) => (
                <Box ref={categoryRef} style={categoryStyle} sx={{ mt: 2, ml: 0, backgroundColor: isCategoryDragging ? 'action.hover' : 'transparent', borderRadius: theme.shape.borderRadius }}>
                    <Paper elevation={0} sx={{ p: 2, bgcolor: 'grey.100', borderLeft: `3px solid ${theme.palette.warning.light}` }}>
                        <Box display="flex" justifyContent="space-between" alignItems="center" >
                            <IconButton {...categoryAttributes} {...categoryListeners} sx={{ cursor: 'grab', touchAction: 'none', mr: 1 }} size="small"> <DragIndicatorIcon fontSize="small" /> </IconButton>
                            <Box onClick={() => toggleCategoryExpand(category.id)} sx={{ cursor: 'pointer', flexGrow: 1 }}>
                                <Typography variant="h3">{category.name}</Typography>
                                {category.description && <Typography variant="body2" color="text.secondary">{category.description}</Typography>}
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                <Typography variant="caption" sx={{ mr: 1, color: category.allow_manual_input ? 'success.main' : 'text.disabled' }}>
                                     {category.allow_manual_input ? '允许手输' : '禁止手输'}
                                </Typography>
                                <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleOpenDialog('edit', 'category', category, aspect); }} title="编辑类别设置"><EditIcon fontSize="small" /></IconButton>
                                <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleOpenDeleteDialog(category.id, 'category', category.name); }} title="删除类别"><DeleteIcon fontSize="small" /></IconButton>
                                <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleCategoryExpand(category.id); }} title="折叠/展开">
                                    {expandedCategories[category.id] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                </IconButton>
                             </Box>
                        </Box>
                    </Paper>
                    <Collapse in={expandedCategories[category.id]} timeout="auto" unmountOnExit>
                        <Box sx={{ pt: 1 }}>
                             <SortableContext items={category.children?.map(item => item.id) || []} strategy={verticalListSortingStrategy} >
                                {category.children?.map(item => renderItem(item, aspect, category))}
                             </SortableContext>
                             <Button size="small" startIcon={<AddIcon />} onClick={() => handleOpenDialog('create', 'item', category)} sx={{ ml: 4, mt: 1 }}> 添加评价项 </Button>
                        </Box>
                    </Collapse>
                </Box>
             )}
         </SortableItem>
    );

    const renderAspect = (aspect) => (
      <SortableItem key={aspect.id} id={aspect.id} level="aspect" data={aspect}>
        {({ attributes, listeners, setNodeRef, style: sortableStyle, isDragging }) => (
          <Card ref={setNodeRef} style={sortableStyle} sx={{ mb: 2, backgroundColor: `${isDragging ? theme.palette.action.hover : theme.palette.grey[50]} !important`, boxShadow: isDragging ? theme.shadows[8] : theme.shadows[1], border: `1px solid ${theme.palette.divider}`, transition: 'background-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out' }} >
            <CardHeader
              action={
                <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleOpenDialog('edit', 'aspect', aspect); }} title="编辑方面设置"><EditIcon /></IconButton>
                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleOpenDeleteDialog(aspect.id, 'aspect', aspect.name); }} title="删除方面"><DeleteIcon /></IconButton>
                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleAspectExpand(aspect.id); }} title="折叠/展开">
                    {expandedAspects[aspect.id] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  </IconButton>
                </Box>
              }
              title={
                  <Box display="flex" alignItems="center">
                    <IconButton {...attributes} {...listeners} sx={{ cursor: 'grab', touchAction: 'none', mr: 1 }} size="small"> <DragIndicatorIcon fontSize="small" /> </IconButton>
                    <Typography variant="h2" onClick={() => toggleAspectExpand(aspect.id)} sx={{ cursor: 'pointer' }}> {aspect.name} </Typography>
                  </Box>
              }
              subheader={aspect.description} />
            <Collapse in={expandedAspects[aspect.id]} timeout="auto" unmountOnExit>
                <Divider />
                <CardContent>
                  <SortableContext items={aspect.children?.map(cat => cat.id) || []} strategy={verticalListSortingStrategy} >
                    {aspect.children?.map(category => renderCategory(category, aspect))}
                  </SortableContext>
                  <Button size="small" startIcon={<AddIcon />} onClick={(e) => { e.stopPropagation(); handleOpenDialog('create', 'category', aspect); }} sx={{ mt: 2 }}> 添加类别 </Button>
                </CardContent>
            </Collapse>
          </Card>
        )}
      </SortableItem>
    );

    // --- 主渲染 ---
    return (
        <Container maxWidth="100%">
             <AlertMessage open={alert.open} message={alert.message} severity={alert.severity} onClose={() => setAlert(prev => ({ ...prev, open: false }))} />
            <PageHeader title="评价体系管理" description="管理评价的方面、类别和具体项目（支持拖拽排序）" />

            {loading ? (
                 <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px"> <CircularProgress /> </Box>
            ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} >
                     <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between' }}>
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenDialog('create', 'aspect')}> 添加评价方面 </Button>
                         <Button variant="contained" color="primary" onClick={handleSaveVisibility}> 保存可见性设置 </Button>
                     </Box>
                     <SortableContext items={evaluationStructure.map(aspect => aspect.id)} strategy={verticalListSortingStrategy} >
                        {evaluationStructure.map(aspect => renderAspect(aspect))}
                     </SortableContext>
                </DndContext>
            )}

            {/* --- 创建/编辑 对话框 --- */}
            <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
                <DialogTitle>
                    {dialogMode === 'create' ? '添加' : '编辑'} {dialogLevel === 'aspect' ? '评价方面' : dialogLevel === 'category' ? '评价类别' : '评价项'}
                </DialogTitle>
                <DialogContent>
                    <TextField autoFocus margin="dense" label="名称" fullWidth value={formData.name} onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))} sx={{ mt: 1 }} />
                    <TextField margin="dense" label="描述（可选）" fullWidth multiline rows={3} value={formData.description} onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))} />

                    {(dialogLevel === 'category' || dialogLevel === 'item') && (
                         <FormControl fullWidth margin="dense">
                           <InputLabel id="aspect-select-label">所属方面</InputLabel>
                           <Select labelId="aspect-select-label" value={formData.aspect_id || ''} label="所属方面" onChange={(e) => setFormData(prev => ({ ...prev, aspect_id: e.target.value }))} disabled={dialogMode === 'edit'} >
                             {aspects.map((aspect) => ( <MenuItem key={aspect.id} value={aspect.id}> {aspect.aspect_name} </MenuItem> ))}
                           </Select>
                         </FormControl>
                    )}
                     {dialogLevel === 'item' && (
                          <FormControl fullWidth margin="dense">
                            <InputLabel id="category-select-label">所属类别</InputLabel>
                            <Select labelId="category-select-label" value={formData.category_id || ''} label="所属类别"
                                onChange={(e) => {
                                    const selectedCatId = e.target.value; let selectedCat = null;
                                    for (const aspect of evaluationStructure) { selectedCat = aspect.children?.find(cat => cat.id === selectedCatId); if (selectedCat) break; }
                                    setFormData(prev => ({ ...prev, category_id: selectedCatId, aspect_id: selectedCat ? selectedCat.aspect_id : null }));
                                }}
                                disabled={dialogMode === 'edit'} >
                               {evaluationStructure.flatMap(aspect => aspect.children?.filter(cat => dialogMode === 'create' ? cat.aspect_id === formData.aspect_id : true) // 创建时过滤，编辑时显示所有
                                .map(category => ( <MenuItem key={category.id} value={category.id}> {aspect.name} / {category.name} </MenuItem> )) ?? [] )}
                            </Select>
                        </FormControl>
                     )}
                    {dialogLevel === 'category' && (
                        <FormControlLabel control={ <Switch checked={formData.allow_manual_input} onChange={(e) => setFormData(prev => ({ ...prev, allow_manual_input: e.target.checked }))} name="allowManualInput" color="primary" /> }
                            label="允许对该类别手动输入评价" sx={{ mt: 1, display: 'block' }} />
                    )}
                    {/* 添加 Item 的客户可见性开关 */}
                     {dialogLevel === 'item' && (
                        <FormControlLabel control={ <Switch checked={formData.is_visible_to_client} onChange={(e) => setFormData(prev => ({ ...prev, is_visible_to_client: e.target.checked }))} name="isVisibleToClient" color="primary" /> }
                            label="允许客户在评价时看到此项" sx={{ mt: 1, display: 'block' }} />
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDialog}>取消</Button>
                    <Button onClick={handleSaveDialog} variant="contained" color="primary">保存</Button>
                </DialogActions>
            </Dialog>

            {/* --- 删除确认对话框 --- */}
            <Dialog open={deleteDialogOpen} onClose={handleCloseDeleteDialog}>
                <DialogTitle>确认删除</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        确定要删除 "{itemToDelete.name}" ({itemToDelete.level}) 吗？ {itemToDelete.level !== 'item' && ' 这可能会同时删除其下的所有子项。'} 此操作不可撤销。
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDeleteDialog}>取消</Button>
                    <Button onClick={handleConfirmDelete} color="error" variant="contained">删除</Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default EvaluationManagement;