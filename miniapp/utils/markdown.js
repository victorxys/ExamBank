const styles = {
  strong: 'font-weight:800;color:#111827;',
  h1: 'display:block;margin:20rpx 0 14rpx;color:#0f172a;font-weight:800;font-size:34rpx;line-height:1.5;',
  h2: 'display:block;margin:20rpx 0 14rpx;color:#0f172a;font-weight:800;font-size:31rpx;line-height:1.5;',
  h3: 'display:block;margin:20rpx 0 14rpx;color:#0f172a;font-weight:800;font-size:29rpx;line-height:1.5;',
  p: 'display:block;margin:18rpx 0;color:#475569;font-size:27rpx;line-height:1.85;',
  muted: 'display:block;margin:18rpx 0;color:#94a3b8;font-size:27rpx;line-height:1.85;',
  ol: 'display:block;margin:16rpx 0;padding-left:42rpx;',
  li: 'display:list-item;margin:10rpx 0;color:#475569;font-size:27rpx;line-height:1.8;',
  img: 'display:block;max-width:100%;margin:18rpx 0;border-radius:8rpx;'
};

function textNode(text, bold = false) {
  return {
    name: 'span',
    attrs: bold ? { class: 'md-strong', style: styles.strong } : {},
    children: [{ type: 'text', text }]
  };
}

function parseInline(text) {
  const nodes = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(textNode(text.slice(lastIndex, match.index)));
    }
    nodes.push(textNode(match[1], true));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(textNode(text.slice(lastIndex)));
  }

  return nodes.length ? nodes : [textNode(text)];
}

function parseParagraph(lines) {
  const nodes = [];
  lines.forEach((line, index) => {
    if (index > 0) {
      nodes.push({ name: 'br' });
    }
    nodes.push(...parseInline(line));
  });
  return nodes.length ? nodes : [textNode('')];
}

function blockNode(name, className, text) {
  const styleKey = className.includes('muted') ? 'muted' : className.replace('md-', '');
  return {
    name,
    attrs: { class: className, style: styles[styleKey] || '' },
    children: parseInline(text)
  };
}

function listNode(items) {
  return {
    name: 'ol',
    attrs: { class: 'md-ol', style: styles.ol },
    children: items.map((item) => ({
      name: 'li',
      attrs: { class: 'md-li', style: styles.li },
      children: parseInline(item)
    }))
  };
}

function imageNode(alt, src) {
  const api = require('./api');
  return {
    name: 'img',
    attrs: {
      alt,
      src: api.assetUrl(src),
      style: styles.img
    }
  };
}

function markdownToNodes(markdown) {
  const source = String(markdown || '').replace(/\r\n/g, '\n').trim();
  if (!source) {
    return [blockNode('p', 'md-p muted', '暂无正文内容。')];
  }

  const nodes = [];
  const lines = source.split('\n');
  let paragraph = [];
  let listItems = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    nodes.push({
      name: 'p',
      attrs: { class: 'md-p', style: styles.p },
      children: parseParagraph(paragraph)
    });
    paragraph = [];
  }

  function flushList() {
    if (!listItems.length) return;
    nodes.push(listNode(listItems));
    listItems = [];
  }

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      return;
    }

    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      flushParagraph();
      flushList();
      nodes.push(imageNode(image[1], image[2]));
      return;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length, 3);
      nodes.push(blockNode(`h${level}`, `md-h${level}`, heading[2]));
      return;
    }

    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      listItems.push(ordered[1]);
      return;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      listItems.push(unordered[1]);
      return;
    }

    flushList();
    paragraph.push(line);
  });

  flushParagraph();
  flushList();

  return nodes;
}

module.exports = {
  markdownToNodes
};
