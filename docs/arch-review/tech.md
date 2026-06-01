# AI 模块架构优化 — 技术方案

> 基于：architecture-review 6 个候选改造点
> 日期：2026-05-28
> 状态：草案

## 目标

消除 AiPanel.tsx 中的结构性重复和业务逻辑泄漏，让 AI 对话引擎的流式逻辑、工具执行、系统提示词构建各自独立为可测试的 lib 模块。

## 范围判断

| 候选 | 纳入 | 理由 |
|------|------|------|
| 1. 提取 ChatSession | **Phase 1** | Strong，最大 ROI |
| 2. 统一 tool 执行层 | **Phase 2** | Strong，消除 130 行业务逻辑 |
| 3. 提取 systemPromptBuilder | **Phase 3** | Worth exploring，为多入口复用铺路 |
| 4. 统一 Anthropic 格式转换 | **Phase 4** | Worth exploring，消除 ai.ts 内部重复 |
| 5. 拆分 Dashboard.tsx | 不在本次范围 | 纯组件拆分，独立任务 |
| 6. BookmarkToolResult 类型统一 | **Phase 2 中顺手做** | Speculative，改动极小 |

不在本次范围：Dashboard.tsx 拆分、测试框架搭建、新功能开发。

## 现状分析

### 代码量分布（AiPanel.tsx，1598 行）

| 区域 | 行数 | 职责 |
|------|------|------|
| 流式对话（send + continueChat） | ~250 | 构建工具列表、调用 chat()、流式回调、tool call 累积 |
| 工具执行（executeTool + memory 执行器） | ~130 | 工具路由、memory CRUD、background 消息 |
| 确认对话框逻辑 | ~120 | 参数验证、名称查询、确认/取消/批量执行 |
| 系统提示词构建 | ~50 | SYSTEM_PROMPT 常量 + 组装逻辑 |
| JSX 渲染 | ~800 | UI 布局、会话列表、消息渲染、设置面板 |
| 其他状态管理 | ~250 | session CRUD、memory 面板、profile 面板 |

### 关键重复

`send()`（428-588）和 `continueChat()`（978-1065）共享的代码：

```
// 以下两段完全相同，出现在两处：
const baseTools = BOOKMARK_TOOLS_OPENAI.filter((t) => {
  if (t.function.name === "web_reader") return settings.mcpWebReader;
  if (t.function.name === "web_search") return settings.mcpWebSearch;
  return true;
});
const tools = settings.aiProvider === "openai"
  ? baseTools
  : baseTools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

// 以下流式回调结构在两处相同：
await chat({
  settings, messages: forApi, signal: ctrl.signal, tools,
  onThinking: (delta) => { /* ... */ },
  onDelta: (d) => { /* ... */ },
  onToolCall: makeOnToolCall(),
});
if (await checkToolCallsFromStream()) return;
if (!acc) { handleStreamError(new Error("AI 响应中断，请重试")); return; }
setMessages((prev) => { persist(prev); return prev; });
```

### 工具执行分散

```
AiPanel.tsx                          background/index.ts
├─ executeTool()                     ├─ executeBookmarkTool()
│   ├─ web_reader → chrome.rt.send   │   ├─ search_bookmarks
│   └─ 其他 → chrome.rt.send         │   ├─ list_folders
├─ executeSaveMemory()               │   ├─ create_bookmark
├─ executeListMemory()               │   ├─ delete_bookmark
├─ executeDeleteMemory()             │   ├─ move_bookmark
├─ executeUpdateMemory()             │   ├─ update_bookmark
└─ validateConfirmToolCall()         │   └─ create_folder
                                     └─ executeMcpTool()
```

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/lib/chatSession.ts` | **新增** | 流式对话引擎：工具列表构建、chat() 调用、stream 回调注册、tool call 累积 |
| `src/lib/toolExecutor.ts` | **新增** | 工具执行路由：memory 工具直接执行、bookmark/web 工具委托 background |
| `src/lib/systemPromptBuilder.ts` | **新增** | 系统提示词构建：SYSTEM_PROMPT + 书签摘要 + 用户画像 + MCP 能力声明 |
| `src/newtab/pages/AiPanel.tsx` | **修改** | 减少 ~400 行，只保留 UI 渲染、session 管理、确认对话框 |
| `src/lib/ai.ts` | **修改** | Phase 4：统一 Anthropic 格式转换 |
| `src/background/index.ts` | **修改** | Phase 2：import BookmarkToolResult 类型 |
| `src/lib/aiTools.ts` | **不变** | 已有 BOOKMARK_TOOLS_ANTHROPIC 导出 |

## 技术方案

### Phase 1：提取 ChatSession

**目标**：将 send() 和 continueChat() 的共享流式逻辑提取为独立模块，消除 ~100 行重复。

**新增文件 `src/lib/chatSession.ts`**：

```typescript
import { chat } from "@/lib/ai";
import { BOOKMARK_TOOLS_OPENAI } from "@/lib/aiTools";
import type { AiMessage, Settings } from "@/types";

export interface StreamCallbacks {
  onThinking?: (delta: string) => void;
  onDelta?: (delta: string) => void;
  onToolCall?: (call: import("@/lib/ai").ToolCallDelta) => void;
}

export interface RunChatOptions {
  settings: Settings;
  /** 完整对话历史（含 system 消息） */
  messages: AiMessage[];
  signal?: AbortSignal;
  callbacks: StreamCallbacks;
  /** 是否累积 tool call fragment */
  collectToolCalls?: boolean;
}

export interface ChatStreamResult {
  text: string;
  thinking: string;
}

/**
 * 构建工具列表：根据 settings 过滤 MCP 工具，根据 provider 转换格式。
 * 消除 send() 和 continueChat() 中完全相同的工具构建逻辑。
 */
export function buildToolList(settings: Settings): unknown[] {
  const baseTools = BOOKMARK_TOOLS_OPENAI.filter((t) => {
    if (t.function.name === "web_reader") return settings.mcpWebReader;
    if (t.function.name === "web_search") return settings.mcpWebSearch;
    return true;
  });
  if (settings.aiProvider === "openai") return baseTools;
  // Anthropic 格式
  return baseTools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

/**
 * 执行一次完整的流式对话。send() 和 continueChat() 都调用此函数。
 */
export async function runChatStream({
  settings,
  messages,
  signal,
  callbacks,
}: RunChatOptions): Promise<ChatStreamResult> {
  const tools = buildToolList(settings);
  let acc = "";
  let thinkingAcc = "";

  await chat({
    settings,
    messages,
    signal,
    tools,
    onThinking: (delta) => {
      thinkingAcc += delta;
      callbacks.onThinking?.(delta);
    },
    onDelta: (d) => {
      acc += d;
      callbacks.onDelta?.(d);
    },
    onToolCall: callbacks.onToolCall,
  });

  return { text: acc, thinking: thinkingAcc };
}
```

**AiPanel.tsx 改动**：

send() 中的流式部分简化为：

```typescript
const result = await runChatStream({
  settings,
  messages: forApi,
  signal: ctrl.signal,
  callbacks: {
    onThinking: (delta) => {
      streamThinkingRef.current += delta;
      setMessages((prev) => {
        const copy = [...prev];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === "assistant") {
            copy[i] = { ...copy[i], thinking: streamThinkingRef.current };
            break;
          }
        }
        return copy;
      });
      scrollToBottom();
    },
    onDelta: (d) => {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, content: (last.content || "") + d };
        return copy;
      });
      scrollToBottom();
    },
    onToolCall: makeOnToolCall(),
  },
});
// 后续检查 checkToolCallsFromStream() 保持不变
```

continueChat() 做同样的简化。工具构建逻辑（12 行）和 chat() 调用签名（15 行）不再重复。

**注意**：send() 的 onDelta 回调中使用的是 `acc` 闭包来累积文本；runChatStream 内部也在累积。为避免重复累积，回调中的 delta 就是增量（delta），不是全量。AiPanel 的 onDelta 直接把 delta 追加到最后一条 assistant 消息即可。

**验证**：
- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] 手工验证：新建会话 → 发送消息 → AI 正常流式回复
- [ ] 手工验证：触发 tool call（如 search_bookmarks）→ 确认 → AI 继续回复
- [ ] 手工验证：触发 thinking 模型（如 o3）→ thinking 正常显示
- [ ] 手工验证：流式中断 → 显示"AI 响应中断"错误提示

### Phase 2：统一 tool 执行层

**目标**：将 memory 工具执行器、工具路由、参数验证从 AiPanel 提取到独立模块。

**新增文件 `src/lib/toolExecutor.ts`**：

```typescript
import {
  getProfile,
  setProfile,
  getMemory,
  setMemory,
  addProfileEntries,
  addMemoryEntries,
} from "@/lib/aiUserDb";
import type { BookmarkToolResult } from "@/lib/aiTools";

const MEMORY_TOOLS = new Set(["save_memory", "list_memory", "delete_memory", "update_memory"]);

/** 判断工具是否需要经过 background 执行 */
export function isBackgroundTool(toolName: string): boolean {
  return !MEMORY_TOOLS.has(toolName);
}

/** 判断工具是否需要用户确认 */
export function isConfirmRequired(toolName: string): boolean {
  return toolName === "delete_bookmark" || toolName === "move_bookmark";
}

/** 在 content script 中执行 memory 工具 */
export async function executeMemoryTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<BookmarkToolResult> {
  switch (toolName) {
    case "save_memory": {
      const type = args.type as string;
      const entries = (args.entries as string[]) ?? [];
      if (type === "profile") await addProfileEntries(entries);
      else if (type === "memory") await addMemoryEntries(entries);
      else return { success: false, message: `未知类型: ${type}` };
      return { success: true, message: `已保存 ${entries.length} 条${type === "profile" ? "画像" : "记忆"}信息` };
    }
    case "list_memory": {
      const [profile, memory] = await Promise.all([getProfile(), getMemory()]);
      return { success: true, message: JSON.stringify({ profile, memory }), data: { profile, memory } };
    }
    case "delete_memory": {
      const type = args.type as string;
      const entry = args.entry as string;
      if (type === "profile") {
        const entries = await getProfile();
        const next = entries.filter((e) => e !== entry);
        if (next.length === entries.length) return { success: false, message: `未找到条目: ${entry}` };
        await setProfile(next);
      } else if (type === "memory") {
        const entries = await getMemory();
        const next = entries.filter((e) => e !== entry);
        if (next.length === entries.length) return { success: false, message: `未找到条目: ${entry}` };
        await setMemory(next);
      } else return { success: false, message: `未知类型: ${type}` };
      return { success: true, message: `已删除 ${type === "profile" ? "画像" : "记忆"}条目` };
    }
    case "update_memory": {
      const type = args.type as string;
      const oldEntry = args.old_entry as string;
      const newEntry = args.new_entry as string;
      if (type === "profile") {
        const entries = await getProfile();
        const idx = entries.indexOf(oldEntry);
        if (idx === -1) return { success: false, message: `未找到条目: ${oldEntry}` };
        entries[idx] = newEntry;
        await setProfile(entries);
      } else if (type === "memory") {
        const entries = await getMemory();
        const idx = entries.indexOf(oldEntry);
        if (idx === -1) return { success: false, message: `未找到条目: ${oldEntry}` };
        entries[idx] = newEntry;
        await setMemory(entries);
      } else return { success: false, message: `未知类型: ${type}` };
      return { success: true, message: `已修改${type === "profile" ? "画像" : "记忆"}条目` };
    }
    default:
      return { success: false, message: `未知工具: ${toolName}` };
  }
}

/** 通过 background 执行 bookmark 或 web 工具 */
export async function executeBackgroundTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; result?: BookmarkToolResult; error?: string }> {
  const type = (toolName === "web_reader" || toolName === "web_search")
    ? "execute-mcp-tool"
    : "execute-bookmark-tool";
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, tool: toolName, args }, (resp) => resolve(resp));
  });
}

/** 通过 background 查询书签/文件夹名称 */
export async function lookupBookmarkName(id: string): Promise<string> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "lookup-bookmark-name", id }, (resp) => resolve(resp?.name ?? id));
  });
}

/** 验证确认工具的参数合法性 */
export function validateConfirmToolCall(
  tc: { id: string; name: string; args: Record<string, unknown> },
): { ok: true; call: typeof tc } | { ok: false; missing: string[] } {
  const invalidIds = new Set(["", "undefined", "null", "nan"]);
  const normalize = (v: unknown): string => {
    if (typeof v !== "string" && typeof v !== "number") return "";
    const s = String(v).trim();
    return invalidIds.has(s.toLowerCase()) ? "" : s;
  };

  const bookmarkId = normalize(tc.args.bookmarkId);
  const missing: string[] = [];
  const args = { ...tc.args };

  if (!bookmarkId) missing.push("bookmarkId");
  else args.bookmarkId = bookmarkId;

  if (tc.name === "move_bookmark") {
    const targetFolderId = normalize(tc.args.targetFolderId);
    if (!targetFolderId) missing.push("targetFolderId");
    else args.targetFolderId = targetFolderId;
  }

  if (missing.length) return { ok: false, missing };
  return { ok: true, call: { ...tc, args } };
}
```

**background/index.ts 改动**：

```typescript
// 顶部新增 import
import type { BookmarkToolResult } from "@/lib/aiTools";

// executeBookmarkTool 返回值类型改为：
async function executeBookmarkTool(
  tool: string,
  args: Record<string, unknown>,
): Promise<BookmarkToolResult> {
  // 函数体不变
}
```

**AiPanel.tsx 改动**：

- 删除 `executeTool`、`lookupName`、`executeSaveMemory`、`executeListMemory`、`executeDeleteMemory`、`executeUpdateMemory`、`normalizeToolId`、`validateConfirmToolCall`（~130 行）
- 替换为 `import { executeBackgroundTool, executeMemoryTool, lookupBookmarkName, validateConfirmToolCall } from "@/lib/toolExecutor"`
- `executeToolCalls` 中改为调用 `executeMemoryTool()` 和 `executeBackgroundTool()`
- `handleToolCallDone` 中 `validateConfirmToolCall` 调用不变
- `lookupName` 替换为 `lookupBookmarkName`

**验证**：
- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] 手工验证：send 消息触发 search_bookmarks → 无需确认，直接执行并继续
- [ ] 手工验证：send 消息触发 delete_bookmark → 弹出确认对话框 → 确认 → 执行
- [ ] 手工验证：send 消息触发 save_memory → memory 工具直接执行（不经过 background）
- [ ] 手工验证：send 消息触发 move_bookmark → 缺少参数时显示错误提示

### Phase 3：提取 systemPromptBuilder

**目标**：将系统提示词构建逻辑从 AiPanel 移到独立模块。

**新增文件 `src/lib/systemPromptBuilder.ts`**：

```typescript
import { getBookmarkContextForAi } from "@/lib/aiBookmarkContext";
import { getProfile, getMemory } from "@/lib/aiUserDb";
import type { Settings } from "@/types";

const SYSTEM_PROMPT = [
  "You are Smart Bookmark Agent — ...",  // 完整内容从 AiPanel 搬过来
].join("\n");

export interface BuildSystemPromptOptions {
  settings: Settings;
  /** 已缓存的书签摘要，为 null 时重新获取 */
  cachedBookmarkCtx?: string | null;
}

export interface BuildSystemPromptResult {
  systemContent: string;
  bookmarkCtx: string;
}

export async function buildSystemPrompt({
  settings,
  cachedBookmarkCtx,
}: BuildSystemPromptOptions): Promise<BuildSystemPromptResult> {
  const bookmarkCtx = cachedBookmarkCtx ?? await getBookmarkContextForAi();
  const [profileEntries, memoryEntries] = await Promise.all([getProfile(), getMemory()]);

  let userContext = "";
  if (profileEntries.length > 0) {
    userContext += `## 用户画像\n${profileEntries.map((e) => `- ${e}`).join("\n")}`;
  }
  if (memoryEntries.length > 0) {
    if (userContext) userContext += "\n\n";
    userContext += `## 持久记忆\n${memoryEntries.map((e) => `- ${e}`).join("\n")}`;
  }

  let systemContent = userContext
    ? `${SYSTEM_PROMPT}\n\n---\n${bookmarkCtx}\n\n---\n${userContext}`
    : `${SYSTEM_PROMPT}\n\n---\n${bookmarkCtx}`;

  const mcpCapabilities: string[] = [];
  if (settings.mcpWebReader) {
    mcpCapabilities.push("- web_reader：抓取指定 URL 的网页内容，可用来阅读文章、获取页面信息");
  }
  if (settings.mcpWebSearch) {
    mcpCapabilities.push("- web_search：搜索网络信息，可用来查找最新资讯、验证信息，参数为 search_query");
  }
  if (mcpCapabilities.length > 0) {
    systemContent += "\n\n## 扩展能力\n" + mcpCapabilities.join("\n");
  }

  return { systemContent, bookmarkCtx };
}
```

**AiPanel.tsx 改动**：

- 删除 SYSTEM_PROMPT 常量（27 行）和 send() 中的系统提示词构建逻辑（~40 行）
- send() 中替换为：

```typescript
import { buildSystemPrompt } from "@/lib/systemPromptBuilder";

// 在 send() 中：
if (!systemPromptRef.current) {
  const { systemContent, bookmarkCtx } = await buildSystemPrompt({
    settings,
    cachedBookmarkCtx: bookmarkCtxRef.current || null,
  });
  bookmarkCtxRef.current = bookmarkCtx;
  systemPromptRef.current = systemContent;
  if (sessionIdRef.current) {
    updateSession(sessionIdRef.current, [], undefined, systemContent);
  }
}
```

**验证**：
- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] 手工验证：新建会话 → AI 回复中能感知书签内容（说明 system prompt 注入成功）
- [ ] 手工验证：开启 mcpWebReader 设置 → AI 回复中提到 web_reader 能力
- [ ] 手工验证：切换会话 → 系统提示词复用（不重新构建）

### Phase 4：统一 Anthropic 格式转换

**目标**：消除 chatAnthropic() 中与 toApiMessages() 重复的消息格式转换逻辑。

**改动文件 `src/lib/ai.ts`**：

将 `toApiMessages()` 扩展为支持 Anthropic 格式：

```typescript
function toApiMessages(
  messages: AiMessage[],
  options: {
    stripAssistantWithoutThinking?: boolean;
    provider?: "openai" | "anthropic";
  } = {},
) {
  const provider = options.provider ?? "openai";
  const result: unknown[] = [];
  const sanitizedMessages = sanitizeToolMessageHistory(messages);
  const skippedToolCallIds = new Set<string>();

  for (const m of sanitizedMessages) {
    if (m.role === "tool") {
      const toolCallId = m.toolResult?.toolCallId ?? "";
      if (skippedToolCallIds.has(toolCallId)) continue;

      if (provider === "anthropic") {
        result.push({
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: toolCallId,
            content: m.content,
          }],
        });
      } else {
        result.push({ role: "tool", tool_call_id: toolCallId, content: m.content });
      }
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      if (options.stripAssistantWithoutThinking && !m.thinking) {
        for (const tc of m.toolCalls) skippedToolCallIds.add(tc.id);
        continue;
      }

      if (provider === "anthropic") {
        const content: unknown[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls) {
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
        }
        if (m.thinking) {
          content.unshift({ type: "thinking", thinking: m.thinking });
        }
        result.push({ role: "assistant", content });
      } else {
        const assistantMessage: Record<string, unknown> = {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id, type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        };
        if (m.thinking) assistantMessage.reasoning_content = m.thinking;
        result.push(assistantMessage);
      }
    } else if (m.role !== "system" && m.role !== "tool-confirm") {
      if (options.stripAssistantWithoutThinking && m.role === "assistant" && !m.thinking) continue;

      if (provider === "anthropic") {
        result.push({ role: m.role, content: m.content });
      } else {
        const apiMessage: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.role === "assistant" && m.thinking) apiMessage.reasoning_content = m.thinking;
        result.push(apiMessage);
      }
    }
  }
  return result;
}
```

chatAnthropic() 简化为：

```typescript
async function chatAnthropic({ settings, messages, signal, onDelta, onToolCall, onThinking, tools }: ChatOptions): Promise<string> {
  const sys = messages.find((m) => m.role === "system")?.content ?? "";
  const rest = messages.filter((m) => m.role !== "system");
  const base = (settings.aiBaseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  const apiMessages = toApiMessages(rest, { provider: "anthropic" });

  const body: Record<string, unknown> = {
    model: settings.aiModel || "claude-3-5-sonnet-latest",
    max_tokens: 1024,
    system: sys || undefined,
    messages: apiMessages,
    stream: true,
  };
  if (tools?.length) body.tools = tools;
  if (settings.showThinking) body.thinking = { type: "enabled", budget_tokens: 10000 };

  // 后续 fetch + SSE 解析保持不变...
}
```

**验证**：
- [ ] `npm run typechat` 通过
- [ ] `npm run build` 通过
- [ ] 手工验证：Anthropic provider → 发送消息 → 正常流式回复
- [ ] 手工验证：Anthropic provider → 触发 tool call → 确认 → 继续对话
- [ ] 手工验证：OpenAI provider → 功能不受影响（回归测试）

## 数据流与状态

### Phase 1 后的调用链

```
AiPanel.send()
  ├─ buildSystemPrompt()  [Phase 3]
  ├─ runChatStream()  [Phase 1, 新]
  │   ├─ buildToolList()
  │   └─ chat()
  ├─ checkToolCallsFromStream()
  └─ handleToolCallDone()
       ├─ executeMemoryTool()  [Phase 2, 新]
       ├─ executeBackgroundTool()  [Phase 2, 新]
       └─ runChatStream()  [通过 continueChat]
```

### 状态归属

| 状态 | 归属 | 说明 |
|------|------|------|
| messages, input, loading | AiPanel | UI 交互状态 |
| pendingToolCallsRef, pendingToolCallIndexRef | AiPanel | 流式 tool call 累积（UI 层需要更新 JSX） |
| streamThinkingRef | AiPanel | 当前 thinking 内容（UI 层需要更新 ThinkingBlock） |
| systemPromptRef | AiPanel | 系统提示词缓存（会话级别） |
| confirmToolCalls, autoConfirmToolNamesRef | AiPanel | 确认对话框状态 |
| tool list 构建 | chatSession.ts | 纯函数，无状态 |
| memory CRUD | toolExecutor.ts | 纯函数，无状态 |
| 系统提示词组装 | systemPromptBuilder.ts | 纯函数，无状态 |

## 异常与边界

| 场景 | 处理 |
|------|------|
| 流式中断（网络断开） | runChatStream 返回空 text → AiPanel 检查后调用 handleStreamError |
| abort 取消 | signal 传入 chat() → fetch abort → AiPanel cleanupStreaming |
| tool call 累积不完整 | checkToolCallsFromStream 检查 _done 标记 → 不完整则跳过 |
| memory 工具执行失败 | executeMemoryTool 返回 { success: false } → 正常追加到消息流 |
| background 消息无响应 | executeBackgroundTool 返回 { ok: false } → 正常追加错误消息 |

## 风险与取舍

| 风险 | 影响 | 缓解 |
|------|------|------|
| runChatStream 回调与 AiPanel 状态更新解耦 | onDelta 中的 setMessages 需要访问 AiPanel 的 state | 回调作为参数传入，AiPanel 保留对 state 的控制权 |
| Phase 4 改动 ai.ts 内部逻辑 | 可能影响 Anthropic 流式解析 | chatAnthropic 的 SSE 解析部分不动，只改消息格式转换 |
| toolExecutor 的 memory 工具依赖 aiUserDb | 如果 aiUserDb 接口变化需要同步修改 | 接口已稳定，风险低 |
| background/index.ts import aiTools 类型 | Vite 构建时 aiTools 会被打入 background bundle | aiTools 是纯类型+常量，体积可忽略 |

## 验证方案

每个 Phase 完成后：

1. **类型检查**：`npm run typecheck` 无错误
2. **构建**：`npm run build` 成功，dist/ 产物更新
3. **手工测试矩阵**：

| 测试场景 | Provider | 预期 |
|----------|----------|------|
| 纯文本对话 | OpenAI | 正常流式回复 |
| 纯文本对话 | Anthropic | 正常流式回复 |
| search_bookmarks（无需确认） | 任意 | 直接执行并继续 |
| delete_bookmark（需确认） | 任意 | 弹出确认框 → 确认 → 执行 |
| move_bookmark（需确认） | 任意 | 弹出确认框 → 取消 → AI 收到取消消息 |
| save_memory | 任意 | 直接执行，不经过 background |
| 流式中断 | 任意 | 显示错误提示 |
| thinking 模型 | OpenAI (o3) | thinking 折叠块正常显示 |
| 切换会话 | 任意 | 历史消息正确加载 |
| 新建会话后首条消息 | 任意 | 系统提示词正确构建并持久化 |

## 实施计划

### Task 1：新增 chatSession.ts 并重构 send/continueChat

**目标**：消除 send() 和 continueChat() 的流式逻辑重复。

**文件**：
- 新增：`src/lib/chatSession.ts`
- 修改：`src/newtab/pages/AiPanel.tsx`

**步骤**：
- [ ] Step 1：创建 `src/lib/chatSession.ts`，实现 `buildToolList()` 和 `runChatStream()`
- [ ] Step 2：AiPanel.tsx 中 send() 的流式部分替换为 `runChatStream()` 调用
- [ ] Step 3：AiPanel.tsx 中 continueChat() 做同样替换
- [ ] Step 4：`npm run typecheck` 确认无类型错误
- [ ] Step 5：`npm run build` 确认构建成功
- [ ] Step 6：手工测试：纯文本对话 + tool call + thinking 三个场景

### Task 2：新增 toolExecutor.ts 并重构工具执行

**目标**：将 memory 工具执行器和工具路由从 AiPanel 移到独立模块。

**文件**：
- 新增：`src/lib/toolExecutor.ts`
- 修改：`src/newtab/pages/AiPanel.tsx`
- 修改：`src/background/index.ts`（仅 import BookmarkToolResult）

**步骤**：
- [ ] Step 1：创建 `src/lib/toolExecutor.ts`，实现 `executeMemoryTool()`、`executeBackgroundTool()`、`lookupBookmarkName()`、`validateConfirmToolCall()`
- [ ] Step 2：background/index.ts 顶部新增 `import type { BookmarkToolResult } from "@/lib/aiTools"`
- [ ] Step 3：AiPanel.tsx 中删除 `executeTool`、`lookupName`、四个 memory 执行器、`normalizeToolId`、`validateConfirmToolCall`
- [ ] Step 4：AiPanel.tsx 中 handleToolCallDone 和 executeToolCalls 改为调用 toolExecutor 的函数
- [ ] Step 5：`npm run typecheck` + `npm run build`
- [ ] Step 6：手工测试：memory 工具 + bookmark 工具 + 参数验证 + 确认对话框

### Task 3：新增 systemPromptBuilder.ts

**目标**：将系统提示词构建逻辑从 AiPanel 移到独立模块。

**文件**：
- 新增：`src/lib/systemPromptBuilder.ts`
- 修改：`src/newtab/pages/AiPanel.tsx`

**步骤**：
- [ ] Step 1：创建 `src/lib/systemPromptBuilder.ts`，搬入 SYSTEM_PROMPT 常量和构建逻辑
- [ ] Step 2：AiPanel.tsx 中删除 SYSTEM_PROMPT 常量和 send() 中的构建逻辑
- [ ] Step 3：send() 中替换为 `buildSystemPrompt()` 调用
- [ ] Step 4：`npm run typecheck` + `npm run build`
- [ ] Step 5：手工测试：新建会话 + 书签摘要注入 + MCP 能力声明

### Task 4：统一 Anthropic 格式转换

**目标**：消除 chatAnthropic() 中与 toApiMessages() 重复的消息格式转换逻辑。

**文件**：
- 修改：`src/lib/ai.ts`

**步骤**：
- [ ] Step 1：扩展 `toApiMessages()` 增加 `provider` 参数，添加 Anthropic 分支
- [ ] Step 2：chatAnthropic() 改为调用 `toApiMessages(rest, { provider: "anthropic" })`
- [ ] Step 3：`npm run typecheck` + `npm run build`
- [ ] Step 4：手工测试：Anthropic provider 的对话 + tool call + thinking

### Task 5：最终验证与清理

**目标**：全量回归测试，确认所有改动无副作用。

**步骤**：
- [ ] Step 1：全量 typecheck + build
- [ ] Step 2：完整手工测试矩阵（见"验证方案"表格）
- [ ] Step 3：检查 AiPanel.tsx 行数（目标：从 1598 行减到 ~1100 行）
- [ ] Step 4：git diff 确认无意外改动
