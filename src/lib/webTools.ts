/**
 * 本地 Web 工具实现
 * 替代 MCP 远程服务，在 service worker 中运行。
 */

interface WebToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/** 从 HTML 中提取纯文本内容 */
function extractTextFromHtml(html: string): string {
  // 尝试按优先级提取内容区域
  let content = "";

  // 1. 尝试 <article>
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    content = articleMatch[1];
  }

  // 2. 回退到 <main>
  if (!content) {
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) {
      content = mainMatch[1];
    }
  }

  // 3. 回退到 <body>
  if (!content) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      content = bodyMatch[1];
    } else {
      content = html;
    }
  }

  // 去除不需要的标签及其内容
  content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  content = content.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  content = content.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
  content = content.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
  content = content.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");

  // 去除所有 HTML 标签，保留纯文本
  content = content.replace(/<[^>]+>/g, " ");

  // 解码常见 HTML 实体
  content = content.replace(/&nbsp;/gi, " ");
  content = content.replace(/&amp;/gi, "&");
  content = content.replace(/&lt;/gi, "<");
  content = content.replace(/&gt;/gi, ">");
  content = content.replace(/&quot;/gi, '"');
  content = content.replace(/&#39;/gi, "'");

  // 合并多余空白
  content = content.replace(/\s+/g, " ").trim();

  return content;
}

/** 从 HTML 中提取 <title> */
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

/**
 * 抓取指定 URL 的网页内容，返回标题和正文。
 * 本地实现，不依赖外部 MCP 服务。
 */
export async function fetchWebPage(url: string): Promise<WebToolResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return { success: false, message: `HTTP ${resp.status}: ${resp.statusText}` };
    }

    const html = await resp.text();
    const title = extractTitle(html);
    const content = extractTextFromHtml(html);

    // 截断到 8000 字符
    const truncated = content.length > 8000 ? content.slice(0, 8000) + "…" : content;

    if (!truncated) {
      return { success: false, message: "页面内容为空" };
    }

    return {
      success: true,
      message: `已抓取「${title || url}」，${truncated.length} 字`,
      data: { title, content: truncated, url },
    };
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("abort")) {
      return { success: false, message: "请求超时（15 秒）" };
    }
    return { success: false, message: `抓取失败: ${msg}` };
  }
}

/**
 * 使用 DuckDuckGo HTML 版搜索互联网。
 * 本地实现，不依赖外部 MCP 服务。
 */
export async function searchWeb(query: string): Promise<WebToolResult> {
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const resp = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return { success: false, message: `搜索请求失败: HTTP ${resp.status}` };
    }

    const html = await resp.text();

    // 解析 DuckDuckGo HTML 搜索结果
    // 每个结果在 <div class="result"> 或 <div class="result results_links"> 中
    const results: Array<{ title: string; snippet: string; url: string }> = [];

    // 匹配所有搜索结果块
    const resultBlocks = html.match(/<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*class="[^"]*result[^"]*"|<div[^>]*id="ads"|<\/div>\s*<\/div>\s*<\/div>\s*<div|$)/gi) || [];

    for (const block of resultBlocks) {
      if (results.length >= 5) break;

      // 提取标题和链接：<a class="result__a" href="...">
      const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
      // 提取 URL：<a class="result__url" href="...">
      const urlMatch = block.match(/<a[^>]*class="result__url"[^>]*href="([^"]*)"[^>]*>/i);
      // 提取摘要：<a class="result__snippet"> 或 <div class="result__snippet">
      const snippetMatch = block.match(
        /<(?:a|div)[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i
      );

      if (titleMatch) {
        const title = titleMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        const snippet = snippetMatch
          ? snippetMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
          : "";
        // DuckDuckGo 的 URL 可能是重定向链接，提取实际 URL
        let rawUrl = urlMatch ? urlMatch[1] : "";
        // 尝试从 DuckDuckGo 重定向中提取真实 URL
        const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          rawUrl = decodeURIComponent(uddgMatch[1]);
        }

        if (title && rawUrl) {
          results.push({ title, snippet, url: rawUrl });
        }
      }
    }

    if (results.length === 0) {
      return { success: false, message: "未找到搜索结果" };
    }

    return {
      success: true,
      message: `找到 ${results.length} 条结果`,
      data: { results },
    };
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("abort")) {
      return { success: false, message: "搜索请求超时（15 秒）" };
    }
    return { success: false, message: `搜索失败: ${msg}` };
  }
}
