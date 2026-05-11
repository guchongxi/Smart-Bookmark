/**
 * MCP Streamable HTTP 客户端
 * 用于调用智谱 GLM 的 Web Reader / Web Search 等 MCP 服务。
 */

interface McpToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

interface McpSession {
  endpoint: string;
  apiKey: string;
  initialized: boolean;
  serverInfo?: { name?: string; version?: string };
  /** 服务器实际提供的工具列表（含 schema） */
  tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
}

const sessions = new Map<string, McpSession>();

/** 获取或创建 MCP 会话 */
function getSession(endpoint: string, apiKey: string): McpSession {
  const key = `${endpoint}:${apiKey}`;
  let session = sessions.get(key);
  if (!session) {
    session = { endpoint, apiKey, initialized: false };
    sessions.set(key, session);
  }
  return session;
}

/** 发送 JSON-RPC 请求 */
async function rpcCall(
  endpoint: string,
  apiKey: string,
  method: string,
  params?: Record<string, unknown>,
  id?: number,
): Promise<unknown> {
  const body: Record<string, unknown> = {
    jsonrpc: "2.0",
    method,
    params: params ?? {},
  };
  if (id != null) body.id = id;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`MCP HTTP ${resp.status}: ${errText || resp.statusText}`);
    }

    const contentType = resp.headers.get("content-type") ?? "";
    const text = await resp.text();

    // console.log(`[SB-MCP] 原始响应 (content-type: ${contentType})`, text.slice(0, 500));

    // 纯 JSON 响应
    if (contentType.includes("application/json") || text.trimStart().startsWith("{")) {
      return JSON.parse(text);
    }

    // SSE 格式：尝试多种解析方式
    if (contentType.includes("text/event-stream") || text.includes("data:")) {
      let lastData: unknown = null;

      // 方式 1：标准 data: 前缀
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) {
          const payload = trimmed.slice(5).trim();
          if (payload) {
            try {
              lastData = JSON.parse(payload);
            } catch {
              // 跳过
            }
          }
        }
      }
      if (lastData != null) return lastData;

      // 方式 2：尝试逐行解析为 JSON
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{")) {
          try {
            lastData = JSON.parse(trimmed);
          } catch {
            // 跳过
          }
        }
      }
      if (lastData != null) return lastData;

      // 方式 3：尝试整体解析（SSE 可能是单行）
      const trimmedText = text.trim();
      if (trimmedText.startsWith("{")) {
        return JSON.parse(trimmedText);
      }
    }

    throw new Error(`MCP: 无法解析响应 (content-type: ${contentType}, length: ${text.length})`);
  } finally {
    clearTimeout(timeout);
  }
}

/** 初始化 MCP 会话 */
async function initializeSession(session: McpSession): Promise<void> {
  const initResult = await rpcCall(
    session.endpoint,
    session.apiKey,
    "initialize",
    {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "smart-bookmark", version: "1.0.0" },
    },
    1,
  ) as {
    result?: {
      protocolVersion?: string;
      capabilities?: Record<string, unknown>;
      serverInfo?: { name?: string; version?: string };
    };
    error?: { message: string; code?: number };
  };

  // console.log("[SB-MCP] initialize 响应:", initResult);

  if (initResult?.error) {
    throw new Error(`MCP 初始化错误: ${initResult.error.message}`);
  }

  if (initResult?.result == null) {
    throw new Error("MCP 初始化失败: 服务器无响应");
  }

  session.serverInfo = initResult.result.serverInfo;

  // 发送 initialized 通知
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    await fetch(session.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${session.apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  // 查询可用工具列表（含 inputSchema，用于参数映射）
  try {
    const toolsResult = await rpcCall(
      session.endpoint,
      session.apiKey,
      "tools/list",
      {},
      Date.now(),
    ) as {
      result?: { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
    };
    if (toolsResult?.result?.tools) {
      session.tools = toolsResult.result.tools;
      console.log("[SB-MCP] 服务器工具列表:", session.tools.map((t) => t.name));
    }
  } catch {
    // tools/list 失败不影响使用
  }

  session.initialized = true;
}

/** 调用 MCP 工具 */
export async function callMcpTool(
  endpoint: string,
  apiKey: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  try {
    const session = getSession(endpoint, apiKey);

    if (!session.initialized) {
      await initializeSession(session);
    }

    // 用服务器实际工具定义做名称映射和参数过滤
    let actualName = toolName;
    let actualArgs = args;
    if (session.tools && session.tools.length > 0) {
      // 优先精确匹配名称
      let matched = session.tools.find((t) => t.name === toolName);
      // 不匹配时用第一个工具（每个 MCP 服务端通常只有一个工具）
      if (!matched) matched = session.tools[0];
      actualName = matched.name;
      if (actualName !== toolName) {
        console.log(`[SB-MCP] 工具名映射: ${toolName} → ${actualName}`);
      }

      // 用服务器 schema 过滤参数：只保留服务器接受的参数名
      const schemaProps = matched.inputSchema?.properties as Record<string, unknown> | undefined;
      if (schemaProps && Object.keys(schemaProps).length > 0) {
        const accepted = new Set(Object.keys(schemaProps));
        const filtered: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(args)) {
          if (accepted.has(k)) {
            filtered[k] = v;
          }
        }
        // 如果过滤后有参数丢失，尝试用 schema 中第一个参数名映射
        const lost = Object.keys(args).filter((k) => !accepted.has(k));
        if (lost.length > 0 && Object.keys(filtered).length === 0) {
          // 所有参数都不匹配，尝试按顺序映射到 schema 参数
          const schemaKeys = Object.keys(schemaProps);
          const argValues = Object.values(args);
          for (let i = 0; i < Math.min(schemaKeys.length, argValues.length); i++) {
            filtered[schemaKeys[i]] = argValues[i];
          }
          console.log(`[SB-MCP] 参数映射: ${lost.join(",")} → ${Object.keys(filtered).join(",")}`);
        }
        actualArgs = filtered;
      }
    }

    console.log(`[SB-MCP] tools/call → ${actualName}`, { args: actualArgs, keyPrefix: apiKey.slice(0, 8) + "..." });

    const rpcResult = await rpcCall(
      endpoint,
      apiKey,
      "tools/call",
      { name: actualName, arguments: actualArgs },
      Date.now(),
    ) as {
      result?: {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };
      error?: { message: string; code?: number };
    };

    if (rpcResult?.error) {
      // 服务器返回 JSON-RPC 错误
      return { success: false, message: `MCP 错误: ${rpcResult.error.message}` };
    }

    if (rpcResult?.result?.isError) {
      // 工具执行失败
      const content = rpcResult.result.content;
      const text = content?.map((c) => c.text ?? "").join("\n") ?? "工具执行失败";
      return { success: false, message: text };
    }

    const content = rpcResult?.result?.content;
    if (content && content.length > 0) {
      const text = content.map((c) => c.text ?? "").join("\n");

      // 检查内容是否包含嵌套的 error 字段（GLM MCP 服务器的错误格式）
      try {
        // 文本可能是双重 stringified JSON: "\"{\\\"error\\\":\\\"...\\\"}\""
        let inner = text;
        // 尝试 parse 第一层
        if (inner.startsWith('"') && inner.endsWith('"')) {
          inner = JSON.parse(inner);
        }
        // 尝试 parse 第二层
        if (typeof inner === "string" && inner.startsWith("{")) {
          const obj = JSON.parse(inner);
          if (obj?.error) {
            return { success: false, message: obj.error };
          }
        }
      } catch {
        // 不是 JSON，直接返回原文
      }

      return { success: true, message: text, data: rpcResult.result };
    }

    return { success: true, message: "执行完成", data: rpcResult?.result };
  } catch (err) {
    const errMsg = (err as Error).message;

    // 401/403 → 清除会话状态，下次重新初始化
    if (errMsg.includes("401") || errMsg.includes("403")) {
      const session = getSession(endpoint, apiKey);
      session.initialized = false;
      return { success: false, message: `API Key 无效或无权限: ${errMsg}` };
    }

    // 初始化失败时重试一次
    const session = getSession(endpoint, apiKey);
    if (!session.initialized) {
      try {
        session.initialized = false;
        await initializeSession(session);
        return callMcpTool(endpoint, apiKey, toolName, args);
      } catch {
        // fall through
      }
    }

    return { success: false, message: `MCP 调用失败: ${errMsg}` };
  }
}

/** MCP 服务端点常量 */
export const MCP_ENDPOINTS = {
  webReader: "https://open.bigmodel.cn/api/mcp/web_reader/mcp",
  webSearch: "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp",
} as const;
