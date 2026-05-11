# AI 自主记忆 Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 tool calling 替代固定轮次的 autoLearn，让 AI 自主决定何时保存用户画像和记忆。

**Architecture:** 新增 save_memory tool 定义，拦截执行不经过 background，删除 autoLearn 模块。

**Tech Stack:** TypeScript, React 18, Chrome Extension MV3

---

## 文件结构

| 操作 | 文件 |
|------|------|
| 修改 | `src/lib/aiTools.ts` — 新增 save_memory tool 定义 |
| 修改 | `src/newtab/pages/AiPanel.tsx` — 拦截执行 + 系统提示词 + 删除 autoLearn |
| 删除 | `src/lib/aiAutoLearn.ts` — 整个文件删除 |

---

## Task 1: 新增 save_memory tool 定义

**Files:**
- Modify: `src/lib/aiTools.ts`

- [ ] **Step 1: 在 BOOKMARK_TOOLS_OPENAI 末尾添加 save_memory**

在 `src/lib/aiTools.ts` 的 `BOOKMARK_TOOLS_OPENAI` 数组中，找到最后一个工具定义（`create_folder`），在它的 `},` 之后、数组闭合 `];` 之前，添加：

```typescript
  {
    type: "function" as const,
    function: {
      name: "save_memory",
      description: "当对话中发现用户身份信息或值得记住的事实、偏好、行为模式时，调用此工具保存到持久记忆",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["profile", "memory"],
            description: "profile=用户身份信息（姓名、职业、语言偏好），memory=事实、偏好、行为模式",
          },
          entries: {
            type: "array",
            items: { type: "string" },
            description: "要保存的信息条目，每条一句简洁描述",
          },
          reason: {
            type: "string",
            description: "保存原因（一句话说明为什么这条信息值得记住）",
          },
        },
        required: ["type", "entries", "reason"],
        additionalProperties: false,
      },
    },
  },
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/aiTools.ts
git commit -m "feat(ai): add save_memory tool definition"
```

---

## Task 2: 系统提示词新增记忆管理规则

**Files:**
- Modify: `src/newtab/pages/AiPanel.tsx`

- [ ] **Step 1: 在 SYSTEM_PROMPT 中追加记忆管理规则**

在 `src/newtab/pages/AiPanel.tsx` 的 `SYSTEM_PROMPT` 数组中，找到最后一个元素（`"Style: concise, ..."` 行），在它之后添加：

```typescript
  "",
  "## 记忆管理",
  "你有 save_memory 工具，用于持久记住关于用户的信息。当对话中出现以下情况时调用：",
  "- 用户明确透露身份信息（姓名、职业、角色、语言偏好）→ type: \"profile\"",
  "- 发现用户的偏好、习惯、行为模式、工作方式 → type: \"memory\"",
  "- 讨论中产生值得记住的结论或事实 → type: \"memory\"",
  "规则：",
  "- 只在有明确新信息时调用，不要为了调用而调用",
  "- 每条信息一句话，简洁浓缩",
  "- 如果用户明确要求你记住某事，务必调用",
  "- 不需要每次都调用，大多数对话不需要触发",
```

- [ ] **Step 2: 提交**

```bash
git add src/newtab/pages/AiPanel.tsx
git commit -m "feat(ai): add memory management rules to system prompt"
```

---

## Task 3: 拦截执行 save_memory + 删除 autoLearn

**Files:**
- Modify: `src/newtab/pages/AiPanel.tsx`
- Delete: `src/lib/aiAutoLearn.ts`

这是最大的任务，包含三部分：拦截执行、添加 executeSaveMemory 函数、删除 autoLearn。

- [ ] **Step 1: 删除 autoLearn 导入**

在 `src/newtab/pages/AiPanel.tsx` 顶部，删除 autoLearn 导入行：

```typescript
import { autoLearn } from "@/lib/aiAutoLearn";
```

- [ ] **Step 2: 删除 autoLearn 调用**

在 `send()` 函数中，删除 autoLearn 调用块（约第 455-464 行）：

```typescript
      // 触发自动学习，结果插入对话流
      autoLearn(messagesRef.current, settings).then((result) => {
        if (result) {
          setMessages((prev) => [
            ...prev,
            { role: "system", content: result.message, learnDetail: result },
          ]);
          persist(messagesRef.current);
        }
      });
```

- [ ] **Step 3: 在 AiPanel 组件内添加 executeSaveMemory 函数**

在 `handleToolCallDone` 函数之前（约第 491 行），添加：

```typescript
  /** 执行 save_memory 工具：直接写入 IndexedDB */
  const executeSaveMemory = async (args: Record<string, unknown>): Promise<BookmarkToolResult> => {
    try {
      const type = args.type as string;
      const entries = (args.entries as string[]) ?? [];
      const reason = (args.reason as string) ?? "";

      if (type === "profile") {
        await addProfileEntries(entries);
      } else if (type === "memory") {
        await addMemoryEntries(entries);
      } else {
        return { success: false, message: `未知类型: ${type}` };
      }

      // 在对话流中插入通知
      setMessages((prev) => [
        ...prev,
        { role: "system", content: `已记住：${entries.join("、")}` },
      ]);

      return { success: true, message: `已保存 ${entries.length} 条${type === "profile" ? "画像" : "记忆"}信息` };
    } catch {
      return { success: false, message: "保存失败" };
    }
  };
```

- [ ] **Step 4: 添加缺失的导入**

在 `src/newtab/pages/AiPanel.tsx` 顶部的 `@/lib/aiUserDb` 导入中，添加 `addProfileEntries`（当前已有 `addMemoryEntries`）：

```typescript
import {
  getProfile,
  setProfile,
  getMemory,
  setMemory,
  addProfileEntries,
  addMemoryEntries,
} from "@/lib/aiUserDb";
```

同时在 `@/lib/aiTools` 导入中，添加 `BookmarkToolResult`：

```typescript
import { BOOKMARK_TOOLS_OPENAI, BOOKMARK_TOOLS_ANTHROPIC, CONFIRM_REQUIRED_TOOLS, type BookmarkToolResult } from "@/lib/aiTools";
```

- [ ] **Step 5: 在 handleToolCallDone 中拦截 save_memory**

在 `handleToolCallDone` 函数的 for 循环中，在 `CONFIRM_REQUIRED_TOOLS` 检查之后、`executeToolCalls` 调用之前，添加 save_memory 拦截：

将：

```typescript
    for (const tc of toolCalls) {
      if (CONFIRM_REQUIRED_TOOLS.has(tc.name)) {
        // ... 确认逻辑 ...
        return;
      }
    }

    await executeToolCalls(toolCalls);
```

改为：

```typescript
    // 拦截 save_memory：直接在面板执行，不经过 background
    const saveMemoryCalls = toolCalls.filter((tc) => tc.name === "save_memory");
    const otherCalls = toolCalls.filter((tc) => tc.name !== "save_memory");

    for (const tc of saveMemoryCalls) {
      const result = await executeSaveMemory(tc.args);
      const assistantMsg: AiMessage = {
        role: "assistant",
        content: "",
        toolCalls: [tc],
      };
      const toolResult: AiMessage = {
        role: "tool",
        content: JSON.stringify(result),
        toolResult: { toolCallId: tc.id, ...result },
      };
      setMessages((prev) => [...prev, assistantMsg, toolResult]);
      setMessages((prev) => { persist(prev); return prev; });
    }

    if (otherCalls.length === 0) {
      // 全是 save_memory，直接继续对话
      await continueChat([...messagesRef.current], bookmarkCtxRef.current);
      return;
    }

    for (const tc of otherCalls) {
      if (CONFIRM_REQUIRED_TOOLS.has(tc.name)) {
        // ... 原有的确认逻辑保持不变 ...
        return;
      }
    }

    await executeToolCalls(otherCalls);
```

注意：需要保留原有的确认逻辑代码块（`CONFIRM_REQUIRED_TOOLS` 检查部分），只是在它前面插入 save_memory 拦截，并把 `toolCalls` 改为 `otherCalls`。

- [ ] **Step 6: 删除 aiAutoLearn.ts**

```bash
trash src/lib/aiAutoLearn.ts
```

- [ ] **Step 7: 提交**

```bash
git add src/newtab/pages/AiPanel.tsx
git add -u src/lib/aiAutoLearn.ts
git commit -m "feat(ai): replace autoLearn with save_memory tool, AI decides when to remember"
```

---

## Task 4: 构建验证

- [ ] **Step 1: 运行 typecheck**

```bash
npm run typecheck
```

Expected: 无错误

- [ ] **Step 2: 运行 build**

```bash
npm run build
```

Expected: 构建成功

- [ ] **Step 3: 提交 dist**

```bash
git add dist/
git commit -m "chore: rebuild dist with save_memory tool"
```
