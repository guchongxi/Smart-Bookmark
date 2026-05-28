import type { AiMessage } from "@/types";

function asPlainAssistantMessage(message: AiMessage): AiMessage | null {
  if (message.role !== "assistant" || !message.content) return null;
  const { toolCalls: _toolCalls, ...plainMessage } = message;
  return plainMessage;
}

export function sanitizeToolMessageHistory(messages: AiMessage[]): AiMessage[] {
  const result: AiMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    if (message.role === "tool" || message.role === "tool-confirm") {
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      const toolCallIds = message.toolCalls.map((toolCall) => toolCall.id).filter(Boolean);
      if (!toolCallIds.length) {
        const plainMessage = asPlainAssistantMessage(message);
        if (plainMessage) result.push(plainMessage);
        continue;
      }

      const toolResults: AiMessage[] = [];
      const seenToolCallIds = new Set<string>();
      let nextIndex = i + 1;

      while (nextIndex < messages.length) {
        const nextMessage = messages[nextIndex];
        if (nextMessage.role === "system" || nextMessage.role === "tool-confirm") {
          nextIndex++;
          continue;
        }
        if (nextMessage.role !== "tool") break;

        const toolCallId = nextMessage.toolResult?.toolCallId ?? "";
        if (!toolCallIds.includes(toolCallId) || seenToolCallIds.has(toolCallId)) break;

        toolResults.push(nextMessage);
        seenToolCallIds.add(toolCallId);
        nextIndex++;
        if (seenToolCallIds.size === toolCallIds.length) break;
      }

      if (seenToolCallIds.size !== toolCallIds.length) {
        const plainMessage = asPlainAssistantMessage(message);
        if (plainMessage) result.push(plainMessage);
        continue;
      }

      result.push(message, ...toolResults);
      i = nextIndex - 1;
      continue;
    }

    result.push(message);
  }

  return result;
}
