const {
  drawSignatureDot,
  drawSignatureSegment,
  getTouchPoint
} = require('../../utils/signature');

Page({
  data: {
    canvasWidth: 667,
    canvasHeight: 300
  },

  onLoad() {
    this.ctx = wx.createCanvasContext('signaturePad', this);
    this.lastPoint = null;
    this.touched = false;
    this.updateCanvasSize();
  },

  onReady() {
    this.clearCanvas();
  },

  onResize() {
    this.updateCanvasSize();
    this.clearCanvas();
  },

  updateCanvasSize() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const toolbarHeight = 24;
    const guideHeight = 56;
    const screenWidth = info.screenWidth || info.windowWidth || 667;
    const screenHeight = info.screenHeight || info.windowHeight || 375;
    const longSide = Math.max(screenWidth, screenHeight);
    const shortSide = Math.min(screenWidth, screenHeight);
    this.setData({
      canvasWidth: longSide,
      canvasHeight: Math.max(180, shortSide - toolbarHeight - guideHeight)
    });
  },

  clearCanvas() {
    if (!this.ctx) return;
    this.ctx.setFillStyle('#ffffff');
    this.ctx.fillRect(0, 0, this.data.canvasWidth, this.data.canvasHeight);
    this.ctx.draw();
    this.lastPoint = null;
    this.touched = false;
  },

  touchStart(event) {
    const point = getTouchPoint(event);
    if (!point) return;
    this.lastPoint = point;
    this.touched = true;
    drawSignatureDot(this.ctx, point, { lineWidth: 5 });
  },

  touchMove(event) {
    const point = getTouchPoint(event);
    if (!point) return;
    if (this.lastPoint) {
      drawSignatureSegment(this.ctx, this.lastPoint, point, { lineWidth: 5 });
    } else {
      drawSignatureDot(this.ctx, point, { lineWidth: 5 });
    }
    this.lastPoint = point;
  },

  touchEnd() {
    this.lastPoint = null;
  },

  clearSignature() {
    this.clearCanvas();
  },

  cancel() {
    wx.navigateBack();
  },

  confirm() {
    if (!this.touched) {
      wx.showToast({ title: '请先签名', icon: 'none' });
      return;
    }
    wx.canvasToTempFilePath({
      canvasId: 'signaturePad',
      x: 0,
      y: 0,
      width: this.data.canvasWidth,
      height: this.data.canvasHeight,
      destWidth: this.data.canvasWidth * 2,
      destHeight: this.data.canvasHeight * 2,
      fileType: 'png',
      success: (res) => {
        const pages = getCurrentPages();
        const previousPage = pages[pages.length - 2];
        if (previousPage) {
          previousPage.setData({
            signaturePreview: res.tempFilePath,
            hasSignature: true
          });
        }
        wx.navigateBack();
      },
      fail: () => wx.showToast({ title: '签名保存失败', icon: 'none' })
    }, this);
  }
});
