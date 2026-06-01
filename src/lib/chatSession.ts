/**
 * 流式对话引擎：工具列表构建 + chat() 调用 + 流式回调。
 * 消除 AiPanel 中 send() 和 continueChat() 的重复逻辑。
 */

import { chat } from "@/lib/ai";
import type { ToolCallDelta } from "@/lib/ai";
import { BOOKMARK_TOOLS_OPENAI } from "@/lib/aiTools";
import { getActiveAiConfig } from "@/lib/aiConfig";
import type { AiMessage, Settings } from "@/types";

/** 流式回调接口，由 UI 层提供 */
export interface StreamCallbacks {
  onThinking?: (delta: string) => void;
  onDelta?: (delta: string) => void;
  onToolCall?: (call: ToolCallDelta) => void;
}

export interface RunChatStreamOptions {
  settings: Settings;
  messages: AiMessage[];
  signal?: AbortSignal;
  callbacks: StreamCallbacks;
}

export interface ChatStreamResult {
  /** 流式累积的完整文本 */
  text: string;
  /** 流式累积的 thinking 内容 */
  thinking: string;
}

/** 根据 settings 过滤 MCP 工具并转换为对应 provider 格式 */
export function buildToolList(settings: Settings): unknown[] {
  const aiConfig = getActiveAiConfig(settings);
  const baseTools = BOOKMARK_TOOLS_OPENAI.filter((t) => {
    if (t.function.name === "web_reader") return aiConfig.mcpWebReader;
    if (t.function.name === "web_search") return aiConfig.mcpWebSearch;
    return true;
  });
  if (aiConfig.provider === "openai") return baseTools;
  return baseTools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

/** 执行一次完整的流式对话，返回累积的文本和 thinking */
export async function runChatStream({
  settings,
  messages,
  signal,
  callbacks,
}: RunChatStreamOptions): Promise<ChatStreamResult> {
  const tools = buildToolList(settings);
  let acc = "";
  let thinkingAcc = "";

  await chat({
    settings,
    messages,
    signal,
    tools,
    onThinking: (delta) => {
      thinkingAcc += delta;
      callbacks.onThinking?.(delta);
    },
    onDelta: (d) => {
      acc += d;
      callbacks.onDelta?.(d);
    },
    onToolCall: callbacks.onToolCall,
  });

  return { text: acc, thinking: thinkingAcc };
}
