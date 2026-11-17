import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { clearClubCache } from "@/lib/club";

export type Permission =
  | "manage_members"
  | "manage_products"
  | "manage_collaborators"
  | "view_reports"
  | "use_cash";

export type Role = "super_admin" | "admin" | "collaborator" | null;

export interface UserAccess {
  role: Role;
  permissions: Permission[];
  clubId: string | null;
  clubName: string | null;
  clubLogo: string | null;
}

const ALL_PERMS: Permission[] = ["manage_members","manage_products","manage_collaborators","view_reports","use_cash"];

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState<UserAccess>({ role: null, permissions: [], clubId: null, clubName: null, clubLogo: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setTimeout(() => loadAccess(s.user.id), 0);
      } else {
        clearClubCache();
        setAccess({ role: null, permissions: [], clubId: null, clubName: null, clubLogo: null });
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

  async function loadAccess(uid: string) {
    const { data: rows } = await supabase
      .from("user_roles")
      .select("role, permissions, club_id")
      .eq("user_id", uid);

    if (!rows || rows.length === 0) {
      setAccess({ role: null, permissions: [], clubId: null, clubName: null, clubLogo: null });
      setLoading(false);
      return;
    }

    // pick highest role
    const order = { super_admin: 3, admin: 2, collaborator: 1 } as const;
    const best = [...rows].sort((a: any, b: any) => (order[b.role as keyof typeof order] ?? 0) - (order[a.role as keyof typeof order] ?? 0))[0] as any;
    // Find a club_id from a non-super_admin row (super_admin has no club)
    const clubRow = rows.find((r: any) => r.club_id) as any;
    const clubId: string | null = clubRow?.club_id ?? null;

    let clubName: string | null = null;
    let clubLogo: string | null = null;
    if (clubId) {
      const { data: club } = await supabase.from("clubs").select("name, logo_url").eq("id", clubId).maybeSingle();
      clubName = (club as any)?.name ?? null;
      clubLogo = (club as any)?.logo_url ?? null;
    }

    const role = best.role as Role;
    const perms: Permission[] = role === "super_admin" || role === "admin"
      ? ALL_PERMS
      : ((best.permissions ?? []) as Permission[]);

    setAccess({ role, permissions: perms, clubId, clubName, clubLogo });
    setLoading(false);
  }

  const can = (p: Permission) => access.permissions.includes(p);
  const isAdmin = access.role === "admin" || access.role === "super_admin";
  const isSuperAdmin = access.role === "super_admin";

  return { session, user, access, loading, can, isAdmin, isSuperAdmin };
}
