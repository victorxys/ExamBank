const DEFAULT_COLOR = '#111827';
const DEFAULT_LINE_WIDTH = 4;
const MAX_SEGMENT_LENGTH = 4;

function getTouchPoint(event) {
  const touch = (event.touches && event.touches[0])
    || (event.changedTouches && event.changedTouches[0]);
  if (!touch) return null;
  return {
    x: Number(touch.x || 0),
    y: Number(touch.y || 0)
  };
}

function setupSignatureContext(ctx, options = {}) {
  ctx.setStrokeStyle(options.color || DEFAULT_COLOR);
  ctx.setFillStyle(options.color || DEFAULT_COLOR);
  ctx.setLineWidth(options.lineWidth || DEFAULT_LINE_WIDTH);
  ctx.setLineCap('round');
  ctx.setLineJoin('round');
}

function drawSignatureDot(ctx, point, options = {}) {
  if (!ctx || !point) return;
  setupSignatureContext(ctx, options);
  const radius = (options.lineWidth || DEFAULT_LINE_WIDTH) / 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.draw(true);
}

function drawSignatureSegment(ctx, from, to, options = {}) {
  if (!ctx || !from || !to) return;
  setupSignatureContext(ctx, options);

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance < 0.5) {
    drawSignatureDot(ctx, to, options);
    return;
  }

  const stepLength = options.maxSegmentLength || MAX_SEGMENT_LENGTH;
  const steps = Math.max(1, Math.ceil(distance / stepLength));
  let previous = from;
  for (let index = 1; index <= steps; index += 1) {
    const current = {
      x: from.x + (dx * index) / steps,
      y: from.y + (dy * index) / steps
    };
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();
    previous = current;
  }
  ctx.draw(true);
}

module.exports = {
  getTouchPoint,
  setupSignatureContext,
  drawSignatureDot,
  drawSignatureSegment
};
