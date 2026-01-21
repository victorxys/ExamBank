# 前端句子编辑功能参考代码

本文档提供了完整的前端句子编辑功能实现，供其他系统参考集成。

## 核心组件架构

### 1. DocumentEditor 组件 (主编辑器)
负责文档级别的管理和句子列表展示。

**主要功能**:
- 文档加载和状态管理
- 批量音频生成
- 音频合并和导出
- 句子搜索和过滤

### 2. SentenceItem 组件 (单句编辑器)
负责单个句子的编辑和TTS生成。

**主要功能**:
- 文本编辑 (支持SSML)
- 音频生成和播放
- 状态显示和错误处理
- SSML模式切换

### 3. SSMLToolbar 组件 (SSML工具栏)
提供SSML标签的可视化编辑工具。

**主要功能**:
- SSML标签快速插入
- 拼音注音选择
- 韵律参数调整
- 停顿时长设置

## 关键代码实现

### 句子编辑核心逻辑

```typescript
// 文本变更处理 - 实时更新
const handleTextChange = async (sentenceId: number, newText: string) => {
  // 乐观更新UI
  setSentences(prev => prev.map(s => 
    s.id === sentenceId ? { ...s, current_text: newText } : s
  ));

  try {
    // 异步保存到后端
    await api.updateSentence(sentenceId, { current_text: newText });
  } catch (err) {
    console.error('Failed to update sentence:', err);
  }
};

// 音频生成处理
const handleGenerate = async (sentenceId: number) => {
  // 更新状态为处理中
  setSentences(prev => prev.map(s => 
    s.id === sentenceId ? { ...s, status: 'processing' } : s
  ));

  try {
    const updated = await api.generateSentenceAudio(sentenceId);
    setSentences(prev => prev.map(s => s.id === sentenceId ? updated : s));
  } catch (err: any) {
    setSentences(prev => prev.map(s => 
      s.id === sentenceId ? { ...s, status: 'failed', error_message: err.message } : s
    ));
  }
};
```

### SSML编辑功能

```typescript
// SSML标签定义
const SSML_TAGS: SSMLTag[] = [
  {
    id: 'break',
    label: '停顿',
    icon: <Pause className="w-3 h-3" />,
    insert: () => '<break time="500ms"/>',
    description: '插入停顿'
  },
  {
    id: 'telephone',
    label: '电话',
    icon: <Phone className="w-3 h-3" />,
    insert: (text) => text ? `<say-as interpret-as="telephone">${text}</say-as>` : '<say-as interpret-as="telephone">号码</say-as>',
    description: '电话号码读法'
  },
  // ... 更多标签
];

// 标签插入逻辑
const handleTagClick = (tag: SSMLTag) => {
  const textarea = textareaRef.current;
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = text.substring(start, end);

  const insertText = tag.insert(selectedText);
  
  const newText = text.substring(0, start) + insertText + text.substring(end);
  onTextChange(newText);

  // 恢复光标位置
  setTimeout(() => {
    textarea.focus();
    const newPos = start + insertText.length;
    textarea.setSelectionRange(newPos, newPos);
  }, 0);
};
```

### 拼音注音功能

```typescript
// 获取汉字的所有可能读音
const getPinyinOptions = (char: string): string[] => {
  if (!char || !/[\u4e00-\u9fa5]/.test(char)) {
    return [];
  }
  
  const result = pinyin(char, { 
    toneType: 'num',
    multiple: true,
    type: 'array'
  });
  
  return [...new Set(result)];
};

// 注音处理
const handlePhonemeClick = () => {
  const textarea = textareaRef.current;
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = text.substring(start, end);

  if (!selectedText) {
    alert('请先选择要注音的文字');
    return;
  }

  // 获取每个字符的拼音选项
  const options: PinyinOption[] = [];
  const initialSelected: Record<number, string> = {};
  
  for (let i = 0; i < selectedText.length; i++) {
    const char = selectedText[i];
    const pinyins = getPinyinOptions(char);
    
    if (pinyins.length > 0) {
      options.push({ char, pinyins });
      initialSelected[i] = pinyins[0];
    }
  }

  setPinyinOptions(options);
  setSelectedPinyins(initialSelected);
  setShowPinyinPicker(true);
};
```

## API接口规范

### 句子更新接口
```typescript
// PUT /api/sentences/{id}
interface UpdateSentenceRequest {
  current_text?: string;
  status?: string;
}

interface SentenceResponse {
  id: number;
  document_id: number;
  order_index: number;
  original_text: string;
  current_text: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message?: string;
  audio_url?: string;
  created_at: string;
  updated_at: string;
}
```

### TTS生成接口
```typescript
// POST /api/tts/generate/{sentence_id}
interface GenerateAudioResponse {
  id: number;
  current_text: string;
  status: 'completed' | 'failed';
  audio_url?: string;
  error_message?: string;
}
```

## 状态管理

### 句子状态枚举
```typescript
export enum Status {
  PENDING = 'PENDING',      // 待生成
  PROCESSING = 'PROCESSING', // 生成中
  COMPLETED = 'COMPLETED',   // 已完成
  FAILED = 'FAILED',        // 生成失败
}
```

### 状态样式映射
```typescript
const getStatusColor = () => {
  switch (sentence.status) {
    case Status.COMPLETED: return 'border-l-4 border-l-green-500';
    case Status.FAILED: return 'border-l-4 border-l-red-500';
    case Status.PROCESSING: return 'border-l-4 border-l-blue-500';
    default: return 'border-l-4 border-l-slate-200';
  }
};
```

## UI组件样式

### 句子编辑器样式
```css
/* 句子容器 */
.sentence-item {
  @apply bg-white rounded-md shadow-sm border border-slate-200 transition-all;
}

/* SSML模式文本框 */
.ssml-textarea {
  @apply w-full p-2 text-sm border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none bg-slate-50 min-h-[80px] rounded-b font-mono text-xs;
}

/* 工具栏按钮 */
.toolbar-button {
  @apply flex items-center gap-1 px-2 py-1 text-[10px] bg-white border border-slate-200 rounded hover:bg-slate-100 hover:border-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed;
}
```

### 状态指示器
```typescript
// 状态按钮组件
const StatusButton = ({ status, onClick, children }) => {
  const baseClasses = "flex items-center justify-center gap-2 w-full py-2 text-xs font-medium rounded transition-colors";
  
  const statusClasses = {
    [Status.PENDING]: "bg-indigo-600 hover:bg-indigo-700 text-white",
    [Status.PROCESSING]: "bg-blue-100 text-blue-700 cursor-wait",
    [Status.COMPLETED]: "bg-green-100 hover:bg-green-200 text-green-700",
    [Status.FAILED]: "bg-red-100 hover:bg-red-200 text-red-700"
  };

  return (
    <button 
      className={`${baseClasses} ${statusClasses[status]}`}
      onClick={onClick}
      disabled={status === Status.PROCESSING}
    >
      {children}
    </button>
  );
};
```

## 集成指南

### 1. 依赖安装
```bash
npm install lucide-react pinyin-pro
```

### 2. 基础集成
```typescript
import { DocumentEditor } from './components/DocumentEditor';
import { SentenceItem } from './components/SentenceItem';
import { SSMLToolbar } from './components/SSMLToolbar';

// 在你的应用中使用
function App() {
  return (
    <DocumentEditor 
      documentId={documentId}
      onDocumentUpdate={(doc) => console.log('Document updated:', doc)}
    />
  );
}
```

### 3. 自定义配置
```typescript
// 自定义SSML标签
const customSSMLTags = [
  {
    id: 'emphasis',
    label: '强调',
    icon: <Bold className="w-3 h-3" />,
    insert: (text) => `<emphasis level="strong">${text}</emphasis>`,
    description: '强调语气'
  }
];

// 自定义API端点
const customAPI = {
  baseUrl: 'https://your-api.com/api',
  // ... 其他配置
};
```

## 最佳实践

### 1. 性能优化
- 使用 `useCallback` 和 `useMemo` 优化渲染
- 实现虚拟滚动处理大量句子
- 防抖处理文本输入更新

### 2. 用户体验
- 乐观更新提升响应速度
- 错误状态清晰展示
- 支持键盘快捷键操作

### 3. 可访问性
- 适当的 ARIA 标签
- 键盘导航支持
- 屏幕阅读器兼容

### 4. 错误处理
- 网络错误重试机制
- 用户友好的错误提示
- 状态恢复功能

## 扩展功能

### 1. 批量操作
```typescript
// 批量选择句子
const [selectedSentences, setSelectedSentences] = useState<Set<number>>(new Set());

// 批量应用SSML
const applyBatchSSML = (tag: string) => {
  selectedSentences.forEach(id => {
    // 应用SSML标签到选中的句子
  });
};
```

### 2. 历史记录
```typescript
// 文本编辑历史
const [editHistory, setEditHistory] = useState<EditHistory[]>([]);

// 撤销/重做功能
const undo = () => {
  // 实现撤销逻辑
};
```

### 3. 实时协作
```typescript
// WebSocket连接
const ws = new WebSocket('ws://localhost:8080/collaborate');

// 实时同步编辑
ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  // 处理其他用户的编辑
};
```

这个参考文档提供了完整的前端句子编辑功能实现，其他系统可以根据自己的需求进行适配和扩展。