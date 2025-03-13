import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import WechatShare from './WechatShare';

/**
 * RouteWatcher 组件用于监听路由变化，
 * 并根据当前路由自动配置微信分享
 */
const RouteWatcher = () => {
  const location = useLocation();
  const [pageInfo, setPageInfo] = useState({
    title: document.title,
    desc: document.querySelector('meta[name="description"]')?.content || '员工介绍平台',
    imgUrl: '/path/to/default-share-image.png', // 替换为您的默认分享图片
    link: window.location.href
  });

  // 监听路由变化，更新分享信息
  useEffect(() => {
    console.log('路由变化:', location.pathname);
    
    // 根据不同路由设置不同的分享信息
    let newTitle = document.title;
    let newDesc = document.querySelector('meta[name="description"]')?.content || '员工介绍平台';
    let newImgUrl = '/path/to/default-share-image.png';
    
    // 判断当前路由，设置对应的分享信息
    if (location.pathname.includes('/employee-profile/')) {
      const userId = location.pathname.split('/').pop();
      newTitle = `员工详细介绍 - ID: ${userId}`;
      newDesc = '查看员工的详细介绍、专业技能和项目经验';
    } else if (location.pathname.includes('/users')) {
      newTitle = '员工管理';
      newDesc = '浏览和管理所有员工信息';
    } else if (location.pathname.includes('/user-evaluation/')) {
      newTitle = '员工评价';
      newDesc = '查看和提交员工评价信息';
    }
    
    // 检查是否在微信环境中
    const isWechatBrowser = /MicroMessenger/i.test(navigator.userAgent);
    
    // 更新分享信息
    setPageInfo({
      title: newTitle,
      desc: newDesc,
      imgUrl: newImgUrl,
      link: window.location.href
    });
    
    // 通知小程序当前页面信息（如果在小程序WebView中）
    if (window.wx && window.wx.miniProgram) {
      window.wx.miniProgram.postMessage({
        data: {
          type: 'routeChange',
          url: window.location.href,
          title: newTitle,
          desc: newDesc,
          imgUrl: newImgUrl
        }
      });
    }
    
    // 如果在微信浏览器中，添加微信环境特定处理
    if (isWechatBrowser) {
      // 可以在这里添加微信环境特定的处理逻辑
    }
  }, [location]);
  
  // 使用 WechatShare 组件进行微信分享配置
  return (
    <WechatShare 
      shareTitle={pageInfo.title}
      shareDesc={pageInfo.desc}
      shareImgUrl={pageInfo.imgUrl}
      shareLink={pageInfo.link}
    />
  );
};

export default RouteWatcher;
