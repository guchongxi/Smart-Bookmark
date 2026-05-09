import { useState, useEffect } from "react";
import { fetchFavicon, clearFaviconCache } from "@/lib/favicon";

/**
 * 获取书签的 favicon，优先从 IndexedDB 缓存读取，没有则异步获取并缓存。
 * refreshKey 变化时会重新获取。
 */
export function useFavicon(url: string, refreshKey = 0): string {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dataUrl = await fetchFavicon(url);
      if (!cancelled && dataUrl) {
        setSrc(dataUrl);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, refreshKey]);

  return src;
}

/**
 * 清除 favicon 缓存并触发重新获取
 */
export async function refreshFavicon(url: string): Promise<void> {
  await clearFaviconCache(url);
}
