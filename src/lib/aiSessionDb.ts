/**
 * AI 会话持久化（IndexedDB）
 * 多会话存储，15 天未更新自动清理。
 */

import type { AiSession } from "@/types";

const DB_NAME = "smart-bookmark-ai-sessions";
const STORE_NAME = "sessions";
const DB_VERSION = 1;
const TTL_MS = 15 * 24 * 60 * 60 * 1000; // 15 天

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 获取所有会话，按更新时间倒序，同时清理过期会话 */
export async function listSessions(): Promise<AiSession[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const all: AiSession[] = await new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => resolve([]);
    });
    const now = Date.now();
    const valid: AiSession[] = [];
    for (const s of all) {
      if (now - s.updatedAt > TTL_MS) {
        store.delete(s.id);
      } else {
        valid.push(s);
      }
    }
    valid.sort((a, b) => b.updatedAt - a.updatedAt);
    return valid;
  } catch {
    return [];
  }
}

/** 获取单个会话 */
export async function getSession(id: string): Promise<AiSession | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** 创建新会话 */
export async function createSession(
  title: string,
  messages: AiSession["messages"] = [],
): Promise<AiSession> {
  const now = Date.now();
  const session: AiSession = {
    id: crypto.randomUUID(),
    title: title.slice(0, 30),
    messages,
    createdAt: now,
    updatedAt: now,
  };
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(session);
  return session;
}

/** 更新会话（消息列表 + 时间戳） */
export async function updateSession(
  id: string,
  messages: AiSession["messages"],
  title?: string,
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const existing: AiSession | undefined = await new Promise((resolve) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
  if (!existing) return;
  const updated: AiSession = {
    ...existing,
    messages,
    updatedAt: Date.now(),
    ...(title != null ? { title: title.slice(0, 30) } : {}),
  };
  store.put(updated);
}

/** 删除单个会话 */
export async function deleteSession(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
  } catch {}
}

/** 删除所有会话 */
export async function clearAllSessions(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
  } catch {}
}
