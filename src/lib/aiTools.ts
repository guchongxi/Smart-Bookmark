/**
 * AI 书签操作工具定义（JSON Schema + 类型）。
 * 供 chat() 发送 tool definitions 给 API，供 background 执行。
 */

export interface BookmarkToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/** 工具定义：发送给 OpenAI function / Anthropic tool 的 schema */
export const BOOKMARK_TOOLS_OPENAI = [
  {
    type: "function" as const,
    function: {
      name: "search_bookmarks",
      description: "按关键词或文件夹搜索书签，返回匹配的书签列表",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词（匹配标题和 URL）" },
          folder: { type: "string", description: "限定搜索的文件夹名称" },
          limit: { type: "number", description: "最多返回数量，默认 10", default: 10 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_folders",
      description: "列出所有书签文件夹的树结构（id、名称、书签数量）",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_bookmark",
      description: "新建书签，可指定文件夹",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "书签标题" },
          url: { type: "string", description: "书签 URL" },
          folderId: { type: "string", description: "目标文件夹 ID，不填则放到根目录" },
        },
        required: ["title", "url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_bookmark",
      description: "删除指定书签（需要用户确认）",
      parameters: {
        type: "object",
        properties: {
          bookmarkId: { type: "string", description: "要删除的书签 ID" },
        },
        required: ["bookmarkId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "move_bookmark",
      description: "移动书签到目标文件夹（需要用户确认）",
      parameters: {
        type: "object",
        properties: {
          bookmarkId: { type: "string", description: "要移动的书签 ID" },
          targetFolderId: { type: "string", description: "目标文件夹 ID" },
        },
        required: ["bookmarkId", "targetFolderId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_bookmark",
      description: "修改书签的标题或 URL",
      parameters: {
        type: "object",
        properties: {
          bookmarkId: { type: "string", description: "要修改的书签 ID" },
          title: { type: "string", description: "新标题（可选）" },
          url: { type: "string", description: "新 URL（可选）" },
        },
        required: ["bookmarkId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_folder",
      description: "创建新的书签文件夹",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "文件夹名称" },
          parentId: { type: "string", description: "父文件夹 ID（可选，默认根目录）" },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
];

/** Anthropic tool 格式 */
export const BOOKMARK_TOOLS_ANTHROPIC = BOOKMARK_TOOLS_OPENAI.map((t) => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

/** 需要用户确认的工具名集合 */
export const CONFIRM_REQUIRED_TOOLS = new Set(["delete_bookmark", "move_bookmark"]);
