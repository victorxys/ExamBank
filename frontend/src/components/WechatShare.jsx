import React, { useEffect, useCallback } from 'react';
import wx from 'weixin-js-sdk';
import axios from 'axios';
import { API_BASE_URL } from '../config';

const WechatShare = ({ shareTitle, shareDesc, shareImgUrl, shareLink }) => {

  const handleShareToFriend = useCallback(() => {
    // 主动触发分享界面
    if (typeof wx.showOptionMenu === 'function') {
      wx.showOptionMenu();
    }
    wx.updateAppMessageShareData({
      title: shareTitle,
      desc: shareDesc,
      link: shareLink || window.location.href,
      imgUrl: shareImgUrl,
      success: () => {
        console.log('分享给朋友成功');
      },
      fail: (err) => {
        console.error('分享给朋友失败:', err);
      }
    });
  }, [shareTitle, shareDesc, shareImgUrl, shareLink]);


  useEffect(() => {
    const configureWechatShare = async () => {
      if (!shareTitle || !shareDesc || !shareImgUrl) {
        console.error('分享参数不完整');
        return;
      }

      // 确保图片URL是完整的绝对路径
      const fullImgUrl = shareImgUrl.startsWith('http') ? shareImgUrl : 
                        window.location.origin + shareImgUrl;
      
      // 确保分享链接是完整的URL
      const fullShareLink = shareLink || window.location.href;

      console.log('开始配置微信分享...', {
        shareTitle,
        shareDesc,
        shareImgUrl: fullImgUrl,
        shareLink: fullShareLink
      });

      try {
        console.log('正在获取JSSDK配置...');
        const configData = await axios.get(`${API_BASE_URL}/wechat/jssdk-config`, {
          params: { url: fullShareLink },
        });

        console.log('获取到JSSDK配置数据:', configData.data);

        if (configData.data.success) {
          const config = configData.data.config;
          console.log('正在配置wx.config...', config);
          wx.config(config);

          // 添加checkJsApi调用
          wx.checkJsApi({
            jsApiList: ['updateAppMessageShareData', 'updateTimelineShareData', 'showOptionMenu'],
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
            wx.updateAppMessageShareData({
              title: shareTitle,
              desc: shareDesc,
              link: fullShareLink,
              imgUrl: fullImgUrl,
              success: () => {
                console.log('分享给朋友配置成功，参数:', {
                  title: shareTitle,
                  desc: shareDesc,
                  link: fullShareLink,
                  imgUrl: fullImgUrl
                });
              },
              fail: (err) => {
                console.error('分享给朋友配置失败:', err);
              }
            });

            wx.updateTimelineShareData({
              title: shareTitle,
              link: fullShareLink,
              imgUrl: fullImgUrl,
              success: () => {
                console.log('分享到朋友圈配置成功，参数:', {
                  title: shareTitle,
                  link: fullShareLink,
                  imgUrl: fullImgUrl
                });
              },
              fail: (err) => {
                console.error('分享到朋友圈配置失败:', err);
              }
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
  }, [shareTitle, shareDesc, shareImgUrl, shareLink]);

  return <></>;
};

export default WechatShare;