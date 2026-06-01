export {};

import { fetchWebPage, searchWeb } from "@/lib/webTools";
import { getSettings } from "@/lib/storage";
import type { BookmarkToolResult } from "@/lib/aiTools";

const MENU_IDS = {
  SEARCH_BOOKMARKS: "sb-search-bookmarks",
  COPY_URL: "sb-copy-url",
  COPY_LINK: "sb-copy-link",
  QR_PAGE: "sb-qr-page",
  QR_LINK: "sb-qr-link",
  OPEN_CLEANER: "sb-open-cleaner",
} as const;

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});

chrome.runtime.onStartup?.addListener(() => setupContextMenus());

// 书签变更时标记摘要缓存失效
const INVALIDATE_KEY = "smart-bookmark::summary-invalidated";
function onBookmarkChanged() {
  chrome.storage.local.set({ [INVALIDATE_KEY]: Date.now() });
}
chrome.bookmarks.onCreated.addListener(onBookmarkChanged);
chrome.bookmarks.onRemoved.addListener(onBookmarkChanged);
chrome.bookmarks.onChanged.addListener(onBookmarkChanged);
chrome.bookmarks.onMoved.addListener(onBookmarkChanged);

// AI 书签工具执行器
async function executeBookmarkTool(
  tool: string,
  args: Record<string, unknown>,
): Promise<BookmarkToolResult> {
  switch (tool) {
    case "search_bookmarks": {
      const query = String(args.query ?? "").toLowerCase();
      const folder = String(args.folder ?? "").toLowerCase();
      const limit = Number(args.limit ?? 10);
      return new Promise((resolve) => {
        chrome.bookmarks.getTree(([tree]) => {
          const results: Array<{ id: string; title: string; url: string; path: string }> = [];
          function walk(node: chrome.bookmarks.BookmarkTreeNode, prefix: string) {
            if (!node.children) return;
            for (const child of node.children) {
              const childPath = prefix ? `${prefix}/${child.title}` : child.title;
              if (child.url) {
                // 叶子节点：匹配标题、URL、路径
                const matchTitle = child.title.toLowerCase().includes(query);
                const matchUrl = child.url.toLowerCase().includes(query);
                const matchPath = childPath.toLowerCase().includes(query);
                const matchFolder = !folder || childPath.toLowerCase().includes(folder);
                if ((matchTitle || matchUrl || matchPath) && matchFolder) {
                  results.push({
                    id: child.id,
                    title: child.title || child.url,
                    url: child.url,
                    path: childPath,
                  });
                }
              } else {
                walk(child, childPath);
              }
            }
          }
          walk(tree, "");
          resolve({
            success: true,
            message: `找到 ${Math.min(results.length, limit)} 条书签`,
            data: results.slice(0, limit),
          });
        });
      });
    }
    case "list_folders": {
      return new Promise((resolve) => {
        chrome.bookmarks.getTree(([tree]) => {
          const folders = collectFolders(tree, "");
          resolve({
            success: true,
            message: `共 ${folders.length} 个文件夹`,
            data: folders,
          });
        });
      });
    }
    case "create_bookmark": {
      const title = String(args.title ?? "");
      const url = String(args.url ?? "");
      const parentId = args.folderId ? String(args.folderId) : undefined;
      if (!title || !url) return { success: false, message: "缺少 title 或 url" };
      return new Promise((resolve) => {
        const createOpts: chrome.bookmarks.BookmarkCreateArg = { title, url };
        if (parentId) createOpts.parentId = parentId;
        chrome.bookmarks.create(createOpts, (node) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, message: chrome.runtime.lastError.message ?? "创建失败" });
          } else {
            resolve({
              success: true,
              message: `已创建书签「${title}」`,
              data: { id: node.id, title: node.title, url: node.url },
            });
          }
        });
      });
    }
    case "delete_bookmark": {
      const bookmarkId = String(args.bookmarkId ?? "");
      if (!bookmarkId) return { success: false, message: "缺少 bookmarkId" };
      return new Promise((resolve) => {
        chrome.bookmarks.remove(bookmarkId, () => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, message: chrome.runtime.lastError.message ?? "删除失败" });
          } else {
            resolve({ success: true, message: "书签已删除" });
          }
        });
      });
    }
    case "move_bookmark": {
      const bookmarkId = String(args.bookmarkId ?? "");
      const targetFolderId = String(args.targetFolderId ?? "");
      if (!bookmarkId || !targetFolderId) return { success: false, message: "缺少参数" };
      return new Promise((resolve) => {
        chrome.bookmarks.move(bookmarkId, { parentId: targetFolderId }, (_node) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, message: chrome.runtime.lastError.message ?? "移动失败" });
          } else {
            resolve({ success: true, message: "书签已移动" });
          }
        });
      });
    }
    case "update_bookmark": {
      const bookmarkId = String(args.bookmarkId ?? "");
      const title = args.title != null ? String(args.title) : undefined;
      const url = args.url != null ? String(args.url) : undefined;
      if (!bookmarkId) return { success: false, message: "缺少 bookmarkId" };
      if (!title && !url) return { success: false, message: "至少提供 title 或 url" };
      return new Promise((resolve) => {
        const updateOpts: Record<string, string> = {};
        if (title) updateOpts.title = title;
        if (url) updateOpts.url = url;
        chrome.bookmarks.update(bookmarkId, updateOpts, (node) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, message: chrome.runtime.lastError.message ?? "更新失败" });
          } else {
            resolve({
              success: true,
              message: `书签已更新`,
              data: { id: node.id, title: node.title, url: node.url },
            });
          }
        });
      });
    }
    case "create_folder": {
      const title = String(args.title ?? "");
      const parentId = args.parentId ? String(args.parentId) : undefined;
      if (!title) return { success: false, message: "缺少 title" };
      return new Promise((resolve) => {
        const createOpts: chrome.bookmarks.BookmarkCreateArg = { title };
        if (parentId) createOpts.parentId = parentId;
        chrome.bookmarks.create(createOpts, (node) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, message: chrome.runtime.lastError.message ?? "创建失败" });
          } else {
            resolve({
              success: true,
              message: `文件夹已创建「${title}」`,
              data: { id: node.id, title: node.title },
            });
          }
        });
      });
    }
    default:
      return { success: false, message: `未知工具: ${tool}` };
  }
}

/** 执行 Web 工具（本地实现，不依赖远程 MCP 服务） */
async function executeMcpTool(
  tool: string,
  args: Record<string, unknown>,
): Promise<{ success: boolean; message: string; data?: unknown }> {
  const s = await getSettings();
  if (tool === "web_reader") {
    if (s.mcpWebReader === false) return { success: false, message: "Web Reader 已关闭" };
    const url = args.url as string;
    if (!url) return { success: false, message: "缺少 url 参数" };
    return await fetchWebPage(url);
  }
  if (tool === "web_search") {
    if (s.mcpWebSearch === false) return { success: false, message: "Web Search 已关闭" };
    const query = args.search_query as string;
    if (!query) return { success: false, message: "缺少 search_query 参数" };
    return await searchWeb(query);
  }
  return { success: false, message: `未知工具: ${tool}` };
}

function collectFolders(
  node: chrome.bookmarks.BookmarkTreeNode,
  parentPath: string,
): Array<{ id: string; title: string; path: string; count: number }> {
  const result: Array<{ id: string; title: string; path: string; count: number }> = [];
  if (!node.children) return result;
  for (const child of node.children) {
    if (child.children) {
      const path = parentPath ? `${parentPath}/${child.title}` : child.title;
      const isSystemFolder = child.parentId === "0";
      if (!isSystemFolder || !parentPath) {
        result.push({
          id: child.id,
          title: child.title,
          path,
          count: countBookmarks(child),
        });
        result.push(...collectFolders(child, path));
      } else {
        result.push(...collectFolders(child, path));
      }
    }
  }
  return result;
}

function countBookmarks(node: chrome.bookmarks.BookmarkTreeNode): number {
  if (!node.children) return 0;
  let count = 0;
  for (const child of node.children) {
    if (child.url) count++;
    else count += countBookmarks(child);
  }
  return count;
}

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IDS.SEARCH_BOOKMARKS,
      title: '在 Smart Bookmark 中搜索 "%s"',
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.COPY_URL,
      title: "复制当前页面地址",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.COPY_LINK,
      title: "复制链接地址",
      contexts: ["link"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.QR_PAGE,
      title: "生成当前页面二维码",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.QR_LINK,
      title: "生成链接二维码",
      contexts: ["link"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.OPEN_CLEANER,
      title: "打开书签清理中心",
      contexts: ["action"],
    });
  });
}

async function copyViaTab(tabId: number, text: string) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (t: string) => {
        const ta = document.createElement("textarea");
        ta.value = t;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
        } catch {}
        ta.remove();
        try {
          navigator.clipboard?.writeText?.(t);
        } catch {}
      },
      args: [text],
    });
  } catch (err) {
    console.warn("[smart-bookmark] copy failed", err);
  }
}

async function openQrTab(url: string) {
  const target = chrome.runtime.getURL(
    `newtab.html#tab=dashboard&qr=${encodeURIComponent(url)}`,
  );
  await chrome.tabs.create({ url: target });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case MENU_IDS.SEARCH_BOOKMARKS: {
      const q = encodeURIComponent(info.selectionText ?? "");
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`newtab.html#q=${q}`),
      });
      break;
    }
    case MENU_IDS.COPY_URL: {
      const url = tab?.url;
      if (!url || !tab?.id) return;
      await copyViaTab(tab.id, url);
      break;
    }
    case MENU_IDS.COPY_LINK: {
      const link = info.linkUrl;
      if (!link || !tab?.id) return;
      await copyViaTab(tab.id, link);
      break;
    }
    case MENU_IDS.QR_PAGE: {
      if (tab?.url) await openQrTab(tab.url);
      break;
    }
    case MENU_IDS.QR_LINK: {
      if (info.linkUrl) await openQrTab(info.linkUrl);
      break;
    }
    case MENU_IDS.OPEN_CLEANER: {
      await chrome.tabs.create({
        url: chrome.runtime.getURL("newtab.html#tab=cleaner"),
      });
      break;
    }
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-cleaner") {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("newtab.html#tab=cleaner"),
    });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "open-newtab") {
        await chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "open-cleaner") {
        await chrome.tabs.create({
          url: chrome.runtime.getURL("newtab.html#tab=cleaner"),
        });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "open-settings") {
        await chrome.tabs.create({
          url: chrome.runtime.getURL("newtab.html#tab=settings"),
        });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "open-qr" && typeof msg.url === "string") {
        await openQrTab(msg.url);
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "search-bookmarks" && typeof msg.query === "string") {
        await chrome.tabs.create({
          url: chrome.runtime.getURL(
            `newtab.html#q=${encodeURIComponent(msg.query)}`,
          ),
        });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "fetch-html" && typeof msg.url === "string") {
        try {
          const res = await fetch(msg.url, { credentials: "include" });
          const html = await res.text();
          sendResponse({ ok: true, html });
        } catch {
          sendResponse({ ok: false, html: "" });
        }
        return;
      }
      if (msg?.type === "bookmarks-search" && typeof msg.query === "string") {
        chrome.bookmarks.search(msg.query, (items) => {
          sendResponse({
            ok: true,
            items: (items || [])
              .filter((x) => !!x.url)
              .slice(0, 20)
              .map((x) => ({
                id: x.id,
                title: x.title || x.url!,
                url: x.url!,
              })),
          });
        });
        return;
      }
      // AI 工具执行入口：接收 AI 面板的书签操作请求
      if (msg?.type === "execute-bookmark-tool" && typeof msg.tool === "string") {
        try {
          const result = await executeBookmarkTool(msg.tool, msg.args ?? {});
          sendResponse({ ok: true, result });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
        return;
      }
      if (msg?.type === "lookup-bookmark-name" && typeof msg.id === "string") {
        chrome.bookmarks.get(msg.id, (nodes) => {
          if (chrome.runtime.lastError || !nodes?.length) {
            sendResponse({ ok: false, name: msg.id });
          } else {
            sendResponse({ ok: true, name: nodes[0].title || msg.id });
          }
        });
        return;
      }
      if (msg?.type === "execute-mcp-tool" && typeof msg.tool === "string") {
        try {
          const result = await executeMcpTool(msg.tool, msg.args);
          sendResponse({ ok: true, result });
        } catch (err) {
          sendResponse({ ok: false, error: (err as Error).message });
        }
        return;
      }
      sendResponse({ ok: false });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true;
});
