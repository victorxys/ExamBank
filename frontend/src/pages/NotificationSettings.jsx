import React, { useEffect, useState } from 'react';
import { Bell, CalendarDays, Clock3, RotateCcw, Save, Send, Users } from 'lucide-react';
import axios from 'axios';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';

const RESET_LAST_RUN_DATE = '2000-01-01';
const DEFAULT_CONTRACT_CREATED_AFTER = '2026-06-01';
const DEFAULT_CONTRACT_END_AFTER = '2026-06-01';
const DEFAULT_TRIAL_END_AFTER = '2026-06-01';

const formatLastRunTime = (date, dateTime) => {
  if (dateTime) return dateTime;
  if (!date || date === RESET_LAST_RUN_DATE) return '尚未发送';
  return date;
};

const initialSettings = {
  reminders: {
    contract_expiry: { enabled: true, advance_days: 30, time: '09:00', contract_end_after: DEFAULT_CONTRACT_END_AFTER },
    trial_expiry: { enabled: true, advance_days: 1, time: '09:00', trial_end_after: DEFAULT_TRIAL_END_AFTER },
    pregnancy: { enabled: true, advance_days: 7, time: '09:00', contract_created_after: DEFAULT_CONTRACT_CREATED_AFTER },
    attendance: { enabled: true, day_of_month: 1, time: '09:00' },
    monthly_management_fee: { enabled: true, start_day: 1, end_day: 5, time: '09:00' },
    insurance_expiry: { enabled: true, advance_days: 30, time: '09:00' },
    physical_exam_expiry: { enabled: true, advance_days: 30, time: '09:00' },
    debt: { enabled: true, advance_days: 3, time: '09:00' },
    onboarding: { enabled: true, advance_days: 1, time: '09:00', contract_created_after: DEFAULT_CONTRACT_CREATED_AFTER },
    sign_event: { enabled: true },
  },
};

const remindersConfig = [
  { key: 'contract_expiry', label: '正式合同到期提醒', desc: '合同到期前提前通知客户和服务人员续约事宜', hasAdvance: true, hasContractEndAfter: true },
  { key: 'trial_expiry', label: '试工到期提醒', desc: '试工结束前通知客户确认试工结果', hasAdvance: true, hasTrialEndAfter: true },
  { key: 'pregnancy', label: '预产期临近提醒', desc: '月嫂单中客户预产期临近时触发跟进通知', hasAdvance: true, hasContractCreatedAfter: true },
  { key: 'attendance', label: '月初考勤录入提醒', desc: '每月固定日期提醒运营人员收集上月考勤', hasDay: true },
  { key: 'monthly_management_fee', label: '育儿嫂月度管理费提醒', desc: '每月月初提醒运营发送上月工资明细并催缴本月管理费', hasDayRange: true },
  { key: 'insurance_expiry', label: '保险到期提醒', desc: '服务人员保险即将到期时提醒续保', hasAdvance: true },
  { key: 'physical_exam_expiry', label: '体检到期提醒', desc: '服务人员体检报告即将过期时提醒重新体检', hasAdvance: true },
  { key: 'debt', label: '欠款催缴提醒', desc: '账单逾期未支付时提醒催款', hasAdvance: true },
  { key: 'onboarding', label: '上户提醒', desc: '服务人员即将上户时的提醒', hasAdvance: true, hasContractCreatedAfter: true },
  { key: 'sign_event', label: '合同签署事件通知', desc: '客户或阿姨完成线上签署时实时推送通知', isRealtime: true },
];

const numberFields = new Set(['advance_days', 'day_of_month', 'start_day', 'end_day']);

const fieldBaseClass = 'h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-[#525f7f] shadow-sm outline-none transition placeholder:text-slate-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15';

const FieldLabel = ({ children }) => (
  <span className="mb-1.5 block text-xs font-medium text-[#8898aa]">{children}</span>
);

const SectionTitle = ({ icon: Icon, children }) => (
  <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-[#525f7f]">
    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-50 text-teal-700">
      <Icon className="h-4 w-4" />
    </span>
    {children}
  </div>
);

const NotificationSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resettingKey, setResettingKey] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [settings, setSettings] = useState(initialSettings);

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
      setError('无法加载通知配置，请稍后再试。');
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
    } else if (numberFields.has(field)) {
      value = parseInt(value, 10) || 0;
    }

    setSettings((prev) => ({
      ...prev,
      reminders: {
        ...prev.reminders,
        [key]: {
          ...prev.reminders[key],
          [field]: value,
        },
      },
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setSuccess(null);
      setError(null);

      const res = await axios.put('/api/settings/notification', {
        reminders: settings.reminders,
      });

      if (res.data.status === 'success') {
        if (res.data.data) setSettings(res.data.data);
        setSuccess('通知配置保存成功。');
      } else {
        setError(res.data.message || '保存失败');
      }
    } catch (err) {
      console.error(err);
      setError('保存配置时出现网络错误。');
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
        if (res.data.data) setSettings(res.data.data);
        setSuccess('已重置该通知的最后发送状态。');
      } else {
        setError(res.data.message || '重置失败');
      }
    } catch (err) {
      console.error(err);
      setError('重置通知状态时出现网络错误。');
    } finally {
      setResettingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-5 md:px-6">
      <div className="mb-5 flex flex-col gap-3 rounded-md border border-teal-100 bg-white/85 px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#172b4d]">系统通知配置</h1>
          <p className="mt-1 text-sm text-[#8898aa]">为每类通知单独配置推送时间、接收人和历史数据过滤条件。</p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="w-full bg-teal-600 text-white shadow-sm hover:bg-teal-500 md:w-auto">
          <Save className="mr-2 h-4 w-4" />
          {saving ? '保存中...' : '保存配置'}
        </Button>
      </div>

      {error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

      <div className="space-y-4">
        {remindersConfig.map((item) => {
          const config = settings.reminders?.[item.key] || {};
          const isEnabled = config.enabled ?? true;

          return (
            <Card key={item.key} className="overflow-hidden rounded-md border-slate-100 bg-white shadow-sm">
              <CardContent className="p-0">
                <div className="grid lg:grid-cols-[300px_1fr]">
                  <div className="border-b border-slate-100 bg-slate-50/70 p-4 lg:border-b-0 lg:border-r">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <h2 className="text-base font-bold text-[#172b4d]">{item.label}</h2>
                          <Badge className={isEnabled ? 'border-transparent bg-teal-100 text-teal-700 hover:bg-teal-100' : 'border-transparent bg-slate-200 text-slate-500 hover:bg-slate-200'}>
                            {isEnabled ? '已开启' : '已关闭'}
                          </Badge>
                        </div>
                        <p className="text-sm leading-6 text-[#8898aa]">{item.desc}</p>
                      </div>
                      <label className="relative mt-1 inline-flex cursor-pointer items-center">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={isEnabled}
                          onChange={handleFieldChange(item.key, 'enabled')}
                        />
                        <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-teal-600" />
                        <span className="absolute left-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
                      </label>
                    </div>
                  </div>

                  <div className="p-4 md:p-5">
                    {isEnabled ? (
                      item.isRealtime ? (
                        <div className="grid gap-4 xl:grid-cols-[1fr_240px]">
                          <div className="rounded-md border border-slate-100 bg-white p-4">
                            <SectionTitle icon={Users}>接收对象</SectionTitle>
                            <input
                              className={`${fieldBaseClass} w-full`}
                              value={config.notify_users || ''}
                              onChange={handleFieldChange(item.key, 'notify_users')}
                              placeholder="XuYongSheng|Jinli 或 @all"
                            />
                            <p className="mt-2 text-xs leading-5 text-[#8898aa]">企业微信 UserID，多个用 | 分隔；留空使用系统默认接收人。</p>
                          </div>
                          <div className="rounded-md border border-sky-100 bg-sky-50/70 p-4">
                            <SectionTitle icon={Send}>触发规则</SectionTitle>
                            <p className="text-sm font-medium text-sky-700">事件发生时即时推送</p>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-4 xl:grid-cols-[minmax(280px,1.05fr)_minmax(360px,1.4fr)]">
                          <div className="rounded-md border border-slate-100 bg-white p-4">
                            <SectionTitle icon={Users}>接收对象</SectionTitle>
                            <input
                              className={`${fieldBaseClass} w-full`}
                              value={config.notify_users || ''}
                              onChange={handleFieldChange(item.key, 'notify_users')}
                              placeholder="XuYongSheng|Jinli 或 @all"
                            />
                            <p className="mt-2 text-xs leading-5 text-[#8898aa]">企业微信 UserID，多个用 | 分隔；留空使用系统默认接收人。</p>
                          </div>

                          <div className="rounded-md border border-slate-100 bg-white p-4">
                            <SectionTitle icon={CalendarDays}>触发规则</SectionTitle>
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                              {item.hasAdvance && (
                                <label>
                                  <FieldLabel>提前天数</FieldLabel>
                                  <input
                                    type="number"
                                    min="0"
                                    className={`${fieldBaseClass} w-full`}
                                    value={config.advance_days ?? ''}
                                    onChange={handleFieldChange(item.key, 'advance_days')}
                                  />
                                </label>
                              )}

                              {item.hasDay && (
                                <label>
                                  <FieldLabel>每月日期</FieldLabel>
                                  <input
                                    type="number"
                                    min="1"
                                    max="31"
                                    className={`${fieldBaseClass} w-full`}
                                    value={config.day_of_month ?? ''}
                                    onChange={handleFieldChange(item.key, 'day_of_month')}
                                  />
                                </label>
                              )}

                              {item.hasDayRange && (
                                <>
                                  <label>
                                    <FieldLabel>开始日期</FieldLabel>
                                    <input
                                      type="number"
                                      min="1"
                                      max="31"
                                      className={`${fieldBaseClass} w-full`}
                                      value={config.start_day ?? ''}
                                      onChange={handleFieldChange(item.key, 'start_day')}
                                    />
                                  </label>
                                  <label>
                                    <FieldLabel>结束日期</FieldLabel>
                                    <input
                                      type="number"
                                      min="1"
                                      max="31"
                                      className={`${fieldBaseClass} w-full`}
                                      value={config.end_day ?? ''}
                                      onChange={handleFieldChange(item.key, 'end_day')}
                                    />
                                  </label>
                                </>
                              )}

                              {item.hasContractCreatedAfter && (
                                <label className="sm:col-span-2 xl:col-span-1">
                                  <FieldLabel>合同创建起始日期</FieldLabel>
                                  <input
                                    type="date"
                                    className={`${fieldBaseClass} w-full`}
                                    value={config.contract_created_after || DEFAULT_CONTRACT_CREATED_AFTER}
                                    onChange={handleFieldChange(item.key, 'contract_created_after')}
                                  />
                                </label>
                              )}

                              {item.hasContractEndAfter && (
                                <label className="sm:col-span-2 xl:col-span-1">
                                  <FieldLabel>合同结束日期晚于</FieldLabel>
                                  <input
                                    type="date"
                                    className={`${fieldBaseClass} w-full`}
                                    value={config.contract_end_after || config.contract_created_after || DEFAULT_CONTRACT_END_AFTER}
                                    onChange={handleFieldChange(item.key, 'contract_end_after')}
                                  />
                                </label>
                              )}

                              {item.hasTrialEndAfter && (
                                <label className="sm:col-span-2 xl:col-span-1">
                                  <FieldLabel>试工合同结束日期晚于</FieldLabel>
                                  <input
                                    type="date"
                                    className={`${fieldBaseClass} w-full`}
                                    value={config.trial_end_after || config.contract_created_after || DEFAULT_TRIAL_END_AFTER}
                                    onChange={handleFieldChange(item.key, 'trial_end_after')}
                                  />
                                </label>
                              )}

                              <label>
                                <FieldLabel>推送时间</FieldLabel>
                                <input
                                  type="time"
                                  step="300"
                                  className={`${fieldBaseClass} w-full`}
                                  value={config.time || '09:00'}
                                  onChange={handleFieldChange(item.key, 'time')}
                                />
                              </label>
                            </div>
                            {(item.hasContractCreatedAfter || item.hasContractEndAfter || item.hasTrialEndAfter) && (
                              <p className="mt-3 text-xs leading-5 text-[#8898aa]">
                                {item.hasContractEndAfter && '仅提醒合同结束日期晚于所选日期的数据。'}
                                {item.hasTrialEndAfter && '仅提醒试工合同结束日期晚于所选日期的数据。'}
                                {item.hasContractCreatedAfter && '仅提醒合同创建日期在起始日期及之后的数据。'}
                              </p>
                            )}
                          </div>

                          <div className="rounded-md border border-slate-100 bg-slate-50/70 p-4 xl:col-span-2">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex items-center gap-3">
                                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-[#525f7f] shadow-sm">
                                  <Clock3 className="h-4 w-4" />
                                </span>
                                <div>
                                  <p className="text-xs text-[#8898aa]">最后一次发送</p>
                                  <p className="mt-0.5 text-sm font-medium text-[#525f7f]">{formatLastRunTime(config.last_run_date, config.last_run_at)}</p>
                                </div>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleResetLastRun(item.key)}
                                disabled={resettingKey === item.key || !config.last_run_date}
                                className="border-slate-300 text-[#525f7f]"
                              >
                                <RotateCcw className="mr-2 h-4 w-4" />
                                {resettingKey === item.key ? '重置中' : '重置'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    ) : (
                      <div className="flex min-h-20 items-center gap-3 rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 text-sm text-[#8898aa]">
                        <Bell className="h-4 w-4" />
                        当前提醒已关闭，开启后可继续配置接收人和触发规则。
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="sticky bottom-4 mt-5 flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="bg-teal-600 px-6 text-white shadow-lg hover:bg-teal-500">
          <Save className="mr-2 h-4 w-4" />
          {saving ? '保存中...' : '保存配置'}
        </Button>
      </div>
    </div>
  );
};

export default NotificationSettings;
