import { useVoicePhase } from "@/components/VoiceSession";
import { SnoopWordmark } from "@/components/SnoopWordmark";
import { useEffect, useState } from "react";

/**
 * Presentation only. JARVIS engine, microphone permissions and voice events are
 * owned exclusively by VoiceSessionProvider, never duplicated here.
 */
export function JarvisVisualOverlay() {
  const phase = useVoicePhase();
  const active = phase !== "idle";
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(active);
  }, [active]);
  if (!visible) return null;
  const text =
    phase === "recording" ? "Escuchando" :
    phase === "starting" ? "Conectando" :
    phase === "processing" ? "Procesando" :
    "Asistente activo";
  return (
    <div className="jarvis-voice-layer" data-voice-phase={phase} aria-live="polite" aria-atomic="true">
      <div className="jarvis-voice-stage" role="status">
        <div className="jarvis-ring jarvis-ring-outer" aria-hidden="true" />
        <div className="jarvis-ring jarvis-ring-middle" aria-hidden="true" />
        <div className="jarvis-ring jarvis-ring-inner" aria-hidden="true" />
        <div className="jarvis-core"><SnoopWordmark /></div>
        <div className="jarvis-wave" aria-hidden="true">
          {Array.from({length:11},(_,i)=><span key={i} style={{"--wave-index":i} as React.CSSProperties}/>)}
        </div>
        <div className="jarvis-phase"><span className="jarvis-status-dot" aria-hidden="true"/>{text}</div>
        <div className="jarvis-phase-caption">SNOOP · ASISTENTE INTELIGENTE</div>
      </div>
    </div>
  );
}
