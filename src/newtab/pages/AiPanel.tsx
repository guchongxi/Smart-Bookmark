import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runChatStream } from "@/lib/chatSession";
import { CONFIRM_REQUIRED_TOOLS, type BookmarkToolResult } from "@/lib/aiTools";
import {
  executeMemoryTool,
  executeBackgroundTool,
  lookupBookmarkName,
  validateConfirmToolCall,
  normalizeToolId,
} from "@/lib/toolExecutor";
import { buildSystemPrompt } from "@/lib/systemPromptBuilder";
import { renderMarkdown } from "@/lib/markdown";
import {
  listSessions,
  createSession,
  updateSession,
  deleteSession,
} from "@/lib/aiSessionDb";
import type { AiMessage, AiSession, Settings } from "@/types";
import { cn } from "@/lib/utils";
import { getActiveAiConfig } from "@/lib/aiConfig";
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
  Terminal,
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
  addMemoryEntries,
} from "@/lib/aiUserDb";

type ToolCallState = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  thinking?: string;
};

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
  const aiConfig = getActiveAiConfig(settings);

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
  /** OpenAI 流式 tool call 后续分片通常只有 index，没有 id。 */
  const pendingToolCallIndexRef = useRef<Map<number, string>>(new Map());
  /** 当前流式 assistant 的 reasoning_content，用于 tool call 历史回传 */
  const streamThinkingRef = useRef("");
  /** 始终持有最新 messages 的 ref，避免闭包陈旧 */
  const messagesRef = useRef<AiMessage[]>([]);
  /** 保存本轮对话的书签快照，continueChat 不重新拉取 */
  const bookmarkCtxRef = useRef<string>("");
  /** 当前会话的系统提示词（新建时构建，后续复用） */
  const systemPromptRef = useRef<string>("");
  /** tool-confirm 状态：当前等待用户确认的 tool call */
  const [confirmToolCalls, setConfirmToolCalls] = useState<ToolCallState[]>([]);
  /** 当前会话内已允许免确认的高风险工具名 */
  const autoConfirmToolNamesRef = useRef<Set<string>>(new Set());
  /** 工具调用重试计数器，防止无限循环 */
  const toolCallRetryCountRef = useRef(0);
  /** 最大工具调用重试次数 */
  const MAX_TOOL_CALL_RETRIES = 3;

  /* ── 画像/记忆/系统提示词面板状态 ── */
  const [activePanel, setActivePanel] = useState<"profile" | "memory" | "sys" | null>(null);
  const [profileText, setProfileText] = useState("");
  const [memoryEntries, setMemoryEntries] = useState<string[]>([]);
  const [memoryInput, setMemoryInput] = useState("");
  const [sysPromptText, setSysPromptText] = useState("");

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
      autoConfirmToolNamesRef.current.clear();
      setActivePanel(null);
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
    autoConfirmToolNamesRef.current.clear();
    setActivePanel(null);
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
          autoConfirmToolNamesRef.current.clear();
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
    aiConfig.provider === "none"
      ? t("ai.disabled")
      : `${aiConfig.provider} · ${aiConfig.model}`;

  /** 构造 onToolCall 回调，累积流式 tool call 参数 */
  const makeOnToolCall = () => (call: import("@/lib/ai").ToolCallDelta) => {
    if (call.done && !call.id) {
      for (const tc of pendingToolCallsRef.current.values()) tc._done = true;
      return;
    }

    let key = call.id;
    if (call.index != null) {
      const indexKey = pendingToolCallIndexRef.current.get(call.index);
      if (call.id) {
        if (indexKey && indexKey !== call.id) {
          const indexedCall = pendingToolCallsRef.current.get(indexKey);
          if (indexedCall) {
            pendingToolCallsRef.current.delete(indexKey);
            pendingToolCallsRef.current.set(call.id, { ...indexedCall, id: call.id });
          }
        }
        pendingToolCallIndexRef.current.set(call.index, call.id);
      } else {
        key = indexKey ?? `index:${call.index}`;
        pendingToolCallIndexRef.current.set(call.index, key);
      }
    }

    if (!key) return;

    const existing = pendingToolCallsRef.current.get(key) ?? { id: key, name: "", argsStr: "", _done: false };
    if (call.name) existing.name = call.name;
    if (call.arguments) existing.argsStr += call.arguments;
    if (call.done) existing._done = true;
    pendingToolCallsRef.current.set(key, existing);
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
      await handleToolCallDone(parsed, streamThinkingRef.current);
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
  const startPersistTimer = (check: () => unknown) => {
    if (persistTimerRef.current) clearInterval(persistTimerRef.current);
    persistTimerRef.current = setInterval(() => {
      if (check()) {
        setMessages((prev) => { persist(prev); return prev; });
      }
    }, 2000);
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text) return;
    setConfirmToolCalls([]);
    if (aiConfig.provider === "none" || !aiConfig.apiKey) {
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
      systemContent = systemPromptRef.current;
    } else {
      const { systemContent: built, bookmarkCtx } = await buildSystemPrompt({
        settings,
        cachedBookmarkCtx: bookmarkCtxRef.current || null,
      });
      bookmarkCtxRef.current = bookmarkCtx;
      systemContent = built;
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
      streamThinkingRef.current = "";
      pendingToolCallsRef.current.clear();
      pendingToolCallIndexRef.current.clear();
      toolCallRetryCountRef.current = 0;
      startPersistTimer(() => messagesRef.current);

      const result = await runChatStream({
        settings,
        messages: forApi,
        signal: ctrl.signal,
        callbacks: {
          onThinking: (delta) => {
            streamThinkingRef.current += delta;
            setMessages((prev) => {
              const copy = [...prev];
              for (let i = copy.length - 1; i >= 0; i--) {
                if (copy[i].role === "assistant") {
                  copy[i] = { ...copy[i], thinking: streamThinkingRef.current };
                  break;
                }
              }
              return copy;
            });
            scrollToBottom();
          },
          onDelta: (d) => {
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { ...last, content: (last.content || "") + d };
              return copy;
            });
            scrollToBottom();
          },
          onToolCall: makeOnToolCall(),
        },
      });
      if (await checkToolCallsFromStream()) return;
      if (!result.text) {
        handleStreamError(new Error("AI 响应中断，请重试"));
        return;
      }
      setMessages((prev) => { persist(prev); return prev; });
    } catch (err: any) {
      handleStreamError(err);
    } finally {
      cleanupStreaming();
    }
  };

  /** 处理 tool call 完成后的执行逻辑 */
  const handleToolCallDone = async (
    toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
    assistantThinking = "",
  ) => {
    setLoading(false);
    if (persistTimerRef.current) {
      clearInterval(persistTimerRef.current);
      persistTimerRef.current = null;
    }

    // 拦截记忆管理工具：直接在面板执行，不经过 background
    const MEMORY_TOOLS = new Set(["save_memory", "list_memory", "delete_memory", "update_memory"]);
    const memoryCalls = toolCalls.filter((tc) => MEMORY_TOOLS.has(tc.name));
    const otherCalls = toolCalls.filter((tc) => !MEMORY_TOOLS.has(tc.name));
    const memoryConversationAdditions: AiMessage[] = [];

    for (const tc of memoryCalls) {
      const result = await executeMemoryTool(tc.name, tc.args);
      const assistantMsg: AiMessage = {
        role: "assistant",
        content: "",
        toolCalls: [tc],
        ...(assistantThinking ? { thinking: assistantThinking } : {}),
      };
      const toolResult: AiMessage = {
        role: "tool",
        content: JSON.stringify(result),
        toolResult: { toolCallId: tc.id, ...result },
      };
      memoryConversationAdditions.push(assistantMsg, toolResult);
      setMessages((prev) => [...prev, assistantMsg, toolResult]);
      setMessages((prev) => { persist(prev); return prev; });
    }

    if (otherCalls.length === 0) {
      // 全是记忆工具，继续对话时必须带上对应的 assistant/tool 消息对
      await continueChat(
        [...messagesRef.current, ...memoryConversationAdditions],
        bookmarkCtxRef.current,
      );
      return;
    }

    const confirmCalls = otherCalls.filter((tc) => CONFIRM_REQUIRED_TOOLS.has(tc.name));
    const directCalls = otherCalls.filter((tc) => !CONFIRM_REQUIRED_TOOLS.has(tc.name));
    if (confirmCalls.length > 0) {
      const needsConfirm = confirmCalls.filter((tc) => !autoConfirmToolNamesRef.current.has(tc.name));
      if (needsConfirm.length === 0) {
        await executeToolCalls([...directCalls, ...confirmCalls], assistantThinking);
        return;
      }

      const validConfirmCalls: ToolCallState[] = [];
      const summaries: string[] = [];

      for (const tc of confirmCalls) {
        const validation = validateConfirmToolCall(tc);
        if (!validation.ok) {
          const result: BookmarkToolResult = {
            success: false,
            message: `缺少有效参数：${validation.missing.join("、")}。请先查询真实书签或文件夹 ID 后重试。`,
          };
          const assistantMsg: AiMessage = {
            role: "assistant",
            content: "",
            toolCalls: [tc],
            ...(assistantThinking ? { thinking: assistantThinking } : {}),
          };
          const toolResult: AiMessage = {
            role: "tool",
            content: JSON.stringify(result),
            toolResult: { toolCallId: tc.id, ...result },
          };
          const noticeMsg: AiMessage = {
            role: "assistant",
            content: result.message,
            at: Date.now(),
          };
          setMessages((prev) => {
            const next = [...prev, assistantMsg, toolResult, noticeMsg];
            persist(next);
            return next;
          });
          return;
        }

        const validCall = validation.call;
        // 查询书签和文件夹的实际名称
        const bookmarkId = normalizeToolId(validCall.args.bookmarkId);
        const targetFolderId = normalizeToolId(validCall.args.targetFolderId);
        const [bookmarkName, folderName] = await Promise.all([
          bookmarkId ? lookupBookmarkName(bookmarkId) : Promise.resolve(""),
          targetFolderId ? lookupBookmarkName(targetFolderId) : Promise.resolve(""),
        ]);
        validConfirmCalls.push({
          ...validCall,
          ...(assistantThinking ? { thinking: assistantThinking } : {}),
        });
        summaries.push(buildToolConfirmSummary(validCall.name, validCall.args, bookmarkName, folderName));
      }

      const confirmMsg: AiMessage = {
        role: "tool-confirm",
        content: buildBatchToolConfirmSummary(summaries),
        at: Date.now(),
      };
      setMessages((prev) => [...prev, confirmMsg]);
      setConfirmToolCalls(validConfirmCalls);
      scrollToBottom();
      return;
    }

    await executeToolCalls(directCalls, assistantThinking);
  };

  /** 执行工具并继续对话 */
  const executeToolCalls = async (
    toolCalls: ToolCallState[],
    assistantThinking = "",
  ) => {
    // 检查重试次数，防止无限循环
    if (toolCallRetryCountRef.current >= MAX_TOOL_CALL_RETRIES) {
      toolCallRetryCountRef.current = 0;
      const errorMsg: AiMessage = {
        role: "assistant",
        content: "⚠️ 工具调用多次失败，已自动停止。请检查工具配置或稍后重试。",
        at: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setMessages((prev) => { persist(prev); return prev; });
      setLoading(false);
      return;
    }
    toolCallRetryCountRef.current++;

    const assistantMsg: AiMessage = {
      role: "assistant",
      content: "",
      toolCalls,
      ...(assistantThinking ? { thinking: assistantThinking } : {}),
    };

    setMessages((prev) => [...prev, assistantMsg]);

    const toolResults: AiMessage[] = [];
    for (const tc of toolCalls) {
      const resp = await executeBackgroundTool(tc.name, tc.args);
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
  const confirmAndExecute = async (skipSameKind = false) => {
    if (!confirmToolCalls.length) return;
    const toolCalls = confirmToolCalls;
    const assistantThinking = toolCalls.find((tc) => tc.thinking)?.thinking ?? "";
    if (skipSameKind) {
      for (const tc of toolCalls) autoConfirmToolNamesRef.current.add(tc.name);
    }
    setConfirmToolCalls([]);
    // 将 tool-confirm 消息替换为"执行中"提示
    setMessages((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "tool-confirm") {
          const copy = [...prev];
          copy[i] = {
            role: "assistant",
            content: toolCalls.length > 1 ? `正在执行 ${toolCalls.length} 个操作…` : "正在执行操作…",
            at: Date.now(),
          };
          return copy;
        }
      }
      return prev;
    });
    await executeToolCalls(toolCalls, assistantThinking);
  };

  /** 用户取消操作 */
  const cancelToolCall = () => {
    if (!confirmToolCalls.length) return;
    const toolCalls = confirmToolCalls;
    const assistantThinking = toolCalls.find((tc) => tc.thinking)?.thinking ?? "";
    setConfirmToolCalls([]);
    // 将 tool-confirm 消息替换为"已取消"
    setMessages((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "tool-confirm") {
          const copy = [...prev];
          copy[i] = {
            role: "assistant",
            content: toolCalls.length > 1 ? `已取消 ${toolCalls.length} 个操作。` : "已取消操作。",
            at: Date.now(),
          };
          return copy;
        }
      }
      return prev;
    });

    const assistantMsg: AiMessage = {
      role: "assistant",
      content: "",
      toolCalls,
      ...(assistantThinking ? { thinking: assistantThinking } : {}),
    };
    const cancelMsgs: AiMessage[] = toolCalls.map((tc) => ({
      role: "tool",
      content: JSON.stringify({ success: false, message: "用户取消了操作" }),
      toolResult: { toolCallId: tc.id, success: false, message: "用户取消了操作" },
    }));
    setMessages((prev) => [...prev, assistantMsg, ...cancelMsgs]);
    setMessages((prev) => { persist(prev); return prev; });
    continueChat([...messagesRef.current, assistantMsg, ...cancelMsgs], bookmarkCtxRef.current);
  };

  /* ── 画像/记忆/系统提示词面板 ── */
  const togglePanel = async (panel: "profile" | "memory" | "sys") => {
    if (activePanel === panel) {
      setActivePanel(null);
      return;
    }
    setActivePanel(panel);
    if (panel === "profile") {
      const entries = await getProfile();
      setProfileText(entries.join("\n"));
    } else if (panel === "memory") {
      const entries = await getMemory();
      setMemoryEntries(entries);
    } else if (panel === "sys") {
      // 从 systemPromptRef 或当前会话中读取系统提示词
      const prompt = systemPromptRef.current || "";
      setSysPromptText(prompt);
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

    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const now = Date.now();
    setMessages((prev) => [...prev, { role: "assistant", content: "", at: now }]);

    try {
      streamingRef.current = true;
      streamThinkingRef.current = "";
      pendingToolCallsRef.current.clear();
      pendingToolCallIndexRef.current.clear();
      startPersistTimer(() => messagesRef.current);

      const result = await runChatStream({
        settings,
        messages: forApi,
        signal: ctrl.signal,
        callbacks: {
          onThinking: (delta) => {
            streamThinkingRef.current += delta;
            setMessages((prev) => {
              const copy = [...prev];
              for (let i = copy.length - 1; i >= 0; i--) {
                if (copy[i].role === "assistant") {
                  copy[i] = { ...copy[i], thinking: streamThinkingRef.current };
                  break;
                }
              }
              return copy;
            });
            scrollToBottom();
          },
          onDelta: (d) => {
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { ...last, content: (last.content || "") + d };
              return copy;
            });
            scrollToBottom();
          },
          onToolCall: makeOnToolCall(),
        },
      });

      if (await checkToolCallsFromStream()) return;
      if (!result.text) {
        handleStreamError(new Error("AI 响应中断，请重试"));
        return;
      }
      // 对话正常返回文本，重置重试计数器
      toolCallRetryCountRef.current = 0;
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

  function buildBatchToolConfirmSummary(summaries: string[]): string {
    if (summaries.length === 1) return summaries[0];
    return `将执行 ${summaries.length} 个操作：\n${summaries.map((summary, index) => `${index + 1}. ${summary}`).join("\n")}`;
  }

  const stop = () => abortRef.current?.abort();
  const isAiLive = aiConfig.provider !== "none";

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
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="mb-3 flex shrink-0 items-center justify-between gap-3 px-4 pt-3">
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
            <button
              type="button"
              onClick={() => togglePanel("sys")}
              className={cn(
                "rounded p-1 transition hover:bg-muted",
                activePanel === "sys" && "bg-muted",
              )}
              title="系统提示词"
            >
              <Terminal className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-3 overflow-hidden px-4 pb-3">
          {/* ── 画像/记忆/系统提示词编辑面板 ── */}
          {activePanel && (
            <div className="shrink-0 rounded-lg border p-4" style={{ borderColor: "hsl(var(--claude-rule))" }}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">
                  {activePanel === "profile" ? t("ai.profile") : activePanel === "memory" ? t("ai.memory") : "系统提示词"}
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
              ) : activePanel === "memory" ? (
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
              ) : (
                <div>
                  {sysPromptText ? (
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed" style={{ borderColor: "hsl(var(--claude-rule))", fontFamily: "monospace" }}>
                      {sysPromptText}
                    </pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">暂无系统提示词（首次发消息后生成）</p>
                  )}
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
                    <div className="mb-3 whitespace-pre-line text-sm text-foreground/60">
                      {m.content}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => confirmAndExecute()}>
                        {t("ai.toolConfirm")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => confirmAndExecute(true)}>
                        执行并不再确认同类
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
                    {!isUser && aiConfig.provider !== "none" && (
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
                    {!isUser && aiConfig.showThinking && m.thinking && (
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
                            {m.thinking ? "正在生成回复…" : "…"}
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
