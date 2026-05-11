import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * 纯 CSS group-hover 驱动的轻量 Tooltip。
 * 外层 span 覆盖触发元素到浮层的空气间距作为 group 命中区，
 * 内层 span 是实际浮层卡片。
 */
export function Tooltip({
  content,
  children,
  side = "bottom",
  align = "center",
  className,
}: TooltipProps) {
  return (
    <span className={cn("group/sb-tooltip relative inline-block", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "invisible absolute z-50 whitespace-nowrap opacity-0",
          "transition-all duration-150",
          "group-hover/sb-tooltip:visible group-hover/sb-tooltip:opacity-100",
          "group-focus-within/sb-tooltip:visible group-focus-within/sb-tooltip:opacity-100",
          // side
          side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
          // align
          align === "start" && "left-0",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "end" && "right-0",
        )}
      >
        <span
          className={cn(
            "block rounded-lg border bg-popover px-3 py-1.5 text-xs text-popover-foreground",
            "shadow-xl ring-1 ring-black/[0.04] dark:ring-white/[0.06]",
          )}
        >
          {content}
        </span>
      </span>
    </span>
  );
}
