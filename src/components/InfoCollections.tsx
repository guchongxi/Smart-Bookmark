import type { MouseEvent } from "react";
import {
  ArrowUpRight,
  Check,
  Info,
  Newspaper,
  Radio,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn, faviconOf } from "@/lib/utils";
import { resolveLanguage } from "@/lib/i18n";
import type { Language } from "@/types";
import { useNewsNowAuth } from "@/hooks/useNewsNowAuth";

type Copy = {
  zh: string;
  en: string;
};

type SectionTone = "sky" | "emerald" | "amber" | "rose" | "cyan" | "slate";

interface CollectionItem {
  title: string;
  url: string;
  tag: Copy;
  description: Copy;
}

interface CollectionSection {
  title: Copy;
  tone?: SectionTone;
  items: CollectionItem[];
}

interface CollectionGroup {
  title: Copy;
  subtitle: Copy;
  Icon: LucideIcon;
  accent: string;
  items?: CollectionItem[];
  sections?: CollectionSection[];
}

const NEWSNOW_URL = "https://newsnow.busiyi.world/";
// 0.74 是「文字足够清晰」与「仍能保 3 列 NewsNow」的平衡点：
// 双列时容器 ≈ 1040px，iframe 原生宽度 = 1040/0.74 ≈ 1405px，
// 足以达到 NewsNow 的 3 列响应式断点，同时文字不会过小。
// （上一轮 0.62 为了勉强填出 3 列导致文字偏小，这里以「反向思路」调整：
//  同时压缩 sidebar 到 260px，让 iframe 列能够容纳更高 scale。）
const NEWSNOW_FRAME_SCALE = 0.70;

const SECTION_TONE_STYLES: Record<SectionTone, { panel: string; chip: string }> = {
  sky: {
    panel: "border-sky-200/60 bg-sky-50/40 dark:border-sky-800/40 dark:bg-sky-950/20",
    chip: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
  },
  emerald: {
    panel: "border-emerald-200/60 bg-emerald-50/40 dark:border-emerald-800/40 dark:bg-emerald-950/20",
    chip: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
  },
  amber: {
    panel: "border-amber-200/60 bg-amber-50/40 dark:border-amber-800/40 dark:bg-amber-950/20",
    chip: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300",
  },
  rose: {
    panel: "border-rose-200/60 bg-rose-50/40 dark:border-rose-800/40 dark:bg-rose-950/20",
    chip: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300",
  },
  cyan: {
    panel: "border-cyan-200/60 bg-cyan-50/40 dark:border-cyan-800/40 dark:bg-cyan-950/20",
    chip: "bg-cyan-500/10 text-cyan-700 ring-cyan-500/20 dark:text-cyan-300",
  },
  slate: {
    panel: "border-slate-200/60 bg-slate-50/40 dark:border-slate-800/40 dark:bg-slate-950/20",
    chip: "bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-300",
  },
};

const COLLECTIONS: CollectionGroup[] = [
  {
    title: { zh: "热点入口", en: "Trend sources" },
    subtitle: {
      zh: "实时热点主屏 + 备用入口",
      en: "Live feed plus backup trend sources",
    },
    Icon: Newspaper,
    accent: "from-sky-500/20 to-cyan-500/20 text-sky-600 dark:text-sky-400",
    items: [
      {
        title: "今日热榜",
        url: "https://tophub.today/c/tech",
        tag: { zh: "技术热榜", en: "Tech feeds" },
        description: {
          zh: "GitHub Trending、Product Hunt、Hacker News 等技术与产品热点",
          en: "GitHub Trending, Product Hunt, Hacker News and product news",
        },
      },
      {
        title: "SoPilot",
        url: "https://sopilot.net/zh/hot-tweets",
        tag: { zh: "X 热帖", en: "X posts" },
        description: {
          zh: "X 热门推文，适合快速看舆论和评论风向",
          en: "Hot X posts for a fast read on public conversation",
        },
      },
    ],
  },
  {
    title: { zh: "资源工具", en: "Resource tools" },
    subtitle: {
      zh: "AI 比价、中转、账号入口、号池接码与素材检索",
      en: "AI pricing, relays, account entries, number pools and content discovery",
    },
    Icon: Sparkles,
    accent:
      "from-amber-500/20 to-rose-500/20 text-amber-600 dark:text-amber-300",
    sections: [
      {
        title: { zh: "AI 比价 / 中转", en: "AI pricing / relays" },
        tone: "sky",
        items: [
          {
            title: "tokennav.cc",
            url: "https://tokennav.cc",
            tag: { zh: "Token 比价", en: "Token prices" },
            description: {
              zh: "API 中转服务比价入口，适合先看价格区间",
              en: "API relay price comparison for quick market checks",
            },
          },
          {
            title: "aibijia.org",
            url: "https://aibijia.org",
            tag: { zh: "Token 比价", en: "Token prices" },
            description: {
              zh: "同类 API 中转比价，补充价格和供应商参考",
              en: "Another API relay price index for supplier comparison",
            },
          },
          {
            title: "HelpAIO Transit",
            url: "https://www.helpaio.com/transit",
            tag: { zh: "AI 中转合集", en: "AI relays" },
            description: {
              zh: "AI API 中转站合集，适合横向对比可用服务",
              en: "AI API relay collection for comparing available services",
            },
          },
          {
            title: "GPT Bargain",
            url: "https://gptbargain.highkay.qzz.io/search?code=linux_do_friend",
            tag: { zh: "GPT 比价", en: "GPT bargain" },
            description: {
              zh: "带 code=linux_do_friend 的 GPT 比价入口",
              en: "GPT bargain entry with code=linux_do_friend",
            },
          },
          {
            title: "Nerver AC",
            url: "https://cha.nerver.cc/",
            tag: { zh: "资格检查", en: "Eligibility" },
            description: {
              zh: "ChatGPT accessToken 有效性与活动资格预检入口",
              en: "Pre-check ChatGPT accessToken validity and activity eligibility",
            },
          },
        ],
      },
      {
        title: { zh: "号池 / 接码", en: "Number pools / SMS" },
        tone: "amber",
        items: [
          {
            title: "LiveTools Workspace",
            url: "https://trade.livetools.top/workspace",
            tag: { zh: "号池交易", en: "Pool trading" },
            description: {
              zh: "LiveTools 号池交易平台入口",
              en: "LiveTools number pool trading platform",
            },
          },
          {
            title: "接码平台导航",
            url: "https://www.zhihu.com/question/625711915",
            tag: { zh: "接码平台", en: "SMS platforms" },
            description: {
              zh: "国内外接码平台汇总与使用指南",
              en: "Domestic and international SMS platform guide",
            },
          },
        ],
      },
      {
        title: { zh: "公益站 / 免费资源", en: "Public AI / Free resources" },
        tone: "emerald",
        items: [
          {
            title: "LDOH 公益站导航",
            url: "https://ldoh.105117.xyz/",
            tag: { zh: "公益站导航", en: "Public AI" },
            description: {
              zh: "AI 公益站与免费体验资源导航",
              en: "Public AI sites and free trial resource navigation",
            },
          },
          {
            title: "Free ChatGPT",
            url: "https://freegpt.cc",
            tag: { zh: "免费 GPT", en: "Free GPT" },
            description: {
              zh: "免费 ChatGPT 访问入口",
              en: "Free ChatGPT access entry",
            },
          },
        ],
      },
      {
        title: { zh: "素材检索", en: "Content discovery" },
        tone: "slate",
        items: [
          {
            title: "wallhaven.cc",
            url: "https://wallhaven.cc/",
            tag: { zh: "图片素材", en: "Wallpapers" },
            description: {
              zh: "高质量壁纸和图片素材检索入口",
              en: "High-quality wallpaper and image discovery",
            },
          },
          {
            title: "greenvideo.cc",
            url: "https://greenvideo.cc",
            tag: { zh: "视频检索", en: "Video search" },
            description: {
              zh: "视频资源检索入口",
              en: "Video resource search entry",
            },
          },
          {
            title: "seedhub.cc",
            url: "https://seedhub.cc",
            tag: { zh: "影视索引", en: "Media index" },
            description: {
              zh: "影视资源索引入口",
              en: "Film and series resource index",
            },
          },
          {
            title: "flacdownloader.com",
            url: "https://flacdownloader.com",
            tag: { zh: "无损音乐", en: "Lossless music" },
            description: {
              zh: "FLAC 音乐资源检索入口",
              en: "FLAC music search entry",
            },
          },
        ],
      },
    ],
  },
];

export default function InfoCollections({
  language,
  className,
}: {
  language: Language;
  className?: string;
}) {
  const lang = resolveLanguage(language);
  const [trendGroup, toolGroup] = COLLECTIONS;

  // 统计总入口数
  const trendCount = trendGroup.items?.length ?? 0;
  const toolCount =
    toolGroup.sections?.reduce((sum, s) => sum + s.items.length, 0) ??
    toolGroup.items?.length ??
    0;
  const total = 1 + trendCount + toolCount;

  return (
    <section className={cn("space-y-3.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <SectionIcon
            Icon={Radio}
            accent="from-emerald-500/25 to-sky-500/25 text-emerald-600 dark:text-emerald-400"
            size="lg"
            glow
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight">
                {lang === "zh" ? "信息差雷达" : "Signal radar"}
              </h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                {lang === "zh" ? "实时热点" : "Live trends"}
              </span>
              <span className="rounded-full bg-muted/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border/60">
                {lang === "zh" ? `${total} 个入口` : `${total} links`}
              </span>
            </div>
            <p className="truncate text-[11.5px] text-muted-foreground">
              {lang === "zh"
                ? "NewsNow 内嵌实时热点，旁边保留备用热榜和常用资源"
                : "NewsNow embedded live, with backup trend feeds and resource tools nearby"}
            </p>
          </div>
        </div>
      </div>

      {/*
        双列布局（≥2xl）：左侧 sidebar（两个链接面板）在 260px 定宽列，
        右侧 NewsNow iframe 占剩余空间；grid 默认 align-items: stretch
        使 iframe 列高与 sidebar 列高对齐，底部不再留白。
        侧栏 320 → 260：进一步压缩 sidebar，为 iframe 让出 60px 宽度，
        配合 scale 0.74，NewsNow 文字明显变大且依然保持 3 列。
        单列布局（<2xl）：iframe 在上、sidebar 在下，符合移动/小屏阅读顺序。
      */}
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
    </section>
  );
}

function LiveNewsFrame({ lang }: { lang: "zh" | "en" }) {
  // 登录检测放在 LiveNewsFrame 内部：
  // - 未登录 / 无法判定时在「打开」旁多一个 amber 「需登录同步」按钮
  // - 鼠标悬停按钮会出现自定义 tooltip（不是原生 title）
  // - tooltip 里含「我已登录」按钮，作为 cookie 检测失效时的兑底兑底
  const { status: authStatus, dismiss } = useNewsNowAuth();
  const showLoginBtn =
    authStatus === "guest" || authStatus === "unsupported";

  return (
    // 外层用 flex-col + h-full，使 grid 中的 stretch 对齐能传递到子元素；
    // iframe 容器采用 flex-1 + min-h，既保证单列时有足够高度，
    // 双列时会拉伸填充到 sidebar 高度，实现底部对齐。
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm ring-1 ring-black/[0.02] dark:ring-white/[0.04]">
      <div className="flex items-center justify-between gap-3 border-b bg-gradient-to-r from-sky-500/[0.04] via-muted/30 to-transparent px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <SectionIcon
            Icon={Newspaper}
            accent="from-sky-500/25 to-indigo-500/25 text-sky-600 dark:text-sky-400"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold tracking-tight">
                NewsNow {lang === "zh" ? "实时热点" : "Live"}
              </h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                Live
              </span>
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              {lang === "zh"
                ? "知乎、微博、B站、虎扑、V2EX 等热点聚合"
                : "Zhihu, Weibo, Bilibili, Hupu, V2EX and more"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {showLoginBtn && (
            <LoginPromptButton lang={lang} onDismiss={dismiss} />
          )}
          <a
            href={NEWSNOW_URL}
            target="_blank"
            rel="noreferrer"
            className="group hidden items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-background hover:text-primary sm:inline-flex"
          >
            {lang === "zh" ? "打开" : "Open"}
            <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
        </div>
      </div>
      <div className="relative flex-1 min-h-[500px] overflow-hidden bg-background 2xl:min-h-[600px]">
        <iframe
          title="NewsNow"
          src={NEWSNOW_URL}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-forms allow-popups allow-scripts allow-same-origin"
          className="absolute left-0 top-0 bg-background"
          style={{
            height: `${100 / NEWSNOW_FRAME_SCALE}%`,
            transform: `scale(${NEWSNOW_FRAME_SCALE})`,
            transformOrigin: "0 0",
            width: `${100 / NEWSNOW_FRAME_SCALE}%`,
          }}
        />
      </div>
    </div>
  );
}

// 自定义 hover tooltip 形态的「需登录同步」按钮：
// - 主体是 amber 风格的链接按钮，点击在新标签打开 NewsNow 让用户登录
// - 鼠标悬停（或 keyboard focus）时下方弹出 tooltip，含详细说明 + 「我已登录」兜底按钮
// - tooltip 用 CSS group-hover/group-focus-within 控制，无 JS 状态
// - 用 top-full + 内层 mt 让"按钮↔tooltip"之间的 gap 也属于 group 命中范围，
//   防止鼠标移到 tooltip 时短暂掉出 hover 区域导致 tooltip 闪烁/消失
function LoginPromptButton({
  lang,
  onDismiss,
}: {
  lang: "zh" | "en";
  onDismiss: () => void;
}) {
  const handleDismiss = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onDismiss();
  };

  return (
    <div className="group/login-hint relative">
      <a
        href={NEWSNOW_URL}
        target="_blank"
        rel="noreferrer"
        aria-describedby="newsnow-login-tooltip"
        className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 transition hover:border-amber-500/60 hover:bg-amber-500/15 dark:text-amber-300"
      >
        <Info className="h-3.5 w-3.5" />
        {lang === "zh" ? "需登录同步" : "Sign in"}
      </a>
      <div
        id="newsnow-login-tooltip"
        role="tooltip"
        // top-full：tooltip 容器从按钮底边开始，没有视觉裂缝；
        // 内层 mt-1.5 提供 6px 视觉间距，但 mt 部分仍属于 group 命中区，
        // 鼠标从按钮平移到 tooltip 不会丢失 hover。
        className="invisible absolute right-0 top-full z-30 opacity-0 transition-all duration-150 group-hover/login-hint:visible group-hover/login-hint:opacity-100 group-focus-within/login-hint:visible group-focus-within/login-hint:opacity-100"
      >
        <div className="mt-1.5 w-72 rounded-lg border bg-popover p-3 text-left shadow-xl ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
          <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-500/15 text-amber-600 ring-1 ring-amber-500/30 dark:text-amber-400">
              <Info className="h-3 w-3" />
            </span>
            {lang === "zh"
              ? "登录后内容会自动同步"
              : "Sign in to sync the live feeds"}
          </div>
          <p className="mb-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {lang === "zh"
              ? "部分热源（微博、知乎、V2EX 等）需要登录账号。点按钮在新标签打开 NewsNow 登录后回到本页，iframe 会自动同步状态并加载对应热点。"
              : "Some sources (Weibo, Zhihu, V2EX, …) need sign-in. Click the button to open NewsNow, log in there, then come back — the iframe will sync automatically."}
          </p>
          <button
            type="button"
            onClick={handleDismiss}
            className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-foreground transition hover:bg-accent"
          >
            <Check className="h-3 w-3" />
            {lang === "zh" ? "我已登录，不再提示" : "Already signed in"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
      {group.sections ? (
        <div className="space-y-2.5">
          {group.sections.map((section) => {
            const toneStyle = section.tone
              ? SECTION_TONE_STYLES[section.tone]
              : null;
            return (
              <div
                key={section.title[lang]}
                className={cn(
                  "space-y-1.5 rounded-lg border p-2",
                  toneStyle?.panel ?? "border-border/40 bg-muted/20",
                )}
              >
                <div className="px-1 text-[11px] font-medium text-muted-foreground">
                  {section.title[lang]}
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-1.5">
                  {section.items.map((item) => (
                    <ChipLink key={item.url} item={item} lang={lang} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-1.5">
          {group.items?.map((item) => (
            <ChipLink key={item.url} item={item} lang={lang} />
          ))}
        </div>
      )}
    </div>
  );
}

function SectionIcon({
  Icon,
  accent,
  size = "md",
  glow = false,
}: {
  Icon: LucideIcon;
  accent: string;
  /** 图标尺寸：`md` 为面板/链接使用的 28px；`lg` 为 section 标题使用的 32px。 */
  size?: "md" | "lg";
  /** 是否呈现软光晕背景（section 主标题用）。 */
  glow?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset ring-white/30 dark:ring-white/10",
        size === "lg" ? "h-8 w-8" : "h-7 w-7",
        accent,
      )}
    >
      {glow && (
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10 rounded-xl bg-gradient-to-br from-emerald-400/30 to-sky-400/30 blur-md"
        />
      )}
      <Icon
        className={cn(
          size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5",
        )}
      />
    </div>
  );
}

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
