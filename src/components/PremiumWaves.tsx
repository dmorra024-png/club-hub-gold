import { useId } from "react";
export function PremiumWaves({ lower = false }: { lower?: boolean }) {
  const id = useId().replace(/:/g, "");
  const line = lower
    ? "M0 154 C220 185 358 104 520 74 C660 48 736 51 800 35"
    : "M0 136C257-42 401 224 637 96C704 59 751 49 800 2";
  return (
    <svg
      className={`premium-waves ${lower ? "premium-waves-lower" : ""}`}
      viewBox="0 0 800 180"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-line`}>
          {lower ? (
            <>
              <stop stopColor="#002945" />
              <stop offset=".35" stopColor="#ffe9a4" />
              <stop offset=".5" stopColor="#fff7d9" />
              <stop offset=".8" stopColor="#0aa6ff" />
              <stop offset="1" stopColor="#8beaff" />
            </>
          ) : (
            <>
              <stop stopColor="#0075d8" />
              <stop offset=".25" stopColor="#a8f0ff" />
              <stop offset=".48" stopColor="#fff1c8" />
              <stop offset=".72" stopColor="#f5c666" />
              <stop offset="1" stopColor="#e7f8ff" />
            </>
          )}
        </linearGradient>
        <linearGradient id={`${id}-blue`} x2="0" y2="1">
          <stop stopColor="#019fff" stopOpacity=".02" />
          <stop offset=".55" stopColor="#009fff" stopOpacity=".23" />
          <stop offset="1" stopColor="#0071bb" stopOpacity=".02" />
        </linearGradient>
        <radialGradient id={`${id}-gold`}>
          <stop stopColor="#fff7d2" stopOpacity=".9" />
          <stop offset=".28" stopColor="#ffcd6a" stopOpacity=".52" />
          <stop offset="1" stopColor="#d48a21" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-glow`} x="-15%" y="-100%" width="130%" height="300%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <path
        d="M0 111C230-18 360 177 566 99C704 59 751 49 800 2V79C549 231 299 14 0 165Z"
        fill={`url(#${id}-blue)`}
      />
      <ellipse
        cx={lower ? 320 : 565}
        cy={lower ? 126 : 107}
        rx="160"
        ry="61"
        fill={`url(#${id}-gold)`}
      />
      <path
        d={line}
        fill="none"
        stroke={`url(#${id}-line)`}
        strokeWidth="7"
        opacity=".48"
        filter={`url(#${id}-glow)`}
      />
      <path d={line} fill="none" stroke={`url(#${id}-line)`} strokeWidth="1.6" />
      <path d="M0 166C263 53 454 191 800 39" fill="none" stroke="#2486bb" strokeOpacity=".23" />
    </svg>
  );
}
