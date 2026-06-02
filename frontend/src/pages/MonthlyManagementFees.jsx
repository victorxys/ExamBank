import React, { useEffect, useMemo, useState } from 'react';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ClearIcon from '@mui/icons-material/Clear';
import DescriptionIcon from '@mui/icons-material/Description';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import SearchIcon from '@mui/icons-material/Search';
import { pinyin } from 'pinyin-pro';
import api from '../api/axios';
import FinancialManagementModal from '../components/FinancialManagementModal';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

const PAYMENT_METHODS = ['微信', '支付宝', '银行转账'];

const formatMoney = (value) => {
  const num = Number(value || 0);
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const shortName = (value, maxLength = 4) => {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
};

const todayString = () => new Date().toISOString().slice(0, 10);

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
};

const normalizeSearchText = (value) => String(value || '').trim().toLowerCase();

const buildSearchText = (item) => {
  const names = [item.customer_name, item.employee_name].filter(Boolean).join(' ');
  try {
    const fullPinyin = pinyin(names, { toneType: 'none', nonZh: 'consecutive' }).replace(/\s/g, '').toLowerCase();
    const initials = pinyin(names, { pattern: 'first', toneType: 'none', nonZh: 'consecutive' }).replace(/\s/g, '').toLowerCase();
    return `${names.toLowerCase()} ${fullPinyin} ${initials}`;
  } catch (err) {
    console.error('pinyin-pro failed:', err);
    return names.toLowerCase();
  }
};

const MonthlyManagementFees = () => {
  const searchParams = new URLSearchParams(window.location.search);
  const [year, setYear] = useState(searchParams.get('year') || '');
  const [month, setMonth] = useState(searchParams.get('month') || '');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [data, setData] = useState({ year: '', month: '', month_key: '', items: [] });
  const [forms, setForms] = useState({});
  const [billModalOpen, setBillModalOpen] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState(null);

  const filteredItems = useMemo(() => {
    const searchTerm = normalizeSearchText(keyword);
    if (!searchTerm) return data.items || [];
    return (data.items || []).filter((item) => buildSearchText(item).includes(searchTerm));
  }, [data.items, keyword]);

  const totals = useMemo(() => {
    return filteredItems.reduce((acc, item) => {
      acc.managementFee += Number(item.management_fee || 0);
      acc.totalDue += Number(item.total_due || 0);
      acc.receivable += Number(item.receivable_balance || 0);
      return acc;
    }, { managementFee: 0, totalDue: 0, receivable: 0 });
  }, [filteredItems]);

  const fetchItems = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError('');
      const params = {};
      if (year) params.year = year;
      if (month) params.month = month;
      const res = await api.get('/billing/monthly-management-fees/pending', { params });
      const nextData = res.data?.data || { items: [] };
      setData(nextData);
      setYear(String(nextData.year || ''));
      setMonth(String(nextData.month || ''));
      setForms((prev) => {
        const next = {};
        (nextData.items || []).forEach((item) => {
          const receivable = Number(item.receivable_balance || 0);
          next[item.bill_id] = prev[item.bill_id] || {
            amount: receivable > 0 ? item.receivable_balance : item.management_fee || '',
            method: '微信',
            notes: '',
            payment_date: todayString(),
          };
        });
        return next;
      });
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || '无法加载月度管理费待处理账单。');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateFormValue = (billId, field, value) => {
    setForms((prev) => ({
      ...prev,
      [billId]: {
        ...(prev[billId] || { method: '微信', notes: '', payment_date: todayString() }),
        [field]: value,
      },
    }));
  };

  const handleFormChange = (billId, field) => (event) => {
    updateFormValue(billId, field, event.target.value);
  };

  const handleSearch = () => {
    const url = new URL(window.location.href);
    if (year) url.searchParams.set('year', year);
    if (month) url.searchParams.set('month', month);
    window.history.replaceState({}, '', url.toString());
    fetchItems();
  };

  const markPaid = async (item) => {
    const form = forms[item.bill_id] || {};
    try {
      setSubmittingId(item.bill_id);
      setError('');
      setSuccess('');
      const res = await api.post(`/billing/monthly-management-fees/${item.bill_id}/mark-paid`, {
        amount: form.amount || item.management_fee,
        method: form.method || '微信',
        notes: form.notes || '',
        payment_date: form.payment_date || todayString(),
      });
      setSuccess(res.data?.message || `${item.customer_name} 的收款已记录。`);
      await fetchItems({ silent: true });
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || '标记管理费缴清失败。');
    } finally {
      setSubmittingId(null);
    }
  };

  const handleOpenBillModal = (billId) => {
    setSelectedBillId(billId);
    setBillModalOpen(true);
  };

  const handleCloseBillModal = () => {
    setBillModalOpen(false);
    setSelectedBillId(null);
    fetchItems({ silent: true });
  };

  const handleSaveBillDetails = async (payload) => {
    try {
      const res = await api.post('/billing/batch-update', payload);
      setSuccess(res.data?.message || '账单保存成功。');
      await fetchItems({ silent: true });
      return res;
    } catch (err) {
      const message = err.response?.data?.error || err.message || '保存账单失败';
      setError(`保存失败：${message}`);
      throw new Error(message);
    }
  };

  return (
    <div className="mx-auto max-w-[1480px] p-3 md:p-5">
      <Card className="mb-3 rounded-md border-teal-100 bg-white shadow-[0_0_2rem_0_rgba(136,168,170,.15)]">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-lg font-bold text-[#525f7f]">育儿嫂月度管理费</h1>
              <p className="mt-1 text-sm text-[#8898aa]">{data.month_key ? `${data.month_key} 待处理账单` : '待处理账单'}</p>
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <label className="relative block md:w-[280px]">
                <span className="absolute -top-2 left-3 bg-white px-1 text-xs text-[#8898aa]">搜索客户或员工</span>
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8898aa]" fontSize="small" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="姓名 / 拼音 / 首字母"
                  className="h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-9 text-sm text-[#525f7f] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
                />
                {keyword && (
                  <button
                    type="button"
                    onClick={() => setKeyword('')}
                    className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[#8898aa] hover:bg-slate-100"
                  >
                    <ClearIcon fontSize="small" />
                  </button>
                )}
              </label>
              <label className="relative block md:w-[100px]">
                <span className="absolute -top-2 left-3 bg-white px-1 text-xs text-[#8898aa]">年份</span>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-[#525f7f] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
                />
              </label>
              <label className="relative block md:w-[86px]">
                <span className="absolute -top-2 left-3 bg-white px-1 text-xs text-[#8898aa]">月份</span>
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-[#525f7f] outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
                />
              </label>
              <Button onClick={handleSearch} disabled={loading} className="h-10 bg-teal-600 px-5 text-white shadow-md hover:bg-teal-500">
                <RefreshIcon className="mr-2" fontSize="small" />
                刷新
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

      <Card className="mb-3 rounded-md border-0 bg-white shadow-[0_0_2rem_0_rgba(136,168,170,.15)]">
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
          <div>
            <p className="text-xs text-[#8898aa]">当前显示 / 全部待处理</p>
            <p className="mt-1 text-xl font-bold text-[#172b4d]">{filteredItems.length} / {data.items?.length || 0}</p>
          </div>
          <div>
            <p className="text-xs text-[#8898aa]">管理费合计</p>
            <p className="mt-1 text-xl font-bold text-[#172b4d]">{formatMoney(totals.managementFee)} 元</p>
          </div>
          <div>
            <p className="text-xs text-[#8898aa]">应付款总额合计</p>
            <p className="mt-1 text-xl font-bold text-[#172b4d]">{formatMoney(totals.totalDue)} 元</p>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-md border-0 bg-white shadow-[0_0_2rem_0_rgba(136,168,170,.15)]">
        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
          </div>
        ) : filteredItems.length ? (
          <div className="max-h-[calc(100vh-310px)] overflow-y-auto overflow-x-hidden">
            <Table className="table-fixed">
              <TableHeader className="sticky top-0 z-10 bg-teal-50">
                <TableRow className="hover:bg-teal-50">
                  <TableHead className="h-10 w-[12%] px-3 py-2 font-bold text-[#525f7f]">客户/员工</TableHead>
                  <TableHead className="h-10 w-[11%] px-3 py-2 font-bold text-[#525f7f]">账期</TableHead>
                  <TableHead className="h-10 w-[8%] px-3 py-2 text-right font-bold text-[#525f7f]">管理费</TableHead>
                  <TableHead className="h-10 w-[9%] px-3 py-2 text-right font-bold text-[#525f7f]">应付</TableHead>
                  <TableHead className="h-10 w-[10%] px-3 py-2 text-right font-bold text-[#525f7f]">已收/待收</TableHead>
                  <TableHead className="h-10 w-[50%] px-3 py-2 font-bold text-[#525f7f]">本次收款</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => {
                  const form = forms[item.bill_id] || { amount: item.management_fee || '', method: '微信', notes: '', payment_date: todayString() };
                  return (
                    <TableRow key={item.bill_id} className="hover:bg-slate-50">
                      <TableCell className="px-3 py-2 align-middle">
                        <div className="truncate text-sm font-bold text-[#525f7f]" title={item.customer_name}>
                          {shortName(item.customer_name)}
                        </div>
                        <div className="truncate text-xs text-[#8898aa]">{item.employee_name}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <a
                            href={`/contract/detail/${item.contract_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-xs font-medium text-teal-600 hover:underline"
                          >
                            <DescriptionIcon className="text-sm" fontSize="inherit" />
                            合同
                          </a>
                          <button
                            type="button"
                            onClick={() => handleOpenBillModal(item.bill_id)}
                            className="inline-flex items-center gap-0.5 text-xs font-medium text-teal-600 hover:underline"
                          >
                            <ReceiptLongIcon className="text-sm" fontSize="inherit" />
                            账单
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2 align-middle">
                        <div className="truncate text-sm font-bold text-[#525f7f]">{item.billing_month}</div>
                        <div className="truncate text-xs text-[#8898aa]">
                          {formatDate(item.cycle_start_date).slice(5)} ~ {formatDate(item.cycle_end_date).slice(5)}
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right align-middle tabular-nums text-[#525f7f]">{formatMoney(item.management_fee)}</TableCell>
                      <TableCell className="px-3 py-2 text-right align-middle font-bold tabular-nums text-[#525f7f]">{formatMoney(item.total_due)}</TableCell>
                      <TableCell className="px-3 py-2 text-right align-middle tabular-nums">
                        <button
                          type="button"
                          className="font-bold text-teal-600 hover:underline"
                          onClick={() => {
                            setForms((prev) => ({
                              ...prev,
                              [item.bill_id]: {
                                ...(prev[item.bill_id] || form),
                                amount: item.receivable_balance || item.management_fee || '',
                              },
                            }));
                          }}
                        >
                          {formatMoney(item.total_paid)}
                        </button>
                        <div className={Number(item.receivable_balance) > 0 ? 'text-xs text-red-500' : 'text-xs text-[#8898aa]'}>
                          {formatMoney(item.receivable_balance)}
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2 align-middle">
                        <div className="flex min-w-0 items-center gap-2">
                          <label className="relative w-24 shrink-0">
                            <span className="absolute -top-2 left-2 bg-white px-1 text-[11px] text-[#8898aa]">金额</span>
                            <input
                            type="number"
                              min="0"
                              step="0.01"
                              value={form.amount ?? ''}
                              onChange={handleFormChange(item.bill_id, 'amount')}
                              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-[#525f7f] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
                            />
                          </label>
                          <Select value={form.method} onValueChange={(value) => updateFormValue(item.bill_id, 'method', value)}>
                            <SelectTrigger className="h-9 w-24 shrink-0 border-slate-300 text-[#525f7f]">
                              <SelectValue placeholder="支付方式" />
                            </SelectTrigger>
                            <SelectContent>
                              {PAYMENT_METHODS.map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <label className="relative w-32 shrink-0">
                            <span className="absolute -top-2 left-2 bg-white px-1 text-[11px] text-[#8898aa]">支付日期</span>
                            <input
                              type="date"
                              value={form.payment_date}
                              onChange={handleFormChange(item.bill_id, 'payment_date')}
                              className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-[#525f7f] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
                            />
                          </label>
                          <input
                            value={form.notes}
                            onChange={handleFormChange(item.bill_id, 'notes')}
                            placeholder="备注"
                            className="h-9 min-w-20 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-[#525f7f] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
                          />
                          <Button
                            onClick={() => markPaid(item)}
                            disabled={submittingId === item.bill_id}
                            className="h-9 shrink-0 bg-teal-600 px-3 text-white shadow-md hover:bg-teal-500"
                          >
                            <CheckCircleIcon className="mr-1" fontSize="small" />
                            {submittingId === item.bill_id ? '处理中' : '收款'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <h2 className="text-base font-bold text-[#525f7f]">{data.items?.length ? '没有匹配的账单' : '当前没有待处理账单'}</h2>
            <p className="mt-1 text-sm text-[#8898aa]">
              {data.items?.length ? '可以换一个客户或员工姓名、拼音再试。' : '应付款总额为 0 或已标记管理费缴清的账单不会出现在这里。'}
            </p>
          </div>
        )}
        <div className="border-t px-4 py-3 text-xs text-[#8898aa]">
          标记缴清后，系统会在该账单新增一笔收款记录，并记录该账单月份的管理费已缴清状态。
        </div>
      </Card>

      {billModalOpen && (
        <FinancialManagementModal
          open={billModalOpen}
          onClose={handleCloseBillModal}
          billId={selectedBillId}
          onSave={handleSaveBillDetails}
          onNavigateToBill={setSelectedBillId}
        />
      )}
    </div>
  );
};

export default MonthlyManagementFees;
