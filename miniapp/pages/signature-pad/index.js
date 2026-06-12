const {
  drawSignatureDot,
  drawSignatureSegment
} = require('../../utils/signature');

const DEFAULT_WIDTH = 667;
const DEFAULT_HEIGHT = 375;
const TOOLBAR_HEIGHT = 38;
const GUIDE_HEIGHT = 30;
const ACTION_BAR_HEIGHT = 56;
const MIN_CANVAS_HEIGHT = 180;
const LINE_WIDTH = 4;

function firstNumber(...values) {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value !== undefined && value !== null && value !== '') {
      const number = Number(value);
      if (!Number.isNaN(number)) return number;
    }
  }
  return 0;
}

function isInsideCanvas(point, width, height) {
  return Boolean(point)
    && point.x >= 0
    && point.y >= 0
    && point.x <= width
    && point.y <= height;
}

Page({
  data: {
    isPortrait: false,
    viewportWidth: DEFAULT_WIDTH,
    viewportHeight: DEFAULT_HEIGHT,
    panelWidth: DEFAULT_WIDTH,
    panelHeight: DEFAULT_HEIGHT,
    canvasWidth: DEFAULT_WIDTH,
    canvasHeight: DEFAULT_HEIGHT - TOOLBAR_HEIGHT - GUIDE_HEIGHT,
    canvasWrapHeight: DEFAULT_HEIGHT - TOOLBAR_HEIGHT,
    toolbarHeight: TOOLBAR_HEIGHT,
    toolbarSafeRight: 10,
    guideHeight: GUIDE_HEIGHT,
    actionBarHeight: ACTION_BAR_HEIGHT,
    panelStyle: ''
  },

  onLoad() {
    this.ctx = wx.createCanvasContext('signaturePad', this);
    this.canvasReady = false;
    this.lastPoint = null;
    this.touched = false;
    this.updateCanvasSize();
  },

  onReady() {
    this.canvasReady = true;
    this.clearCanvas();
  },

  onResize() {
    this.updateCanvasSize(true);
  },

  updateCanvasSize(shouldClear = false) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const viewportWidth = Math.round(info.windowWidth || info.screenWidth || DEFAULT_WIDTH);
    const viewportHeight = Math.round(info.windowHeight || info.screenHeight || DEFAULT_HEIGHT);
    const screenWidth = Math.round(info.screenWidth || viewportWidth);
    const screenHeight = Math.round(info.screenHeight || viewportHeight);
    const panelWidth = Math.max(viewportWidth, viewportHeight, screenWidth, screenHeight);
    const panelHeight = Math.min(viewportWidth, viewportHeight);
    const isPortrait = false;
    let toolbarSafeRight = 10;
    if (wx.getMenuButtonBoundingClientRect) {
      try {
        const menuButton = wx.getMenuButtonBoundingClientRect();
        const menuLeft = Math.round(menuButton.left || panelWidth);
        if (menuLeft > panelWidth * 0.55) {
          toolbarSafeRight = Math.max(10, panelWidth - menuLeft + 10);
        }
      } catch (error) {
        toolbarSafeRight = 10;
      }
    }
    const canvasWidth = panelWidth;
    const canvasHeight = Math.max(MIN_CANVAS_HEIGHT, panelHeight - TOOLBAR_HEIGHT - GUIDE_HEIGHT - ACTION_BAR_HEIGHT);
    const panelStyle = [
      `width: ${panelWidth}px`,
      `height: ${panelHeight}px`,
      'left: 0',
      'top: 0',
      'transform: none'
    ].join('; ');

    this.setData({
      isPortrait,
      viewportWidth,
      viewportHeight,
      panelWidth,
      panelHeight,
      canvasWidth,
      canvasHeight,
      canvasWrapHeight: canvasHeight + GUIDE_HEIGHT,
      toolbarHeight: TOOLBAR_HEIGHT,
      toolbarSafeRight,
      guideHeight: GUIDE_HEIGHT,
      actionBarHeight: ACTION_BAR_HEIGHT,
      panelStyle
    }, () => {
      if (shouldClear && this.canvasReady) this.clearCanvas();
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

  getCanvasPoint(event) {
    const touch = (event.touches && event.touches[0])
      || (event.changedTouches && event.changedTouches[0]);
    if (!touch) return null;

    const hasCanvasPoint = touch.x !== undefined && touch.y !== undefined;
    const hasScreenPoint = touch.clientX !== undefined
      || touch.clientY !== undefined
      || touch.pageX !== undefined
      || touch.pageY !== undefined;
    const screenX = firstNumber(touch.clientX, touch.pageX);
    const screenY = firstNumber(touch.clientY, touch.pageY);
    const {
      toolbarHeight,
      canvasWidth,
      canvasHeight
    } = this.data;
    const canvasPoint = hasCanvasPoint
      ? { x: firstNumber(touch.x), y: firstNumber(touch.y) }
      : null;
    const screenPoint = hasScreenPoint
      ? {
        x: screenX,
        y: screenY - toolbarHeight
      }
      : null;
    if (
      hasCanvasPoint
      && hasScreenPoint
      && Math.abs(firstNumber(touch.x) - screenX) <= 1
      && Math.abs(firstNumber(touch.y) - screenY) <= 1
      && isInsideCanvas(screenPoint, canvasWidth, canvasHeight)
    ) {
      return screenPoint;
    }
    if (isInsideCanvas(canvasPoint, canvasWidth, canvasHeight)) return canvasPoint;
    if (isInsideCanvas(screenPoint, canvasWidth, canvasHeight)) return screenPoint;
    return null;
  },

  touchStart(event) {
    const point = this.getCanvasPoint(event);
    if (!point) return;
    this.lastPoint = point;
    this.touched = true;
    drawSignatureDot(this.ctx, point, { lineWidth: LINE_WIDTH });
  },

  touchMove(event) {
    const point = this.getCanvasPoint(event);
    if (!point) {
      this.lastPoint = null;
      return;
    }
    if (this.lastPoint) {
      drawSignatureSegment(this.ctx, this.lastPoint, point, { lineWidth: LINE_WIDTH });
    } else {
      drawSignatureDot(this.ctx, point, { lineWidth: LINE_WIDTH });
    }
    this.lastPoint = point;
  },

  touchEnd() {
    this.lastPoint = null;
  },

  clearSignature() {
    this.clearCanvas();
  },

  stopPageTouch() {},

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
