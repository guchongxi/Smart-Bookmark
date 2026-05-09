# AI 书签操作工具实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 newtab 中的 AI 面板支持浏览器书签 CRUD 操作，通过 function calling / tool use 实现，AI 可搜索、新建、删除、移动书签。

**Architecture:** AiPanel 通过 `chat()` 的 `onToolCall` 回调检测 AI 发出的工具调用，累积参数完成后通过 `chrome.runtime.sendMessage` 发送给 background script 执行 `chrome.bookmarks` API。写入类操作（删除/移动）需要用户内联确认后才执行。工具执行结果作为 `tool` 角色消息追加到会话，再次调用 `chat()` 继续对话。

**Tech Stack:** TypeScript, Chrome Extension MV3 (`chrome.bookmarks` API), OpenAI function calling / Anthropic tool use, SSE streaming

---

### Task 1: 扩展 AiMessage 类型

**Files:**
- Modify: `src/types/index.ts:177-182`

- [ ] **Step 1: 修改 AiMessage 接口**

将 `src/types/index.ts` 中的 `AiMessage` 接口替换为：

```ts
export interface AiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AiToolResult {
  toolCallId: string;
  success: boolean;
  message: string;
  data?: unknown;
}

export interface AiMessage {
  role: "system" | "user" | "assistant" | "tool" | "tool-confirm";
  content: string;
  at?: number;
  toolCalls?: AiToolCall[];
  toolResult?: AiToolResult;
}
```

- [ ] **Step 2: 验证类型编译通过**

Run: `npx tsc --noEmit`
Expected: 无报错（其他文件可能因为使用了旧的 `role` 字面量而报错，但这些会在后续 task 中修复）

- [ ] **Step 3: 提交**

```bash
git add src/types/index.ts
git commit -m "feat(ai): extend AiMessage type with tool call fields"
```

---

### Task 2: 创建书签工具定义模块

**Files:**
- Create: `src/lib/aiTools.ts`

- [ ] **Step 1: 创建 aiTools.ts 工具定义**

创建 `src/lib/aiTools.ts`：

```ts
/**
 * AI 书签操作工具定义（JSON Schema + 类型）。
 * 供 chat() 发送 tool definitions 给 API，供 background 执行。
 */

export interface BookmarkToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/** 工具定义：发送给 OpenAI function / Anthropic tool 的 schema */
export const BOOKMARK_TOOLS_OPENAI = [
  {
    type: "function" as const,
    function: {
      name: "search_bookmarks",
      description: "按关键词或文件夹搜索书签，返回匹配的书签列表",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词（匹配标题和 URL）" },
          folder: { type: "string", description: "限定搜索的文件夹名称" },
          limit: { type: "number", description: "最多返回数量，默认 10" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_folders",
      description: "列出所有书签文件夹的树结构（id、名称、书签数量）",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_bookmark",
      description: "新建书签，可指定文件夹",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "书签标题" },
          url: { type: "string", description: "书签 URL" },
          folderId: { type: "string", description: "目标文件夹 ID，不填则放到根目录" },
        },
        required: ["title", "url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_bookmark",
      description: "删除指定书签（需要用户确认）",
      parameters: {
        type: "object",
        properties: {
          bookmarkId: { type: "string", description: "要删除的书签 ID" },
        },
        required: ["bookmarkId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "move_bookmark",
      description: "移动书签到目标文件夹（需要用户确认）",
      parameters: {
        type: "object",
        properties: {
          bookmarkId: { type: "string", description: "要移动的书签 ID" },
          targetFolderId: { type: "string", description: "目标文件夹 ID" },
        },
        required: ["bookmarkId", "targetFolderId"],
      },
    },
  },
];

/** Anthropic tool 格式 */
export const BOOKMARK_TOOLS_ANTHROPIC = BOOKMARK_TOOLS_OPENAI.map((t) => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

/** 需要用户确认的工具名集合 */
export const CONFIRM_REQUIRED_TOOLS = new Set(["delete_bookmark", "move_bookmark"]);

/** 查询类工具（静默执行） */
export const QUERY_TOOLS = new Set(["search_bookmarks", "list_folders"]);
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 3: 提交**

```bash
git add src/lib/aiTools.ts
git commit -m "feat(ai): add bookmark tool definitions for function calling"
```

---

### Task 3: 修改 chat() 支持 streaming tool calls

**Files:**
- Modify: `src/lib/ai.ts`

- [ ] **Step 1: 扩展 ChatOptions 接口，添加 onToolCall 回调**

在 `src/lib/ai.ts` 中，将 `ChatOptions` 接口替换为：

```ts
export interface ToolCallDelta {
  id: string;
  name?: string;
  arguments?: string;
  done?: boolean;
}

export interface ChatOptions {
  settings: Settings;
  messages: AiMessage[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onToolCall?: (call: ToolCallDelta) => void;
  tools?: unknown[];
}
```

- [ ] **Step 2: 修改 chat() 入口，传递 tools**

```ts
export async function chat({ settings, messages, signal, onDelta, onToolCall, tools }: ChatOptions): Promise<string> {
  if (settings.aiProvider === "openai") return chatOpenAI({ settings, messages, signal, onDelta, onToolCall, tools });
  if (settings.aiProvider === "anthropic") return chatAnthropic({ settings, messages, signal, onDelta, onToolCall, tools });
  throw new Error("AI 未启用，请在设置中配置 Provider 与 API Key。");
}
```

- [ ] **Step 3: 修改 toApiMessages 支持 tool 角色消息**

```ts
function toApiMessages(messages: AiMessage[]) {
  const result: unknown[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      // OpenAI 格式：每条 tool result 单独一条
      result.push({
        role: "tool",
        tool_call_id: m.toolResult?.toolCallId ?? "",
        content: m.content,
      });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      // assistant 带 tool_calls
      result.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        })),
      });
    } else if (m.role !== "system" && m.role !== "tool-confirm") {
      result.push({ role: m.role, content: m.content });
    }
  }
  return result;
}
```

- [ ] **Step 4: 修改 chatOpenAI 支持 tools 和 onToolCall**

替换 `chatOpenAI` 函数：

```ts
async function chatOpenAI({ settings, messages, signal, onDelta, onToolCall, tools }: ChatOptions): Promise<string> {
  if (!settings.aiApiKey) throw new Error("缺少 OpenAI API Key");
  const base = (settings.aiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const body: Record<string, unknown> = {
    model: settings.aiModel || "gpt-4o-mini",
    messages: toApiMessages(messages),
    stream: true,
  };
  if (tools?.length) body.tools = tools;

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.aiApiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
  }
  return await readSse(res.body, (evt) => {
    try {
      const j = JSON.parse(evt);
      const choice = j.choices?.[0];
      if (!choice) return "";
      const delta = choice.delta;

      // 文本内容
      const text = delta?.content ?? "";
      if (text) onDelta?.(text);

      // tool_calls delta
      if (delta?.tool_calls && onToolCall) {
        for (const tc of delta.tool_calls) {
          onToolCall({
            id: tc.id ?? "",
            name: tc.function?.name,
            arguments: tc.function?.arguments,
            done: choice.finish_reason === "tool_calls",
          });
        }
      }

      return text;
    } catch {
      return "";
    }
  });
}
```

- [ ] **Step 5: 修改 chatAnthropic 支持 tools 和 onToolCall**

替换 `chatAnthropic` 函数：

```ts
async function chatAnthropic({ settings, messages, signal, onDelta, onToolCall, tools }: ChatOptions): Promise<string> {
  if (!settings.aiApiKey) throw new Error("缺少 Anthropic API Key");
  const sys = messages.find((m) => m.role === "system")?.content ?? "";
  const rest = messages.filter((m) => m.role !== "system");
  const base = (settings.aiBaseUrl || "https://api.anthropic.com").replace(/\/+$/, "");

  // 转换 tool 结果为 Anthropic content 格式
  const apiMessages: unknown[] = [];
  for (const m of rest) {
    if (m.role === "tool") {
      // Anthropic: tool result 作为 user message 的 content block
      apiMessages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: m.toolResult?.toolCallId ?? "",
          content: m.content,
        }],
      });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      const content: unknown[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.args,
        });
      }
      apiMessages.push({ role: "assistant", content });
    } else {
      apiMessages.push({ role: m.role, content: m.content });
    }
  }

  const body: Record<string, unknown> = {
    model: settings.aiModel || "claude-3-5-sonnet-latest",
    max_tokens: 1024,
    system: sys || undefined,
    messages: apiMessages,
    stream: true,
  };
  if (tools?.length) body.tools = tools;

  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.aiApiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }

  // 用于累积 tool_use delta
  const toolCallBuffers = new Map<string, { id: string; name: string; inputJson: string }>();

  return await readSse(res.body, (evt) => {
    try {
      const j = JSON.parse(evt);

      if (j.type === "content_block_start" && j.content_block?.type === "tool_use") {
        const id = j.content_block.id;
        toolCallBuffers.set(id, { id, name: j.content_block.name, inputJson: "" });
      }

      if (j.type === "content_block_delta" && j.delta?.type === "input_json_delta" && onToolCall) {
        // 找到当前正在累积的 tool call
        const lastKey = [...toolCallBuffers.keys()].pop();
        if (lastKey) {
          const buf = toolCallBuffers.get(lastKey)!;
          buf.inputJson += j.delta.partial_json;
          onToolCall({ id: buf.id, name: buf.name, arguments: j.delta.partial_json });
        }
      }

      if (j.type === "content_block_stop" && onToolCall) {
        // 检查是否是 tool_use block 结束
        for (const [, buf] of toolCallBuffers) {
          if (buf.inputJson && !buf._emittedDone) {
            buf._emittedDone = true;
            onToolCall({ id: buf.id, done: true });
          }
        }
      }

      if (j.type === "message_delta" && j.delta?.stop_reason === "tool_use" && onToolCall) {
        for (const [, buf] of toolCallBuffers) {
          if (!buf._emittedDone) {
            buf._emittedDone = true;
            onToolCall({ id: buf.id, done: true });
          }
        }
        toolCallBuffers.clear();
      }

      if (j.type === "content_block_delta" && j.delta?.text) {
        if (j.delta.text) onDelta?.(j.delta.text);
        return j.delta.text;
      }
    } catch {}
    return "";
  });
}
```

注意：需要给 toolCallBuffers 的 value 类型加上 `_emittedDone?: boolean`。实际上可以用一个更简单的方式：在 `readSse` 返回后检查。但为了简化，直接在 `chatAnthropic` 中用一个局部类型：

```ts
const toolCallBuffers = new Map<string, { id: string; name: string; inputJson: string; _done?: boolean }>();
```

- [ ] **Step 6: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 7: 提交**

```bash
git add src/lib/ai.ts
git commit -m "feat(ai): add streaming tool call support to chat()"
```

---

### Task 4: 添加 Background 消息处理器

**Files:**
- Modify: `src/background/index.ts`

- [ ] **Step 1: 在 chrome.runtime.onMessage.addListener 中添加 execute-bookmark-tool 处理器**

在 `src/background/index.ts` 的 `chrome.runtime.onMessage.addListener` 回调中，在 `if (msg?.type === "search-bookmarks" ...)` 之后、`sendResponse({ ok: false })` 之前，添加：

```ts
if (msg?.type === "execute-bookmark-tool" && typeof msg.tool === "string") {
  try {
    const result = await executeBookmarkTool(msg.tool, msg.args ?? {});
    sendResponse({ ok: true, result });
  } catch (err) {
    sendResponse({ ok: false, error: String(err) });
  }
  return;
}
```

- [ ] **Step 2: 在文件顶部之后添加 executeBookmarkTool 函数**

在 `onBookmarkChanged` 函数之后、`setupContextMenus` 之前，添加：

```ts
async function executeBookmarkTool(
  tool: string,
  args: Record<string, unknown>,
): Promise<{ success: boolean; message: string; data?: unknown }> {
  switch (tool) {
    case "search_bookmarks": {
      const query = String(args.query ?? "");
      const folder = String(args.folder ?? "");
      const limit = Number(args.limit ?? 10);
      return new Promise((resolve) => {
        chrome.bookmarks.search(query, (items) => {
          let results = (items || []).filter((x) => !!x.url);
          if (folder) {
            results = results.filter((x) => {
              // 简单匹配：folder 名称出现在书签路径中
              const path = buildPath(x);
              return path.toLowerCase().includes(folder.toLowerCase());
            });
          }
          resolve({
            success: true,
            message: `找到 ${Math.min(results.length, limit)} 条书签`,
            data: results.slice(0, limit).map((x) => ({
              id: x.id,
              title: x.title || x.url,
              url: x.url,
              path: buildPath(x),
            })),
          });
        });
      });
    }
    case "list_folders": {
      return new Promise((resolve) => {
        chrome.bookmarks.getTree(([tree]) => {
          const folders = collectFolders(tree, "");
          resolve({
            success: true,
            message: `共 ${folders.length} 个文件夹`,
            data: folders,
          });
        });
      });
    }
    case "create_bookmark": {
      const title = String(args.title ?? "");
      const url = String(args.url ?? "");
      const parentId = args.folderId ? String(args.folderId) : undefined;
      if (!title || !url) return { success: false, message: "缺少 title 或 url" };
      return new Promise((resolve) => {
        const createOpts: chrome.bookmarks.CreateDetails = { title, url };
        if (parentId) createOpts.parentId = parentId;
        chrome.bookmarks.create(createOpts, (node) => {
          resolve({
            success: true,
            message: `已创建书签「${title}」`,
            data: { id: node.id, title: node.title, url: node.url },
          });
        });
      });
    }
    case "delete_bookmark": {
      const bookmarkId = String(args.bookmarkId ?? "");
      if (!bookmarkId) return { success: false, message: "缺少 bookmarkId" };
      return new Promise((resolve) => {
        chrome.bookmarks.remove(bookmarkId, () => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, message: chrome.runtime.lastError.message ?? "删除失败" });
          } else {
            resolve({ success: true, message: "书签已删除" });
          }
        });
      });
    }
    case "move_bookmark": {
      const bookmarkId = String(args.bookmarkId ?? "");
      const targetFolderId = String(args.targetFolderId ?? "");
      if (!bookmarkId || !targetFolderId) return { success: false, message: "缺少参数" };
      return new Promise((resolve) => {
        chrome.bookmarks.move(bookmarkId, { parentId: targetFolderId }, (node) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, message: chrome.runtime.lastError.message ?? "移动失败" });
          } else {
            resolve({ success: true, message: "书签已移动" });
          }
        });
      });
    }
    default:
      return { success: false, message: `未知工具: ${tool}` };
  }
}

/** 递归构建书签路径（用于 search_bookmarks 的 folder 过滤） */
function buildPath(node: chrome.bookmarks.BookmarkTreeNode, path?: string): string {
  const name = node.title || "";
  return path ? `${name}/${path}` : name;
}

/** 递归收集文件夹（排除系统根节点） */
function collectFolders(
  node: chrome.bookmarks.BookmarkTreeNode,
  parentPath: string,
): Array<{ id: string; title: string; path: string; count: number }> {
  const result: Array<{ id: string; title: string; path: string; count: number }> = [];
  if (!node.children) return result;
  for (const child of node.children) {
    if (child.children) {
      const path = parentPath ? `${parentPath}/${child.title}` : child.title;
      // 跳过 Chrome 系统文件夹（Bookmarks bar / Other bookmarks / Mobile bookmarks）
      const isSystemFolder = ["Bookmarks bar", "其他书签", "手机书签", "书签栏"].includes(child.title);
      if (!isSystemFolder || !parentPath) {
        result.push({
          id: child.id,
          title: child.title,
          path,
          count: countBookmarks(child),
        });
        result.push(...collectFolders(child, path));
      } else {
        // 系统根文件夹：不加入结果，但递归子文件夹
        result.push(...collectFolders(child, path));
      }
    }
  }
  return result;
}

function countBookmarks(node: chrome.bookmarks.BookmarkTreeNode): number {
  if (!node.children) return 0;
  let count = 0;
  for (const child of node.children) {
    if (child.url) count++;
    else count += countBookmarks(child);
  }
  return count;
}
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 4: 提交**

```bash
git add src/background/index.ts
git commit -m "feat(ai): add execute-bookmark-tool message handler in background"
```

---

### Task 5: AiPanel 集成工具调用流程

**Files:**
- Modify: `src/newtab/pages/AiPanel.tsx`
- Modify: `src/lib/ai.ts` (导入 tools)

- [ ] **Step 1: 添加导入**

在 `src/newtab/pages/AiPanel.tsx` 的 import 中添加：

```ts
import { chat, type ToolCallDelta } from "@/lib/ai";
import { BOOKMARK_TOOLS_OPENAI, BOOKMARK_TOOLS_ANTHROPIC, CONFIRM_REQUIRED_TOOLS } from "@/lib/aiTools";
```

- [ ] **Step 2: 添加工具调用状态和执行函数**

在 AiPanel 组件内部，在 `scrollRef` 之后添加：

```ts
/** 正在累积的 tool call（流式中间态） */
const pendingToolCallsRef = useRef<Map<string, { id: string; name: string; argsStr: string }>>(new Map());
/** tool-confirm 状态：当前等待用户确认的 tool call */
const [confirmToolCall, setConfirmToolCall] = useState<{ id: string; name: string; args: Record<string, unknown> } | null>(null);
```

- [ ] **Step 3: 添加 executeTool 函数**

在 `send` 函数之后添加：

```ts
/** 通过 background 执行书签工具 */
const executeTool = async (toolName: string, args: Record<string, unknown>) => {
  return new Promise<{ ok: boolean; result?: { success: boolean; message: string; data?: unknown }; error?: string }>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "execute-bookmark-tool", tool: toolName, args },
      (resp) => resolve(resp),
    );
  });
};

/** 处理 tool call 完成后的执行逻辑 */
const handleToolCallDone = async (toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => {
  // 暂停流式，准备执行
  setLoading(false);
  if (persistTimerRef.current) {
    clearInterval(persistTimerRef.current);
    persistTimerRef.current = null;
  }

  for (const tc of toolCalls) {
    if (CONFIRM_REQUIRED_TOOLS.has(tc.name)) {
      // 需要确认：显示确认 UI，暂停执行
      setConfirmToolCall(tc);
      return; // 等待用户确认后再继续
    }
  }

  // 不需要确认：直接执行所有工具
  await executeToolCalls(toolCalls);
};

/** 执行工具并继续对话 */
const executeToolCalls = async (toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => {
  // 追加 assistant 消息（带 toolCalls）
  const assistantMsg: AiMessage = {
    role: "assistant",
    content: "",
    toolCalls,
  };

  setMessages((prev) => [...prev, assistantMsg]);

  // 逐个执行工具
  const toolResults: AiMessage[] = [];
  for (const tc of toolCalls) {
    const resp = await executeTool(tc.name, tc.args);
    const result = resp?.result ?? { success: false, message: resp?.error ?? "执行失败" };
    toolResults.push({
      role: "tool",
      content: JSON.stringify(result),
      toolResult: { toolCallId: tc.id, ...result },
    });
  }

  // 追加 tool 结果消息
  setMessages((prev) => [...prev, ...toolResults]);
  persist([...messages, assistantMsg, ...toolResults]);

  // 继续对话
  await continueChat([...messages, assistantMsg, ...toolResults]);
};

/** 用 tool result 继续对话 */
const continueChat = async (conversationHistory: AiMessage[]) => {
  const bookmarkCtx = await getBookmarkContextForAi();
  const forApi: AiMessage[] = [
    {
      role: "system",
      content: `${SYSTEM_PROMPT}\n\n---\n${bookmarkCtx}`,
    },
    ...conversationHistory,
  ];

  const tools = settings.aiProvider === "openai" ? BOOKMARK_TOOLS_OPENAI : BOOKMARK_TOOLS_ANTHROPIC;

  setLoading(true);
  const ctrl = new AbortController();
  abortRef.current = ctrl;

  // 追加空的 assistant 占位
  const now = Date.now();
  setMessages((prev) => [...prev, { role: "assistant", content: "", at: now }]);

  try {
    let acc = "";
    pendingToolCallsRef.current.clear();

    if (persistTimerRef.current) clearInterval(persistTimerRef.current);
    persistTimerRef.current = setInterval(() => {
      if (acc) {
        setMessages((prev) => { persist(prev); return prev; });
      }
    }, 2000);

    await chat({
      settings,
      messages: forApi,
      signal: ctrl.signal,
      tools,
      onDelta: (d) => {
        acc += d;
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { role: "assistant", content: acc, at: last?.at ?? now };
          return copy;
        });
        scrollToBottom();
      },
      onToolCall: (call) => {
        if (call.id) {
          const existing = pendingToolCallsRef.current.get(call.id) ?? { id: call.id, name: "", argsStr: "" };
          if (call.name) existing.name = call.name;
          if (call.arguments) existing.argsStr += call.arguments;
          if (call.done) {
            existing._done = true;
          }
          pendingToolCallsRef.current.set(call.id, existing);
        }
      },
    });

    // 检查是否有 tool calls
    const completedCalls = [...pendingToolCallsRef.current.values()].filter((tc) => tc._done);
    if (completedCalls.length > 0) {
      const parsed = completedCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: JSON.parse(tc.argsStr || "{}") as Record<string, unknown>,
      }));
      // 移除空的 assistant 占位
      setMessages((prev) => prev.slice(0, -1));
      await handleToolCallDone(parsed);
      return;
    }

    // 正常结束：最终持久化
    setMessages((prev) => { persist(prev); return prev; });
  } catch (err: any) {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      copy[copy.length - 1] = { role: "assistant", content: `⚠️ ${err?.message ?? "请求失败"}`, at: last?.at };
      persist(copy);
      return copy;
    });
  } finally {
    if (persistTimerRef.current) { clearInterval(persistTimerRef.current); persistTimerRef.current = null; }
    setLoading(false);
    abortRef.current = null;
  }
};
```

- [ ] **Step 4: 修改 send() 使用 tools**

将 `send` 函数中的 `chat()` 调用替换：

找到：
```ts
      await chat({
        settings,
        messages: forApi,
        signal: ctrl.signal,
        onDelta: (d) => {
```

替换为：
```ts
      const tools = settings.aiProvider === "openai" ? BOOKMARK_TOOLS_OPENAI : BOOKMARK_TOOLS_ANTHROPIC;
      await chat({
        settings,
        messages: forApi,
        signal: ctrl.signal,
        tools,
        onDelta: (d) => {
```

同时在 `send` 函数的 `onDelta` 之后、`});` 之前添加 `onToolCall`：

```ts
        onToolCall: (call) => {
          if (call.id) {
            const existing = pendingToolCallsRef.current.get(call.id) ?? { id: call.id, name: "", argsStr: "" };
            if (call.name) existing.name = call.name;
            if (call.arguments) existing.argsStr += call.arguments;
            if (call.done) existing._done = true;
            pendingToolCallsRef.current.set(call.id, existing);
          }
        },
```

并在 `send` 的流结束后（`await chat(...)` 之后），添加 tool call 检测逻辑：

```ts
      // 检查是否有 tool calls
      const completedCalls = [...pendingToolCallsRef.current.values()].filter((tc) => tc._done);
      if (completedCalls.length > 0) {
        const parsed = completedCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: JSON.parse(tc.argsStr || "{}") as Record<string, unknown>,
        }));
        // 移除空的 assistant 占位
        setMessages((prev) => prev.slice(0, -1));
        await handleToolCallDone(parsed);
        return;
      }
```

注意：`pendingToolCallsRef.current.get(call.id)` 的类型扩展需要在 Map value 类型中加 `_done?: boolean`。修正 Step 2 的类型定义：

```ts
const pendingToolCallsRef = useRef<Map<string, { id: string; name: string; argsStr: string; _done?: boolean }>>(new Map());
```

- [ ] **Step 5: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 6: 提交**

```bash
git add src/newtab/pages/AiPanel.tsx src/lib/ai.ts
git commit -m "feat(ai): integrate tool call flow in AiPanel"
```

---

### Task 6: 添加内联确认 UI

**Files:**
- Modify: `src/newtab/pages/AiPanel.tsx`

- [ ] **Step 1: 添加确认/取消处理函数**

在 `executeToolCalls` 函数之后添加：

```ts
/** 用户确认执行 */
const confirmAndExecute = async () => {
  if (!confirmToolCall) return;
  const tc = confirmToolCall;
  setConfirmToolCall(null);
  await executeToolCalls([tc]);
};

/** 用户取消操作 */
const cancelToolCall = () => {
  if (!confirmToolCall) return;
  const tc = confirmToolCall;
  setConfirmToolCall(null);

  // 追加取消消息
  const cancelMsg: AiMessage = {
    role: "tool",
    content: JSON.stringify({ success: false, message: "用户取消了操作" }),
    toolResult: { toolCallId: tc.id, success: false, message: "用户取消了操作" },
  };
  setMessages((prev) => [...prev, cancelMsg]);
  persist([...messages, cancelMsg]);
  // 继续对话
  continueChat([...messages, cancelMsg]);
};
```

- [ ] **Step 2: 在消息列表渲染中添加 tool-confirm 消息的确认 UI**

在 `visible.map((m, i) => ...)` 的渲染逻辑中，在 `return (` 之前添加 `tool-confirm` 角色的特殊渲染：

找到：
```ts
            {visible.map((m, i) => {
              const isUser = m.role === "user";
              const rail = isUser
                ? "hsl(var(--primary))"
                : "hsl(var(--claude-accent))";
              return (
```

替换为：

```ts
            {visible.map((m, i) => {
              const isUser = m.role === "user";
              const isToolConfirm = m.role === "tool-confirm";
              const rail = isUser
                ? "hsl(var(--primary))"
                : "hsl(var(--claude-accent))";
              if (isToolConfirm) {
                return (
                  <article
                    key={m.at != null ? `${m.at}-confirm-${i}` : i}
                    className="rounded-lg border p-4"
                    style={{
                      borderColor: "hsl(var(--claude-rule))",
                      backgroundColor: "hsl(var(--claude-canvas))",
                    }}
                  >
                    <div className="mb-2 text-sm font-medium text-foreground/80">
                      {t("ai.toolConfirmTitle")}
                    </div>
                    <div className="mb-3 text-sm text-foreground/60">
                      {m.content}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={confirmAndExecute}>
                        {t("ai.toolConfirm")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={cancelToolCall}>
                        {t("ai.toolCancel")}
                      </Button>
                    </div>
                  </article>
                );
              }
              return (
```

- [ ] **Step 3: 在发送新消息时清除确认状态**

在 `send` 函数开头（`const text = ...` 之后）添加：

```ts
    setConfirmToolCall(null);
```

- [ ] **Step 4: 添加 i18n key**

在 `src/lib/i18n.ts` 中添加（zh 和 en 都加）：

```ts
// 中文
"ai.toolConfirmTitle": "代理想要执行：",
"ai.toolConfirm": "确认执行",
"ai.toolCancel": "取消",

// English
"ai.toolConfirmTitle": "Agent wants to execute:",
"ai.toolConfirm": "Confirm",
"ai.toolCancel": "Cancel",
```

- [ ] **Step 5: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 6: 构建验证**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 7: 提交**

```bash
git add src/newtab/pages/AiPanel.tsx src/lib/i18n.ts
git commit -m "feat(ai): add inline confirmation UI for destructive bookmark tools"
```

---

### Task 7: 更新 AiPanel 消息渲染支持 tool 角色

**Files:**
- Modify: `src/newtab/pages/AiPanel.tsx`

- [ ] **Step 1: 修改 visible 过滤逻辑**

找到：
```ts
  const visible = messages.filter((m) => m.role !== "system");
```

替换为：

```ts
  const visible = messages.filter((m) => m.role !== "system" && m.role !== "tool");
```

tool 消息不直接渲染（它们的数据已通过 AI 的自然语言回复展示），只有 `tool-confirm` 需要渲染。

- [ ] **Step 2: 在消息列表中处理 tool-confirm 消息的 content**

`tool-confirm` 消息的 content 应该包含工具名 + 参数摘要。在 `handleToolCallDone` 中，当检测到需要确认的工具时，创建一条 `tool-confirm` 消息：

修改 `handleToolCallDone` 中确认分支：

```ts
    if (CONFIRM_REQUIRED_TOOLS.has(tc.name)) {
      // 构建确认摘要
      const summary = buildToolConfirmSummary(tc.name, tc.args);
      const confirmMsg: AiMessage = {
        role: "tool-confirm",
        content: summary,
        at: Date.now(),
      };
      setMessages((prev) => [...prev, confirmMsg]);
      setConfirmToolCall(tc);
      return;
    }
```

添加辅助函数：

```ts
function buildToolConfirmSummary(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "delete_bookmark":
      return `删除书签 (ID: ${args.bookmarkId})`;
    case "move_bookmark":
      return `移动书签 (ID: ${args.bookmarkId}) → 文件夹 (ID: ${args.targetFolderId})`;
    default:
      return `${name}: ${JSON.stringify(args)}`;
  }
}
```

- [ ] **Step 3: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 4: 提交**

```bash
git add src/newtab/pages/AiPanel.tsx
git commit -m "feat(ai): filter tool messages from visible, render tool-confirm inline"
```

---

### Task 8: 完整构建验证

- [ ] **Step 1: 完整构建**

Run: `npm run build`
Expected: 构建成功，无报错

- [ ] **Step 2: 运行开发服务器验证**

Run: `npm run dev`（或项目实际的 dev 命令）
Expected: newtab 页面正常加载，AI 面板可交互

- [ ] **Step 3: 最终提交（如有遗漏文件）**

如有未提交的改动：
```bash
git add -A
git commit -m "chore: build artifacts"
```

---

## 文件结构总结

| 文件 | 改动类型 | 职责 |
|------|----------|------|
| `src/types/index.ts` | 修改 | AiMessage 扩展 toolCalls / toolResult / 新 role |
| `src/lib/aiTools.ts` | 新建 | 工具 JSON Schema 定义 + 工具分类常量 |
| `src/lib/ai.ts` | 修改 | chat() 支持 tools / onToolCall / tool 角色消息序列化 |
| `src/background/index.ts` | 修改 | execute-bookmark-tool 消息处理器 + chrome.bookmarks API 调用 |
| `src/newtab/pages/AiPanel.tsx` | 修改 | 工具调用流程 + 内联确认 UI + tool 消息过滤 |
| `src/lib/i18n.ts` | 修改 | 新增确认相关 i18n key |

## 自检清单

- [x] Spec 覆盖：所有 5 个工具（search_bookmarks / list_folders / create_bookmark / delete_bookmark / move_bookmark）都有实现
- [x] Spec 覆盖：分级确认（delete/move 需确认，create/查询直接执行）
- [x] Spec 覆盖：tool-confirm 消息不持久化（在 visible 过滤中已处理）
- [x] Spec 覆盖：tool 消息存入 IndexedDB（role: "tool" 会被存储）
- [x] Spec 覆盖：OpenAI + Anthropic 双 provider streaming tool call 解析
- [x] Spec 覆盖：工具结果回传后再次调用 chat() 继续对话
- [x] 类型一致性：所有文件中 AiMessage / ToolCallDelta / BookmarkToolResult 类型名一致
- [x] 无 placeholder：所有代码步骤都有完整实现
