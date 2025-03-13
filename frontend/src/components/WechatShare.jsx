import React, { useEffect, useCallback } from 'react';
import wx from 'weixin-js-sdk';

const WechatShare = ({ shareTitle, shareDesc, shareImgUrl, shareLink }) => {
  // 向小程序发送分享数据
  const sendShareDataToMiniProgram = useCallback(() => {
    if (window.wx && window.wx.miniProgram) {
      const currentUrl = window.location.href;
      const title = shareTitle || document.title || '分享页面';
      const desc = shareDesc || document.querySelector('meta[name="description"]')?.content || '页面描述';
      
      // 确保图片URL是完整路径
      const hostname = window.location.hostname;
      const protocol = window.location.protocol;
      const imgHostPath = `${protocol}//${hostname}`;
      const fullImgUrl = shareImgUrl?.startsWith('http') 
                      ? shareImgUrl 
                      : shareImgUrl
                        ? imgHostPath + shareImgUrl
                        : imgHostPath + '/logo192.png';
      
      console.log('向小程序发送分享数据:', {
        title,
        desc,
        imgUrl: fullImgUrl,
        url: currentUrl
      });
      
      // 发送消息到小程序
      window.wx.miniProgram.postMessage({
        data: {
          type: 'currentPage',
          title: title,
          desc: desc,
          imgUrl: fullImgUrl,
          url: currentUrl
        }
      });
      
      // 通过 localStorage 同步状态
      try {
        localStorage.setItem('currentWebviewUrl', currentUrl);
        localStorage.setItem('currentTitle', title);
        localStorage.setItem('currentDesc', desc);
        localStorage.setItem('currentImgUrl', fullImgUrl);
      } catch (e) {
        console.error('无法使用 localStorage:', e);
      }
    }
  }, [shareTitle, shareDesc, shareImgUrl]);

  // 监听分享数据变化
  useEffect(() => {
    console.log('分享数据已更新，准备发送到小程序');
    sendShareDataToMiniProgram();
  }, [shareTitle, shareDesc, shareImgUrl, shareLink, sendShareDataToMiniProgram]);

  // 监听URL变化
  useEffect(() => {
    const handleUrlChange = () => {
      console.log('URL变化，更新分享数据');
      sendShareDataToMiniProgram();
    };

    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);

    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, [sendShareDataToMiniProgram]);

  // 组件不需要渲染任何内容
  return null;
};

export default WechatShare;