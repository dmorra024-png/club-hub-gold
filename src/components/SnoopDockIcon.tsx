import { useId } from "react";

export type SnoopDockIconKind = "home" | "qr" | "profile" | "jarvis";

/**
 * One coherent optical grid for all four navigation icons.
 * The active theme provides gold / electric accents; geometry is fixed.
 * Kept as SVG paths so appearance is independent of platform emoji/fonts.
 */
export function SnoopDockIcon({kind}:{kind:SnoopDockIconKind}){
  const id=useId().replace(/:/g,"");
  const metal=`${id}-snoop-dock-metal`;
  const inner=`${id}-snoop-dock-inset`;
  return <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false" className="snoop-dock-icon">
    <defs>
      <linearGradient id={metal} x1="0" x2=".8" y1="0" y2="1">
        <stop stopColor="#fff8d9"/>
        <stop offset=".31" stopColor="#fbd382"/>
        <stop offset=".56" stopColor="#c98832"/>
        <stop offset=".86" stopColor="#f1be69"/>
        <stop offset="1" stopColor="#fff6ce"/>
      </linearGradient>
      <linearGradient id={inner} x1="0" y1="0" x2=".8" y2="1">
        <stop stopColor="#f4c578" stopOpacity=".33"/>
        <stop offset="1" stopColor="#cc7715" stopOpacity=".05"/>
      </linearGradient>
    </defs>
    {kind==="home" && <>
      <path d="M8 31.5 32 10 56 31.5v23a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3Z" fill={`url(#${inner})`}/>
      <path d="M5 30 32 7l27 23M11 26v29h15V39h12v16h15V26" stroke={`url(#${metal})`} strokeWidth="3.8" strokeLinejoin="round" strokeLinecap="round"/>
      <path d="M17 21 32 9l15 12" stroke="#fff8d6" strokeWidth="1.1" opacity=".65"/>
    </>}
    {kind==="qr" && <>
      {/* Minimal scan-frame icon: generous white space, three clean QR markers. */}
      <g stroke={`url(#${metal})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 7H12a5 5 0 0 0-5 5v9M43 7h9a5 5 0 0 1 5 5v9M7 43v9a5 5 0 0 0 5 5h9M57 43v9a5 5 0 0 1-5 5h-9" strokeWidth="3.4"/>
        <rect x="17" y="17" width="13" height="13" rx="1.5" strokeWidth="2.8"/>
        <rect x="34" y="17" width="13" height="13" rx="1.5" strokeWidth="2.8"/>
        <rect x="17" y="34" width="13" height="13" rx="1.5" strokeWidth="2.8"/>
      </g>
      <g fill={`url(#${metal})`}>
        <rect x="21" y="21" width="5" height="5" rx=".8"/>
        <rect x="38" y="21" width="5" height="5" rx=".8"/>
        <rect x="21" y="38" width="5" height="5" rx=".8"/>
        <rect x="35" y="35" width="5" height="5" rx=".6"/>
        <rect x="43" y="35" width="5" height="5" rx=".6"/>
        <rect x="35" y="43" width="5" height="5" rx=".6"/>
      </g>
    </>}
    {kind==="profile" && <>
      <circle cx="32" cy="20" r="11" fill={`url(#${inner})`} stroke={`url(#${metal})`} strokeWidth="3.8"/>
      <path d="M9 56v-7c0-12 9-19 23-19s23 7 23 19v7" fill={`url(#${inner})`} stroke={`url(#${metal})`} strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M24 12c5-4 11-4 16 0" stroke="#fff4ca" strokeWidth="1.2" opacity=".65"/>
    </>}
    {kind==="jarvis" && <>
      <path d="M11 27v10M18 17v30M25 9v46M32 20v24M39 9v46M46 17v30M53 27v10" stroke={`url(#${metal})`} strokeWidth="4.1" strokeLinecap="round"/>
      <path d="M25 13v14M39 13v14" stroke="#fff9dd" strokeWidth="1.2" opacity=".7"/>
    </>}
  </svg>;
}
