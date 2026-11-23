/** Purely decorative reference-inspired arcs. Real panels and data remain DOM elements. */
export function SnoopReferenceWaves() {
  return (
    <div className="snoop-reference-waves" aria-hidden="true">
      <svg className="snoop-reference-waves-top" viewBox="0 0 1086 360" preserveAspectRatio="none">
        <defs>
          <linearGradient id="snoop-reference-gold" x1="0" y1="0" x2="1" y2=".7">
            <stop stopColor="#ffc353" stopOpacity="0"/><stop offset=".23" stopColor="#ffad12"/><stop offset=".47" stopColor="#fff7bd"/><stop offset=".7" stopColor="#e99819"/><stop offset="1" stopColor="#ffd576" stopOpacity="0"/>
          </linearGradient>
          <linearGradient id="snoop-reference-blue" x1="0" y1=".8" x2="1" y2="0">
            <stop stopColor="#0070f7" stopOpacity=".0"/><stop offset=".3" stopColor="#00afff"/><stop offset=".6" stopColor="#24d9ff"/><stop offset="1" stopColor="#0261f1" stopOpacity=".0"/>
          </linearGradient>
          <filter id="snoop-reference-blur"><feGaussianBlur stdDeviation="7"/></filter>
        </defs>
        <path d="M-70 225 C 25 228, 116 70, 225 -35" stroke="url(#snoop-reference-gold)" strokeWidth="18" filter="url(#snoop-reference-blur)" fill="none"/>
        <path d="M-70 225 C 25 228, 116 70, 225 -35" stroke="url(#snoop-reference-gold)" strokeWidth="3" fill="none"/>
        <path d="M340 18 C 560 -48, 750 20, 1000 86" stroke="url(#snoop-reference-blue)" strokeWidth="15" filter="url(#snoop-reference-blur)" fill="none"/>
        <path d="M340 18 C 560 -48, 750 20, 1000 86" stroke="url(#snoop-reference-blue)" strokeWidth="2.5" fill="none"/>
        <path d="M970 255 C 1020 210, 1040 154, 1130 124" stroke="url(#snoop-reference-blue)" strokeWidth="14" filter="url(#snoop-reference-blur)" fill="none"/>
        <path d="M970 255 C 1020 210, 1040 154, 1130 124" stroke="url(#snoop-reference-blue)" strokeWidth="2.8" fill="none"/>
      </svg>
      <svg className="snoop-reference-waves-bottom" viewBox="0 0 1086 360" preserveAspectRatio="none">
        <defs>
          <linearGradient id="snoop-reference-lowgold" x1="0" y1="0" x2="1" y2=".5">
            <stop stopColor="#ffad06" stopOpacity=".03"/><stop offset=".2" stopColor="#fff5aa"/><stop offset=".45" stopColor="#ff9c05"/><stop offset=".73" stopColor="#fff9cd"/><stop offset="1" stopColor="#bd671a" stopOpacity=".02"/>
          </linearGradient>
          <linearGradient id="snoop-reference-lowblue" x1="0" y1=".6" x2="1" y2="0">
            <stop stopColor="#0063eb" stopOpacity=".08"/><stop offset=".25" stopColor="#00bbff"/><stop offset=".6" stopColor="#13daff"/><stop offset="1" stopColor="#0061ef" stopOpacity=".08"/>
          </linearGradient>
          <filter id="snoop-reference-lowblur"><feGaussianBlur stdDeviation="10"/></filter>
        </defs>
        <path d="M-70 285 C 160 72 345 175 525 155 S 775 90 1150 225" stroke="url(#snoop-reference-lowgold)" strokeWidth="25" filter="url(#snoop-reference-lowblur)" fill="none"/>
        <path d="M-70 285 C 160 72 345 175 525 155 S 775 90 1150 225" stroke="url(#snoop-reference-lowgold)" strokeWidth="3" fill="none"/>
        <path d="M-70 305 C 170 116 335 205 525 165 S 755 65 1150 205" stroke="url(#snoop-reference-lowblue)" strokeWidth="25" filter="url(#snoop-reference-lowblur)" fill="none"/>
        <path d="M-70 305 C 170 116 335 205 525 165 S 755 65 1150 205" stroke="url(#snoop-reference-lowblue)" strokeWidth="3" fill="none"/>
      </svg>
    </div>
  );
}
