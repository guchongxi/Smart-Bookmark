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

    const bookmarkLines = all
      .map((b) => `  - ${b.title} | ${b.url} | ${b.path}`)
      .join("\n");

    return [
      `本机 Chrome 书签统计：共 ${all.length} 条书签。`,
      folders.length
        ? `按文件夹条数：\n${folderLines}`
        : "无文件夹级统计。",
      all.length
        ? `全部书签名与 URL：\n${bookmarkLines}`
        : "当前没有可列出的书签。",
    ].join("\n");
  });
}
