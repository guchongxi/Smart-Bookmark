import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  getTree,
  flatten,
  findFolder,
  moveBookmark,
  removeBookmark,
  updateBookmark,
} from "@/lib/bookmarks";
import type { BookmarkNode, FlatBookmark, Settings, TrendingMode, TrendingRange } from "@/types";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, hostnameOf } from "@/lib/utils";
import { FaviconImg } from "@/components/FaviconImg";
import { refreshFavicon } from "@/hooks/useFavicon";
import {
  Search,
  ExternalLink,
  GripVertical,
  MoreHorizontal,
  Pin,
  Folder,

  ChevronRight,
  ChevronDown,
  X,
  Flame,
  Clock,
  Sparkles,
  TrendingUp,
  LayoutGrid,
  LayoutList,
  Wand2,
  ArrowLeftRight,
  Database,
  Settings as SettingsIcon,
} from "lucide-react";
import TrendingPanel from "@/components/TrendingPanel";
import { rangeToWindowDays } from "@/lib/github";
import { setSettings } from "@/lib/storage";
import { useT } from "@/lib/i18n";
import { toast } from "@/components/ui/toast";
import QrDialog from "./QrDialog";
import FolderTree from "@/components/FolderTree";
import EngineSwitcher from "@/components/EngineSwitcher";
import { findEngine } from "@/lib/engines";
import { searchRank } from "@/lib/searchRank";
import InfoCollections from "@/components/InfoCollections";
import TopSitesSidebar from "@/components/widgets/TopSitesSidebar";
import TrendingSidebar from "@/components/widgets/TrendingSidebar";
import { HideWidgetButton } from "@/components/HideWidgetButton";
import { Tooltip } from "@/components/ui/tooltip";

interface Props {
  settings: Settings;
  initialQuery?: string;
  /** 从首页热门 widget 跳到「发现」页（与地址栏 hash 同步，避免点击无反应） */
  onOpenDiscover?: () => void;
}

interface FolderBookmark extends FlatBookmark {
  index: number;
}

interface TopSite {
  url: string;
  title: string;
}

interface HistoryHit {
  url: string;
  title: string;
  source: "history" | "bookmark";
}

export default function Dashboard({
  settings,
  initialQuery,
  onOpenDiscover,
}: Props) {
  const t = useT();
  const [tree, setTree] = useState<BookmarkNode[]>([]);
  const [selected, setSelected] = useState<string>(
    settings.rootFolderId ?? "",
  );
  const [items, setItems] = useState<FolderBookmark[]>([]);
  const [subFolders, setSubFolders] = useState<BookmarkNode[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<
    Array<{ id: string; title: string }>
  >([]);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<
    | { id: string; url: string; x: number; y: number; title: string }
    | null
  >(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  // 编辑对话框状态
  const [editDialog, setEditDialog] = useState<
    | { id: string; title: string; url: string }
    | null
  >(null);
  // favicon 刷新 key，key 变化时触发重新获取
  const [faviconKeys, setFaviconKeys] = useState<Record<string, number>>({});
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("flat");

  // 从持久化存储恢复视图模式
  useEffect(() => {
    chrome.storage.local.get("viewMode", (data) => {
      if (data.viewMode === "flat" || data.viewMode === "grouped") {
        setViewMode(data.viewMode);
      }
    });
  }, []);

  // 视图模式变更时持久化
  const onViewModeChange = useCallback((mode: "flat" | "grouped") => {
    setViewMode(mode);
    chrome.storage.local.set({ viewMode: mode });
  }, []);
  // 分组视图中收起的区块（默认全部展开）
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [topSites, setTopSites] = useState<TopSite[]>([]);
  const [historyHits, setHistoryHits] = useState<HistoryHit[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [widgetRange, setWidgetRange] = useState<TrendingRange>(
    settings.discoverDefaultRange ?? "weekly",
  );
  const [widgetMode, setWidgetMode] = useState<TrendingMode>(
    settings.discoverDefaultMode ?? "created",
  );
  const [pageSize, setPageSize] = useState<number>(() => {
    const raw = localStorage.getItem("sb_pageSize");
    if (raw === "Infinity") return Infinity;
    const n = Number(raw);
    return [24, 60, 120, 240].includes(n) ? n : 60;
  });
  const [page, setPage] = useState<number>(1);
  const searchWrapRef = useRef<HTMLFormElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const isMac = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent),
    [],
  );

  const expanded = useMemo(
    () => new Set(settings.expandedFolders ?? []),
    [settings.expandedFolders],
  );
  const pinnedIds = useMemo(
    () => new Set(settings.pinnedFolderIds ?? []),
    [settings.pinnedFolderIds],
  );

  const reload = useCallback(async () => {
    const tr = await getTree();
    setTree(tr);
  }, []);

  useEffect(() => {
    reload();
    const on = () => reload();
    chrome.bookmarks?.onChanged?.addListener(on);
    chrome.bookmarks?.onCreated?.addListener(on);
    chrome.bookmarks?.onRemoved?.addListener(on);
    chrome.bookmarks?.onMoved?.addListener(on);
    return () => {
      chrome.bookmarks?.onChanged?.removeListener(on);
      chrome.bookmarks?.onCreated?.removeListener(on);
      chrome.bookmarks?.onRemoved?.removeListener(on);
      chrome.bookmarks?.onMoved?.removeListener(on);
    };
  }, [reload]);

  useEffect(() => {
    chrome.topSites?.get?.((sites) => {
      setTopSites(
        (sites || []).slice(0, 10).map((s) => ({ url: s.url, title: s.title })),
      );
    });
  }, []);

  useEffect(() => {
    if (!tree.length) return;
    if (selected) {
      const folder = findFolder(tree, selected);
      if (!folder) {
        setItems([]);
        setSubFolders([]);
        setBreadcrumb([]);
        return;
      }
      const subs = (folder.children ?? []).filter((c) => !c.url);
      setSubFolders(subs);
      const all = flatten([folder], "");
      setItems(all.map((b, i) => ({ ...b, index: i })));
      setBreadcrumb(buildBreadcrumb(tree, folder.id));
    } else {
      const flat = flatten(tree);
      setItems(flat.map((b, i) => ({ ...b, index: i })));
      setSubFolders([]);
      setBreadcrumb([]);
    }
  }, [tree, selected]);

  const matchesQuery = useCallback(
    (b: { title: string; url: string; path: string }, q: string) =>
      !q ||
      b.title.toLowerCase().includes(q) ||
      b.url.toLowerCase().includes(q) ||
      b.path.toLowerCase().includes(q),
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((b) => matchesQuery(b, q));
  }, [items, query, matchesQuery]);

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

  const pageCount = Math.max(
    1,
    pageSize === Infinity ? 1 : Math.ceil(filtered.length / pageSize),
  );

  useEffect(() => {
    setPage(1);
  }, [selected, query, pageSize]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pagedItems = useMemo(() => {
    if (pageSize === Infinity) return filtered;
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  // 分组视图数据：直接子项 + 子文件夹区块
  const groupedData = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!selected) return { directItems: items.filter((b) => matchesQuery(b, q)), sections: [] };

    const folder = findFolder(tree, selected);
    if (!folder) return { directItems: items, sections: [] };

    const children = folder.children ?? [];
    // 直接子项（有 url 的）
    const directItems = children
      .filter((c) => c.url)
      .map((c, i) => ({
        id: c.id,
        parentId: c.parentId,
        title: c.title || c.url!,
        url: c.url!,
        path: "",
        dateAdded: c.dateAdded,
        index: i,
      }));

    // 子文件夹（无 url 的）
    const sections = children
      .filter((c) => !c.url && c.id !== "0")
      .map((subFolder) => {
        const flatBookmarks = flatten([subFolder], "");
        return {
          id: subFolder.id,
          title: subFolder.title || "(未命名)",
          count: flatBookmarks.length,
          items: flatBookmarks.map((b, i) => ({
            ...b,
            index: i,
          })),
        };
      })
      .filter((s) => s.count > 0);

    // 过滤
    if (q) {
      return {
        directItems: directItems.filter((b) => matchesQuery(b, q)),
        sections: sections
          .map((s) => ({
            ...s,
            items: s.items.filter((b) => matchesQuery(b, q)),
          }))
          .filter((s) => s.items.length > 0),
      };
    }

    return { directItems, sections };
  }, [tree, selected, items, query, matchesQuery]);

  const onChangePageSize = (n: number) => {
    setPageSize(n);
    localStorage.setItem(
      "sb_pageSize",
      n === Infinity ? "Infinity" : String(n),
    );
  };

  const onSelectFolder = async (id: string) => {
    setSelected(id);
    await setSettings({ rootFolderId: id || undefined });
  };

  const onToggleExpand = async (id: string) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    await setSettings({ expandedFolders: [...next] });
  };

  const onTogglePin = async (id: string) => {
    const next = new Set(pinnedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    await setSettings({ pinnedFolderIds: [...next] });
  };

  const onChangeEngine = async (id: string) => {
    await setSettings({ searchEngine: id });
  };

  const executeCommandResult = (
    result: { type: string; [key: string]: unknown },
  ) => {
    switch (result.type) {
      case "engine":
        if (result.id === "compare") {
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
        if (result.url) window.open(result.url as string, "_blank");
        break;
      case "function":
        if (result.id) {
          const p = new URLSearchParams(window.location.hash.slice(1));
          p.set("tab", result.id as string);
          window.location.hash = "#" + p.toString();
        }
        break;
    }
    setSearchFocused(false);
    setQuery("");
  };

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandResults || commandResults.length === 0) {
      // fallback: 搜索引擎
      const q = query.trim();
      if (q) {
        const engine = findEngine(settings, settings.searchEngine);
        if (engine) window.open(engine.url(q), "_blank");
      }
      return;
    }

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

    // fallback
    const q = query.trim();
    if (q) {
      const engine = findEngine(settings, settings.searchEngine);
      if (engine) window.open(engine.url(q), "_blank");
    }
  };

  const canReorder = !!selected && !query.trim() && (
    viewMode === "grouped" ? groupedData.directItems.length > 0 : items.length > 0
  );

  const onDragStart = (e: React.DragEvent, id: string) => {
    if (!canReorder) return;
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    document.body.style.cursor = "grabbing";
  };
  const onDragOver = (e: React.DragEvent, id: string) => {
    if (!canReorder || !dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverId(id);
  };
  const onDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!canReorder || !dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }

    // 分组视图下使用 groupedData.directItems
    const currentItems = viewMode === "grouped" ? groupedData.directItems : items;
    const src = currentItems.find((i) => i.id === dragId);
    const tgt = currentItems.find((i) => i.id === targetId);

    if (!src || !tgt) {
      setDragId(null);
      setOverId(null);
      return;
    }

    // 同目录排序
    if (src.parentId === tgt.parentId) {
      const siblingIds = currentItems
        .filter((x) => x.parentId === tgt.parentId)
        .map((x) => x.id);
      const dstIdx = siblingIds.indexOf(targetId);

      // 乐观更新 UI
      if (viewMode === "grouped") {
        const nextDirect = [...groupedData.directItems];
        const srcIdx = nextDirect.findIndex((x) => x.id === dragId);
        const [moved] = nextDirect.splice(srcIdx, 1);
        const dstIdxInArr = nextDirect.findIndex((x) => x.id === targetId);
        nextDirect.splice(dstIdxInArr, 0, moved);
        // groupedData 是 useMemo，不能直接 set，需要 reload
      } else {
        const nextAll = [...items];
        const srcInAll = nextAll.findIndex((x) => x.id === dragId);
        const [moved] = nextAll.splice(srcInAll, 1);
        const dstInAll = nextAll.findIndex((x) => x.id === targetId);
        nextAll.splice(dstInAll, 0, moved);
        setItems(nextAll.map((x, i) => ({ ...x, index: i })));
      }

      try {
        if (src.parentId) {
          await moveBookmark(dragId, src.parentId, dstIdx);
        }
      } catch (err) {
        console.warn("reorder failed", err);
        toast("排序失败", "error");
      } finally {
        reload();
        setDragId(null);
        setOverId(null);
      }
    } else {
      // 跨目录移动
      setDragId(null);
      setOverId(null);
    }
  };

  // 拖拽到子文件夹区块
  const onDropToFolder = async (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    if (!dragId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const src = items.find((i) => i.id === dragId) ?? groupedData.directItems.find((i) => i.id === dragId);
    if (!src || src.parentId === folderId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    try {
      await moveBookmark(dragId, folderId);
      toast("已移动到文件夹", "success");
    } catch (err) {
      console.warn("move failed", err);
      toast("移动失败", "error");
    } finally {
      reload();
      setDragId(null);
      setOverId(null);
    }
  };

  const closeCtx = useCallback(() => setCtxMenu(null), []);

  // xl 时主区宽（两栏布局），2xl 时主区窄（三栏布局，右侧多了 widget sidebar）
  const gridClassName = settings.cardDensity === "compact"
    ? "grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-8 2xl:grid-cols-6"
    : "grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-5";

  const handleDragEnd = useCallback(() => {
    document.body.style.cursor = "";
    setDragId(null);
    setOverId(null);
  }, []);

  const handleBookmarkContextMenu = useCallback((e: React.MouseEvent, url: string, title: string, id: string) => {
    e.preventDefault();
    setCtxMenu({ id, url, title, x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    if (!ctxMenu) return;
    const fn = () => closeCtx();
    window.addEventListener("click", fn);
    window.addEventListener("resize", fn);
    return () => {
      window.removeEventListener("click", fn);
      window.removeEventListener("resize", fn);
    };
  }, [ctxMenu, closeCtx]);

  useEffect(() => {
    if (!searchFocused) return;
    const q = query.trim();
    if (!q) {
      chrome.history?.search?.(
        { text: "", maxResults: 10, startTime: Date.now() - 7 * 86400e3 },
        (res) => {
          setHistoryHits(
            (res || [])
              .filter((x) => x.url)
              .slice(0, 8)
              .map((x) => ({
                url: x.url!,
                title: x.title || x.url!,
                source: "history" as const,
              })),
          );
        },
      );
      return;
    }
    chrome.history?.search?.(
      { text: q, maxResults: 12 },
      (res) => {
        setHistoryHits(
          (res || [])
            .filter((x) => x.url)
            .slice(0, 8)
            .map((x) => ({
              url: x.url!,
              title: x.title || x.url!,
              source: "history" as const,
            })),
        );
      },
    );
  }, [query, searchFocused]);

  useEffect(() => {
    if (!searchFocused) return;
    const close = (e: MouseEvent) => {
      if (!searchWrapRef.current) return;
      if (!searchWrapRef.current.contains(e.target as Node))
        setSearchFocused(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [searchFocused]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query, searchFocused]);

  useEffect(() => {
    itemRefs.current[selectedIdx]?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTyping =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (target?.isContentEditable ?? false);
      const meta = isMac ? e.metaKey : e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        setSearchFocused(true);
        return;
      }
      if (!isTyping && e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchFocused(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMac]);

  const pinnedFolders = useMemo(() => {
    const ids = Array.from(pinnedIds);
    return ids
      .map((id) => findFolder(tree, id))
      .filter(Boolean) as BookmarkNode[];
  }, [pinnedIds, tree]);

  const greeting = useGreeting();
  const showHero = !selected && !query.trim();
  const showGithubTrendingWidget = settings.showGithubTrendingWidget ?? true;
  const showTopSites = settings.showTopSites ?? true;
  const showInfoCollections = settings.showInfoCollections ?? true;

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[260px_minmax(0,1fr)_280px]">
      <aside className="space-y-3 md:sticky md:top-20 md:self-start">
        {pinnedFolders.length > 0 && (
          <Card className="p-2">
            <div className="mb-1 flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
              <Pin className="h-3.5 w-3.5" /> 置顶
            </div>
            <div className="space-y-0.5 text-sm">
              {pinnedFolders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => onSelectFolder(f.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-accent",
                    selected === f.id && "bg-accent",
                  )}
                >
                  <span className="h-2 w-2 rounded-full bg-gradient-to-br from-blue-500 to-fuchsia-500" />
                  <span className="flex-1 truncate">{f.title}</span>
                </button>
              ))}
            </div>
          </Card>
        )}
        <Card className="p-2 max-h-[76vh] overflow-auto scrollbar-thin">
          <div className="mb-1 px-1 text-xs font-medium text-muted-foreground">
            {t("dash.folders")}
          </div>
          <FolderTree
            tree={tree}
            selectedId={selected}
            expanded={expanded}
            pinnedIds={pinnedIds}
            onToggle={onToggleExpand}
            onSelect={(id) => onSelectFolder(id)}
            onTogglePin={onTogglePin}
          />
        </Card>
      </aside>

      <section className="min-w-0 space-y-5">
        {showHero && (
          <div className="mb-2 pt-4 text-center">
            <div className="text-2xl font-semibold tracking-tight text-foreground/90">
              {greeting} <span className="ml-1">👋</span>
            </div>
          </div>
        )}

        <form
          onSubmit={onSubmitSearch}
          className={cn(
            "mx-auto w-full max-w-2xl",
            showHero ? "" : "max-w-none",
          )}
          ref={searchWrapRef}
        >
          <div
            className={cn(
              "group/search relative flex items-center gap-1.5 rounded-2xl border bg-card pl-1.5 pr-1.5 shadow-sm transition-all duration-200",
              "focus-within:border-primary/40 focus-within:shadow-md focus-within:ring-2 focus-within:ring-primary/20",
            )}
          >
            <EngineSwitcher
              settings={settings}
              value={settings.searchEngine}
              onChange={onChangeEngine}
            />
            <span
              aria-hidden
              className="h-5 w-px bg-border/80"
            />
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (e.target.value) setSearchFocused(true);
                }}
                onClick={() => setSearchFocused(true)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    if (query) {
                      setQuery("");
                    } else {
                      setSearchFocused(false);
                      searchInputRef.current?.blur();
                    }
                    return;
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    if (commandResults) {
                      setSelectedIdx((prev) =>
                        Math.min(prev + 1, commandResults.filter((r) => r.type !== "label").length - 1),
                      );
                    }
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSelectedIdx((prev) => Math.max(0, prev - 1));
                    return;
                  }
                  if (
                    e.key === "Enter" &&
                    (e.metaKey || e.ctrlKey) &&
                    query.trim()
                  ) {
                    e.preventDefault();
                    const qq = query.trim();
                    for (const id of settings.compareEngines) {
                      const eng = findEngine(settings, id);
                      if (eng) window.open(eng.url(qq), "_blank");
                    }
                    return;
                  }
                  if (!searchFocused) setSearchFocused(true);
                }}
                placeholder={t("dash.searchPlaceholder")}
                className="h-11 border-0 bg-transparent pl-8 pr-1 shadow-none focus-visible:ring-0"
              />
            </div>
            {query && (
              <button
                type="button"
                aria-label={t("dash.searchClear")}
                title={t("dash.searchClear")}
                onClick={() => {
                  setQuery("");
                  searchInputRef.current?.focus();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {!query && (
              <kbd
                aria-hidden
                className="pointer-events-none hidden select-none items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-muted-foreground shadow-sm sm:inline-flex"
              >
                <span className="text-[11px] leading-none">
                  {isMac ? "⌘" : "Ctrl"}
                </span>
                <span className="leading-none">K</span>
              </kbd>
            )}
            <Button
              type="submit"
              className="ml-1 h-9 w-9 rounded-xl p-0 sm:w-auto sm:px-4"
              variant="default"
              aria-label={t("common.search")}
              title={t("common.search")}
            >
              <Search className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">{t("common.search")}</span>
            </Button>
          </div>

          {searchFocused && query.trim() && (
            <div className="mx-2 mt-1.5 flex items-center px-1 text-[11px] text-muted-foreground">
              <span>
                {filtered.length > 0
                  ? t("dash.matchCount", String(filtered.length))
                  : t("dash.matchNone")}
              </span>
            </div>
          )}

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
                              url={r.url as string}
                              size={16}
                              className="h-4 w-4 rounded shrink-0"
                            />
                          ) : "icon" in r && r.icon ? (
                            <r.icon className="h-4 w-4 shrink-0" />
                          ) : null}
                          <span className="flex-1 truncate">
                            {"title" in r ? (r.title as string) : ""}
                          </span>
                          {"subtitle" in r && r.subtitle && (
                            <span className="shrink-0 text-xs text-muted-foreground/70">
                              {r.subtitle as string}
                            </span>
                          )}
                          {"url" in r && r.url && (
                            <span className="shrink-0 truncate text-xs text-muted-foreground/50 max-w-[160px]">
                              {hostnameOf(r.url as string)}
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
        </form>

        {showHero && topSites.length > 0 && (
          <div className="md:hidden mx-auto flex max-w-4xl flex-wrap items-start justify-center gap-4 pt-2">
            {topSites.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="group flex w-20 flex-col items-center gap-1"
                title={s.url}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border transition group-hover:-translate-y-0.5 group-hover:shadow-md">
                  <FaviconImg
                    url={s.url}
                    size={64}
                    className="h-7 w-7 rounded-full"
                  />
                </div>
                <div className="w-full truncate text-center text-[11px] text-muted-foreground">
                  {s.title || hostnameOf(s.url)}
                </div>
              </a>
            ))}
          </div>
        )}

        {showHero && (
          <div className="grid grid-cols-1 items-stretch gap-5 pt-2 md:grid-cols-12">
            {topSites.length > 0 && (
              <aside className="hidden md:col-span-3 md:block 2xl:hidden">
                <Card className="flex h-full flex-col p-3">
                  <div className="mb-1 flex shrink-0 items-center gap-2 px-1">
                    <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500/20 to-indigo-500/20 text-sky-600 dark:text-sky-400">
                      <Clock className="h-3.5 w-3.5" />
                    </div>
                    <h2 className="text-sm font-semibold tracking-tight">
                      常去
                    </h2>
                    <span
                      className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                      title="由 Chrome 浏览器自动统计的常访问站点"
                    >
                      TOP {topSites.length}
                    </span>
                    <Tooltip content={t("home.widgetHidden") || "隐藏后可在设置中恢复"} side="bottom" align="start">
                      <HideWidgetButton
                        variant="inline"
                        onClick={() => {
                          setSettings({ showTopSites: false });
                          toast(t("home.widgetHidden"), "info");
                        }}
                        label={t("home.hideWidget") || "隐藏"}
                      />
                    </Tooltip>
                    <span className="ml-auto text-[10px] text-muted-foreground/70">
                      自动
                    </span>
                  </div>
                  <p className="mb-2 shrink-0 px-1 text-[10.5px] leading-relaxed text-muted-foreground/70">
                    浏览器按访问频率自动更新
                  </p>
                  <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 scrollbar-thin">
                    {topSites.map((s) => (
                      <a
                        key={s.url}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        title={s.url}
                        className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition hover:bg-accent"
                      >
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background ring-1 ring-border">
                          <FaviconImg
                            url={s.url}
                            size={32}
                            className="h-4 w-4 rounded"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-foreground">
                            {s.title || hostnameOf(s.url)}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {hostnameOf(s.url)}
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                </Card>
              </aside>
            )}

            {showGithubTrendingWidget && (
              <section
                className={cn(
                  "col-span-1 2xl:hidden",
                  topSites.length > 0
                    ? "md:col-span-9"
                    : "md:col-span-12",
                )}
              >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500/20 to-rose-500/20 text-rose-500">
                  <Flame className="h-3.5 w-3.5" />
                </div>
                <h2 className="text-sm font-semibold tracking-tight">
                  {t("discover.widget.title")}
                </h2>
                <div
                  className="inline-flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5 text-[11px]"
                  role="tablist"
                  aria-label="Mode"
                >
                  {(["created", "hottest"] as TrendingMode[]).map((m) => {
                    const Icon = m === "created" ? Sparkles : TrendingUp;
                    return (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={widgetMode === m}
                        onClick={() => setWidgetMode(m)}
                        title={t(`discover.mode.${m}.hint`)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium transition",
                          widgetMode === m
                            ? "bg-card text-foreground shadow-sm ring-1 ring-border/40"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Icon className="h-3 w-3" />
                        {t(`discover.mode.${m}`)}
                      </button>
                    );
                  })}
                </div>
                <div
                  className="flex flex-1 items-center gap-0.5 rounded-md bg-muted/60 p-0.5 text-[11px]"
                  role="tablist"
                  aria-label={t("discover.widget.title")}
                >
                  {(["daily", "weekly", "monthly", "yearly"] as TrendingRange[]).map(
                    (r) => (
                      <button
                        key={r}
                        type="button"
                        role="tab"
                        aria-selected={widgetRange === r}
                        onClick={() => setWidgetRange(r)}
                        className={cn(
                          "flex-1 rounded-md px-2 py-0.5 font-medium transition text-center",
                          widgetRange === r
                            ? "bg-card text-foreground shadow-sm ring-1 ring-border/40"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t(`discover.range.${r}`)}
                      </button>
                    ),
                  )}
                </div>
                <Tooltip content={t("home.widgetHidden") || "隐藏后可在设置中恢复"} side="bottom" align="start">
                  <HideWidgetButton
                    variant="inline"
                    onClick={() => {
                      setSettings({ showGithubTrendingWidget: false });
                      toast(t("home.widgetHidden"), "info");
                    }}
                    label={t("home.hideWidget") || "隐藏"}
                  />
                </Tooltip>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onOpenDiscover) {
                      onOpenDiscover();
                    } else {
                      const p = new URLSearchParams(window.location.hash.slice(1));
                      p.set("tab", "discover");
                      const s = p.toString();
                      window.location.hash = s ? "#" + s : "#";
                    }
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="relative z-10 cursor-pointer rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-primary"
                >
                  {t("discover.widget.viewAll")}
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground/90">
                {t(
                  "discover.widget.hint",
                  t(`discover.range.${widgetRange}`),
                  String(rangeToWindowDays(widgetRange)),
                )}{" "}
                {t(`discover.mode.${widgetMode}.hint`)}
              </p>
              <TrendingPanel
                settings={settings}
                limit={8}
                compact
                hideControls
                range={widgetRange}
                onRangeChange={setWidgetRange}
                mode={widgetMode}
                onModeChange={setWidgetMode}
              />
              </section>
            )}
            {showInfoCollections && (
              <InfoCollections
                language={settings.language}
                className={cn(
                  "col-span-1",
                  showGithubTrendingWidget
                    ? "md:col-span-12"
                    : topSites.length > 0
                      ? "md:col-span-9"
                      : "md:col-span-12",
                )}
              />
            )}
          </div>
        )}

        {!showHero && breadcrumb.length > 0 && (
          <nav className="flex items-center gap-1 text-sm text-muted-foreground">
            <button onClick={() => onSelectFolder("")} className="hover:text-foreground">
              全部书签
            </button>
            {breadcrumb.map((b) => (
              <span key={b.id} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5" />
                <button
                  onClick={() => onSelectFolder(b.id)}
                  className="hover:text-foreground"
                >
                  {b.title}
                </button>
              </span>
            ))}
          </nav>
        )}

        {!showHero && subFolders.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {subFolders.map((f) => (
              <button
                key={f.id}
                onClick={() => onSelectFolder(f.id)}
                className="group flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 text-sm shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_24px_-12px_hsl(var(--primary)/0.25)] hover:ring-1 hover:ring-primary/20"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/20 text-primary">
                  <Folder className="h-3.5 w-3.5" />
                </div>
                <span className="max-w-[140px] truncate">
                  {f.title || "(未命名)"}
                </span>
              </button>
            ))}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="flex flex-wrap items-end justify-between gap-2 border-b pb-1.5 pt-2">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/20 text-primary">
                <Folder className="h-3.5 w-3.5" />
              </div>
              <h2 className="text-sm font-semibold tracking-tight">
                我的书签
              </h2>
              <span className="text-[11px] text-muted-foreground">
                · 共 {filtered.length} 个
                {query.trim() ? "（已过滤）" : ""}
              </span>
              {/* 视图切换按钮 */}
              {selected && (
                <div className="ml-2 flex items-center rounded-md border border-border/60 bg-muted/30 p-0.5">
                  <button
                    onClick={() => onViewModeChange("flat")}
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                      viewMode === "flat"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    title="递归平铺"
                  >
                    <LayoutGrid className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => onViewModeChange("grouped")}
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                      viewMode === "grouped"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    title="分组视图"
                  >
                    <LayoutList className="h-3 w-3" />
                  </button>
                </div>
              )}
              {viewMode === "flat" && pageSize !== Infinity && filtered.length > pageSize && (
                <span className="text-[11px] text-muted-foreground/70">
                  · 第 {(page - 1) * pageSize + 1}-
                  {Math.min(page * pageSize, filtered.length)} 条
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {canReorder && (
                <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex">
                  <GripVertical className="h-3 w-3" />
                  {t("dash.dragHint")}
                </span>
              )}
              {viewMode === "flat" && (
                <>
                  <PageSizePicker value={pageSize} onChange={onChangePageSize} />
                  {pageSize !== Infinity && pageCount > 1 && (
                    <Pager page={page} pageCount={pageCount} onChange={setPage} />
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* 平铺视图 */}
        {viewMode === "flat" && (
          <div className={gridClassName}>
            {pagedItems.map((b) => (
              <BookmarkCard
                key={b.id}
                b={b}
                canReorder={canReorder}
                dragId={dragId}
                overId={overId}
                faviconKeys={faviconKeys}
                onDragStart={onDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onContextMenu={handleBookmarkContextMenu}
              />
            ))}
            {!filtered.length && !subFolders.length && (
              <div className="col-span-full rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                {t("dash.empty")}
              </div>
            )}
          </div>
        )}

        {viewMode === "flat" && pageSize !== Infinity && pageCount > 1 && filtered.length > 0 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <Pager page={page} pageCount={pageCount} onChange={setPage} />
            <span className="text-[11px] text-muted-foreground">
              共 {filtered.length} 条
            </span>
          </div>
        )}

        {/* 分组视图 */}
        {viewMode === "grouped" && (
          <div className="space-y-5 pt-2">
            {/* 直接子项 */}
            {groupedData.directItems.length > 0 && (
              <div className={gridClassName}>
                  {groupedData.directItems.map((b) => (
                    <BookmarkCard
                      key={b.id}
                      b={b}
                      canReorder={canReorder}
                      dragId={dragId}
                      overId={overId}
                      faviconKeys={faviconKeys}
                      onDragStart={onDragStart}
                      onDragEnd={handleDragEnd}
                      onDragOver={onDragOver}
                      onDrop={onDrop}
                      onContextMenu={handleBookmarkContextMenu}
                    />
                  ))}
              </div>
            )}

            {/* 子文件夹区块 */}
            {groupedData.sections.map((section) => {
              const isCollapsed = collapsedSections.has(section.id);
              const isOverFolder = overId === `folder:${section.id}`;
              return (
                <div
                  key={section.id}
                  className={cn(
                    "rounded-xl border border-border/40 bg-muted/20 transition-all",
                    isOverFolder && dragId && "ring-2 ring-primary/60 border-primary/40",
                  )}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setOverId(`folder:${section.id}`);
                  }}
                  onDrop={(e) => onDropToFolder(e, section.id)}
                >
                  <button
                    onClick={() => {
                      setCollapsedSections((prev) => {
                        const next = new Set(prev);
                        if (next.has(section.id)) {
                          next.delete(section.id);
                        } else {
                          next.add(section.id);
                        }
                        return next;
                      });
                    }}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform duration-200",
                        isCollapsed && "-rotate-90",
                      )}
                    />
                    <Folder className="h-4 w-4 text-primary/70" />
                    <span className="text-sm font-medium">{section.title}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {query.trim()
                        ? `${section.items.length} 项`
                        : `${section.count} 项`}
                    </span>
                    {isOverFolder && dragId && (
                      <span className="ml-auto text-[11px] text-primary">释放以移动</span>
                    )}
                  </button>
                  {!isCollapsed && (
                    <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-5">
                      {section.items.map((b) => (
                        <BookmarkCard
                          key={b.id}
                          b={b}
                          canReorder={false}
                          dragId={null}
                          overId={null}
                          faviconKeys={faviconKeys}
                          onDragStart={() => {}}
                          onDragEnd={() => {}}
                          onDragOver={() => {}}
                          onDrop={() => {}}
                          onContextMenu={handleBookmarkContextMenu}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {groupedData.directItems.length === 0 && groupedData.sections.length === 0 && (
              <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                {t("dash.empty")}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 右侧 widget sidebar - 仅 2xl+ 显示 */}
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

      {ctxMenu &&
        createPortal(
          <BookmarkCtxMenu
            {...ctxMenu}
            onCopy={async () => {
              await navigator.clipboard.writeText(ctxMenu.url);
              toast(t("common.copied"), "success");
              setCtxMenu(null);
            }}
            onQr={() => {
              setQrUrl(ctxMenu.url);
              setCtxMenu(null);
            }}
            onRefreshIcon={async () => {
              await refreshFavicon(ctxMenu.url);
              setFaviconKeys((prev) => ({
                ...prev,
                [ctxMenu.url]: (prev[ctxMenu.url] ?? 0) + 1,
              }));
              setCtxMenu(null);
            }}
            onEdit={() => {
              setEditDialog({ id: ctxMenu.id, title: ctxMenu.title, url: ctxMenu.url });
              setCtxMenu(null);
            }}
            onDelete={() => {
              if (!confirm(`确定删除书签「${ctxMenu.title}」？`)) return;
              removeBookmark(ctxMenu.id);
              setCtxMenu(null);
            }}
          />,
          document.body,
        )}

      {qrUrl && <QrDialog url={qrUrl} onClose={() => setQrUrl(null)} />}

      {/* 编辑对话框 */}
      {editDialog && (
        <EditBookmarkDialog
          initialTitle={editDialog.title}
          initialUrl={editDialog.url}
          onClose={() => setEditDialog(null)}
          onSave={async (title, url) => {
            try {
              await updateBookmark(editDialog.id, { title, url });
              toast("已保存", "success");
              reload();
            } catch (err) {
              console.warn("update failed", err);
              toast("保存失败", "error");
            }
            setEditDialog(null);
          }}
        />
      )}
    </div>
  );
}

function buildBreadcrumb(
  tree: BookmarkNode[],
  id: string,
): Array<{ id: string; title: string }> {
  const path: Array<{ id: string; title: string }> = [];
  const walk = (nodes: BookmarkNode[], chain: Array<{ id: string; title: string }>): boolean => {
    for (const n of nodes) {
      if (!n.url) {
        const here = n.title
          ? [...chain, { id: n.id, title: n.title }]
          : chain;
        if (n.id === id) {
          path.push(...here);
          return true;
        }
        if (n.children && walk(n.children, here)) return true;
      }
    }
    return false;
  };
  walk(tree, []);
  return path;
}

function useGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "深夜好";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  if (h < 22) return "晚上好";
  return "夜深了";
}

function PageSizePicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const options: Array<{ v: number; label: string }> = [
    { v: 24, label: "24" },
    { v: 60, label: "60" },
    { v: 120, label: "120" },
    { v: 240, label: "240" },
    { v: Infinity, label: "全部" },
  ];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  const current = options.find((o) => o.v === value)?.label ?? String(value);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
        title="每页条数"
      >
        每页 {current}
        <ChevronRight
          className={cn("h-3 w-3 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div
          className="absolute right-0 top-8 z-40 w-28 rounded-lg border bg-popover p-1 shadow-xl ring-1 ring-black/5 dark:ring-white/5"
          onClick={(e) => e.stopPropagation()}
        >
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => {
                onChange(o.v);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-accent",
                value === o.v && "bg-accent font-medium",
              )}
            >
              <span>{o.label}</span>
              {value === o.v && (
                <span className="text-[10px] text-primary">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 生成现代风格分页的页码序列：[1, "...", 4, 5, 6, "...", 19]
 * 始终显示首末页，当前页±1 作为邻页，其余用 ellipsis 合并。
 */
function buildPageRange(
  current: number,
  total: number,
  neighbor = 1,
): Array<number | "ellipsis-l" | "ellipsis-r"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out: Array<number | "ellipsis-l" | "ellipsis-r"> = [];
  const left = Math.max(2, current - neighbor);
  const right = Math.min(total - 1, current + neighbor);
  out.push(1);
  if (left > 2) out.push("ellipsis-l");
  for (let i = left; i <= right; i++) out.push(i);
  if (right < total - 1) out.push("ellipsis-r");
  out.push(total);
  return out;
}

// 书签卡片组件
function BookmarkCard({
  b,
  canReorder,
  dragId,
  overId,
  faviconKeys,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onContextMenu,
}: {
  b: FolderBookmark;
  canReorder: boolean;
  dragId: string | null;
  overId: string | null;
  faviconKeys: Record<string, number>;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, id: string) => void;
  onContextMenu: (e: React.MouseEvent, url: string, title: string, id: string) => void;
}) {
  return (
    <div
      draggable={canReorder}
      onDragStart={(e) => onDragStart(e, b.id)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver(e, b.id)}
      onDrop={(e) => onDrop(e, b.id)}
      onContextMenu={(e) => onContextMenu(e, b.url, b.title, b.id)}
      className={cn(
        "group relative flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-all duration-200 ease-out",
        "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_24px_-12px_hsl(var(--primary)/0.25)] hover:ring-1 hover:ring-primary/20",
        canReorder && "cursor-grab",
        dragId === b.id && "cursor-grabbing opacity-50",
        overId === b.id && dragId !== b.id && "ring-2 ring-primary/60",
      )}
      title={b.url}
    >
      <a
        href={b.url}
        className={cn(
          "flex w-full items-center gap-3",
          canReorder && "cursor-inherit",
        )}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 ring-1 ring-inset ring-black/5 transition-all duration-200 group-hover:ring-primary/30 group-hover:shadow-sm dark:from-slate-800 dark:to-slate-900 dark:ring-white/5">
          <FaviconImg
            url={b.url}
            size={32}
            className="h-5 w-5"
            refreshKey={faviconKeys[b.url] ?? 0}
          />
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-0.5">
          <div className="truncate text-sm font-medium">
            {b.title}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {hostnameOf(b.url)}
          </div>
        </div>
      </a>
      <ExternalLink className="absolute right-2 top-2 h-3 w-3 text-muted-foreground opacity-0 transition group-hover:opacity-70" />
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, b.url, b.title, b.id);
        }}
        className="absolute bottom-2 right-2 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100"
        aria-label="more"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {canReorder && (
        <GripVertical className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-60" />
      )}
    </div>
  );
}

function Pager({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
}) {
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const jumpRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!jumpOpen) return;
    const close = (e: MouseEvent) => {
      if (!jumpRef.current) return;
      if (!jumpRef.current.contains(e.target as Node)) setJumpOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [jumpOpen]);

  const prev = () => onChange(Math.max(1, page - 1));
  const next = () => onChange(Math.min(pageCount, page + 1));
  const items = buildPageRange(page, pageCount);

  const doJump = () => {
    const n = Number(jumpValue);
    if (Number.isFinite(n) && n >= 1 && n <= pageCount) {
      onChange(Math.floor(n));
      setJumpOpen(false);
      setJumpValue("");
    }
  };

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={page <= 1}
        onClick={prev}
        className="flex h-7 w-7 items-center justify-center rounded-md border bg-card text-muted-foreground transition hover:border-primary/30 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-card disabled:hover:text-muted-foreground"
        aria-label="上一页"
      >
        <ChevronRight className="h-3.5 w-3.5 rotate-180" />
      </button>
      {items.map((it, idx) => {
        if (it === "ellipsis-l" || it === "ellipsis-r") {
          return (
            <div
              key={`${it}-${idx}`}
              ref={it === "ellipsis-r" ? jumpRef : undefined}
              className="relative"
            >
              <button
                type="button"
                onClick={() => {
                  setJumpOpen((v) => !v);
                  setJumpValue("");
                }}
                className="flex h-7 min-w-[28px] items-center justify-center rounded-md text-[12px] text-muted-foreground/80 transition hover:bg-accent hover:text-foreground"
                title="跳转页"
              >
                …
              </button>
              {jumpOpen && it === "ellipsis-r" && (
                <div
                  className="absolute left-1/2 top-9 z-40 -translate-x-1/2 rounded-lg border bg-popover p-2 shadow-xl ring-1 ring-black/5 dark:ring-white/5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="number"
                      min={1}
                      max={pageCount}
                      value={jumpValue}
                      onChange={(e) => setJumpValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") doJump();
                        else if (e.key === "Escape") setJumpOpen(false);
                      }}
                      placeholder={`1-${pageCount}`}
                      className="h-7 w-24 rounded-md border bg-background px-2 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button
                      type="button"
                      onClick={doJump}
                      className="h-7 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground transition hover:opacity-90"
                    >
                      跳转
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        }
        const active = it === page;
        return (
          <button
            key={it}
            type="button"
            onClick={() => onChange(it)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-7 min-w-[28px] items-center justify-center rounded-md px-2 text-[12px] tabular-nums transition",
              active
                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                : "border bg-card text-muted-foreground hover:border-primary/30 hover:bg-accent hover:text-foreground",
            )}
          >
            {it}
          </button>
        );
      })}
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={next}
        className="flex h-7 w-7 items-center justify-center rounded-md border bg-card text-muted-foreground transition hover:border-primary/30 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-card disabled:hover:text-muted-foreground"
        aria-label="下一页"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function BookmarkCtxMenu({
  x,
  y,
  onCopy,
  onQr,
  onRefreshIcon,
  onEdit,
  onDelete,
}: {
  id: string;
  url: string;
  title: string;
  x: number;
  y: number;
  onCopy: () => void;
  onQr: () => void;
  onRefreshIcon: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const left = Math.min(x, window.innerWidth - r.width - pad);
    const top = Math.min(y, window.innerHeight - r.height - pad);
    setPos({ left, top });
  }, [x, y]);
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-[60] min-w-[180px] rounded-lg border bg-popover p-1 text-sm shadow-lg"
      style={{ left: pos.left, top: pos.top }}
    >
      <button
        className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left hover:bg-accent"
        onClick={onCopy}
      >
        复制链接
      </button>
      <button
        className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left hover:bg-accent"
        onClick={onQr}
      >
        生成二维码
      </button>
      <button
        className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left hover:bg-accent"
        onClick={onRefreshIcon}
      >
        重新获取 icon
      </button>
      <button
        className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left hover:bg-accent"
        onClick={onEdit}
      >
        编辑
      </button>
      <div className="my-1 h-px bg-border" />
      <button
        className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-destructive hover:bg-destructive/10"
        onClick={onDelete}
      >
        删除书签
      </button>
    </div>
  );
}

// 编辑书签对话框
function EditBookmarkDialog({
  initialTitle,
  initialUrl,
  onClose,
  onSave,
}: {
  initialTitle: string;
  initialUrl: string;
  onClose: () => void;
  onSave: (title: string, url: string) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [url, setUrl] = useState(initialUrl);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !url.trim()) return;
    onSave(title.trim(), url.trim());
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-base font-medium">编辑书签</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">标题</label>
            <Input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="书签标题"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">链接</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!title.trim() || !url.trim()}>
              保存
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
