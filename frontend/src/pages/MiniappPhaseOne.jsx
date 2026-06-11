/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Clock3,
  FileSignature,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import api from '../api/axios';
import logo from '../assets/logo.svg';

const DEMO_OPENID = 'dev-miniapp-wang';

const defaultBindForm = {
  name: '',
  phone_number: '',
  id_card_last4: '',
};

const defaultCustomerInfo = {
  name: '',
  phone_number: '',
  id_card_number: '',
  address: '',
};

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

const statusText = {
  active: '服务中',
  pending: '待上户',
  trial_active: '试工中',
  finished: '已完成',
  completed: '已完成',
  terminated: '已终止',
  trial_succeeded: '试工成功',
};

const signingStatusText = {
  UNSIGNED: '待签署',
  CUSTOMER_SIGNED: '客户已签',
  EMPLOYEE_SIGNED: '待客户签署',
  SIGNED: '已签署',
  NOT_REQUIRED: '无需签署',
};

const ensureCustomerInfo = (info, fallbackName) => ({
  ...defaultCustomerInfo,
  ...Object.fromEntries(
    Object.entries(info || {}).map(([key, value]) => [key, value == null ? '' : String(value)])
  ),
  name: info?.name || fallbackName || '',
});

const getArray = (value) => (Array.isArray(value) ? value : []);

const attendanceStats = (formData = {}) => {
  const rest = getArray(formData.rest_records);
  const leave = getArray(formData.leave_records);
  const overtime = getArray(formData.overtime_records);
  const paidLeave = getArray(formData.paid_leave_records);
  const cycleDays = Number(formData.work_days || formData.attendance_days || formData.service_days || 0);
  const dayCount = cycleDays || Math.max(0, 30 - rest.length - leave.length);
  return {
    workDays: dayCount,
    restCount: rest.length,
    leaveCount: leave.length,
    overtimeCount: overtime.length,
    paidLeaveCount: paidLeave.length,
    records: [
      ...rest.map((record) => ({ ...record, label: '休息' })),
      ...leave.map((record) => ({ ...record, label: '请假' })),
      ...paidLeave.map((record) => ({ ...record, label: '带薪假' })),
      ...overtime.map((record) => ({ ...record, label: '加班' })),
    ].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))),
  };
};

function MiniShell({ title, children, onBack }) {
  return (
    <div className="min-h-screen bg-[#edf5f2] text-[#17202a]">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-[#edf5f2] shadow-2xl">
        <div className="sticky top-0 z-20 border-b border-white/70 bg-white/90 backdrop-blur">
          <div className="flex h-11 items-center justify-between px-4 text-xs font-bold">
            <span>9:41</span>
            <span className="h-5 w-20 rounded-full bg-[#111827]" />
            <span>5G</span>
          </div>
          <div className="grid h-12 grid-cols-[40px_1fr_40px] items-center px-2">
            <button
              type="button"
              onClick={onBack}
              className="grid h-9 w-9 place-items-center rounded-md text-[#17202a] hover:bg-slate-100"
              aria-label="返回"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="truncate text-center text-base font-bold">{title}</div>
            <span />
          </div>
        </div>
        <main className="flex-1 overflow-auto px-4 py-4">{children}</main>
      </div>
    </div>
  );
}

function Hero({ title, desc, children }) {
  return (
    <section className="rounded-lg bg-gradient-to-br from-[#21a99a] to-[#4bba8f] p-4 text-white shadow-lg shadow-teal-900/10">
      <div className="min-w-0">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-md bg-white">
            <img src={logo} alt="logo" className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold leading-tight">{title}</h1>
            <p className="mt-1 text-xs leading-5 text-white/85">{desc}</p>
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}

function ActionCard({ icon: Icon, title, desc, badge, onClick, tone = 'amber' }) {
  const badgeClass = tone === 'teal'
    ? 'bg-teal-50 text-teal-700'
    : 'bg-amber-50 text-amber-700';
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-teal-50 text-teal-600">
            <Icon size={21} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold leading-5 text-slate-900">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">{desc}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${badgeClass}`}>{badge}</span>
      </div>
    </button>
  );
}

function ContractCard({ contract, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-slate-900">{contract.type_label || '服务合同'}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {contract.employee_name || '服务人员'} · {formatDate(contract.start_date)} - {formatDate(contract.end_date)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
          {statusText[contract.status] || contract.status || '合同'}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-dashed border-slate-200 pt-3 text-xs text-slate-500">
        <span>{signingStatusText[contract.signing_status] || contract.signing_status || '签署状态'}</span>
        <ChevronRight size={16} />
      </div>
    </button>
  );
}

function Empty({ title, desc }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white/70 p-6 text-center">
      <ShieldCheck className="mx-auto mb-3 text-teal-500" size={34} />
      <h3 className="font-bold text-slate-900">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">{desc}</p>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', maxLength }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        maxLength={maxLength}
        className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-teal-500"
      />
    </label>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed border-slate-200 py-2 text-sm last:border-0">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 text-right font-semibold text-slate-900">{value || '-'}</span>
    </div>
  );
}

function TextBlock({ children }) {
  return (
    <div className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-4 text-sm leading-7 text-slate-600 shadow-sm">
      {children || '暂无正文内容。'}
    </div>
  );
}

function SignaturePad({ canvasRef, label }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-900">{label}</span>
        <button
          type="button"
          onClick={() => canvasRef.current?.clear()}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2 text-xs font-bold text-slate-600"
        >
          <RotateCcw size={14} />
          重签
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50">
        <SignatureCanvas
          ref={canvasRef}
          penColor="#111827"
          minWidth={1.2}
          maxWidth={2.6}
          canvasProps={{
            width: 360,
            height: 128,
            className: 'block h-32 w-full touch-none bg-slate-50',
          }}
        />
      </div>
    </div>
  );
}

export default function MiniappPhaseOne() {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const contractSignatureRef = useRef(null);
  const attendanceSignatureRef = useRef(null);
  const [openid, setOpenid] = useState(() => localStorage.getItem('miniapp_openid') || DEMO_OPENID);
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState(null);
  const [contractDetail, setContractDetail] = useState(null);
  const [signingContract, setSigningContract] = useState(null);
  const [attendanceDetail, setAttendanceDetail] = useState(null);
  const [customerInfo, setCustomerInfo] = useState(defaultCustomerInfo);
  const [bindForm, setBindForm] = useState(defaultBindForm);
  const [message, setMessage] = useState('');

  const view = params.contractId ? 'contract' : (params.view || '');
  const token = searchParams.get('token');

  const miniHeaders = useMemo(() => ({ 'X-Miniapp-Openid': openid }), [openid]);

  const showMessage = useCallback((text) => {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 1800);
  }, []);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/miniapp/customer/overview', { headers: miniHeaders });
      setOverview(response.data);
    } catch (error) {
      setOverview(null);
      showMessage(error.response?.data?.error || '暂无绑定客户档案');
    } finally {
      setLoading(false);
    }
  }, [miniHeaders, showMessage]);

  const login = async () => {
    setLoading(true);
    try {
      const response = await api.post('/miniapp/auth/login', { mock_openid: openid });
      localStorage.setItem('miniapp_openid', response.data.openid || openid);
      setOpenid(response.data.openid || openid);
      showMessage(response.data.bound ? '登录成功' : '请先绑定客户档案');
      navigate(response.data.bound ? '/miniapp/home' : '/miniapp/bind');
    } catch (error) {
      showMessage(error.response?.data?.error || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const bindCustomer = async () => {
    setLoading(true);
    try {
      const response = await api.post(
        '/miniapp/auth/bind-phone',
        { ...bindForm, openid },
        { headers: miniHeaders }
      );
      showMessage(`${response.data.customer?.name || '客户'}绑定成功`);
      navigate('/miniapp/home');
    } catch (error) {
      showMessage(error.response?.data?.error || '绑定失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (view === 'home' || view === 'contracts') {
      fetchOverview();
    }
  }, [view, fetchOverview]);

  useEffect(() => {
    const loadContract = async () => {
      if (view !== 'contract' || !params.contractId) return;
      setLoading(true);
      try {
        const response = await api.get(`/miniapp/customer/contracts/${params.contractId}`, { headers: miniHeaders });
        setContractDetail(response.data.contract);
      } catch (error) {
        showMessage(error.response?.data?.error || '合同加载失败');
      } finally {
        setLoading(false);
      }
    };
    loadContract();
  }, [view, params.contractId, miniHeaders, showMessage]);

  useEffect(() => {
    const loadSigningContract = async () => {
      if (view !== 'contract-sign' || !token) return;
      setLoading(true);
      try {
        const response = await api.get(`/miniapp/contracts/sign/${token}`, { headers: miniHeaders });
        const contract = response.data.contract;
        setSigningContract(contract);
        setCustomerInfo(ensureCustomerInfo(contract.customer_info, contract.customer_name));
      } catch (error) {
        showMessage(error.response?.data?.error || '合同加载失败');
      } finally {
        setLoading(false);
      }
    };
    loadSigningContract();
  }, [view, token, miniHeaders, showMessage]);

  useEffect(() => {
    const loadAttendance = async () => {
      if (view !== 'attendance-sign' || !token) return;
      setLoading(true);
      try {
        const response = await api.get(`/miniapp/attendance/sign/${token}`, { headers: miniHeaders });
        setAttendanceDetail(response.data.attendance_form);
      } catch (error) {
        showMessage(error.response?.data?.error || '考勤加载失败');
      } finally {
        setLoading(false);
      }
    };
    loadAttendance();
  }, [view, token, miniHeaders, showMessage]);

  const signContract = async () => {
    if (!token) return;
    const requiredFields = ['name', 'phone_number', 'id_card_number', 'address'];
    const missingField = requiredFields.find((field) => !customerInfo[field]);
    if (missingField) {
      showMessage('请先补全甲方信息');
      return;
    }
    if (!contractSignatureRef.current || contractSignatureRef.current.isEmpty()) {
      showMessage('请先在签名区签名');
      return;
    }
    setLoading(true);
    try {
      await api.post(
        `/miniapp/contracts/sign/${token}`,
        {
          openid,
          signature: contractSignatureRef.current.toDataURL('image/png'),
          customer_info: customerInfo,
        },
        { headers: miniHeaders }
      );
      showMessage('合同签署完成');
      navigate('/miniapp/home');
    } catch (error) {
      showMessage(error.response?.data?.error || '合同签署失败');
    } finally {
      setLoading(false);
    }
  };

  const signAttendance = async () => {
    if (!token) return;
    if (!attendanceSignatureRef.current || attendanceSignatureRef.current.isEmpty()) {
      showMessage('请先在签名区签名');
      return;
    }
    setLoading(true);
    try {
      await api.post(
        `/miniapp/attendance/sign/${token}`,
        {
          openid,
          signature_data: {
            image: attendanceSignatureRef.current.toDataURL('image/png'),
            signed_at: new Date().toISOString(),
            signer_name: overview?.customer?.name || customerInfo.name || '客户',
            signed_from: 'miniapp',
          },
        },
        { headers: miniHeaders }
      );
      showMessage('考勤确认完成');
      navigate('/miniapp/home');
    } catch (error) {
      showMessage(error.response?.data?.error || '考勤签署失败');
    } finally {
      setLoading(false);
    }
  };

  const title = view === 'contract-sign' ? '合同签署'
    : view === 'attendance-sign' ? '考勤确认'
      : view === 'contracts' ? '我的合同'
        : view === 'contract' ? '合同详情'
          : view === 'bind' ? '绑定客户'
            : '萌家服务助手';

  const attendanceSummary = attendanceStats(attendanceDetail?.form_data);

  return (
    <MiniShell title={title} onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/miniapp/home'))}>
      {loading && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-white/50">
          <Loader2 className="animate-spin text-teal-600" size={34} />
        </div>
      )}
      {message && (
        <div className="fixed bottom-8 left-1/2 z-50 w-[min(320px,calc(100%-40px))] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white shadow-xl">
          {message}
        </div>
      )}

      {(!view || view === 'login') && (
        <div className="flex min-h-[70vh] flex-col justify-center gap-4">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-2xl bg-white shadow-lg">
            <img src={logo} alt="萌家服务助手" className="h-14 w-14" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-extrabold text-slate-900">萌家服务助手</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">第一阶段支持合同签署、考勤确认、正在履行合同和历史合同查看。</p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <Field label="开发联调 openid" value={openid} onChange={setOpenid} />
          </div>
          <button type="button" onClick={login} className="h-12 rounded-md bg-teal-600 text-sm font-bold text-white shadow-lg shadow-teal-900/10">
            微信一键登录
          </button>
        </div>
      )}

      {view === 'bind' && (
        <div className="space-y-4">
          <Hero title="绑定客户档案" desc="用于登录后查看自己的合同、待签事项和考勤确认。">
            <div className="rounded-md bg-white/15 px-3 py-2 text-xs leading-5 text-white/90">
              也可以从运营分享的合同签署链接进入，签署完成后自动绑定。
            </div>
          </Hero>
          <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
            <Field
              label="客户姓名"
              value={bindForm.name}
              onChange={(value) => setBindForm((prev) => ({ ...prev, name: value }))}
              placeholder="例如：王女士"
            />
            <Field
              label="登记手机号"
              value={bindForm.phone_number}
              onChange={(value) => setBindForm((prev) => ({ ...prev, phone_number: value }))}
              placeholder="请输入后台登记手机号"
              type="tel"
            />
            <Field
              label="身份证后四位"
              value={bindForm.id_card_last4}
              onChange={(value) => setBindForm((prev) => ({ ...prev, id_card_last4: value }))}
              placeholder="选填，用于提高匹配准确度"
              maxLength={4}
            />
            <button type="button" onClick={bindCustomer} className="h-12 w-full rounded-md bg-teal-600 text-sm font-bold text-white">
              确认绑定
            </button>
          </div>
        </div>
      )}

      {view === 'home' && (
        <div className="space-y-5">
          <Hero title={`${overview?.customer?.name || '客户'}，您好`} desc="查看服务待办，完成签署与考勤确认。">
            <div className="grid grid-cols-4 gap-2">
              <button type="button" onClick={() => navigate('/miniapp/contracts')} className="rounded-md bg-white px-2 py-3 text-xs font-bold text-teal-700">合同</button>
              <button type="button" onClick={() => navigate('/miniapp/contracts')} className="rounded-md bg-white px-2 py-3 text-xs font-bold text-teal-700">履行中</button>
              <button type="button" onClick={() => navigate('/miniapp/contracts')} className="rounded-md bg-white px-2 py-3 text-xs font-bold text-teal-700">历史</button>
              <button type="button" onClick={fetchOverview} className="rounded-md bg-white px-2 py-3 text-xs font-bold text-teal-700">
                <RefreshCw size={15} className="mx-auto" />
              </button>
            </div>
          </Hero>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-extrabold text-slate-900">待处理</h2>
              <span className="text-xs font-bold text-teal-600">
                {(overview?.todos?.contracts?.length || 0) + (overview?.todos?.attendance_forms?.length || 0)} 项
              </span>
            </div>
            <div className="space-y-3">
              {(overview?.todos?.contracts || []).map((contract) => (
                <ActionCard
                  key={contract.id}
                  icon={FileSignature}
                  title={`${contract.type_label}待签署`}
                  desc={`${contract.employee_name || '服务人员'} · ${formatDate(contract.start_date)} 开始`}
                  badge="待签"
                  onClick={() => navigate(`/miniapp/contract-sign?token=${contract.customer_signing_token || ''}`)}
                />
              ))}
              {(overview?.todos?.attendance_forms || []).map((form) => (
                <ActionCard
                  key={form.id}
                  icon={CalendarDays}
                  title={`${form.month || '-'} 月考勤待确认`}
                  desc={`${form.employee_name || '服务人员'} · ${formatDate(form.cycle_start_date)} - ${formatDate(form.cycle_end_date)}`}
                  badge="待确认"
                  tone="teal"
                  onClick={() => navigate(`/miniapp/attendance-sign?token=${form.customer_signature_token || ''}`)}
                />
              ))}
              {overview && !overview.todos?.contracts?.length && !overview.todos?.attendance_forms?.length && (
                <Empty title="暂无待办" desc="合同签署和考勤确认事项都会出现在这里。" />
              )}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-extrabold text-slate-900">正在履行</h2>
              <button type="button" onClick={() => navigate('/miniapp/contracts')} className="text-xs font-bold text-teal-600">全部合同</button>
            </div>
            <div className="space-y-3">
              {(overview?.active_contracts || []).map((contract) => (
                <ContractCard key={contract.id} contract={contract} onClick={() => navigate(`/miniapp/contract/${contract.id}`)} />
              ))}
              {overview && !overview.active_contracts?.length && <Empty title="暂无正在履行合同" desc="服务中的合同会显示在这里。" />}
            </div>
          </section>
        </div>
      )}

      {view === 'contracts' && (
        <div className="space-y-5">
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Clock3 size={18} className="text-teal-600" />
              <h2 className="text-base font-extrabold text-slate-900">正在履行合同</h2>
            </div>
            <div className="space-y-3">
              {(overview?.active_contracts || []).map((contract) => (
                <ContractCard key={contract.id} contract={contract} onClick={() => navigate(`/miniapp/contract/${contract.id}`)} />
              ))}
              {overview && !overview.active_contracts?.length && <Empty title="暂无正在履行合同" desc="当前没有服务中的合同。" />}
            </div>
          </section>
          <section>
            <div className="mb-3 flex items-center gap-2">
              <History size={18} className="text-teal-600" />
              <h2 className="text-base font-extrabold text-slate-900">历史合同</h2>
            </div>
            <div className="space-y-3">
              {(overview?.history_contracts || []).map((contract) => (
                <ContractCard key={contract.id} contract={contract} onClick={() => navigate(`/miniapp/contract/${contract.id}`)} />
              ))}
              {overview && !overview.history_contracts?.length && <Empty title="暂无历史合同" desc="已完成、已终止合同会显示在这里。" />}
            </div>
          </section>
        </div>
      )}

      {view === 'contract' && contractDetail && (
        <div className="space-y-4">
          <Hero title={contractDetail.type_label || '合同详情'} desc={`${contractDetail.employee_name || '服务人员'} · ${statusText[contractDetail.status] || contractDetail.status}`}>
            <div className="text-xs text-white/90">{formatDate(contractDetail.start_date)} - {formatDate(contractDetail.end_date)}</div>
          </Hero>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-base font-extrabold text-slate-900">合同信息</h2>
            <DetailRow label="客户" value={contractDetail.customer_name} />
            <DetailRow label="服务人员" value={contractDetail.employee_name} />
            <DetailRow label="劳务报酬" value={contractDetail.employee_level ? `${contractDetail.employee_level} 元/月` : '-'} />
            <DetailRow label="管理费" value={contractDetail.management_fee_amount ? `${contractDetail.management_fee_amount} 元/月` : '-'} />
            <DetailRow label="签署状态" value={signingStatusText[contractDetail.signing_status] || contractDetail.signing_status} />
          </div>
          <TextBlock>{contractDetail.template_content}</TextBlock>
        </div>
      )}

      {view === 'contract-sign' && (
        <div className="space-y-4">
          <Hero
            title={signingContract?.type_label || '合同签署'}
            desc="请核对甲方信息与服务条款，确认后完成电子签署。"
          >
            <div className="text-xs text-white/90">
              {formatDate(signingContract?.start_date)} - {formatDate(signingContract?.end_date)}
            </div>
          </Hero>
          <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
            <h2 className="text-base font-extrabold text-slate-900">甲方信息</h2>
            <Field label="姓名" value={customerInfo.name} onChange={(value) => setCustomerInfo((prev) => ({ ...prev, name: value }))} />
            <Field label="联系电话" value={customerInfo.phone_number} onChange={(value) => setCustomerInfo((prev) => ({ ...prev, phone_number: value }))} type="tel" />
            <Field label="身份证号" value={customerInfo.id_card_number} onChange={(value) => setCustomerInfo((prev) => ({ ...prev, id_card_number: value }))} />
            <Field label="联系地址" value={customerInfo.address} onChange={(value) => setCustomerInfo((prev) => ({ ...prev, address: value }))} />
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-base font-extrabold text-slate-900">合同正文</h2>
            <div className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">
              {signingContract?.template_content || signingContract?.service_content || '暂无正文内容。'}
            </div>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <SignaturePad canvasRef={contractSignatureRef} label={`${customerInfo.name || '客户'}电子签名`} />
            <button type="button" onClick={signContract} className="mt-4 h-12 w-full rounded-md bg-teal-600 text-sm font-bold text-white">
              确认签署
            </button>
          </div>
        </div>
      )}

      {view === 'attendance-sign' && (
        <div className="space-y-4">
          <Hero title="考勤确认" desc="请核对服务人员提交的月度考勤，确认无误后签字。">
            <div className="text-xs text-white/90">
              {formatDate(attendanceDetail?.cycle_start_date)} - {formatDate(attendanceDetail?.cycle_end_date)}
            </div>
          </Hero>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-base font-extrabold text-slate-900">
              {attendanceDetail?.contract_info?.employee_name || '服务人员'} · {attendanceDetail?.month || '-'} 月考勤
            </h2>
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-md bg-slate-50 p-3 text-center"><strong className="block text-lg">{attendanceSummary.workDays}</strong><span className="text-xs text-slate-500">出勤</span></div>
              <div className="rounded-md bg-slate-50 p-3 text-center"><strong className="block text-lg">{attendanceSummary.restCount}</strong><span className="text-xs text-slate-500">休息</span></div>
              <div className="rounded-md bg-slate-50 p-3 text-center"><strong className="block text-lg">{attendanceSummary.leaveCount + attendanceSummary.paidLeaveCount}</strong><span className="text-xs text-slate-500">请假</span></div>
              <div className="rounded-md bg-slate-50 p-3 text-center"><strong className="block text-lg">{attendanceSummary.overtimeCount}</strong><span className="text-xs text-slate-500">加班</span></div>
            </div>
            <div className="mt-4 space-y-2">
              {attendanceSummary.records.slice(0, 6).map((record, index) => (
                <div key={`${record.label}-${record.date}-${index}`} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span>{record.date || '-'}</span>
                  <span className="font-bold text-slate-900">{record.label}</span>
                </div>
              ))}
              {!attendanceSummary.records.length && (
                <div className="rounded-md bg-slate-50 px-3 py-3 text-center text-xs text-slate-500">暂无特殊考勤明细</div>
              )}
            </div>
            <div className="mt-4">
              <SignaturePad canvasRef={attendanceSignatureRef} label="客户考勤确认签名" />
            </div>
            <button type="button" onClick={signAttendance} className="mt-4 h-12 w-full rounded-md bg-teal-600 text-sm font-bold text-white">
              确认并签署
            </button>
          </div>
        </div>
      )}
    </MiniShell>
  );
}
