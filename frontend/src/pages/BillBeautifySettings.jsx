import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import axios from 'axios';
import { Save, Sparkles } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';

const fieldBaseClass =
  'h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-[#525f7f] shadow-sm outline-none transition placeholder:text-slate-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15';

const initialConfig = {
  enabled: true,
  api_base_url: 'https://ai.mengyimengsao.com/v1',
  api_key_name: 'dify-美化账单api-key',
  app_mode: 'advanced-chat',
  timeout_seconds: 180,
  input_variable: 'query',
};

const FieldLabel = ({ children }) => (
  <span className="mb-1.5 block text-xs font-medium text-[#8898aa]">{children}</span>
);

FieldLabel.propTypes = {
  children: PropTypes.node.isRequired,
};

export default function BillBeautifySettings() {
  const [config, setConfig] = useState(initialConfig);
  const [apiKeyOptions, setApiKeyOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/settings/bill-beautify');
      if (res.data.status === 'success') {
        setConfig({ ...initialConfig, ...(res.data.data || {}) });
        setApiKeyOptions(res.data.api_key_options || []);
      }
      setError('');
    } catch (err) {
      console.error(err);
      setError('无法加载账单美化配置。');
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
      [field]: field === 'timeout_seconds' ? parseInt(value, 10) || 180 : value,
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');
      const res = await axios.put('/api/settings/bill-beautify', config);
      if (res.data.status === 'success') {
        setConfig({ ...initialConfig, ...(res.data.data || {}) });
        setSuccess('账单美化配置已保存。');
      } else {
        setError(res.data.message || '保存失败。');
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || '保存配置时出现网络错误。');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-[#525f7f]">加载中...</div>;
  }

  const keyNames = apiKeyOptions.map((k) => k.key_name);
  const selectedKeyMissing =
    config.api_key_name && !keyNames.includes(config.api_key_name);

  return (
    <div className="min-h-screen bg-[#f6f9fc] p-6">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#172b4d]">账单美化 API 配置</h1>
          <p className="mt-1 text-sm text-[#8898aa]">
            管理账单详情「美化账单」功能所使用的 Dify 接口地址与 API Key（Key 本体在 LLM 管理中维护）。
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="bg-teal-600 hover:bg-teal-700">
          <Save className="mr-2 h-4 w-4" />
          {saving ? '保存中...' : '保存配置'}
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <Card className="border-0 shadow-sm">
        <CardContent className="p-5">
          <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-[#525f7f]">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-50 text-teal-700">
              <Sparkles className="h-4 w-4" />
            </span>
            Dify 调用设置
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#525f7f] md:col-span-2">
              <input
                type="checkbox"
                checked={Boolean(config.enabled)}
                onChange={updateField('enabled')}
              />
              启用 AI 美化账单
            </label>

            <div className="md:col-span-2">
              <FieldLabel>Dify API 地址（base URL）</FieldLabel>
              <input
                className={`${fieldBaseClass} w-full`}
                value={config.api_base_url || ''}
                onChange={updateField('api_base_url')}
                placeholder="例如 https://ai.mengyimengsao.com/v1"
              />
              <p className="mt-1 text-xs text-[#8898aa]">
                不要带具体路径（如 /chat-messages）。系统会按应用类型自动拼接。填写 http:// 时会自动升级为 https://，避免重定向导致请求失败。
              </p>
            </div>

            <div>
              <FieldLabel>API Key 名称（LLM 管理中的 key_name）</FieldLabel>
              <select
                className={`${fieldBaseClass} w-full`}
                value={config.api_key_name || ''}
                onChange={updateField('api_key_name')}
              >
                {selectedKeyMissing && (
                  <option value={config.api_key_name}>{config.api_key_name}（当前值，未在列表中）</option>
                )}
                {!config.api_key_name && <option value="">请选择</option>}
                {apiKeyOptions.map((k) => (
                  <option key={k.key_name} value={k.key_name}>
                    {k.key_name}
                    {k.status !== 'active' ? ` [${k.status}]` : ''}
                    {k.provider ? ` · ${k.provider}` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-[#8898aa]">
                Key 值在「LLM 管理 → API Keys」中配置与轮换，此处只选择名称。
              </p>
            </div>

            <div>
              <FieldLabel>应用类型（app_mode）</FieldLabel>
              <select
                className={`${fieldBaseClass} w-full`}
                value={config.app_mode || 'advanced-chat'}
                onChange={updateField('app_mode')}
              >
                <option value="advanced-chat">Chatflow / 高级聊天（/chat-messages）</option>
                <option value="workflow">工作流 Workflow（/workflows/run）</option>
                <option value="completion">文本生成 Completion（/completion-messages）</option>
              </select>
            </div>

            <div>
              <FieldLabel>超时时间（秒，30–600）</FieldLabel>
              <input
                type="number"
                min={30}
                max={600}
                className={`${fieldBaseClass} w-full`}
                value={config.timeout_seconds ?? 180}
                onChange={updateField('timeout_seconds')}
              />
            </div>

            <div>
              <FieldLabel>输入变量名（Workflow / Completion 用）</FieldLabel>
              <input
                className={`${fieldBaseClass} w-full`}
                value={config.input_variable || 'query'}
                onChange={updateField('input_variable')}
                placeholder="query"
              />
              <p className="mt-1 text-xs text-[#8898aa]">
                Chatflow 走 query 字段，此配置不影响。Workflow/Completion 会作为 inputs 的键名。
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-[#8898aa]">
            <div className="mb-1 font-medium text-[#525f7f]">说明</div>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                当前探测到的 Dify 应用「账单美化api」为 advanced-chat，请保持应用类型为 Chatflow。
              </li>
              <li>
                期望模型返回 JSON：
                <code className="mx-1 rounded bg-white px-1">{'{ company_beautified, employee_beautified }'}</code>
              </li>
              <li>调用日志会写入 LLM 调用日志，function_name 为 beautify_bill_with_dify。</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
