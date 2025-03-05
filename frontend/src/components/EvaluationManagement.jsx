import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Box,
  FormControlLabel,
  Checkbox,
  Button,
  Card,
  CardContent,
  Divider,
  CircularProgress,
} from '@mui/material';
import AlertMessage from './AlertMessage';
import api from '../api/axios';
import PageHeader from './PageHeader';

const EvaluationManagement = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [alertMessage, setAlertMessage] = useState(null);
  const [alertOpen, setAlertOpen] = useState(false);
  const [evaluationStructure, setEvaluationStructure] = useState([]);
  const [visibilitySettings, setVisibilitySettings] = useState({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await api.get('/evaluation/structure');
        if (Array.isArray(response.data)) {
          setEvaluationStructure(response.data);
          const initialVisibility = {};
          response.data.forEach(aspect => {
            aspect.children?.forEach(category => {
              category.children?.forEach(item => {
                initialVisibility[item.id] = item.is_visible_to_client || false;
              });
            });
          });
          setVisibilitySettings(initialVisibility);
        } else {
          throw new Error('评价结构数据格式不正确');
        }
      } catch (error) {
        console.error('获取数据失败:', error);
        setAlertMessage({
          severity: 'error',
          message: '获取数据失败: ' + (error.response?.data?.message || error.message)
        });
        setAlertOpen(true);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleVisibilityChange = (itemId) => (event) => {
    setVisibilitySettings(prev => ({
      ...prev,
      [itemId]: event.target.checked
    }));
  };

  const handleSave = async () => {
    try {
      await api.put('/evaluation/visibility', {
        visibilitySettings
      });
      setAlertMessage({
        severity: 'success',
        message: '可见性设置保存成功'
      });
      setAlertOpen(true);
    } catch (error) {
      console.error('保存失败:', error);
      setAlertMessage({
        severity: 'error',
        message: error.response?.data?.message || error.message || '保存失败，请稍后重试'
      });
      setAlertOpen(true);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  const handleAlertClose = () => {
    setAlertOpen(false);
  };

  return (
    <Container maxWidth="100%">
      <AlertMessage
        open={alertOpen}
        message={alertMessage?.message}
        severity={alertMessage?.severity || 'info'}
        onClose={handleAlertClose}
      />
      <PageHeader
        title="评价管理"
        description="管理评价项及其对客户的可见性"
      />
      {evaluationStructure.map(aspect => (
        <Card key={aspect.id} sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h2" gutterBottom textAlign={'center'}>{aspect.name}</Typography>
            {aspect.children?.map(category => (
              <Box key={category.id} sx={{ mb: 3 }}>
                <Typography variant="h3" gutterBottom>{category.name}</Typography>
                {category.children?.map(item => (
                  <Box key={item.id} sx={{ mb: 2 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                      <Typography variant="body1">{item.name}</Typography>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={visibilitySettings[item.id] || false}
                            onChange={handleVisibilityChange(item.id)}
                          />
                        }
                        label="开放给客户"
                      />
                    </Box>
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
      <Box display="flex" justifyContent="center" mt={4}>
        <Button
          variant="contained"
          color="primary"
          onClick={handleSave}
        >
          保存设置
        </Button>
      </Box>
    </Container>
  );
};

export default EvaluationManagement;