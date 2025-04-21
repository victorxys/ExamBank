import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Box,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormControl,
  FormLabel,
  Button,
  Card,
  CardContent,
  Divider,
  CircularProgress,
  TextField, // 已导入
  IconButton, // 可能需要 IconButton
} from '@mui/material';
import {
  AddComment as AddCommentIcon,
  VisibilityOff as VisibilityOffIcon
} from '@mui/icons-material';
import AlertMessage from './AlertMessage';
import api from '../api/axios';
import { hasToken } from '../api/auth-utils';
import PageHeader from './PageHeader';

const UserEvaluation = () => {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [alertMessage, setAlertMessage] = useState(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [evaluations, setEvaluations] = useState({}); // item scores: { itemId: score }
  // *** 修改 State: aspectManualInputs -> categoryManualInputs ***
  const [categoryManualInputs, setCategoryManualInputs] = useState({}); // { categoryId: text }
  // *** 新增 State: 控制每个 Category 输入框的可见性 ***
  const [categoryInputVisible, setCategoryInputVisible] = useState({}); // { categoryId: boolean }
  const [additionalComments, setAdditionalComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [evaluationStructure, setEvaluationStructure] = useState([]);
  const [userInfo, setUserInfo] = useState(null);
  const tokenData = hasToken();
  const evaluator_user_id = tokenData?.sub; // 使用可选链更安全
  const searchParams = new URLSearchParams(window.location.search);
  const editEvaluationId = searchParams.get('edit');
  

  const fetchData = useCallback(async () => {
    setLoading(true);
    setAlertMessage(null); // 清除旧提示
    setAlertOpen(false);
    try {
      const userResponse = await api.get(`/users/${userId}/details`);
      setUserInfo(userResponse.data);

      // 获取评价结构 (包含 category.allow_manual_input)
      const structureResponse = await api.get('/evaluation/structure');
      if (!Array.isArray(structureResponse.data)) throw new Error('评价结构数据格式不正确');
      setEvaluationStructure(structureResponse.data);

      const initialScores = {};
      const initialManualInputs = {};
      const initialInputVisible = {}; // 初始化可见性状态

      structureResponse.data.forEach(aspect => {
          aspect.children?.forEach(category => {
              initialInputVisible[category.id] = false; // *** 默认隐藏输入框 ***
              category.children?.forEach(item => {
                  initialScores[item.id] = ''; // 初始化分数
              });
          });
      });

      if (editEvaluationId) {
        // *** 编辑模式: 获取单个评价详情 ***
        // 注意: 假设 /api/evaluation/{id} 返回的结构调整为包含 category_manual_inputs
        const evaluationResponse = await api.get(`/evaluation/${editEvaluationId}`);
        const evaluationData = evaluationResponse.data;
        console.log(evaluationData)
        // 填充已有分数
        evaluationData.item_scores?.forEach(itemScore => { // 假设返回 item_scores 数组
            if (itemScore.score !== null && itemScore.score !== undefined) {
                initialScores[itemScore.item_id] = itemScore.score.toString();
            }
        });

        // *** 编辑模式: 填充已有的 Category 手动输入 ***
        if (evaluationData.category_manual_inputs) { // 假设返回 category_manual_inputs 对象
             Object.assign(initialManualInputs, evaluationData.category_manual_inputs);
             // 如果加载到了手动输入，则默认显示该输入框
             Object.keys(evaluationData.category_manual_inputs).forEach(catId => {
              if (evaluationData.category_manual_inputs[catId]) {
                  initialInputVisible[catId] = true;
              }
          });
        }
         // 兼容另一种可能的返回结构 (手动输入嵌入 category 对象)
        else if (evaluationData.aspects) {
            console.log('evaluationData.aspects', evaluationData.aspects);
             evaluationData.aspects.forEach(aspect => {
                 aspect.categories?.forEach(category => {
                      if (category.manual_input && category.manual_input.trim()) { // 检查是否有非空值
                          initialManualInputs[category.id] = category.manual_input;
                          // *** 修改：如果 manual_input 有值，则设置该 category 的输入框为可见 ***
                          initialInputVisible[category.id] = true;
                          // *** 结束修改 ***
                      }
                     category.items?.forEach(item => {
                        if(item.average_score){
                          console.log('item.average_score', item.average_score);
                          initialScores[item.id]=item.average_score.toString();
                        }
                     });
                     
                 });
             });
         }

        if (evaluationData.additional_comments) {
          setAdditionalComments(evaluationData.additional_comments);
        }
      }

      setEvaluations(initialScores);
      setCategoryManualInputs(initialManualInputs);
      setCategoryInputVisible(initialInputVisible); // *** 设置可见性状态 ***

    } catch (error) {
      console.error('获取数据失败:', error);
      setAlertMessage({ severity: 'error', message: '获取数据失败: ' + (error.response?.data?.message || error.message) });
      setAlertOpen(true);
    } finally {
      setLoading(false);
    }
  }, [userId, editEvaluationId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // *** handleSubmit: 发送 category_manual_inputs ***
  const handleSubmit = async () => {
    setSubmitting(true);
    setAlertMessage(null);
    setAlertOpen(false);
    try {
      const endpoint = editEvaluationId ? `/evaluation/${editEvaluationId}` : '/evaluation';
      const method = editEvaluationId ? 'put' : 'post';

      const itemScoresPayload = Object.entries(evaluations)
        .filter(([, score]) => score !== '' && score !== null && score !== undefined)
        .map(([itemId, score]) => ({ item_id: itemId, score: parseInt(score, 10) }));

      // *** 准备 category_manual_inputs payload ***
      const categoryManualInputsPayload = Object.entries(categoryManualInputs)
            .filter(([categoryId, text]) => text && text.trim())
            .reduce((acc, [categoryId, text]) => { acc[categoryId] = text.trim(); return acc; }, {});

      const payload = {
        evaluated_user_id: userId,
        evaluator_user_id: evaluator_user_id, // 确保这个 ID 有效
        item_scores: itemScoresPayload,
        category_manual_inputs: categoryManualInputsPayload, // *** 发送 category 数据 ***
        additional_comments: additionalComments.trim()
      };

      console.log("Submitting Payload:", JSON.stringify(payload, null, 2));

      const response = await api[method](endpoint, payload);

      if (response.data && response.data.success) {
        setAlertMessage({ severity: 'success', message: editEvaluationId ? '评价更新成功' : '评价提交成功' });
        setAlertOpen(true);
        setTimeout(() => { navigate(`/user-evaluation-summary/${userId}`); }, 1500);
      } else { throw new Error(response.data?.message || '提交失败'); }
    } catch (error) {
      console.error('提交评价失败:', error);
      setAlertMessage({ severity: 'error', message: error.response?.data?.message || error.message || '提交评价失败，请稍后重试' });
      setAlertOpen(true);
    } finally { setSubmitting(false); }
  };

  // handleScoreChange, handleRadioClick 不变
  const handleScoreChange = (itemId, value) => { setEvaluations(prev => ({ ...prev, [itemId]: value === '' ? '' : value })); };
  const handleRadioClick = (e, itemId, value) => { if (evaluations[itemId] === value) { e.preventDefault(); handleScoreChange(itemId, ''); } else { handleScoreChange(itemId, value); } };

  // *** 修改: 处理 Category 手动输入变化 ***
  const handleManualInputChange = (categoryId, value) => {
        setCategoryManualInputs(prev => ({ ...prev, [categoryId]: value }));
  };
  // *** 新增：切换 Category 输入框可见性 ***
  const toggleCategoryInputVisibility = (categoryId) => {
    setCategoryInputVisible(prev => ({
        ...prev,
        [categoryId]: !prev[categoryId]
    }));
    // 可选：如果隐藏时清空输入内容
    // if (categoryInputVisible[categoryId]) {
    //     handleManualInputChange(categoryId, '');
    // }
  };
  // handleAdditionalCommentsChange 不变
  const handleAdditionalCommentsChange = (event) => { setAdditionalComments(event.target.value); };

  const handleAlertClose = () => { setAlertOpen(false); };

  // --- 渲染逻辑 ---
  const renderEvaluationItem = (item) => (
      <Box key={item.id} sx={{ mb: 2, ml: 4 }}>
        <FormControl component="fieldset" fullWidth>
          <FormLabel component="legend" sx={{ fontWeight: 'medium' }}> {item.name} </FormLabel>
          <RadioGroup row value={evaluations[item.id] || ''} onChange={(e) => handleScoreChange(item.id, e.target.value)} >
            <FormControlLabel value="80" control={<Radio size="small" onClick={(e) => handleRadioClick(e, item.id, "80")}/>} label="好 (80分)"/>
            <FormControlLabel value="60" control={<Radio size="small" onClick={(e) => handleRadioClick(e, item.id, "60")}/>} label="一般 (60分)"/>
            <FormControlLabel value="40" control={<Radio size="small" onClick={(e) => handleRadioClick(e, item.id, "40")}/>} label="不好 (40分)"/>
            <FormControlLabel value="0" control={<Radio size="small" onClick={(e) => handleRadioClick(e, item.id, "0")}/>} label="不具备 (0分)"/>
          </RadioGroup>
        </FormControl>
        {item.description && ( <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, ml: 1 }}> {item.description} </Typography> )}
      </Box>
  );

  // *** 修改 renderEvaluationCategory: 添加手动输入框 ***
  const renderEvaluationCategory = (category) => (
      <Box key={category.id} sx={{ mb: 3, ml: 2, borderLeft: '3px solid orange', pl: 2, pt: 1 }}> {/* 添加边框和内边距 */}
        <Typography variant="h3" gutterBottom>{category.name}</Typography>

        {/* *** 修改手动输入部分的渲染逻辑 *** */}
        {category.allow_manual_input && (
            <Box sx={{ mt: 1, mb: 2 }}>
                {/* 如果输入框可见 */}
                {categoryInputVisible[category.id] ? (
                    <>
                        <TextField
                            label={`针对“${category.name}”的补充评价`}
                            multiline
                            rows={3}
                            fullWidth
                            value={categoryManualInputs[category.id] || ''}
                            onChange={(e) => handleManualInputChange(category.id, e.target.value)}
                            variant="outlined"
                            sx={{ mb: 1 }} // 输入框下方留点间距
                        />
                        <Button
                            size="small"
                            variant="text" // 或者 "outlined"
                            startIcon={<VisibilityOffIcon />}
                            onClick={() => toggleCategoryInputVisibility(category.id)}
                            sx={{ textTransform: 'none', color: 'text.secondary' }}
                        >
                            隐藏输入框
                        </Button>
                    </>
                ) : (
                    /* 如果输入框不可见，显示添加按钮 */
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<AddCommentIcon />}
                        onClick={() => toggleCategoryInputVisibility(category.id)}
                        sx={{ textTransform: 'none' }} // 防止按钮文字大写
                    >
                        添加手动评价
                    </Button>
                )}
            </Box>
        )}
        {/* --- 结束修改 --- */}

        {/* 渲染该类别下的 Item */}
        {category.children?.map(item => renderEvaluationItem(item))}
        {/* <Divider sx={{ mt: 1 }} /> // 可能不再需要这个 Divider */}
      </Box>
  );

  // *** 修改 renderEvaluationAspect: 移除手动输入框 ***
  const renderEvaluationAspect = (aspect) => (
      <Card key={aspect.id} sx={{ mb: 3 }} variant='outlined'>
        <CardContent>
          <Typography variant="h2" gutterBottom textAlign={'center'}>{aspect.name}</Typography>
           {/* 渲染类别 */}
          {aspect.children?.map(category => renderEvaluationCategory(category))}
        </CardContent>
      </Card>
  );

  if (loading) { return ( <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px"> <CircularProgress /> </Box> ); }

  return (
    <Container maxWidth="md" >
      <AlertMessage open={alertOpen} message={alertMessage?.message} severity={alertMessage?.severity || 'info'} onClose={handleAlertClose} />
       <PageHeader title= {userInfo ? `正在对 ${userInfo.name || userInfo.username} 进行评价` : '用户评价'} description="请根据实际情况进行评价。对于允许手动输入的方面，可以添加文字补充说明。" />

      {/* 渲染所有 Aspect */}
      {evaluationStructure.map(aspect => renderEvaluationAspect(aspect))}

      {/* 总体补充评价 */}
      <Card sx={{ mb: 3 }} variant='outlined'>
        <CardContent>
          <Typography variant="h2" gutterBottom textAlign={'center'}>总体补充说明</Typography>
          <TextField fullWidth multiline rows={4} label="补充说明（可选）" placeholder="请在此处添加对该员工的总体评价、优点、改进建议等..." value={additionalComments} onChange={handleAdditionalCommentsChange} variant="outlined" sx={{ mb: 1 }} />
        </CardContent>
      </Card>

      {/* 提交按钮 */}
      <Box display="flex" justifyContent="center" mt={4} mb={4}>
        <Button variant="contained" color="primary" size="large" onClick={handleSubmit} disabled={submitting || loading} >
          {submitting ? <CircularProgress size={24} color="inherit" /> : (editEvaluationId ? '更新评价' : '提交评价')}
        </Button>
      </Box>
    </Container>
  );
};

export default UserEvaluation;