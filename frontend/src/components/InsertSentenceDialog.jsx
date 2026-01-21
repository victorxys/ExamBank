// frontend/src/components/InsertSentenceDialog.jsx

import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Typography,
  Box,
  CircularProgress,
  List,
  ListItem,
  ListItemText
} from '@mui/material';
import {
  ArrowUpward as ArrowUpwardIcon,
  ArrowDownward as ArrowDownwardIcon
} from '@mui/icons-material';

const InsertSentenceDialog = ({ open, onClose, onInsert, referenceSentence, loading }) => {
  const [text, setText] = useState('');
  const [position, setPosition] = useState('after'); // 'before' or 'after'
  const [splitMode, setSplitMode] = useState('split'); // 'direct' or 'split'

  // 计算预览的句子列表
  const previewSentences = useMemo(() => {
    if (!text.trim() || splitMode !== 'split') {
      return [];
    }

    // 使用与后端相同的拆分逻辑
    let sentences = text.split('\n').filter(s => s.trim()).map(s => s.trim());
    
    // 如果没有换行符或只有一句，尝试用句号拆分
    if (sentences.length <= 1) {
      sentences = text.split('。').filter(s => s.trim()).map(s => s.trim() + '。');
    }
    
    // 如果还是为空，就保持原文本
    if (sentences.length === 0) {
      sentences = [text.trim()];
    }
    
    return sentences;
  }, [text, splitMode]);

  const handleInsert = () => {
    if (!text.trim()) {
      alert('请输入要插入的文本内容');
      return;
    }
    
    onInsert({
      text: text.trim(),
      position,
      split_mode: splitMode  // 修正：使用下划线命名，与后端API一致
    });
  };

  const handleClose = () => {
    setText('');
    setPosition('after');
    setSplitMode('split');
    onClose();
  };

  return (
    <Dialog 
      open={open} 
      onClose={handleClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        插入句子
        {referenceSentence && (
          <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
            参考句子 #{referenceSentence.order_index + 1}: {referenceSentence.text?.substring(0, 50) || referenceSentence.sentence_text?.substring(0, 50)}...
          </Typography>
        )}
      </DialogTitle>
      
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
          {/* 文本输入 */}
          <TextField
            label="要插入的文本内容"
            multiline
            rows={6}
            fullWidth
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="粘贴或输入要插入的文本内容..."
            helperText="可以输入单句或多句文本"
          />

          {/* 插入位置选择 */}
          <FormControl component="fieldset">
            <FormLabel component="legend">插入位置</FormLabel>
            <RadioGroup
              row
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            >
              <FormControlLabel
                value="before"
                control={<Radio />}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <ArrowUpwardIcon fontSize="small" />
                    向前插入（在当前句子之前）
                  </Box>
                }
              />
              <FormControlLabel
                value="after"
                control={<Radio />}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <ArrowDownwardIcon fontSize="small" />
                    向后插入（在当前句子之后）
                  </Box>
                }
              />
            </RadioGroup>
          </FormControl>

          {/* 拆分模式选择 */}
          <FormControl component="fieldset">
            <FormLabel component="legend">插入模式</FormLabel>
            <RadioGroup
              value={splitMode}
              onChange={(e) => setSplitMode(e.target.value)}
            >
              <FormControlLabel
                value="split"
                control={<Radio />}
                label={
                  <Box>
                    <Typography variant="body2">拆分后插入</Typography>
                    <Typography variant="caption" color="text.secondary">
                      按句子拆分规则（换行符或句号）拆分文本，然后批量插入多个句子
                    </Typography>
                  </Box>
                }
              />
              <FormControlLabel
                value="direct"
                control={<Radio />}
                label={
                  <Box>
                    <Typography variant="body2">直接插入</Typography>
                    <Typography variant="caption" color="text.secondary">
                      将整段文本作为一个句子直接插入
                    </Typography>
                  </Box>
                }
              />
            </RadioGroup>
          </FormControl>

          {/* 预览信息 - 增强版 */}
          {text.trim() && splitMode === 'split' && previewSentences.length > 0 && (
            <Box sx={{ p: 2, bgcolor: 'info.light', borderRadius: 1 }}>
              <Typography variant="subtitle2" color="info.dark" gutterBottom>
                预览：将拆分为 {previewSentences.length} 个句子
              </Typography>
              <List dense sx={{ maxHeight: 200, overflow: 'auto', bgcolor: 'background.paper', borderRadius: 1, mt: 1 }}>
                {previewSentences.map((sentence, index) => (
                  <ListItem key={index}>
                    <ListItemText
                      primary={`${index + 1}. ${sentence}`}
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
          
          {text.trim() && splitMode === 'direct' && (
            <Box sx={{ p: 2, bgcolor: 'warning.light', borderRadius: 1 }}>
              <Typography variant="caption" color="warning.dark">
                将作为 1 个完整句子插入（不拆分）
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          取消
        </Button>
        <Button
          onClick={handleInsert}
          variant="contained"
          disabled={!text.trim() || loading}
          startIcon={loading ? <CircularProgress size={16} /> : null}
        >
          {loading ? '插入中...' : '确认插入'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default InsertSentenceDialog;
