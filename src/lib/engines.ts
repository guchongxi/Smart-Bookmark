import type { CustomEngine, Settings } from "@/types";

export interface EngineDef {
  id: string;
  name: string;
  url: (q: string) => string;
  /** URL pattern used for favicon lookup */
  host: string;
  iframe?: boolean;
}

export const BUILTIN_ENGINES: EngineDef[] = [
  {
    id: "google",
    name: "Google",
    url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    host: "google.com",
  },
  {
    id: "bing",
    name: "Bing",
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    host: "bing.com",
  },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
    host: "duckduckgo.com",
    iframe: true,
  },
  {
    id: "baidu",
    name: "百度",
    url: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
    host: "baidu.com",
  },
  {
    id: "github",
    name: "GitHub",
    url: (q) =>
      `https://github.com/search?q=${encodeURIComponent(q)}&type=repositories`,
    host: "github.com",
  },
  {
    id: "stackoverflow",
    name: "Stack Overflow",
    url: (q) => `https://stackoverflow.com/search?q=${encodeURIComponent(q)}`,
    host: "stackoverflow.com",
  },
  {
    id: "youtube",
    name: "YouTube",
    url: (q) =>
      `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
    host: "youtube.com",
  },
  {
    id: "mdn",
    name: "MDN",
    url: (q) =>
      `https://developer.mozilla.org/en-US/search?q=${encodeURIComponent(q)}`,
    host: "developer.mozilla.org",
    iframe: true,
  },
  {
    id: "kimi",
    name: "Kimi",
    url: (q) => `https://kimi.moonshot.cn/?q=${encodeURIComponent(q)}`,
    host: "kimi.moonshot.cn",
  },
  {
    id: "doubao",
    name: "豆包",
    url: (q) => `https://www.doubao.com/chat/?q=${encodeURIComponent(q)}`,
    host: "doubao.com",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    url: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}`,
    host: "chatgpt.com",
  },
  {
    id: "felo",
    name: "Felo",
    url: (q) => `https://felo.ai/search?q=${encodeURIComponent(q)}`,
    host: "felo.ai",
  },
  {
    id: "metaso",
    name: "秘塔",
    url: (q) => `https://metaso.cn/?q=${encodeURIComponent(q)}`,
    host: "metaso.cn",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    url: (q) => `https://www.perplexity.ai/?q=${encodeURIComponent(q)}`,
    host: "perplexity.ai",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    url: (q) => `https://chat.deepseek.com/?q=${encodeURIComponent(q)}`,
    host: "deepseek.com",
  },
  {
    id: "qwen",
    name: "千问",
    url: (q) => `https://tongyi.aliyun.com/qianwen/?q=${encodeURIComponent(q)}`,
    host: "tongyi.aliyun.com",
  },
  {
    id: "gemini",
    name: "Gemini",
    url: (q) => `https://gemini.google.com/?q=${encodeURIComponent(q)}`,
    host: "gemini.google.com",
  },
];

function toEngineDef(c: CustomEngine): EngineDef {
  return {
    id: c.id,
    name: c.name,
    url: (q) =>
      c.url.includes("%s")
        ? c.url.replace(/%s/g, encodeURIComponent(q))
        : c.url +
          (c.url.includes("?") ? "&" : "?") +
          "q=" +
          encodeURIComponent(q),
    host: hostOf(c.url),
  };
}

export function allEngines(settings: Settings): EngineDef[] {
  return [
    ...BUILTIN_ENGINES,
    ...(settings.customEngines ?? []).map(toEngineDef),
  ];
}

export function findEngine(
  settings: Settings,
  id: string,
): EngineDef | undefined {
  return allEngines(settings).find((e) => e.id === id);
}

export function faviconFor(e: EngineDef): string {
  return `https://www.google.com/s2/favicons?domain=${e.host}&sz=64`;
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
