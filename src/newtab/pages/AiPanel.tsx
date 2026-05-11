import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chat } from "@/lib/ai";
import { BOOKMARK_TOOLS_OPENAI, CONFIRM_REQUIRED_TOOLS, type BookmarkToolResult } from "@/lib/aiTools";
import { getBookmarkContextForAi } from "@/lib/aiBookmarkContext";
import { renderMarkdown } from "@/lib/markdown";
import {
  listSessions,
  createSession,
  updateSession,
  deleteSession,
} from "@/lib/aiSessionDb";
import type { AiMessage, AiSession, Settings } from "@/types";
import { cn } from "@/lib/utils";
import {
  Send,
  Sparkles,
  Square,
  Flame,
  Loader2,
  Plus,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  User,
  Brain,
  X,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import { fetchTrending, trendingToMarkdown } from "@/lib/github";
import { toast } from "@/components/ui/toast";
import {
  getProfile,
  setProfile,
  getMemory,
  setMemory,
  addProfileEntries,
  addMemoryEntries,
} from "@/lib/aiUserDb";

const SYSTEM_PROMPT = [
  "You are Smart Bookmark Agent — an AI agent that works on top of the user's local Chrome bookmarks.",
  "Your core capabilities:",
  "- Answer questions grounded in the user's bookmark snapshot (counts, folders, domains, titles).",
  "- Recommend organization schemes (folders, tags, topics) and point out imbalance.",
  "- Flag potential duplicates, stale or suspicious URLs, and suggest cleanup.",
  "- Surface relevant saved links when the user asks about a topic, and propose related sites worth bookmarking.",
  "- Help craft search queries to find things they already saved.",
  "A snapshot of the user's bookmarks (counts, folder breakdown, sample titles + URLs) is appended below under '---'. Prefer grounding your answers in it. If the user asks something unrelated to their bookmarks, answer briefly and steer back to what you can do for their collection.",
  "Style: concise, use bullet points, reply in the user's language (Chinese ↔ English). Never fabricate bookmarks that don't appear in the snapshot.",
  "",
  "## 记忆管理",
  "你有 save_memory 工具，用于持久记住关于用户的信息。当对话中出现以下情况时调用：",
  "- 用户明确透露身份信息（姓名、职业、角色、语言偏好）→ type: \"profile\"",
  "- 发现用户的偏好、习惯、行为模式、工作方式 → type: \"memory\"",
  "- 讨论中产生值得记住的结论或事实 → type: \"memory\"",
  "规则：",
  "- 只在有明确新信息时调用，不要为了调用而调用",
  "- 每条信息一句话，简洁浓缩",
  "- 如果用户明确要求你记住某事，务必调用",
  "- 不需要每次都调用，大多数对话不需要触发",
  "- 保存前先用 list_memory 检查是否已存在相同或相似的条目，避免重复",
  "你还有记忆管理工具：",
  "- list_memory：查看当前已保存的画像和记忆，保存前应先调用",
  "- delete_memory：删除错误或过时的条目",
  "- update_memory：修改已有条目的内容",
].join("\n");

function formatMsgTime(
  at: number | undefined,
  language: Settings["language"],
) {
  if (at == null) return "";
  const locale =
    language === "zh" ? "zh-CN" : language === "en" ? "en-US" : undefined;
  return new Date(at).toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeTime(ts: number, language: Settings["language"]) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return language === "zh" ? "刚刚" : "Just now";
  if (diff < 3600_000) {
    const m = Math.floor(diff / 60_000);
    return language === "zh" ? `${m} 分钟前` : `${m}m ago`;
  }
  if (diff < 86400_000) {
    const h = Math.floor(diff / 3600_000);
    return language === "zh" ? `${h} 小时前` : `${h}h ago`;
  }
  const d = Math.floor(diff / 86400_000);
  if (d < 7) return language === "zh" ? `${d} 天前` : `${d}d ago`;
  return new Date(ts).toLocaleDateString(
    language === "zh" ? "zh-CN" : "en-US",
    { month: "short", day: "numeric" },
  );
}

export default function AiPanel({ settings }: { settings: Settings }) {
  const t = useT();

  /* ── 会话状态 ── */
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  /* ── 聊天状态 ── */
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [injectingTrending, setInjectingTrending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** 正在累积的 tool call（流式中间态） */
  const pendingToolCallsRef = useRef<Map<string, { id: string; name: string; argsStr: string; _done?: boolean }>>(new Map());
  /** 始终持有最新 messages 的 ref，避免闭包陈旧 */
  const messagesRef = useRef<AiMessage[]>([]);
  /** 保存本轮对话的书签快照，continueChat 不重新拉取 */
  const bookmarkCtxRef = useRef<string>("");
  /** 当前会话的系统提示词（新建时构建，后续复用） */
  const systemPromptRef = useRef<string>("");
  /** tool-confirm 状态：当前等待用户确认的 tool call */
  const [confirmToolCall, setConfirmToolCall] = useState<{ id: string; name: string; args: Record<string, unknown> } | null>(null);

  /* ── 画像/记忆面板状态 ── */
  const [activePanel, setActivePanel] = useState<"profile" | "memory" | null>(null);
  const [profileText, setProfileText] = useState("");
  const [memoryEntries, setMemoryEntries] = useState<string[]>([]);
  const [memoryInput, setMemoryInput] = useState("");

  /** 是否自动滚动到底部（用户上翻时暂停，发新消息时恢复） */
  const autoScrollRef = useRef(true);
  /** 流式输出中标志，跳过 onScroll 干扰 */
  const streamingRef = useRef(false);

  const scrollToBottom = () => {
    if (!autoScrollRef.current) return;
    setTimeout(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  };

  /** 监听滚动事件，判断用户是否主动上翻 */
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    autoScrollRef.current = nearBottom;
  };

  /* ── 加载会话列表 ── */
  const loadSessions = useCallback(async () => {
    const list = await listSessions();
    setSessions(list);
    return list;
  }, []);

  useEffect(() => {
    loadSessions().then((list) => {
      if (list.length > 0) {
        sessionIdRef.current = list[0].id;
        setSessionId(list[0].id);
        setMessages(list[0].messages);
        systemPromptRef.current = list[0].systemPrompt ?? "";
        scrollToBottom();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── 切换会话 ── */
  const switchSession = useCallback(
    (id: string) => {
      if (id === sessionId) return;
      const s = sessions.find((x) => x.id === id);
      if (!s) return;
      sessionIdRef.current = id;
      setSessionId(id);
      setMessages(s.messages);
      systemPromptRef.current = s.systemPrompt ?? "";
      scrollToBottom();
    },
    [sessionId, sessions],
  );

  /* ── 新建会话 ── */
  const newSession = useCallback(async () => {
    const s = await createSession("新对话");
    sessionIdRef.current = s.id;
    setSessions((prev) => [s, ...prev]);
    setSessionId(s.id);
    setMessages([]);
  }, []);

  /* ── 删除会话 ── */
  const removeSession = useCallback(
    async (id: string) => {
      await deleteSession(id);
      setSessions((prev) => {
        const next = prev.filter((x) => x.id !== id);
        if (sessionId === id) {
          const fallback = next[0];
          sessionIdRef.current = fallback?.id ?? null;
          setSessionId(fallback?.id ?? null);
          setMessages(fallback?.messages ?? []);
        }
        return next;
      });
    },
    [sessionId],
  );

  /* ── 持久化当前会话（用 ref 避免闭包陈旧，过滤 tool-confirm） ── */
  const persist = useCallback(
    async (msgs: AiMessage[], title?: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      // tool-confirm 不持久化，仅当前会话渲染
      const filtered = msgs.filter((m) => m.role !== "tool-confirm");
      await updateSession(sid, filtered, title);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sid
            ? {
                ...s,
                messages: filtered,
                updatedAt: Date.now(),
                ...(title != null ? { title } : {}),
              }
            : s,
        ),
      );
    },
    [],
  );

  /* ── 注入 Trending ── */
  const injectTrending = async () => {
    setInjectingTrending(true);
    try {
      const data = await fetchTrending({
        range: settings.discoverDefaultRange ?? "weekly",
        mode: settings.discoverDefaultMode ?? "created",
        language: settings.discoverDefaultLanguage || undefined,
        limit: 20,
        token: settings.githubToken || undefined,
      });
      const md = trendingToMarkdown(data, {
        range: settings.discoverDefaultRange ?? "weekly",
        mode: settings.discoverDefaultMode ?? "created",
        language: settings.discoverDefaultLanguage,
      });
      const now = Date.now();
      const next = [
        ...messages,
        {
          role: "user" as const,
          content: `下面是我从 GitHub 拉到的热门项目，请基于它回答接下来的问题，或给出概览。\n\n${md}`,
          at: now,
        },
      ];
      setMessages(next);
      persist(next);
      toast(t("discover.injectedAi", String(data.length)), "success");
    } catch (err) {
      toast(
        t("discover.error") + ": " + ((err as Error)?.message ?? ""),
        "error",
      );
    } finally {
      setInjectingTrending(false);
    }
  };

  const visible = messages.filter(
    (m) =>
      m.role !== "system" &&
      m.role !== "tool" &&
      // 过滤掉空的 assistant 工具调用占位消息
      !(m.role === "assistant" && !m.content && m.toolCalls?.length),
  );
  // 每次渲染同步 messages 到 ref，确保异步回调中能读到最新值
  messagesRef.current = messages;
  const modelLine =
    settings.aiProvider === "none"
      ? t("ai.disabled")
      : `${settings.aiProvider} · ${settings.aiModel}`;

  /** 构造 onToolCall 回调，累积流式 tool call 参数 */
  const makeOnToolCall = () => (call: import("@/lib/ai").ToolCallDelta) => {
    if (call.done && !call.id) {
      for (const tc of pendingToolCallsRef.current.values()) tc._done = true;
      return;
    }
    if (call.id) {
      const existing = pendingToolCallsRef.current.get(call.id) ?? { id: call.id, name: "", argsStr: "", _done: false };
      if (call.name) existing.name = call.name;
      if (call.arguments) existing.argsStr += call.arguments;
      if (call.done) existing._done = true;
      pendingToolCallsRef.current.set(call.id, existing);
    }
  };

  /** 流式结束后检查并处理 tool calls */
  const checkToolCallsFromStream = async () => {
    const completedCalls = [...pendingToolCallsRef.current.values()].filter((tc) => tc._done);
    if (completedCalls.length > 0) {
      const parsed = completedCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: JSON.parse(tc.argsStr || "{}") as Record<string, unknown>,
      }));
      setMessages((prev) => prev.slice(0, -1));
      await handleToolCallDone(parsed);
      return true;
    }
    return false;
  };

  /** 流式错误处理 */
  const handleStreamError = (err: any) => {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      copy[copy.length - 1] = {
        role: "assistant",
        content: `⚠️ ${err?.message ?? "请求失败"}`,
        at: last?.at,
      };
      persist(copy);
      return copy;
    });
  };

  /** 流式 finally 清理 */
  const cleanupStreaming = () => {
    streamingRef.current = false;
    if (persistTimerRef.current) {
      clearInterval(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    setLoading(false);
    abortRef.current = null;
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  /** 启动持久化定时器 */
  const startPersistTimer = (getAcc: () => string) => {
    if (persistTimerRef.current) clearInterval(persistTimerRef.current);
    persistTimerRef.current = setInterval(() => {
      if (getAcc()) {
        setMessages((prev) => { persist(prev); return prev; });
      }
    }, 2000);
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text) return;
    setConfirmToolCall(null);
    if (settings.aiProvider === "none" || !settings.aiApiKey) {
      alert(t("ai.needKey"));
      return;
    }

    // 如果当前没有会话，先创建一个
    if (!sessionIdRef.current) {
      const s = await createSession(text.slice(0, 30));
      sessionIdRef.current = s.id;
      setSessions((prev) => [s, ...prev]);
      setSessionId(s.id);
    }

    let systemContent: string;

    if (systemPromptRef.current) {
      // 复用已有的系统提示词（从 session 恢复或之前构建的）
      systemContent = systemPromptRef.current;
    } else {
      // 首次构建系统提示词
      const bookmarkCtx = await getBookmarkContextForAi();
      bookmarkCtxRef.current = bookmarkCtx;
      const [profileEntries, memoryEntriesData] = await Promise.all([
        getProfile(),
        getMemory(),
      ]);

      let userContext = "";
      if (profileEntries.length > 0) {
        userContext += `## 用户画像\n${profileEntries.map((e) => `- ${e}`).join("\n")}`;
      }
      if (memoryEntriesData.length > 0) {
        if (userContext) userContext += "\n\n";
        userContext += `## 持久记忆\n${memoryEntriesData.map((e) => `- ${e}`).join("\n")}`;
      }

      systemContent = userContext
        ? `${SYSTEM_PROMPT}\n\n---\n${bookmarkCtx}\n\n---\n${userContext}`
        : `${SYSTEM_PROMPT}\n\n---\n${bookmarkCtx}`;

      // 追加 MCP 能力说明
      const mcpCapabilities: string[] = [];
      if (settings.mcpWebReader) {
        mcpCapabilities.push("- web_reader：抓取指定 URL 的网页内容，可用来阅读文章、获取页面信息");
      }
      if (settings.mcpWebSearch) {
        mcpCapabilities.push("- web_search：搜索网络信息，可用来查找最新资讯、验证信息，参数为 search_query");
      }
      if (mcpCapabilities.length > 0) {
        systemContent += "\n\n## 扩展能力\n" + mcpCapabilities.join("\n");
      }

      // 持久化系统提示词到会话
      systemPromptRef.current = systemContent;
      if (sessionIdRef.current) {
        updateSession(sessionIdRef.current, [], undefined, systemContent);
      }
    }

    const convo = messages.filter((m) => m.role !== "system");
    const forApi: AiMessage[] = [
      {
        role: "system",
        content: systemContent,
      },
      ...convo,
      { role: "user", content: text },
    ];
    const now = Date.now();
    const next = [
      ...messages,
      { role: "user" as const, content: text, at: now },
      { role: "assistant" as const, content: "", at: now },
    ];
    autoScrollRef.current = true;
    setMessages(next);
    scrollToBottom();

    // 首条用户消息 → 自动命名
    const isFirstUserMsg = !messages.some((m) => m.role === "user");
    if (isFirstUserMsg) {
      persist(next, text.slice(0, 30));
    } else {
      persist(next);
    }

    setInput("");
    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      streamingRef.current = true;
      let acc = "";
      let thinkingAcc = "";
      startPersistTimer(() => acc);

      // 动态构建工具列表：根据设置包含 MCP 工具
      const baseTools = BOOKMARK_TOOLS_OPENAI.filter((t) => {
        if (t.function.name === "web_reader") return settings.mcpWebReader;
        if (t.function.name === "web_search") return settings.mcpWebSearch;
        return true;
      });
      const tools = settings.aiProvider === "openai"
        ? baseTools
        : baseTools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters,
          }));
      await chat({
        settings,
        messages: forApi,
        signal: ctrl.signal,
        tools,
        onThinking: settings.showThinking ? (delta) => {
          thinkingAcc += delta;
          setMessages((prev) => {
            const copy = [...prev];
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].role === "assistant") {
                copy[i] = { ...copy[i], thinking: thinkingAcc };
                break;
              }
            }
            return copy;
          });
          scrollToBottom();
        } : undefined,
        onDelta: (d) => {
          acc += d;
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, content: acc };
            return copy;
          });
          scrollToBottom();
        },
        onToolCall: makeOnToolCall(),
      });
      if (await checkToolCallsFromStream()) return;
      setMessages((prev) => { persist(prev); return prev; });
    } catch (err: any) {
      handleStreamError(err);
    } finally {
      cleanupStreaming();
    }
  };

  /** 通过 background 执行工具（书签工具或 Web 工具） */
  const executeTool = async (toolName: string, args: Record<string, unknown>) => {
    // Web 工具走独立消息类型
    if (toolName === "web_reader" || toolName === "web_search") {
      return new Promise<{ ok: boolean; result?: { success: boolean; message: string; data?: unknown }; error?: string }>((resolve) => {
        chrome.runtime.sendMessage(
          { type: "execute-mcp-tool", tool: toolName, args },
          (resp) => resolve(resp),
        );
      });
    }
    // 书签工具走原有路径
    return new Promise<{ ok: boolean; result?: { success: boolean; message: string; data?: unknown }; error?: string }>((resolve) => {
      chrome.runtime.sendMessage(
        { type: "execute-bookmark-tool", tool: toolName, args },
        (resp) => resolve(resp),
      );
    });
  };

  /** 查询书签/文件夹名称 */
  const lookupName = async (id: string): Promise<string> => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "lookup-bookmark-name", id },
        (resp) => resolve(resp?.name ?? id),
      );
    });
  };

  /** 执行 save_memory 工具：直接写入 IndexedDB */
  const executeSaveMemory = async (args: Record<string, unknown>): Promise<BookmarkToolResult> => {
    try {
      const type = args.type as string;
      const entries = (args.entries as string[]) ?? [];

      if (type === "profile") {
        await addProfileEntries(entries);
      } else if (type === "memory") {
        await addMemoryEntries(entries);
      } else {
        return { success: false, message: `未知类型: ${type}` };
      }

      // 在对话流中插入通知
      setMessages((prev) => [
        ...prev,
        { role: "system", content: `已记住：${entries.join("、")}` },
      ]);

      return { success: true, message: `已保存 ${entries.length} 条${type === "profile" ? "画像" : "记忆"}信息` };
    } catch {
      return { success: false, message: "保存失败" };
    }
  };

  /** 执行 list_memory 工具：返回当前画像和记忆 */
  const executeListMemory = async (): Promise<BookmarkToolResult> => {
    try {
      const [profile, memory] = await Promise.all([getProfile(), getMemory()]);
      const data = { profile, memory };
      return { success: true, message: JSON.stringify(data), data };
    } catch {
      return { success: false, message: "读取失败" };
    }
  };

  /** 执行 delete_memory 工具：删除指定条目 */
  const executeDeleteMemory = async (args: Record<string, unknown>): Promise<BookmarkToolResult> => {
    try {
      const type = args.type as string;
      const entry = args.entry as string;

      if (type === "profile") {
        const entries = await getProfile();
        const next = entries.filter((e) => e !== entry);
        if (next.length === entries.length) return { success: false, message: `未找到条目: ${entry}` };
        await setProfile(next);
      } else if (type === "memory") {
        const entries = await getMemory();
        const next = entries.filter((e) => e !== entry);
        if (next.length === entries.length) return { success: false, message: `未找到条目: ${entry}` };
        await setMemory(next);
      } else {
        return { success: false, message: `未知类型: ${type}` };
      }

      setMessages((prev) => [
        ...prev,
        { role: "system", content: `已删除：${entry}` },
      ]);

      return { success: true, message: `已删除 ${type === "profile" ? "画像" : "记忆"}条目` };
    } catch {
      return { success: false, message: "删除失败" };
    }
  };

  /** 执行 update_memory 工具：修改指定条目 */
  const executeUpdateMemory = async (args: Record<string, unknown>): Promise<BookmarkToolResult> => {
    try {
      const type = args.type as string;
      const oldEntry = args.old_entry as string;
      const newEntry = args.new_entry as string;

      if (type === "profile") {
        const entries = await getProfile();
        const idx = entries.indexOf(oldEntry);
        if (idx === -1) return { success: false, message: `未找到条目: ${oldEntry}` };
        entries[idx] = newEntry;
        await setProfile(entries);
      } else if (type === "memory") {
        const entries = await getMemory();
        const idx = entries.indexOf(oldEntry);
        if (idx === -1) return { success: false, message: `未找到条目: ${oldEntry}` };
        entries[idx] = newEntry;
        await setMemory(entries);
      } else {
        return { success: false, message: `未知类型: ${type}` };
      }

      setMessages((prev) => [
        ...prev,
        { role: "system", content: `已修改：${oldEntry} → ${newEntry}` },
      ]);

      return { success: true, message: `已修改${type === "profile" ? "画像" : "记忆"}条目` };
    } catch {
      return { success: false, message: "修改失败" };
    }
  };

  /** 处理 tool call 完成后的执行逻辑 */
  const handleToolCallDone = async (toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => {
    setLoading(false);
    if (persistTimerRef.current) {
      clearInterval(persistTimerRef.current);
      persistTimerRef.current = null;
    }

    // 拦截记忆管理工具：直接在面板执行，不经过 background
    const MEMORY_TOOLS = new Set(["save_memory", "list_memory", "delete_memory", "update_memory"]);
    const memoryCalls = toolCalls.filter((tc) => MEMORY_TOOLS.has(tc.name));
    const otherCalls = toolCalls.filter((tc) => !MEMORY_TOOLS.has(tc.name));

    for (const tc of memoryCalls) {
      let result: BookmarkToolResult;
      switch (tc.name) {
        case "save_memory": result = await executeSaveMemory(tc.args); break;
        case "list_memory": result = await executeListMemory(); break;
        case "delete_memory": result = await executeDeleteMemory(tc.args); break;
        case "update_memory": result = await executeUpdateMemory(tc.args); break;
        default: result = { success: false, message: "未知工具" };
      }
      const assistantMsg: AiMessage = {
        role: "assistant",
        content: "",
        toolCalls: [tc],
      };
      const toolResult: AiMessage = {
        role: "tool",
        content: JSON.stringify(result),
        toolResult: { toolCallId: tc.id, ...result },
      };
      setMessages((prev) => [...prev, assistantMsg, toolResult]);
      setMessages((prev) => { persist(prev); return prev; });
    }

    if (otherCalls.length === 0) {
      // 全是记忆工具，直接继续对话
      await continueChat([...messagesRef.current], bookmarkCtxRef.current);
      return;
    }

    for (const tc of otherCalls) {
      if (CONFIRM_REQUIRED_TOOLS.has(tc.name)) {
        // 查询书签和文件夹的实际名称
        const bookmarkId = String(tc.args.bookmarkId ?? "");
        const targetFolderId = String(tc.args.targetFolderId ?? "");
        const [bookmarkName, folderName] = await Promise.all([
          bookmarkId ? lookupName(bookmarkId) : Promise.resolve(""),
          targetFolderId ? lookupName(targetFolderId) : Promise.resolve(""),
        ]);
        const summary = buildToolConfirmSummary(tc.name, tc.args, bookmarkName, folderName);
        const confirmMsg: AiMessage = {
          role: "tool-confirm",
          content: summary,
          at: Date.now(),
        };
        setMessages((prev) => [...prev, confirmMsg]);
        setConfirmToolCall(tc);
        scrollToBottom();
        return;
      }
    }

    await executeToolCalls(otherCalls);
  };

  /** 执行工具并继续对话 */
  const executeToolCalls = async (toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>) => {
    const assistantMsg: AiMessage = {
      role: "assistant",
      content: "",
      toolCalls,
    };

    setMessages((prev) => [...prev, assistantMsg]);

    const toolResults: AiMessage[] = [];
    for (const tc of toolCalls) {
      const resp = await executeTool(tc.name, tc.args);
      const result = resp?.result ?? { success: false, message: resp?.error ?? "执行失败" };
      toolResults.push({
        role: "tool",
        content: JSON.stringify(result),
        toolResult: { toolCallId: tc.id, ...result },
      });
    }

    setMessages((prev) => [...prev, ...toolResults]);
    setMessages((prev) => { persist(prev); return prev; });

    await continueChat([...messagesRef.current, assistantMsg, ...toolResults], bookmarkCtxRef.current);
  };

  /** 用户确认执行 */
  const confirmAndExecute = async () => {
    if (!confirmToolCall) return;
    const tc = confirmToolCall;
    setConfirmToolCall(null);
    // 将 tool-confirm 消息替换为"执行中"提示
    setMessages((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "tool-confirm") {
          const copy = [...prev];
          copy[i] = { role: "assistant", content: "正在执行操作…", at: Date.now() };
          return copy;
        }
      }
      return prev;
    });
    await executeToolCalls([tc]);
  };

  /** 用户取消操作 */
  const cancelToolCall = () => {
    if (!confirmToolCall) return;
    const tc = confirmToolCall;
    setConfirmToolCall(null);
    // 将 tool-confirm 消息替换为"已取消"
    setMessages((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "tool-confirm") {
          const copy = [...prev];
          copy[i] = { role: "assistant", content: "已取消操作。", at: Date.now() };
          return copy;
        }
      }
      return prev;
    });

    const cancelMsg: AiMessage = {
      role: "tool",
      content: JSON.stringify({ success: false, message: "用户取消了操作" }),
      toolResult: { toolCallId: tc.id, success: false, message: "用户取消了操作" },
    };
    setMessages((prev) => [...prev, cancelMsg]);
    setMessages((prev) => { persist(prev); return prev; });
    continueChat([...messagesRef.current, cancelMsg], bookmarkCtxRef.current);
  };

  /* ── 画像/记忆面板 ── */
  const togglePanel = async (panel: "profile" | "memory") => {
    if (activePanel === panel) {
      setActivePanel(null);
      return;
    }
    setActivePanel(panel);
    if (panel === "profile") {
      const entries = await getProfile();
      setProfileText(entries.join("\n"));
    } else {
      const entries = await getMemory();
      setMemoryEntries(entries);
    }
  };

  const saveProfile = async () => {
    const entries = profileText.split("\n").map((l) => l.trim()).filter(Boolean);
    await setProfile(entries);
    toast(t("ai.saved"), "success");
  };

  const addMemory = async () => {
    const text = memoryInput.trim();
    if (!text) return;
    await addMemoryEntries([text]);
    setMemoryEntries((prev) => [...prev, text]);
    setMemoryInput("");
  };

  const removeMemory = async (index: number) => {
    const next = memoryEntries.filter((_, i) => i !== index);
    setMemoryEntries(next);
    await setMemory(next);
  };

  /** 用 tool result 继续对话 */
  const continueChat = async (conversationHistory: AiMessage[], _bookmarkCtx?: string) => {
    // 直接复用系统提示词，不重新构建
    const systemContent = systemPromptRef.current;

    const forApi: AiMessage[] = [
      {
        role: "system",
        content: systemContent,
      },
      ...conversationHistory,
    ];

    // 动态构建工具列表：根据设置过滤 MCP 工具（与 send() 保持一致）
    const baseTools = BOOKMARK_TOOLS_OPENAI.filter((t) => {
      if (t.function.name === "web_reader") return settings.mcpWebReader;
      if (t.function.name === "web_search") return settings.mcpWebSearch;
      return true;
    });
    const tools = settings.aiProvider === "openai"
      ? baseTools
      : baseTools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters,
        }));

    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const now = Date.now();
    setMessages((prev) => [...prev, { role: "assistant", content: "", at: now }]);

    try {
      streamingRef.current = true;
      let acc = "";
      let thinkingAcc = "";
      pendingToolCallsRef.current.clear();
      startPersistTimer(() => acc);

      await chat({
        settings,
        messages: forApi,
        signal: ctrl.signal,
        tools,
        onThinking: settings.showThinking ? (delta) => {
          thinkingAcc += delta;
          setMessages((prev) => {
            const copy = [...prev];
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].role === "assistant") {
                copy[i] = { ...copy[i], thinking: thinkingAcc };
                break;
              }
            }
            return copy;
          });
          scrollToBottom();
        } : undefined,
        onDelta: (d) => {
          acc += d;
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, content: acc };
            return copy;
          });
          scrollToBottom();
        },
        onToolCall: makeOnToolCall(),
      });

      if (await checkToolCallsFromStream()) return;
      setMessages((prev) => { persist(prev); return prev; });
    } catch (err: any) {
      handleStreamError(err);
    } finally {
      cleanupStreaming();
    }
  };

  function buildToolConfirmSummary(
    name: string,
    args: Record<string, unknown>,
    bookmarkName: string,
    folderName: string,
  ): string {
    switch (name) {
      case "delete_bookmark":
        return `删除书签「${bookmarkName || args.bookmarkId}」`;
      case "move_bookmark":
        return `移动书签「${bookmarkName || args.bookmarkId}」→ 文件夹「${folderName || args.targetFolderId}」`;
      default:
        return `${name}: ${JSON.stringify(args)}`;
    }
  }

  const stop = () => abortRef.current?.abort();
  const isAiLive = settings.aiProvider !== "none";

  return (
    <div className="mx-auto flex h-[calc(100vh-10rem)] w-full max-w-5xl gap-0 overflow-hidden rounded-lg border"
      style={{ borderColor: "hsl(var(--claude-rule))" }}
    >
      {/* ── 左侧会话列表 ── */}
      {sidebarOpen && (
        <aside
          className="flex w-60 shrink-0 flex-col border-r"
          style={{
            borderColor: "hsl(var(--claude-rule))",
            backgroundColor: "hsl(var(--background))",
          }}
        >
          <div className="flex items-center justify-between border-b px-3 py-2.5"
            style={{ borderColor: "hsl(var(--claude-rule))" }}
          >
            <Button
              variant="outline"
              size="sm"
              onClick={newSession}
              className="gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("ai.newChat")}
            </Button>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded p-1 transition hover:bg-muted"
              title={t("ai.collapseSidebar")}
            >
              <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <div className="scrollbar-thin flex-1 overflow-auto py-1">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <Sparkles className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">
                  {t("ai.emptySessions")}
                </p>
                <p className="text-[10px] text-muted-foreground/60">
                  {t("ai.emptySessionsHint")}
                </p>
              </div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    "group flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition",
                    s.id === sessionId
                      ? "bg-muted"
                      : "hover:bg-muted/50",
                  )}
                  onClick={() => switchSession(s.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground/90">
                      {s.title}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {relativeTime(s.updatedAt, settings.language)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(t("ai.deleteConfirm"))) {
                        removeSession(s.id);
                      }
                    }}
                    className="hidden rounded p-1 text-muted-foreground/50 transition hover:bg-destructive/10 hover:text-destructive group-hover:block"
                    title={t("ai.deleteSession")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      {/* ── 右侧聊天区 ── */}
      <div className="flex flex-1 flex-col">
        <header className="mb-3 flex items-center justify-between gap-3 px-4 pt-3">
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="mr-1 rounded p-1 transition hover:bg-muted"
                title={t("ai.expandSidebar")}
              >
                <PanelLeftOpen className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
            <div className="flex items-center gap-2.5 font-serif text-[1.1rem] tracking-tight">
              <Sparkles
                className="h-4 w-4"
                style={{ color: "hsl(var(--claude-accent))" }}
                strokeWidth={1.8}
              />
              <span className="font-semibold">{t("ai.title")}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={injectTrending}
              disabled={injectingTrending}
              className="gap-1.5 text-xs"
              title={t("discover.injectAi")}
            >
              {injectingTrending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Flame className="h-3.5 w-3.5 text-rose-500" />
              )}
              {t("discover.injectAi")}
            </Button>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10.5px]",
                isAiLive
                  ? "bg-background/60"
                  : "bg-muted/60 text-muted-foreground",
              )}
              style={
                isAiLive
                  ? { color: "hsl(var(--claude-ink-muted))" }
                  : undefined
              }
              title={isAiLive ? modelLine : t("ai.disabled")}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  isAiLive
                    ? "bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.15)]"
                    : "bg-muted-foreground/40",
                )}
                aria-hidden
              />
              {modelLine}
            </span>
            <button
              type="button"
              onClick={() => togglePanel("profile")}
              className={cn(
                "rounded p-1 transition hover:bg-muted",
                activePanel === "profile" && "bg-muted",
              )}
              title={t("ai.profile")}
            >
              <User className="h-4 w-4 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => togglePanel("memory")}
              className={cn(
                "rounded p-1 transition hover:bg-muted",
                activePanel === "memory" && "bg-muted",
              )}
              title={t("ai.memory")}
            >
              <Brain className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-3 overflow-hidden px-4 pb-3">
          {/* ── 画像/记忆编辑面板 ── */}
          {activePanel && (
            <div className="shrink-0 rounded-lg border p-4" style={{ borderColor: "hsl(var(--claude-rule))" }}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">
                  {activePanel === "profile" ? t("ai.profile") : t("ai.memory")}
                </span>
                <button
                  type="button"
                  onClick={() => setActivePanel(null)}
                  className="rounded p-1 transition hover:bg-muted"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
              {activePanel === "profile" ? (
                <div>
                  <textarea
                    value={profileText}
                    onChange={(e) => setProfileText(e.target.value)}
                    placeholder={t("ai.profileHint")}
                    className="h-32 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                    style={{ borderColor: "hsl(var(--claude-rule))" }}
                  />
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" onClick={saveProfile}>{t("common.save")}</Button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-2 max-h-40 space-y-1 overflow-auto">
                    {memoryEntries.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t("ai.memoryHint")}</p>
                    ) : (
                      memoryEntries.map((entry, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50">
                          <span className="min-w-0 flex-1 truncate">{entry}</span>
                          <button
                            type="button"
                            onClick={() => removeMemory(i)}
                            className="shrink-0 rounded p-0.5 text-muted-foreground/50 transition hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={memoryInput}
                      onChange={(e) => setMemoryInput(e.target.value)}
                      placeholder={t("ai.memoryPlaceholder")}
                      onKeyDown={(e) => { if (e.key === "Enter") addMemory(); }}
                    />
                    <Button size="sm" onClick={addMemory}>{t("ai.memoryAdd")}</Button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="scrollbar-thin flex-1 space-y-8 overflow-auto rounded-lg px-6 py-6"
            style={{
              backgroundColor: "hsl(var(--claude-canvas))",
            }}
          >
            {!visible.length && (
              <div className="flex flex-col items-center gap-5 px-4 py-6 text-center">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: "hsl(var(--claude-accent) / 0.12)",
                    color: "hsl(var(--claude-accent))",
                  }}
                >
                  <Sparkles className="h-6 w-6" strokeWidth={1.6} />
                </div>
                <div className="max-w-md space-y-2">
                  <h3 className="font-serif text-lg font-semibold tracking-tight">
                    {t("ai.emptyHeading")}
                  </h3>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: "hsl(var(--claude-ink-muted))" }}
                  >
                    {t("ai.emptyDesc")}
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  {[
                    t("ai.suggestOrganize"),
                    t("ai.suggestFindDups"),
                    t("ai.suggestRecommend"),
                    t("ai.suggestSummary"),
                  ].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border px-3 py-1.5 font-serif text-[12.5px] transition hover:bg-background/70"
                      style={{
                        borderColor: "hsl(var(--claude-rule))",
                        color: "hsl(var(--claude-ink-muted))",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {visible.map((m, i) => {
              const isUser = m.role === "user";
              const isToolConfirm = m.role === "tool-confirm";
              const rail = isUser
                ? "hsl(var(--primary))"
                : "hsl(var(--claude-accent))";
              if (isToolConfirm) {
                return (
                  <article
                    key={m.at != null ? `${m.at}-confirm-${i}` : i}
                    className="rounded-lg border p-4"
                    style={{
                      borderColor: "hsl(var(--claude-rule))",
                      backgroundColor: "hsl(var(--claude-canvas))",
                    }}
                  >
                    <div className="mb-2 text-sm font-medium text-foreground/80">
                      {t("ai.toolConfirmTitle")}
                    </div>
                    <div className="mb-3 text-sm text-foreground/60">
                      {m.content}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={confirmAndExecute}>
                        {t("ai.toolConfirm")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={cancelToolCall}>
                        {t("ai.toolCancel")}
                      </Button>
                    </div>
                  </article>
                );
              }
              return (
                <article
                  key={m.at != null ? `${m.at}-${m.role}-${i}` : i}
                  className="pl-4"
                  style={{
                    borderLeft: `2px solid ${rail}`,
                  }}
                >
                  <header
                    className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]"
                    style={{ color: "hsl(var(--claude-ink-muted))" }}
                  >
                    <span
                      className="font-serif text-[13px] font-semibold tracking-tight text-foreground"
                      style={isUser ? undefined : { color: rail }}
                    >
                      {isUser ? t("ai.userLabel") : t("ai.assistantLabel")}
                    </span>
                    {m.at != null && (
                      <time dateTime={new Date(m.at).toISOString()}>
                        {formatMsgTime(m.at, settings.language)}
                      </time>
                    )}
                    {!isUser && settings.aiProvider !== "none" && (
                      <span className="rounded-md bg-background/60 px-1.5 py-0 font-mono text-[10px]">
                        {modelLine}
                      </span>
                    )}
                  </header>
                  <div
                    className={cn(
                      "text-[14px] leading-[1.7] text-foreground/90",
                      !isUser && "space-y-1",
                      isUser && "whitespace-pre-wrap",
                    )}
                  >
                    {/* 自动学习结果 */}
                    {m.learnDetail && (
                      <LearnResultBlock detail={m.learnDetail} />
                    )}
                    {/* 思考过程折叠块：有 thinking 无 content 时展开（思考中），有 content 后折叠 */}
                    {!isUser && m.thinking && (
                      <ThinkingBlock content={m.thinking} expanded={!m.content} />
                    )}
                    {m.content
                      ? isUser
                        ? m.content
                        : renderMarkdown(m.content)
                      : loading && i === visible.length - 1
                        ? (
                          <span
                            className="italic"
                            style={{ color: "hsl(var(--claude-ink-muted))" }}
                          >
                            …
                          </span>
                        )
                        : ""}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("ai.placeholder")}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={loading}
            />
            {loading ? (
              <Button variant="outline" onClick={stop} className="gap-2">
                <Square className="h-4 w-4" /> {t("cleaner.stop")}
              </Button>
            ) : (
              <Button onClick={() => send()} className="gap-2">
                <Send className="h-4 w-4" /> {t("ai.send")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LearnResultBlock({ detail }: { detail: { added: { text: string; reason: string }[]; message: string } }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <div className="mb-2 rounded-lg border border-muted bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition hover:bg-muted/50"
      >
        <svg
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {detail.added.length > 0
          ? t("ai.learnUpdated").replace("{count}", String(detail.added.length))
          : t("ai.learnNoUpdate")}
      </button>
      {open && (
        <div className="border-t border-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {detail.added.length === 0 ? (
            <p>{detail.message}</p>
          ) : (
            <ul className="space-y-1">
              {detail.added.map((item, i) => (
                <li key={i}>
                  <span className="font-medium text-foreground/80">{item.text}</span>
                  <span className="ml-1 text-muted-foreground/70">— {item.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ content, expanded }: { content: string; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded ?? false);
  const t = useT();
  const contentRef = useRef<HTMLDivElement>(null);

  // 外部 expanded 变化时同步（思考阶段→展开，回复阶段→折叠）
  useEffect(() => {
    if (expanded !== undefined) setOpen(expanded);
  }, [expanded]);

  // 思考中（expanded=true）时自动滚到底部
  useEffect(() => {
    if (expanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content, expanded]);

  return (
    <div className="mb-2 rounded-lg border border-muted bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition hover:bg-muted/50"
      >
        <svg
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {t("ai.thinkingProcess")}
      </button>
      {open && (
        <div
          ref={contentRef}
          className="max-h-48 overflow-auto border-t border-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground"
          style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}
        >
          {content}
        </div>
      )}
    </div>
  );
}
