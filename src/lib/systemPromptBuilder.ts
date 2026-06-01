/**
 * 系统提示词构建：SYSTEM_PROMPT + 书签摘要 + 用户画像 + MCP 能力声明。
 * 从 AiPanel 提取，支持多入口复用。
 */

import { getBookmarkContextForAi } from "@/lib/aiBookmarkContext";
import { getProfile, getMemory } from "@/lib/aiUserDb";
import { getActiveAiConfig } from "@/lib/aiConfig";
import type { Settings } from "@/types";

const SYSTEM_PROMPT = [
  "You are Smart Bookmark Agent — an AI agent that works on top of the user's local Chrome bookmarks.",
  "Your core capabilities:",
  "- Answer questions grounded in the user's bookmark stats (total count, folder distribution, top domains).",
  "- Recommend organization schemes (folders, tags, topics) and point out imbalance.",
  "- Flag potential duplicates, stale or suspicious URLs, and suggest cleanup.",
  "- When the user asks to find or operate on specific bookmarks, use the search_bookmarks tool to query real data.",
  "- Help craft search queries to find things they already saved.",
  "A summary of the user's bookmarks (total count, folder breakdown, top domains) is appended below under '---'. For specific bookmark lookups, always use the search_bookmarks tool — do not guess titles or URLs.",
  "Style: concise, use bullet points, reply in the user's language (Chinese ↔ English).",
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

export interface BuildSystemPromptOptions {
  settings: Settings;
  /** 已缓存的书签摘要，为 null 时重新获取 */
  cachedBookmarkCtx?: string | null;
}

export interface BuildSystemPromptResult {
  systemContent: string;
  bookmarkCtx: string;
}

export async function buildSystemPrompt({
  settings,
  cachedBookmarkCtx,
}: BuildSystemPromptOptions): Promise<BuildSystemPromptResult> {
  const bookmarkCtx = cachedBookmarkCtx ?? await getBookmarkContextForAi();
  const [profileEntries, memoryEntries] = await Promise.all([getProfile(), getMemory()]);
  const aiConfig = getActiveAiConfig(settings);

  // 按顺序拼装：角色定义 → 用户画像/记忆 → 扩展能力 → 书签快照（放最后，体积最大）
  let systemContent = SYSTEM_PROMPT;

  // 用户画像 + 持久记忆
  const userParts: string[] = [];
  if (profileEntries.length > 0) {
    userParts.push(`## 用户画像\n${profileEntries.map((e) => `- ${e}`).join("\n")}`);
  }
  if (memoryEntries.length > 0) {
    userParts.push(`## 持久记忆\n${memoryEntries.map((e) => `- ${e}`).join("\n")}`);
  }
  if (userParts.length > 0) {
    systemContent += "\n\n" + userParts.join("\n\n");
  }

  // 扩展能力
  const mcpCapabilities: string[] = [];
  if (aiConfig.mcpWebReader) {
    mcpCapabilities.push("- web_reader：抓取指定 URL 的网页内容，可用来阅读文章、获取页面信息");
  }
  if (aiConfig.mcpWebSearch) {
    mcpCapabilities.push("- web_search：搜索网络信息，可用来查找最新资讯、验证信息，参数为 search_query");
  }
  if (mcpCapabilities.length > 0) {
    systemContent += "\n\n## 扩展能力\n" + mcpCapabilities.join("\n");
  }

  // 书签快照放最后
  systemContent += `\n\n---\n${bookmarkCtx}`;

  return { systemContent, bookmarkCtx };
}
