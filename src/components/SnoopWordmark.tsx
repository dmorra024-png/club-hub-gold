import { useId } from "react";
/** Lightweight vector lettering; no raster mockup or external font request. */
export function SnoopWordmark({ halo = false }: { halo?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <div className={halo ? "snoop-wordmark snoop-wordmark-halo" : "snoop-wordmark"}>
      {halo && (
        <svg className="snoop-brand-orbit" viewBox="0 0 120 120" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-orbit`} x2=".7" y2="1">
              <stop stopColor="#fff8d8" />
              <stop offset=".28" stopColor="#ffc85d" />
              <stop offset=".55" stopColor="#51330e" />
              <stop offset=".85" stopColor="#ffeeb0" />
              <stop offset="1" stopColor="#b88028" />
            </linearGradient>
          </defs>
          <circle
            cx="60"
            cy="60"
            r="53"
            fill="none"
            stroke={`url(#${id}-orbit)`}
            strokeWidth="1.5"
          />
        </svg>
      )}
      <svg
        preserveAspectRatio="none"
        viewBox="0 0 382 60"
        role="img"
        aria-label="SNOOP"
        className="snoop-lettering"
      >
        <defs>
          <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#fff" />
            <stop offset=".32" stopColor="#eef1f4" />
            <stop offset=".48" stopColor="#8c9296" />
            <stop offset=".51" stopColor="#e9e9e5" />
            <stop offset=".83" stopColor="#b2aea3" />
            <stop offset="1" stopColor="#f7edd4" />
          </linearGradient>
        </defs>
        <g
          fill={`url(#${id}-metal)`}
          stroke="#ffffff"
          strokeOpacity=".3"
          strokeWidth=".6"
          fillRule="evenodd"
        >
          <path d="M65 4H10L2 12V29L10 36H53V45H2V56H58L66 48V31L58 24H15V15H65Z" />
          <path d="M79 56V4H92L133 38V4H146V56H133L92 22V56Z" />
          <path d="M168 4H218L226 12V48L218 56H168L160 48V12ZM174 16V44H212V16Z" />
          <path d="M248 4H298L306 12V48L298 56H248L240 48V12ZM254 16V44H292V16Z" />
          <path d="M320 56V4H372L380 12V31L372 39H334V56ZM334 16V27H366V16Z" />
        </g>
      </svg>
    </div>
  );
}
