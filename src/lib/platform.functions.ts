import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PERMISSIONS = [
  "manage_members",
  "manage_products",
  "manage_collaborators",
  "view_reports",
  "use_cash",
] as const;
type Perm = (typeof PERMISSIONS)[number];

// ─── Super-admin: clubs ───────────────────────────────────────────

export const listClubs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertSuperAdmin } = await import("./account-access.server");
    await assertSuperAdmin(context);
    const { data, error } = await context.supabase
      .from("clubs")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  });

export const createClub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; slug: string; city?: string; logo_url?: string }) =>
    z
      .object({
        name: z.string().min(2).max(80),
        slug: z
          .string()
          .min(2)
          .max(40)
          .regex(/^[a-z0-9-]+$/),
        city: z.string().max(80).optional(),
        logo_url: z.string().url().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertSuperAdmin } = await import("./account-access.server");
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: club, error } = await supabaseAdmin
      .from("clubs")
      .insert({
        name: data.name,
        slug: data.slug,
        city: data.city ?? null,
        logo_url: data.logo_url ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return club;
  });

export const createClubAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { club_id: string; email: string; full_name: string }) =>
    z
      .object({
        club_id: z.string().uuid(),
        email: z.string().email(),
        full_name: z.string().min(2).max(120),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertSuperAdmin } = await import("./account-access.server");
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: cErr } = await supabaseAdmin
      .from("clubs")
      .select("name")
      .eq("id", data.club_id)
      .single();
    if (cErr) throw cErr;

    const { resolveInvitedAccount, addClubRole } = await import("./account-access.server");
    const { userId, invited, invitationUrl } = await resolveInvitedAccount(supabaseAdmin, data);

    await addClubRole(supabaseAdmin, {
      user_id: userId,
      role: "admin",
      club_id: data.club_id,
      permissions: [
        "manage_members",
        "manage_products",
        "manage_collaborators",
        "view_reports",
        "use_cash",
      ],
    });

    return { user_id: userId, email: data.email, invited, invitation_url: invitationUrl };
  });

// ─── Admin: collaborators ─────────────────────────────────────────

export const listCollaborators = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireClubAdmin } = await import("./account-access.server");
    const clubId = await requireClubAdmin(context);
    const { data: roles, error } = await context.supabase
      .from("user_roles")
      .select("id, user_id, role, permissions")
      .eq("club_id", clubId)
      .neq("role", "super_admin");
    if (error) throw error;
    if (!roles?.length) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = roles.map((r) => r.user_id);
    const { data: profs, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);
    if (profileError) throw profileError;
    const profMap = new Map((profs ?? []).map((p) => [p.id, p.full_name]));

    // emails via admin
    const list = await Promise.all(
      roles.map(async (r) => {
        const { data, error: userError } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
        if (userError) throw userError;
        return {
          ...r,
          full_name: profMap.get(r.user_id) ?? null,
          email: data?.user?.email ?? null,
        };
      }),
    );
    return list;
  });

export const createCollaborator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string; full_name: string; permissions: Perm[] }) =>
    z
      .object({
        email: z.string().email(),
        full_name: z.string().min(2).max(120),
        permissions: z.array(z.enum(PERMISSIONS)).min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireClubAdmin } = await import("./account-access.server");
    const clubId = await requireClubAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { resolveInvitedAccount, addClubRole } = await import("./account-access.server");
    const { userId, invited, invitationUrl } = await resolveInvitedAccount(supabaseAdmin, data);

    await addClubRole(supabaseAdmin, {
      user_id: userId,
      role: "collaborator",
      club_id: clubId,
      permissions: data.permissions,
    });

    return { user_id: userId, email: data.email, invited, invitation_url: invitationUrl };
  });

export const updateCollaboratorPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { role_id: string; permissions: Perm[] }) =>
    z
      .object({ role_id: z.string().uuid(), permissions: z.array(z.enum(PERMISSIONS)) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireClubAdmin } = await import("./account-access.server");
    const clubId = await requireClubAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { updateClubPermissions } = await import("./account-access.server");
    await updateClubPermissions(supabaseAdmin, clubId, data.role_id, data.permissions);
    return { ok: true };
  });

export const requestCollaboratorPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { role_id: string }) =>
    z.object({ role_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireClubAdmin, requestClubPasswordReset } = await import("./account-access.server");
    const clubId = await requireClubAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await requestClubPasswordReset(supabaseAdmin, clubId, data.role_id);
    return { ok: true, recovery_url: result?.recoveryUrl };
  });

export const deleteCollaborator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { role_id: string }) =>
    z.object({ role_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireClubAdmin } = await import("./account-access.server");
    const clubId = await requireClubAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { revokeClubCollaborator } = await import("./account-access.server");
    await revokeClubCollaborator(supabaseAdmin, clubId, data.role_id);
    return { ok: true };
  });
