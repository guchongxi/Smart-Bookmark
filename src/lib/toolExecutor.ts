/**
 * 工具执行路由：memory 工具直接执行、bookmark/web 工具委托 background。
 * 从 AiPanel 提取，消除组件内的业务逻辑泄漏。
 */

import {
  getProfile,
  setProfile,
  getMemory,
  setMemory,
  addProfileEntries,
  addMemoryEntries,
} from "@/lib/aiUserDb";
import type { BookmarkToolResult } from "@/lib/aiTools";

const MEMORY_TOOLS = new Set(["save_memory", "list_memory", "delete_memory", "update_memory"]);

/** 判断工具是否需要经过 background 执行 */
export function isBackgroundTool(toolName: string): boolean {
  return !MEMORY_TOOLS.has(toolName);
}

/** 判断工具是否需要用户确认 */
export function isConfirmRequired(toolName: string): boolean {
  return toolName === "delete_bookmark" || toolName === "move_bookmark";
}

/** 规范化 ID 参数，过滤无效值 */
export function normalizeToolId(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const id = String(value).trim();
  const invalidIds = new Set(["", "undefined", "null", "nan"]);
  return invalidIds.has(id.toLowerCase()) ? "" : id;
}

/** 验证确认工具的参数合法性 */
export function validateConfirmToolCall(
  tc: { id: string; name: string; args: Record<string, unknown> },
): { ok: true; call: { id: string; name: string; args: Record<string, unknown> } } | { ok: false; missing: string[] } {
  const bookmarkId = normalizeToolId(tc.args.bookmarkId);
  const missing: string[] = [];
  const args = { ...tc.args };

  if (!bookmarkId) missing.push("bookmarkId");
  else args.bookmarkId = bookmarkId;

  if (tc.name === "move_bookmark") {
    const targetFolderId = normalizeToolId(tc.args.targetFolderId);
    if (!targetFolderId) missing.push("targetFolderId");
    else args.targetFolderId = targetFolderId;
  }

  if (missing.length) return { ok: false, missing };
  return { ok: true, call: { ...tc, args } };
}

/** 在 content script 中执行 memory 工具 */
export async function executeMemoryTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<BookmarkToolResult> {
  switch (toolName) {
    case "save_memory": {
      const type = args.type as string;
      const entries = (args.entries as string[]) ?? [];
      if (type === "profile") await addProfileEntries(entries);
      else if (type === "memory") await addMemoryEntries(entries);
      else return { success: false, message: `未知类型: ${type}` };
      return { success: true, message: `已保存 ${entries.length} 条${type === "profile" ? "画像" : "记忆"}信息` };
    }
    case "list_memory": {
      const [profile, memory] = await Promise.all([getProfile(), getMemory()]);
      return { success: true, message: JSON.stringify({ profile, memory }), data: { profile, memory } };
    }
    case "delete_memory": {
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
      } else return { success: false, message: `未知类型: ${type}` };
      return { success: true, message: `已删除 ${type === "profile" ? "画像" : "记忆"}条目` };
    }
    case "update_memory": {
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
      } else return { success: false, message: `未知类型: ${type}` };
      return { success: true, message: `已修改${type === "profile" ? "画像" : "记忆"}条目` };
    }
    default:
      return { success: false, message: `未知工具: ${toolName}` };
  }
}

/** 通过 background 执行 bookmark 或 web 工具 */
export async function executeBackgroundTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; result?: BookmarkToolResult; error?: string }> {
  const type = (toolName === "web_reader" || toolName === "web_search")
    ? "execute-mcp-tool"
    : "execute-bookmark-tool";

  return new Promise((resolve) => {
    let settled = false;

    // 超时保护：防止 service worker 休眠导致 Promise 永远 pending
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: "工具执行超时（10 秒），Service Worker 可能已休眠" });
      }
    }, 10_000);

    try {
      chrome.runtime.sendMessage({ type, tool: toolName, args }, (resp) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;

        // 检查 chrome.runtime.lastError
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message ?? "通信失败" });
          return;
        }

        // 如果 resp 为 undefined（service worker 未响应）
        if (!resp) {
          resolve({ ok: false, error: "Service Worker 未响应，可能已休眠" });
          return;
        }

        resolve(resp);
      });
    } catch (err) {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: (err as Error).message ?? "发送消息失败" });
      }
    }
  });
}

/** 通过 background 查询书签/文件夹名称 */
export async function lookupBookmarkName(id: string): Promise<string> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "lookup-bookmark-name", id }, (resp) => resolve(resp?.name ?? id));
  });
}
