import { createContext, useContext, useState, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import type { useAuth } from "@/hooks/useAuth";
import type { DictationPhase } from "@/hooks/useWhisperDictation";
import { VoiceAgent } from "./VoiceAgent";
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
      {allowed && (
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
