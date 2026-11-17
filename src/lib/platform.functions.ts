import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PERMISSIONS = ["manage_members","manage_products","manage_collaborators","view_reports","use_cash"] as const;
type Perm = typeof PERMISSIONS[number];

function genPassword() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const b = "abcdefghijkmnpqrstuvwxyz";
  const d = "23456789";
  const all = a + b + d;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let p = pick(a) + pick(b) + pick(d) + pick(b);
  for (let i = 0; i < 8; i++) p += pick(all);
  return p + "-" + pick(d) + pick(d);
}

async function assertSuperAdmin(context: any) {
  const { data } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (!data) throw new Error("Forbidden: super admin only");
}

async function assertClubAdmin(context: any) {
  const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  const { data: isSuper } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (!isAdmin && !isSuper) throw new Error("Forbidden: admin only");
}

async function currentClubId(context: any): Promise<string> {
  const { data } = await context.supabase.rpc("current_club_id");
  if (!data) throw new Error("No tienes un club asignado");
  return data as string;
}

function loginUrl(req: Request) {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}/auth`;
}

async function findUserIdByEmail(admin: any, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data?.users?.find((u: any) => (u.email ?? "").toLowerCase() === target);
    if (found) return found.id;
    if (!data?.users || data.users.length < 200) return null;
  }
  return null;
}

async function upsertAuthUser(admin: any, opts: { email: string; full_name: string }): Promise<{ user_id: string; password: string; existed: boolean }> {
  const password = genPassword();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: opts.email, password, email_confirm: true, user_metadata: { full_name: opts.full_name },
  });
  if (!error && created?.user) return { user_id: created.user.id, password, existed: false };
  // If the email is already registered, reuse the existing account and reset password.
  const msg = (error?.message || "").toLowerCase();
  const isDuplicate = msg.includes("already") || msg.includes("registered") || msg.includes("exists") || (error as any)?.status === 422;
  if (!isDuplicate) throw error;
  const existingId = await findUserIdByEmail(admin, opts.email);
  if (!existingId) throw error;
  const { error: upErr } = await admin.auth.admin.updateUserById(existingId, {
    password, user_metadata: { full_name: opts.full_name },
  });
  if (upErr) throw upErr;
  return { user_id: existingId, password, existed: true };
}


async function sendWelcomeEmail(opts: {
  recipient: string;
  full_name: string;
  temporary_password: string;
  role_label: string;
  club_name: string;
  login_url: string;
}) {
  try {
    const React = await import("react");
    const { render } = await import("@react-email/render");
    const { TEMPLATES } = await import("@/lib/email-templates/registry");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const tpl = (TEMPLATES as any)["welcome-user"];
    if (!tpl) throw new Error("welcome-user template not registered");

    const recipient = opts.recipient.toLowerCase();
    const messageId = crypto.randomUUID();

    const { data: suppressed } = await supabaseAdmin
      .from("suppressed_emails").select("id").eq("email", recipient).maybeSingle();
    if (suppressed) {
      await supabaseAdmin.from("email_send_log").insert({
        message_id: messageId, template_name: "welcome-user", recipient_email: recipient, status: "suppressed",
      });
      return;
    }

    let token: string;
    const { data: existing } = await supabaseAdmin
      .from("email_unsubscribe_tokens").select("token, used_at").eq("email", recipient).maybeSingle();
    if (existing && !(existing as any).used_at) {
      token = (existing as any).token;
    } else {
      const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
      token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      await supabaseAdmin.from("email_unsubscribe_tokens")
        .upsert({ token, email: recipient }, { onConflict: "email", ignoreDuplicates: true });
      const { data: stored } = await supabaseAdmin
        .from("email_unsubscribe_tokens").select("token").eq("email", recipient).maybeSingle();
      if ((stored as any)?.token) token = (stored as any).token;
    }

    const element = React.createElement(tpl.component as any, {
      full_name: opts.full_name,
      email: opts.recipient,
      temporary_password: opts.temporary_password,
      role_label: opts.role_label,
      club_name: opts.club_name,
      login_url: opts.login_url,
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });
    const subject = typeof tpl.subject === "function"
      ? tpl.subject({ club_name: opts.club_name })
      : tpl.subject;

    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId, template_name: "welcome-user", recipient_email: recipient, status: "pending",
    });

    const SENDER_DOMAIN = "notify.meduzamallorca.com";
    const { error: enqErr } = await supabaseAdmin.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload: {
        message_id: messageId,
        to: opts.recipient,
        from: `Snoop <noreply@${SENDER_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject,
        html, text,
        purpose: "transactional",
        label: "welcome-user",
        idempotency_key: `welcome-${recipient}-${Date.now()}`,
        unsubscribe_token: token,
        queued_at: new Date().toISOString(),
      },
    });
    if (enqErr) {
      await supabaseAdmin.from("email_send_log").insert({
        message_id: messageId, template_name: "welcome-user", recipient_email: recipient,
        status: "failed", error_message: enqErr.message,
      });
    }
  } catch (err: any) {
    console.error("Welcome email error (non-fatal):", err?.message || err);
  }
}

// ─── Super-admin: clubs ───────────────────────────────────────────

export const listClubs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context);
    const { data, error } = await context.supabase.from("clubs").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  });

export const createClub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; slug: string; city?: string; logo_url?: string }) =>
    z.object({
      name: z.string().min(2).max(80),
      slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
      city: z.string().max(80).optional(),
      logo_url: z.string().url().optional(),
    }).parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: club, error } = await supabaseAdmin.from("clubs").insert({
      name: data.name, slug: data.slug, city: data.city ?? null, logo_url: data.logo_url ?? null,
    }).select("*").single();
    if (error) throw error;
    return club;
  });

export const createClubAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { club_id: string; email: string; full_name: string }) =>
    z.object({
      club_id: z.string().uuid(),
      email: z.string().email(),
      full_name: z.string().min(2).max(120),
    }).parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: club, error: cErr } = await supabaseAdmin.from("clubs").select("name").eq("id", data.club_id).single();
    if (cErr) throw cErr;

    const { user_id: userId, password } = await upsertAuthUser(supabaseAdmin, { email: data.email, full_name: data.full_name });

    // Upsert role (idempotent if user already had it for this club)
    const { error: rErr } = await supabaseAdmin.from("user_roles").upsert({
      user_id: userId, role: "admin", club_id: data.club_id,
      permissions: ["manage_members","manage_products","manage_collaborators","view_reports","use_cash"],
    }, { onConflict: "user_id,role" });
    if (rErr) throw rErr;

    const req = (await import("@tanstack/react-start/server")).getRequest();
    await sendWelcomeEmail({
      recipient: data.email, full_name: data.full_name, temporary_password: password,
      role_label: "administrador", club_name: club.name, login_url: loginUrl(req),
    });

    return { user_id: userId, email: data.email };
  });

// ─── Admin: collaborators ─────────────────────────────────────────

export const listCollaborators = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertClubAdmin(context);
    const clubId = await currentClubId(context);
    const { data: roles, error } = await context.supabase
      .from("user_roles")
      .select("id, user_id, role, permissions")
      .eq("club_id", clubId)
      .neq("role", "super_admin");
    if (error) throw error;
    if (!roles?.length) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = roles.map((r: any) => r.user_id);
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", ids);
    const profMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));

    // emails via admin
    const list = await Promise.all(roles.map(async (r: any) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
      return { ...r, full_name: profMap.get(r.user_id) ?? null, email: data?.user?.email ?? null };
    }));
    return list;
  });

export const createCollaborator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string; full_name: string; permissions: Perm[] }) =>
    z.object({
      email: z.string().email(),
      full_name: z.string().min(2).max(120),
      permissions: z.array(z.enum(PERMISSIONS)).min(1),
    }).parse(input))
  .handler(async ({ data, context }) => {
    await assertClubAdmin(context);
    const clubId = await currentClubId(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: club } = await supabaseAdmin.from("clubs").select("name").eq("id", clubId).single();
    const { user_id: userId, password } = await upsertAuthUser(supabaseAdmin, { email: data.email, full_name: data.full_name });

    const { error: rErr } = await supabaseAdmin.from("user_roles").upsert({
      user_id: userId, role: "collaborator", club_id: clubId, permissions: data.permissions,
    }, { onConflict: "user_id,role" });
    if (rErr) throw rErr;

    const req = (await import("@tanstack/react-start/server")).getRequest();
    await sendWelcomeEmail({
      recipient: data.email, full_name: data.full_name, temporary_password: password,
      role_label: "colaborador", club_name: club?.name ?? "", login_url: loginUrl(req),
    });

    return { user_id: userId, email: data.email };
  });

export const updateCollaboratorPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { role_id: string; permissions: Perm[] }) =>
    z.object({ role_id: z.string().uuid(), permissions: z.array(z.enum(PERMISSIONS)) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertClubAdmin(context);
    const clubId = await currentClubId(context);
    const { error } = await context.supabase
      .from("user_roles")
      .update({ permissions: data.permissions })
      .eq("id", data.role_id)
      .eq("club_id", clubId)
      .eq("role", "collaborator");
    if (error) throw error;
    return { ok: true };
  });

export const setCollaboratorPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { role_id: string; password: string }) =>
    z.object({
      role_id: z.string().uuid(),
      password: z.string().min(8).max(72),
    }).parse(input))
  .handler(async ({ data, context }) => {
    await assertClubAdmin(context);
    const clubId = await currentClubId(context);
    const { data: role, error: roleError } = await context.supabase
      .from("user_roles")
      .select("user_id")
      .eq("id", data.role_id)
      .eq("club_id", clubId)
      .maybeSingle();
    if (roleError) throw roleError;
    if (!role) throw new Error("Cuenta no encontrada");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(role.user_id, {
      password: data.password,
    });
    if (error) throw error;
    return { ok: true };
  });

export const deleteCollaborator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { role_id: string }) => z.object({ role_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertClubAdmin(context);
    const clubId = await currentClubId(context);
    const { data: row, error: fErr } = await context.supabase
      .from("user_roles").select("user_id").eq("id", data.role_id).eq("club_id", clubId).eq("role","collaborator").maybeSingle();
    if (fErr) throw fErr;
    if (!row) throw new Error("Colaborador no encontrado");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_roles").delete().eq("id", data.role_id);
    await supabaseAdmin.auth.admin.deleteUser(row.user_id);
    return { ok: true };
  });
