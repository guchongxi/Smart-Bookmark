import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getSettings, setSettings } from "@/lib/storage";
import type { AccentPreset, AiPreset, Settings, ThemePreset } from "@/types";
import { useT } from "@/lib/i18n";
import { testAi } from "@/lib/ai";
import { BUILTIN_ENGINES, faviconFor } from "@/lib/engines";
import { Check, CheckCircle2, XCircle, Loader2, Flame, ExternalLink, Globe, Plus, Trash2, Copy, Settings2 } from "lucide-react";
import { COMMON_LANGUAGES, clearTrendingCache } from "@/lib/github";
import { HOME_WIDGETS } from "@/lib/homeWidgets";
import { clearAllNoIconCache } from "@/lib/favicon";
import { clearSummaryCache } from "@/lib/bookmarkSummaryCache";
import type { TrendingMode, TrendingRange, TrendingSort } from "@/types";
import { toast } from "@/components/ui/toast";
import { THEME_PRESETS } from "@/lib/themePresets";
import { cn } from "@/lib/utils";

const ENGINE_LIST = BUILTIN_ENGINES.slice(0, 10);

export default function SettingsPage() {
  const t = useT();
  const [s, setS] = useState<Settings | null>(null);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs: number;
    message: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);

  /* ── AI 预设管理状态 ── */
  const [editingPreset, setEditingPreset] = useState<AiPreset | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    getSettings().then(setS);
  }, []);

  if (!s) return null;

  const update = async (patch: Partial<Settings>) => {
    const next = await setSettings(patch);
    setS(next);
  };

  const toggleCompareEngine = async (id: string) => {
    const cur = new Set(s.compareEngines);
    cur.has(id) ? cur.delete(id) : cur.add(id);
    if (cur.size === 0) cur.add("google");
    await update({ compareEngines: Array.from(cur) });
  };

  const onTestAi = async () => {
    setTesting(true);
    setTestResult(null);
    // 如果正在编辑预设，使用预设配置测试；否则使用 Settings 默认配置
    const r = await testAi(editingPreset ?? s);
    setTestResult(r);
    setTesting(false);
  };

  /* ── AI 预设操作 ── */
  const presets = s.aiPresets ?? [];
  const activePresetId = s.activeAiPresetId;

  const createPreset = async () => {
    const newPreset: AiPreset = {
      id: crypto.randomUUID(),
      name: `配置 ${presets.length + 1}`,
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "",
      baseUrl: "",
      mcpWebReader: false,
      mcpWebSearch: false,
      showThinking: false,
    };
    const nextPresets = [...presets, newPreset];
    await update({ aiPresets: nextPresets, activeAiPresetId: newPreset.id });
    setEditingPreset(newPreset);
    setIsDirty(false);
  };

  const deletePreset = async (id: string) => {
    const nextPresets = presets.filter(p => p.id !== id);
    const nextActiveId = activePresetId === id
      ? (nextPresets[0]?.id ?? undefined)
      : activePresetId;
    await update({ aiPresets: nextPresets, activeAiPresetId: nextActiveId });
    if (editingPreset?.id === id) {
      setEditingPreset(null);
      setIsDirty(false);
    }
  };

  const activatePreset = async (id: string) => {
    await update({ activeAiPresetId: id });
  };

  const savePreset = async () => {
    if (!editingPreset) return;
    const nextPresets = presets.map(p =>
      p.id === editingPreset.id ? editingPreset : p
    );
    await update({ aiPresets: nextPresets });
    setIsDirty(false);
    toast("配置已保存", "success");
  };

  const updateEditingPreset = (patch: Partial<AiPreset>) => {
    if (!editingPreset) return;
    setEditingPreset({ ...editingPreset, ...patch });
    setIsDirty(true);
  };

  const duplicatePreset = async (preset: AiPreset) => {
    const newPreset: AiPreset = {
      ...preset,
      id: crypto.randomUUID(),
      name: `${preset.name} (副本)`,
    };
    const nextPresets = [...presets, newPreset];
    await update({ aiPresets: nextPresets });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label={t("settings.theme")}>
            <div className="flex gap-2">
              {(
                [
                  ["system", t("settings.themeAuto")],
                  ["light", t("settings.themeLight")],
                  ["dark", t("settings.themeDark")],
                ] as const
              ).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={s.theme === v ? "default" : "outline"}
                  onClick={() => update({ theme: v as Settings["theme"] })}
                >
                  {label}
                </Button>
              ))}
            </div>
          </Row>
          <Row label={t("settings.themePreset")}>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {THEME_PRESETS.map((p) => {
                  const active = (s.themePreset ?? "default") === p.key;
                  const isDark =
                    typeof document !== "undefined" &&
                    document.documentElement.classList.contains("dark");
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() =>
                        update({ themePreset: p.key as ThemePreset })
                      }
                      className={cn(
                        "group relative flex items-start gap-3 rounded-xl border bg-card p-3 text-left transition hover:border-primary/50 hover:shadow-sm",
                        active && "border-primary ring-2 ring-primary/20",
                      )}
                    >
                      <span
                        aria-hidden
                        className="mt-0.5 h-8 w-8 shrink-0 rounded-lg ring-1 ring-black/10 dark:ring-white/10"
                        style={{
                          backgroundColor: isDark
                            ? p.swatchDark
                            : p.swatchLight,
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">
                            {p.shortLabel}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {p.label}
                          </span>
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                          {p.description}
                        </div>
                      </div>
                      {active && (
                        <Check className="absolute right-2 top-2 h-4 w-4 text-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("settings.themePresetHint")}
              </p>
            </div>
          </Row>
          <Row label={t("settings.accent")}>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["linear", t("settings.accentLinear")],
                  ["indigo", t("settings.accentIndigo")],
                  ["blue", t("settings.accentBlue")],
                  ["emerald", t("settings.accentEmerald")],
                  ["rose", t("settings.accentRose")],
                  ["amber", t("settings.accentAmber")],
                  ["violet", t("settings.accentViolet")],
                  ["cyan", t("settings.accentCyan")],
                  ["orange", t("settings.accentOrange")],
                ] as const
              ).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={
                    (s.accentPreset ?? "linear") === v ? "default" : "outline"
                  }
                  onClick={() =>
                    update({ accentPreset: v as AccentPreset })
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
            {(s.themePreset ?? "default") !== "default" && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {t("settings.accentDisabledByPreset")}
              </p>
            )}
          </Row>
          <Row label={t("settings.density")}>
            <div className="flex gap-2">
              {(
                [
                  ["comfy", t("settings.densityComfy")],
                  ["compact", t("settings.densityCompact")],
                ] as const
              ).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={s.cardDensity === v ? "default" : "outline"}
                  onClick={() =>
                    update({ cardDensity: v as Settings["cardDensity"] })
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          </Row>
          <Row label={t("settings.wallpaper")}>
            <Input
              placeholder={t("settings.wallpaperPh")}
              value={s.wallpaper ?? ""}
              onChange={(e) =>
                update({ wallpaper: e.target.value || undefined })
              }
            />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.search")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label={t("settings.defaultEngine")}>
            <div className="flex flex-wrap gap-2">
              {ENGINE_LIST.slice(0, 6).map((e) => (
                <Button
                  key={e.id}
                  size="sm"
                  variant={s.searchEngine === e.id ? "default" : "outline"}
                  onClick={() => update({ searchEngine: e.id })}
                  className="gap-1.5"
                >
                  <img
                    src={faviconFor(e)}
                    alt=""
                    className="h-3.5 w-3.5 rounded"
                  />
                  {e.name}
                </Button>
              ))}
            </div>
          </Row>
          <Row label={t("settings.compareEngines")}>
            <div className="flex flex-wrap gap-2">
              {ENGINE_LIST.map((e) => {
                const on = s.compareEngines.includes(e.id);
                return (
                  <Button
                    key={e.id}
                    size="sm"
                    variant={on ? "default" : "outline"}
                    onClick={() => toggleCompareEngine(e.id)}
                    className="gap-1.5"
                  >
                    <img
                      src={faviconFor(e)}
                      alt=""
                      className="h-3.5 w-3.5 rounded"
                    />
                    {e.name}
                  </Button>
                );
              })}
            </div>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.extras")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label={t("settings.favicon")}>
            <div className="space-y-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const count = await clearAllNoIconCache();
                  toast(
                    count > 0
                      ? t("settings.faviconResetDone").replace("{n}", String(count))
                      : t("settings.faviconResetNone"),
                    count > 0 ? "success" : "info",
                  );
                }}
              >
                {t("settings.faviconReset")}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                {t("settings.faviconHint")}
              </p>
            </div>
          </Row>
          <Row label={t("settings.bookmarkSummaryCache")}>
            <div className="space-y-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await clearSummaryCache();
                  toast(t("settings.bookmarkSummaryCacheClear") + " ✓", "success");
                }}
              >
                {t("settings.bookmarkSummaryCacheClear")}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                {t("settings.bookmarkSummaryCacheHint")}
              </p>
            </div>
          </Row>
          <Row label={t("settings.language")}>
            <div className="flex gap-2">
              {(
                [
                  ["auto", "Auto"],
                  ["zh", "中文"],
                  ["en", "English"],
                ] as const
              ).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={s.language === v ? "default" : "outline"}
                  onClick={() =>
                    update({ language: v as Settings["language"] })
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            {t("settings.ai")}
          </CardTitle>
          <CardDescription>
            支持多套 AI 配置，可随时切换
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 配置列表 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">配置列表</span>
              <Button size="sm" variant="outline" onClick={createPreset} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                新增配置
              </Button>
            </div>

            {presets.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                暂无 AI 配置，点击「新增配置」创建第一套
              </div>
            ) : (
              <div className="space-y-2">
                {presets.map((preset) => {
                  const isActive = preset.id === activePresetId;
                  const isEditing = preset.id === editingPreset?.id;
                  return (
                    <div
                      key={preset.id}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-3 transition",
                        isActive ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                        isEditing && "ring-2 ring-primary/30",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{preset.name}</span>
                          {isActive && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                              使用中
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {preset.provider} · {preset.model || "未设置模型"}
                          {preset.apiKey ? " · ✓ 已配置 Key" : " · ✗ 未配置 Key"}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!isActive && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => activatePreset(preset.id)}
                            className="h-7 text-xs"
                          >
                            切换
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant={isEditing ? "default" : "ghost"}
                          onClick={() => {
                            setEditingPreset(isEditing ? null : preset);
                            setIsDirty(false);
                          }}
                          className="h-7 text-xs"
                        >
                          {isEditing ? "收起" : "编辑"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => duplicatePreset(preset)}
                          className="h-7 px-1.5"
                          title="复制"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`确定删除配置「${preset.name}」？`)) {
                              deletePreset(preset.id);
                            }
                          }}
                          className="h-7 px-1.5 text-destructive hover:text-destructive"
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 编辑面板 */}
          {editingPreset && (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">编辑配置</span>
                {isDirty && (
                  <span className="text-xs text-amber-500">有未保存的修改</span>
                )}
              </div>

              <Row label="名称">
                <Input
                  value={editingPreset.name}
                  onChange={(e) => updateEditingPreset({ name: e.target.value })}
                  placeholder="配置名称"
                />
              </Row>

              <Row label={t("settings.provider")}>
                <div className="flex gap-2">
                  {(
                    [
                      ["openai", "OpenAI"],
                      ["anthropic", "Anthropic"],
                    ] as const
                  ).map(([v, label]) => (
                    <Button
                      key={v}
                      size="sm"
                      variant={editingPreset.provider === v ? "default" : "outline"}
                      onClick={() => updateEditingPreset({ provider: v })}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </Row>

              <Row label={t("settings.model")}>
                <Input
                  value={editingPreset.model}
                  placeholder="gpt-4o-mini / claude-3-5-sonnet-latest / deepseek-chat"
                  onChange={(e) => updateEditingPreset({ model: e.target.value })}
                />
              </Row>

              <Row label="Base URL">
                <Input
                  value={editingPreset.baseUrl}
                  placeholder={
                    editingPreset.provider === "anthropic"
                      ? "https://api.anthropic.com（留空用默认）"
                      : "https://api.openai.com/v1（留空用默认）"
                  }
                  onChange={(e) => updateEditingPreset({ baseUrl: e.target.value })}
                />
              </Row>

              <Row label={t("settings.apiKey")}>
                <Input
                  type="password"
                  value={editingPreset.apiKey}
                  placeholder={t("settings.apiKeyPh")}
                  onChange={(e) => updateEditingPreset({ apiKey: e.target.value })}
                />
              </Row>

              <Row label={t("settings.showThinking")}>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={editingPreset.showThinking ?? false}
                    onCheckedChange={(v) => updateEditingPreset({ showThinking: v })}
                  />
                  <span className="text-xs text-muted-foreground">
                    {t("settings.showThinkingHint")}
                  </span>
                </div>
              </Row>

              <Row label="连通性">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onTestAi}
                    disabled={testing || !editingPreset.apiKey}
                    className="gap-2"
                  >
                    {testing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    测试连接
                  </Button>
                  {testResult && (
                    <span
                      className={
                        "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs " +
                        (testResult.ok
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-destructive/10 text-destructive")
                      }
                    >
                      {testResult.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      {testResult.ok ? "成功" : "失败"} · {testResult.latencyMs}ms
                      <span className="max-w-[240px] truncate opacity-80">
                        · {testResult.message}
                      </span>
                    </span>
                  )}
                </div>
              </Row>

              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingPreset(null);
                    setIsDirty(false);
                  }}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={savePreset}
                  disabled={!isDirty}
                >
                  保存配置
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            {t("settings.apiKeyNotice")} OpenAI 兼容接口（DeepSeek/Moonshot Kimi/LM Studio/Ollama 等）可通过自定义 Base URL 使用。
          </div>
        </CardContent>
      </Card>

      {/* AI 扩展能力 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t("settings.mcp")}
          </CardTitle>
          <CardDescription>{t("settings.mcpHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label={t("settings.mcpWebReader")}>
            <div className="flex items-center gap-2">
              <Switch
                checked={s?.mcpWebReader ?? false}
                onCheckedChange={(v) => update({ mcpWebReader: v })}
              />
              <span className="text-sm text-muted-foreground">{t("settings.mcpWebReaderHint")}</span>
            </div>
          </Row>
          <Row label={t("settings.mcpWebSearch")}>
            <div className="flex items-center gap-2">
              <Switch
                checked={s?.mcpWebSearch ?? false}
                onCheckedChange={(v) => update({ mcpWebSearch: v })}
              />
              <span className="text-sm text-muted-foreground">{t("settings.mcpWebSearchHint")}</span>
            </div>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-rose-500" />
            {t("settings.discover")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label={t("settings.homeWidgets")}>
            <div className="space-y-3">
              <p className="text-[11px] text-muted-foreground">
                {t("settings.homeWidgetsHint")}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {HOME_WIDGETS.map((w) => {
                  const visible = (s[w.settingKey] as boolean | undefined) ?? true;
                  return (
                    <div
                      key={w.key}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border p-3 transition",
                        visible
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/60 bg-muted/20",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br",
                          w.accent,
                        )}
                      >
                        <w.Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{t(w.nameKey)}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {t(w.descKey)}
                        </div>
                      </div>
                      <Switch
                        checked={visible}
                        onCheckedChange={(v) =>
                          update({ [w.settingKey]: v } as Partial<Settings>)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </Row>
          <Row label={t("settings.githubToken")}>
            <div className="space-y-2">
              <Input
                type="password"
                value={s.githubToken ?? ""}
                placeholder="ghp_••••••••••••••••••••••••••••••••••••"
                onChange={(e) => update({ githubToken: e.target.value })}
              />
              <div className="flex items-center gap-2">
                <a
                  href="https://github.com/settings/tokens/new?description=Smart%20Bookmark&scopes=public_repo"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {t("settings.githubTokenCreate")}
                  <ExternalLink className="h-3 w-3" />
                </a>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await clearTrendingCache();
                    toast("已清空 GitHub Trending 缓存", "success");
                  }}
                >
                  清空缓存
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                {t("settings.githubTokenHint")}
              </div>
            </div>
          </Row>
          <Row label={t("settings.discoverDefaults")}>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["created", t("discover.mode.created")],
                  ["hottest", t("discover.mode.hottest")],
                ] as const
              ).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={
                    (s.discoverDefaultMode ?? "created") === v
                      ? "default"
                      : "outline"
                  }
                  onClick={() =>
                    update({ discoverDefaultMode: v as TrendingMode })
                  }
                >
                  {label}
                </Button>
              ))}
              <div className="mx-2 h-5 w-px bg-border" />
              {(
                [
                  ["daily", t("discover.range.daily")],
                  ["weekly", t("discover.range.weekly")],
                  ["monthly", t("discover.range.monthly")],
                  ["yearly", t("discover.range.yearly")],
                ] as const
              ).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={
                    (s.discoverDefaultRange ?? "weekly") === v
                      ? "default"
                      : "outline"
                  }
                  onClick={() =>
                    update({ discoverDefaultRange: v as TrendingRange })
                  }
                >
                  {label}
                </Button>
              ))}
              <div className="mx-2 h-5 w-px bg-border" />
              <select
                value={s.discoverDefaultLanguage ?? ""}
                onChange={(e) =>
                  update({ discoverDefaultLanguage: e.target.value })
                }
                className="rounded-md border bg-background px-2 py-1 text-sm"
              >
                <option value="">{t("discover.language.all")}</option>
                {COMMON_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </Row>
          <Row label={t("settings.discoverSort")}>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ["auto", t("discover.sort.auto")],
                    [
                      "velocity-since-creation",
                      t("discover.sort.velocity-since-creation"),
                    ],
                    ["recent-growth", t("discover.sort.recent-growth")],
                    ["total-stars", t("discover.sort.total-stars")],
                  ] as const
                ).map(([v, label]) => (
                  <Button
                    key={v}
                    size="sm"
                    variant={
                      (s.discoverDefaultSort ?? "auto") === v
                        ? "default"
                        : "outline"
                    }
                    onClick={() =>
                      update({ discoverDefaultSort: v as TrendingSort })
                    }
                    title={t(`discover.sort.${v}.hint`)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("settings.discoverSortHint")}
              </p>
            </div>
          </Row>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-4">
      <div className="pt-2 text-sm font-medium text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
