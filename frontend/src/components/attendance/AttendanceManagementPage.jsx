import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useToast } from '../ui/use-toast';
import AttendanceFormModal from './AttendanceFormModal';
import api from '../../api/axios';

const AttendanceManagementPage = () => {
    const [selectedYear, setSelectedYear] = useState(() => {
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        return lastMonth.getFullYear();
    });
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        return lastMonth.getMonth() + 1;
    });
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Search and Filter State
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');

    const { toast } = useToast();

    // 生成年份选项（当前年份前后2年）
    const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);
    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    useEffect(() => {
        fetchAttendanceList();
    }, [selectedYear, selectedMonth]);

    const fetchAttendanceList = async () => {
        setLoading(true);
        try {
            const response = await api.get('/attendance-forms/monthly-list', {
                params: {
                    year: selectedYear,
                    month: selectedMonth
                }
            });
            setEmployees(response.data.items || []);
        } catch (error) {
            console.error('获取考勤列表失败:', error);
            toast({
                title: '加载失败',
                description: '无法获取考勤列表，请稍后重试',
                variant: 'destructive'
            });
        } finally {
            setLoading(false);
        }
    };

    // Filter employees
    const filteredEmployees = employees.filter(employee => {
        const matchesSearch =
            (employee.employee_name?.toLowerCase().includes(searchTerm.toLowerCase()) || '') ||
            (employee.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) || '');

        const matchesStatus = statusFilter === 'all' ||
            (statusFilter === 'completed' && employee.form_status === 'customer_signed') ||
            (statusFilter === 'pending' && employee.form_status === 'confirmed') ||
            (statusFilter === 'incomplete' && ['not_created', 'draft'].includes(employee.form_status));

        return matchesSearch && matchesStatus;
    }).sort((a, b) => {
        // 1. Status Priority: Signed at the bottom
        const getSortPriority = (status) => {
            if (status === 'customer_signed') return 2;
            if (status === 'confirmed') return 1;
            return 0; // not_created, draft
        };

        const priorityA = getSortPriority(a.form_status);
        const priorityB = getSortPriority(b.form_status);

        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }

        // 2. Name Priority: Alphabetical
        return (a.employee_name || '').localeCompare(b.employee_name || '', 'zh-CN');
    });

    // 计算统计数据 (基于筛选后的数据? 通常统计数据基于全部数据比较好，这里保持基于全部数据)
    const stats = {
        total: employees.length,
        pending: employees.filter(e => e.form_status === 'confirmed').length,
        completed: employees.filter(e => e.form_status === 'signed').length,
        notStarted: employees.filter(e => ['not_created', 'draft'].includes(e.form_status)).length
    };

    const handleCopyLink = (link) => {
        navigator.clipboard.writeText(link);
        toast({
            title: '✓ 已复制',
            description: '考勤表链接已复制到剪贴板'
        });
    };

    const handleViewForm = (employee) => {
        // Navigate to admin view route
        window.location.href = `/attendance-admin/${employee.employee_access_token}`;
    };

    const handleDownload = async (employee) => {
        if (!employee.form_id) {
            toast({
                title: '无法下载',
                description: '考勤表尚未生成',
                variant: 'destructive'
            });
            return;
        }

        try {
            toast({
                title: '正在生成 PDF...',
                description: '请稍候，文件生成可能需要几秒钟'
            });

            const response = await api.get(`/attendance-forms/download/${employee.form_id}`, {
                responseType: 'blob'
            });

            // Create blob link to download
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;

            // Get filename from header or default
            const contentDisposition = response.headers['content-disposition'];
            let filename = `attendance_${employee.employee_name}.pdf`;
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                if (filenameMatch && filenameMatch.length === 2)
                    filename = decodeURIComponent(filenameMatch[1]);
            }

            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);

            toast({
                title: '下载成功',
                description: 'PDF 文件已开始下载'
            });
        } catch (error) {
            console.error('下载失败:', error);
            toast({
                title: '下载失败',
                description: '生成 PDF 时出错，请稍后重试',
                variant: 'destructive'
            });
        }
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case 'customer_signed':
                return (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd"
                                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                clipRule="evenodd"></path>
                        </svg>
                        客户已签署
                    </span>
                );
            case 'confirmed':
                return (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd"
                                d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                                clipRule="evenodd"></path>
                        </svg>
                        待客户签署
                    </span>
                );
            case 'draft':
            case 'not_created':
            default:
                return (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-sm font-medium">
                        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                        未填写
                    </span>
                );
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* 页面标题 */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                            考勤管理
                        </h1>
                        <p className="text-gray-600 text-lg">查看和管理员工的月度考勤记录</p>
                    </div>
                    <div className="text-gray-500">
                        {selectedYear}年{selectedMonth}月
                    </div>
                </div>

                {/* 统计卡片 */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* ... (Stats cards remain same) ... */}
                    {/* 总员工数 */}
                    <div className="bg-white/90 backdrop-blur rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <p className="text-sm text-gray-600 mb-1">总员工数</p>
                                <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
                            </div>
                            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                                <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z">
                                    </path>
                                </svg>
                            </div>
                        </div>
                        <div className="h-1 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full"></div>
                    </div>

                    {/* 未填写 */}
                    <div className="bg-white/90 backdrop-blur rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <p className="text-sm text-gray-600 mb-1">未填写</p>
                                <p className="text-3xl font-bold text-gray-900">{stats.notStarted}</p>
                            </div>
                            <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
                                <svg className="h-6 w-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z">
                                    </path>
                                </svg>
                            </div>
                        </div>
                        <div className="h-1 bg-gradient-to-r from-gray-400 to-gray-500 rounded-full"></div>
                    </div>

                    {/* 待签署 */}
                    <div className="bg-white/90 backdrop-blur rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <p className="text-sm text-gray-600 mb-1">待签署</p>
                                <p className="text-3xl font-bold text-gray-900">{stats.pending}</p>
                            </div>
                            <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center">
                                <svg className="h-6 w-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                </svg>
                            </div>
                        </div>
                        <div className="h-1 bg-gradient-to-r from-amber-500 to-amber-600 rounded-full"></div>
                    </div>

                    {/* 已完成 */}
                    <div className="bg-white/90 backdrop-blur rounded-lg shadow-lg p-6 hover:shadow-xl transition-shadow">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <p className="text-sm text-gray-600 mb-1">已完成</p>
                                <p className="text-3xl font-bold text-gray-900">{stats.completed}</p>
                            </div>
                            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
                                <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                </svg>
                            </div>
                        </div>
                        <div className="h-1 bg-gradient-to-r from-green-500 to-green-600 rounded-full"></div>
                    </div>
                </div>

                {/* 筛选与操作栏 */}
                <div className="bg-white/90 backdrop-blur rounded-lg shadow-lg p-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        {/* 左侧：日期选择 */}
                        <div className="flex items-center gap-4">
                            <h3 className="text-lg font-semibold flex items-center gap-2 min-w-fit">
                                <svg className="h-5 w-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z">
                                    </path>
                                </svg>
                                考勤周期
                            </h3>
                            <div className="flex gap-2">
                                <select
                                    value={selectedYear}
                                    onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                                    className="border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                >
                                    {years.map(year => (
                                        <option key={year} value={year}>{year} 年</option>
                                    ))}
                                </select>
                                <select
                                    value={selectedMonth}
                                    onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                                    className="border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                >
                                    {months.map(month => (
                                        <option key={month} value={month}>{month} 月</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* 右侧：搜索与状态筛选 */}
                        <div className="flex flex-col md:flex-row gap-4 flex-1 md:justify-end">
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="搜索员工或客户姓名..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none w-full md:w-64"
                                />
                                <svg className="h-5 w-5 text-gray-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>

                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                            >
                                <option value="all">全部状态</option>
                                <option value="completed">已签署</option>
                                <option value="pending">待签署</option>
                                <option value="incomplete">未填写</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* 数据表格 */}
                <div className="bg-white/90 backdrop-blur rounded-lg shadow-lg overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gradient-to-r from-indigo-50 to-purple-50 border-b-2 border-indigo-200">
                                <tr>
                                    <th className="px-6 py-4 text-left font-semibold text-gray-800">员工姓名</th>
                                    <th className="px-6 py-4 text-left font-semibold text-gray-800">客户名称</th>
                                    <th className="px-6 py-4 text-left font-semibold text-gray-800">合同期限</th>
                                    <th className="px-6 py-4 text-left font-semibold text-gray-800">状态</th>
                                    <th className="px-6 py-4 text-right font-semibold text-gray-800">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-16 text-center">
                                            <div className="flex flex-col items-center gap-4">
                                                <div className="relative">
                                                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-200"></div>
                                                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent absolute top-0"></div>
                                                </div>
                                                <span className="text-gray-600 font-medium">加载中...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : filteredEmployees.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-16 text-center">
                                            <div className="flex flex-col items-center gap-4 text-gray-400">
                                                <svg className="h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                                                </svg>
                                                <span className="text-lg font-medium">
                                                    {employees.length === 0 ? "暂无考勤数据" : "未找到匹配的记录"}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredEmployees.map((employee) => (
                                        <tr key={employee.contract_id} className="hover:bg-indigo-50/50 transition-colors">
                                            <td className="px-6 py-4 font-medium text-gray-900">
                                                {employee.employee_name}
                                            </td>
                                            <td className="px-6 py-4 text-gray-700">
                                                {employee.customer_name}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-600">
                                                {employee.contract_start_date && employee.contract_end_date ? (
                                                    <div className="flex flex-col gap-0.5">
                                                        <span>{format(new Date(employee.contract_start_date), 'yyyy-MM-dd')}</span>
                                                        <span className="text-gray-400 text-xs">至</span>
                                                        <span>{format(new Date(employee.contract_end_date), 'yyyy-MM-dd')}</span>
                                                    </div>
                                                ) : '-'}
                                            </td>
                                            <td className="px-6 py-4">
                                                {getStatusBadge(employee.form_status)}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => handleCopyLink(employee.access_link)}
                                                        className="text-gray-500 hover:text-indigo-600 p-2 rounded-lg hover:bg-indigo-50 transition-colors"
                                                        title="复制考勤链接"
                                                    >
                                                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                                                        </svg>
                                                    </button>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => handleViewForm(employee)}
                                                            className="px-3 py-1 text-white text-sm rounded-md transition-colors shadow-sm hover:shadow-md"
                                                            style={{ backgroundColor: '#26A69A' }}
                                                        >
                                                            查看
                                                        </button>
                                                        {(employee.form_status === 'customer_signed' || employee.form_status === 'synced') && (
                                                            <button
                                                                onClick={() => handleDownload(employee)}
                                                                className="px-3 py-1 bg-gray-600 text-white text-sm rounded-md hover:bg-gray-700 transition-colors shadow-sm hover:shadow-md flex items-center gap-1"
                                                            >
                                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                                                下载
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* 考勤表弹窗 */}
            {selectedEmployee && (
                <AttendanceFormModal
                    isOpen={isModalOpen}
                    onClose={() => {
                        setIsModalOpen(false);
                        setSelectedEmployee(null);
                        fetchAttendanceList();
                    }}
                    employeeId={selectedEmployee.employee_id}
                    initialToken={selectedEmployee.employee_access_token}
                />
            )}
        </div>
    );
};

export default AttendanceManagementPage;
