# 移除 Sidepanel/悬浮球 + AI 思考内容 + Tool 扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 sidepanel 和悬浮球功能、新增 AI 思考内容展示、扩展 2 个书签工具。

**Architecture:** 三个独立任务，各自独立提交。Task 1-4 为移除 sidepanel+悬浮球，Task 5-8 为 AI 思考内容，Task 9-11 为 tool 扩展。

**Tech Stack:** TypeScript, React 18, Chrome Extension MV3, Vite, Tailwind CSS

---

## 文件结构

### 任务 1-4（移除 sidepanel + 悬浮球）

| 操作 | 文件 |
|------|------|
| 删除 | `src/sidepanel/`（App.tsx, main.tsx, index.html） |
| 删除 | `src/content/index.ts` |
| 修改 | `manifest.json` |
| 修改 | `src/background/index.ts` |
| 修改 | `src/popup/App.tsx` |
| 修改 | `vite.config.ts` |
| 修改 | `scripts/postbuild.mjs` |
| 修改 | `src/lib/i18n.ts` |
| 修改 | `src/types/index.ts`（移除 floatingBall/floatingDisabledDomains） |
| 修改 | `src/newtab/pages/Settings.tsx`（移除悬浮球开关） |
| 修改 | `CLAUDE.md`、`README.md`、`PRIVACY.md`、`STORE_LISTING.md` |

### 任务 5-8（AI 思考内容）

| 操作 | 文件 |
|------|------|
| 修改 | `src/types/index.ts`（AiMessage + Settings） |
| 修改 | `src/lib/ai.ts`（onThinking 回调 + 事件处理） |
| 修改 | `src/newtab/pages/AiPanel.tsx`（流式累加 + 折叠渲染） |
| 修改 | `src/newtab/pages/Settings.tsx`（showThinking 开关） |
| 修改 | `src/lib/i18n.ts`（新增 key） |

### 任务 9-11（Tool 扩展）

| 操作 | 文件 |
|------|------|
| 修改 | `src/lib/aiTools.ts`（新增 2 个工具定义 + 移除 QUERY_TOOLS） |
| 修改 | `src/background/index.ts`（新增 2 个 case） |

---

## Task 1: 删除 sidepanel 和 content 目录

**Files:**
- Delete: `src/sidepanel/App.tsx`
- Delete: `src/sidepanel/main.tsx`
- Delete: `src/sidepanel/index.html`
- Delete: `src/content/index.ts`

- [ ] **Step 1: 删除 sidepanel 目录**

```bash
trash src/sidepanel/
```

- [ ] **Step 2: 删除 content 目录**

```bash
trash src/content/
```

- [ ] **Step 3: 提交**

```bash
git add -u src/sidepanel/ src/content/
git commit -m "chore: remove sidepanel and content script directories"
```

---

## Task 2: 清理 manifest.json

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: 修改 manifest.json**

移除以下内容：
1. 删除 `"side_panel"` 配置块（第 29-31 行）
2. 删除 `"content_scripts"` 配置块（第 32-39 行）
3. 从 `permissions` 数组中删除 `"sidePanel"`
4. 从 `commands` 中删除 `"open-side-panel"` 和 `"toggle-float"`
5. 更新 `description` 移除"悬浮球"字样

修改后的 `manifest.json` 关键部分：

```json
{
  "description": "书签清理 + 新标签页看板 + AI 搜索 + 对比搜索 + 二维码，二合一浏览器扩展。Chrome / Edge 双平台。",
  "permissions": [
    "bookmarks",
    "storage",
    "contextMenus",
    "history",
    "topSites",
    "tabs",
    "scripting",
    "cookies"
  ],
  "commands": {
    "open-cleaner": {
      "suggested_key": {
        "default": "Alt+Shift+C"
      },
      "description": "打开书签清理中心"
    }
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add manifest.json
git commit -m "chore: remove sidepanel and floating ball from manifest"
```

---

## Task 3: 清理 background、popup、构建配置、i18n、types

**Files:**
- Modify: `src/background/index.ts`
- Modify: `src/popup/App.tsx`
- Modify: `vite.config.ts`
- Modify: `scripts/postbuild.mjs`
- Modify: `src/lib/i18n.ts`
- Modify: `src/types/index.ts`
- Modify: `src/newtab/pages/Settings.tsx`

- [ ] **Step 1: 修改 src/background/index.ts**

移除以下内容：

1. `MENU_IDS` 中删除 `OPEN_SIDEPANEL` 和 `TOGGLE_FLOAT`：

```typescript
const MENU_IDS = {
  SEARCH_BOOKMARKS: "sb-search-bookmarks",
  COPY_URL: "sb-copy-url",
  COPY_LINK: "sb-copy-link",
  QR_PAGE: "sb-qr-page",
  QR_LINK: "sb-qr-link",
  OPEN_CLEANER: "sb-open-cleaner",
} as const;
```

2. 删除 `SETTINGS_KEY` 常量（第 14 行）
3. 删除 `chrome.sidePanel?.setPanelBehavior?.()` 调用（第 19-22 行）
4. `setupContextMenus` 中删除 `OPEN_SIDEPANEL` 和 `TOGGLE_FLOAT` 菜单项创建
5. `contextMenus.onClicked` 中删除 `OPEN_SIDEPANEL` 和 `TOGGLE_FLOAT` case
6. `commands.onCommand` 中删除 `open-side-panel` 和 `toggle-float` case
7. `onMessage` 中删除 `open-sidepanel` 消息处理
8. 删除 `toggleFloatingBall` 函数

- [ ] **Step 2: 修改 src/popup/App.tsx**

1. 移除 `PanelRight` import
2. 删除 `openSidePanel` 函数
3. 删除「打开侧边栏」按钮（第 87-92 行）
4. 更新 `popup.shortcut` 文案（去掉 Alt+B 部分）

修改后的 popup 关键部分：

```tsx
import {
  Bookmark,
  Wand2,
  Sparkles,
  Columns,
  HardDriveDownload,
} from "lucide-react";
```

按钮列表中删除 sidepanel 那个 `<Item>`。

- [ ] **Step 3: 修改 vite.config.ts**

```typescript
input: {
  newtab: resolve(__dirname, "src/newtab/index.html"),
  popup: resolve(__dirname, "src/popup/index.html"),
  background: resolve(__dirname, "src/background/index.ts"),
},
output: {
  entryFileNames: (chunk) => {
    if (chunk.name === "background") return "background.js";
    return "assets/[name]-[hash].js";
  },
```

- [ ] **Step 4: 修改 scripts/postbuild.mjs**

第 55 行改为：

```javascript
for (const page of ["newtab", "popup"]) {
```

- [ ] **Step 5: 修改 src/lib/i18n.ts**

删除以下 key（zh 和 en 都删）：
- `float.openSidePanel`
- `float.openCleaner`
- `float.copyUrl`
- `float.qr`
- `float.hide`
- `float.search`
- `side.title`
- `side.placeholder`
- `side.empty`
- `popup.sidepanel`
- `popup.shortcut`
- `settings.floatingBall`
- `settings.floatingBallHint`
- `settings.floatingDisabledDomains`
- `settings.floatingDisabledDomainsEmpty`
- `settings.floatingDisabledDomainsRemove`

- [ ] **Step 6: 修改 src/types/index.ts**

从 `Settings` 接口中删除：
```typescript
floatingBall: boolean;
floatingDisabledDomains: string[];
```

- [ ] **Step 7: 修改 src/newtab/pages/Settings.tsx**

删除「悬浮球」和「已禁用网站」两个 Row（第 324-367 行）。删除 `Switch` 如果不再被使用。

- [ ] **Step 8: 提交**

```bash
git add src/background/index.ts src/popup/App.tsx vite.config.ts scripts/postbuild.mjs src/lib/i18n.ts src/types/index.ts src/newtab/pages/Settings.tsx
git commit -m "chore: clean up sidepanel and floating ball references"
```

---

## Task 4: 更新文档

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `PRIVACY.md`
- Modify: `STORE_LISTING.md`

- [ ] **Step 1: 修改 CLAUDE.md**

移除 sidepanel 和 content script 相关描述。更新 Architecture 部分：

```markdown
### 多入口 Vite 构建

三个独立入口，各有自己的 HTML 和 JS：

- `src/newtab/` → 新标签页（主 UI，8 个子页面通过 hash 路由切换）
- `src/popup/` → 扩展弹窗
- `src/background/index.ts` → Service Worker（书签 API、右键菜单、消息路由）
```

移除 AI 工具调用流程中 "create/delete/move 显示确认对话框" 的描述（这些工具不需要确认）。

- [ ] **Step 2: 修改 README.md**

移除 sidepanel 相关功能描述、目录结构中的 sidepanel 条目、悬浮球功能描述、Alt+B 快捷键说明。

- [ ] **Step 3: 修改 PRIVACY.md**

移除 `sidePanel` 权限行。

- [ ] **Step 4: 修改 STORE_LISTING.md**

移除 `sidePanel` 权限描述行。

- [ ] **Step 5: 提交**

```bash
git add CLAUDE.md README.md PRIVACY.md STORE_LISTING.md
git commit -m "docs: remove sidepanel and floating ball from documentation"
```

---

## Task 5: 扩展 AiMessage 和 Settings 类型

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: 修改 src/types/index.ts**

在 `AiMessage` 接口中添加 `thinking` 字段：

```typescript
export interface AiMessage {
  role: "system" | "user" | "assistant" | "tool" | "tool-confirm";
  content: string;
  /** 客户端消息时间戳（不发给 API） */
  at?: number;
  toolCalls?: AiToolCall[];
  toolResult?: AiToolResult;
  /** AI 思考过程文本 */
  thinking?: string;
}
```

在 `Settings` 接口中添加 `showThinking` 字段：

```typescript
export interface Settings {
  // ... 现有字段
  /** 是否启用 AI 思考内容展示 */
  showThinking?: boolean;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/types/index.ts
git commit -m "feat(ai): add thinking field to AiMessage and showThinking to Settings"
```

---

## Task 6: 扩展 chat() 流式层支持 thinking

**Files:**
- Modify: `src/lib/ai.ts`

- [ ] **Step 1: 修改 ChatOptions 接口**

```typescript
export interface ChatOptions {
  settings: Settings;
  messages: AiMessage[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onToolCall?: (call: ToolCallDelta) => void;
  onThinking?: (delta: string) => void;
  tools?: unknown[];
}
```

- [ ] **Step 2: 修改 chatAnthropic**

在 `chatAnthropic` 函数中：

1. 在请求体中条件性加入 thinking 参数（在 `body` 定义之后，`fetch` 之前）：

```typescript
if (settings.showThinking) {
  body.thinking = { type: "enabled", budget_tokens: 10000 };
}
```

2. 在 SSE 事件处理中，在现有 `content_block_delta` 处理之前新增 thinking 事件处理：

```typescript
// 处理 thinking 内容
if (j.type === "content_block_start" && j.content_block?.type === "thinking") {
  // 标记进入思考阶段，无需特殊处理
}

if (j.type === "content_block_delta" && j.delta?.type === "thinking_delta" && j.delta?.thinking) {
  onThinking?.(j.delta.thinking);
}

if (j.type === "content_block_start" && j.content_block?.type === "redacted_thinking") {
  // 加密的思考内容，跳过
}
```

- [ ] **Step 3: 修改 chatOpenAI**

在 `chatOpenAI` 函数的 SSE 事件处理中，在 `delta?.tool_calls` 处理之前新增：

```typescript
// 处理 reasoning content（o1/o3 系列）
const reasoning = delta?.reasoning_content;
if (reasoning && onThinking) {
  onThinking(reasoning);
}
```

- [ ] **Step 4: 提交**

```bash
git add src/lib/ai.ts
git commit -m "feat(ai): add onThinking callback to chat() for both providers"
```

---

## Task 7: AiPanel 流式累加和渲染思考内容

**Files:**
- Modify: `src/newtab/pages/AiPanel.tsx`

- [ ] **Step 1: 在 send() 中添加 thinking 累加器**

在 `send()` 函数的 streaming 逻辑中，新增 `thinkingAcc` 变量，并将 `onThinking` 传入 `chat()`：

在 `send()` 函数内，streaming 部分（`let acc = ""` 附近）添加：

```typescript
let thinkingAcc = "";
```

在 `chat()` 调用中添加 `onThinking` 参数：

```typescript
onThinking: settings.showThinking ? (delta) => {
  thinkingAcc += delta;
} : undefined,
```

在流式结束时（`const final = ...` 之后），将 thinking 写入消息：

```typescript
setMessages((prev) => {
  const next = [...prev];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === "assistant") {
      next[i] = { ...next[i], thinking: thinkingAcc || undefined };
      break;
    }
  }
  return next;
});
```

- [ ] **Step 2: 添加折叠思考内容渲染组件**

在 `AiPanel.tsx` 中，assistant 消息渲染部分（`renderMarkdown(m.content)` 之前），添加思考内容折叠块：

```tsx
{/* 思考过程折叠块 */}
{m.thinking && (
  <ThinkingBlock content={m.thinking} />
)}
```

在文件底部（或组件外部）添加 `ThinkingBlock` 组件：

```tsx
function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 rounded-lg border border-muted bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition hover:bg-muted/50"
      >
        <svg
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        思考过程
      </button>
      {open && (
        <div className="border-t border-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground" style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
          {content}
        </div>
      )}
    </div>
  );
}
```

需要在文件顶部 import `useState`（如果尚未导入）。

- [ ] **Step 3: 提交**

```bash
git add src/newtab/pages/AiPanel.tsx
git commit -m "feat(ai): display thinking content with collapsible block"
```

---

## Task 8: Settings 页面添加 showThinking 开关 + i18n

**Files:**
- Modify: `src/newtab/pages/Settings.tsx`
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: 修改 src/lib/i18n.ts**

在 `zh` 字典中添加：

```typescript
"settings.showThinking": "显示思考过程",
"settings.showThinkingHint": "开启后，AI 回复上方会显示模型的思考过程（需模型支持 extended thinking）。",
```

在 `en` 字典中添加：

```typescript
"settings.showThinking": "Show thinking process",
"settings.showThinkingHint": "When enabled, the model's thinking process is shown above the reply (requires extended thinking support).",
```

- [ ] **Step 2: 修改 src/newtab/pages/Settings.tsx**

在 AI 助手设置区域（`settings.ai` Card）的 `CardContent` 中，在 `apiKeyNotice` 之前添加：

```tsx
<Row label={t("settings.showThinking")}>
  <div className="flex items-center gap-3">
    <Switch
      checked={s.showThinking ?? false}
      onCheckedChange={(v) => update({ showThinking: v })}
    />
    <span className="text-xs text-muted-foreground">
      {t("settings.showThinkingHint")}
    </span>
  </div>
</Row>
```

- [ ] **Step 3: 提交**

```bash
git add src/newtab/pages/Settings.tsx src/lib/i18n.ts
git commit -m "feat(ai): add showThinking toggle to settings page"
```

---

## Task 9: 新增 update_bookmark 和 create_folder 工具定义

**Files:**
- Modify: `src/lib/aiTools.ts`

- [ ] **Step 1: 在 BOOKMARK_TOOLS_OPENAI 数组末尾追加两个工具**

在 `move_bookmark` 工具定义之后，`];` 之前追加：

```typescript
  {
    type: "function" as const,
    function: {
      name: "update_bookmark",
      description: "修改书签的标题或 URL",
      parameters: {
        type: "object",
        properties: {
          bookmarkId: { type: "string", description: "要修改的书签 ID" },
          title: { type: "string", description: "新标题（可选）" },
          url: { type: "string", description: "新 URL（可选）" },
        },
        required: ["bookmarkId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_folder",
      description: "创建新的书签文件夹",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "文件夹名称" },
          parentId: { type: "string", description: "父文件夹 ID（可选，默认根目录）" },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
```

- [ ] **Step 2: 移除 QUERY_TOOLS 常量**

删除第 98-99 行：

```typescript
/** 查询类工具（静默执行） */
export const QUERY_TOOLS = new Set(["search_bookmarks", "list_folders"]);
```

- [ ] **Step 3: 提交**

```bash
git add src/lib/aiTools.ts
git commit -m "feat(ai): add update_bookmark and create_folder tool definitions"
```

---

## Task 10: Background 新增工具执行逻辑

**Files:**
- Modify: `src/background/index.ts`

- [ ] **Step 1: 在 executeBookmarkTool switch 中新增两个 case**

在 `move_bookmark` case 之后，`default` 之前追加：

```typescript
    case "update_bookmark": {
      const bookmarkId = String(args.bookmarkId ?? "");
      const title = args.title != null ? String(args.title) : undefined;
      const url = args.url != null ? String(args.url) : undefined;
      if (!bookmarkId) return { success: false, message: "缺少 bookmarkId" };
      if (!title && !url) return { success: false, message: "至少提供 title 或 url" };
      return new Promise((resolve) => {
        const updateOpts: Record<string, string> = {};
        if (title) updateOpts.title = title;
        if (url) updateOpts.url = url;
        chrome.bookmarks.update(bookmarkId, updateOpts, (node) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, message: chrome.runtime.lastError.message ?? "更新失败" });
          } else {
            resolve({
              success: true,
              message: `书签已更新`,
              data: { id: node.id, title: node.title, url: node.url },
            });
          }
        });
      });
    }
    case "create_folder": {
      const title = String(args.title ?? "");
      const parentId = args.parentId ? String(args.parentId) : undefined;
      if (!title) return { success: false, message: "缺少 title" };
      return new Promise((resolve) => {
        const createOpts: chrome.bookmarks.BookmarkCreateArg = { title };
        if (parentId) createOpts.parentId = parentId;
        chrome.bookmarks.create(createOpts, (node) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, message: chrome.runtime.lastError.message ?? "创建失败" });
          } else {
            resolve({
              success: true,
              message: `文件夹已创建「${title}」`,
              data: { id: node.id, title: node.title },
            });
          }
        });
      });
    }
```

- [ ] **Step 2: 提交**

```bash
git add src/background/index.ts
git commit -m "feat(ai): implement update_bookmark and create_folder execution"
```

---

## Task 11: 构建验证

- [ ] **Step 1: 运行 typecheck**

```bash
npm run typecheck
```

Expected: 无错误

- [ ] **Step 2: 运行 build**

```bash
npm run build
```

Expected: 构建成功，dist/ 中无 sidepanel.html 和 content.js

- [ ] **Step 3: 验证 dist 内容**

```bash
ls dist/
```

Expected: 无 `sidepanel.html`、无 `content.js`

- [ ] **Step 4: 提交 dist**

```bash
git add dist/
git commit -m "chore: rebuild dist after removal and new features"
```
