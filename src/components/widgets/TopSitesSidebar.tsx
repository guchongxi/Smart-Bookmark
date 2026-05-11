import { Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FaviconImg } from "@/components/FaviconImg";
import { HideWidgetButton } from "@/components/HideWidgetButton";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, hostnameOf } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { setSettings } from "@/lib/storage";
import { toast } from "@/components/ui/toast";

interface TopSite {
  url: string;
  title: string;
}

interface Props {
  sites: TopSite[];
  limit?: number;
  className?: string;
}

export default function TopSitesSidebar({ sites, limit = 3, className }: Props) {
  const t = useT();
  const visible = sites.slice(0, limit);

  if (visible.length === 0) return null;

  return (
    <Card className={cn("relative group flex flex-col rounded-2xl p-3 ring-1 ring-border/40 transition hover:shadow-md", className)}>
      <div className="mb-1 flex shrink-0 items-center gap-2 px-1">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500/20 to-indigo-500/20 text-sky-600 dark:text-sky-400">
          <Clock className="h-3.5 w-3.5" />
        </div>
        <h2 className="text-sm font-semibold tracking-tight">
          {t("dash.topSites") || "常去"}
        </h2>
        <Tooltip content={t("dash.topSitesHint") || "浏览器按访问频率自动更新"} side="bottom" align="start">
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground cursor-default">
            TOP {visible.length}
          </span>
        </Tooltip>
        <HideWidgetButton
          variant="inline"
          onClick={() => {
            setSettings({ showTopSites: false });
            toast(t("home.widgetHidden"), "info");
          }}
          label={t("home.hideWidget") || "隐藏"}
        />
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 scrollbar-thin">
        {visible.map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            title={s.url}
            className="group/item flex items-center gap-2.5 rounded-md px-2 py-1.5 transition hover:bg-accent/70"
          >
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background ring-1 ring-border">
              <FaviconImg url={s.url} size={32} className="h-4 w-4 rounded" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {s.title || hostnameOf(s.url)}
              </div>
            </div>
          </a>
        ))}
      </div>
    </Card>
  );
}
