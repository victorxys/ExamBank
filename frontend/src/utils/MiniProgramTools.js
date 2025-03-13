/**
 * 微信小程序通信工具类
 * 提供前端与微信小程序WebView之间的通信功能
 */

class MiniProgramTools {
  constructor() {
    this.isInitialized = false;
    this.init();
  }

  /**
   * 初始化工具类
   */
  init() {
    if (this.isInitialized) return;
    
    console.log('[MiniProgramTools] 初始化...');
    
    // 检测是否在小程序WebView环境中
    this._inMiniProgram = this._checkIsInMiniProgram();
    
    // 自动全局注册
    if (typeof window !== 'undefined') {
      window.MiniProgramTools = this;
      console.log('[MiniProgramTools] 已注册到全局 window.MiniProgramTools');
    }
    
    this.isInitialized = true;
  }

  /**
   * 检查是否在小程序WebView中
   * @returns {boolean} 是否在小程序环境
   */
  _checkIsInMiniProgram() {
    if (typeof window === 'undefined') return false;
    
    // 方法1: 通过UA检测
    const ua = navigator.userAgent.toLowerCase();
    const isMiniProgram = ua.indexOf('miniprogram') > -1 || ua.indexOf('micromessenger') > -1;
    
    // 方法2: 通过window.wx检测
    const hasWxAPI = typeof window.wx !== 'undefined' && typeof window.wx.miniProgram !== 'undefined';
    
    // 方法3: 查找特定的localStorage标记
    let hasLocalStorageFlag = false;
    try {
      hasLocalStorageFlag = localStorage.getItem('__wxjs_environment') === 'miniprogram';
    } catch (e) {
      console.warn('[MiniProgramTools] 无法访问localStorage', e);
    }
    
    const result = isMiniProgram || hasWxAPI || hasLocalStorageFlag;
    console.log('[MiniProgramTools] 环境检测结果:', {
      isMiniProgram: result,
      ua,
      hasWxAPI,
      hasLocalStorageFlag
    });
    
    return result;
  }

  /**
   * 判断是否在小程序环境中
   * @returns {boolean} 是否在小程序环境
   */
  isInMiniProgram() {
    // 每次调用重新检测，避免初始化时判断错误
    this._inMiniProgram = this._checkIsInMiniProgram();
    return this._inMiniProgram;
  }

  /**
   * 向小程序发送导航请求
   * @param {string} url 目标URL
   */
  navigate(url) {
    if (!url) {
      console.error('[MiniProgramTools] 导航URL不能为空');
      return;
    }
    
    console.log('[MiniProgramTools] 发送导航请求:', url);
    
    try {
      // 方法1: 使用wx.miniProgram API
      if (window.wx && window.wx.miniProgram) {
        window.wx.miniProgram.navigateTo({ url: `/pages/webview/webview?url=${encodeURIComponent(url)}` });
        console.log('[MiniProgramTools] 通过wx.miniProgram API发送导航请求');
      }
      
      // 方法2: 通过postMessage向小程序发送消息
      window.parent.postMessage({
        type: 'navigate',
        url
      }, '*');
      console.log('[MiniProgramTools] 通过postMessage发送导航请求');
      
      // 方法3: 向当前window发送消息 (以支持消息监听器)
      window.postMessage({
        type: 'navigate',
        url
      }, '*');
      
      // 方法4: 使用localStorage传递信息
      try {
        localStorage.setItem('navigateToUrl', url);
        localStorage.setItem('navigateTime', String(Date.now()));
        console.log('[MiniProgramTools] 通过localStorage发送导航请求');
      } catch (e) {
        console.error('[MiniProgramTools] localStorage设置失败:', e);
      }
      
      return true;
    } catch (e) {
      console.error('[MiniProgramTools] 导航请求发送失败:', e);
      return false;
    }
  }

  /**
   * 向小程序发送分享数据
   * @param {Object} shareData 分享数据对象
   * @param {string} shareData.title 分享标题
   * @param {string} shareData.desc 分享描述
   * @param {string} shareData.imgUrl 分享图片URL
   * @param {string} shareData.url 分享链接URL
   */
  setShareData(shareData) {
    if (!shareData) {
      console.error('[MiniProgramTools] 分享数据不能为空');
      return;
    }
    
    console.log('[MiniProgramTools] 设置分享数据:', shareData);
    
    try {
      // 方法1: 使用localStorage
      try {
        localStorage.setItem('currentTitle', shareData.title || '');
        localStorage.setItem('currentDesc', shareData.desc || '');
        localStorage.setItem('currentImgUrl', shareData.imgUrl || '');
        localStorage.setItem('currentPageUrl', shareData.url || window.location.href);
        console.log('[MiniProgramTools] 通过localStorage设置分享数据');
      } catch (e) {
        console.error('[MiniProgramTools] localStorage设置失败:', e);
      }
      
      // 方法2: 通过postMessage向小程序发送消息
      window.parent.postMessage({
        type: 'currentPage',
        title: shareData.title,
        desc: shareData.desc,
        imgUrl: shareData.imgUrl,
        url: shareData.url || window.location.href
      }, '*');
      console.log('[MiniProgramTools] 通过postMessage设置分享数据');
      
      // 方法3: 使用wx.miniProgram API
      if (window.wx && window.wx.miniProgram) {
        window.wx.miniProgram.postMessage({
          data: {
            type: 'currentPage',
            title: shareData.title,
            desc: shareData.desc,
            imgUrl: shareData.imgUrl,
            url: shareData.url || window.location.href
          }
        });
        console.log('[MiniProgramTools] 通过wx.miniProgram API设置分享数据');
      }
      
      return true;
    } catch (e) {
      console.error('[MiniProgramTools] 设置分享数据失败:', e);
      return false;
    }
  }

  /**
   * 强制刷新分享数据
   * 当页面内容变化但URL不变时使用
   */
  refreshShareData() {
    try {
      // 获取当前已设置的分享数据
      const title = localStorage.getItem('currentTitle');
      const desc = localStorage.getItem('currentDesc');
      const imgUrl = localStorage.getItem('currentImgUrl');
      const url = localStorage.getItem('currentPageUrl') || window.location.href;
      
      if (title && desc) {
        // 重新设置分享时间戳以触发更新
        localStorage.setItem('shareDataTimestamp', String(Date.now()));
        
        // 重新发送消息
        window.parent.postMessage({
          type: 'currentPage',
          title,
          desc,
          imgUrl,
          url,
          timestamp: Date.now()
        }, '*');
        
        console.log('[MiniProgramTools] 已刷新分享数据');
        return true;
      }
    } catch (e) {
      console.error('[MiniProgramTools] 刷新分享数据失败:', e);
    }
    
    return false;
  }
}

// 创建全局实例
const miniProgramTools = new MiniProgramTools();

export default miniProgramTools;
