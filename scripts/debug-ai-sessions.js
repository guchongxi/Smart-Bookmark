/**
 * 在浏览器控制台中运行此脚本，查看最近的 AI 会话记录
 * 用于调试工具调用失败问题
 */

(async () => {
  const DB_NAME = "smart-bookmark-ai-sessions";
  const STORE_NAME = "sessions";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const all = await new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => resolve([]);
    });

    // 按更新时间倒序
    all.sort((a, b) => b.updatedAt - a.updatedAt);

    // 只显示最近 2 个会话
    const recent = all.slice(0, 2);

    console.log("=== 最近 2 个 AI 会话 ===\n");

    for (const session of recent) {
      console.log(`📌 会话: ${session.title}`);
      console.log(`   ID: ${session.id}`);
      console.log(`   创建时间: ${new Date(session.createdAt).toLocaleString()}`);
      console.log(`   更新时间: ${new Date(session.updatedAt).toLocaleString()}`);
      console.log(`   消息数量: ${session.messages.length}`);

      // 显示系统提示词
      console.log(`\n--- 系统提示词 ---`);
      if (session.systemPrompt) {
        console.log(`   ✓ 已保存 (${session.systemPrompt.length} 字符)`);
        // 显示系统提示词的结构（按 --- 分割）
        const parts = session.systemPrompt.split("---");
        console.log(`   包含 ${parts.length} 个部分:`);
        for (let j = 0; j < parts.length; j++) {
          const part = parts[j].trim();
          if (part) {
            const preview = part.slice(0, 80).replace(/\n/g, " ");
            console.log(`     [${j + 1}] ${preview}${part.length > 80 ? "..." : ""}`);
          }
        }
      } else {
        console.log(`   ✗ 未保存（系统提示词在运行时动态构建）`);
      }

      console.log("\n--- 消息详情 ---\n");

      for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i];
        const index = `[${i}]`;

        if (msg.role === "system") {
          console.log(`${index} [system] (已隐藏)`);
          continue;
        }

        if (msg.role === "user") {
          console.log(`${index} [user] ${msg.content.slice(0, 100)}${msg.content.length > 100 ? "..." : ""}`);
          continue;
        }

        if (msg.role === "assistant") {
          const hasToolCalls = msg.toolCalls?.length > 0;
          const hasThinking = !!msg.thinking;
          const hasContent = !!msg.content;

          let info = `${index} [assistant]`;
          if (hasThinking) info += " (有思考过程)";
          if (hasToolCalls) info += ` (工具调用: ${msg.toolCalls.map(tc => tc.name).join(", ")})`;
          if (hasContent) info += `\n   内容: ${msg.content.slice(0, 200)}${msg.content.length > 200 ? "..." : ""}`;

          if (hasToolCalls) {
            for (const tc of msg.toolCalls) {
              info += `\n   工具调用: ${tc.name}(${JSON.stringify(tc.args).slice(0, 100)})`;
              info += `\n   调用 ID: ${tc.id}`;
            }
          }

          console.log(info);
          continue;
        }

        if (msg.role === "tool") {
          const result = msg.toolResult;
          let info = `${index} [tool]`;
          info += `\n   toolCallId: ${result?.toolCallId ?? "无"}`;
          info += `\n   success: ${result?.success ?? "未知"}`;
          info += `\n   message: ${(result?.message ?? msg.content).slice(0, 200)}`;
          console.log(info);
          continue;
        }

        if (msg.role === "tool-confirm") {
          console.log(`${index} [tool-confirm] ${msg.content.slice(0, 100)}`);
          continue;
        }

        console.log(`${index} [${msg.role}] ${JSON.stringify(msg).slice(0, 200)}`);
      }

      console.log("\n" + "=".repeat(50) + "\n");
    }

    // 分析潜在问题
    console.log("=== 问题分析 ===\n");

    for (const session of recent) {
      console.log(`会话: ${session.title}`);

      // 检查是否有孤立的 tool result（没有对应的 assistant toolCall）
      const assistantToolCallIds = new Set();
      for (const msg of session.messages) {
        if (msg.role === "assistant" && msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            assistantToolCallIds.add(tc.id);
          }
        }
      }

      const orphanToolResults = session.messages.filter(
        msg => msg.role === "tool" && msg.toolResult?.toolCallId && !assistantToolCallIds.has(msg.toolResult.toolCallId)
      );

      if (orphanToolResults.length > 0) {
        console.warn(`⚠️ 发现 ${orphanToolResults.length} 个孤立的 tool result（没有对应的 assistant toolCall）`);
        for (const msg of orphanToolResults) {
          console.warn(`   toolCallId: ${msg.toolResult.toolCallId}`);
        }
      }

      // 检查是否有连续的工具调用（可能是重试）
      let consecutiveToolCalls = 0;
      let maxConsecutive = 0;
      for (const msg of session.messages) {
        if (msg.role === "assistant" && msg.toolCalls?.length) {
          consecutiveToolCalls++;
          maxConsecutive = Math.max(maxConsecutive, consecutiveToolCalls);
        } else if (msg.role === "user" || (msg.role === "assistant" && !msg.toolCalls?.length)) {
          consecutiveToolCalls = 0;
        }
      }

      if (maxConsecutive > 2) {
        console.warn(`⚠️ 发现连续 ${maxConsecutive} 次工具调用（可能是重试循环）`);
      }

      // 检查工具执行失败
      const failedToolResults = session.messages.filter(
        msg => msg.role === "tool" && msg.toolResult?.success === false
      );

      if (failedToolResults.length > 0) {
        console.warn(`⚠️ 发现 ${failedToolResults.length} 个工具执行失败`);
        for (const msg of failedToolResults) {
          console.warn(`   toolCallId: ${msg.toolResult.toolCallId}, message: ${msg.toolResult.message}`);
        }
      }

      console.log("");
    }

  } catch (err) {
    console.error("读取会话数据失败:", err);
  }
})();
