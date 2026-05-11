# 上游功能吸收设计文档

## 背景

personal 分支从 main 分叉后积累了大量 AI 助手相关的个性化功能。上游 main 新增了 12 个 commit（首页 Dashboard 迭代），因分支差异大且已实践过 merge 冲突问题，决定在 personal 分支上**重新实现**上游的有效功能点。

## 上游 6 个功能点

| ID | 功能 | 上游 commit |
|----|------|------------|
| A | 搜索框 Command Palette + AI 搜索引擎 + 模糊排序 | `2a747ce` `7d940d7` |
| B | 首页组件一键隐藏 + 设置面板卡片网格 | `c3f5693` `2d9229e` |
| C | 自定义 Tooltip 组件（纯 CSS group-hover） | `36ad918` `0b53836` |
| D | Dashboard 三栏布局 + Sidebar Widget 抽离 | `ac7c177` `349ede9` `f9e6a5d` `a615681` |
| E | 信息差雷达 Chip 链接重设计 | `f9e6a5d` `a615681` `42bd3e4` |
| F | GitHub 热门 Tabs iOS segmented control 风格 | `42bd3e4` `198821e` |

## 个性化内容保护清单

以下功能**必须保留**，实现时不能覆盖：

### Dashboard.tsx（高风险）
- `viewMode` 分组/平铺视图切换 + 持久化
- `BookmarkCard` 内联组件（平铺/分组复用）
- `FaviconImg` 组件替换（IndexedDB 缓存 + 首字母 fallback）
- `faviconKeys` state（手动刷新书签图标）
- compact 网格适配（`cardDensity` 动态列数）
- 拖拽 + 右键菜单优化（`handleDragEnd`、`handleBookmarkContextMenu`）
- 左侧文件夹 sidebar（置顶文件夹 + FolderTree）

### Settings.tsx（低风险）
- AI 扩展能力区块（MCP Web Reader/Web Search/API Key/连通性测试）
- 书签图标区块（Favicon 缓存 + 重置无效图标）
- 书签摘要缓存区块（清除摘要缓存按钮）
- 显示思考过程开关

### 已删除功能（不能恢复）
- SidePanel 侧边栏
- 网页悬浮球（content script）
- `floatingBall` / `floatingDisabledDomains` 设置项

## 布局策略

**三栏自适应**：保留左侧文件夹 sidebar，右侧新增 widget sidebar。

```
xl+ 三栏：
┌──────────┬─────────────────────────┬────────────┐
│ 左 sidebar │      主区（雷达）          │ 右 sidebar  │
│ 240-260px │     flex-1 min-w-0      │   280px    │
│ 文件夹树   │  iframe 全宽 + Chip 链接  │ TopSites   │
│ 置顶文件夹  │                         │ Trending   │
└──────────┴─────────────────────────┴────────────┘

md~lg 两栏：左 sidebar + 主区（TopSites/Trending 回到主区网格）
<md 单列堆叠
```

- 右侧 sidebar 仅 xl+ 断点显示，sticky 定位
- TopSites/Trending 在 xl+ 从主区移到右 sidebar，<xl 回退主区

## 实现顺序（分层递进）

按依赖关系从底层到上层，每步可独立验证。

### 第 1 层：C - Tooltip 组件

**新增文件：** `src/components/ui/tooltip.tsx`

**设计：**
- 纯 CSS `group/sb-tooltip` 驱动（无 JS state）
- 视觉：`bg-popover` + `ring` + `shadow-xl` + `rounded-lg` + `px-3 py-2`
- Props：`side`(top/bottom) + `align`(start/center/end) + `content`
- 外层 span 覆盖触发元素到浮层的空气间距作为 group 命中区
- 支持 `aria-describedby` 无障碍

**验证：** 在任意 widget 上包裹 `<Tooltip>` 确认显示正常

### 第 2 层：B - 隐藏按钮 + Widget 注册表

**新增文件：**
- `src/lib/homeWidgets.ts` — `HomeWidgetKey` 类型 + `HOME_WIDGETS` 注册数组 + `isHomeWidgetVisible()` + `hideHomeWidget()`
- `src/components/HideWidgetButton.tsx` — 药丸形按钮，`absolute`/`inline` 两种 variant，hover destructive 红色

**修改文件：**
- `src/newtab/pages/Settings.tsx` — homeWidgets 区域从 Switch 改为 2 列卡片网格（图标+标题+说明+开关）
- `src/lib/i18n.ts` — 新增 hideWidget/widgetHidden/homeWidgetsHint 等文案
- `src/types/index.ts` — 新增 `showTopSites?: boolean`
- `src/lib/storage.ts` — DEFAULT_SETTINGS 新增 `showTopSites: true`

**保护：** Settings.tsx 中 MCP/Favicon/缓存/思考 4 个区块不动

**验证：** Dashboard widget header 显示隐藏按钮，点击后隐藏并 toast 提示，设置页可恢复

### 第 3 层：D - Dashboard 布局重构 + Sidebar Widget

**新增文件：**
- `src/components/widgets/TopSitesSidebar.tsx` — 280px 紧凑「常去」widget，TOP 3 列表
- `src/components/widgets/TrendingSidebar.tsx` — 280px「GitHub 热门」widget，Mode+Range tabs + 单列渲染

**修改文件：**
- `src/newtab/pages/Dashboard.tsx` — 布局重构为三栏自适应
- `src/components/TrendingPanel.tsx` — 新增 `gridClassName` 和 `itemLayout` props

**Dashboard 重构策略：**
1. 保留左侧文件夹 sidebar（`aside` 区域不动）
2. 右侧 main section 内部重构：
   - xl+ 断点：主区 grid 改为 `[minmax(0,1fr)_280px]` 两栏
   - 右栏 sticky 堆叠 TopSitesSidebar + TrendingSidebar
   - md~lg：TopSites/Trending 仍在主区网格内（现有行为）
3. 主区书签视图区域（BookmarkCard、viewMode、FaviconImg、拖拽等）**完全保留不动**
4. 搜索框区域保留，后续第 6 层升级

**保护：**
- BookmarkCard / viewMode / FaviconImg / faviconKeys / compact 网格 / 拖拽 / 右键菜单全部保留
- 左侧文件夹 sidebar 保留
- 移除 ResizeObserver 高度同步逻辑（widget 独立后不需要）

**验证：** xl+ 看到三栏布局，缩小窗口回退两栏/单列，书签视图功能正常

### 第 4 层：E - Chip 链接重设计

**修改文件：**
- `src/components/InfoCollections.tsx` — 重构

**设计：**
- 删除 `LinkPanel` + `CompactLink`（旧的两个 Card 堆叠结构）
- 新增 `ChipLink` 组件：两行结构（第一行 favicon+title+tag 徽章，第二行描述 line-clamp-1）
- 新增 `ChipGroup` 组件：trend=蓝、tool=黄，带图标前缀 + 分隔线
- iframe 占满主区全宽（触发 NewsNow 内部 3 列响应式）
- ChipGroup 容器用 `grid auto-fill minmax(200px,1fr)` 自适应排列
- 视觉占高从 ~500px 降到 ~80px

**验证：** 信息差雷达 iframe 全宽显示，下方 Chip 链接分组排列，hover 显示描述

### 第 5 层：F - GitHub 热门 Tabs 样式

**修改文件：**
- `src/components/widgets/TrendingSidebar.tsx` — tabs 样式改为 iOS segmented control

**设计：**
- Mode 和 Range 各自用 `bg-muted/60` + `rounded-md` + `p-0.5` 容器
- active 按钮 `bg-card` + `shadow-sm` + `ring-border/40` 凸起状态
- Mode `inline-flex` 自然宽，Range `flex-1` 等宽
- 标题 `truncate` 截断防溢出

**验证：** GitHub 热门 tabs 切换正常，样式为 iOS segmented control 风格

### 第 6 层：A - Command Palette + 搜索引擎

**新增文件：**
- `src/lib/searchRank.ts` — 模糊匹配 + 分数排序算法（title/host/url/path 多维度，精确/前缀/子串/fuzzy span 加分）

**修改文件：**
- `src/lib/engines.ts` — 新增 DeepSeek、千问、Gemini 等 AI 搜索引擎（engines.ts 当前与 main 一致，可直接添加）
- `src/types/index.ts` — SearchEngineId 扩展
- `src/newtab/pages/Dashboard.tsx` — 搜索框升级为内联 Command Palette

**Command Palette 设计：**
- 保持现有内联搜索框位置和 Cmd/Ctrl+K、/ 快捷键
- 聚焦后结果面板升级为分组显示：
  - 搜索引擎快捷操作
  - 对比搜索入口
  - 书签结果（最多 6 条，searchRank 排序）
  - 历史记录（最多 5 条）
  - 常去站点（最多 4 条）
  - 功能入口（清理中心/对比搜索/AI 助手/备份/设置）
- 上下箭头选择 + Enter 执行
- `itemRefs` + `scrollIntoView` 自动滚动到选中项
- 外层 backdrop-blur + 半透明背景

**保护：** 搜索框区域原地升级，不动书签视图区域

**验证：** 搜索框输入后分组显示结果，上下箭头选择，Enter 跳转，模糊匹配准确

## 成功标准

1. 所有 6 个功能点在 personal 分支上正常工作
2. 个性化内容完整保留（AI 助手、分组视图、FaviconImg、MCP 等）
3. 已删除功能不恢复（SidePanel、悬浮球）
4. `npm run typecheck` 通过
5. 浏览器加载 dist/ 后功能正常
