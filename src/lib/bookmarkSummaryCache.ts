/**
 * 书签摘要缓存（IndexedDB）
 * 全量书签摘要，有效期 7 天，书签变更时自动失效。
 */

const DB_NAME = "smart-bookmark-summary";
const STORE_NAME = "cache";
const DB_VERSION = 1;
const CACHE_KEY = "bookmark-summary";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const INVALIDATE_KEY = "smart-bookmark::summary-invalidated";

interface CacheEntry {
  summary: string;
  timestamp: number;
}

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

export async function getCachedSummary(): Promise<string | null> {
  try {
    // 检查是否被书签变更标记为失效
    const invalidated = await isInvalidated();
    if (invalidated) {
      // 立即清除 IndexedDB 中的旧缓存
      await clearSummaryCache();
      return null;
    }

    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(CACHE_KEY);
      req.onsuccess = () => {
        const entry: CacheEntry | undefined = req.result;
        if (!entry) return resolve(null);
        if (Date.now() - entry.timestamp > TTL_MS) return resolve(null);
        resolve(entry.summary);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedSummary(summary: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(
      { summary, timestamp: Date.now() } as CacheEntry,
      CACHE_KEY,
    );
  } catch {}
}

export async function clearSummaryCache(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(CACHE_KEY);
  } catch {}
}

/**
 * 被 background 的书签变更监听器调用，标记缓存失效。
 * 下次读取时会重新生成。
 */
export async function invalidateSummary(): Promise<void> {
  try {
    await chrome?.storage?.local?.set({ [INVALIDATE_KEY]: Date.now() });
  } catch {}
}

async function isInvalidated(): Promise<boolean> {
  try {
    const { [INVALIDATE_KEY]: ts } = await chrome?.storage?.local?.get(INVALIDATE_KEY) ?? {};
    if (!ts) return false;
    // 读取后清除标记，只失效一次
    await chrome?.storage?.local?.remove(INVALIDATE_KEY);
    return true;
  } catch {
    return false;
  }
}
