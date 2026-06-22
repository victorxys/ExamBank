import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, Smartphone } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import api from '../api/axios';
import WechatShare from '../components/WechatShare';

const WechatAttendance = () => {
  const [loading, setLoading] = useState(true);
  const [miniappEntry, setMiniappEntry] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadMiniappEntry = async () => {
      try {
        const response = await api.get('/wechat-attendance/miniapp-entry');
        const miniapp = response.data.miniapp || {};
        setMiniappEntry(miniapp);
      } catch (err) {
        setError(err.response?.data?.error || err.message || '小程序入口加载失败');
      } finally {
        setLoading(false);
      }
    };

    loadMiniappEntry();
  }, []);

  const shareConfig = (
    <WechatShare
      shareTitle="萌姨萌嫂 - 我的考勤"
      shareDesc="请使用小程序填写和查看考勤"
      shareImgUrl={`${window.location.origin}/logo_share.jpg`}
      shareLink={`${window.location.origin}/wechat-attendance`}
    />
  );

  if (loading) {
    return (
      <>
        {shareConfig}
        <div className="min-h-screen flex items-center justify-center bg-teal-50">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-teal-500" />
            <p className="text-gray-600">正在加载小程序入口...</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {shareConfig}
      <div className="min-h-screen flex items-center justify-center p-4 bg-teal-50">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <img
              src="/logo.png"
              alt="萌姨萌嫂"
              className="mx-auto h-16 w-auto mb-4"
            />
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 text-teal-700">
              <Smartphone className="h-6 w-6" />
            </div>
            <CardTitle>请使用小程序填写考勤</CardTitle>
            <CardDescription>
              考勤填写已迁移到“萌姨萌嫂服务助手”小程序。进入小程序后，请使用员工手机号和身份证后 6 位完成绑定。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm text-teal-800">
              <p className="font-medium">请先阅读说明，再点击按钮进入小程序。</p>
              <p className="mt-1 text-teal-700">进入小程序后，请按提示完成员工身份绑定并填写考勤。</p>
            </div>

            {miniappEntry?.miniapp_url ? (
              <Button
                type="button"
                className="w-full text-white bg-teal-600 hover:bg-teal-500 border-teal-500"
                onClick={() => { window.location.href = miniappEntry.miniapp_url; }}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                打开小程序填写考勤
              </Button>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {error || '小程序链接暂时生成失败，请联系管理员检查小程序配置。'}
              </div>
            )}

            {miniappEntry?.miniapp_error && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {miniappEntry.miniapp_error}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default WechatAttendance;
