/**
 * 用户画像与持久记忆（IndexedDB）
 * 单条记录存储，画像和记忆各一个 object store。
 */

const DB_NAME = "smart-bookmark-ai-user";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("userProfile")) {
        db.createObjectStore("userProfile", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("userMemory")) {
        db.createObjectStore("userMemory", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getEntry(storeName: string, id: string): Promise<string[]> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(id);
      req.onsuccess = () => resolve(req.result?.entries ?? []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

async function setEntry(storeName: string, id: string, entries: string[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put({ id, entries, updatedAt: Date.now() });
}

// ── 画像 ──

export async function getProfile(): Promise<string[]> {
  return getEntry("userProfile", "profile");
}

export async function setProfile(entries: string[]): Promise<void> {
  return setEntry("userProfile", "profile", entries);
}

export async function addProfileEntries(newEntries: string[]): Promise<void> {
  const existing = await getProfile();
  const deduped = newEntries.filter(
    (e) => !existing.some((x) => x.includes(e) || e.includes(x)),
  );
  if (deduped.length > 0) {
    await setProfile([...existing, ...deduped]);
  }
}

// ── 记忆 ──

export async function getMemory(): Promise<string[]> {
  return getEntry("userMemory", "memory");
}

export async function setMemory(entries: string[]): Promise<void> {
  return setEntry("userMemory", "memory", entries);
}

export async function addMemoryEntries(newEntries: string[]): Promise<void> {
  const existing = await getMemory();
  const deduped = newEntries.filter(
    (e) => !existing.some((x) => x.includes(e) || e.includes(x)),
  );
  if (deduped.length > 0) {
    await setMemory([...existing, ...deduped]);
  }
}

export async function clearMemory(): Promise<void> {
  return setEntry("userMemory", "memory", []);
}
