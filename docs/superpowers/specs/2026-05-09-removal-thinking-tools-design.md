# 设计文档：移除 Sidepanel + 思考内容显示 + Tool 扩展

> 三个独立任务的设计规格，各自独立实现。

---

## 任务 1：移除 Sidepanel + 悬浮球

### 目标

完全移除 sidepanel 侧边栏功能和悬浮球（floating ball）功能，精简扩展。

### 删除清单

**目录删除：**
- `src/sidepanel/`（App.tsx、main.tsx、index.html）
- `src/content/`（index.ts，悬浮球注入逻辑）

**manifest.json 变更：**
- 移除 `side_panel` 配置项
- 移除 `permissions` 中的 `sidePanel`
- 移除 `commands` 中的 `open-side-panel` 和 `toggle-float`
- 移除 `content_scripts` 配置

**background/index.ts 变更：**
- 移除 `MENU_IDS.OPEN_SIDEPANEL` 和 `MENU_IDS.TOGGLE_FLOAT`
- 移除 `chrome.sidePanel?.setPanelBehavior?.()` 调用
- 移除 `setupContextMenus` 中的 `OPEN_SIDEPANEL` 和 `TOGGLE_FLOAT` 菜单项
- 移除 `contextMenus.onClicked` 中的 `OPEN_SIDEPANEL` 和 `TOGGLE_FLOAT` 处理
- 移除 `commands.onCommand` 中的 `open-side-panel` 和 `toggle-float` 处理
- 移除 `onMessage` 中的 `open-sidepanel` 消息处理
- 移除 `toggleFloatingBall` 函数
- 移除 `SETTINGS_KEY` 常量（仅被 toggleFloatingBall 使用）

**popup/App.tsx 变更：**
- 移除 `openSidePanel` 函数
- 移除「打开侧边栏」按钮

**构建配置变更：**
- `vite.config.ts`：移除 sidepanel entry
- `scripts/postbuild.mjs`：从页面列表中移除 sidepanel

**i18n 变更（src/lib/i18n.ts）：**
- 移除 `float.openSidePanel`（zh + en）
- 移除 `popup.sidepanel`（zh + en）

**文档更新：**
- `CLAUDE.md`：移除 sidepanel 和 content script 相关描述
- `README.md`：移除 sidepanel 相关功能描述和目录结构
- `PRIVACY.md`：移除 sidePanel 权限说明
- `STORE_LISTING.md`：移除 sidePanel 权限描述

---

## 任务 2：AI 思考内容展示

### 目标

在 AI 对话中展示模型的思考过程（reasoning/thinking），折叠显示，用户可展开查看。

### 类型扩展

**src/types/index.ts：**

```typescript
export interface AiMessage {
  role: "system" | "user" | "assistant" | "tool" | "tool-confirm";
  content: string;
  at?: number;
  toolCalls?: AiToolCall[];
  toolResult?: AiToolResult;
  thinking?: string;  // 新增：思考过程文本
}
```

### 设置项

**Settings 类型扩展：**

```typescript
showThinking?: boolean;  // 是否启用思考内容展示
```

在 Settings 页面 AI 助手区域新增「显示思考过程」开关（默认关闭）。

### 流式层变更（src/lib/ai.ts）

**ChatOptions 扩展：**

```typescript
export interface ChatOptions {
  // ... 现有字段
  onThinking?: (delta: string) => void;
}
```

**chatAnthropic 变更：**

在 SSE 事件处理中新增：
- `content_block_start` + `content_block.type === "thinking"`：标记进入思考阶段
- `content_block_delta` + `delta.type === "thinking_delta"`：调用 `onThinking(delta.thinking)`
- `content_block_start` + `content_block.type === "redacted_thinking"`：跳过（加密内容）
- `content_block_stop`：标记思考完成

请求体条件性加入：
```typescript
if (settings.showThinking) {
  body.thinking = { type: "enabled", budget_tokens: 10000 };
}
```

**chatOpenAI 变更：**

在 delta 处理中新增：
- `delta.reasoning_content` 存在时：调用 `onThinking(delta.reasoning_content)`

### UI 层变更（src/newtab/pages/AiPanel.tsx）

**流式状态：**
- 新增 `thinkingAcc` 累加器
- `onThinking` 回调累加思考文本
- 流式结束时将 `thinkingAcc` 写入 assistant 消息的 `thinking` 字段

**渲染：**
- assistant 消息如有 `thinking` 字段，在回复内容上方显示折叠块
- 默认折叠，点击展开
- 思考内容用等宽字体渲染
- 折叠时显示「思考过程」标题 + 展开图标

**可见性过滤：**
- 无需修改，assistant 消息已通过过滤

### 持久化

`thinking` 字段为可选 string，随 AiMessage 序列化存入 IndexedDB，无需 schema 迁移。

---

## 任务 3：Tool 扩展 — 新增 2 个工具

### 目标

新增 `update_bookmark` 和 `create_folder` 两个工具，同时清理 dead code。

### 新增工具定义（src/lib/aiTools.ts）

**update_bookmark：**

```typescript
{
  name: "update_bookmark",
  description: "修改书签的标题或 URL",
  parameters: {
    bookmarkId: { type: "string", description: "书签 ID" },
    title: { type: "string", description: "新标题（可选）" },
    url: { type: "string", description: "新 URL（可选）" },
  }
}
```

- OpenAI 格式：`type: "function"`
- Anthropic 格式：`type: "object"` + `input_schema`
- `additionalProperties: false`

**create_folder：**

```typescript
{
  name: "create_folder",
  description: "创建新的书签文件夹",
  parameters: {
    title: { type: "string", description: "文件夹名称" },
    parentId: { type: "string", description: "父文件夹 ID（可选，默认根目录）" },
  }
}
```

- 同上格式要求

### Background 执行器变更（src/background/index.ts）

在 `executeBookmarkTool` switch 中新增：

**`update_bookmark`：**
- 参数校验：`bookmarkId` 必填，`title` 和 `url` 至少一个
- 调用：`chrome.bookmarks.update(bookmarkId, { title?, url? })`
- 错误处理：`chrome.runtime.lastError` 检查
- 返回：`{ success, message: "书签已更新", data: { id, title, url } }`

**`create_folder`：**
- 参数校验：`title` 必填
- 调用：`chrome.bookmarks.create({ title, parentId? })`
- 错误处理：`chrome.runtime.lastError` 检查
- 返回：`{ success, message: "文件夹已创建「{title}」", data: { id, title } }`

### 确认策略

两个工具都不需要确认，直接执行。

### AiPanel 变更（src/newtab/pages/AiPanel.tsx）

- `handleToolCallDone`：新增 `create_folder` 到直接执行路径（无需确认）
- `buildToolConfirmSummary`：无需修改（新工具不在 CONFIRM_REQUIRED_TOOLS 中）

### 清理

- 移除 `QUERY_TOOLS` 常量（dead code，从未使用）
