/**
 * 微信JS-SDK工具函数
 */

// 检查是否为开发环境
const isDevelopment = () => {
  const hostname = window.location.hostname;
  const isDev = import.meta.env.DEV || 
                hostname === 'localhost' || 
                hostname === '127.0.0.1' ||
                hostname.includes('192.168.') ||  // 局域网IP
                hostname.includes('10.');          // 局域网IP
  console.log('isDevelopment check:', { isDev, hostname, envDev: import.meta.env.DEV });
  return isDev;
};

// 获取微信用户openid
export const getWechatOpenId = async () => {
  console.log('getWechatOpenId 开始执行...');
  
  // 1. 从localStorage获取（已缓存）
  const cachedOpenid = localStorage.getItem('wechat_openid');
  if (cachedOpenid) {
    console.log('从缓存获取openid:', cachedOpenid);
    return cachedOpenid;
  }
  
  // 2. 从URL参数获取 openid（直接传递的情况）
  const urlParams = new URLSearchParams(window.location.search);
  const openidFromUrl = urlParams.get('openid');
  if (openidFromUrl) {
    console.log('从URL获取openid:', openidFromUrl);
    localStorage.setItem('wechat_openid', openidFromUrl);
    cleanUrlParams();
    return openidFromUrl;
  }
  
  // 3. 从URL参数获取 code（微信OAuth回调）
  const codeFromUrl = urlParams.get('code');
  console.log('URL中的code:', codeFromUrl);
  if (codeFromUrl) {
    try {
      console.log('用code换取openid...');
      const response = await fetch(`/api/wechat-attendance/oauth-callback?code=${codeFromUrl}`);
      const data = await response.json();
      console.log('OAuth回调响应:', data);
      
      if (data.success && data.openid) {
        localStorage.setItem('wechat_openid', data.openid);
        cleanUrlParams();
        return data.openid;
      } else {
        console.error('获取openid失败:', data.error);
      }
    } catch (error) {
      console.error('OAuth回调处理失败:', error);
    }
  }
  
  // 4. 开发环境：直接使用测试openid，跳过OAuth
  if (isDevelopment()) {
    const devOpenid = 'dev_openid_' + Date.now();
    console.warn('开发环境，使用测试openid:', devOpenid);
    localStorage.setItem('wechat_openid', devOpenid);
    return devOpenid;
  }
  
  // 5. 生产环境微信浏览器：触发OAuth授权
  console.log('检查是否在微信浏览器中:', isWechatBrowser());
  if (isWechatBrowser()) {
    console.log('在微信浏览器中，触发OAuth授权...');
    const redirected = redirectToWechatAuth();
    if (!redirected) {
      const tempOpenid = 'temp_wechat_' + Date.now();
      console.warn('微信环境但AppID未配置，使用临时openid:', tempOpenid);
      return tempOpenid;
    }
    // 如果成功跳转，页面会重定向，返回空字符串
    return '';
  }
  
  // 6. 非微信环境，使用测试openid
  const testOpenid = 'demo_openid_' + Date.now();
  console.warn('非微信环境，使用测试openid:', testOpenid);
  return testOpenid;
};

// 清理URL中的OAuth参数
const cleanUrlParams = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('openid');
  window.history.replaceState({}, '', url.pathname + url.search);
};

// 检查是否在微信浏览器中
export const isWechatBrowser = () => {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('micromessenger');
};

// 跳转到微信OAuth授权
// 返回 true 表示成功跳转，false 表示未能跳转
export const redirectToWechatAuth = () => {
  const appId = import.meta.env.VITE_WECHAT_APP_ID;
  
  if (!appId) {
    console.warn('未配置 VITE_WECHAT_APP_ID，无法进行微信OAuth授权');
    return false;
  }
  
  // 构建干净的回调URL（只保留路径，不包含之前的code等参数）
  const baseUrl = window.location.origin + window.location.pathname;
  const redirectUri = encodeURIComponent(baseUrl);
  const scope = 'snsapi_base'; // 静默授权，只获取openid
  
  const authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=STATE#wechat_redirect`;
  
  window.location.href = authUrl;
  return true;
};

// 初始化微信JS-SDK
export const initWechatJSSDK = async () => {
  if (!isWechatBrowser()) {
    console.warn('非微信环境，跳过JS-SDK初始化');
    return;
  }
  
  try {
    // 获取JS-SDK配置 - 使用 GET 请求，URL 作为查询参数
    const currentUrl = encodeURIComponent(window.location.href.split('#')[0]);
    const response = await fetch(`/api/wechat/jssdk-config?url=${currentUrl}`);
    
    const data = await response.json();
    
    if (!data.success) {
      console.error('获取JSSDK配置失败:', data.message);
      return;
    }
    
    if (window.wx) {
      window.wx.config({
        debug: false,
        appId: data.config.appId,
        timestamp: data.config.timestamp,
        nonceStr: data.config.nonceStr,
        signature: data.config.signature,
        jsApiList: [
          'chooseImage',
          'uploadImage',
          'downloadImage',
          'getLocation',
          'openLocation'
        ]
      });
      
      window.wx.ready(() => {
        console.log('微信JS-SDK初始化成功');
      });
      
      window.wx.error((res) => {
        console.error('微信JS-SDK初始化失败:', res);
      });
    }
  } catch (error) {
    console.error('获取微信JS-SDK配置失败:', error);
  }
};

// 微信分享配置
export const configWechatShare = (shareData) => {
  if (!window.wx || !isWechatBrowser()) {
    return;
  }
  
  const defaultShareData = {
    title: '萌姨萌嫂 - 我的考勤',
    desc: '查看和填写我的考勤信息',
    link: window.location.href,
    imgUrl: window.location.origin + '/logo192.png'
  };
  
  const finalShareData = { ...defaultShareData, ...shareData };
  
  window.wx.ready(() => {
    // 分享到朋友圈
    window.wx.onMenuShareTimeline(finalShareData);
    
    // 分享给朋友
    window.wx.onMenuShareAppMessage(finalShareData);
    
    // 分享到QQ
    window.wx.onMenuShareQQ(finalShareData);
    
    // 分享到腾讯微博
    window.wx.onMenuShareWeibo(finalShareData);
  });
};

// 获取微信用户基本信息（需要用户授权）
export const getWechatUserInfo = () => {
  return new Promise((resolve, reject) => {
    if (!isWechatBrowser()) {
      reject(new Error('非微信环境'));
      return;
    }
    
    // 这里需要后端配合，通过code换取用户信息
    // 实际实现需要根据具体的微信开发文档
    reject(new Error('需要实现微信用户信息获取逻辑'));
  });
};