# AI 面板 4 项修复 设计规格

> 修复 4 个已知问题：书签快照重复注入、思考区域滚动、标签文案、自动学习反馈。

## 问题清单

| # | 问题 | 根因 | 影响 |
|---|------|------|------|
| 1 | 书签快照重复注入导致 AI 混乱 | `continueChat()` 重新拉取快照，包含刚添加的书签 | AI 误以为重复添加 |
| 2 | 思考区域不自动滚动 | ThinkingBlock 内部 div 无 scroll-to-bottom 逻辑 | 思考中时用户以为无响应 |
| 3 | 聊天标签生硬 | i18n 文案 "你"/"代理" 不自然 | 体验差 |
| 4 | 自动学习无反馈 | fire-and-forget 调用，无任何提示 | 用户不知道是否执行 |

---

## 修复 1: 书签快照重复注入

**方案：** `continueChat()` 不重新拉取快照，沿用本轮对话开始时的快照。

**改动：**
- `continueChat(conversationHistory)` → `continueChat(conversationHistory, bookmarkCtx)`
- `send()` 中保存 `bookmarkCtx`，在 tool call 后传给 `continueChat()`
- `cancelToolCall()` 中同样传入当前快照
- `continueChat()` 内部移除 `getBookmarkContextForAi()` 调用

**边界：** 用户手动发送新消息时（`send()`）仍会刷新快照，只有 tool call 后的 continue 不刷新。

---

## 修复 2: 思考区域自动滚动

**方案：** 仅"思考中"状态自动滚动，其他状态保持现状。

**三种状态：**
1. **思考中**（content 持续变化 + 限高）→ 自动滚动到底部，忽略用户滚动操作
2. **思考完成，内容流式输出**（自动折叠）→ 不需要滚动
3. **用户手动展开**（无限高，完整显示）→ 不需要滚动

**改动：**
- ThinkingBlock 给 content div 加 `ref`
- 加 `useEffect` 监听 `content` 变化
- 仅在 `expanded` 为 false 时（折叠状态 = 正在思考）执行自动滚动
- `scrollTop = scrollHeight` 滚到底部

---

## 修复 3: 标签文案

**改动：**

| key | zh（旧） | zh（新） | en（旧） | en（新） |
|-----|----------|----------|----------|----------|
| `ai.userLabel` | 你 | 我 | You | Me |
| `ai.assistantLabel` | 代理 | AI 助手 | Agent | AI Assistant |

同时修复 ThinkingBlock 中硬编码的 "思考过程" 文本，改为 `t("ai.thinkingProcess")`，新增 i18n key。

---

## 修复 4: 自动学习反馈

**方案：** `autoLearn()` 返回详细结果，执行后在对话流中插入 system 消息。

### 返回值变更

```typescript
// 旧
export async function autoLearn(...): Promise<boolean>

// 新
interface LearnResult {
  added: { text: string; reason: string }[];  // 新增的记忆
  message: string;  // 摘要文本
}

export async function autoLearn(...): Promise<LearnResult | null>
// null = 未触发（条件不满足）
// { added: [], message: "本次未新增记忆" } = 触发但无变化
// { added: [...], message: "新增 X 条记忆" } = 触发且有新增
```

### AI prompt 调整

学习 prompt 改为返回结构化结果：
```json
{
  "profile": ["条目1"],
  "memory": [
    { "text": "记忆内容", "reason": "原因" }
  ]
}
```

### 对话流展示

在 `send()` 中 await `autoLearn()` 结果，插入一条 system 消息：

```typescript
const learnResult = await autoLearn(messagesRef.current, settings);
if (learnResult) {
  setMessages((prev) => [...prev, {
    role: "system",
    content: learnResult.message,
    learnDetail: learnResult,  // 新增字段
  }]);
}
```

### UI 组件

新增 `LearnResultBlock` 组件：
- 默认折叠，显示图标 + 摘要文本（"记忆已更新：2 条新增"）
- 点击展开，显示每条新增记忆及其原因
- 无新增时显示"本次未新增记忆"+ 原因

---

## 文件结构

| 操作 | 文件 |
|------|------|
| 修改 | `src/lib/aiAutoLearn.ts` — 返回值从 boolean 改为 LearnResult |
| 修改 | `src/lib/i18n.ts` — 标签文案 + thinkingProcess key |
| 修改 | `src/newtab/pages/AiPanel.tsx` — 快照传递、思考滚动、标签、学习反馈 UI |
| 修改 | `src/types/index.ts` — AiMessage 新增 learnDetail 字段（可选） |

## 作用域

- 仅涉及 AI 面板（AiPanel.tsx）及相关 lib 文件
- 不影响其他页面
- 不引入新依赖
