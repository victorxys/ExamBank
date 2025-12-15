/**
 * 微信JS-SDK工具函数
 */

// 获取微信用户openid
export const getWechatOpenId = () => {
  return new Promise((resolve, reject) => {
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
    
    // 3. 检查是否在微信环境中
    if (isWechatBrowser()) {
      // 在微信环境中，需要进行OAuth授权
      redirectToWechatAuth();
    } else {
      // 非微信环境，使用测试openid或提示用户
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
export const redirectToWechatAuth = () => {
  const appId = process.env.REACT_APP_WECHAT_APP_ID;
  const redirectUri = encodeURIComponent(window.location.href);
  const scope = 'snsapi_base'; // 静默授权，只获取openid
  
  if (!appId) {
    console.error('未配置微信AppID');
    return;
  }
  
  const authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=STATE#wechat_redirect`;
  
  window.location.href = authUrl;
};

// 初始化微信JS-SDK
export const initWechatJSSDK = async () => {
  if (!isWechatBrowser()) {
    console.warn('非微信环境，跳过JS-SDK初始化');
    return;
  }
  
  try {
    // 获取JS-SDK配置
    const response = await fetch('/api/wechat/jssdk-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: window.location.href.split('#')[0] // 当前页面URL，不包含#及其后面部分
      })
    });
    
    const config = await response.json();
    
    if (window.wx) {
      window.wx.config({
        debug: false,
        appId: config.config.appId,
        timestamp: config.config.timestamp,
        nonceStr: config.config.nonceStr,
        signature: config.config.signature,
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