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
  {
    type: "function" as const,
    function: {
      name: "save_memory",
      description: "当对话中发现用户身份信息或值得记住的事实、偏好、行为模式时，调用此工具保存到持久记忆",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["profile", "memory"],
            description: "profile=用户身份信息（姓名、职业、语言偏好），memory=事实、偏好、行为模式",
          },
          entries: {
            type: "array",
            items: { type: "string" },
            description: "要保存的信息条目，每条一句简洁描述",
          },
          reason: {
            type: "string",
            description: "保存原因（一句话说明为什么这条信息值得记住）",
          },
        },
        required: ["type", "entries", "reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_memory",
      description: "查看当前已保存的用户画像和持久记忆，保存前应先调用避免重复",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_memory",
      description: "删除指定的画像或记忆条目",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["profile", "memory"],
            description: "要删除的条目类型",
          },
          entry: {
            type: "string",
            description: "要删除的条目文本（必须与已有条目完全匹配）",
          },
        },
        required: ["type", "entry"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_memory",
      description: "修改已有的画像或记忆条目",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["profile", "memory"],
            description: "要修改的条目类型",
          },
          old_entry: {
            type: "string",
            description: "要修改的原条目文本（必须与已有条目完全匹配）",
          },
          new_entry: {
            type: "string",
            description: "修改后的新条目文本",
          },
        },
        required: ["type", "old_entry", "new_entry"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_reader",
      description: "抓取指定 URL 的网页内容，返回标题、正文、链接等",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要抓取的网页 URL" },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description: "搜索网络信息，返回搜索结果列表",
      parameters: {
        type: "object",
        properties: {
          search_query: { type: "string", description: "搜索关键词" },
        },
        required: ["search_query"],
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

/** MCP 工具名集合 */
export const MCP_TOOL_NAMES = new Set(["web_reader", "web_search"]);
