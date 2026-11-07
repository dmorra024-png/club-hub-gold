import { useId } from "react";
/** Static cubic ribbons: bounded SVG blur, no animation, canvas or full-page image. */
export function PremiumWaves({ lower = false }: { lower?: boolean }) {
  const id = useId().replace(/:/g, "");
  const line = lower
    ? "M0 184C168 198 315 150 440 102C590 42 706 2 800 8"
    : "M0 194C70 161 170 131 260 136S475 186 540 171C660 120 734 93 800 20";
  const ribbon = lower
    ? "M0 149C180 190 326 146 440 102C590 42 706 2 800 8V58C640 30 490 106 368 151C214 202 104 196 0 193Z"
    : "M0 154C94 104 173 108 260 136S475 186 540 171C660 120 734 93 800 20V71C688 191 589 210 492 182C296 105 159 130 0 200Z";
  return (
    <svg
      className={`premium-waves ${lower ? "premium-waves-lower" : ""}`}
      viewBox="0 0 800 200"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-edge`}>
          {lower ? (
            <>
              <stop stopColor="#006cae" stopOpacity="0" />
              <stop offset=".28" stopColor="#e7bd67" />
              <stop offset=".42" stopColor="#fff4d0" />
              <stop offset=".65" stopColor="#d6f0fc" />
              <stop offset=".83" stopColor="#0698eb" />
              <stop offset="1" stopColor="#b5eaff" />
            </>
          ) : (
            <>
              <stop stopColor="#007ccb" />
              <stop offset=".28" stopColor="#baf5ff" />
              <stop offset=".45" stopColor="#e5f5fa" />
              <stop offset=".65" stopColor="#ffe1a0" />
              <stop offset=".82" stopColor="#ffdd83" />
              <stop offset="1" stopColor="#d5f3ff" />
            </>
          )}
        </linearGradient>
        <linearGradient id={`${id}-ribbon`}>
          <stop stopColor="#0068a9" stopOpacity=".18" />
          <stop
            offset={lower ? ".36" : ".28"}
            stopColor={lower ? "#ffca68" : "#0088dd"}
            stopOpacity=".27"
          />
          <stop offset=".56" stopColor="#b7e4ff" stopOpacity=".025" />
          <stop offset=".8" stopColor={lower ? "#008cdd" : "#f7ba48"} stopOpacity=".23" />
          <stop offset="1" stopColor="#068cd9" stopOpacity=".15" />
        </linearGradient>
        <filter id={`${id}-wide`} x="-10%" y="-80%" width="120%" height="260%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id={`${id}-soft`} x="-10%" y="-60%" width="120%" height="220%">
          <feGaussianBlur stdDeviation="2.8" />
        </filter>
      </defs>
      <path d={ribbon} fill={`url(#${id}-ribbon)`} />
      <path
        d={lower ? "M250 170C304 157 368 133 423 111" : "M576 158C630 136 687 105 729 84"}
        fill="none"
        stroke="#ffc86c"
        strokeWidth="20"
        opacity=".52"
        filter={`url(#${id}-wide)`}
      />
      {!lower && (
        <ellipse
          cx="260"
          cy="136"
          rx="51"
          ry="8"
          fill="#009fef"
          opacity=".45"
          filter={`url(#${id}-wide)`}
        />
      )}
      <path
        d={line}
        fill="none"
        stroke={`url(#${id}-edge)`}
        strokeWidth="24"
        opacity=".32"
        filter={`url(#${id}-wide)`}
      />
      <path
        d={line}
        fill="none"
        stroke={`url(#${id}-edge)`}
        strokeWidth="7"
        opacity=".83"
        filter={`url(#${id}-soft)`}
      />
      <path d={line} fill="none" stroke={`url(#${id}-edge)`} strokeWidth="1.75" />
      {!lower && (
        <ellipse
          cx="260"
          cy="136"
          rx="19"
          ry="1.8"
          fill="#e8fbff"
          opacity=".95"
          filter={`url(#${id}-soft)`}
        />
      )}
      <path
        d={
          lower
            ? "M0 173C170 208 311 156 448 102C602 42 715 10 800 22"
            : "M0 173C143 101 230 121 352 153C553 232 672 147 800 43"
        }
        fill="none"
        stroke={`url(#${id}-edge)`}
        strokeWidth=".55"
        opacity=".25"
      />
      <path
        d={lower ? "M155 174C249 173 315 149 390 124" : "M174 137C215 131 245 132 284 139"}
        fill="none"
        stroke={lower ? "#fff1c4" : "#c7f8ff"}
        strokeWidth="3.5"
        opacity=".8"
        filter={`url(#${id}-soft)`}
      />
    </svg>
  );
}
