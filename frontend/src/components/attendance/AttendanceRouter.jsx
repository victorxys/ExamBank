import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, AlertCircle, ExternalLink, Smartphone } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../ui/use-toast';
import AttendanceSelectionPage from './AttendanceSelectionPage';

const MiniappGuide = ({ employeeName, miniapp, webFallbackPath, title = '请使用小程序填写考勤' }) => {
    return (
        <div className="min-h-screen flex items-center justify-center bg-teal-50 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm border border-teal-100 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal-100 text-teal-700">
                    <Smartphone className="h-7 w-7" />
                </div>
                <h1 className="text-xl font-bold text-gray-900">{title}</h1>
                <p className="mt-3 text-sm leading-6 text-gray-600">
                    {employeeName || '员工'}，考勤填写已迁移到“萌姨萌嫂服务助手”小程序。请阅读说明后点击按钮进入小程序。
                </p>

                {miniapp?.miniapp_url ? (
                    <button
                        type="button"
                        onClick={() => { window.location.href = miniapp.miniapp_url; }}
                        className="mt-5 w-full rounded-xl bg-teal-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-teal-500 flex items-center justify-center gap-2"
                    >
                        <ExternalLink className="h-4 w-4" />
                        打开小程序填写考勤
                    </button>
                ) : (
                    <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        小程序链接暂时生成失败，请联系管理员检查小程序配置。
                    </div>
                )}

                {miniapp?.miniapp_error && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-800">
                        {miniapp.miniapp_error}
                    </div>
                )}

                {webFallbackPath && (
                    <button
                        type="button"
                        onClick={() => { window.location.href = webFallbackPath; }}
                        className="mt-4 text-sm font-medium text-slate-500 underline underline-offset-4"
                    >
                        临时继续使用 Web 版填写
                    </button>
                )}
            </div>
        </div>
    );
};

const AttendanceRouter = () => {
    const { employee_token } = useParams();
    const { toast } = useToast();
    
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [attendanceData, setAttendanceData] = useState(null);
    const [miniappGuide, setMiniappGuide] = useState(null);

    // 不传递年月参数，让后端自动判断当前月份
    // 这样员工的考勤链接是固定的，不会因为月份变化而改变

    useEffect(() => {
        const checkAttendanceForms = async () => {
            try {
                setLoading(true);
                setError(null);

                // 调用智能路由API，不传递年月参数（让后端自动判断当前月份）
                const response = await api.get(`/attendance-forms/${employee_token}`);

                const data = response.data;

                if (data.redirect_type === 'single') {
                    const { form_token, year, month, contract_id: contractId, miniapp } = data.data;
                    let url = `/attendance-fill/${form_token}`;
                    if (year && month) {
                        url += `?year=${year}&month=${month}`;
                        if (contractId) url += `&contractId=${contractId}`;
                    }
                    setMiniappGuide({
                        employee_name: data.employee_name,
                        miniapp,
                        web_fallback_path: url
                    });
                    setLoading(false);
                } else if (data.redirect_type === 'multiple') {
                    // 多个考勤表，显示选择页面
                    // employee_name 在顶层，forms 在 data.data 里
                    setAttendanceData({
                        forms: data.data.forms,
                        employee_name: data.employee_name
                    });
                    setLoading(false);
                } else {
                    // 没有考勤表
                    setAttendanceData({ forms: [], employee_name: data.employee_name || '未知员工' });
                    setLoading(false);
                }
            } catch (error) {
                console.error('Failed to fetch attendance forms:', error);
                setError(error.response?.data?.error || '获取考勤表失败');
                setLoading(false);
                
                toast({
                    title: "获取考勤表失败",
                    description: error.response?.data?.error || "请检查链接是否正确",
                    variant: "destructive"
                });
            }
        };

        if (employee_token) {
            checkAttendanceForms();
        }
    }, [employee_token, toast]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-4" />
                    <p className="text-gray-600">正在加载考勤表...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="text-center max-w-md mx-auto p-6">
                    <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-gray-900 mb-2">加载失败</h2>
                    <p className="text-gray-600 mb-4">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 py-2 rounded-lg transition-colors"
                    >
                        重新加载
                    </button>
                </div>
            </div>
        );
    }

    if (miniappGuide) {
        return (
            <MiniappGuide
                employeeName={miniappGuide.employee_name}
                miniapp={miniappGuide.miniapp}
                webFallbackPath={miniappGuide.web_fallback_path}
            />
        );
    }

    // 显示选择页面
    return (
        <AttendanceSelectionPage
            forms={attendanceData.forms || []}
            employeeName={attendanceData.employee_name}
        />
    );
};

export default AttendanceRouter;
