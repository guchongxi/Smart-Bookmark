# 上游功能吸收实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 personal 分支上重新实现上游 main 的 6 个首页功能点，同时完整保留 AI 助手、分组视图、FaviconImg 等个性化内容。

**Architecture:** 分层递进实现，按依赖关系从底层组件到上层布局。每层独立可验证，不影响已有功能。三栏布局：左侧文件夹 sidebar 保留，右侧新增 widget sidebar（xl+ 断点）。

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Chrome Extension MV3, Vite

---

## 文件结构总览

### 新增文件
| 文件 | 职责 |
|------|------|
| `src/components/ui/tooltip.tsx` | 纯 CSS group-hover Tooltip 组件 |
| `src/lib/homeWidgets.ts` | 首页 widget 注册表 + 可见性工具函数 |
| `src/components/HideWidgetButton.tsx` | 统一的 widget 隐藏按钮 |
| `src/components/widgets/TopSitesSidebar.tsx` | 右侧「常去」sidebar widget |
| `src/components/widgets/TrendingSidebar.tsx` | 右侧「GitHub 热门」sidebar widget |
| `src/lib/searchRank.ts` | 搜索模糊匹配 + 分数排序算法 |

### 修改文件
| 文件 | 变更范围 |
|------|---------|
| `src/newtab/pages/Dashboard.tsx` | 布局重构（三栏）+ 搜索框 Command Palette 升级 + widget 隐藏按钮 |
| `src/components/InfoCollections.tsx` | ChipLink/ChipGroup 替换 LinkPanel/CompactLink |
| `src/newtab/pages/Settings.tsx:545-588` | homeWidgets 区域改为卡片网格 |
| `src/lib/i18n.ts` | 新增 hideWidget/widgetHidden/homeWidgetsHint 等文案 |
| `src/types/index.ts` | 新增 `showTopSites` + SearchEngineId 扩展 |
| `src/lib/storage.ts` | DEFAULT_SETTINGS 新增 `showTopSites: true` |
| `src/lib/engines.ts` | 新增 DeepSeek、千问、Gemini 引擎 |
| `src/components/TrendingPanel.tsx` | 新增 `gridClassName` 和 `itemLayout` props |

---

## Task 1: Tooltip 组件

**Files:**
- Create: `src/components/ui/tooltip.tsx`

- [ ] **Step 1: 创建 Tooltip 组件**

```tsx
// src/components/ui/tooltip.tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * 纯 CSS group-hover 驱动的轻量 Tooltip。
 * 外层 span 覆盖触发元素到浮层的空气间距作为 group 命中区，
 * 内层 span 是实际浮层卡片。
 */
export function Tooltip({
  content,
  children,
  side = "bottom",
  align = "center",
  className,
}: TooltipProps) {
  return (
    <span className={cn("group/sb-tooltip relative inline-block", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "invisible absolute z-50 whitespace-nowrap opacity-0",
          "transition-all duration-150",
          "group-hover/sb-tooltip:visible group-hover/sb-tooltip:opacity-100",
          "group-focus-within/sb-tooltip:visible group-focus-within/sb-tooltip:opacity-100",
          // side
          side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
          // align
          align === "start" && "left-0",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "end" && "right-0",
        )}
      >
        <span
          className={cn(
            "block rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground",
            "shadow-xl ring-1 ring-black/[0.04] dark:ring-white/[0.06]",
          )}
        >
          {content}
        </span>
      </span>
    </span>
  );
}
```

- [ ] **Step 2: 验证 Tooltip 组件**

在浏览器中确认 Tooltip 组件可正常导入。运行 typecheck：

```bash
npm run typecheck
```

Expected: 无类型错误

- [ ] **Step 3: 提交**

```bash
git add src/components/ui/tooltip.tsx
git commit -m "feat(ui): add pure CSS Tooltip component"
```

---

## Task 2: Widget 注册表 + 隐藏按钮

**Files:**
- Create: `src/lib/homeWidgets.ts`
- Create: `src/components/HideWidgetButton.tsx`
- Modify: `src/types/index.ts:82-122` (新增 `showTopSites`)
- Modify: `src/lib/storage.ts` (DEFAULT_SETTINGS 新增 `showTopSites: true`)
- Modify: `src/newtab/pages/Settings.tsx:545-588` (卡片网格)
- Modify: `src/lib/i18n.ts` (新增文案)

- [ ] **Step 1: 扩展类型和存储默认值**

在 `src/types/index.ts` 的 Settings 接口中新增：

```typescript
// 在 showInfoCollections?: boolean; 之后添加
/** 首页是否显示「常去」小组件 */
showTopSites?: boolean;
```

在 `src/lib/storage.ts` 的 DEFAULT_SETTINGS 中新增：

```typescript
// 在 showInfoCollections: true 之后添加
showTopSites: true,
```

- [ ] **Step 2: 创建 homeWidgets 注册表**

```typescript
// src/lib/homeWidgets.ts
import type { LucideIcon } from "lucide-react";
import { Flame, Radio, Clock } from "lucide-react";
import type { Settings } from "@/types";

export type HomeWidgetKey = "githubTrending" | "infoCollections" | "topSites";

interface HomeWidgetDef {
  key: HomeWidgetKey;
  /** i18n key for widget name */
  nameKey: string;
  /** i18n key for widget description */
  descKey: string;
  Icon: LucideIcon;
  accent: string;
  /** 对应 Settings 中的布尔字段 */
  settingKey: keyof Pick<
    Settings,
    "showGithubTrendingWidget" | "showInfoCollections" | "showTopSites"
  >;
}

export const HOME_WIDGETS: HomeWidgetDef[] = [
  {
    key: "githubTrending",
    nameKey: "settings.showGithubTrendingWidget",
    descKey: "settings.showGithubTrendingWidgetHint",
    Icon: Flame,
    accent: "from-orange-500/20 to-rose-500/20 text-rose-500",
    settingKey: "showGithubTrendingWidget",
  },
  {
    key: "infoCollections",
    nameKey: "settings.showInfoCollections",
    descKey: "settings.showInfoCollectionsHint",
    Icon: Radio,
    accent: "from-emerald-500/20 to-sky-500/20 text-emerald-600 dark:text-emerald-400",
    settingKey: "showInfoCollections",
  },
  {
    key: "topSites",
    nameKey: "settings.showTopSites",
    descKey: "settings.showTopSitesHint",
    Icon: Clock,
    accent: "from-sky-500/20 to-indigo-500/20 text-sky-600 dark:text-sky-400",
    settingKey: "showTopSites",
  },
];

export function isHomeWidgetVisible(
  settings: Settings,
  key: HomeWidgetKey,
): boolean {
  const def = HOME_WIDGETS.find((w) => w.key === key);
  if (!def) return true;
  return (settings[def.settingKey] as boolean | undefined) ?? true;
}
```

- [ ] **Step 3: 创建 HideWidgetButton 组件**

```tsx
// src/components/HideWidgetButton.tsx
import { EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface HideWidgetButtonProps {
  onClick: () => void;
  label: string;
  tooltip?: string;
  variant?: "absolute" | "inline";
  className?: string;
}

export function HideWidgetButton({
  onClick,
  label,
  tooltip,
  variant = "absolute",
  className,
}: HideWidgetButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip ?? label}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-background/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground",
        "backdrop-blur-md shadow-sm transition-all duration-150",
        "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive",
        "active:scale-95",
        variant === "absolute" &&
          "absolute right-2 top-2 opacity-0 group-hover:opacity-100",
        variant === "inline" && "relative",
        className,
      )}
    >
      <EyeOff className="h-3 w-3" />
      {variant === "inline" && <span>{label}</span>}
    </button>
  );
}
```

- [ ] **Step 4: 添加 i18n 文案**

在 `src/lib/i18n.ts` 中新增以下 key（中英文）：

```typescript
// 在 settings 相关区域添加
"settings.showTopSites": "常去",
"settings.showTopSitesHint": "首页显示浏览器常访问站点",
"settings.homeWidgetsHint": "控制首页各模块的显示与隐藏",
"home.widgetHidden": "已隐藏，去设置恢复",
"home.widgetHidden.en": "Hidden, restore in Settings",
```

注意：`showTopSites` 的中文 key 需要在 zh 和 en 两个对象中都添加。

- [ ] **Step 5: 重构 Settings.tsx homeWidgets 区域**

将 `Settings.tsx:553-588` 的两个独立 Switch 替换为卡片网格：

```tsx
import { HOME_WIDGETS } from "@/lib/homeWidgets";
import { setSettings } from "@/lib/storage";

// 替换 <Row label={t("settings.homeWidgets")}> 内的内容
<Row label={t("settings.homeWidgets")}>
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    {HOME_WIDGETS.map((w) => {
      const visible = (s[w.settingKey] as boolean | undefined) ?? true;
      return (
        <div
          key={w.key}
          className={cn(
            "flex items-start gap-3 rounded-xl border p-3 transition",
            visible
              ? "border-primary/40 bg-primary/5"
              : "border-border/60 bg-muted/20",
          )}
        >
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br",
              w.accent,
            )}
          >
            <w.Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t(w.nameKey)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t(w.descKey)}
            </div>
          </div>
          <Switch
            checked={visible}
            onCheckedChange={(v) =>
              update({ [w.settingKey]: v } as Partial<Settings>)
            }
          />
        </div>
      );
    })}
  </div>
</Row>
```

- [ ] **Step 6: 验证**

```bash
npm run typecheck
```

Expected: 无类型错误

- [ ] **Step 7: 提交**

```bash
git add src/lib/homeWidgets.ts src/components/HideWidgetButton.tsx src/types/index.ts src/lib/storage.ts src/newtab/pages/Settings.tsx src/lib/i18n.ts
git commit -m "feat: add home widget registry, hide button, and settings card grid"
```

---

## Task 3: Dashboard 布局重构 + Sidebar Widget

**Files:**
- Create: `src/components/widgets/TopSitesSidebar.tsx`
- Create: `src/components/widgets/TrendingSidebar.tsx`
- Modify: `src/newtab/pages/Dashboard.tsx` (布局重构)
- Modify: `src/components/TrendingPanel.tsx` (新增 props)

**保护清单：** BookmarkCard、viewMode、FaviconImg、faviconKeys、compact 网格、拖拽、右键菜单、左侧文件夹 sidebar 全部保留不动。

- [ ] **Step 1: 新增 TrendingPanel props**

在 `src/components/TrendingPanel.tsx` 的 Props 接口中新增：

```typescript
// 在已有的 props 之后添加
/** 外部覆盖 grid 容器 className（sidebar 场景用单列） */
gridClassName?: string;
/** 卡片布局："card"=默认卡片, "row"=紧凑列表行 */
itemLayout?: "card" | "row";
```

在 TrendingPanel 组件内部，将 `grid` 容器的 className 改为：

```tsx
// 找到类似 <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"> 的行
// 替换为：
<div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", gridClassName)}>
```

确保 `gridClassName` 从 props 解构并传递。

- [ ] **Step 2: 创建 TopSitesSidebar 组件**

```tsx
// src/components/widgets/TopSitesSidebar.tsx
import { Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FaviconImg } from "@/components/FaviconImg";
import { HideWidgetButton } from "@/components/HideWidgetButton";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, hostnameOf } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { setSettings } from "@/lib/storage";
import { toast } from "@/components/ui/toast";

interface TopSite {
  url: string;
  title: string;
}

interface Props {
  sites: TopSite[];
  limit?: number;
  className?: string;
}

export default function TopSitesSidebar({ sites, limit = 3, className }: Props) {
  const t = useT();
  const visible = sites.slice(0, limit);

  if (visible.length === 0) return null;

  return (
    <Card className={cn("relative group flex flex-col rounded-2xl p-3 ring-1 ring-border/40 transition hover:shadow-md", className)}>
      <div className="mb-1 flex shrink-0 items-center gap-2 px-1">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500/20 to-indigo-500/20 text-sky-600 dark:text-sky-400">
          <Clock className="h-3.5 w-3.5" />
        </div>
        <h2 className="text-sm font-semibold tracking-tight">
          {t("dash.topSites") || "常去"}
        </h2>
        <Tooltip content={t("dash.topSitesHint") || "浏览器按访问频率自动更新"} side="bottom" align="start">
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground cursor-default">
            TOP {visible.length}
          </span>
        </Tooltip>
        <HideWidgetButton
          variant="inline"
          onClick={() => {
            setSettings({ showTopSites: false });
            toast(t("home.widgetHidden"), "info");
          }}
          label={t("home.hideWidget") || "隐藏"}
        />
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 scrollbar-thin">
        {visible.map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            title={s.url}
            className="group/item flex items-center gap-2.5 rounded-md px-2 py-1.5 transition hover:bg-accent/70"
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background ring-1 ring-border">
              <FaviconImg url={s.url} size={32} className="h-4 w-4 rounded" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {s.title || hostnameOf(s.url)}
              </div>
            </div>
          </a>
        ))}
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: 创建 TrendingSidebar 组件**

```tsx
// src/components/widgets/TrendingSidebar.tsx
import { Flame, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { HideWidgetButton } from "@/components/HideWidgetButton";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { setSettings } from "@/lib/storage";
import { toast } from "@/components/ui/toast";
import type { Settings, TrendingMode, TrendingRange } from "@/types";
import TrendingPanel from "@/components/TrendingPanel";

interface Props {
  settings: Settings;
  mode: TrendingMode;
  range: TrendingRange;
  onModeChange: (m: TrendingMode) => void;
  onRangeChange: (r: TrendingRange) => void;
  onOpenDiscover?: () => void;
  className?: string;
}

export default function TrendingSidebar({
  settings,
  mode,
  range,
  onModeChange,
  onRangeChange,
  onOpenDiscover,
  className,
}: Props) {
  const t = useT();

  return (
    <Card className={cn("relative group flex flex-col rounded-2xl p-3 ring-1 ring-border/40 transition hover:shadow-md", className)}>
      <div className="mb-2 flex shrink-0 items-center gap-2 px-1">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500/20 to-rose-500/20 text-rose-500">
          <Flame className="h-3.5 w-3.5" />
        </div>
        <h2 className="text-sm font-semibold tracking-tight">
          {t("discover.widget.title")}
        </h2>
        <HideWidgetButton
          variant="inline"
          onClick={() => {
            setSettings({ showGithubTrendingWidget: false });
            toast(t("home.widgetHidden"), "info");
          }}
          label={t("home.hideWidget") || "隐藏"}
        />
      </div>

      {/* iOS segmented control 风格 tabs */}
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <div className="inline-flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5 text-[11px]">
          {(["created", "hottest"] as TrendingMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={cn(
                "rounded px-1.5 py-0.5 font-medium transition",
                mode === m
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border/40"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`discover.mode.${m}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-1 items-center gap-0.5 rounded-md bg-muted/60 p-0.5 text-[11px]">
          {(["daily", "weekly", "monthly", "yearly"] as TrendingRange[]).map(
            (r) => (
              <button
                key={r}
                type="button"
                onClick={() => onRangeChange(r)}
                className={cn(
                  "flex-1 rounded px-1 py-0.5 font-medium transition text-center",
                  range === r
                    ? "bg-card text-foreground shadow-sm ring-1 ring-border/40"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`discover.range.${r}`)}
              </button>
            ),
          )}
        </div>
      </div>

      <TrendingPanel
        settings={settings}
        limit={5}
        compact
        hideControls
        range={range}
        mode={mode}
        gridClassName="!grid-cols-1 gap-0 divide-y divide-border/60"
      />

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          if (onOpenDiscover) {
            onOpenDiscover();
          } else {
            const p = new URLSearchParams(window.location.hash.slice(1));
            p.set("tab", "discover");
            window.location.hash = p.toString() ? "#" + p.toString() : "#";
          }
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        className="mt-2 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-primary"
      >
        {t("discover.widget.viewAll")}
        <ArrowRight className="h-3 w-3" />
      </button>
    </Card>
  );
}
```

- [ ] **Step 4: 重构 Dashboard.tsx 布局**

**关键保护点：** 以下代码块必须原样保留，不能被覆盖：
- L75-115: viewMode state + 持久化
- L252-306: groupedData useMemo
- L406-408: gridClassName
- L410-419: handleDragEnd + handleBookmarkContextMenu
- L1038-1159: 平铺/分组视图渲染 + BookmarkCard

**变更区域：**

4a. 在 Dashboard.tsx 顶部新增 import：

```typescript
import TopSitesSidebar from "@/components/widgets/TopSitesSidebar";
import TrendingSidebar from "@/components/widgets/TrendingSidebar";
import { HideWidgetButton } from "@/components/HideWidgetButton";
import { Tooltip } from "@/components/ui/tooltip";
import { setSettings as saveSettings } from "@/lib/storage";
```

注意：`setSettings` 已经在 L44 导入了，不要重复。如果已导入则跳过。

4b. 删除 ResizeObserver 相关代码（L127-128, L182-193）：

```typescript
// 删除这两行：
const trendingSectionRef = useRef<HTMLElement>(null);
const [trendingHeight, setTrendingHeight] = useState<number | null>(null);

// 删除整个 useLayoutEffect 块（L182-193）
```

4c. 修改顶层布局 grid（L520）：

将：
```tsx
<div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[260px_minmax(0,1fr)]">
```

改为：
```tsx
<div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[260px_minmax(0,1fr)_280px]">
```

4d. 在 `</section>` 结束标签（L1160）之后、ctxMenu portal 之前，新增右侧 sidebar：

```tsx
{/* 右侧 widget sidebar - 仅 xl+ 显示 */}
{(showGithubTrendingWidget || showTopSites) && (
  <aside className="hidden 2xl:block 2xl:sticky 2xl:top-20 2xl:self-start space-y-4">
    {showTopSites && topSites.length > 0 && (
      <TopSitesSidebar sites={topSites} limit={3} />
    )}
    {showGithubTrendingWidget && (
      <TrendingSidebar
        settings={settings}
        mode={widgetMode}
        range={widgetRange}
        onModeChange={setWidgetMode}
        onRangeChange={setWidgetRange}
        onOpenDiscover={onOpenDiscover}
      />
    )}
  </aside>
)}
```

4e. 修改主区内 Top Sites 和 Trending 的显示条件：

在主区的 12 列网格区域（L742-929），给 Top Sites 卡片和 Trending section 添加 xl+ 断点隐藏：

Top Sites 卡片（L744）添加 `2xl:hidden`：
```tsx
<aside className="hidden md:col-span-3 md:block 2xl:hidden">
```

Trending section（L808 附近）添加 `2xl:hidden`：
```tsx
<section className={cn(
  "col-span-1 2xl:hidden",
  topSites.length > 0 ? "md:col-span-9" : "md:col-span-12",
)}>
```

4f. 给 InfoCollections 和 showHero 区域的 widget 区块添加 `showTopSites` 条件：

在 `showGithubTrendingWidget` 附近新增：
```typescript
const showTopSites = settings.showTopSites ?? true;
```

4g. 给 Top Sites 卡片的 header 区域添加 HideWidgetButton（主区内版本）：

在 Top Sites 卡片的 header div 中（L753-769），在 `<span className="ml-auto ...">自动</span>` 之前添加：

```tsx
<Tooltip content={t("home.widgetHidden") || "隐藏后可在设置中恢复"} side="bottom" align="start">
  <HideWidgetButton
    variant="inline"
    onClick={() => {
      saveSettings({ showTopSites: false });
      toast(t("home.widgetHidden"), "info");
    }}
    label={t("home.hideWidget") || "隐藏"}
  />
</Tooltip>
```

4h. 给 Trending section header 添加 HideWidgetButton：

在 Trending section header 的 `<div className="flex-1" />` 之前（L875）添加：

```tsx
<Tooltip content={t("home.widgetHidden") || "隐藏后可在设置中恢复"} side="bottom" align="start">
  <HideWidgetButton
    variant="inline"
    onClick={() => {
      saveSettings({ showGithubTrendingWidget: false });
      toast(t("home.widgetHidden"), "info");
    }}
    label={t("home.hideWidget") || "隐藏"}
  />
</Tooltip>
```

- [ ] **Step 5: 验证**

```bash
npm run typecheck
```

Expected: 无类型错误

在浏览器中验证：
1. xl+ 宽度：三栏布局，右侧 sidebar 显示 TopSites + Trending
2. 缩小到 md~lg：两栏，TopSites/Trending 回到主区网格
3. 书签视图（平铺/分组）功能正常
4. 点击隐藏按钮：widget 消失，toast 提示

- [ ] **Step 6: 提交**

```bash
git add src/components/widgets/ src/components/TrendingPanel.tsx src/newtab/pages/Dashboard.tsx
git commit -m "feat(home): three-column layout with sidebar widgets and hide buttons"
```

---

## Task 4: Chip 链接重设计

**Files:**
- Modify: `src/components/InfoCollections.tsx`

- [ ] **Step 1: 重构 InfoCollections.tsx**

将 `LinkPanel` + `CompactLink` 组件替换为 `ChipLink` + `ChipGroup`：

1a. 新增 `ChipLink` 组件（替换 `CompactLink`）：

```tsx
function ChipLink({ item, lang }: { item: CollectionItem; lang: "zh" | "en" }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="group/chip flex items-start gap-2 rounded-lg border border-transparent bg-card/60 p-2 transition hover:border-border/80 hover:bg-accent/40 hover:shadow-sm"
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-background to-muted/40 ring-1 ring-border/80">
        <img
          src={faviconOf(item.url, 32)}
          alt=""
          className="h-3.5 w-3.5 rounded"
          onError={(e) => (e.currentTarget.style.visibility = "hidden")}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium tracking-tight transition group-hover/chip:text-primary">
            {item.title}
          </span>
          <span className="shrink-0 rounded-full bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border/50">
            {item.tag[lang]}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground/90 line-clamp-1">
          {item.description[lang]}
        </div>
      </div>
    </a>
  );
}
```

1b. 新增 `ChipGroup` 组件（替换 `LinkPanel`）：

```tsx
function ChipGroup({
  group,
  lang,
}: {
  group: CollectionGroup;
  lang: "zh" | "en";
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <SectionIcon Icon={group.Icon} accent={group.accent} size="md" />
        <span className="text-xs font-semibold tracking-tight text-muted-foreground">
          {group.title[lang]}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-1.5">
        {group.items.map((item) => (
          <ChipLink key={item.url} item={item} lang={lang} />
        ))}
      </div>
    </div>
  );
}
```

1c. 修改 `InfoCollections` 主组件布局：

将 L215-224 的双列 grid 布局改为 iframe 全宽 + 下方 Chip 分组：

```tsx
<div className="space-y-3.5">
  <LiveNewsFrame lang={lang} />
  <div className="rounded-xl border bg-card/40 p-3">
    <div className="space-y-4">
      <ChipGroup group={trendGroup} lang={lang} />
      <div className="h-px bg-border/60" />
      <ChipGroup group={toolGroup} lang={lang} />
    </div>
  </div>
</div>
```

1d. 调整 `NEWSNOW_FRAME_SCALE` 为 `0.70`（确保最窄场景也能达到 NewsNow 3 列断点）：

```typescript
const NEWSNOW_FRAME_SCALE = 0.70;
```

1e. 更新 iframe min-h 值：

在 `LiveNewsFrame` 的 iframe 容器 div 上：
```tsx
// 将 min-h-[460px] 改为 min-h-[500px]
// 将 2xl:min-h-[560px] 改为 2xl:min-h-[600px]
<div className="relative flex-1 min-h-[500px] overflow-hidden bg-background 2xl:min-h-[600px]">
```

- [ ] **Step 2: 验证**

```bash
npm run typecheck
```

在浏览器中验证：
1. iframe 占满主区全宽
2. 下方 Chip 链接分两组显示（热点入口 + 信息差工具）
3. 每个 Chip 显示 favicon + 标题 + tag 徽章 + 描述
4. 响应式：窄屏自动换行

- [ ] **Step 3: 提交**

```bash
git add src/components/InfoCollections.tsx
git commit -m "feat(home): redesign info collections with ChipLink layout"
```

---

## Task 5: GitHub 热门 Tabs iOS Segmented Control 风格

**Files:**
- Modify: `src/components/widgets/TrendingSidebar.tsx` (已在 Task 3 创建)
- Modify: `src/newtab/pages/Dashboard.tsx` (主区内 widget tabs 样式)

- [ ] **Step 1: 更新主区内 Trending widget tabs 样式**

在 `Dashboard.tsx` 的 Trending widget 区域（L822-874），将 Mode 和 Range tabs 的容器样式从 `border bg-card/80` 改为 iOS segmented control 风格：

Mode tabs 容器（L823-849）：
```tsx
// 将：
<div className="inline-flex items-center gap-0.5 rounded-lg border bg-card/80 p-0.5 text-[11px]"
// 改为：
<div className="inline-flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5 text-[11px]"
```

Mode 按钮选中态（L838-841）：
```tsx
// 将：
widgetMode === m
  ? "bg-primary text-primary-foreground shadow-sm"
  : "text-muted-foreground hover:bg-accent hover:text-foreground",
// 改为：
widgetMode === m
  ? "bg-card text-foreground shadow-sm ring-1 ring-border/40"
  : "text-muted-foreground hover:text-foreground",
```

Range tabs 容器（L850-874）：
```tsx
// 将：
<div className="inline-flex items-center gap-0.5 rounded-lg border bg-card/80 p-0.5 text-[11px]"
// 改为：
<div className="flex flex-1 items-center gap-0.5 rounded-md bg-muted/60 p-0.5 text-[11px]"
```

Range 按钮选中态（L864-867）：
```tsx
// 将：
widgetRange === r
  ? "bg-primary text-primary-foreground shadow-sm"
  : "text-muted-foreground hover:bg-accent hover:text-foreground",
// 改为：
widgetRange === r
  ? "bg-card text-foreground shadow-sm ring-1 ring-border/40"
  : "text-muted-foreground hover:text-foreground",
```

Range 按钮添加 `flex-1 text-center`：
```tsx
// 将：
className={cn(
  "rounded-md px-2 py-0.5 font-medium transition",
// 改为：
className={cn(
  "flex-1 rounded-md px-2 py-0.5 font-medium transition text-center",
```

- [ ] **Step 2: 验证**

```bash
npm run typecheck
```

在浏览器中验证：
1. 主区内 Trending tabs 为 iOS segmented control 风格
2. 右侧 sidebar TrendingSidebar tabs 同样风格（Task 3 已实现）
3. tabs 切换正常

- [ ] **Step 3: 提交**

```bash
git add src/newtab/pages/Dashboard.tsx
git commit -m "style(home): trending tabs to iOS segmented control style"
```

---

## Task 6: Command Palette + 搜索引擎

**Files:**
- Create: `src/lib/searchRank.ts`
- Modify: `src/lib/engines.ts` (新增 AI 搜索引擎)
- Modify: `src/types/index.ts` (SearchEngineId 扩展)
- Modify: `src/newtab/pages/Dashboard.tsx` (搜索框升级)

- [ ] **Step 1: 扩展 SearchEngineId 类型**

在 `src/types/index.ts` 中，将 `SearchEngineId` 扩展：

```typescript
export type SearchEngineId =
  | "google"
  | "bing"
  | "duckduckgo"
  | "baidu"
  | "github"
  | "stackoverflow"
  | "youtube"
  | "mdn"
  | "kimi"
  | "doubao"
  | "chatgpt"
  | "felo"
  | "metaso"
  | "perplexity"
  | "deepseek"
  | "qwen"
  | "gemini";
```

- [ ] **Step 2: 新增搜索引擎**

在 `src/lib/engines.ts` 的 `BUILTIN_ENGINES` 数组中，在 `perplexity` 之后添加：

```typescript
{
  id: "deepseek",
  name: "DeepSeek",
  url: (q) => `https://chat.deepseek.com/?q=${encodeURIComponent(q)}`,
  host: "deepseek.com",
},
{
  id: "qwen",
  name: "千问",
  url: (q) => `https://tongyi.aliyun.com/qianwen/?q=${encodeURIComponent(q)}`,
  host: "tongyi.aliyun.com",
},
{
  id: "gemini",
  name: "Gemini",
  url: (q) => `https://gemini.google.com/?q=${encodeURIComponent(q)}`,
  host: "gemini.google.com",
},
```

- [ ] **Step 3: 创建 searchRank 模糊排序算法**

```typescript
// src/lib/searchRank.ts

interface RankableItem {
  title: string;
  url: string;
}

/**
 * 模糊匹配 + 分数排序。
 * 支持 title/host/url/path 多维度匹配，
 * 含精确匹配加分、前缀匹配加分、子串位置加分、fuzzy span 密度加分。
 */
export function searchRank<T extends RankableItem>(
  items: T[],
  query: string,
  limit = 10,
): T[] {
  if (!query.trim()) return items.slice(0, limit);

  const q = query.toLowerCase().trim();
  const qChars = q.split("");

  const scored: Array<{ item: T; score: number }> = [];

  for (const item of items) {
    const title = item.title.toLowerCase();
    const url = item.url.toLowerCase();
    let host = "";
    let path = "";
    try {
      const u = new URL(item.url);
      host = u.hostname.replace(/^www\./, "");
      path = u.pathname;
    } catch {
      host = url;
    }

    let score = 0;

    // 精确匹配
    if (title === q || host === q) {
      score += 1000;
    }

    // 前缀匹配
    if (title.startsWith(q)) score += 500;
    if (host.startsWith(q)) score += 400;

    // 子串位置加分（越靠前分越高）
    const titleIdx = title.indexOf(q);
    if (titleIdx >= 0) score += 300 - titleIdx * 2;
    const hostIdx = host.indexOf(q);
    if (hostIdx >= 0) score += 200 - hostIdx * 2;
    const urlIdx = url.indexOf(q);
    if (urlIdx >= 0) score += 100 - urlIdx;

    // fuzzy span 密度
    if (score === 0) {
      let lastIdx = -1;
      let spanLen = 0;
      let matched = 0;
      for (const ch of qChars) {
        const idx = title.indexOf(ch, lastIdx + 1);
        if (idx === -1) break;
        if (lastIdx >= 0) spanLen += idx - lastIdx;
        lastIdx = idx;
        matched++;
      }
      if (matched === qChars.length) {
        score += Math.max(1, 50 - spanLen);
      }
    }

    // path 匹配
    if (path && path.includes(q)) score += 30;

    if (score > 0) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}
```

- [ ] **Step 4: 升级 Dashboard.tsx 搜索框为 Command Palette**

4a. 在 Dashboard.tsx 顶部新增 import：

```typescript
import { searchRank } from "@/lib/searchRank";
import {
  Bookmark,
  Folder,
  Settings as SettingsIcon,
  Sparkles,
  Wand2,
  ArrowLeftRight,
  Database,
} from "lucide-react";
```

注意：`Folder` 和 `Sparkles` 可能已经导入，检查后只添加缺失的。

4b. 新增搜索结果分组数据的 useMemo（在 `filtered` useMemo 之后）：

```typescript
const commandResults = useMemo(() => {
  const q = query.trim().toLowerCase();
  if (!searchFocused) return null;

  // 1. 搜索引擎快捷操作
  const engineActions = q
    ? [
        {
          type: "engine" as const,
          id: "search",
          title: `${t("common.search")} "${query.trim()}"`,
          subtitle: findEngine(settings, settings.searchEngine)?.name ?? "",
          icon: Search,
        },
        {
          type: "engine" as const,
          id: "compare",
          title: t("dash.compareSearch") || "对比搜索",
          subtitle: `${settings.compareEngines.length} ${t("common.engines") || "个引擎"}`,
          icon: ArrowLeftRight,
        },
      ]
    : [];

  // 2. 书签结果（searchRank 排序）
  const bookmarkHits = q
    ? searchRank(
        items.map((b) => ({ title: b.title, url: b.url, id: b.id })),
        query.trim(),
        6,
      ).map((hit) => ({
        type: "bookmark" as const,
        id: hit.id,
        title: hit.title,
        url: hit.url,
      }))
    : [];

  // 3. 历史记录
  const historyItems = historyHits.slice(0, 5).map((h) => ({
    type: "history" as const,
    id: h.url,
    title: h.title,
    url: h.url,
  }));

  // 4. 常去站点
  const topSiteItems = topSites.slice(0, 4).map((s) => ({
    type: "topsite" as const,
    id: s.url,
    title: s.title,
    url: s.url,
  }));

  // 5. 功能入口
  const functionItems = q
    ? [
        { type: "function" as const, id: "cleaner", title: t("nav.cleaner") || "清理中心", icon: Wand2 },
        { type: "function" as const, id: "compare", title: t("nav.compare") || "对比搜索", icon: ArrowLeftRight },
        { type: "function" as const, id: "ai", title: t("nav.ai") || "AI 助手", icon: Sparkles },
        { type: "function" as const, id: "backup", title: t("nav.backup") || "备份", icon: Database },
        { type: "function" as const, id: "settings", title: t("nav.settings") || "设置", icon: SettingsIcon },
      ].filter(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          f.id.includes(q),
      )
    : [];

  const groups = [
    { label: "", items: engineActions },
    { label: t("dash.bookmarks") || "书签", items: bookmarkHits },
    { label: t("dash.history") || "历史", items: historyItems },
    { label: t("dash.topSites") || "常去", items: topSiteItems },
    { label: t("dash.functions") || "功能", items: functionItems },
  ].filter((g) => g.items.length > 0);

  // 展平为列表
  const flat: Array<
    | { type: "label"; label: string }
    | (typeof groups)[number]["items"][number]
  > = [];
  for (const g of groups) {
    if (g.label) flat.push({ type: "label", label: g.label });
    flat.push(...g.items);
  }

  return flat;
}, [query, searchFocused, items, historyHits, topSites, settings, t]);
```

4c. 新增选中索引 state 和键盘导航：

```typescript
const [selectedIdx, setSelectedIdx] = useState(0);
const itemRefs = useRef<(HTMLElement | null)[]>([]);

// 搜索内容变化时重置选中
useEffect(() => {
  setSelectedIdx(0);
}, [query, searchFocused]);

// 自动滚动到选中项
useEffect(() => {
  itemRefs.current[selectedIdx]?.scrollIntoView({ block: "nearest" });
}, [selectedIdx]);
```

4d. 修改搜索框的 onKeyDown 处理，添加上下箭头导航：

在现有的 `onKeyDown` 处理（L603-626）中，在 `Escape` 处理之后、`Cmd+Enter` 处理之前添加：

```typescript
if (e.key === "ArrowDown") {
  e.preventDefault();
  if (commandResults) {
    setSelectedIdx((prev) =>
      Math.min(prev + 1, commandResults.length - 1),
    );
  }
  return;
}
if (e.key === "ArrowUp") {
  e.preventDefault();
  setSelectedIdx((prev) => Math.max(0, prev - 1));
  return;
}
```

4e. 将 Enter 处理改为 Command Palette 选择执行：

在 `onSubmitSearch` 函数中，改为：

```typescript
const onSubmitSearch = (e: React.FormEvent) => {
  e.preventDefault();
  if (!commandResults || commandResults.length === 0) return;

  // 找到选中的非 label 项
  let realIdx = -1;
  for (let i = 0; i < commandResults.length; i++) {
    const r = commandResults[i];
    if (r.type === "label") continue;
    realIdx++;
    if (realIdx === selectedIdx) {
      executeCommandResult(r);
      return;
    }
  }

  // fallback: 搜索引擎
  const q = query.trim();
  if (q) {
    const engine = findEngine(settings, settings.searchEngine);
    if (engine) window.open(engine.url(q), "_blank");
  }
};
```

新增执行函数：

```typescript
const executeCommandResult = (
  result: NonNullable<typeof commandResults>[number] & { type: string },
) => {
  if (!("type" in result)) return;
  switch (result.type) {
    case "engine":
      if ("id" in result && result.id === "compare") {
        const qq = query.trim();
        for (const id of settings.compareEngines) {
          const eng = findEngine(settings, id);
          if (eng) window.open(eng.url(qq), "_blank");
        }
      } else {
        const engine = findEngine(settings, settings.searchEngine);
        if (engine) window.open(engine.url(query.trim()), "_blank");
      }
      break;
    case "bookmark":
    case "history":
    case "topsite":
      if ("url" in result) window.open(result.url, "_blank");
      break;
    case "function":
      if ("id" in result) {
        const p = new URLSearchParams(window.location.hash.slice(1));
        p.set("tab", result.id);
        window.location.hash = "#" + p.toString();
      }
      break;
  }
  setSearchFocused(false);
  setQuery("");
};
```

4f. 替换搜索结果下拉面板：

将现有的历史记录下拉面板（L679-712）替换为 Command Palette 面板：

```tsx
{searchFocused && commandResults && commandResults.length > 0 && (
  <div className="relative">
    <div className="absolute inset-x-0 top-2 z-30 mx-auto max-w-2xl overflow-hidden rounded-2xl border bg-white/95 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:bg-slate-900/95 dark:ring-white/10">
      <div className="max-h-[400px] overflow-auto py-1 scrollbar-thin">
        {(() => {
          let realIdx = -1;
          return commandResults.map((r, i) => {
            if (r.type === "label") {
              return (
                <div
                  key={`label-${i}`}
                  className="px-4 py-1.5 text-[11px] font-medium text-muted-foreground"
                >
                  {r.label}
                </div>
              );
            }
            realIdx++;
            const idx = realIdx;
            const isSelected = idx === selectedIdx;

            return (
              <button
                key={`${r.type}-${i}`}
                ref={(el) => { itemRefs.current[idx] = el; }}
                type="button"
                onClick={() => executeCommandResult(r)}
                onMouseEnter={() => setSelectedIdx(idx)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition",
                  isSelected
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                {"url" in r && r.url ? (
                  <FaviconImg
                    url={r.url}
                    size={16}
                    className="h-4 w-4 rounded shrink-0"
                  />
                ) : "icon" in r && r.icon ? (
                  <r.icon className="h-4 w-4 shrink-0" />
                ) : null}
                <span className="flex-1 truncate">
                  {"title" in r ? r.title : ""}
                </span>
                {"subtitle" in r && r.subtitle && (
                  <span className="shrink-0 text-xs text-muted-foreground/70">
                    {r.subtitle}
                  </span>
                )}
                {"url" in r && r.url && (
                  <span className="shrink-0 truncate text-xs text-muted-foreground/50 max-w-[160px]">
                    {hostnameOf(r.url)}
                  </span>
                )}
              </button>
            );
          });
        })()}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5: 验证**

```bash
npm run typecheck
```

在浏览器中验证：
1. 搜索框输入文字后显示分组结果（引擎/书签/历史/常去/功能）
2. 上下箭头选择，Enter 执行
3. 空搜索时显示浏览历史
4. Cmd+K 和 / 快捷键聚焦
5. Esc 关闭

- [ ] **Step 6: 提交**

```bash
git add src/lib/searchRank.ts src/lib/engines.ts src/types/index.ts src/newtab/pages/Dashboard.tsx
git commit -m "feat(search): inline command palette with fuzzy ranking and AI engines"
```

---

## 最终验证

- [ ] **Typecheck**

```bash
npm run typecheck
```

Expected: 无类型错误

- [ ] **Build**

```bash
npm run build
```

Expected: 构建成功，输出到 dist/

- [ ] **浏览器功能验证清单**

| 功能点 | 验证项 |
|--------|--------|
| C - Tooltip | widget 上 hover 显示 Tooltip |
| B - 隐藏按钮 | 点击隐藏按钮 widget 消失 + toast，设置页可恢复 |
| D - 三栏布局 | xl+ 三栏，md 两栏，<md 单列 |
| D - Sidebar | 右侧 sticky TopSites + Trending |
| E - Chip 链接 | iframe 全宽 + 下方 Chip 分组 |
| F - Tabs 样式 | iOS segmented control 风格 |
| A - Command Palette | 搜索框分组结果 + 键盘导航 + 模糊排序 |
| 保护 - AI 助手 | AiPanel 正常，会话/工具/记忆正常 |
| 保护 - 分组视图 | viewMode 切换正常 |
| 保护 - FaviconImg | 书签卡片 favicon 正常 |
| 保护 - 设置页 | MCP/Favicon/缓存/思考 区块正常 |
