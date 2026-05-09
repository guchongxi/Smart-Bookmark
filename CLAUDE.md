# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome/Edge 浏览器扩展（MV3），集成书签清理、新标签页看板、AI 助手、对比搜索、二维码、备份等功能。

## Build & Dev Commands

```bash
npm run build     # 生成图标 + tsc + vite build + postbuild，输出到 dist/
npm run dev       # Vite dev server（非扩展环境，仅 UI 调试用）
npm run zip       # 构建并打包 dist.zip（上传商店用）
npm run typecheck # 仅 TypeScript 类型检查，不输出
npm run icons     # 从 icon.svg 生成四个尺寸 PNG
```

dist/ 已随仓库提交，clone 后可直接在 chrome://extensions 加载 dist/ 目录使用。

## Architecture

### 多入口 Vite 构建

三个独立入口，各有自己的 HTML 和 JS：

- `src/newtab/` → 新标签页（主 UI，8 个子页面通过 hash 路由切换）
- `src/popup/` → 扩展弹窗
- `src/background/index.ts` → Service Worker（书签 API、右键菜单、消息路由）

路径别名 `@` → `src/`。

### 新标签页路由

`src/newtab/pages/` 下的页面通过 URL hash 参数 `#tab=` 切换：Dashboard、Cleaner、Compare、AiPanel、Settings、Backup、Discover。Dashboard 是默认首页。

### AI 工具调用流程

1. `src/lib/aiTools.ts` 定义 5 个书签工具的 JSON Schema（search/list/create/delete/move），分别适配 OpenAI 和 Anthropic 格式
2. `src/lib/ai.ts` 的 `chat()` 流式调用 API，通过 `onToolCall` 回调收集 tool call delta
3. `src/newtab/pages/AiPanel.tsx` 检测完整 tool call，需要确认的操作（delete/move）显示确认对话框
4. 确认后通过 `chrome.runtime.sendMessage({ type: "execute-bookmark-tool" })` 发送到 background
5. `src/background/index.ts` 的 `executeBookmarkTool()` 执行实际书签操作
6. 结果返回 AiPanel，追加 tool message 后继续对话

关键：background 的 `executeBookmarkTool` 是纯内存树遍历（不嵌套 chrome.bookmarks 回调），避免 MV3 service worker 中嵌套回调的不稳定行为。

### 数据存储

- `chrome.storage.local`：用户设置（键 `smart-bookmark::settings`）
- IndexedDB（via `src/lib/aiSessionDb.ts`）：AI 会话消息持久化
- IndexedDB（via `src/lib/bookmarkSummaryCache.ts`）：书签摘要缓存，书签变更时失效

### 国际化

`src/lib/i18n.ts` 提供 `t(key)` 函数，所有 UI 文本通过 key 获取。支持 zh/en，跟随系统或手动切换。

### 样式

Tailwind CSS，自定义主题通过 `src/lib/themePresets.ts` 定义预设（claude/linear/apple/stripe 等），叠加在 light/dark 模式之上。accent 颜色通过 CSS 变量注入。

## Key Conventions

- Chrome Extension MV3：background 是 service worker，不能用 DOM；消息通信走 `chrome.runtime.sendMessage` + `sendResponse`
- 所有书签 API 操作（create/remove/move/search）统一在 background 的 `executeBookmarkTool` 中执行
- `@` 别名用于所有 `src/` 下的导入
- 新增的 UI 文本需同时添加 zh 和 en 到 i18n.ts
- 设置项存 `chrome.storage.local`，键名前缀 `smart-bookmark::`
