import type { LucideIcon } from "lucide-react";
import { Flame, Radio, Clock } from "lucide-react";
import type { Settings } from "@/types";

export type HomeWidgetKey = "githubTrending" | "infoCollections" | "topSites";

interface HomeWidgetDef {
  key: HomeWidgetKey;
  nameKey: string;
  descKey: string;
  Icon: LucideIcon;
  accent: string;
  settingKey: keyof Pick<
    Settings,
    "showGithubTrendingWidget" | "showInfoCollections" | "showTopSites"
  >;
}

export const HOME_WIDGETS: HomeWidgetDef[] = [
  {
    key: "githubTrending",
    nameKey: "settings.showGithubTrendingWidget",
    descKey: "settings.showGithubTrendingWidgetHint",
    Icon: Flame,
    accent: "from-orange-500/20 to-rose-500/20 text-rose-500",
    settingKey: "showGithubTrendingWidget",
  },
  {
    key: "infoCollections",
    nameKey: "settings.showInfoCollections",
    descKey: "settings.showInfoCollectionsHint",
    Icon: Radio,
    accent: "from-emerald-500/20 to-sky-500/20 text-emerald-600 dark:text-emerald-400",
    settingKey: "showInfoCollections",
  },
  {
    key: "topSites",
    nameKey: "settings.showTopSites",
    descKey: "settings.showTopSitesHint",
    Icon: Clock,
    accent: "from-sky-500/20 to-indigo-500/20 text-sky-600 dark:text-sky-400",
    settingKey: "showTopSites",
  },
];

export function isHomeWidgetVisible(
  settings: Settings,
  key: HomeWidgetKey,
): boolean {
  const def = HOME_WIDGETS.find((w) => w.key === key);
  if (!def) return true;
  return (settings[def.settingKey] as boolean | undefined) ?? true;
}
