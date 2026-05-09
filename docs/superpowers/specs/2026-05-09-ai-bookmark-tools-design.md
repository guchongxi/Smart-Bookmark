# AI 书签操作工具设计

## 概述

让 newtab 中的 AI 面板支持浏览器书签的 CRUD 操作，通过 function calling（OpenAI）/ tool use（Anthropic）实现。AI 可以搜索、新建、删除、移动书签，Background script 作为执行层调用 `chrome.bookmarks` API。

## 架构

```
用户输入 → AiPanel → chat() (流式)
                         ↓
                   检测到 tool_call
                         ↓
                   累积参数完成
                         ↓
              chrome.runtime.sendMessage → background
                         ↓
              background 执行 chrome.bookmarks API
                         ↓
              结果回传 → 追加 tool_result 消息
                         ↓
              再次调用 chat() 继续流式生成
```

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/lib/ai.ts` | `chat()` 增加 `onToolCall` 回调，流式解析中检测 tool call delta |
| `src/lib/aiTools.ts` | **新建**，定义 5 个工具的 JSON Schema + 执行函数 |
| `src/background/index.ts` | 新增 `execute-bookmark-tool` 消息处理器 |
| `src/newtab/pages/AiPanel.tsx` | 处理 tool call 流程：检测 → 确认(如需) → 执行 → 回传 |
| `src/types/index.ts` | `AiMessage` 扩展 `tool_calls` / `tool_result` 字段 |

## 工具定义

### 查询类（直接执行，静默）

| 工具名 | 参数 | 说明 |
|--------|------|------|
| `search_bookmarks` | `query?: string, folder?: string, limit?: number` | 按关键词/文件夹搜索，返回匹配的书签列表 |
| `list_folders` | 无参数 | 返回文件夹树结构（id、名称、书签数） |

### 写入类（分级确认，显示结果摘要）

| 工具名 | 参数 | 确认方式 | 说明 |
|--------|------|----------|------|
| `create_bookmark` | `title: string, url: string, folderId?: string` | 直接执行 | 新建书签，可指定文件夹 |
| `delete_bookmark` | `bookmarkId: string` | 内联确认 | 删除指定书签 |
| `move_bookmark` | `bookmarkId: string, targetFolderId: string` | 内联确认 | 移动书签到目标文件夹 |

### 工具返回格式

```ts
{ success: boolean, message: string, data?: any }
```

## chat() 流式 tool call 处理

### 新增回调签名

```ts
onDelta: (text: string) => void;           // 文本片段（不变）
onToolCall: (call: ToolCallDelta) => void; // tool call 事件（新增）

interface ToolCallDelta {
  id: string;           // tool call id
  name?: string;        // 工具名（流式中逐步出现）
  arguments?: string;   // 参数片段（逐步累积）
  done?: boolean;       // 参数是否完整
}
```

### OpenAI 流式格式

```json
{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_xxx","function":{"name":"search_bookmarks","arguments":"{\"q"}}]}}]}
```

参数是逐步流出的 JSON 字符串片段，需要客户端累积拼接。

### Anthropic 流式格式

```json
{"type":"content_block_start","content_block":{"type":"tool_use","id":"toolu_xxx","name":"search_bookmarks"}}
{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\"q"}}
```

### 处理流程

1. 流式中检测到 `tool_calls` delta → 调用 `onToolCall({ id, name, arguments: chunk })`
2. 参数累积完整后 → `onToolCall({ id, done: true })`
3. AiPanel 收到 `done` → 暂停流 → 执行工具 → 把结果作为 `tool` 角色消息追加 → 再次调用 `chat()` 继续

## Background 消息协议

### 消息格式

```ts
// AiPanel → Background
{ type: "execute-bookmark-tool", tool: string, args: object }

// Background → AiPanel
{ ok: true, result: { success: boolean, message: string, data?: any } }
| { ok: false, error: string }
```

### 处理逻辑

- `search_bookmarks`：`chrome.bookmarks.search()` + 按文件夹过滤
- `list_folders`：`chrome.bookmarks.getTree()` + 提取文件夹结构
- `create_bookmark`：`chrome.bookmarks.create({ title, url, parentId })`
- `delete_bookmark`：`chrome.bookmarks.remove(bookmarkId)`
- `move_bookmark`：`chrome.bookmarks.move(bookmarkId, { parentId: targetFolderId })`

## 确认流程（内联确认）

AI 发出 `delete_bookmark` 或 `move_bookmark` tool call 时，不立即执行，在对话中渲染确认条：

```
┌─────────────────────────────────────────────┐
│  代理 想要执行：删除书签                       │
│                                              │
│  📌 GitHub - ML/AI Learning                  │
│     github.com/topics/machine-learning       │
│                                              │
│  [确认执行]  [取消]                           │
└─────────────────────────────────────────────┘
```

### 实现方式

1. AiPanel 检测到 `delete_bookmark` / `move_bookmark` 的 tool call done
2. 暂停 tool 执行，在消息列表中插入一条 `role: "tool-confirm"` 的特殊消息
3. 渲染确认条，附带工具名 + 参数摘要
4. 用户点"确认执行" → 执行工具 → 把结果作为 `tool` 消息追加 → 继续对话
5. 用户点"取消" → 插入一条 `role: "tool"` 消息（内容为"用户取消了操作"）→ 继续对话

`create_bookmark` 和查询类工具不需要确认，直接执行。

## 消息类型扩展

### AiMessage 扩展

```ts
interface AiMessage {
  role: "system" | "user" | "assistant" | "tool" | "tool-confirm";
  content: string;
  at?: number;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: object;
  }>;
  toolResult?: {
    toolCallId: string;
    success: boolean;
    message: string;
    data?: any;
  };
}
```

### 存储规则

- `system` — 不存储（每次动态注入）
- `tool-confirm` — 不存储，仅当前会话渲染；用户确认/取消后转为 `tool` 消息
- `tool` — 存入 IndexedDB 会话，刷新后可恢复；发给 API 时映射为 OpenAI/Anthropic 的 tool result 格式

### 结果展示

- 查询类（静默）：AI 自然语言回复，用户看不到工具调用
- 写入类（可见）：AI 回复中包含操作结果，如"已成功创建书签「xxx」"
- `tool-confirm` 消息：只在当前会话渲染，不持久化（刷新后无需再确认）
