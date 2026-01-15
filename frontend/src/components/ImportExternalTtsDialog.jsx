// frontend/src/components/ImportExternalTtsDialog.jsx
/**
 * 第三方TTS数据导入对话框
 * 支持两种导入方式：
 * 1. 上传文件（JSON + ZIP音频包）
 * 2. 服务器本地路径（适用于已上传到服务器的文件）
 */
import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Tab,
  Tabs,
  CircularProgress,
  Alert,
  Paper,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material';
import {
  CloudUpload as CloudUploadIcon,
  Folder as FolderIcon,
  Description as DescriptionIcon,
  AudioFile as AudioFileIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { ttsApi } from '../api/tts';

function TabPanel({ children, value, index, ...other }) {
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

const ImportExternalTtsDialog = ({ open, onClose, contentId, onImportSuccess }) => {
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 文件上传模式的状态
  const [jsonFile, setJsonFile] = useState(null);
  const [audioZip, setAudioZip] = useState(null);
  const [mergedAudioFile, setMergedAudioFile] = useState(null);

  // 服务器路径模式的状态
  const [jsonFilePath, setJsonFilePath] = useState('');
  const [audioFolderPath, setAudioFolderPath] = useState('');

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
    setError('');
    setSuccess('');
  };

  const handleFileUploadImport = async () => {
    if (!jsonFile) {
      setError('请选择JSON配置文件');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const formData = new FormData();
      formData.append('json_file', jsonFile);
      if (audioZip) {
        formData.append('audio_zip', audioZip);
      }
      if (mergedAudioFile) {
        formData.append('merged_audio_file', mergedAudioFile);
      }

      const response = await ttsApi.importExternalTtsData(contentId, formData);
      setSuccess(response.data.message || '导入成功！');
      
      // 延迟关闭并刷新
      setTimeout(() => {
        onImportSuccess && onImportSuccess(response.data);
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.error || err.message || '导入失败');
    } finally {
      setLoading(false);
    }
  };

  const handleServerPathImport = async () => {
    if (!jsonFilePath.trim()) {
      setError('请输入JSON文件路径');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await ttsApi.importFromServerPath(
        contentId,
        jsonFilePath.trim(),
        audioFolderPath.trim() || undefined
      );
      setSuccess(response.data.message || '导入成功！');
      
      setTimeout(() => {
        onImportSuccess && onImportSuccess(response.data);
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.error || err.message || '导入失败');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setJsonFile(null);
      setAudioZip(null);
      setMergedAudioFile(null);
      setJsonFilePath('');
      setAudioFolderPath('');
      setError('');
      setSuccess('');
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>导入第三方TTS数据</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          从外部TTS平台导入已生成的语音数据。支持包含句子信息的JSON文件和对应的音频文件。
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

        <Tabs value={tabValue} onChange={handleTabChange}>
          <Tab label="上传文件" icon={<CloudUploadIcon />} iconPosition="start" />
          <Tab label="服务器路径" icon={<FolderIcon />} iconPosition="start" />
        </Tabs>

        <TabPanel value={tabValue} index={0}>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>JSON配置文件 *</Typography>
            <Button
              variant="outlined"
              component="label"
              startIcon={<DescriptionIcon />}
              fullWidth
              sx={{ justifyContent: 'flex-start', mb: 1 }}
            >
              {jsonFile ? jsonFile.name : '选择 export.json 文件'}
              <input
                type="file"
                hidden
                accept=".json"
                onChange={(e) => setJsonFile(e.target.files[0])}
              />
            </Button>
            <Typography variant="caption" color="text.secondary">
              包含句子列表和音频文件路径的JSON文件
            </Typography>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>音频文件包 (可选)</Typography>
            <Button
              variant="outlined"
              component="label"
              startIcon={<AudioFileIcon />}
              fullWidth
              sx={{ justifyContent: 'flex-start', mb: 1 }}
            >
              {audioZip ? audioZip.name : '选择音频ZIP压缩包'}
              <input
                type="file"
                hidden
                accept=".zip"
                onChange={(e) => setAudioZip(e.target.files[0])}
              />
            </Button>
            <Typography variant="caption" color="text.secondary">
              包含所有句子音频文件的ZIP压缩包
            </Typography>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>合并音频文件 (可选)</Typography>
            <Button
              variant="outlined"
              component="label"
              startIcon={<AudioFileIcon />}
              fullWidth
              sx={{ justifyContent: 'flex-start', mb: 1 }}
            >
              {mergedAudioFile ? mergedAudioFile.name : '选择合并后的音频文件'}
              <input
                type="file"
                hidden
                accept=".mp3,.wav,.m4a"
                onChange={(e) => setMergedAudioFile(e.target.files[0])}
              />
            </Button>
            <Typography variant="caption" color="text.secondary">
              已合并的完整音频文件（如 merged.mp3）
            </Typography>
          </Paper>
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <Alert severity="info" sx={{ mb: 2 }}>
            适用于已将文件上传到服务器的情况，直接指定服务器上的文件路径。
          </Alert>

          <TextField
            fullWidth
            label="JSON文件路径 *"
            value={jsonFilePath}
            onChange={(e) => setJsonFilePath(e.target.value)}
            placeholder="instance/uploads/xxx_export/export.json"
            helperText="服务器上JSON配置文件的相对路径"
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            label="音频文件夹路径"
            value={audioFolderPath}
            onChange={(e) => setAudioFolderPath(e.target.value)}
            placeholder="instance/uploads/xxx_export/audio"
            helperText="可选，如果不填会自动从JSON文件路径推断"
          />

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle2" gutterBottom>预期的文件结构：</Typography>
          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50' }}>
            <Typography variant="body2" component="pre" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', m: 0 }}>
{`xxx_export/
├── export.json      # 句子和音频信息
└── audio/
    ├── sentence_001.mp3
    ├── sentence_002.mp3
    ├── ...
    └── merged.mp3   # 合并音频(可选)`}
            </Typography>
          </Paper>
        </TabPanel>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" gutterBottom>JSON文件格式说明：</Typography>
        <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50', maxHeight: 200, overflow: 'auto' }}>
          <Typography variant="body2" component="pre" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', m: 0 }}>
{`{
  "document": {
    "title": "文档标题",
    "model": "使用的TTS模型",
    "voice": "音色名称"
  },
  "sentences": [
    {
      "order_index": 0,
      "original_text": "原始文本",
      "current_text": "当前文本(可能包含SSML)",
      "audio_file": {
        "path": "audio/sentence_001.mp3",
        "duration": 3500,  // 毫秒(可选)
        "file_size": 35406 // 字节(可选)
      }
    },
    ...
  ]
}`}
          </Typography>
        </Paper>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          取消
        </Button>
        <Button
          variant="contained"
          onClick={tabValue === 0 ? handleFileUploadImport : handleServerPathImport}
          disabled={loading || (tabValue === 0 && !jsonFile) || (tabValue === 1 && !jsonFilePath.trim())}
          startIcon={loading ? <CircularProgress size={20} /> : <CheckCircleIcon />}
        >
          {loading ? '导入中...' : '开始导入'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ImportExternalTtsDialog;
