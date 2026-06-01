import { allFolders, flatten, getTree } from "@/lib/bookmarks";
import {
  getCachedSummary,
  setCachedSummary,
} from "@/lib/bookmarkSummaryCache";

/**
 * 供 AI 调用的本机书签摘要（全量）。
 * 优先从 IndexedDB 缓存读取，miss 时重新生成。
 */
export async function getBookmarkContextForAi(): Promise<string> {
  const cached = await getCachedSummary();
  if (cached) return cached;

  const summary = await generateFullSummary();
  await setCachedSummary(summary);
  return summary;
}

function generateFullSummary(): Promise<string> {
  return getTree().then((tree) => {
    const all = flatten(tree);
    const folders = allFolders(tree)
      .filter((f) => f.count > 0)
      .sort((a, b) => b.count - a.count);

    const folderLines = folders
      .map((f) => `  - ${f.path}：${f.count} 条`)
      .join("\n");

    // 统计域名分布 Top 10
    const domainCount = new Map<string, number>();
    for (const b of all) {
      if (!b.url) continue;
      try {
        const domain = new URL(b.url).hostname;
        domainCount.set(domain, (domainCount.get(domain) ?? 0) + 1);
      } catch {}
    }
    const topDomains = [...domainCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([d, c]) => `  - ${d}：${c} 条`)
      .join("\n");

    return [
      `本机 Chrome 书签统计：共 ${all.length} 条书签，${folders.length} 个文件夹。`,
      folders.length
        ? `按文件夹条数：\n${folderLines}`
        : "无文件夹级统计。",
      topDomains
        ? `域名分布 Top 10：\n${topDomains}`
        : "",
    ].filter(Boolean).join("\n");
  });
}
