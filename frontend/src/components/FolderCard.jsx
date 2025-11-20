import React from 'react';
import { Card, CardContent, Typography, Box, IconButton, Menu, MenuItem } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

const FolderCard = ({ folder, onClick, onEdit, onDelete }) => {
    const [anchorEl, setAnchorEl] = React.useState(null);
    const open = Boolean(anchorEl);

    const handleMenuClick = (event) => {
        event.stopPropagation(); // Prevent folder navigation
        setAnchorEl(event.currentTarget);
    };

    const handleMenuClose = (event) => {
        event.stopPropagation();
        setAnchorEl(null);
    };

    const handleEdit = (event) => {
        event.stopPropagation();
        handleMenuClose(event);
        onEdit(folder);
    };

    const handleDelete = (event) => {
        event.stopPropagation();
        handleMenuClose(event);
        onDelete(folder);
    };

    return (
        <Card
            sx={{
                cursor: 'pointer',
                '&:hover': {
                    boxShadow: 6,
                    transform: 'translateY(-2px)',
                    transition: 'all 0.3s ease'
                },
                width: '168px',
                height: '200px',
                position: 'relative',
                overflow: 'hidden'
            }}
            onClick={onClick}
        >
            <CardContent sx={{
                padding: '12px !important',
                display: 'flex',
                flexDirection: 'column',
                height: '100%'
            }}>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                    <FolderIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                    <IconButton size="small" onClick={handleMenuClick}>
                        <MoreVertIcon />
                    </IconButton>
                    <Menu
                        anchorEl={anchorEl}
                        open={open}
                        onClose={handleMenuClose}
                    >
                        <MenuItem onClick={handleEdit}>
                            <EditIcon sx={{ mr: 1, fontSize: 20 }} />
                            编辑
                        </MenuItem>
                        <MenuItem onClick={handleDelete}>
                            <DeleteIcon sx={{ mr: 1, fontSize: 20 }} />
                            删除
                        </MenuItem>
                    </Menu>
                </Box>
                <Typography variant="h4" gutterBottom>
                    {folder.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    {folder.itemCount || 0} 项
                </Typography>
            </CardContent>
        </Card>
    );
};

export default FolderCard;
