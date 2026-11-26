import { useId } from "react";

type Kind = "wallet" | "socios" | "pedidos" | "productos" | "stock" | "actividad" | "caja";

/**
 * Gold sculpted pictograms drawn as actual SVG, not emoji or icon-font glyphs.
 * They keep the same view box and optical weight as the approved home mockup.
 */
export function SnoopGoldIcon({ kind, className = "" }: { kind: Kind; className?: string }) {
  const id = useId().replace(/:/g, "");
  const g = id + "-metal";
  const light = id + "-shine";
  const stroke = { stroke: `url(#${g})`, strokeWidth: 2.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const metal = {fill:`url(#${g})`,stroke:"#8a5012",strokeWidth:.5,strokeLinejoin:"round" as const};
  return (
    <svg viewBox="0 0 64 64" className={`snoop-gold-icon ${className}`} fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2=".85" y2="1">
          <stop offset="0" stopColor="#fff8d5"/>
          <stop offset=".25" stopColor="#ffdb80"/>
          <stop offset=".51" stopColor="#f6a829"/>
          <stop offset=".79" stopColor="#b66e0b"/>
          <stop offset="1" stopColor="#ffeaae"/>
        </linearGradient>
        <linearGradient id={light} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#f6d27b" stopOpacity=".36"/>
          <stop offset="1" stopColor="#5d2e03" stopOpacity=".09"/>
        </linearGradient>
      </defs>
      {kind==="wallet"&&<>
        <path d="M12 19V14c0-4 3-7 7-7h27v12" {...stroke}/>
        <path d="M13 18h36c4 0 7 3 7 7v25c0 4-3 6-7 6H15c-5 0-8-3-8-8V25c0-4 2-7 6-7Z" fill={`url(#${light})`} {...stroke}/>
        <path d="M56 31H40c-6 0-9 3-9 8s3 8 9 8h16" {...stroke}/>
        <circle cx="43" cy="39" r="3" {...metal}/>
        <path d="M13 15h31M13 24h17" stroke="#fff6d6" strokeWidth="1.2" strokeOpacity=".8"/>
      </>}
      {kind==="socios"&&<>
        <circle cx="32" cy="19" r="8.5" fill={`url(#${light})`} {...stroke}/>
        <path d="M15 52v-7c0-9 8-14 17-14s17 5 17 14v7" {...stroke}/>
        <circle cx="10" cy="27" r="5" fill={`url(#${light})`} {...stroke}/>
        <circle cx="54" cy="27" r="5" fill={`url(#${light})`} {...stroke}/>
        <path d="M3 50v-6c0-5 3-9 9-10M61 50v-6c0-5-3-9-9-10" {...stroke}/>
        <path d="M24 40c5-5 11-5 16 0" stroke="#fff2c7" strokeWidth="1.1" opacity=".7"/>
      </>}
      {kind==="pedidos"&&<>
        <path d="M7 10h8l6 31h30l6-23H18" {...stroke}/>
        <path d="M23 22h29l-4 15H25Z" fill={`url(#${light})`} stroke="none"/>
        <path d="M25 27h25M27 33h21" stroke="#ffe8a3" strokeWidth="1.1" opacity=".55"/>
        <circle cx="27" cy="52" r="4" {...metal}/>
        <circle cx="47" cy="52" r="4" {...metal}/>
      </>}
      {kind==="productos"&&<>
        <path d="m32 4 13 7.5v15L32 34l-13-7.5v-15L32 4Z" fill={`url(#${light})`} {...stroke}/>
        <path d="m19 12 13 8 13-8M32 20v14" {...stroke}/>
        <path d="m17 29 13 7.5v15L17 59 4 51.5v-15L17 29Z" fill={`url(#${light})`} {...stroke}/>
        <path d="m4 37 13 8 13-8M17 45v14" {...stroke}/>
        <path d="m47 29 13 7.5v15L47 59l-13-7.5v-15L47 29Z" fill={`url(#${light})`} {...stroke}/>
        <path d="m34 37 13 8 13-8M47 45v14" {...stroke}/>
      </>}
      {kind==="stock"&&<>
        <path d="m32 6 25 13-25 13L7 19 32 6Z" fill={`url(#${light})`} {...stroke}/>
        <path d="m7 32 25 13 25-13M7 44l25 13 25-13" {...stroke}/>
        <path d="m13 19 19 10 19-10" stroke="#fff4cb" strokeWidth="1.2" opacity=".7"/>
      </>}
      {kind==="actividad"&&<>
        <path d="M3 34h13l8-17 9 32 8-21 5 6h15" {...stroke}/>
        <path d="M24 17 33 49" stroke="#fff7cb" strokeWidth="1.1" opacity=".85"/>
      </>}
      {kind==="caja"&&<>
        <path d="M12 12h40v40H12z" rx="3" fill={`url(#${light})`} {...stroke}/>
        <path d="M12 24h40M19 9v6M45 9v6" {...stroke}/>
        <path d="M23 32h19M23 40h12" stroke="#ffe4a0" strokeWidth="2" strokeLinecap="round"/>
      </>}
    </svg>
  );
}
