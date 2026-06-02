import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Card, 
  CardContent, 
  Typography, 
  Switch, 
  TextField, 
  Button, 
  Divider, 
  Alert,
  CircularProgress,
  Grid,
  Tooltip
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import ReplayIcon from '@mui/icons-material/Replay';
import axios from 'axios';

const RESET_LAST_RUN_DATE = "2000-01-01";

const formatLastRunDate = (date) => {
  if (!date || date === RESET_LAST_RUN_DATE) {
    return "尚未发送";
  }
  return date;
};

const NotificationSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resettingKey, setResettingKey] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [settings, setSettings] = useState({
    reminders: {
        contract_expiry: { enabled: true, advance_days: 30, time: "09:00" },
        trial_expiry: { enabled: true, advance_days: 1, time: "09:00" },
        pregnancy: { enabled: true, advance_days: 7, time: "09:00" },
        attendance: { enabled: true, day_of_month: 1, time: "09:00" },
        monthly_management_fee: { enabled: true, start_day: 1, end_day: 5, time: "09:00" },
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
    } else if (field === 'advance_days' || field === 'day_of_month' || field === 'start_day' || field === 'end_day') {
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
        if (res.data.data) {
          setSettings(res.data.data);
        }
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

  const handleResetLastRun = (key) => async () => {
    try {
      setResettingKey(key);
      setSuccess(null);
      setError(null);

      const res = await axios.post(`/api/settings/notification/reminders/${key}/reset`);
      if (res.data.status === 'success') {
        if (res.data.data) {
          setSettings(res.data.data);
        }
        setSuccess("已重置该通知的最后发送状态。");
      } else {
        setError(res.data.message || "重置失败");
      }
    } catch (err) {
      console.error(err);
      setError("重置通知状态时出现网络错误。");
    } finally {
      setResettingKey(null);
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
    { key: "monthly_management_fee", label: "育儿嫂月度管理费提醒", desc: "每月月初提醒运营发送上月工资明细并催缴本月管理费", hasDayRange: true },
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

      <Card sx={{ borderRadius: 1 }}>
        <CardContent sx={{ p: 0 }}>
          {remindersConfig.map((item, index) => {
            const config = settings.reminders?.[item.key] || {};
            const isEnabled = config.enabled ?? true;
            const renderRecipientField = (
              <TextField
                label="接收人"
                size="small"
                value={config.notify_users || ""}
                onChange={handleFieldChange(item.key, 'notify_users')}
                placeholder="XuYongSheng|Jinli 或 @all"
                helperText="企业微信 UserID，多个用 | 分隔；留空使用系统默认接收人"
                sx={{ minWidth: { xs: '100%', md: 360 }, flex: 1 }}
              />
            );

            return (
              <React.Fragment key={item.key}>
                <Box sx={{ px: 3, py: 2.25 }}>
                  <Grid container spacing={2.5} alignItems="flex-start">
                    <Grid item xs={12} md={3.6}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                        <Switch
                          checked={isEnabled}
                          onChange={handleFieldChange(item.key, 'enabled')}
                          color="primary"
                          sx={{ mt: -0.5 }}
                        />
                        <Box>
                          <Typography variant="subtitle1" fontWeight={700} sx={{ lineHeight: 1.3 }}>
                            {item.label}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, lineHeight: 1.7 }}>
                            {item.desc}
                          </Typography>
                        </Box>
                      </Box>
                    </Grid>

                    <Grid item xs={12} md={8.4}>
                      {isEnabled ? (
                        item.isRealtime ? (
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
                            {renderRecipientField}
                            <Box sx={{ minWidth: 160, pt: 0.75 }}>
                              <Typography variant="caption" color="text.secondary" display="block">
                                触发方式
                              </Typography>
                              <Typography variant="body2" color="info.main" sx={{ mt: 0.25 }}>
                                事件发生时即时推送
                              </Typography>
                            </Box>
                          </Box>
                        ) : (
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
                              {renderRecipientField}
                              {item.hasAdvance && (
                                <TextField
                                  label="提前天数"
                                  type="number"
                                  size="small"
                                  value={config.advance_days ?? ""}
                                  onChange={handleFieldChange(item.key, 'advance_days')}
                                  inputProps={{ min: 0 }}
                                  sx={{ width: 112 }}
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
                                  sx={{ width: 112 }}
                                />
                              )}
                              {item.hasDayRange && (
                                <>
                                  <TextField
                                    label="开始日期"
                                    type="number"
                                    size="small"
                                    value={config.start_day ?? ""}
                                    onChange={handleFieldChange(item.key, 'start_day')}
                                    inputProps={{ min: 1, max: 31 }}
                                    sx={{ width: 112 }}
                                  />
                                  <TextField
                                    label="结束日期"
                                    type="number"
                                    size="small"
                                    value={config.end_day ?? ""}
                                    onChange={handleFieldChange(item.key, 'end_day')}
                                    inputProps={{ min: 1, max: 31 }}
                                    sx={{ width: 112 }}
                                  />
                                </>
                              )}
                              <TextField
                                label="推送时间"
                                type="time"
                                size="small"
                                value={config.time || "09:00"}
                                onChange={handleFieldChange(item.key, 'time')}
                                InputLabelProps={{ shrink: true }}
                                inputProps={{ step: 300 }}
                                sx={{ width: 132 }}
                              />
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                              <Box>
                                <Typography variant="caption" color="text.secondary" display="block">
                                  最后一次发送
                                </Typography>
                                <Typography variant="body2" sx={{ mt: 0.25 }}>
                                  {formatLastRunDate(config.last_run_date)}
                                </Typography>
                              </Box>
                              <Tooltip title="重置后，该通知在满足日期和时间条件时可再次触发">
                                <span>
                                  <Button
                                    variant="outlined"
                                    size="small"
                                    startIcon={<ReplayIcon />}
                                    onClick={handleResetLastRun(item.key)}
                                    disabled={resettingKey === item.key || !config.last_run_date}
                                    sx={{ minWidth: 96 }}
                                  >
                                    {resettingKey === item.key ? "重置中" : "重置"}
                                  </Button>
                                </span>
                              </Tooltip>
                            </Box>
                          </Box>
                        )
                      ) : (
                        <Typography variant="body2" color="text.disabled" sx={{ pt: 1 }}>
                          已关闭
                        </Typography>
                      )}
                    </Grid>
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
