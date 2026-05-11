import { Flame, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { HideWidgetButton } from "@/components/HideWidgetButton";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { setSettings } from "@/lib/storage";
import { toast } from "@/components/ui/toast";
import type { Settings, TrendingMode, TrendingRange } from "@/types";
import TrendingPanel from "@/components/TrendingPanel";

interface Props {
  settings: Settings;
  mode: TrendingMode;
  range: TrendingRange;
  onModeChange: (m: TrendingMode) => void;
  onRangeChange: (r: TrendingRange) => void;
  onOpenDiscover?: () => void;
  className?: string;
}

export default function TrendingSidebar({
  settings,
  mode,
  range,
  onModeChange,
  onRangeChange,
  onOpenDiscover,
  className,
}: Props) {
  const t = useT();

  return (
    <Card className={cn("relative group flex flex-col rounded-2xl p-3 ring-1 ring-border/40 transition hover:shadow-md", className)}>
      <div className="mb-2 flex shrink-0 items-center gap-2 px-1">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500/20 to-rose-500/20 text-rose-500">
          <Flame className="h-3.5 w-3.5" />
        </div>
        <h2 className="text-sm font-semibold tracking-tight">
          {t("discover.widget.title")}
        </h2>
        <HideWidgetButton
          variant="inline"
          onClick={() => {
            setSettings({ showGithubTrendingWidget: false });
            toast(t("home.widgetHidden"), "info");
          }}
          label={t("home.hideWidget") || "隐藏"}
        />
      </div>

      {/* iOS segmented control 风格 tabs */}
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <div className="inline-flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5 text-[11px]">
          {(["created", "hottest"] as TrendingMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={cn(
                "rounded px-1.5 py-0.5 font-medium transition",
                mode === m
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border/40"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`discover.mode.${m}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-1 items-center gap-0.5 rounded-md bg-muted/60 p-0.5 text-[11px]">
          {(["daily", "weekly", "monthly", "yearly"] as TrendingRange[]).map(
            (r) => (
              <button
                key={r}
                type="button"
                onClick={() => onRangeChange(r)}
                className={cn(
                  "flex-1 rounded px-1 py-0.5 font-medium transition text-center",
                  range === r
                    ? "bg-card text-foreground shadow-sm ring-1 ring-border/40"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`discover.range.${r}`)}
              </button>
            ),
          )}
        </div>
      </div>

      <TrendingPanel
        settings={settings}
        limit={5}
        compact
        hideControls
        range={range}
        mode={mode}
        gridClassName="!grid-cols-1 gap-0 divide-y divide-border/60"
      />

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          if (onOpenDiscover) {
            onOpenDiscover();
          } else {
            const p = new URLSearchParams(window.location.hash.slice(1));
            p.set("tab", "discover");
            window.location.hash = p.toString() ? "#" + p.toString() : "#";
          }
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        className="mt-2 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-primary"
      >
        {t("discover.widget.viewAll")}
        <ArrowRight className="h-3 w-3" />
      </button>
    </Card>
  );
}
