import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../ui/use-toast';
import AttendanceSelectionPage from './AttendanceSelectionPage';

const AttendanceRouter = () => {
    const { employee_token } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { toast } = useToast();
    
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [attendanceData, setAttendanceData] = useState(null);

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
                    // 只有一个考勤表，直接重定向
                    navigate(`/attendance-fill/${data.data.form_token}`, { replace: true });
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
    }, [employee_token, navigate, toast]);

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

    // 显示选择页面
    return (
        <AttendanceSelectionPage
            forms={attendanceData.forms || []}
            employeeName={attendanceData.employee_name}
        />
    );
};

export default AttendanceRouter;