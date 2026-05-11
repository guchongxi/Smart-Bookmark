# AI 面板 4 项修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 AI 面板的 4 个问题：书签快照重复注入、思考区域滚动、标签文案、自动学习反馈。

**Architecture:** 修改 4 个文件，不引入新文件。每个修复独立，可按顺序执行。

**Tech Stack:** TypeScript, React 18, Chrome Extension MV3

---

## 文件结构

| 操作 | 文件 |
|------|------|
| 修改 | `src/types/index.ts` — AiMessage 新增 learnDetail 字段 |
| 修改 | `src/lib/aiAutoLearn.ts` — 返回值从 boolean 改为 LearnResult |
| 修改 | `src/lib/i18n.ts` — 标签文案 + thinkingProcess key |
| 修改 | `src/newtab/pages/AiPanel.tsx` — 快照传递、思考滚动、标签、学习反馈 UI |

---

## Task 1: 修复书签快照重复注入

**Files:**
- Modify: `src/newtab/pages/AiPanel.tsx`

- [ ] **Step 1: 在组件内添加 bookmarkCtxRef**

在 `messagesRef` 声明之后（约第 98 行），添加一个 ref 保存当前快照：

```typescript
  /** 保存本轮对话的书签快照，continueChat 不重新拉取 */
  const bookmarkCtxRef = useRef<string>("");
```

- [ ] **Step 2: 修改 send() 中保存快照到 ref**

在 `send()` 函数中，找到 `const bookmarkCtx = await getBookmarkContextForAi();`（约第 361 行），在其后添加：

```typescript
    bookmarkCtxRef.current = bookmarkCtx;
```

- [ ] **Step 3: 修改 continueChat() 接收 bookmarkCtx 参数**

将 `continueChat` 函数签名从：

```typescript
  const continueChat = async (conversationHistory: AiMessage[]) => {
    const bookmarkCtx = await getBookmarkContextForAi();
```

改为：

```typescript
  const continueChat = async (conversationHistory: AiMessage[], bookmarkCtx?: string) => {
    const ctx = bookmarkCtx ?? bookmarkCtxRef.current;
```

同时将函数体内所有 `bookmarkCtx` 引用改为 `ctx`（约 3 处：构建 userContext 前的注释、systemContent 构建、profile/memory 读取后的 context 构建）。

- [ ] **Step 4: 修改 handleToolCallDone() 传入快照**

在 `handleToolCallDone()` 函数中，找到 `continueChat` 调用（约第 538 行）：

```typescript
    await continueChat([...messagesRef.current, assistantMsg, ...toolResults]);
```

改为：

```typescript
    await continueChat([...messagesRef.current, assistantMsg, ...toolResults], bookmarkCtxRef.current);
```

- [ ] **Step 5: 修改 cancelToolCall() 传入快照**

在 `cancelToolCall()` 函数中，找到 `continueChat` 调用（约第 584 行）：

```typescript
    continueChat([...messagesRef.current, cancelMsg]);
```

改为：

```typescript
    continueChat([...messagesRef.current, cancelMsg], bookmarkCtxRef.current);
```

- [ ] **Step 6: 提交**

```bash
git add src/newtab/pages/AiPanel.tsx
git commit -m "fix(ai): continueChat 复用本轮快照，避免书签重复注入导致 AI 混乱"
```

---

## Task 2: 思考区域自动滚动

**Files:**
- Modify: `src/newtab/pages/AiPanel.tsx`

- [ ] **Step 1: 修改 ThinkingBlock 组件**

将 ThinkingBlock 组件从当前代码（约第 1124-1158 行）：

```typescript
function ThinkingBlock({ content, expanded }: { content: string; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded ?? false);
  // 外部 expanded 变化时同步（思考阶段→展开，回复阶段→折叠）
  useEffect(() => {
    if (expanded !== undefined) setOpen(expanded);
  }, [expanded]);
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
        <div
          className="max-h-48 overflow-auto border-t border-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}
        >
          {content}
        </div>
      )}
    </div>
  );
}
```

替换为：

```typescript
function ThinkingBlock({ content, expanded }: { content: string; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded ?? false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 外部 expanded 变化时同步（思考阶段→展开，回复阶段→折叠）
  useEffect(() => {
    if (expanded !== undefined) setOpen(expanded);
  }, [expanded]);

  // 思考中（折叠状态）时自动滚到底部
  useEffect(() => {
    if (!open && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, open]);

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
        {t("ai.thinkingProcess")}
      </button>
      {open && (
        <div
          ref={contentRef}
          className="max-h-48 overflow-auto border-t border-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}
        >
          {content}
        </div>
      )}
    </div>
  );
}
```

关键变化：
1. 添加 `contentRef` 引用 content div
2. 添加 `useEffect` 监听 `content` 变化，当 `!open`（折叠 = 思考中）时自动 `scrollTop = scrollHeight`
3. "思考过程" 改为 `t("ai.thinkingProcess")`

- [ ] **Step 2: 提交**

```bash
git add src/newtab/pages/AiPanel.tsx
git commit -m "fix(ai): 思考区域自动滚动，思考中时跟随内容到底部"
```

---

## Task 3: 修复标签文案 + ThinkingBlock i18n

**Files:**
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: 修改 zh 字典中的标签**

在 `src/lib/i18n.ts` 的 `zh` 字典中，找到并修改：

```typescript
  "ai.userLabel": "我",
  "ai.assistantLabel": "AI 助手",
```

- [ ] **Step 2: 修改 en 字典中的标签**

在 `src/lib/i18n.ts` 的 `en` 字典中，找到并修改：

```typescript
  "ai.userLabel": "Me",
  "ai.assistantLabel": "AI Assistant",
```

- [ ] **Step 3: 在 zh 字典中添加 thinkingProcess key**

在 `zh` 字典的 `"ai.assistantLabel"` 行之后添加：

```typescript
  "ai.thinkingProcess": "思考过程",
```

- [ ] **Step 4: 在 en 字典中添加 thinkingProcess key**

在 `en` 字典的 `"ai.assistantLabel"` 行之后添加：

```typescript
  "ai.thinkingProcess": "Thinking",
```

- [ ] **Step 5: 提交**

```bash
git add src/lib/i18n.ts
git commit -m "fix(i18n): 优化聊天标签文案，ThinkingBlock 使用 i18n"
```

---

## Task 4: 自动学习返回详细结果 + AiMessage 类型更新

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/aiAutoLearn.ts`

- [ ] **Step 1: 在 AiMessage 中添加 learnDetail 字段**

在 `src/types/index.ts` 的 `AiMessage` 接口中，`thinking` 字段之后添加：

```typescript
  /** 自动学习结果详情 */
  learnDetail?: {
    added: { text: string; reason: string }[];
    message: string;
  };
```

- [ ] **Step 2: 修改 autoLearn() 返回值和 prompt**

将 `src/lib/aiAutoLearn.ts` 整体替换为：

```typescript
/**
 * AI 自动学习：会话结束时从对话中提取用户画像和记忆。
 * 静默执行，失败不影响用户体验。
 */

import type { AiMessage, Settings } from "@/types";
import { getProfile, addProfileEntries, getMemory, addMemoryEntries } from "@/lib/aiUserDb";

export interface LearnResult {
  added: { text: string; reason: string }[];
  message: string;
}

const LEARN_PROMPT = `分析以下对话，完成两个任务：

1. 提取关于用户身份的信息（姓名、角色、语言偏好），返回 JSON：
   {"profile": ["条目1", "条目2"]}

2. 提取事实、偏好、行为模式，返回 JSON：
   {"memory": [{"text": "记忆内容", "reason": "原因"}]}

规则：
- 每条一句话，简洁明了
- 只返回新信息，不要重复已有内容
- 如果某类信息不存在，返回空数组
- memory 中每条必须包含 text 和 reason
- 只返回 JSON，不要其他文字

已有画像：
{profile}

已有记忆：
{memory}

对话内容：
{conversation}`;

/** 从对话中提取最近 5-10 轮用户和 AI 消息 */
function extractConversationSummary(messages: AiMessage[]): string {
  const relevant = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );
  const recent = relevant.slice(-10);
  return recent
    .map((m) => `${m.role === "user" ? "用户" : "AI"}: ${m.content}`)
    .join("\n");
}

/** 去重：新条目与已有条目比较 */
function deduplicate(existing: string[], newEntries: string[]): string[] {
  return newEntries.filter(
    (e) => !existing.some((x) => x.includes(e) || e.includes(x)),
  );
}

/**
 * 触发自动学习。静默执行，所有错误被吞掉。
 * @returns LearnResult | null，null 表示未触发
 */
export async function autoLearn(
  messages: AiMessage[],
  settings: Settings,
): Promise<LearnResult | null> {
  try {
    if (settings.aiProvider === "none" || !settings.aiApiKey) return null;

    // 统计对话轮次（用户消息数）
    const userMsgCount = messages.filter((m) => m.role === "user").length;
    if (userMsgCount < 5) return null;

    const [existingProfile, existingMemory] = await Promise.all([
      getProfile(),
      getMemory(),
    ]);

    const conversation = extractConversationSummary(messages);
    const prompt = LEARN_PROMPT
      .replace("{profile}", existingProfile.join("\n") || "（无）")
      .replace("{memory}", existingMemory.join("\n") || "（无）")
      .replace("{conversation}", conversation);

    const base = (settings.aiBaseUrl ||
      (settings.aiProvider === "openai"
        ? "https://api.openai.com/v1"
        : "https://api.anthropic.com"
      ).replace(/\/+$/, ""));

    let result: { profile?: string[]; memory?: { text: string; reason: string }[] } = {};

    if (settings.aiProvider === "openai") {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.aiApiKey}`,
        },
        body: JSON.stringify({
          model: settings.aiModel || "gpt-4o-mini",
          max_tokens: 512,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) return null;
      const raw = await res.text();
      result = parseLearnResponse(raw);
    } else if (settings.aiProvider === "anthropic") {
      const res = await fetch(`${base}/v1/messages`, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.aiApiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: settings.aiModel || "claude-3-5-sonnet-latest",
          max_tokens: 512,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) return null;
      const raw = await res.text();
      result = parseLearnResponse(raw);
    }

    const added: { text: string; reason: string }[] = [];

    // 合并画像（画像去重用简单字符串比较）
    if (result.profile?.length) {
      const deduped = deduplicate(existingProfile, result.profile);
      if (deduped.length > 0) {
        await addProfileEntries(deduped);
        for (const text of deduped) {
          added.push({ text, reason: "身份信息" });
        }
      }
    }

    // 合并记忆
    if (result.memory?.length) {
      const memoryTexts = result.memory.map((m) => m.text);
      const dedupedTexts = deduplicate(existingMemory, memoryTexts);
      if (dedupedTexts.length > 0) {
        await addMemoryEntries(dedupedTexts);
        for (const item of result.memory) {
          if (dedupedTexts.includes(item.text)) {
            added.push(item);
          }
        }
      }
    }

    if (added.length === 0) {
      return { added: [], message: "本次对话未发现新信息" };
    }

    const summary = added.map((a) => a.text).join("、");
    return {
      added,
      message: `记忆已更新：新增 ${added.length} 条（${summary}）`,
    };
  } catch {
    return null;
  }
}

/** 解析 AI 响应中的 JSON */
function parseLearnResponse(raw: string): { profile?: string[]; memory?: { text: string; reason: string }[] } {
  try {
    const t = raw.trim();
    // 尝试提取 JSON 块
    const jsonMatch = t.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return {};
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {};
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add src/types/index.ts src/lib/aiAutoLearn.ts
git commit -m "feat(ai): autoLearn 返回详细学习结果，支持对话流展示"
```

---

## Task 5: AiPanel 集成自动学习反馈 UI

**Files:**
- Modify: `src/newtab/pages/AiPanel.tsx`

- [ ] **Step 1: 修改 send() 中 autoLearn 调用**

在 `send()` 函数中，找到自动学习触发代码（约第 452-453 行）：

```typescript
      // 触发自动学习（静默，不阻塞）
      autoLearn(messagesRef.current, settings);
```

替换为：

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

- [ ] **Step 2: 在消息渲染中添加 LearnResultBlock**

在 AiPanel.tsx 的消息渲染区域，找到 `m.thinking` 的渲染逻辑（约第 1071 行），在它之前添加 learnDetail 的渲染：

```tsx
                    {/* 自动学习结果 */}
                    {m.learnDetail && (
                      <LearnResultBlock detail={m.learnDetail} />
                    )}
```

- [ ] **Step 3: 添加 LearnResultBlock 组件**

在 `ThinkingBlock` 组件之前（约第 1124 行），添加新组件：

```tsx
function LearnResultBlock({ detail }: { detail: { added: { text: string; reason: string }[]; message: string } }) {
  const [open, setOpen] = useState(false);
  const t = useT();
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
        {detail.added.length > 0
          ? t("ai.learnUpdated").replace("{count}", String(detail.added.length))
          : t("ai.learnNoUpdate")}
      </button>
      {open && (
        <div className="border-t border-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {detail.added.length === 0 ? (
            <p>{detail.message}</p>
          ) : (
            <ul className="space-y-1">
              {detail.added.map((item, i) => (
                <li key={i}>
                  <span className="font-medium text-foreground/80">{item.text}</span>
                  <span className="ml-1 text-muted-foreground/70">— {item.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 在 i18n 中添加学习反馈 key**

在 `src/lib/i18n.ts` 的 `zh` 字典中，`ai.saved` 行之后添加：

```typescript
  "ai.learnUpdated": "记忆已更新：{count} 条新增",
  "ai.learnNoUpdate": "本次对话未发现新信息",
```

在 `en` 字典中，`ai.saved` 行之后添加：

```typescript
  "ai.learnUpdated": "Memory updated: {count} new items",
  "ai.learnNoUpdate": "No new information found in this conversation",
```

- [ ] **Step 5: 提交**

```bash
git add src/newtab/pages/AiPanel.tsx src/lib/i18n.ts
git commit -m "feat(ai): 自动学习结果以可折叠消息展示在对话流中"
```

---

## Task 6: 构建验证

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
git commit -m "chore: rebuild dist with AI panel bugfixes"
```
