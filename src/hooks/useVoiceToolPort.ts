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
      snapshot: () => {
        if (!latest.current.snapshot) throw Error("SNOOP_FORM_UNAVAILABLE");
        return latest.current.snapshot();
      },
      patch: (value) => {
        if (!latest.current.patch) throw Error("SNOOP_FORM_UNAVAILABLE");
        latest.current.patch(value);
      },
      open: (target, query) => {
        if (!latest.current.open) throw Error("SNOOP_FORM_UNAVAILABLE");
        latest.current.open(target, query);
      },
      search: (query) => {
        if (!latest.current.search) throw Error("SNOOP_FORM_UNAVAILABLE");
        latest.current.search(query);
      },
    };
    return applicationPorts.register(owner, name, port);
  }, [owner, name]);
}
