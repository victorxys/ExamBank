import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, User, CreditCard, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useToast } from '../components/ui/use-toast';
import api from '../api/axios';
import { getWechatOpenId } from '../utils/wechatUtils';

/**
 * 微信公众号考勤入口页面
 * 
 * 流程：
 * 1. 首次使用：验证身份（姓名+身份证号）→ 关联openid → 跳转到考勤填写页面
 * 2. 后续使用：直接跳转到考勤填写页面
 */
const WechatAttendance = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [needVerify, setNeedVerify] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [name, setName] = useState('');
  const [idCardNumber, setIdCardNumber] = useState('');
  const [error, setError] = useState('');
  const [isInactive, setIsInactive] = useState(false);

  useEffect(() => {
    checkEmployeeAndRedirect();
  }, []);

  const checkEmployeeAndRedirect = async () => {
    setLoading(true);
    try {
      const openid = await getWechatOpenId();
      
      // 如果 openid 为空，说明正在进行 OAuth 跳转，不需要继续
      if (!openid) {
        console.log('正在进行微信OAuth授权跳转...');
        return;
      }
      
      console.log('获取到openid:', openid);
      
      const response = await api.get('/wechat-attendance/employee-info', {
        params: { openid }
      });

      if (response.data.success) {
        const employee = response.data.employee;
        
        // 检查员工是否激活
        if (!employee.is_active) {
          setIsInactive(true);
          setLoading(false);
          return;
        }
        
        // 已关联且激活的员工，直接跳转到考勤填写页面
        navigate(`/attendance/${employee.id}`, { replace: true });
      }
    } catch (err) {
      console.error('checkEmployeeAndRedirect 错误:', err);
      if (err.response?.data?.need_verify) {
        setNeedVerify(true);
      } else {
        const errorMsg = err.response?.data?.error || err.message || '未知错误';
        toast({
          title: "获取信息失败",
          description: errorMsg,
          variant: "destructive"
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmployee = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!name.trim()) {
      setError('请输入姓名');
      return;
    }
    
    if (!idCardNumber.trim()) {
      setError('请输入身份证号');
      return;
    }
    
    // 简单的身份证号格式验证
    const idCardRegex = /^[1-9]\d{5}(18|19|20)\d{2}((0[1-9])|(1[0-2]))(([0-2][1-9])|10|20|30|31)\d{3}[0-9Xx]$/;
    if (!idCardRegex.test(idCardNumber)) {
      setError('请输入正确的身份证号');
      return;
    }

    setVerifying(true);
    try {
      const openid = await getWechatOpenId();
      const response = await api.post('/wechat-attendance/verify-employee', {
        openid,
        name: name.trim(),
        id_card_number: idCardNumber.trim()
      });

      if (response.data.success) {
        toast({
          title: "验证成功",
          description: "正在跳转到考勤页面...",
        });
        const employeeId = response.data.employee.id;
        navigate(`/attendance/${employeeId}`, { replace: true });
      } else {
        setError(response.data.error || '验证失败');
      }
    } catch (err) {
      const errorMsg = err.response?.data?.error || '验证失败，请检查信息是否正确';
      setError(errorMsg);
      
      // 检查是否是未激活状态
      if (errorMsg.includes('未激活') || errorMsg.includes('inactive')) {
        setIsInactive(true);
        setNeedVerify(false);
      }
    } finally {
      setVerifying(false);
    }
  };

  // 加载中状态
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-teal-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-teal-500" />
          <p className="text-gray-600">正在加载...</p>
        </div>
      </div>
    );
  }

  // 员工未激活状态
  if (isInactive) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-teal-50">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <img 
              src="/logo.png" 
              alt="萌姨萌嫂" 
              className="mx-auto h-16 w-auto mb-4"
            />
            <CardTitle className="text-red-600">无法访问</CardTitle>
            <CardDescription>
              您的账号当前未激活，无法使用考勤系统
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">
                请联系公司管理人员激活您的账号后再试
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 需要验证身份
  if (needVerify) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-teal-50">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <img 
              src="/logo.png" 
              alt="萌姨萌嫂" 
              className="mx-auto h-16 w-auto mb-4"
            />
            <CardTitle>身份验证</CardTitle>
            <CardDescription>
              首次使用需要验证身份信息
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleVerifyEmployee} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium text-gray-700">
                  姓名
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    id="name"
                    type="text"
                    placeholder="请输入您的姓名"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-none transition-colors focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <label htmlFor="idCard" className="text-sm font-medium text-gray-700">
                  身份证号
                </label>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    id="idCard"
                    type="text"
                    placeholder="请输入身份证号"
                    value={idCardNumber}
                    onChange={(e) => setIdCardNumber(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg outline-none transition-colors focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <Button 
                type="submit" 
                className="w-full text-white bg-teal-600 hover:bg-teal-500 border-teal-500"
                disabled={verifying}
              >
                {verifying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    验证中...
                  </>
                ) : (
                  '验证身份'
                )}
              </Button>
            </form>

            <div className="mt-6 p-4 rounded-lg text-sm text-gray-600 bg-teal-50">
              <p className="font-medium mb-2">💡 温馨提示：</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>请确保姓名和身份证号与公司登记信息一致</li>
                <li>验证成功后将自动关联您的微信账号</li>
                <li>如有问题请联系公司管理人员</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 正常情况下不会显示这个，因为会直接跳转
  return null;
};

export default WechatAttendance;