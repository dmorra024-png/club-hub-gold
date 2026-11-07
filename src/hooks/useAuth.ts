import { useCallback, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { clearClubCache } from "@/lib/club";
import { authDeadline, verifiedAccess } from "@/lib/auth-access";
import { forgetRoute } from "@/lib/resume-route";
import { EMPTY_ACCESS, type AccountAccess, type Permission } from "@/lib/access-context";
export type { Permission } from "@/lib/access-context";
export type Role = AccountAccess["role"];
export type UserAccess = AccountAccess;
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null),
    [user, setUser] = useState<User | null>(null),
    [access, setAccess] = useState<UserAccess>({ ...EMPTY_ACCESS }),
    [loading, setLoading] = useState(true),
    [accessError, setAccessError] = useState<string | null>(null);
  const verifiedClub = useRef<string | null>(null);
  const mounted = useRef(false),
    identity = useRef<string | null>(null),
    sequence = useRef(0),
    events = useRef(0);
  const loadAccess = useCallback(async (uid: string) => {
    const version = ++sequence.current;
    setLoading(true);
    setAccessError(null);
    try {
      const value = await verifiedAccess(uid);
      if (mounted.current && identity.current === uid && sequence.current === version) {
        if (
          (verifiedClub.current !== null && verifiedClub.current !== value.clubId) ||
          value.status !== "active"
        )
          clearClubCache();
        verifiedClub.current = value.clubId;
        setAccess(value);
      }
    } catch {
      if (mounted.current && identity.current === uid && sequence.current === version) {
        setAccess({ ...EMPTY_ACCESS });
        setAccessError("No se pudo verificar el acceso. Comprueba la conexión y reintenta.");
      }
    } finally {
      if (mounted.current && identity.current === uid && sequence.current === version)
        setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const accept = (s: Session | null) => {
      if (!mounted.current) return;
      const uid = s?.user.id ?? null;
      if (identity.current !== uid) {
        sequence.current++;
        clearClubCache();
        setAccess({ ...EMPTY_ACCESS });
      }
      identity.current = uid;
      setSession(s);
      setUser(s?.user ?? null);
      if (uid) {
        setLoading(true);
        setTimeout(() => {
          if (mounted.current && identity.current === uid) void loadAccess(uid);
        }, 0);
      } else {
        sequence.current++;
        setAccess({ ...EMPTY_ACCESS });
        setAccessError(null);
        setLoading(false);
      }
    };
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      events.current++;
      if (event === "SIGNED_OUT") {
        forgetRoute();
        try {
          for (const store of [window.sessionStorage, window.localStorage])
            for (const key of [
              "snoop:member-draft",
              "snoop:new-member-transcript",
              "snoop:member-search-pending",
              "snoop:productos-cmd",
              "snoop:productos-pending",
            ])
              store.removeItem(key);
        } catch {}
      }
      accept(s);
    });
    const generation = events.current;
    authDeadline(supabase.auth.getSession())
      .then(({ data, error }) => {
        if (error) throw error;
        if (events.current === generation) accept(data.session);
      })
      .catch(() => {
        if (mounted.current && events.current === generation) {
          setAccessError("No se pudo recuperar la sesión. Reintenta.");
          setLoading(false);
        }
      });
    return () => {
      mounted.current = false;
      sequence.current++;
      sub.subscription.unsubscribe();
    };
  }, [loadAccess]);
  useEffect(() => {
    if (!user?.id) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadAccess(user.id);
    };
    const interval = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("snoop:retry-access", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("snoop:retry-access", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user?.id, loadAccess]);
  const can = (p: Permission) => !loading && !accessError && access.permissions.includes(p);
  return {
    session,
    user,
    access,
    loading,
    accessError,
    retryAccess: async () => {
      window.dispatchEvent(new Event("snoop:retry-access"));
    },
    can,
    isAdmin: access.role === "admin" && access.status === "active",
    isSuperAdmin: access.role === "super_admin",
  };
}
