import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import axios from 'axios';
import { Save, Smartphone } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';

const fieldBaseClass = 'h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-[#525f7f] shadow-sm outline-none transition placeholder:text-slate-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15';

const initialConfig = {
  enabled: false,
  appid: '',
  env_version: 'release',
  expire_days: 30,
  contract_sign_path: 'pages/contract-sign/index',
  fallback_to_web: true,
};

const FieldLabel = ({ children }) => (
  <span className="mb-1.5 block text-xs font-medium text-[#8898aa]">{children}</span>
);

FieldLabel.propTypes = {
  children: PropTypes.node.isRequired,
};

export default function MiniappSigningSettings() {
  const [config, setConfig] = useState(initialConfig);
  const [diagnostics, setDiagnostics] = useState({
    appid_configured: false,
    secret_configured: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/settings/miniapp-signing');
      if (res.data.status === 'success' && res.data.data) {
        setConfig({ ...initialConfig, ...res.data.data });
        setDiagnostics({
          appid_configured: Boolean(res.data.diagnostics?.appid_configured),
          secret_configured: Boolean(res.data.diagnostics?.secret_configured),
        });
      }
      setError('');
    } catch (err) {
      console.error(err);
      setError('无法加载小程序签署配置。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const updateField = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setConfig((prev) => ({
      ...prev,
      [field]: field === 'expire_days' ? parseInt(value, 10) || 1 : value,
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');
      const res = await axios.put('/api/settings/miniapp-signing', config);
      if (res.data.status === 'success') {
        setConfig({ ...initialConfig, ...res.data.data });
        setDiagnostics({
          appid_configured: Boolean(res.data.diagnostics?.appid_configured),
          secret_configured: Boolean(res.data.diagnostics?.secret_configured),
        });
        setSuccess('小程序签署配置已保存。');
      } else {
        setError(res.data.message || '保存失败。');
      }
    } catch (err) {
      console.error(err);
      setError('保存配置时出现网络错误。');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-[#525f7f]">加载中...</div>;
  }

  return (
    <div className="min-h-screen bg-[#f6f9fc] p-6">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#172b4d]">小程序签署入口配置</h1>
          <p className="mt-1 text-sm text-[#8898aa]">配置运营复制合同链接时是否优先生成可在微信中拉起小程序的 URL Link。</p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="bg-teal-600 hover:bg-teal-700">
          <Save className="mr-2 h-4 w-4" />
          {saving ? '保存中...' : '保存配置'}
        </Button>
      </div>

      {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

      <Card className="border-0 shadow-sm">
        <CardContent className="p-5">
          <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-[#525f7f]">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-50 text-teal-700">
              <Smartphone className="h-4 w-4" />
            </span>
            URL Link 生成设置
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#525f7f]">
              <input type="checkbox" checked={Boolean(config.enabled)} onChange={updateField('enabled')} />
              优先生成小程序 URL Link
            </label>
            <label className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#525f7f]">
              <input type="checkbox" checked={Boolean(config.fallback_to_web)} onChange={updateField('fallback_to_web')} />
              生成失败时自动使用 Web 签署链接
            </label>

            <div>
              <FieldLabel>小程序 AppID</FieldLabel>
              <input className={`${fieldBaseClass} w-full`} value={config.appid || ''} onChange={updateField('appid')} placeholder="备案通过后的小程序 AppID" />
            </div>
            <div>
              <FieldLabel>小程序版本</FieldLabel>
              <select className={`${fieldBaseClass} w-full`} value={config.env_version || 'release'} onChange={updateField('env_version')}>
                <option value="release">正式版</option>
                <option value="trial">体验版</option>
                <option value="develop">开发版</option>
              </select>
            </div>
            <div>
              <FieldLabel>签署页路径</FieldLabel>
              <input className={`${fieldBaseClass} w-full`} value={config.contract_sign_path || ''} onChange={updateField('contract_sign_path')} />
            </div>
            <div>
              <FieldLabel>链接有效天数（1-30）</FieldLabel>
              <input className={`${fieldBaseClass} w-full`} type="number" min="1" max="30" value={config.expire_days || 30} onChange={updateField('expire_days')} />
            </div>
          </div>

          <div className="mt-5 grid gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-[#525f7f] md:grid-cols-2">
            <div>
              后端 AppID：
              <span className={diagnostics.appid_configured ? 'font-medium text-emerald-600' : 'font-medium text-red-600'}>
                {diagnostics.appid_configured ? '已读取' : '未读取'}
              </span>
            </div>
            <div>
              后端 AppSecret：
              <span className={diagnostics.secret_configured ? 'font-medium text-emerald-600' : 'font-medium text-red-600'}>
                {diagnostics.secret_configured ? '已读取' : '未读取'}
              </span>
            </div>
          </div>

          <div className="mt-5 rounded-md bg-slate-50 px-4 py-3 text-sm leading-6 text-[#64748b]">
            开启后，合同签约消息中的主链接会变为微信小程序 URL Link，在微信内点击可直接拉起小程序并进入合同签署页。Web 签署链接仍会作为备用链接保留。
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
