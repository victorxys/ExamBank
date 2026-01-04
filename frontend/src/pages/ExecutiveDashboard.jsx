import React, { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
  ArcElement,
  Filler
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import axios from 'axios';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
  ArcElement,
  Filler
);

const ExecutiveDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('year'); // 'year' or 'last_12_months'
  const [year, setYear] = useState(new Date().getFullYear());

  const [summaryData, setSummaryData] = useState(null);
  const [chartData, setChartData] = useState(null);

  useEffect(() => {
    fetchDashboardData();
  }, [period, year]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      // Fetch Summary KPI
      const summaryRes = await axios.get('/api/dashboard/revenue/summary', {
        params: { period, year }
      });

      // Fetch Charts Data
      const chartsRes = await axios.get('/api/dashboard/revenue/charts', {
        params: { period, year }
      });

      setSummaryData(summaryRes.data);
      setChartData(chartsRes.data);
      setError(null);
    } catch (err) {
      console.error("Error fetching dashboard data:", err);
      // Fallback for demo purposes if backend 404s (during dev transition)
      // setError("无法加载数据，请稍后重试"); 
      // Instead of error, let's allow it to render empty or mock if extremely needed, but for now stick to error
      setError("无法加载数据: " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  if (loading && !summaryData) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  // --- Chart Configurations ---

  // 1. Revenue Trend (Bar)
  const revenueChartData = {
    labels: chartData?.trend?.labels || [],
    datasets: [
      {
        label: `${year} 营收`,
        data: chartData?.trend?.current || [],
        backgroundColor: '#3b82f6',
        borderRadius: 4,
        barPercentage: 0.6,
      },
      {
        label: `${year - 1} 营收`,
        data: chartData?.trend?.previous || [],
        backgroundColor: '#334155',
        borderRadius: 4,
        barPercentage: 0.6,
      },
    ],
  };

  const revenueChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: {
        grid: { color: '#334155' },
        ticks: { color: '#94a3b8' }
      },
      x: {
        grid: { display: false },
        ticks: { color: '#94a3b8' }
      }
    }
  };

  // 2. Service Mix (Doughnut)
  const mixData = chartData?.mix || {};
  // Order: Nanny Mgmt, Nanny Intro, Maternity Intro, Maternity Mgmt, Other
  const serviceMixChartData = {
    labels: ['育儿嫂-管理费', '育儿嫂-介绍费', '月嫂-介绍费', '月嫂-管理费', '其他'],
    datasets: [{
      data: [
        mixData.nanny_mgmt || 0,
        mixData.nanny_intro || 0,
        mixData.maternity_intro || 0,
        mixData.maternity_mgmt || 0,
        mixData.other || 0
      ],
      backgroundColor: [
        '#2563eb', // Nanny Mgmt
        '#60a5fa', // Nanny Intro
        '#34d399', // Maternity Intro
        '#10b981', // Maternity Mgmt
        '#64748b'  // Other
      ],
      borderColor: '#1e293b',
      borderWidth: 2,
    }]
  };

  const serviceMixOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: { legend: { display: false } }
  };

  // 3. Category Trend (Line)
  const categoryTrends = chartData?.category_trends || {};
  const categoryTrendData = {
    labels: chartData?.trend?.labels || [], // Use same labels as revenue trend
    datasets: [
      {
        label: '育儿嫂 (Nanny)',
        data: categoryTrends.nanny || [],
        borderColor: '#3b82f6',
        backgroundColor: '#3b82f6',
        pointRadius: 2,
        tension: 0.4,
      },
      {
        label: '月嫂 (Maternity)',
        data: categoryTrends.maternity || [],
        borderColor: '#10b981',
        backgroundColor: '#10b981',
        pointRadius: 2,
        tension: 0.4,
      },
      {
        label: '其他 (Other)',
        data: categoryTrends.other || [],
        borderColor: '#64748b',
        backgroundColor: '#64748b',
        borderDash: [5, 5],
        pointRadius: 2,
        tension: 0.4,
      }
    ]
  };

  const categoryTrendOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: { display: false },
      x: {
        grid: { color: '#334155' },
        ticks: { color: '#94a3b8' }
      }
    }
  };

  // Calculations for Stacked Bar percentages
  const calculatePercent = (val, total) => total > 0 ? ((val / total) * 100).toFixed(0) + '%' : '0%';
  const nannyTotal = (mixData.nanny_mgmt || 0) + (mixData.nanny_intro || 0);
  const maternityTotal = (mixData.maternity_mgmt || 0) + (mixData.maternity_intro || 0);
  // mixData.other is total other

  return (
    <div className="min-h-screen bg-slate-900 text-slate-50 p-6 font-sans">

      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
            营收概览
          </h1>
          <p className="text-slate-400 mt-1">{year}年财年 · 实时数据</p>
        </div>
        <div className="flex gap-3 bg-slate-800 p-1 rounded-lg">
          <button
            onClick={() => setPeriod('year')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition ${period === 'year' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
          >
            本年
          </button>
          <button
            onClick={() => setPeriod('last_12_months')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition ${period === 'last_12_months' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
          >
            最近12个月
          </button>
        </div>
      </header>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">

        {/* Total Revenue */}
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-32 h-32 bg-emerald-500/10 rounded-full -mr-16 -mt-16 group-hover:bg-emerald-500/20 transition duration-500"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 text-sm font-medium uppercase tracking-wider">总营收 (Revenue)</p>
              <h3 className="text-3xl font-bold text-white mt-2">
                ¥ {summaryData?.total_revenue?.value?.toLocaleString()}
              </h3>
            </div>
            {summaryData?.total_revenue?.yoy_growth > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400">
                +{summaryData.total_revenue.yoy_growth}% ↑
              </span>
            )}

          </div>
          <p className="text-slate-500 text-xs mt-4">
            较去年同期 {summaryData?.total_revenue?.yoy_diff >= 0 ? '增长' : '减少'} ¥{Math.abs(summaryData?.total_revenue?.yoy_diff || 0).toLocaleString()}
          </p>
        </div>

        {/* Net Income */}
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-32 h-32 bg-blue-500/10 rounded-full -mr-16 -mt-16 group-hover:bg-blue-500/20 transition duration-500"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 text-sm font-medium uppercase tracking-wider">净收入 (Net Income)</p>
              <h3 className="text-3xl font-bold text-white mt-2">
                ¥ {summaryData?.net_income?.value?.toLocaleString()}
              </h3>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400">
              {(summaryData?.net_income?.yoy_growth || 0) > 0 ? '+' : ''}{summaryData?.net_income?.yoy_growth}%
            </span>
          </div>
          <p className="text-slate-500 text-xs mt-4">扣除返佣与渠道费</p>
        </div>

        {/* Active Customers */}
        <div className="bg-slate-800 rounded-2xl p-6 border border-orange-500/20 relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-32 h-32 bg-orange-500/10 rounded-full -mr-16 -mt-16 group-hover:bg-orange-500/20 transition duration-500"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 text-sm font-medium uppercase tracking-wider">活跃客户 (Active)</p>
              <h3 className="text-3xl font-bold text-orange-200 mt-2">
                {summaryData?.active_customers?.value} 人
              </h3>
            </div>
            <span className="text-orange-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            </span>
          </div>
          <p className="text-slate-500 text-xs mt-4">当前有生效合同的客户</p>
        </div>

        {/* Current Employees */}
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 relative overflow-hidden group">
          <div className="absolute right-0 top-0 w-32 h-32 bg-purple-500/10 rounded-full -mr-16 -mt-16 group-hover:bg-purple-500/20 transition duration-500"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-400 text-sm font-medium uppercase tracking-wider">当前员工 (Staff)</p>
              <h3 className="text-3xl font-bold text-white mt-2">
                {summaryData?.employees?.value} 人
              </h3>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </span>
          </div>
          <p className="text-slate-500 text-xs mt-4">在上户阿姨 + 内部员工</p>
        </div>

      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">

        {/* Revenue Trend Chart */}
        <div className="bg-slate-800 rounded-2xl p-6 lg:col-span-2 border border-slate-700">
          <div className="flex justify-between items-center mb-6">
            <h4 className="text-lg font-semibold text-white">年度营收趋势 (YoY)</h4>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center text-slate-400"><span className="w-3 h-3 rounded-full bg-blue-500 mr-2"></span>{year}</span>
              <span className="flex items-center text-slate-400"><span className="w-3 h-3 rounded-full bg-slate-700 mr-2"></span>{year - 1}</span>
            </div>
          </div>
          <div className="h-80 w-full cursor-pointer">
            <Bar data={revenueChartData} options={revenueChartOptions} />
          </div>
        </div>

        {/* Service Mix Doughnut */}
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 flex flex-col">
          <h4 className="text-lg font-semibold text-white mb-2">业务收入占比</h4>
          <p className="text-xs text-slate-400 mb-6">按业务及费用类型细分</p>

          <div className="flex-1 flex justify-center items-center relative min-h-[250px]">
            <div className="absolute inset-0">
              <Doughnut data={serviceMixChartData} options={serviceMixOptions} />
            </div>
          </div>

          {/* Detailed Legend */}
          <div className="mt-4 grid grid-cols-2 gap-x-2 gap-y-4 text-xs">
            {/* Nanny */}
            <div className="col-span-1 space-y-1">
              <p className="text-blue-200 font-semibold mb-1">育儿嫂 (Nanny)</p>
              <div className="flex justify-between items-center">
                <span className="flex items-center text-slate-400"><span className="w-2 h-2 rounded-full bg-blue-600 mr-1.5"></span>管理费</span>
                <span className="text-white">{calculatePercent(mixData.nanny_mgmt, mixData.total)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center text-slate-400"><span className="w-2 h-2 rounded-full bg-blue-400 mr-1.5"></span>介绍费</span>
                <span className="text-white">{calculatePercent(mixData.nanny_intro, mixData.total)}</span>
              </div>
            </div>
            {/* Maternity + Other */}
            <div className="col-span-1 space-y-1">
              <p className="text-emerald-200 font-semibold mb-1">月嫂 & 其他</p>
              <div className="flex justify-between items-center">
                <span className="flex items-center text-slate-400"><span className="w-2 h-2 rounded-full bg-emerald-500 mr-1.5"></span>管理/介绍</span>
                <span className="text-white">{calculatePercent((mixData.maternity_mgmt + mixData.maternity_intro), mixData.total)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center text-slate-400"><span className="w-2 h-2 rounded-full bg-slate-500 mr-1.5"></span>其他/试工</span>
                <span className="text-white">{calculatePercent(mixData.other, mixData.total)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Breakdown Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Stacked Bars */}
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
          <h4 className="text-lg font-semibold text-white mb-6">收入类型构成详情</h4>
          <div className="space-y-6">

            {/* Nanny Row */}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-white font-medium">育儿嫂 (Nanny)</span>
                <span className="text-slate-400">Total: ¥ {(nannyTotal).toLocaleString()}</span>
              </div>
              <div className="w-full h-6 bg-slate-700 rounded-full flex overflow-hidden">
                <div
                  className="h-full bg-blue-600 flex items-center justify-center text-[10px] text-white font-medium transition-all duration-1000"
                  style={{ width: calculatePercent(mixData.nanny_mgmt, nannyTotal) }}
                >
                  管理 {calculatePercent(mixData.nanny_mgmt, nannyTotal)}
                </div>
                <div
                  className="h-full bg-blue-400 flex items-center justify-center text-[10px] text-slate-900 font-medium transition-all duration-1000"
                  style={{ width: calculatePercent(mixData.nanny_intro, nannyTotal) }}
                >
                  介绍 {calculatePercent(mixData.nanny_intro, nannyTotal)}
                </div>
              </div>
            </div>

            {/* Maternity Row */}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-white font-medium">月嫂 (Maternity)</span>
                <span className="text-slate-400">Total: ¥ {(maternityTotal).toLocaleString()}</span>
              </div>
              <div className="w-full h-6 bg-slate-700 rounded-full flex overflow-hidden">
                <div
                  className="h-full bg-emerald-500 flex items-center justify-center text-[10px] text-white font-medium transition-all duration-1000"
                  style={{ width: calculatePercent(mixData.maternity_mgmt, maternityTotal) }}
                >
                  管理 {calculatePercent(mixData.maternity_mgmt, maternityTotal)}
                </div>
                <div
                  className="h-full bg-emerald-300 flex items-center justify-center text-[10px] text-slate-900 font-medium transition-all duration-1000"
                  style={{ width: calculatePercent(mixData.maternity_intro, maternityTotal) }}
                >
                  介绍 {calculatePercent(mixData.maternity_intro, maternityTotal)}
                </div>
              </div>
            </div>

            {/* Other Row */}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-300 font-medium">其他 (Other/Trial)</span>
                <span className="text-slate-400">Total: ¥ {(mixData.other || 0).toLocaleString()}</span>
              </div>
              <div className="w-full h-6 bg-slate-700 rounded-full flex overflow-hidden">
                <div className="h-full bg-slate-500 flex items-center justify-center text-[10px] text-white font-medium w-full">
                  试工及其他 100%
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Category Trends */}
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
          <div className="flex justify-between items-center mb-6">
            <h4 className="text-lg font-semibold text-white">各类目营收趋势</h4>
            <div className="flex gap-1 bg-slate-700 p-1 rounded-lg">
              <span className="px-2 py-1 text-xs text-white bg-slate-600 rounded">
                {period === 'year' ? '本年' : '近12月'}
              </span>
            </div>
          </div>
          <div className="h-48 w-full">
            <Line data={categoryTrendData} options={categoryTrendOptions} />
          </div>
          <div className="mt-4 flex gap-4 justify-center text-xs">
            <span className="flex items-center text-slate-300"><span className="w-2 h-2 rounded-full bg-blue-500 mr-2"></span>育儿嫂</span>
            <span className="flex items-center text-slate-300"><span className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></span>月嫂</span>
            <span className="flex items-center text-slate-300"><span className="w-2 h-2 rounded-full bg-slate-500 mr-2"></span>其他</span>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ExecutiveDashboard;
