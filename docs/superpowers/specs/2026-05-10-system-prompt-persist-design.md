# 系统提示词持久化 设计规格

> 系统提示词只在新建会话时构建一次，存入 IndexedDB，后续所有消息复用同一份。

## 问题

当前 `send()` 和 `continueChat()` 每轮都重新读取 bookmarks/profile/memory 拼接系统提示词：
- 画像/记忆通过 `getProfile()`/`getMemory()` 实时读取，可能在会话中变化
- 书签快照在 `send()` 时刷新，`continueChat()` 复用 ref
- AI 每轮看到的系统提示词可能不一致，导致上下文理解错乱

## 方案

系统提示词只在**新建会话时构建一次**，存入 `AiSession.systemPrompt` 字段。后续消息直接使用存储的版本。

### AiSession 类型扩展

```typescript
export interface AiSession {
  id: string;
  title: string;
  messages: AiMessage[];
  systemPrompt?: string;  // 新增：会话创建时构建的系统提示词
  createdAt: number;
  updatedAt: number;
}
```

### send() 逻辑变更

```
if (当前会话有 systemPrompt) {
  直接使用 session.systemPrompt
} else {
  构建 systemPrompt（读取 bookmarks + profile + memory）
  存入 session.systemPrompt
}
```

### continueChat() 逻辑变更

```
从 messagesRef 中找到当前会话的 systemPrompt，直接使用
不再调用 getBookmarkContextForAi() / getProfile() / getMemory()
```

### 不影响的功能

- 画像/记忆面板编辑：不提示，用户自行管理
- 书签快照：仍按需刷新（首次构建时）
- 工具定义：不变，仍通过 chat() 传入 API

## 文件结构

| 操作 | 文件 |
|------|------|
| 修改 | `src/types/index.ts` — AiSession 新增 systemPrompt 字段 |
| 修改 | `src/newtab/pages/AiPanel.tsx` — send()/continueChat() 使用持久化系统提示词 |
| 不改 | `src/lib/aiSessionDb.ts` — IndexedDB 存储自动兼容新字段 |
