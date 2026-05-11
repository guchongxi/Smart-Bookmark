# 用户画像与持久记忆 设计规格

> 仿照 Hermes 的 USER.md / MEMORY.md，为 AI 赋予用户认知和跨会话记忆能力。

## 目标

让 AI 助手能够「认识」用户并「记住」跨会话的信息，提供更个性化的书签管理体验。

## 核心概念

### 用户画像 (USER.md)

最小化的身份信息，回答「用户是谁」。

**存储格式：** 纯字符串数组，每条一句浓缩信息。

```
entries: string[]
```

**示例内容：**
- `"张三"`
- `"全栈开发者"`
- `"偏好中文交流"`

**设计原则：** 只存身份相关的稳定信息，不存偏好、习惯、事件。画像由用户手动维护为主，AI 仅在对话中明确透露身份信息时自动补充。

### 持久记忆 (MEMORY.md)

事件、模式、偏好、结论的集合，回答「用户做了什么、喜欢什么、有什么模式」。

**存储格式：** 纯字符串数组，每条一句浓缩信息。

```
entries: string[]
```

**示例内容：**
- `"习惯按工作/生活分类书签"`
- `"关注 AI 和 Web3 领域"`
- `"多次询问前端框架书签整理"`
- `"对书签清理功能很感兴趣"`
- `"2026-05-09 讨论了如何整理 AI 相关书签"`

**设计原则：** 记忆由 AI 自动学习 + 用户手动维护。自动学习从对话中提取事实、偏好和模式。

## 数据存储

### IndexedDB 结构

使用独立的 IndexedDB 数据库 `smart-bookmark-ai-user`（与会话数据库分离）。

**Object Store: `userProfile`**
```
{
  id: "profile",          // 固定 key，单条记录
  entries: string[],      // 画像条目列表
  updatedAt: number       // 最后更新时间戳
}
```

**Object Store: `userMemory`**
```
{
  id: "memory",           // 固定 key，单条记录
  entries: string[],      // 记忆条目列表
  updatedAt: number       // 最后更新时间戳
}
```

### API 设计

```typescript
// 画像
getProfile(): Promise<string[]>
setProfile(entries: string[]): Promise<void>
addProfileEntries(entries: string[]): Promise<void>  // 追加，去重

// 记忆
getMemory(): Promise<string[]>
setMemory(entries: string[]): Promise<void>
addMemoryEntries(entries: string[]): Promise<void>   // 追加，去重
clearMemory(): Promise<void>
```

## 系统提示词注入

在 `AiPanel.tsx` 的 `send()` 和 `continueChat()` 中，构建 `forApi` 时读取画像和记忆，拼接到系统提示词末尾：

```
## 用户画像
- 张三
- 全栈开发者
- 偏好中文交流

## 持久记忆
- 习惯按工作/生活分类书签
- 关注 AI 和 Web3 领域
```

**注入位置：** 在 `SYSTEM_PROMPT` 和书签快照之后，作为系统提示词的最后一部分。

**空值处理：** 如果画像或记忆为空，对应区块不注入。

## AI 面板 UI

在 AI 面板聊天区域上方新增两个图标按钮：

### 入口

- **画像按钮**：点击展开/折叠画像编辑面板
- **记忆按钮**：点击展开/折叠记忆编辑面板

两个面板互斥，打开一个自动关闭另一个。

### 画像编辑面板

- 文本域（textarea），每行一条信息
- 底部「保存」按钮
- 保存时按行分割，过滤空行，更新 IndexedDB

### 记忆编辑面板

- 列表视图，每条记忆显示为一行，右侧有删除按钮
- 底部有输入框 + 「添加」按钮，支持手动新增
- 删除和添加后自动保存到 IndexedDB
- 列表支持滚动（记忆可能较多）

### 交互细节

- 面板展开时聊天区域自动收缩，不遮挡消息
- 面板有折叠动画（高度过渡）
- 保存后无需刷新，下次打开读取最新数据

## 自动学习机制

### 触发条件

会话结束时（`persist()` 最终调用时），同时满足：
1. 当前会话消息轮次 ≥ 5（用户和 AI 各算一轮）
2. AI provider 已配置（非 "none"）
3. API Key 可用

### 学习流程

1. **提取对话摘要**：取最近 5-10 轮对话内容
2. **构建学习 prompt**：发送给 AI 的请求：
   ```
   分析以下对话，完成两个任务：

   1. 提取关于用户身份的信息（姓名、角色、语言偏好），返回 JSON：
      {"profile": ["条目1", "条目2"]}

   2. 提取事实、偏好、行为模式，返回 JSON：
      {"memory": ["条目1", "条目2"]}

   规则：
   - 每条一句话，简洁明了
   - 只返回新信息，不要重复已有内容
   - 如果某类信息不存在，返回空数组
   - 只返回 JSON，不要其他文字

   已有画像：[当前画像]
   已有记忆：[当前记忆]
   对话内容：[对话摘要]
   ```
3. **解析响应**：AI 返回 JSON，解析为 `{ profile: string[], memory: string[] }`
4. **合并去重**：新条目与现有条目比较（简单字符串包含检查：`existing.some(e => e.includes(new) || new.includes(e))`），去重后追加
5. **静默保存**：写入 IndexedDB，不通知用户

### 学习 prompt 的 AI 调用

使用与当前会话相同的 AI provider 和 model，但：
- 不使用工具定义
- 不使用流式输出
- max_tokens 设置为 512
- 超时 10 秒
- 失败静默忽略，不影响用户体验

## 作用域

- 系统提示词注入：仅在 AI 面板的 `send()` 和 `continueChat()` 中
- 自动学习：仅在 AI 面板的 `send()` 结束时触发
- UI 编辑：仅在 AI 面板中
- 不影响其他页面（Dashboard、Cleaner 等）

## 文件结构

| 操作 | 文件 |
|------|------|
| 新建 | `src/lib/aiUserDb.ts` — IndexedDB 存储层 |
| 新建 | `src/lib/aiAutoLearn.ts` — 自动学习逻辑 |
| 修改 | `src/newtab/pages/AiPanel.tsx` — 注入画像/记忆到系统提示词 + UI 面板 + 自动学习触发 |
| 修改 | `src/types/index.ts` — 无需修改（string[] 无需新类型） |
| 修改 | `src/lib/i18n.ts` — 新增 UI 文本 key |
