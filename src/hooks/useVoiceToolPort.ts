import { useEffect, useRef } from "react";
import { useAuth } from "./useAuth";
import { applicationPorts, voiceOwner, type VoicePort } from "@/lib/voice/application-ports";
/** Route-owned capabilities, not selectors or synthetic button clicks. */
export function useVoiceToolPort(name: string, handlers: VoicePort) {
  const { user, access, accessError } = useAuth();
  const latest = useRef(handlers);
  latest.current = handlers;
  const owner =
    user && access.clubId && access.status === "active" && !accessError
      ? voiceOwner(user.id, access.clubId)
      : null;
  useEffect(() => {
    if (!owner) return;
    const port: VoicePort = {
      snapshot: () => latest.current.snapshot?.() ?? {},
      patch: (value) => latest.current.patch?.(value),
      open: (target, query) => latest.current.open?.(target, query),
      search: (query) => latest.current.search?.(query),
    };
    return applicationPorts.register(owner, name, port);
  }, [owner, name]);
}
