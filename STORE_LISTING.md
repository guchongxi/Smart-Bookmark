# 扩展商店上架素材

> 本文件是上架 **Chrome Web Store** 与 **Microsoft Edge Add-ons** 的文案与权限说明模板，直接复制粘贴到各自后台。  
> 每次发版前请更新 `version` 字段并同步截图。

---

## 基本信息

| 字段 | 内容 |
|---|---|
| **Extension name (EN)** | Smart Bookmark - Cleaner & New Tab |
| **扩展名称（中文）** | Smart Bookmark - 书签清理 + 新标签页 |
| **Short name** | SmartBookmark |
| **Version** | 0.2.0 |
| **Category / 类别** | Productivity / 生产力工具 |
| **Language / 语言** | Chinese (Simplified) + English |
| **Homepage** | https://github.com/xiaoniuge36/Smart-Bookmark |
| **Support URL** | https://github.com/xiaoniuge36/Smart-Bookmark/issues |
| **Privacy Policy URL** | https://xiaoniuge36.github.io/Smart-Bookmark/privacy.html |
| **License** | MIT |

---

## 简短描述（Short description）

> Chrome ≤ 132 字符 · Edge ≤ 132 字符

**中文（121 字符）**
```
书签清理 + 新标签页看板 + AI 搜索，三合一浏览器扩展。一键检测失效、重复、空文件夹；自定义新标签页；侧边栏与悬浮球随手可用。
```

**English (131 chars)**
```
Smart bookmarks: clean invalids & duplicates, new-tab dashboard, AI search, side panel & floating widget. 100% local.
```

---

## 详细描述（Detailed description）

### 中文版

```markdown
Smart Bookmark 是一款把「书签清理器」和「书签型新标签页」合二为一的浏览器扩展，致敬 LazyCat Bookmark Cleaner 与 TabMark。所有核心功能 100% 本地运行，不上传你的书签数据。

🧹 书签清理中心
• 一键扫描失效链接（可选开启，基于 HEAD 探测）
• 智能检测重复书签（自动忽略 utm_、hash 等噪声参数）
• 找出空文件夹与异常 URL
• 扫描前预览，按类别分组勾选，安全放心
• 生成书签画像：总数、Top 域名、近 30 天新增

📑 新标签页书签看板
• 文件夹侧栏，一键指定常用文件夹作为主页
• favicon 卡片、舒适/紧凑两种密度
• 自定义壁纸 + 暗黑模式（跟随系统 / 浅色 / 深色）
• 搜索命中书签直接跳转，未命中自动走搜索引擎

✨ AI 智能助手
• 支持 OpenAI / Anthropic，API Key 仅保存在本地
• 流式输出，支持随时打断
• 可基于你的书签上下文提问

🔍 对比搜索
• 多个搜索引擎并排对比同一关键词
• Cmd/Ctrl+Enter 一键全开

📌 侧边栏 + 悬浮球
• Alt+B / ⌘+B 任意网页唤出书签侧边栏
• 网页右上角可选悬浮球，快速访问常用书签
• 实时响应书签变更

📤 备份与导出
• 一键导出 JSON / HTML 备份
• 清理前自动保存快照

🔒 隐私优先
• 100% 本地运行（除你主动发起的 AI 对话）
• 不运营服务器，不收集任何数据，不分析用户行为
• 代码完全开源（MIT）

👉 快捷键
• Alt+B / ⌘+B：打开侧边栏
• Alt+Shift+C：打开清理中心
• Alt+Shift+F：切换悬浮球
```

### English

```markdown
Smart Bookmark combines a bookmark cleaner with a bookmark-powered new-tab dashboard. Inspired by LazyCat Bookmark Cleaner and TabMark. 100% local — your bookmarks never leave your device.

🧹 Cleaner
• Scan for invalid links (opt-in, HEAD probes)
• Smart duplicate detection (normalizes utm_, hash, trailing slash)
• Find empty folders and malformed URLs
• Preview before cleaning, grouped check-boxes
• Bookmark profile: totals, top domains, recent activity

📑 New Tab Dashboard
• Folder sidebar, pin any folder as your home
• Favicon cards, comfy / compact density
• Custom wallpaper + dark mode (system / light / dark)
• Search hits jump instantly; misses fall back to your search engine

✨ AI Assistant
• OpenAI / Anthropic, API key stored locally only
• Streaming output, interruptible
• Ask questions grounded in your bookmarks

🔍 Compare Search
• Query multiple engines side-by-side
• Cmd/Ctrl+Enter to open all

📌 Side Panel + Floating Widget
• Alt+B / ⌘+B from any page
• Optional floating ball for one-click access
• Live-updates as bookmarks change

📤 Backup & Export
• Export JSON / HTML with one click
• Auto-snapshot before cleaning

🔒 Privacy First
• 100% local (except AI chats YOU initiate)
• No servers, no analytics, no tracking
• Fully open source (MIT)

👉 Shortcuts
• Alt+B / ⌘+B: open side panel
• Alt+Shift+C: open cleaner
• Alt+Shift+F: toggle floating ball
```

---

## 权限说明（Permissions Justifications）

> 两家商店都会要求你逐条解释；直接贴下面的文字到对应输入框。

### 单个权限说明

| Permission | 中文说明 | English |
|---|---|---|
| `bookmarks` | 读取与整理用户书签，为清理、画像、搜索等核心功能提供数据。 | Read and organize user bookmarks for core features: clean, profile, and search. |
| `storage` | 将用户界面偏好（主题、壁纸、搜索引擎、密度）以及用户自行填入的 AI API Key 保存在 `chrome.storage.local`。仅本机，不上传。 | Persist UI preferences (theme, wallpaper, engine, density) and the user-provided AI API key in `chrome.storage.local`. Local-only, never uploaded. |
| `contextMenus` | 注册右键菜单："在 Smart Bookmark 中搜索选中文字"、扩展图标上的清理入口。 | Register right-click actions like "Search bookmarks for selection" and quick access to cleaner from the action icon. |
| `history` | 在新标签页中，对浏览历史与书签进行统一的关键词搜索。 | Provide unified keyword search across bookmarks and browsing history in new tab. |
| `topSites` | 在新标签页展示"常用站点"快捷入口，数据来自浏览器本地，仅内存读取。 | Display a "Most Visited" shortcut row on the new tab, read in-memory from the browser's local list. |
| `tabs` | 当用户从弹窗或右键菜单触发动作时，打开新标签页（例如打开清理中心、AI 面板）。 | Open new tabs when the user triggers actions from the popup or context menu (e.g., open the cleaner or AI panel). |
| `scripting` | 当用户启用"网页悬浮球"功能时，注入一个可交互的悬浮 UI 到页面右上角。可在设置中随时关闭。 | Inject the optional floating widget to the top-right of pages when the user enables it in Settings. Toggleable. |
| Host: `https://*/*` | 用途 1：失效链接扫描时，向书签对应域名发起 `HEAD` 请求检测可达性（不读取页面内容）。用途 2：悬浮球注入。 | (1) HEAD probes against bookmarked domains during link-liveness scan (does NOT read page contents). (2) Floating widget injection. |
| Host: `http://localhost/*`, `http://127.0.0.1/*` | 支持本地开发环境的书签（localhost / 127.0.0.1）参与扫描。 | Include localhost / 127.0.0.1 bookmarks in scans (for developers). |
| `chrome_url_overrides.newtab` | 替换默认新标签页，显示书签看板。 | Replace the default new tab with the bookmark dashboard. |

### 单独问答题：Why does this extension need "broad host access"?

**EN:**
> The extension performs link-liveness checks against the user's own bookmarks (which may be on any domain) using HEAD requests. It also injects an optional on-page floating widget that offers quick access to bookmarks and selection-to-bookmark-search. No page contents are read or exfiltrated. All logic runs locally; no data is sent to any server we operate.

**中文:**
> 扩展需要对用户自己收藏的书签做可达性检测（书签可能在任何域名上），通过 HEAD 请求实现。同时，悬浮球功能需要向网页注入一段可交互 UI（可在设置中关闭）。扩展**不读取**网页内容，也不把数据发回任何我们运营的服务器——我们没有服务器。

### 单独问答题：Remote Code Usage

**EN / 中文:**
> **No remote code.** All JavaScript is bundled at build time; no dynamic `import()` of external URLs, no `eval` on network payloads. AI chat is a plain `fetch` POST with JSON — data only, not executable code.

### 单独问答题：Data Usage Disclosure（Chrome 隐私标签必填）

Chrome 后台会让你勾选 "What user data does this extension handle?"，按此勾选：

| 分类 | 是否勾选 | 理由 |
|---|---|---|
| Personally identifiable information | ❌ 否 | 不收集 |
| Health information | ❌ 否 | - |
| Financial and payment information | ❌ 否 | - |
| Authentication information | ❌ 否 | API Key 仅存本地、不上传 |
| Personal communications | ❌ 否 | - |
| Location | ❌ 否 | - |
| Web history | ✅ 是 | 用 `history` 权限做本地统一搜索 |
| User activity | ❌ 否 | - |
| Website content | ❌ 否 | 扩展不读取页面内容 |

三条下方的声明全部勾选：
- ✅ I do not sell or transfer user data to third parties
- ✅ I do not use or transfer user data for purposes unrelated to my item's single purpose
- ✅ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Single purpose statement（必填）：**
> EN: Smart Bookmark helps users organize, visualize, search, and clean their browser bookmarks from a unified new-tab dashboard and side panel.  
> 中文：Smart Bookmark 帮助用户在统一的新标签页看板和侧边栏中，整理、可视化、搜索与清理浏览器书签。

---

## Certification Notes（Edge 必填 / Chrome 可选）

贴到 Edge 后台的 "Notes for the certification team"：

```text
Thanks for reviewing Smart Bookmark!

## How to test
1. After install, open a new tab — you will see the bookmark dashboard.
2. Click "Cleaner" tab → "Start scan" (leave "detect invalid links" off for a quick pass). The cleaner will find duplicate bookmarks, empty folders, etc. No bookmarks are removed until you press "Clean selected".
3. Press Alt+B (Cmd+B on Mac) anywhere to open the side panel.
4. AI Assistant tab: disabled by default. To test, go to Settings → AI → choose a Provider and paste your own API key (we cannot provide one).

## Privacy & data
- No servers operated by us. No telemetry.
- All data stays in `chrome.storage.local`.
- AI requests (if enabled) go directly from the user's browser to api.openai.com / api.anthropic.com.
- Full privacy policy: https://xiaoniuge36.github.io/Smart-Bookmark/privacy.html

## Open source
https://github.com/xiaoniuge36/Smart-Bookmark (MIT license)
```

---

## 截图素材需求

| # | 文件名 | 尺寸 | 内容建议 |
|---|---|---|---|
| 1 | `screenshot-dashboard.png` | 1280×800 | 新标签页看板，壁纸 + 暗黑模式 + 搜索框 |
| 2 | `screenshot-cleaner.png` | 1280×800 | 清理中心，展示画像 + 三类问题分组 |
| 3 | `screenshot-ai.png` | 1280×800 | AI 对话气泡 + 设置入口 |
| 4 | `screenshot-sidepanel.png` | 1280×800 | 侧边栏在真实网页旁边的效果 |
| 5 | `screenshot-compare.png` | 1280×800 | 对比搜索多引擎并排 |

Chrome 最多 5 张，Edge 最多 10 张，**同一套素材两边通用**。

### 图标素材
- `public/icons/icon-128.png` ← Chrome 商店"宣传图"用这张
- Edge 允许额外上传 `Marquee promo tile`（1400×560）可选

---

## 提交 Checklist

发布前复核：

- [ ] `manifest.json.version` 已递增
- [ ] `npm run build && npm run zip` 产出 `dist.zip`
- [ ] 加载解压 `dist/` 本地实测通过
- [ ] 所有 `console.error` / `console.warn` 清理（或确认合理）
- [ ] 截图 5 张已准备
- [ ] Privacy Policy URL 可访问（GitHub Pages 已发布）
- [ ] Support URL 可访问
- [ ] 中英文描述、短描述、类目都就位
- [ ] 权限逐条 justification 粘贴完毕
- [ ] Chrome 隐私标签已勾选
- [ ] Edge 审核备注已填
