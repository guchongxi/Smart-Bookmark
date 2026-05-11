# AI 自主记忆 Tool 设计规格

> 用 tool calling 替代固定轮次的 autoLearn，让 AI 自主决定何时保存用户画像和记忆。

## 背景

当前 autoLearn 在每轮对话后固定触发（≥5 轮），独立调用 API 提取记忆。问题：
- 不管对话内容是否有价值，都会触发
- 额外 API 调用，增加延迟和成本
- AI 无法主动记住对话中的关键信息

## 方案

新增 `save_memory` tool，AI 在对话中自主判断何时调用，直接写入 IndexedDB。

## Tool 定义

### OpenAI 格式

```json
{
  "type": "function",
  "function": {
    "name": "save_memory",
    "description": "当对话中发现用户身份信息或值得记住的事实、偏好、行为模式时，调用此工具保存到持久记忆",
    "parameters": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": ["profile", "memory"],
          "description": "profile=用户身份信息（姓名、职业、语言偏好），memory=事实、偏好、行为模式"
        },
        "entries": {
          "type": "array",
          "items": { "type": "string" },
          "description": "要保存的信息条目，每条一句简洁描述"
        },
        "reason": {
          "type": "string",
          "description": "保存原因（一句话说明为什么这条信息值得记住）"
        }
      },
      "required": ["type", "entries", "reason"],
      "additionalProperties": false
    }
  }
}
```

### Anthropic 格式

同上，映射为 `{ name, description, input_schema }` 格式。

## 系统提示词规则

在 `SYSTEM_PROMPT` 末尾追加：

```
## 记忆管理
你有 save_memory 工具，用于持久记住关于用户的信息。当对话中出现以下情况时调用：
- 用户明确透露身份信息（姓名、职业、角色、语言偏好）→ type: "profile"
- 发现用户的偏好、习惯、行为模式、工作方式 → type: "memory"
- 讨论中产生值得记住的结论或事实 → type: "memory"
规则：
- 只在有明确新信息时调用，不要为了调用而调用
- 每条信息一句话，简洁浓缩
- 如果用户明确要求你记住某事，务必调用
- 不需要每次都调用，大多数对话不需要触发
```

## 执行流程

```
AI 调用 save_memory → handleToolCallDone() 拦截
  → 不经过 background（save_memory 不在 CONFIRM_REQUIRED_TOOLS 中）
  → 直接在面板中调用 addProfileEntries() 或 addMemoryEntries()
  → 返回 tool result 消息（成功/失败）
  → 在对话流中显示一条通知
```

### 关键：拦截执行

`handleToolCallDone()` 中，对 `save_memory` tool 进行拦截：

```typescript
if (tc.name === "save_memory") {
  // 直接执行，不经过 background
  const result = await executeSaveMemory(tc.args);
  toolResults.push({
    role: "tool",
    content: JSON.stringify(result),
    toolResult: { toolCallId: tc.id, ...result },
  });
  continue; // 跳过 executeTool 调用
}
```

### 通知显示

执行成功后，在对话流中插入一条 system 消息：

```typescript
{
  role: "system",
  content: `已记住：${entries.join("、")}`,
}
```

简单文本，不使用 LearnResultBlock 的折叠 UI（因为 tool call 本身就在对话中可见）。

## 删除 autoLearn

- 删除 `src/lib/aiAutoLearn.ts` 文件
- 从 `src/newtab/pages/AiPanel.tsx` 中移除 `import { autoLearn }` 和 `autoLearn()` 调用
- `src/types/index.ts` 中的 `learnDetail` 字段保留（不破坏已有数据），但不再使用
- `src/lib/i18n.ts` 中的 `ai.learnUpdated` / `ai.learnNoUpdate` 保留（不再触发）

## 文件结构

| 操作 | 文件 |
|------|------|
| 修改 | `src/lib/aiTools.ts` — 新增 save_memory tool 定义 |
| 修改 | `src/newtab/pages/AiPanel.tsx` — 拦截执行 + 系统提示词 + 删除 autoLearn |
| 删除 | `src/lib/aiAutoLearn.ts` — 整个文件删除 |
| 不改 | `src/types/index.ts` — learnDetail 保留，不破坏兼容性 |
| 不改 | `src/lib/i18n.ts` — 学习相关 key 保留 |

## 与现有工具的关系

- `save_memory` 不在 `CONFIRM_REQUIRED_TOOLS` 中（不需用户确认）
- 执行在面板侧完成，不经过 background service worker
- 不影响现有 6 个书签操作工具
