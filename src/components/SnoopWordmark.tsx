import { useId } from "react";
/** Drawn metal lettering and light arcs, independent of fonts or raster imagery. */
export function SnoopWordmark({ halo = false }: { halo?: boolean }) {
  const id = useId().replace(/:/g, "");
  const arc = "M8 43A54 54 0 0 1 112 43M8 77A54 54 0 0 0 112 77";
  return (
    <div className={halo ? "snoop-wordmark snoop-wordmark-halo" : "snoop-wordmark"}>
      {halo && (
        <svg className="snoop-brand-orbit" viewBox="0 0 120 120" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-orbit`} x1="0" y1="0" x2="1" y2=".6">
              <stop stopColor="#71501d" />
              <stop offset=".29" stopColor="#fff8d8" />
              <stop offset=".5" stopColor="#ffd37b" />
              <stop offset=".77" stopColor="#fff4c5" />
              <stop offset="1" stopColor="#805516" />
            </linearGradient>
            <filter id={`${id}-bloom`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.8" />
            </filter>
          </defs>
          <path
            d={arc}
            fill="none"
            stroke="#ffc35c"
            strokeWidth="4.8"
            opacity=".7"
            filter={`url(#${id}-bloom)`}
          />
          <path d={arc} fill="none" stroke={`url(#${id}-orbit)`} strokeWidth="1.5" />
          <g fill="#fff4c5">
            <ellipse
              cx="74"
              cy="8"
              rx="10"
              ry="1.5"
              transform="rotate(12 74 8)"
              filter={`url(#${id}-bloom)`}
            />
            <ellipse cx="61" cy="112" rx="10" ry="1.5" filter={`url(#${id}-bloom)`} />
          </g>
        </svg>
      )}
      <svg
        preserveAspectRatio="none"
        viewBox="0 0 470 60"
        role="img"
        aria-label="SNOOP"
        className="snoop-lettering"
      >
        <defs>
          <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#ffffff" />
            <stop offset=".34" stopColor="#dadddf" />
            <stop offset=".43" stopColor="#f4f5f5" />
            <stop offset=".49" stopColor="#a4a6a7" />
            <stop offset=".54" stopColor="#dfe2de" />
            <stop offset=".86" stopColor="#b5b3ac" />
            <stop offset="1" stopColor="#f6ead2" />
          </linearGradient>
        </defs>
        <g
          fill={`url(#${id}-metal)`}
          stroke="#ffffff"
          strokeOpacity=".4"
          strokeWidth=".5"
          fillRule="evenodd"
        >
          <path d="M84 4H12Q4 4 4 12V27Q4 34 12 34H71V45H4V54H77Q85 54 85 46V32Q85 25 77 25H18V13H84Z" />
          <path d="M99 54V4H109L169 40V4H179V54H169L109 18V54Z" />
          <path d="M200 4H266Q274 4 274 12V46Q274 54 266 54H200Q192 54 192 46V12Q192 4 200 4ZM205 14Q203 14 203 16V42Q203 44 205 44H261Q263 44 263 42V16Q263 14 261 14Z" />
          <path d="M296 4H362Q370 4 370 12V46Q370 54 362 54H296Q288 54 288 46V12Q288 4 296 4ZM301 14Q299 14 299 16V42Q299 44 301 44H357Q359 44 359 42V16Q359 14 357 14Z" />
          <path d="M384 54V4H458Q466 4 466 12V29Q466 37 458 37H394V54ZM394 14V27H453Q456 27 456 24V17Q456 14 453 14Z" />
        </g>
      </svg>
    </div>
  );
}
