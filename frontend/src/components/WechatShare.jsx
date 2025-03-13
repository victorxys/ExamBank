import React, { useEffect, useCallback, useState } from 'react';
import wx from 'weixin-js-sdk';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import MiniProgramTools from '../utils/MiniProgramTools';

const WechatShare = ({ shareTitle, shareDesc, shareImgUrl, shareLink }) => {
  const [isInMiniProgram, setIsInMiniProgram] = useState(false);

  // 检测当前是否在微信小程序中
  useEffect(() => {
    const checkIfInMiniProgram = () => {
      if (window.wx && window.wx.miniProgram) {
        console.log('检测到当前环境在微信小程序WebView中');
        setIsInMiniProgram(true);
        
        // 通知小程序当前页面的路径
        sendPageInfoToMiniProgram();
        
        // 增加监听 URL 变化的事件
        window.addEventListener('popstate', handleUrlChange);
        window.addEventListener('hashchange', handleUrlChange);
        
        // 订阅来自小程序的消息
        window.__WEBVIEW_MESSAGE_CALLBACK = (event) => {
          console.log('收到来自小程序的消息:', event);
          // 处理消息...
        };
      } else {
        console.log('当前环境不在微信小程序WebView中');
        setIsInMiniProgram(false);
      }
    };
    
    checkIfInMiniProgram();
    
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
      delete window.__WEBVIEW_MESSAGE_CALLBACK;
    };
  }, []);
  
  // 监听 URL 变化
  const handleUrlChange = useCallback(() => {
    console.log('URL 变化:', window.location.href);
    if (isInMiniProgram) {
      sendPageInfoToMiniProgram();
    }
  }, [isInMiniProgram]);
  
  // 向小程序发送当前页面信息
  const sendPageInfoToMiniProgram = useCallback(() => {
    if (window.wx && window.wx.miniProgram) {
      const currentUrl = window.location.href;
      const title = shareTitle || document.title || '分享页面';
      const desc = shareDesc || document.querySelector('meta[name="description"]')?.content || '页面描述';
      
      // 确保图片 URL 是完整路径
      const hostname = window.location.hostname;
      const protocol = window.location.protocol;
      const imgHostPath = `${protocol}//${hostname}`;
      
      // 首先检查是否是员工资料页面
      const isEmployeeProfile = currentUrl.includes('employee-profile');
      let fullImgUrl;
      
      if (isEmployeeProfile) {
        // 员工资料页面使用特殊处理获取员工头像
        const employeeImg = document.querySelector('.MuiAvatar-img')?.src || 
                           document.querySelector('.employee-avatar img')?.src;
        
        console.log('检测到员工资料页面，获取头像:', employeeImg);
        
        if (employeeImg) {
          fullImgUrl = employeeImg.startsWith('http') ? employeeImg : imgHostPath + employeeImg;
        } else {
          // 如果无法获取员工头像，使用默认值
          fullImgUrl = shareImgUrl?.startsWith('http') 
                    ? shareImgUrl 
                    : shareImgUrl
                      ? imgHostPath + shareImgUrl
                      : imgHostPath + '/logo192.png';
        }
      } else {
        // 非员工资料页面
        fullImgUrl = shareImgUrl?.startsWith('http') 
                  ? shareImgUrl 
                  : shareImgUrl
                    ? imgHostPath + shareImgUrl
                    : imgHostPath + '/logo192.png';
      }
      
      console.log('向小程序发送当前页面信息:', {
        url: currentUrl,
        title: title,
        desc: desc,
        imgUrl: fullImgUrl
      });
      
      window.wx.miniProgram.postMessage({
        data: {
          type: 'currentPage',
          url: currentUrl,
          title: title,
          desc: desc,
          imgUrl: fullImgUrl
        }
      });
      
      // 额外通过 localStorage 同步状态
      try {
        localStorage.setItem('currentPageUrl', currentUrl);
        localStorage.setItem('currentTitle', title);
        localStorage.setItem('currentImgUrl', fullImgUrl);
        localStorage.setItem('currentDesc', desc);
      } catch (e) {
        console.error('无法使用 localStorage:', e);
      }
    } else {
      // 如果 wx 对象不存在，尝试通过 localStorage 通信
      try {
        const currentUrl = window.location.href;
        console.log('wx对象不可用，通过localStorage发送页面信息:', currentUrl);
        
        localStorage.setItem('currentPageUrl', currentUrl);
        
        // 如果是导航操作，同时设置导航标记
        if (window.location.href.includes('employee-profile')) {
          localStorage.setItem('navigateToUrl', currentUrl);
          localStorage.setItem('navigateTime', String(Date.now()));
        }
      } catch (e) {
        console.error('无法使用 localStorage:', e);
      }
    }
  }, [shareTitle, shareDesc, shareImgUrl]);

  const handleShareToFriend = useCallback(() => {
    // 主动触发分享界面
    if (typeof wx.showOptionMenu === 'function') {
      wx.showOptionMenu();
    }
    
    const currentUrl = window.location.href;
    const shareOptions = {
      title: shareTitle || document.title || '分享页面',
      desc: shareDesc || document.querySelector('meta[name="description"]')?.content || '页面描述',
      link: shareLink || currentUrl,
      imgUrl: shareImgUrl || '/path/to/default-share-image.png',
      success: () => {
        console.log('分享给朋友成功');
      },
      fail: (err) => {
        console.error('分享给朋友失败:', err);
      }
    };
    
    console.log('配置分享选项:', shareOptions);
    
    wx.updateAppMessageShareData(shareOptions);
    
    // 分享到朋友圈
    wx.updateTimelineShareData({
      title: shareOptions.title,
      link: shareOptions.link,
      imgUrl: shareOptions.imgUrl,
      success: () => {
        console.log('分享到朋友圈配置成功');
      },
      fail: (err) => {
        console.error('分享到朋友圈配置失败:', err);
      }
    });
  }, [shareTitle, shareDesc, shareImgUrl, shareLink]);

  useEffect(() => {
    const configureWechatShare = async () => {
      if (isInMiniProgram) {
        console.log('在小程序中，不需要配置网页JSSDK');
        return;
      }
      
      if (!shareTitle && !shareDesc && !shareImgUrl) {
        // 尝试从页面元数据获取分享信息
        const defaultTitle = document.title;
        const defaultDesc = document.querySelector('meta[name="description"]')?.content;
        
        if (!defaultTitle && !defaultDesc) {
          console.log('页面未提供足够的分享信息，使用默认值');
        }
      }

      // 确保图片URL是完整的绝对路径
      const fullImgUrl = shareImgUrl?.startsWith('http') 
                        ? shareImgUrl 
                        : shareImgUrl
                          ? window.location.origin + shareImgUrl
                          : window.location.origin + '/path/to/default-share-image.png';
      
      // 确保分享链接是完整的URL
      const fullShareLink = shareLink || window.location.href;

      // 获取当前页面的完整URL，不包含hash部分
      const currentUrl = window.location.href.split('#')[0];

      console.log('开始配置微信分享...', {
        shareTitle: shareTitle || document.title || '分享页面',
        shareDesc: shareDesc || document.querySelector('meta[name="description"]')?.content || '页面描述',
        shareImgUrl: fullImgUrl,
        shareLink: fullShareLink,
        currentUrl: currentUrl // 记录用于签名的URL
      });

      try {
        console.log('正在获取JSSDK配置...');
        const configData = await axios.get(`${API_BASE_URL}/wechat/jssdk-config`, {
          params: { url: currentUrl }, // 使用不含hash的URL请求签名
        });

        console.log('获取到JSSDK配置数据:', configData.data);

        if (configData.data.success) {
          const config = configData.data.config;
          console.log('正在配置wx.config...', config);
          
          // 确保jsApiList包含所有需要使用的API
          if (!config.jsApiList) {
            config.jsApiList = [
              'updateAppMessageShareData', 
              'updateTimelineShareData', 
              'showOptionMenu',
              'onMenuShareAppMessage',
              'onMenuShareTimeline'
            ];
          }
          
          wx.config(config);

          // 添加checkJsApi调用
          wx.checkJsApi({
            jsApiList: [
              'updateAppMessageShareData', 
              'updateTimelineShareData', 
              'showOptionMenu',
              'onMenuShareAppMessage',
              'onMenuShareTimeline'
            ],
            success: (res) => {
              console.log('checkJsApi结果:', res);
            },
            fail: (err) => {
              console.error('checkJsApi失败:', err);
            }
          });

          wx.ready(() => {
            console.log('wx.ready被触发，开始设置分享数据...');
            // 显示分享按钮
            if (typeof wx.showOptionMenu === 'function') {
              wx.showOptionMenu();
            }
            
            const shareData = {
              title: shareTitle || document.title || '分享页面',
              desc: shareDesc || document.querySelector('meta[name="description"]')?.content || '页面描述',
              link: fullShareLink,
              imgUrl: fullImgUrl,
              success: () => {
                console.log('分享配置成功');
              },
              fail: (err) => {
                console.error('分享配置失败:', err);
              }
            };
            
            // 使用新版API
            wx.updateAppMessageShareData(shareData);
            wx.updateTimelineShareData({
              title: shareData.title,
              link: shareData.link,
              imgUrl: shareData.imgUrl,
              success: shareData.success,
              fail: shareData.fail
            });
            
            // 兼容旧版API
            wx.onMenuShareAppMessage && wx.onMenuShareAppMessage(shareData);
            wx.onMenuShareTimeline && wx.onMenuShareTimeline({
              title: shareData.title,
              link: shareData.link,
              imgUrl: shareData.imgUrl,
              success: shareData.success,
              fail: shareData.fail
            });
          });

          wx.error((err) => {
            console.error('JSSDK配置错误:', err);
          });
        } else {
          console.error('获取JSSDK配置失败:', configData.data.message);
        }
      } catch (error) {
        console.error('配置微信分享时发生错误:', error);
      }
    };

    configureWechatShare();
  }, [shareTitle, shareDesc, shareImgUrl, shareLink, isInMiniProgram]);

  useEffect(() => {
    const shareData = {
      shareTitle: shareTitle,
      shareDesc: shareDesc,
      shareImgUrl: shareImgUrl,
      shareLink: shareLink
    };

    if (!shareData) return;
    
    console.log('WechatShare组件收到新的分享数据:', shareData);
    
    // 使用MiniProgramTools设置分享数据
    if (MiniProgramTools && MiniProgramTools.isInMiniProgram()) {
      console.log('检测到小程序环境，使用MiniProgramTools设置分享数据');
      
      MiniProgramTools.setShareData({
        title: shareData.shareTitle,
        desc: shareData.shareDesc,
        imgUrl: shareData.shareImgUrl,
        url: shareData.shareLink || window.location.href
      });
      
      console.log('WechatShare: 已通过MiniProgramTools发送分享数据');
    } else {
      console.log('非小程序环境，使用常规方式设置分享数据');
      
      // 常规网页环境下，仍然保留原有的设置方式
      try {
        // 使用localStorage保存分享信息
        localStorage.setItem('currentTitle', shareData.shareTitle);
        localStorage.setItem('currentDesc', shareData.shareDesc);
        localStorage.setItem('currentImgUrl', shareData.shareImgUrl);
        localStorage.setItem('currentPageUrl', shareData.shareLink || window.location.href);
        
        console.log('WechatShare: 已保存分享数据到localStorage');
      } catch (e) {
        console.error('设置localStorage失败:', e);
      }
      
      // 尝试其他通信方式
      try {
        window.parent.postMessage({
          type: 'currentPage',
          title: shareData.shareTitle,
          desc: shareData.shareDesc,
          imgUrl: shareData.shareImgUrl,
          url: shareData.shareLink || window.location.href
        }, '*');
        
        console.log('WechatShare: 已通过postMessage发送分享数据');
      } catch (e) {
        console.error('postMessage失败:', e);
      }
    }
  }, [shareTitle, shareDesc, shareImgUrl, shareLink]);

  // 添加全局监听URL变化的函数
  useEffect(() => {
    // 监听并拦截所有的导航事件
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    
    window.history.pushState = function() {
      const result = originalPushState.apply(this, arguments);
      window.dispatchEvent(new Event('locationchange'));
      return result;
    };
    
    window.history.replaceState = function() {
      const result = originalReplaceState.apply(this, arguments);
      window.dispatchEvent(new Event('locationchange'));
      return result;
    };
    
    const handleLocationChange = () => {
      console.log('检测到location变化, 当前URL:', window.location.href);
      // 如果在小程序中，通知小程序
      if (window.wx && window.wx.miniProgram) {
        sendPageInfoToMiniProgram();
      }
    };
    
    window.addEventListener('locationchange', handleLocationChange);
    window.addEventListener('popstate', handleLocationChange);
    
    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('locationchange', handleLocationChange);
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, [sendPageInfoToMiniProgram]);

  return null;
};

export default WechatShare;