import React, { useEffect } from 'react';
import wx from 'weixin-js-sdk';
import axios from 'axios';

const WechatShare = ({ shareTitle, shareDesc, shareImgUrl, shareLink }) => {
  useEffect(() => {
    const configureWechatShare = async () => {
      try {
        const configData = await axios.get('/api/wechat/jssdk-config', {
          params: { url: shareLink || window.location.href },
        });

        if (configData.data.success) {
          const config = configData.data.config;
          wx.config(config);

          wx.ready(() => {
            wx.updateAppMessageShareData({
              title: shareTitle,
              desc: shareDesc,
              link: shareLink || window.location.href,
              imgUrl: shareImgUrl,
              success: () => {
                console.log('分享给朋友成功');
              },
            });

            wx.updateTimelineShareData({
              title: shareTitle,
              link: shareLink || window.location.href,
              imgUrl: shareImgUrl,
              success: () => {
                console.log('分享到朋友圈成功');
              },
            });
          });

          wx.error((err) => {
            console.error('JSSDK config error:', err);
          });
        } else {
          console.error('Failed to fetch JSSDK config:', configData.data.message);
        }
      } catch (error) {
        console.error('Error fetching JSSDK config:', error);
      }
    };

    configureWechatShare();
  }, [shareTitle, shareDesc, shareImgUrl, shareLink]); // 依赖项变化时重新配置

  return <></>; // 此组件不渲染任何 видимый DOM 元素
};

export default WechatShare;