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
      <rect x="7" y="7" width="20" height="20" rx="4" stroke={`url(#${metal})`} strokeWidth="3.5"/>
      <rect x="37" y="7" width="20" height="20" rx="4" stroke={`url(#${metal})`} strokeWidth="3.5"/>
      <rect x="7" y="37" width="20" height="20" rx="4" stroke={`url(#${metal})`} strokeWidth="3.5"/>
      <path d="M13 13h8v8h-8zM43 13h8v8h-8zM13 43h8v8h-8z" fill={`url(#${metal})`}/>
      <path d="M39 38h6v6h-6zM50 39h7v6h-7zM38 50h7v7h-7zM51 50v7h7" stroke={`url(#${metal})`} strokeWidth="3" strokeLinejoin="round"/>
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
