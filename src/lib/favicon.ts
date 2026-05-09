/**
 * Favicon 缓存管理（IndexedDB）
 */

const DB_NAME = "smart-bookmark-favicon";
const STORE_NAME = "icons";
const DB_VERSION = 1;
// 标记"已尝试但无 favicon"的负缓存值
const NO_ICON = "__NO_ICON__";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedFavicon(url: string): Promise<string | null> {
  try {
    const key = extractOrigin(url);
    if (!key) return null;
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        const val = req.result;
        // 负缓存标记，返回空但不触发重新获取
        resolve(val === NO_ICON ? "" : (val ?? null));
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedFavicon(url: string, dataUrl: string): Promise<void> {
  try {
    const key = extractOrigin(url);
    if (!key) return;
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(dataUrl, key);
  } catch {}
}

async function markNoIcon(url: string): Promise<void> {
  try {
    const key = extractOrigin(url);
    if (!key) return;
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(NO_ICON, key);
  } catch {}
}

export async function fetchFavicon(url: string): Promise<string | null> {
  // 1. 查缓存（含负缓存）
  const cached = await getCachedFavicon(url);
  if (cached !== null) return cached || null;

  const origin = extractOrigin(url);
  if (!origin) return null;

  // 2. 尝试 /favicon.ico
  const icoUrl = `${origin}/favicon.ico`;
  const icoData = await fetchAsDataUrl(icoUrl);
  if (icoData) {
    await setCachedFavicon(url, icoData);
    return icoData;
  }

  // 3. 解析 HTML 获取 <link rel="icon">（完整 URL → origin 兜底）
  const htmlFavicon = await parseFaviconFromHtml(url);
  if (htmlFavicon) {
    const data = await fetchAsDataUrl(htmlFavicon);
    if (data) {
      await setCachedFavicon(url, data);
      return data;
    }
  }

  // 4. 标记无 favicon，下次不再重复请求
  await markNoIcon(url);
  return null;
}

async function fetchHtmlViaBackground(url: string): Promise<string | null> {
  const resp = await new Promise<{ ok: boolean; html: string }>((resolve) => {
    chrome.runtime.sendMessage({ type: "fetch-html", url }, resolve);
  });
  return resp?.ok && resp.html ? resp.html : null;
}

function extractIconHref(html: string): string | null {
  // 匹配 rel 属性中含 "icon" 的 <link> 标签，兼容 rel/href 顺序
  const patterns = [
    /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function resolveIconUrl(href: string, baseUrl: string): string {
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return `${baseUrl.split("//")[0]}${href}`;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    const origin = new URL(baseUrl).origin;
    return `${origin}${href.startsWith("/") ? "" : "/"}${href}`;
  }
}

async function parseFaviconFromHtml(url: string): Promise<string | null> {
  const origin = new URL(url).origin;

  // 1. 先尝试完整 URL
  const fullHtml = await fetchHtmlViaBackground(url);
  if (fullHtml) {
    const href = extractIconHref(fullHtml);
    if (href) return resolveIconUrl(href, url);
  }

  // 2. 兜底：origin
  if (url !== origin) {
    const originHtml = await fetchHtmlViaBackground(origin);
    if (originHtml) {
      const href = extractIconHref(originHtml);
      if (href) return resolveIconUrl(href, origin);
    }
  }

  return null;
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function extractOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * 清除指定网站的 favicon 缓存，下次会重新获取
 */
export async function clearFaviconCache(url: string): Promise<void> {
  try {
    const key = extractOrigin(url);
    if (!key) return;
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
  } catch {}
}

/**
 * 清除所有标记为"无图标"的负缓存，刷新页面后会重新尝试获取
 */
export async function clearAllNoIconCache(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      let count = 0;
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if (cursor.value === NO_ICON) {
            cursor.delete();
            count++;
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve(count);
      tx.onerror = () => resolve(count);
    });
  } catch {
    return 0;
  }
}
