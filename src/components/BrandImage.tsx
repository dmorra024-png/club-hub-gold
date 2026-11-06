import { useState } from "react";
import { cn } from "@/lib/utils";

// Keep original artwork whenever available; missing exports must not leave a
// broken-image icon. The existing SNOOP wordmark is the accessible fallback.
export function BrandImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) {
    if (!alt) return null;
    return (
      <span
        role="img"
        aria-label={alt}
        className={cn(
          "inline-flex items-center justify-center font-display font-bold tracking-[0.25em] text-neon",
          className,
        )}
      >
        {alt.toUpperCase()}
      </span>
    );
  }
  return <img src={src} alt={alt} className={className} onError={() => setFailed(src)} />;
}
