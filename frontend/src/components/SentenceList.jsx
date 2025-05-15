// Can be in the same file or a new file like ./SentenceList.jsx

// (确保从 @mui/material 导入必要的组件，如已在主组件导入，则无需重复)
// import { Box, Typography, Paper, TableContainer, Table, TableHead, TableRow, TableCell, TableBody, Tooltip, Chip, IconButton, Button, CircularProgress, TextField } from '@mui/material';
// import TablePagination from '@mui/material/TablePagination';
// import { PlayArrow as PlayArrowIcon, Download as DownloadIcon, Refresh as RefreshIcon, StopCircleOutlined as StopCircleOutlinedIcon, Audiotrack as AudiotrackIcon, Search as SearchIcon } from '@mui/icons-material';
// import { API_BASE_URL } from '../config'; // 如果子组件需要
// ... (其他必要的 import)

const SentenceList = ({ sentences, playingAudio, actionLoading, onPlayAudio, onGenerateAudio }) => {
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(50); // 每页默认50句
    const [searchTerm, setSearchTerm] = useState('');

    // 使用 useMemo 优化过滤逻辑，仅在 sentences 或 searchTerm 变化时重新计算
    const filteredSentences = useMemo(() => {
        if (!searchTerm) return sentences;
        return sentences.filter(sentence =>
            sentence.text.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [sentences, searchTerm]);

    const handleChangePage = (event, newPage) => {
        setPage(newPage);
    };

    // --- 新增编辑句子相关的状态 ---
    const [editSentenceDialogOpen, setEditSentenceDialogOpen] = useState(false);
    const [sentenceToEdit, setSentenceToEdit] = useState(null); // 存储 { id: string, text: string, order_index: number }
    const [editingSentenceText, setEditingSentenceText] = useState('');
    // ---------------------------------

    const handleChangeRowsPerPage = (event) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0); // 更改每页行数时，回到第一页
    };

    // 使用 useMemo 优化分页逻辑
    const paginatedSentences = useMemo(() => {
        return filteredSentences.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
    }, [filteredSentences, page, rowsPerPage]);
    
    // --- 编辑句子处理函数 ---
    const handleOpenEditSentenceDialog = (sentence) => {
        setSentenceToEdit(sentence);
        setEditingSentenceText(sentence.text);
        setEditSentenceDialogOpen(true);
    };

    const handleCloseEditSentenceDialog = () => {
        setEditSentenceDialogOpen(false);
        setSentenceToEdit(null);
        setEditingSentenceText('');
    };

    const handleSaveEditedSentence = async () => {
        if (!sentenceToEdit || !editingSentenceText.trim()) {
            // 可以在这里触发一个 alert
            alert("句子内容不能为空！");
            return;
        }
        // 调用父组件传递过来的更新函数
        onUpdateSentenceText(sentenceToEdit.id, editingSentenceText.trim());
        handleCloseEditSentenceDialog();
    };
    // --------------------------

    return (
        <> {/* 使用 Fragment 包裹，因为 Dialog 需要在 Card 外部 */}
        <Card>
            <CardHeader
                title="最终TTS脚本句子列表"
                action={
                    <TextField
                        size="small"
                        variant="outlined"
                        placeholder="搜索句子..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
                            ),
                        }}
                        sx={{ width: { xs: '100%', sm: 300 } }}
                    />
                }
            />
            <CardContent sx={{pt: 0}}> {/* 移除 CardHeader 和 CardContent 之间的额外上边距 */}
                <TableContainer component={Paper} elevation={0}>
                    <Table size="small" stickyHeader> {/* stickyHeader 可以让表头在滚动时固定 */}
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ width: '5%', fontWeight: 'bold' }}>序号</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>句子文本</TableCell>
                                <TableCell sx={{ width: '15%', fontWeight: 'bold' }}>语音状态</TableCell>
                                <TableCell sx={{ width: '25%', fontWeight: 'bold', textAlign:'center' }}>操作</TableCell> {/* 增加宽度，按钮靠右 */}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {paginatedSentences.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} align="center">
                                        <Typography color="textSecondary" sx={{p:2}}>
                                            {searchTerm ? '未找到匹配的句子' : '暂无句子，请先拆分脚本。'}
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                paginatedSentences.map(sentence => (
                                    <TableRow key={sentence.id} hover>
                                        <TableCell>{sentence.order_index + 1}</TableCell>
                                        <TableCell>{sentence.text}</TableCell>
                                        <TableCell>
                                            <Chip
                                                label={sentence.audio_status || '未知'}
                                                size="small"
                                                color={sentence.audio_status === 'generated' ? 'success' : (sentence.audio_status === 'generating' || sentence.audio_status === 'processing_request' ? 'info' : (sentence.audio_status?.startsWith('error') ? 'error' : 'default'))}
                                            />
                                        </TableCell>
                                        <TableCell align="right"> {/* 操作按钮靠右 */}
                                            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', justifyContent: 'flex-end' }}>
                                                {/* 编辑按钮 */}
                                                <Tooltip title="编辑句子">
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => handleOpenEditSentenceDialog(sentence)}
                                                            color="default" // 或者 "action"
                                                        >
                                                            <EditIcon fontSize="small"/>
                                                        </IconButton>
                                                </Tooltip>
                                                {sentence.audio_status === 'generated' && sentence.latest_audio_url && (
                                                    <Tooltip title={playingAudio && playingAudio.sentenceId === sentence.id ? "停止" : "播放"}>
                                                      <IconButton
                                                        size="small"
                                                        onClick={() => onPlayAudio(sentence.id, sentence.latest_audio_url)}
                                                        color={playingAudio && playingAudio.sentenceId === sentence.id ? "error" : "primary"}
                                                      >
                                                        {playingAudio && playingAudio.sentenceId === sentence.id ? <StopCircleOutlinedIcon /> : <PlayArrowIcon />}
                                                      </IconButton>
                                                    </Tooltip>
                                                )}
                                                {sentence.audio_status === 'generated' && sentence.latest_audio_url && (
                                                   <Tooltip title="下载">
                                                      <IconButton
                                                        size="small"
                                                        href={sentence.latest_audio_url.startsWith('http') ? sentence.latest_audio_url : `${API_BASE_URL.replace('/api', '')}/media/tts_audio/${sentence.latest_audio_url}`}
                                                        download={`sentence_${sentence.order_index + 1}.wav`} //  您可以自定义下载的文件名
                                                        color="primary"
                                                      >
                                                        <DownloadIcon />
                                                      </IconButton>
                                                   </Tooltip>
                                                )}
                                                {(sentence.audio_status === 'pending_generation' || sentence.audio_status === 'error_generation' || sentence.audio_status === 'pending_regeneration' || sentence.audio_status === 'error_submission' || sentence.audio_status === 'error_polling') && (
                                                    <Button
                                                        size="small"
                                                        variant="outlined"
                                                        onClick={() => onGenerateAudio(sentence.id)}
                                                        disabled={actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating'}
                                                        startIcon={(actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating') ? <CircularProgress size={16} /> : <AudiotrackIcon />}
                                                    >
                                                        {sentence.audio_status?.startsWith('error') ? '重试' : '生成'}
                                                    </Button>
                                                )}
                                                {sentence.audio_status === 'generated' && (
                                                    <Tooltip title="重新生成语音">
                                                      <span> {/* Tooltip 需要一个可以接受 ref 的子元素，IconButton 可以，但如果 disabled 了就不行，所以用 span 包裹 */}
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => onGenerateAudio(sentence.id)}
                                                            disabled={actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating'}
                                                            sx={{ml:0.5}} // 调整间距
                                                        >
                                                            {(actionLoading[`sentence_${sentence.id}`] || sentence.audio_status === 'processing_request' || sentence.audio_status === 'generating') ? <CircularProgress size={20} color="inherit"/> : <RefreshIcon />}
                                                        </IconButton>
                                                      </span>
                                                    </Tooltip>
                                                )}
                                                {(sentence.audio_status === 'generating' || sentence.audio_status === 'processing_request') && <CircularProgress size={20} sx={{ml:1}} />}
                                            </Box>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
                {filteredSentences.length > 0 && (
                    <TablePagination
                        component="div"
                        count={filteredSentences.length} // 总数应该是过滤后的句子数量
                        page={page}
                        onPageChange={handleChangePage}
                        rowsPerPage={rowsPerPage}
                        onRowsPerPageChange={handleChangeRowsPerPage}
                        rowsPerPageOptions={[10, 25, 50, 100, 200]} // 可以增加更多选项
                        labelRowsPerPage="每页句数:"
                        labelDisplayedRows={({ from, to, count }) => `${from}-${to} 共 ${count}`}
                        // sx={{ '.MuiTablePagination-toolbar': { justifyContent: 'flex-start' } }} // 可选：让分页控件靠左
                    />
                )}
            </CardContent>
        </Card>
        {/* 编辑句子对话框 */}
            <Dialog open={editSentenceDialogOpen} onClose={handleCloseEditSentenceDialog} maxWidth="sm" fullWidth>
                <DialogTitle>编辑句子 (序号: {sentenceToEdit?.order_index != null ? sentenceToEdit.order_index + 1 : ''})</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        margin="dense"
                        label="句子内容"
                        type="text"
                        fullWidth
                        multiline
                        rows={4} // 增加行数以便编辑较长句子
                        value={editingSentenceText}
                        onChange={(e) => setEditingSentenceText(e.target.value)}
                        sx={{ mt: 1 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseEditSentenceDialog}>取消</Button>
                    <Button onClick={handleSaveEditedSentence} variant="contained">保存更改</Button>
                </DialogActions>
            </Dialog>
        </>
    );
};