import type { Settings } from "@/types";
import { getSettings, onSettingsChange } from "@/lib/storage";
import { DEFAULT_THEME_PRESET } from "@/lib/themePresets";

export function resolveTheme(mode: Settings["theme"]): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(mode: Settings["theme"]) {
  const theme = resolveTheme(mode);
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
}

export function applyAccent(preset: Settings["accentPreset"] | undefined) {
  document.documentElement.dataset.accent = preset ?? "linear";
}

/**
 * 把设计主题预设挂到 <html> 上，配合 globals.css 里的
 * `:root[data-theme-preset="<key>"]` 选择器做整体换装。
 */
export function applyThemePreset(preset: Settings["themePreset"] | undefined) {
  document.documentElement.dataset.themePreset = preset ?? DEFAULT_THEME_PRESET;
}

export async function initTheme() {
  const s = await getSettings();
  applyTheme(s.theme);
  applyAccent(s.accentPreset);
  applyThemePreset(s.themePreset);
  onSettingsChange((next) => {
    applyTheme(next.theme);
    applyAccent(next.accentPreset);
    applyThemePreset(next.themePreset);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", async () => {
    const cur = await getSettings();
    if (cur.theme === "system") applyTheme("system");
  });
}
