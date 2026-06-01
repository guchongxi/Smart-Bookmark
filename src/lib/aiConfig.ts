/**
 * AI 配置工具：从 Settings 中提取当前有效的 AI 配置。
 * 优先使用 activeAiPreset，回退到 Settings 中的默认配置。
 */

import type { Settings } from "@/types";

/** 当前有效的 AI 配置 */
export interface ActiveAiConfig {
  provider: "openai" | "anthropic" | "none";
  model: string;
  apiKey: string;
  baseUrl: string;
  mcpWebReader: boolean;
  mcpWebSearch: boolean;
  showThinking: boolean;
}

/**
 * 获取当前有效的 AI 配置。
 * 优先使用 activeAiPreset，如果没有则回退到 Settings 默认值。
 */
export function getActiveAiConfig(settings: Settings): ActiveAiConfig {
  const preset = settings.aiPresets?.find(p => p.id === settings.activeAiPresetId);

  if (preset) {
    return {
      provider: preset.provider,
      model: preset.model,
      apiKey: preset.apiKey,
      baseUrl: preset.baseUrl,
      mcpWebReader: preset.mcpWebReader ?? false,
      mcpWebSearch: preset.mcpWebSearch ?? false,
      showThinking: preset.showThinking ?? false,
    };
  }

  return {
    provider: settings.aiProvider,
    model: settings.aiModel,
    apiKey: settings.aiApiKey,
    baseUrl: settings.aiBaseUrl,
    mcpWebReader: settings.mcpWebReader ?? false,
    mcpWebSearch: settings.mcpWebSearch ?? false,
    showThinking: settings.showThinking ?? false,
  };
}
