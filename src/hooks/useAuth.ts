import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { clearClubCache } from "@/lib/club";

import {
  EMPTY_ACCESS,
  parseAccountAccess,
  type AccountAccess,
  type Permission,
} from "@/lib/access-context";
export type { Permission } from "@/lib/access-context";
export type Role = AccountAccess["role"];
export type UserAccess = AccountAccess;

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState<UserAccess>({ ...EMPTY_ACCESS });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setTimeout(() => loadAccess(s.user.id), 0);
      } else {
        clearClubCache();
        setAccess({ ...EMPTY_ACCESS });
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) loadAccess(data.session.user.id);
      else setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadAccess(_uid: string) {
    const { data, error } = await supabase.rpc("snoop_access_context");
    setAccess(error ? { ...EMPTY_ACCESS } : parseAccountAccess(data));
    setLoading(false);
  }
  useEffect(() => {
    if (!user?.id) return;
    const refresh = () => {
      void loadAccess(user.id);
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [user?.id]);

  const can = (p: Permission) => access.permissions.includes(p);
  const isAdmin = access.role === "admin" && access.status === "active";
  const isSuperAdmin = access.role === "super_admin";

  return { session, user, access, loading, can, isAdmin, isSuperAdmin };
}
