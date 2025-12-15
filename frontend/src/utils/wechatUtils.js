/**
 * 微信JS-SDK工具函数
 */

// 检查是否为开发环境
const isDevelopment = () => {
  return import.meta.env.DEV || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
};

// 获取微信用户openid
export const getWechatOpenId = () => {
  return new Promise((resolve) => {
    // 在实际微信环境中，需要通过微信授权获取openid
    // 这里提供几种获取方式：
    
    // 1. 从URL参数获取（微信授权回调）
    const urlParams = new URLSearchParams(window.location.search);
    const openidFromUrl = urlParams.get('openid');
    if (openidFromUrl) {
      localStorage.setItem('wechat_openid', openidFromUrl);
      resolve(openidFromUrl);
      return;
    }
    
    // 2. 从localStorage获取（已缓存）
    const cachedOpenid = localStorage.getItem('wechat_openid');
    if (cachedOpenid) {
      resolve(cachedOpenid);
      return;
    }
    
    // 3. 开发环境：直接使用测试openid，跳过OAuth
    if (isDevelopment()) {
      const devOpenid = 'dev_openid_' + Date.now();
      console.warn('开发环境，使用测试openid:', devOpenid);
      localStorage.setItem('wechat_openid', devOpenid);
      resolve(devOpenid);
      return;
    }
    
    // 4. 生产环境：检查是否在微信环境中
    if (isWechatBrowser()) {
      // 在微信环境中，需要进行OAuth授权
      const redirected = redirectToWechatAuth();
      if (!redirected) {
        // 如果未能跳转（AppID未配置），使用临时openid
        const tempOpenid = 'temp_wechat_' + Date.now();
        console.warn('微信环境但AppID未配置，使用临时openid:', tempOpenid);
        resolve(tempOpenid);
      }
      // 如果成功跳转，页面会重定向，Promise不需要resolve
    } else {
      // 非微信环境，使用测试openid
      const testOpenid = 'demo_openid_' + Date.now();
      console.warn('非微信环境，使用测试openid:', testOpenid);
      resolve(testOpenid);
    }
  });
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
  const redirectUri = encodeURIComponent(window.location.href);
  const scope = 'snsapi_base'; // 静默授权，只获取openid
  
  if (!appId) {
    console.warn('未配置 VITE_WECHAT_APP_ID，无法进行微信OAuth授权');
    return false;
  }
  
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