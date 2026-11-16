import { createContext, useContext, useState, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import type { useAuth } from "@/hooks/useAuth";
import type { DictationPhase } from "@/hooks/useWhisperDictation";
import { VoiceAgent } from "./VoiceAgent";
import { DeepgramPilotVoice } from "./DeepgramPilotVoice";
import { deepgramPilotStatus } from "@/lib/deepgram-pilot.functions";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
const VoiceState = createContext<DictationPhase>("idle");
export const useVoicePhase = () => useContext(VoiceState);
/** Lives above the keyed route outlet. Never mounted on login/recovery/platform screens. */
export function VoiceSessionProvider({
  auth,
  children,
}: {
  auth: ReturnType<typeof useAuth>;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [pilot, setPilot] = useState(false);
  const checkPilot = useServerFn(deepgramPilotStatus);
  useEffect(() => {
    let live = true;
    setPilot(false);
    if (auth.user?.id && auth.access.role === "admin" && auth.access.status === "active") {
      checkPilot().then((r) => { if (live) setPilot(r.enabled === true); })
        .catch(() => { if (live) setPilot(false); });
    }
    return () => { live = false; };
  }, [auth.user?.id, auth.access.clubId, auth.access.role, auth.access.status, checkPilot]);
  const path = useLocation().pathname;
  const allowed =
    auth.user &&
    auth.access.status === "active" &&
    !auth.accessError &&
    auth.access.role !== "super_admin" &&
    !/^\/(?:login|reset-password|snoop-admin|club-status)(?:\/|$)/.test(path);
  return (
    <VoiceState.Provider value={allowed ? phase : "idle"}>
      {children}
      {allowed && pilot ? (
        <DeepgramPilotVoice onPhaseChange={setPhase} />
      ) : allowed && (
        <VoiceAgent
          userId={auth.user!.id}
          access={auth.access}
          clubName={auth.access.clubName}
          onPhaseChange={setPhase}
        />
      )}
    </VoiceState.Provider>
  );
}
