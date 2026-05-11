# 用户画像与持久记忆 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 助手添加用户画像和持久记忆能力，支持手动编辑和自动学习。

**Architecture:** 两个新模块（IndexedDB 存储 + 自动学习），修改 AiPanel 注入上下文和 UI 面板。

**Tech Stack:** TypeScript, React 18, Chrome Extension MV3, IndexedDB

---

## 文件结构

| 操作 | 文件 |
|------|------|
| 新建 | `src/lib/aiUserDb.ts` |
| 新建 | `src/lib/aiAutoLearn.ts` |
| 修改 | `src/newtab/pages/AiPanel.tsx` |
| 修改 | `src/lib/i18n.ts` |

---

## Task 1: 创建 IndexedDB 存储层

**Files:**
- Create: `src/lib/aiUserDb.ts`

- [ ] **Step 1: 创建 aiUserDb.ts**

```typescript
/**
 * 用户画像与持久记忆（IndexedDB）
 * 单条记录存储，画像和记忆各一个 object store。
 */

const DB_NAME = "smart-bookmark-ai-user";
const DB_VERSION = 1;

interface UserEntry {
  id: string;
  entries: string[];
  updatedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("userProfile")) {
        db.createObjectStore("userProfile", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("userMemory")) {
        db.createObjectStore("userMemory", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getEntry(storeName: string, id: string): Promise<string[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(id);
      req.onsuccess = () => resolve(req.result?.entries ?? []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

async function setEntry(storeName: string, id: string, entries: string[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put({ id, entries, updatedAt: Date.now() });
}

// ── 画像 ──

export async function getProfile(): Promise<string[]> {
  return getEntry("userProfile", "profile");
}

export async function setProfile(entries: string[]): Promise<void> {
  return setEntry("userProfile", "profile", entries);
}

export async function addProfileEntries(newEntries: string[]): Promise<void> {
  const existing = await getProfile();
  const deduped = newEntries.filter(
    (e) => !existing.some((x) => x.includes(e) || e.includes(x)),
  );
  if (deduped.length > 0) {
    await setProfile([...existing, ...deduped]);
  }
}

// ── 记忆 ──

export async function getMemory(): Promise<string[]> {
  return getEntry("userMemory", "memory");
}

export async function setMemory(entries: string[]): Promise<void> {
  return setEntry("userMemory", "memory", entries);
}

export async function addMemoryEntries(newEntries: string[]): Promise<void> {
  const existing = await getMemory();
  const deduped = newEntries.filter(
    (e) => !existing.some((x) => x.includes(e) || e.includes(x)),
  );
  if (deduped.length > 0) {
    await setMemory([...existing, ...deduped]);
  }
}

export async function clearMemory(): Promise<void> {
  return setEntry("userMemory", "memory", []);
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/aiUserDb.ts
git commit -m "feat(ai): add IndexedDB storage for user profile and memory"
```

---

## Task 2: 创建自动学习模块

**Files:**
- Create: `src/lib/aiAutoLearn.ts`

- [ ] **Step 1: 创建 aiAutoLearn.ts**

```typescript
/**
 * AI 自动学习：会话结束时从对话中提取用户画像和记忆。
 * 静默执行，失败不影响用户体验。
 */

import type { AiMessage, Settings } from "@/types";
import { getProfile, addProfileEntries, getMemory, addMemoryEntries } from "@/lib/aiUserDb";

const LEARN_PROMPT = `分析以下对话，完成两个任务：

1. 提取关于用户身份的信息（姓名、角色、语言偏好），返回 JSON：
   {"profile": ["条目1", "条目2"]}

2. 提取事实、偏好、行为模式，返回 JSON：
   {"memory": ["条目1", "条目2"]}

规则：
- 每条一句话，简洁明了
- 只返回新信息，不要重复已有内容
- 如果某类信息不存在，返回空数组
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
 * @returns 是否成功（仅供内部判断，不暴露给调用者）
 */
export async function autoLearn(
  messages: AiMessage[],
  settings: Settings,
): Promise<boolean> {
  try {
    if (settings.aiProvider === "none" || !settings.aiApiKey) return false;

    // 统计对话轮次（用户消息数）
    const userMsgCount = messages.filter((m) => m.role === "user").length;
    if (userMsgCount < 5) return false;

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

    let result: { profile?: string[]; memory?: string[] } = {};

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
      if (!res.ok) return false;
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
      if (!res.ok) return false;
      const raw = await res.text();
      result = parseLearnResponse(raw);
    }

    // 合并并保存
    if (result.profile?.length) {
      const deduped = deduplicate(existingProfile, result.profile);
      if (deduped.length > 0) await addProfileEntries(deduped);
    }
    if (result.memory?.length) {
      const deduped = deduplicate(existingMemory, result.memory);
      if (deduped.length > 0) await addMemoryEntries(deduped);
    }

    return true;
  } catch {
    return false;
  }
}

/** 解析 AI 响应中的 JSON */
function parseLearnResponse(raw: string): { profile?: string[]; memory?: string[] } {
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

- [ ] **Step 2: 提交**

```bash
git add src/lib/aiAutoLearn.ts
git commit -m "feat(ai): add auto-learning module for profile and memory"
```

---

## Task 3: 添加 i18n 键

**Files:**
- Modify: `src/lib/i18n.ts`

- [ ] **Step 1: 在 zh 字典中添加键**

在 `src/lib/i18n.ts` 的 `zh` 字典中，找到 `ai.toolCancel` 行之后添加：

```typescript
  "ai.profile": "用户画像",
  "ai.profileHint": "每行一条信息，描述你的身份",
  "ai.memory": "持久记忆",
  "ai.memoryHint": "AI 从对话中学习的信息",
  "ai.memoryAdd": "添加",
  "ai.memoryPlaceholder": "输入一条记忆…",
  "ai.saved": "已保存",
```

- [ ] **Step 2: 在 en 字典中添加对应键**

在 `src/lib/i18n.ts` 的 `en` 字典中，找到对应的 `ai.toolCancel` 行之后添加：

```typescript
  "ai.profile": "User Profile",
  "ai.profileHint": "One piece of info per line about your identity",
  "ai.memory": "Persistent Memory",
  "ai.memoryHint": "Information AI learned from conversations",
  "ai.memoryAdd": "Add",
  "ai.memoryPlaceholder": "Add a memory…",
  "ai.saved": "Saved",
```

- [ ] **Step 3: 提交**

```bash
git add src/lib/i18n.ts
git commit -m "feat(i18n): add keys for profile and memory UI"
```

---

## Task 4: AiPanel 注入画像/记忆到系统提示词 + UI 面板 + 自动学习触发

**Files:**
- Modify: `src/newtab/pages/AiPanel.tsx`

这是最大的任务，分三步：系统提示词注入、UI 面板、自动学习触发。

- [ ] **Step 1: 添加导入和状态**

在 `src/newtab/pages/AiPanel.tsx` 文件顶部的 import 中添加：

```typescript
import {
  getProfile,
  setProfile,
  getMemory,
  setMemory,
  addMemoryEntries,
} from "@/lib/aiUserDb";
import { autoLearn } from "@/lib/aiAutoLearn";
```

在 `lucide-react` import 中添加图标：

```typescript
import {
  Send,
  Sparkles,
  Square,
  Flame,
  Loader2,
  Plus,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  User,       // 新增
  Brain,      // 新增
  X,          // 新增
} from "lucide-react";
```

在组件内的状态声明区域（`confirmToolCall` 之后）添加：

```typescript
  /* ── 画像/记忆面板状态 ── */
  const [activePanel, setActivePanel] = useState<"profile" | "memory" | null>(null);
  const [profileText, setProfileText] = useState("");
  const [memoryEntries, setMemoryEntries] = useState<string[]>([]);
  const [memoryInput, setMemoryInput] = useState("");
```

- [ ] **Step 2: 添加面板加载/保存函数**

在 `cancelToolCall` 函数之后，`continueChat` 函数之前添加：

```typescript
  /* ── 画像/记忆面板 ── */
  const togglePanel = async (panel: "profile" | "memory") => {
    if (activePanel === panel) {
      setActivePanel(null);
      return;
    }
    setActivePanel(panel);
    if (panel === "profile") {
      const entries = await getProfile();
      setProfileText(entries.join("\n"));
    } else {
      const entries = await getMemory();
      setMemoryEntries(entries);
    }
  };

  const saveProfile = async () => {
    const entries = profileText.split("\n").map((l) => l.trim()).filter(Boolean);
    await setProfile(entries);
    toast(t("ai.saved"), "success");
  };

  const addMemory = async () => {
    const text = memoryInput.trim();
    if (!text) return;
    await addMemoryEntries([text]);
    setMemoryEntries((prev) => [...prev, text]);
    setMemoryInput("");
  };

  const removeMemory = async (index: number) => {
    const next = memoryEntries.filter((_, i) => i !== index);
    setMemoryEntries(next);
    await setMemory(next);
  };
```

- [ ] **Step 3: 修改系统提示词构建**

在 `send()` 函数中，找到构建 `forApi` 的部分（`const bookmarkCtx = ...` 之后），修改为：

```typescript
    const bookmarkCtx = await getBookmarkContextForAi();
    const [profileEntries, memoryEntriesData] = await Promise.all([
      getProfile(),
      getMemory(),
    ]);

    // 构建画像/记忆上下文
    let userContext = "";
    if (profileEntries.length > 0) {
      userContext += `## 用户画像\n${profileEntries.map((e) => `- ${e}`).join("\n")}`;
    }
    if (memoryEntriesData.length > 0) {
      if (userContext) userContext += "\n\n";
      userContext += `## 持久记忆\n${memoryEntriesData.map((e) => `- ${e}`).join("\n")}`;
    }

    const systemContent = userContext
      ? `${SYSTEM_PROMPT}\n\n---\n${bookmarkCtx}\n\n---\n${userContext}`
      : `${SYSTEM_PROMPT}\n\n---\n${bookmarkCtx}`;

    const convo = messages.filter((m) => m.role !== "system");
    const forApi: AiMessage[] = [
      { role: "system", content: systemContent },
      ...convo,
      { role: "user", content: text },
    ];
```

同样修改 `continueChat()` 中的系统提示词构建：

```typescript
  const continueChat = async (conversationHistory: AiMessage[]) => {
    const bookmarkCtx = await getBookmarkContextForAi();
    const [profileEntries, memoryEntriesData] = await Promise.all([
      getProfile(),
      getMemory(),
    ]);

    let userContext = "";
    if (profileEntries.length > 0) {
      userContext += `## 用户画像\n${profileEntries.map((e) => `- ${e}`).join("\n")}`;
    }
    if (memoryEntriesData.length > 0) {
      if (userContext) userContext += "\n\n";
      userContext += `## 持久记忆\n${memoryEntriesData.map((e) => `- ${e}`).join("\n")}`;
    }

    const systemContent = userContext
      ? `${SYSTEM_PROMPT}\n\n---\n${bookmarkCtx}\n\n---\n${userContext}`
      : `${SYSTEM_PROMPT}\n\n---\n${bookmarkCtx}`;

    const forApi: AiMessage[] = [
      { role: "system", content: systemContent },
      ...conversationHistory,
    ];
```

- [ ] **Step 4: 在 send() 末尾触发自动学习**

在 `send()` 函数的 `finally` 块之前（`setMessages((prev) => { persist(prev); return prev; });` 之后），添加自动学习触发：

```typescript
    // 触发自动学习（静默，不阻塞）
    autoLearn(messagesRef.current, settings);
```

- [ ] **Step 5: 添加 UI 面板渲染**

在 AI 面板的 header 区域（`<header className="mb-3 ...">` 的 `<div className="flex items-center gap-2">` 中），在模型状态标签之后添加画像/记忆按钮：

```tsx
            <button
              type="button"
              onClick={() => togglePanel("profile")}
              className={cn(
                "rounded p-1 transition hover:bg-muted",
                activePanel === "profile" && "bg-muted",
              )}
              title={t("ai.profile")}
            >
              <User className="h-4 w-4 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => togglePanel("memory")}
              className={cn(
                "rounded p-1 transition hover:bg-muted",
                activePanel === "memory" && "bg-muted",
              )}
              title={t("ai.memory")}
            >
              <Brain className="h-4 w-4 text-muted-foreground" />
            </button>
```

在聊天区域 `<div className="flex flex-1 flex-col gap-3 overflow-hidden px-4 pb-3">` 的最前面（`<div ref={scrollRef}` 之前），添加面板渲染：

```tsx
          {/* ── 画像/记忆编辑面板 ── */}
          {activePanel && (
            <div className="shrink-0 rounded-lg border p-4" style={{ borderColor: "hsl(var(--claude-rule))" }}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">
                  {activePanel === "profile" ? t("ai.profile") : t("ai.memory")}
                </span>
                <button
                  type="button"
                  onClick={() => setActivePanel(null)}
                  className="rounded p-1 transition hover:bg-muted"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
              {activePanel === "profile" ? (
                <div>
                  <textarea
                    value={profileText}
                    onChange={(e) => setProfileText(e.target.value)}
                    placeholder={t("ai.profileHint")}
                    className="h-32 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                    style={{ borderColor: "hsl(var(--claude-rule))" }}
                  />
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" onClick={saveProfile}>{t("common.save")}</Button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-2 max-h-40 space-y-1 overflow-auto">
                    {memoryEntries.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t("ai.memoryHint")}</p>
                    ) : (
                      memoryEntries.map((entry, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50">
                          <span className="min-w-0 flex-1 truncate">{entry}</span>
                          <button
                            type="button"
                            onClick={() => removeMemory(i)}
                            className="shrink-0 rounded p-0.5 text-muted-foreground/50 transition hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={memoryInput}
                      onChange={(e) => setMemoryInput(e.target.value)}
                      placeholder={t("ai.memoryPlaceholder")}
                      onKeyDown={(e) => { if (e.key === "Enter") addMemory(); }}
                    />
                    <Button size="sm" onClick={addMemory}>{t("ai.memoryAdd")}</Button>
                  </div>
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 6: 提交**

```bash
git add src/newtab/pages/AiPanel.tsx
git commit -m "feat(ai): integrate profile/memory into AI panel with auto-learning"
```

---

## Task 5: 构建验证

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
git commit -m "chore: rebuild dist with profile and memory features"
```
