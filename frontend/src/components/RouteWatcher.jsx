import React, { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import WechatShare from './WechatShare';

/**
 * RouteWatcher 组件用于监听路由变化，
 * 并根据当前路由自动配置微信分享
 */
const RouteWatcher = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const lastPathRef = useRef(location.pathname);
  const [pageInfo, setPageInfo] = useState({
    title: document.title || '员工介绍平台',
    desc: document.querySelector('meta[name="description"]')?.content || '员工介绍与管理系统',
    imgUrl: window.location.origin + '/logo.svg', // 可访问的默认分享图片，确保此文件存在
    link: window.location.href
  });

  // 获取路由中的用户ID (如果存在)
  const getUserIdFromPath = (path) => {
    const matches = path.match(/\/([^\/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    return matches ? matches[2] : null;
  };

  // 向小程序发送页面信息
  const sendPageInfoToMiniProgram = (info) => {
    if (window.wx && window.wx.miniProgram) {
      const messageData = {
        type: 'routeChange',
        url: info.link || window.location.href,
        title: info.title || document.title,
        desc: info.desc || document.querySelector('meta[name="description"]')?.content,
        imgUrl: info.imgUrl || window.location.origin + '/logo.svg'
      };
      
      console.log('RouteWatcher: 向小程序发送页面信息:', messageData);
      
      // 发送消息到小程序
      window.wx.miniProgram.postMessage({
        data: messageData
      });
      
      return true;
    }
    return false;
  };

  // 监听路由变化，更新分享信息
  useEffect(() => {
    console.log('路由变化:', location.pathname, '之前路径:', lastPathRef.current);
    const userId = getUserIdFromPath(location.pathname);
    console.log('获取到的用户ID:', userId);
    // 根据不同路由设置不同的分享信息
    let newTitle = document.title || '萌星库';
    let newDesc = document.querySelector('meta[name="description"]')?.content || '萌姨萌嫂萌星库';
    let newImgUrl = window.location.origin + '/logo.svg';
    
    // 判断当前路由，设置对应的分享信息
    if (location.pathname.includes('/employee-profile/')) {
      const userId = getUserIdFromPath(location.pathname);
      console.log('获取到的用户ID:', userId);
      newTitle = `员工详细介绍 : ${userId || '萌星'}`;
      newDesc = '查看员工的详细介绍、专业技能和项目经验!';
      newImgUrl = `${window.location.origin}/avatar/${userId}-avatar.jpg`;
    } else if (location.pathname.includes('/users')) {
      newTitle = '员工管理';
      newDesc = '浏览和管理所有员工信息';
    } else if (location.pathname.includes('/user-evaluation/')) {
      const userId = getUserIdFromPath(location.pathname);
      newTitle = `员工评价 - ID: ${userId || ''}`;
      newDesc = '查看和提交员工评价信息';
    } else if (location.pathname.includes('/user-evaluation-summary/')) {
      const userId = getUserIdFromPath(location.pathname);
      newTitle = `员工评价总结 - ID: ${userId || ''}`;
      newDesc = '员工评价汇总与分析';
    } else if (location.pathname.includes('/evaluation-management')) {
      newTitle = '评价管理';
      newDesc = '管理员工评价系统';
    } else if (location.pathname.includes('/client-evaluation/')) {
      const userId = getUserIdFromPath(location.pathname);
      newTitle = `客户评价 - ID: ${userId || ''}`;
      newDesc = '提交您对员工的评价和反馈';
    }
    
    // 检查是否在微信环境中
    const isWechatBrowser = /MicroMessenger/i.test(navigator.userAgent);
    const isInMiniProgram = window.wx && window.wx.miniProgram;
    
    // 优先使用真实的分享图片URL
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    const imgHostPath = `${protocol}//${hostname}`;
    const fullImgUrl = newImgUrl.startsWith('http') 
                      ? newImgUrl 
                      : `${imgHostPath}${newImgUrl}`;
    
    // 更新分享信息
    const newPageInfo = {
      title: newTitle,
      desc: newDesc,
      imgUrl: fullImgUrl,
      link: window.location.href
    };
    console.log('更新分享信息:', newPageInfo);
    
    setPageInfo(newPageInfo);
    
    // 通知小程序当前页面信息（如果在小程序WebView中）
    if (isInMiniProgram) {
      sendPageInfoToMiniProgram(newPageInfo);
    }
    
    // 如果在微信浏览器中但不在小程序中，可以添加微信环境特定处理
    if (isWechatBrowser && !isInMiniProgram) {
      console.log('在微信浏览器中，非小程序环境');
      // 可以添加微信浏览器特定的处理逻辑
    }
  }, [location.pathname, location.search]);
  
  // 定期检查并同步URL（解决某些情况下路由变化没被检测到的问题）
  useEffect(() => {
    const intervalId = setInterval(() => {
      const currentFullUrl = window.location.href;
      
      // 如果当前URL与分享链接不同，发送更新
      if (currentFullUrl !== pageInfo.link && window.wx && window.wx.miniProgram) {
        console.log('定期检查: 检测到URL变化，从', pageInfo.link, '到', currentFullUrl);
        
        const updatedInfo = {
          ...pageInfo,
          link: currentFullUrl
        };
        
        // 更新状态
        setPageInfo(updatedInfo);
        
        // 向小程序发送更新
        sendPageInfoToMiniProgram(updatedInfo);
      }
    }, 2000); // 每2秒检查一次
    
    return () => clearInterval(intervalId);
  }, [pageInfo]);
  
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
