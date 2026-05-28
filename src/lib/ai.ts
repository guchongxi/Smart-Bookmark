import type { AiMessage, Settings } from "@/types";
import { sanitizeToolMessageHistory } from "@/lib/aiMessageHistory";

function toApiMessages(
  messages: AiMessage[],
  options: { stripAssistantWithoutThinking?: boolean } = {},
) {
  const result: unknown[] = [];
  const sanitizedMessages = sanitizeToolMessageHistory(messages);
  const skippedToolCallIds = new Set<string>();
  for (const m of sanitizedMessages) {
    if (m.role === "tool") {
      const toolCallId = m.toolResult?.toolCallId ?? "";
      if (skippedToolCallIds.has(toolCallId)) continue;
      result.push({
        role: "tool",
        tool_call_id: toolCallId,
        content: m.content,
      });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      if (options.stripAssistantWithoutThinking && !m.thinking) {
        for (const toolCall of m.toolCalls) skippedToolCallIds.add(toolCall.id);
        continue;
      }
      const assistantMessage: Record<string, unknown> = {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        })),
      };
      if (m.thinking) assistantMessage.reasoning_content = m.thinking;
      result.push(assistantMessage);
    } else if (m.role !== "system" && m.role !== "tool-confirm") {
      if (options.stripAssistantWithoutThinking && m.role === "assistant" && !m.thinking) {
        continue;
      }
      const apiMessage: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.role === "assistant" && m.thinking) {
        apiMessage.reasoning_content = m.thinking;
      }
      result.push(apiMessage);
    }
  }
  return result;
}

export interface ToolCallDelta {
  id: string;
  index?: number;
  name?: string;
  arguments?: string;
  done?: boolean;
}

export interface ChatOptions {
  settings: Settings;
  messages: AiMessage[];
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onToolCall?: (call: ToolCallDelta) => void;
  onThinking?: (delta: string) => void;
  tools?: unknown[];
}

export async function chat({ settings, messages, signal, onDelta, onToolCall, onThinking, tools }: ChatOptions): Promise<string> {
  if (settings.aiProvider === "openai") return chatOpenAI({ settings, messages, signal, onDelta, onToolCall, onThinking, tools });
  if (settings.aiProvider === "anthropic") return chatAnthropic({ settings, messages, signal, onDelta, onToolCall, onThinking, tools });
  throw new Error("AI 未启用，请在设置中配置 Provider 与 API Key。");
}

async function chatOpenAI({ settings, messages, signal, onDelta, onToolCall, onThinking, tools }: ChatOptions): Promise<string> {
  if (!settings.aiApiKey) throw new Error("缺少 OpenAI API Key");
  const base = (settings.aiBaseUrl || "https://api.openai.com/v1").replace(
    /\/+$/,
    "",
  );
  const request = (apiMessages: unknown[]) => {
    const body: Record<string, unknown> = {
      model: settings.aiModel || "gpt-4o-mini",
      messages: apiMessages,
      stream: true,
    };
    if (tools?.length) body.tools = tools;

    return fetch(`${base}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.aiApiKey}`,
      },
      body: JSON.stringify(body),
    });
  };

  let res = await request(toApiMessages(messages));
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    if (text.includes("reasoning_content")) {
      res = await request(toApiMessages(messages, { stripAssistantWithoutThinking: true }));
      if (res.ok && res.body) {
        return await readOpenAiStream(res.body, onDelta, onToolCall, onThinking);
      }
    }
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
  }
  return await readOpenAiStream(res.body, onDelta, onToolCall, onThinking);
}

async function readOpenAiStream(
  body: ReadableStream<Uint8Array>,
  onDelta?: (delta: string) => void,
  onToolCall?: (call: ToolCallDelta) => void,
  onThinking?: (delta: string) => void,
): Promise<string> {
  const { text } = await readSse(body, (evt) => {
    try {
      const j = JSON.parse(evt);
      const choice = j.choices?.[0];
      if (!choice) return "";
      const delta = choice.delta;

      const text = delta?.content ?? "";
      if (text) onDelta?.(text);

      // 处理 reasoning content（o1/o3 系列）
      const reasoning = delta?.reasoning_content;
      if (reasoning && onThinking) {
        onThinking(reasoning);
      }

      if (delta?.tool_calls && onToolCall) {
        for (const tc of delta.tool_calls) {
          onToolCall({
            id: tc.id ?? "",
            index: typeof tc.index === "number" ? tc.index : undefined,
            name: tc.function?.name,
            arguments: tc.function?.arguments,
          });
        }
      }

      // finish_reason 到达时标记所有 tool call 完成
      if (choice.finish_reason && onToolCall) {
        onToolCall({ id: "", done: true });
      }

      return text;
    } catch {
      return "";
    }
  });
  return text;
}

async function chatAnthropic({ settings, messages, signal, onDelta, onToolCall, onThinking, tools }: ChatOptions): Promise<string> {
  if (!settings.aiApiKey) throw new Error("缺少 Anthropic API Key");
  const sys = messages.find((m) => m.role === "system")?.content ?? "";
  const rest = messages.filter((m) => m.role !== "system");
  const base = (settings.aiBaseUrl || "https://api.anthropic.com").replace(
    /\/+$/,
    "",
  );

  // 转换 tool 结果为 Anthropic content 格式
  const apiMessages: unknown[] = [];
  for (const m of rest) {
    if (m.role === "tool") {
      apiMessages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: m.toolResult?.toolCallId ?? "",
          content: m.content,
        }],
      });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      const content: unknown[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.args,
        });
      }
      apiMessages.push({ role: "assistant", content });
    } else if (m.role !== "tool-confirm") {
      apiMessages.push({ role: m.role, content: m.content });
    }
  }

  const body: Record<string, unknown> = {
    model: settings.aiModel || "claude-3-5-sonnet-latest",
    max_tokens: 1024,
    system: sys || undefined,
    messages: apiMessages,
    stream: true,
  };
  if (tools?.length) body.tools = tools;

  if (settings.showThinking) {
    body.thinking = { type: "enabled", budget_tokens: 10000 };
  }

  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.aiApiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }

  const toolCallBuffers = new Map<string, { id: string; name: string; inputJson: string; _done?: boolean }>();

  const { text } = await readSse(res.body, (evt) => {
    try {
      const j = JSON.parse(evt);

      if (j.type === "content_block_start" && j.content_block?.type === "tool_use") {
        const id = j.content_block.id;
        toolCallBuffers.set(id, { id, name: j.content_block.name, inputJson: "" });
      }

      if (j.type === "content_block_delta" && j.delta?.type === "input_json_delta" && onToolCall) {
        const lastKey = [...toolCallBuffers.keys()].pop();
        if (lastKey) {
          const buf = toolCallBuffers.get(lastKey)!;
          buf.inputJson += j.delta.partial_json;
          onToolCall({ id: buf.id, name: buf.name, arguments: j.delta.partial_json });
        }
      }

      if (j.type === "content_block_stop" && onToolCall) {
        for (const [, buf] of toolCallBuffers) {
          if (buf.inputJson && !buf._done) {
            buf._done = true;
            onToolCall({ id: buf.id, done: true });
          }
        }
      }

      if (j.type === "message_delta" && j.delta?.stop_reason === "tool_use" && onToolCall) {
        for (const [, buf] of toolCallBuffers) {
          if (!buf._done) {
            buf._done = true;
            onToolCall({ id: buf.id, done: true });
          }
        }
        toolCallBuffers.clear();
      }

      // 处理 thinking 内容
      if (j.type === "content_block_delta" && j.delta?.type === "thinking_delta" && j.delta?.thinking) {
        onThinking?.(j.delta.thinking);
      }

      if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && j.delta?.text) {
        onDelta?.(j.delta.text);
        return j.delta.text;
      }
    } catch {}
    return "";
  });
  return text;
}

export async function testAi(settings: Settings): Promise<{
  ok: boolean;
  latencyMs: number;
  message: string;
}> {
  const start = performance.now();
  try {
    if (settings.aiProvider === "openai") {
      if (!settings.aiApiKey) throw new Error("缺少 API Key");
      const base = (settings.aiBaseUrl || "https://api.openai.com/v1").replace(
        /\/+$/,
        "",
      );
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.aiApiKey}`,
        },
        body: JSON.stringify({
          model: settings.aiModel || "gpt-4o-mini",
          max_tokens: 8,
          messages: [
            { role: "user", content: "ping" },
          ],
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${text.slice(0, 160)}`);
      }
      const raw = await res.text();
      const j = parseOpenAiJsonBody(raw) as {
        choices?: Array<{
          message?: { content?: string };
          text?: string;
        }>;
      };
      const ms = Math.round(performance.now() - start);
      const txt =
        j.choices?.[0]?.message?.content ??
        j.choices?.[0]?.text ??
        "(空响应)";
      return { ok: true, latencyMs: ms, message: String(txt).slice(0, 80) };
    }
    if (settings.aiProvider === "anthropic") {
      if (!settings.aiApiKey) throw new Error("缺少 API Key");
      const base = (settings.aiBaseUrl || "https://api.anthropic.com").replace(
        /\/+$/,
        "",
      );
      const res = await fetch(`${base}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": settings.aiApiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: settings.aiModel || "claude-3-5-sonnet-latest",
          max_tokens: 8,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${text.slice(0, 160)}`);
      }
      const raw = await res.text();
      const j = parseOpenAiJsonBody(raw) as {
        content?: Array<{ text?: string }>;
      };
      const ms = Math.round(performance.now() - start);
      const txt = j.content?.[0]?.text ?? "(空响应)";
      return { ok: true, latencyMs: ms, message: String(txt).slice(0, 80) };
    }
    throw new Error("请先选择 Provider");
  } catch (err: any) {
    const ms = Math.round(performance.now() - start);
    return {
      ok: false,
      latencyMs: ms,
      message: err?.message ?? String(err),
    };
  }
}

/** 测试连接/解析响应：避免把站点首页的 HTML 误当 JSON。 */
function parseOpenAiJsonBody(raw: string): unknown {
  const t = raw.trim();
  if (!t) throw new Error("空响应体");
  if (t.startsWith("<") || t.toLowerCase().startsWith("<!doctype")) {
    throw new Error(
      "返回了 HTML 而非 API JSON。请把 Base URL 设为 OpenAI 兼容接口根路径，通常以 /v1 结尾（如 https://api.openai.com/v1 或你的网关 https://…/v1），不要填官网首页。",
    );
  }
  try {
    return JSON.parse(t) as unknown;
  } catch {
    throw new Error(
      `响应不是合法 JSON: ${t.slice(0, 100)}${t.length > 100 ? "…" : ""}`,
    );
  }
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (data: string) => string,
): Promise<{ text: string; completed: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        const m = line.match(/^data:\s*(.*)$/);
        if (!m) continue;
        const data = m[1];
        if (data === "[DONE]") return { text: full, completed: true };
        full += onEvent(data);
        // 检测 Anthropic message_stop 事件
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "message_stop") return { text: full, completed: true };
        } catch {}
      }
    }
  }
  return { text: full, completed: false };
}
