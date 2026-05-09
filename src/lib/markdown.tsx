/**
 * 轻量 Markdown → React 元素渲染器。
 * 仅处理 AI 回复中常见的语法：标题、列表、引用、行内代码、粗体、链接、代码块、表格、分割线。
 */

import { type ReactNode } from "react";

/** 解码常见 HTML 实体，避免双重转义 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** 处理行内格式：粗体、斜体、行内代码、链接 */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  // 匹配：行内代码 | 粗体 | 斜体 | 链接
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      parts.push(decodeEntities(text.slice(last, m.index)));
    }
    const token = m[0];
    if (token.startsWith("`")) {
      parts.push(
        <code
          key={key++}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]"
        >
          {decodeEntities(token.slice(1, -1))}
        </code>,
      );
    } else if (token.startsWith("**")) {
      parts.push(
        <strong key={key++} className="font-semibold">
          {decodeEntities(token.slice(2, -2))}
        </strong>,
      );
    } else if (token.startsWith("*")) {
      parts.push(<em key={key++}>{decodeEntities(token.slice(1, -1))}</em>);
    } else if (token.startsWith("[")) {
      const label = m[2];
      const href = m[3];
      parts.push(
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-muted-foreground/40 underline-offset-2 hover:text-primary"
        >
          {decodeEntities(label)}
        </a>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(decodeEntities(text.slice(last)));
  return parts;
}

export function renderMarkdown(md: string): ReactNode[] {
  const lines = md.split("\n");
  const elements: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 跳过结束 ```
      elements.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[13px] leading-relaxed"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // 空行
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 分割线 --- / *** / ___
    if (/^(\s*[-*_]\s*){3,}$/.test(line) && /[-*_]/.test(line.replace(/\s/g, ""))) {
      elements.push(
        <hr
          key={key++}
          style={{
            borderTop: "1px solid hsl(var(--claude-rule))",
          }}
        />,
      );
      i++;
      continue;
    }

    // 表格：检测 | 分隔的行 + 分隔行（|---|---|）
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*[-:]+[-|:\s]*$/.test(lines[i + 1])) {
      const parseCells = (row: string) =>
        row
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const headers = parseCells(line);
      i += 2; // 跳过表头 + 分隔行
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(parseCells(lines[i]));
        i++;
      }
      elements.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {headers.map((h, hi) => (
                  <th
                    key={hi}
                    className="border-b border-muted-foreground/20 px-3 py-1.5 text-left font-semibold"
                  >
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="border-b border-muted-foreground/10 px-3 py-1.5"
                    >
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 标题 ### / ## / #
    const hMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (hMatch) {
      const level = hMatch[1].length;
      const cls =
        level === 1
          ? "text-lg font-bold mt-4 mb-2"
          : level === 2
            ? "text-base font-semibold mt-3 mb-1.5"
            : "text-[15px] font-semibold mt-3 mb-1";
      elements.push(
        <div key={key++} className={cls}>
          {inline(hMatch[2])}
        </div>,
      );
      i++;
      continue;
    }

    // 引用 >
    if (line.startsWith("> ")) {
      elements.push(
        <div
          key={key++}
          className="border-l-2 border-muted-foreground/30 pl-3 text-sm italic"
          style={{ color: "hsl(var(--claude-ink-muted))" }}
        >
          {inline(line.slice(2))}
        </div>,
      );
      i++;
      continue;
    }

    // 无序列表 - / * / +
    const listMatch = line.match(/^(\s*)([-*+])\s+(.*)/);
    if (listMatch) {
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const lm = lines[i].match(/^(\s*)([-*+])\s+(.*)/);
        if (!lm) break;
        items.push(
          <li key={items.length} className="ml-1">
            {inline(lm[3])}
          </li>,
        );
        i++;
      }
      elements.push(
        <ul
          key={key++}
          className="list-disc pl-5 text-sm leading-relaxed marker:text-muted-foreground/50"
        >
          {items}
        </ul>,
      );
      continue;
    }

    // 有序列表
    const olMatch = line.match(/^(\s*)\d+[.)]\s+(.*)/);
    if (olMatch) {
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const lm = lines[i].match(/^(\s*)\d+[.)]\s+(.*)/);
        if (!lm) break;
        items.push(
          <li key={items.length} className="ml-1">
            {inline(lm[2])}
          </li>,
        );
        i++;
      }
      elements.push(
        <ol
          key={key++}
          className="list-decimal pl-5 text-sm leading-relaxed marker:text-muted-foreground/50"
        >
          {items}
        </ol>,
      );
      continue;
    }

    // 普通段落
    elements.push(
      <p key={key++} className="text-sm leading-relaxed">
        {inline(line)}
      </p>,
    );
    i++;
  }

  return elements;
}
