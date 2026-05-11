# 系统提示词持久化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 系统提示词只在新建会话时构建一次，存入 IndexedDB，后续所有消息复用同一份，防止 AI 上下文错乱。

**Architecture:** AiSession 新增 systemPrompt 字段，send() 首次构建并持久化，continueChat() 直接复用。

**Tech Stack:** TypeScript, React 18, Chrome Extension MV3

---

## 文件结构

| 操作 | 文件 |
|------|------|
| 修改 | `src/types/index.ts` — AiSession 新增 systemPrompt 字段 |
| 修改 | `src/lib/aiSessionDb.ts` — updateSession 支持写入 systemPrompt |
| 修改 | `src/newtab/pages/AiPanel.tsx` — send()/continueChat() 使用持久化系统提示词 |

---

## Task 1: AiSession 类型 + updateSession 支持 systemPrompt

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/aiSessionDb.ts`

- [ ] **Step 1: 在 AiSession 中添加 systemPrompt 字段**

在 `src/types/index.ts` 的 `AiSession` 接口中（约第 205 行），`messages` 字段之后添加：

```typescript
  /** 会话创建时构建的系统提示词，后续消息复用 */
  systemPrompt?: string;
```

- [ ] **Step 2: 修改 updateSession 支持 systemPrompt**

在 `src/lib/aiSessionDb.ts` 的 `updateSession` 函数签名中（约第 86 行），添加 `systemPrompt` 参数：

将：
```typescript
export async function updateSession(
  id: string,
  messages: AiSession["messages"],
  title?: string,
): Promise<void> {
```

改为：
```typescript
export async function updateSession(
  id: string,
  messages: AiSession["messages"],
  title?: string,
  systemPrompt?: string,
): Promise<void> {
```

在函数体中，找到 `updated` 对象构建（约第 100 行），在 `...(title != null ? { title: title.slice(0, 30) } : {}),` 之后添加：

```typescript
    ...(systemPrompt != null ? { systemPrompt } : {}),
```

- [ ] **Step 3: 提交**

```bash
git add src/types/index.ts src/lib/aiSessionDb.ts
git commit -m "feat(ai): add systemPrompt field to AiSession, persist across messages"
```

---

## Task 2: AiPanel 使用持久化系统提示词

**Files:**
- Modify: `src/newtab/pages/AiPanel.tsx`

- [ ] **Step 1: 添加 systemPromptRef**

在 `bookmarkCtxRef` 声明之后（约第 111 行），添加：

```typescript
  /** 当前会话的系统提示词（新建时构建，后续复用） */
  const systemPromptRef = useRef<string>("");
```

- [ ] **Step 2: 修改 send() 构建系统提示词逻辑**

在 `send()` 函数中，找到系统提示词构建代码（约第 374-393 行）：

```typescript
    const bookmarkCtx = await getBookmarkContextForAi();
    bookmarkCtxRef.current = bookmarkCtx;
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
```

替换为：

```typescript
    let systemContent: string;

    if (systemPromptRef.current) {
      // 复用已有的系统提示词（从 session 恢复或之前构建的）
      systemContent = systemPromptRef.current;
    } else {
      // 首次构建系统提示词
      const bookmarkCtx = await getBookmarkContextForAi();
      bookmarkCtxRef.current = bookmarkCtx;
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

      systemContent = userContext
        ? `${SYSTEM_PROMPT}\n\n---\n${bookmarkCtx}\n\n---\n${userContext}`
        : `${SYSTEM_PROMPT}\n\n---\n${bookmarkCtx}`;

      // 持久化系统提示词到会话
      systemPromptRef.current = systemContent;
      if (sessionIdRef.current) {
        updateSession(sessionIdRef.current, [], undefined, systemContent);
      }
    }
```

- [ ] **Step 3: 修改 continueChat() 使用持久化系统提示词**

在 `continueChat()` 函数中，将当前的系统提示词构建代码（约第 688-706 行）：

```typescript
  const continueChat = async (conversationHistory: AiMessage[], bookmarkCtx?: string) => {
    const ctx = bookmarkCtx ?? bookmarkCtxRef.current;
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
      ? `${SYSTEM_PROMPT}\n\n---\n${ctx}\n\n---\n${userContext}`
      : `${SYSTEM_PROMPT}\n\n---\n${ctx}`;
```

替换为：

```typescript
  const continueChat = async (conversationHistory: AiMessage[], _bookmarkCtx?: string) => {
    // 直接复用系统提示词，不重新构建
    const systemContent = systemPromptRef.current;
```

注意：`bookmarkCtx` 参数保留但不再使用（保持调用方兼容），参数名改为 `_bookmarkCtx`。`systemPromptRef` 在 `send()` 首次构建时设置，或在 `loadSessions`/`switchSession` 时从 session 恢复。

- [ ] **Step 4: 在 loadSessions 时恢复 systemPromptRef**

在 `useEffect` 中加载会话列表时（约第 150-158 行），找到 `setMessages(list[0].messages);` 之后，添加：

```typescript
        systemPromptRef.current = list[0].systemPrompt ?? "";
```

- [ ] **Step 5: 在 switchSession 时恢复 systemPromptRef**

在 `switchSession` 回调中（约第 162-173 行），找到 `setMessages(s.messages);` 之后，添加：

```typescript
      systemPromptRef.current = s.systemPrompt ?? "";
```

- [ ] **Step 6: 提交**

```bash
git add src/newtab/pages/AiPanel.tsx
git commit -m "feat(ai): send/continueChat reuse persisted system prompt"
```

---

## Task 3: 构建验证

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
git commit -m "chore: rebuild dist with system prompt persistence"
```
