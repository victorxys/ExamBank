import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  TextField,
  Button,
  Grid,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Box,
  CircularProgress,
  Divider,
  Card,
  CardContent
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import AlertMessage from './AlertMessage';
import PageHeader from './PageHeader';

const PublicEmployeeSelfEvaluation = () => {
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [comments, setComments] = useState('');
  const [evaluationItems, setEvaluationItems] = useState({});
  const [evaluations, setEvaluations] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [alertSeverity, setAlertSeverity] = useState('error');

  const navigate = useNavigate();

  useEffect(() => {
    fetchEvaluationItems();
  }, []);

  const fetchEvaluationItems = async () => {
    try {
      setLoading(true);
      // Get evaluation items that are visible to clients/employees
      const response = await api.get('/evaluation-items?visible=true');

      // console.log('Evaluation items:', response.data);
      // Group items by aspect and category
      const groupedItems = {};
      // Check if response.data is an array (direct items) or has an items property
      const items = Array.isArray(response.data) ? response.data : response.data.items;

      if (!items || items.length === 0) {
        setAlertMessage('没有可用的评价项目');
        setAlertSeverity('warning');
        setAlertOpen(true);
        setLoading(false);
        return;
      }

      items.forEach(item => {
        // 如果没有aspect_name或category_name，使用默认值
        const aspectName = item.aspect_name || '通用评价';
        const categoryName = item.category_name || '通用类别';

        if (!groupedItems[aspectName]) {
          groupedItems[aspectName] = {};
        }

        if (!groupedItems[aspectName][categoryName]) {
          groupedItems[aspectName][categoryName] = [];
        }

        groupedItems[aspectName][categoryName].push(item);
      });

      setEvaluationItems(groupedItems);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching evaluation items:', err);
      setAlertMessage('无法加载评价项目，请稍后再试');
      setAlertSeverity('error');
      setAlertOpen(true);
      setLoading(false);
    }
  };

  const handleScoreChange = (itemId, score) => {
    setEvaluations(prevEvaluations => {
      const updatedEvaluations = { ...prevEvaluations }; // Create a shallow copy of the previous state
      updatedEvaluations[itemId] = {
        ...updatedEvaluations[itemId], // Copy existing item data if available
        score: score === '' ? '' : parseInt(score) // 统一在这里处理 score 的 parseInt，空字符串不进行转换
      };
      return updatedEvaluations;
    });
  };


  const handleRadioClick = (e, itemId, value) => {
    // console.log("handleRadioClick triggered");

    const currentValue = String(value); // 统一转换为字符串进行比较
    const existingValue = String(evaluations[itemId]?.score); // 统一转换为字符串进行比较

    // console.log("itemId:", itemId);
    // console.log("value (string):", value);
    // console.log("currentValue (string):", currentValue);
    // console.log("existingValue (string):", existingValue);

    const isAlreadySelected = existingValue === currentValue;
    // console.log("isAlreadySelected:", isAlreadySelected);

    if (isAlreadySelected) {
      // console.log("Action: Deselecting");
      handleScoreChange(itemId, ''); // 设置为空字符串以取消选择
    } else {
      // console.log("Action: Selecting");
      handleScoreChange(itemId, value); // 选择新的值
    }

    // console.log("evaluations after handleRadioClick:", evaluations);
    // console.log("--------------------");
  };


  const handleCommentChange = (itemId, comment) => {
    setEvaluations({
      ...evaluations,
      [itemId]: {
        ...evaluations[itemId],
        comment
      }
    });
  };

  const validateForm = () => {
    if (!name.trim()) {
      setAlertMessage('请输入姓名');
      setAlertSeverity('error');
      setAlertOpen(true);
      return false;
    }

    if (!phoneNumber.trim()) {
      setAlertMessage('请输入手机号');
      setAlertSeverity('error');
      setAlertOpen(true);
      return false;
    }

    // Check if phone number is valid (simple validation)
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phoneNumber)) {
      setAlertMessage('请输入有效的手机号码');
      setAlertSeverity('error');
      setAlertOpen(true);
      return false;
    }

    // Check if all items have been evaluated
    let hasEvaluations = false;
    for (const aspect in evaluationItems) {
      for (const category in evaluationItems[aspect]) {
        for (const item of evaluationItems[aspect][category]) {
          if (evaluations[item.id]?.score !== undefined && evaluations[item.id]?.score !== '') { // 修改判断条件，排除 undefined 和 空字符串
            hasEvaluations = true;
          }
        }
      }
    }

    if (!hasEvaluations) {
      setAlertMessage('请至少评价一个项目');
      setAlertSeverity('error');
      setAlertOpen(true);
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setSubmitting(true);

      // 准备评价项目数据
      const evaluationData = Object.keys(evaluations).map(itemId => ({
        item_id: itemId,
        score: evaluations[itemId].score,
        comment: evaluations[itemId].comment || ''
      })).filter(evaluation => evaluation.score !== undefined && evaluation.score !== ''); // 确保 score 不是 undefined 或 空字符串

      const response = await api.post('/employee-self-evaluation', {
        name,
        phone_number: phoneNumber,
        comments,
        evaluations: evaluationData
      });

      setSubmitting(false);

      // Redirect to thank you page
      navigate('/thank-you', {
        state: {
          message: '感谢您的自我评价！',
          details: '您的评价已成功提交。'
        }
      });

    } catch (err) {
      console.error('Error submitting evaluation:', err);
      setAlertMessage('提交失败，请稍后再试');
      setAlertSeverity('error');
      setAlertOpen(true);
      setSubmitting(false);
    }
  };

  const handleAlertClose = () => {
    setAlertOpen(false);
  };

  return (
    <Container maxWidth="lg">
      <AlertMessage
        open={alertOpen}
        message={alertMessage}
        severity={alertSeverity}
        onClose={() => setAlertOpen(false)}
      />

      <PageHeader
        title="自我评价"
        description="请如实进行自我评价，对于不适用的评价项可以不做选择"
      />

      {loading ? (
        <Box display="flex" justifyContent="center" my={4}>
          <CircularProgress />
        </Box>
      ) : (
        <form onSubmit={handleSubmit}>
          <Paper elevation={3} sx={{ p: 3, mb: 4 }}>
            <Typography variant="h3" gutterBottom>个人信息</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="姓名"
                  variant="outlined"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  error={submitting && !name}
                  helperText={submitting && !name ? "请输入姓名" : ""}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="手机号码"
                  variant="outlined"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  required
                  error={submitting && !phoneNumber}
                  helperText={submitting && !phoneNumber ? "请输入手机号码" : ""}
                />
              </Grid>
            </Grid>
          </Paper>

          {Object.keys(evaluationItems).map(aspectName => (
            <Card key={aspectName} sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h2" gutterBottom textAlign={'center'}>
                  {aspectName === "客户评价" ? "客户对你的评价" : aspectName}
                </Typography>

                {Object.keys(evaluationItems[aspectName]).map(categoryName => (
                  <Box key={categoryName} sx={{ mb: 3 }}>
                    <Typography variant="h3" gutterBottom>{categoryName}</Typography>

                    {evaluationItems[aspectName][categoryName].map(item => (
                      <Box key={item.id} sx={{ mb: 2 }}>
                        <FormControl component="fieldset">
                          <FormLabel component="legend">
                            {item.item_name}
                          </FormLabel>
                          <RadioGroup
                            row
                            value={String(evaluations[item.id]?.score) || ''} // value 绑定到 String 类型
                            onChange={(e) => handleScoreChange(item.id, e.target.value)}
                          >
                            <FormControlLabel
                              value={"80"} // value 统一使用 String 类型
                              control={
                                <Radio
                                  onClick={(e) => handleRadioClick(e, item.id, "80")} // value 统一使用 String 类型
                                />
                              }
                              label="好 (80分)"
                            />
                            <FormControlLabel
                              value={"60"} // value 统一使用 String 类型
                              control={
                                <Radio
                                  onClick={(e) => handleRadioClick(e, item.id, "60")} // value 统一使用 String 类型
                                />
                              }
                              label="一般 (60分)"
                            />
                            <FormControlLabel
                              value={"40"} // value 统一使用 String 类型
                              control={
                                <Radio
                                  onClick={(e) => handleRadioClick(e, item.id, "40")} // value 统一使用 String 类型
                                />
                              }
                              label="不好 (40分)"
                            />
                            <FormControlLabel
                              value={"0"} // value 统一使用 String 类型
                              control={
                                <Radio
                                  onClick={(e) => handleRadioClick(e, item.id, "0")} // value 统一使用 String 类型
                                />
                              }
                              label="不具备 (0分)"
                            />
                          </RadioGroup>
                        </FormControl>

                        {item.description && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, ml: 2 }}>
                            {item.description}
                          </Typography>
                        )}
                      </Box>
                    ))}
                    <Divider sx={{ my: 2 }} />
                  </Box>
                ))}
              </CardContent>
            </Card>
          ))}

          {/* 添加补充评价输入框 */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h2" gutterBottom textAlign={'center'}>补充评价</Typography>
              <TextField
                fullWidth
                multiline
                rows={4}
                label="补充评价内容"
                placeholder="请在此处添加补充评价内容..."
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                variant="outlined"
                sx={{ mb: 2 }}
              />
              <Typography variant="body2" color="text.secondary">
                请在此处添加补充评价，可以包括优点、需要改进的地方或其他建议。
              </Typography>
            </CardContent>
          </Card>

          <Box display="flex" justifyContent="center" mt={4} mb={4}>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={submitting}
            >
              {submitting ? '提交中...' : '提交评价'}
            </Button>
          </Box>
        </form>
      )}
    </Container>
  );
};

export default PublicEmployeeSelfEvaluation;