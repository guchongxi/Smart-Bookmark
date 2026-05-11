# 本地 Web 工具设计文档

## 背景

AI 助手的 `web_reader` 和 `web_search` 工具原本依赖智谱 GLM 的 MCP 远程服务，需要 API Key 且连通不稳定。改为本地实现，不依赖第三方服务。

## 目标

用本地实现替换智谱 MCP 依赖，保持相同的 `web_reader` / `web_search` 工具接口，AI 助手无感知切换。

## 架构

```
AiPanel (tool_call: web_reader / web_search)
  → background 消息路由（不变）
  → 本地实现替换 MCP 调用
    ├── web_reader: fetch URL → 解析 HTML → 提取纯文本
    └── web_search: fetch DuckDuckGo → 解析搜索结果 → 返回摘要
```

## 变更范围

| 文件 | 变更 |
|------|------|
| `src/lib/webTools.ts`（新增） | 本地 web_reader + web_search 实现 |
| `src/background/index.ts` | `executeMcpTool` 改为调用本地实现，移除 mcpClient 导入 |
| `src/lib/mcpClient.ts`（删除） | 不再需要 MCP 客户端 |
| `src/lib/aiTools.ts` | 移除 `MCP_TOOL_NAMES`，工具描述微调 |
| `src/newtab/pages/Settings.tsx` | MCP 设置卡片简化（移除 API Key 和连通性测试，只保留开关） |
| `src/types/index.ts` | 移除 `mcpApiKey` 字段 |
| `src/lib/i18n.ts` | MCP 相关文案调整 |

## 核心逻辑

### web_reader

1. background `fetch` 目标 URL（复用已有的 CORS 代理能力）
2. 解析 HTML，按优先级提取内容：
   - `<article>` 标签内容
   - `<main>` 标签内容
   - `<body>` 标签内容
3. 去除 `<script>`、`<style>`、`<nav>`、`<header>`、`<footer>` 等非内容标签
4. 提取纯文本，截断到 ~8000 字符
5. 返回 `{ success, message, data: { title, content, url } }`

### web_search

1. background `fetch` `https://html.duckduckgo.com/html/?q=QUERY`
2. 解析搜索结果 HTML，提取每条结果的：
   - 标题（`.result__title`）
   - 摘要（`.result__snippet`）
   - URL（`.result__url`）
3. 返回 top 5 结果，格式化为可读文本
4. 返回 `{ success, message, data: { results } }`

## 成功标准

1. AI 助手调用 `web_reader` 能获取网页内容
2. AI 助手调用 `web_search` 能搜索并返回结果
3. 不依赖任何第三方 API / API Key
4. Settings 中 MCP 开关保留，移除 API Key 和连通性测试
5. `npm run typecheck` 通过
