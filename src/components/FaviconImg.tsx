import { useState } from "react";
import { useFavicon } from "@/hooks/useFavicon";

interface FaviconImgProps {
  url: string;
  size?: number;
  className?: string;
  refreshKey?: number;
}

// 根据域名生成背景色
function hashColor(host: string): string {
  let hash = 0;
  for (let i = 0; i < host.length; i++) {
    hash = host.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 50%)`;
}

function getInitial(host: string): string {
  return host.replace(/^www\./, "").charAt(0).toUpperCase();
}

export function FaviconImg({ url, size = 32, className = "", refreshKey = 0 }: FaviconImgProps) {
  const src = useFavicon(url, refreshKey);
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    // fallback：首字母
    try {
      const host = new URL(url).hostname;
      const letter = getInitial(host);
      const bg = hashColor(host);
      const fontSize = Math.round(size * 0.5);
      return (
        <div
          style={{
            width: size,
            height: size,
            background: bg,
            borderRadius: size < 24 ? 4 : 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize,
            fontWeight: 600,
            lineHeight: 1,
          }}
          className={className}
        >
          {letter}
        </div>
      );
    } catch {
      return null;
    }
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
