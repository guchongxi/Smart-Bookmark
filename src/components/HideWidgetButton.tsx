import { EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface HideWidgetButtonProps {
  onClick: () => void;
  label: string;
  tooltip?: string;
  variant?: "absolute" | "inline";
  className?: string;
}

export function HideWidgetButton({
  onClick,
  label,
  tooltip,
  variant = "absolute",
  className,
}: HideWidgetButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip ?? label}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-background/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground",
        "backdrop-blur-md shadow-sm transition-all duration-150",
        "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive",
        "active:scale-95",
        variant === "absolute" &&
          "absolute right-2 top-2 opacity-0 group-hover:opacity-100",
        variant === "inline" && "relative",
        className,
      )}
    >
      <EyeOff className="h-3 w-3" />
      {variant === "inline" && <span>{label}</span>}
    </button>
  );
}
