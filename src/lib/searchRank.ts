interface RankableItem {
  title: string;
  url: string;
}

/**
 * 模糊匹配 + 分数排序。
 * 支持 title/host/url/path 多维度匹配，
 * 含精确匹配加分、前缀匹配加分、子串位置加分、fuzzy span 密度加分。
 */
export function searchRank<T extends RankableItem>(
  items: T[],
  query: string,
  limit = 10,
): T[] {
  if (!query.trim()) return items.slice(0, limit);

  const q = query.toLowerCase().trim();
  const qChars = q.split("");

  const scored: Array<{ item: T; score: number }> = [];

  for (const item of items) {
    const title = item.title.toLowerCase();
    const url = item.url.toLowerCase();
    let host = "";
    let path = "";
    try {
      const u = new URL(item.url);
      host = u.hostname.replace(/^www\./, "");
      path = u.pathname;
    } catch {
      host = url;
    }

    let score = 0;

    // 精确匹配
    if (title === q || host === q) {
      score += 1000;
    }

    // 前缀匹配
    if (title.startsWith(q)) score += 500;
    if (host.startsWith(q)) score += 400;

    // 子串位置加分（越靠前分越高）
    const titleIdx = title.indexOf(q);
    if (titleIdx >= 0) score += 300 - titleIdx * 2;
    const hostIdx = host.indexOf(q);
    if (hostIdx >= 0) score += 200 - hostIdx * 2;
    const urlIdx = url.indexOf(q);
    if (urlIdx >= 0) score += 100 - urlIdx;

    // fuzzy span 密度
    if (score === 0) {
      let lastIdx = -1;
      let spanLen = 0;
      let matched = 0;
      for (const ch of qChars) {
        const idx = title.indexOf(ch, lastIdx + 1);
        if (idx === -1) break;
        if (lastIdx >= 0) spanLen += idx - lastIdx;
        lastIdx = idx;
        matched++;
      }
      if (matched === qChars.length) {
        score += Math.max(1, 50 - spanLen);
      }
    }

    // path 匹配
    if (path && path.includes(q)) score += 30;

    if (score > 0) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}
