import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Alert } from '@mui/material';
import ReactDiffViewer from 'react-diff-viewer-continued';

const DiffTemplateModal = ({ open, onClose, template1, template2 }) => {

    if (!open || !template1 || !template2) {
        return null;
    }

    // 确保 template1 是版本较低的
    if (template1.version > template2.version) {
        [template1, template2] = [template2, template1];
    }

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle>
                对比模板: {template1.template_name}
            </DialogTitle>
            <DialogContent dividers>
                <Box sx={{ minHeight: '400px' }}>
                    <ReactDiffViewer
                        oldValue={template1.content || ''}
                        newValue={template2.content || ''}
                        splitView={true}
                        leftTitle={`版本 ${template1.version} (${new Date(template1.created_at).toLocaleString()})`}
                        rightTitle={`版本 ${template2.version} (${new Date(template2.created_at).toLocaleString()})`}
                        useDarkTheme={false}
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} color="primary">
                    关闭
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default DiffTemplateModal;
