import React from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Clock, CheckCircle2, AlertCircle, FileText } from 'lucide-react';

const StatusBadge = ({ status }) => {
    const statusConfig = {
        'draft': { 
            label: '待填写', 
            color: 'bg-gray-100 text-gray-700',
            icon: FileText
        },
        'employee_confirmed': { 
            label: '待客户签署', 
            color: 'bg-yellow-100 text-yellow-700',
            icon: Clock
        },
        'customer_signed': { 
            label: '已完成', 
            color: 'bg-green-100 text-green-700',
            icon: CheckCircle2
        },
        'synced': { 
            label: '已同步', 
            color: 'bg-blue-100 text-blue-700',
            icon: CheckCircle2
        }
    };

    const config = statusConfig[status] || statusConfig['draft'];
    const Icon = config.icon;

    return (
        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
            <Icon className="w-3 h-3" />
            {config.label}
        </div>
    );
};

const AttendanceSelectionPage = ({ forms, employeeName }) => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-4 py-6">
                <div className="max-w-md mx-auto">
                    <div className="flex items-center justify-between mb-2">
                        <h1 className="text-2xl font-bold text-gray-900">
                            考勤管理
                        </h1>
                        <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm">
                            {employeeName?.slice(-2) || 'User'}
                        </div>
                    </div>
                    <p className="text-sm text-gray-600">
                        员工: {employeeName} · 请选择要处理的考勤表
                    </p>
                </div>
            </div>

            {/* Forms List */}
            <div className="max-w-md mx-auto p-4 space-y-4">
                {forms.map((form, index) => {
                    // 解析服务期间
                    const [startDateStr, endDateStr] = form.service_period.split(' to ');
                    const startDate = parseISO(startDateStr);
                    const endDate = parseISO(endDateStr);
                    
                    const periodText = `${format(startDate, 'M月d日', { locale: zhCN })} - ${format(endDate, 'M月d日', { locale: zhCN })}`;

                    return (
                        <div
                            key={form.form_token}
                            className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
                        >
                            {/* Header */}
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <h3 className="font-bold text-gray-900 text-lg">
                                        客户: {form.family_customers.join('、')}
                                    </h3>
                                    <p className="text-sm text-gray-600 mt-1">
                                        服务期间: {periodText}
                                    </p>
                                </div>
                                <StatusBadge status={form.status} />
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-3">
                                <button
                                    onClick={() => navigate(`/attendance-fill/${form.form_id}`)}
                                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                                >
                                    <FileText className="w-4 h-4" />
                                    {form.status === 'draft' ? '填写考勤' : '查看/修改'}
                                </button>
                                
                                {/* 如果已确认，显示分享按钮 */}
                                {form.status === 'employee_confirmed' && form.client_sign_url && (
                                    <button
                                        onClick={() => {
                                            // 跳转到签署页面
                                            window.location.href = form.client_sign_url + '?showShareHint=true';
                                        }}
                                        className="px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-xl transition-colors flex items-center justify-center"
                                        title="分享给客户签署"
                                    >
                                        <Clock className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}

                {/* Empty State */}
                {forms.length === 0 && (
                    <div className="text-center py-12">
                        <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">暂无考勤表</h3>
                        <p className="text-gray-600">当前月份没有需要处理的考勤表</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AttendanceSelectionPage;