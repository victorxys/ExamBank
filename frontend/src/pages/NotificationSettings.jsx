import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Card, 
  CardContent, 
  Typography, 
  Switch, 
  FormControlLabel, 
  TextField, 
  Button, 
  Divider, 
  Alert,
  CircularProgress,
  Grid
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import axios from 'axios';

const NotificationSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [settings, setSettings] = useState({
    reminders: {
        contract_expiry: { enabled: true, advance_days: 30, time: "09:00" },
        trial_expiry: { enabled: true, advance_days: 1, time: "09:00" },
        pregnancy: { enabled: true, advance_days: 7, time: "09:00" },
        attendance: { enabled: true, day_of_month: 1, time: "09:00" },
        insurance_expiry: { enabled: true, advance_days: 30, time: "09:00" },
        physical_exam_expiry: { enabled: true, advance_days: 30, time: "09:00" },
        debt: { enabled: true, advance_days: 3, time: "09:00" },
        onboarding: { enabled: true, advance_days: 1, time: "09:00" },
        sign_event: { enabled: true }
    }
  });

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/settings/notification');
      if (res.data.status === 'success' && res.data.data) {
        setSettings(res.data.data);
      }
      setError(null);
    } catch (err) {
      console.error(err);
      setError("无法加载通知配置，请稍后再试。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleFieldChange = (key, field) => (event) => {
    let value = event.target.value;
    if (field === 'enabled') {
      value = event.target.checked;
    } else if (field === 'advance_days' || field === 'day_of_month') {
      value = parseInt(value, 10) || 0;
    }

    setSettings((prev) => ({
      ...prev,
      reminders: {
        ...prev.reminders,
        [key]: {
          ...prev.reminders[key],
          [field]: value
        }
      }
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setSuccess(null);
      setError(null);
      
      const payload = {
        reminders: settings.reminders
      };
      
      const res = await axios.put('/api/settings/notification', payload);
      if (res.data.status === 'success') {
        setSuccess("通知配置保存成功！");
      } else {
        setError(res.data.message || "保存失败");
      }
    } catch (err) {
      console.error(err);
      setError("保存配置时出现网络错误。");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  const remindersConfig = [
    { key: "contract_expiry", label: "正式合同到期提醒", desc: "合同到期前提前通知客户和服务人员续约事宜", hasAdvance: true },
    { key: "trial_expiry", label: "试工到期提醒", desc: "试工结束前通知客户确认试工结果", hasAdvance: true },
    { key: "pregnancy", label: "预产期临近提醒", desc: "月嫂单中客户预产期临近时触发跟进通知", hasAdvance: true },
    { key: "attendance", label: "月初考勤录入提醒", desc: "每月固定日期提醒运营人员收集上月考勤", hasDay: true },
    { key: "insurance_expiry", label: "保险到期提醒", desc: "服务人员保险即将到期时提醒续保", hasAdvance: true },
    { key: "physical_exam_expiry", label: "体检到期提醒", desc: "服务人员体检报告即将过期时提醒重新体检", hasAdvance: true },
    { key: "debt", label: "欠款催缴提醒", desc: "账单逾期未支付时提醒催款", hasAdvance: true },
    { key: "onboarding", label: "上户提醒", desc: "服务人员即将上户时的提醒", hasAdvance: true },
    { key: "sign_event", label: "合同签署事件通知", desc: "客户或阿姨完成线上签署时实时推送通知", isRealtime: true },
  ];

  return (
    <Box sx={{ p: 3, maxWidth: 900, margin: '0 auto' }}>
      <Typography variant="h4" gutterBottom>
        系统通知配置
      </Typography>
      
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
      
      <Typography variant="body1" color="text.secondary" paragraph>
        在这里，您可以单独开启或关闭每种通知，并为需要定时触发的通知设置提前提醒天数及每天推送的具体时间。
      </Typography>

      <Card>
        <CardContent>
          {remindersConfig.map((item, index) => {
            const config = settings.reminders?.[item.key] || {};
            const isEnabled = config.enabled ?? true;

            return (
              <React.Fragment key={item.key}>
                <Box sx={{ my: 2 }}>
                  <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} md={4}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={isEnabled}
                            onChange={handleFieldChange(item.key, 'enabled')}
                            color="primary"
                          />
                        }
                        label={<Typography variant="subtitle1" fontWeight="bold">{item.label}</Typography>}
                      />
                      <Typography variant="body2" color="text.secondary" sx={{ ml: 5 }}>
                        {item.desc}
                      </Typography>
                    </Grid>
                    
                    {isEnabled && !item.isRealtime && (
                      <Grid item xs={12} md={8}>
                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                          {item.hasAdvance && (
                            <TextField
                              label="提前天数"
                              type="number"
                              size="small"
                              value={config.advance_days ?? ""}
                              onChange={handleFieldChange(item.key, 'advance_days')}
                              inputProps={{ min: 0 }}
                              sx={{ width: 100 }}
                            />
                          )}
                          {item.hasDay && (
                            <TextField
                              label="每月日期"
                              type="number"
                              size="small"
                              value={config.day_of_month ?? ""}
                              onChange={handleFieldChange(item.key, 'day_of_month')}
                              inputProps={{ min: 1, max: 31 }}
                              sx={{ width: 100 }}
                            />
                          )}
                          <TextField
                            label="推送时间"
                            type="time"
                            size="small"
                            value={config.time || "09:00"}
                            onChange={handleFieldChange(item.key, 'time')}
                            InputLabelProps={{ shrink: true }}
                            inputProps={{ step: 300 }} // 5 min
                            sx={{ width: 120 }}
                          />
                        </Box>
                      </Grid>
                    )}
                    {isEnabled && item.isRealtime && (
                      <Grid item xs={12} md={8}>
                        <Typography variant="body2" color="info.main">
                          事件发生时即时推送
                        </Typography>
                      </Grid>
                    )}
                  </Grid>
                </Box>
                {index < remindersConfig.length - 1 && <Divider />}
              </React.Fragment>
            );
          })}
        </CardContent>
      </Card>
      
      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
        <Button 
          variant="contained" 
          color="primary" 
          size="large"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "保存中..." : "保存配置"}
        </Button>
      </Box>
    </Box>
  );
};

export default NotificationSettings;
