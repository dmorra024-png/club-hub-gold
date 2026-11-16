import { createContext, useContext, useState, useRef, useEffect, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import type { useAuth } from "@/hooks/useAuth";
import type { DictationPhase } from "@/hooks/useWhisperDictation";
import { VoiceAgent } from "./VoiceAgent";
import { DeepgramPilotVoice } from "./DeepgramPilotVoice";
import { deepgramPilotStatus } from "@/lib/deepgram-pilot.functions";
import { useServerFn } from "@tanstack/react-start";
const VoiceState = createContext<DictationPhase>("idle");
export const useVoicePhase = () => useContext(VoiceState);
/** One engine above the route outlet. Provider identity is always verified by the server. */
export function VoiceSessionProvider({
  auth,
  children,
}: {
  auth: ReturnType<typeof useAuth>;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [selection, setSelection] = useState<"checking" | "legacy" | "deepgram" | "error">(
    "checking",
  );
  const [notice, setNotice] = useState(false);
  const [retry, setRetry] = useState(0);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const queued = useRef(false);
  const check = useServerFn(deepgramPilotStatus);
  const checkRef = useRef(check);
  checkRef.current = check;
  const scope = JSON.stringify([
    auth.user?.id,
    auth.access.clubId,
    auth.access.role,
    auth.access.status,
    [...auth.access.permissions].sort(),
  ]);
  const ownerScope = useRef(scope);
  useEffect(() => {
    let live = true;
    if (ownerScope.current !== scope) {
      queued.current = false;
      ownerScope.current = scope;
    }
    setNotice(false);
    setPhase("idle");
    if (auth.user?.id && auth.access.role === "admin" && auth.access.status === "active") {
      setSelection("checking");
      checkRef
        .current()
        .then((r) => {
          if (live) setSelection(r.unavailable ? "error" : r.enabled ? "deepgram" : "legacy");
        })
        .catch(() => {
          if (live) setSelection("error");
        });
    } else setSelection("legacy");
    return () => {
      live = false;
    };
  }, [scope, retry]);
  useEffect(() => {
    const toggle = () => {
      if (selectionRef.current === "checking") queued.current = true;
      if (selectionRef.current === "error") setNotice((v) => !v);
    };
    window.addEventListener("snoop:voice-toggle", toggle);
    return () => window.removeEventListener("snoop:voice-toggle", toggle);
  }, []);
  useEffect(() => {
    if (selection === "checking" || !queued.current) return;
    queued.current = false;
    if (selection === "error") {
      setNotice(true);
      return;
    }
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => window.dispatchEvent(new Event("snoop:voice-toggle"))),
    );
    return () => cancelAnimationFrame(id);
  }, [selection]);
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
      {allowed && selection === "deepgram" ? (
        <DeepgramPilotVoice key={scope} access={auth.access} onPhaseChange={setPhase} />
      ) : allowed && selection === "legacy" ? (
        <VoiceAgent
          userId={auth.user!.id}
          access={auth.access}
          clubName={auth.access.clubName}
          onPhaseChange={setPhase}
        />
      ) : null}
      {allowed && selection === "error" && notice && (
        <div
          role="alert"
          className="fixed bottom-24 left-4 right-4 z-50 rounded-xl border border-border bg-card p-4 text-sm"
        >
          No se pudo verificar el asistente. Tus formularios siguen disponibles.{" "}
          <button
            onClick={() => {
              queued.current = true;
              setRetry((v) => v + 1);
            }}
          >
            Reintentar
          </button>
        </div>
      )}
    </VoiceState.Provider>
  );
}
