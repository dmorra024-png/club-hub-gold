import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  accountRedirectUrl,
  addClubRole,
  assertSuperAdmin,
  findUserByEmail,
  requireClubAdmin,
  requestClubPasswordReset,
  resolveInvitedAccount,
  revokeClubCollaborator,
  updateClubPermissions,
} from "../src/lib/account-access.server.ts";

const initialAppUrl = process.env.APP_URL;
afterEach(() => {
  if (initialAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = initialAppUrl;
});

type Row = { id: string; user_id: string; club_id: string; role: string; permissions?: string[] };
type User = { id: string; email: string };
function fixture(
  options: {
    rows?: Row[];
    users?: User[];
    currentClub?: string | null;
    superAdmin?: boolean;
    operational?: boolean;
    rpcError?: Error;
    queryError?: { code?: string; message: string };
    authError?: Error;
    inviteError?: Error;
    resetError?: Error;
  } = {},
) {
  const rows = structuredClone(options.rows ?? []);
  const users = structuredClone(options.users ?? []);
  const calls: { method: string; args: unknown[] }[] = [];
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args });
  const client = {
    rpc: async (name: string) => ({
      data:
        name === "current_club_id"
          ? options.currentClub
          : name === "can_operate_club"
            ? options.operational !== false
            : (options.superAdmin ?? false),
      error: options.rpcError ?? null,
    }),
    from(table: string) {
      assert.equal(table, "user_roles");
      let action = "select";
      let payload: Record<string, unknown> = {};
      const filters: Record<string, unknown> = {};
      const execute = () => {
        record(action, { ...filters }, payload);
        if (options.queryError) return { data: null, error: options.queryError };
        if (action === "insert") {
          const duplicate = rows.some(
            (r) => r.user_id === payload.user_id && r.role === payload.role,
          );
          if (duplicate) return { data: null, error: { code: "23505" } };
          rows.push({ ...payload, id: "new-role" } as Row);
          return { data: null, error: null };
        }
        const matched = rows.filter((r) =>
          Object.entries(filters).every(([k, v]) => r[k as keyof Row] === v),
        );
        if (action === "delete") for (const row of matched) rows.splice(rows.indexOf(row), 1);
        if (action === "update") for (const row of matched) Object.assign(row, payload);
        return { data: matched[0] ?? null, error: null };
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return query;
        },
        delete: () => {
          action = "delete";
          return query;
        },
        update: (value: Record<string, unknown>) => {
          action = "update";
          payload = value;
          return query;
        },
        insert: async (value: Record<string, unknown>) => {
          action = "insert";
          payload = value;
          return execute();
        },
        maybeSingle: async () => execute(),
      };
      return query;
    },
    auth: {
      admin: {
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
          record("listUsers", page);
          return {
            data: { users: users.slice((page - 1) * perPage, page * perPage) },
            error: options.authError ?? null,
          };
        },
        inviteUserByEmail: async (email: string, input: unknown) => {
          record("invite", email, input);
          return { data: { user: { id: "invited", email } }, error: options.inviteError ?? null };
        },
        getUserById: async (id: string) => {
          record("getUser", id);
          return {
            data: { user: users.find((u) => u.id === id) },
            error: options.authError ?? null,
          };
        },
        // Fail immediately if any regression tries to modify global credentials/identity.
        updateUserById: () => assert.fail("must not reset global password"),
        deleteUser: () => assert.fail("must not delete auth identity"),
        createUser: () => assert.fail("must not generate a plaintext password"),
      },
      resetPasswordForEmail: async (...args: unknown[]) => {
        record("reset", ...args);
        return { error: options.resetError ?? null };
      },
    },
  };
  return { client: client as unknown as Parameters<typeof addClubRole>[0], rows, users, calls };
}
const role = (overrides: Partial<Row> = {}): Row => ({
  id: "role-1",
  user_id: "employee",
  club_id: "club-a",
  role: "collaborator",
  ...overrides,
});

test("existing account is reused without changing password, metadata or sending an invitation", async () => {
  const f = fixture({ users: [{ id: "shared", email: "Shared@example.test" }] });
  const result = await resolveInvitedAccount(f.client, {
    email: " shared@EXAMPLE.test ",
    full_name: "New label",
  });
  assert.deepEqual(result, { userId: "shared", invited: false });
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["listUsers"],
  );
});

test("new account receives one-time invitation with configured trusted origin", async () => {
  process.env.APP_URL = "https://club.example.test";
  const f = fixture();
  assert.deepEqual(
    await resolveInvitedAccount(f.client, { email: " NEW@example.test ", full_name: "Employee" }),
    {
      userId: "invited",
      invited: true,
    },
  );
  assert.deepEqual(f.calls.at(-1), {
    method: "invite",
    args: [
      "new@example.test",
      {
        redirectTo: "https://club.example.test/reset-password",
        data: { full_name: "Employee" },
      },
    ],
  });
});

test("account search continues beyond the original twenty-page limit", async () => {
  const users = Array.from({ length: 4001 }, (_, n) => ({
    id: String(n),
    email: `user${n}@example.test`,
  }));
  const f = fixture({ users });
  assert.equal((await findUserByEmail(f.client, "user4000@example.test"))?.id, "4000");
  assert.equal(f.calls.length, 21);
});

test("directory errors never cause invitations or credential resets", async () => {
  const f = fixture({ authError: new Error("directory unavailable") });
  await assert.rejects(
    resolveInvitedAccount(f.client, { email: "a@example.test", full_name: "A" }),
    /directory unavailable/,
  );
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["listUsers"],
  );
});

test("duplicate/invitation races fail without a password fallback", async () => {
  process.env.APP_URL = "https://club.example.test";
  const f = fixture({ inviteError: new Error("already registered") });
  await assert.rejects(
    resolveInvitedAccount(f.client, { email: "a@example.test", full_name: "A" }),
    /already registered/,
  );
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["listUsers", "invite"],
  );
});

test("redirect requires APP_URL and refuses remote HTTP, credentials, paths and query strings", () => {
  delete process.env.APP_URL;
  assert.throws(accountRedirectUrl, /APP_URL/);
  for (const value of [
    "http://club.example.test",
    "https://user:secret@club.example.test",
    "https://club.example.test/path",
    "https://club.example.test/?next=evil",
    "https://club.example.test/#evil",
    "javascript:alert(1)",
  ]) {
    process.env.APP_URL = value;
    assert.throws(accountRedirectUrl);
  }
  process.env.APP_URL = "http://localhost:3000";
  assert.equal(accountRedirectUrl(), "http://localhost:3000/reset-password");
});

test("an admin role in another club does not authorize this club", async () => {
  const f = fixture({ currentClub: "club-b", rows: [role({ user_id: "caller", role: "admin" })] });
  await assert.rejects(requireClubAdmin({ supabase: f.client, userId: "caller" }), /Forbidden/);
});

test("platform and club administration use disjoint authoritative roles", async () => {
  const f = fixture({ currentClub: "club-a", rows: [role({ user_id: "caller", role: "admin" })] });
  assert.equal(await requireClubAdmin({ supabase: f.client, userId: "caller" }), "club-a");
  const superAdmin = fixture({ currentClub: "club-a", superAdmin: true });
  await assertSuperAdmin({ supabase: superAdmin.client, userId: "root" });
  await assert.rejects(
    requireClubAdmin({ supabase: superAdmin.client, userId: "root" }),
    /platform account/,
  );
  await assert.rejects(assertSuperAdmin({ supabase: f.client, userId: "caller" }), /Forbidden/);
  const broken = fixture({ rpcError: new Error("RPC unavailable"), superAdmin: true });
  await assert.rejects(
    requireClubAdmin({ supabase: broken.client, userId: "root" }),
    /RPC unavailable/,
  );
  await assert.rejects(
    assertSuperAdmin({ supabase: broken.client, userId: "root" }),
    /RPC unavailable/,
  );
  const unassigned = fixture({ currentClub: null, superAdmin: true });
  await assert.rejects(
    requireClubAdmin({ supabase: unassigned.client, userId: "root" }),
    /club asignado/,
  );
});

test("adding an already shared role cannot move it to another club", async () => {
  const f = fixture({ rows: [role()] });
  await assert.rejects(
    addClubRole(f.client, {
      user_id: "employee",
      role: "collaborator",
      club_id: "club-b",
      permissions: [],
    }),
    /No se ha modificado/,
  );
  assert.deepEqual(f.rows, [role()]);
});

test("new membership uses insert and propagates database errors", async () => {
  const f = fixture();
  await addClubRole(f.client, {
    user_id: "employee",
    role: "collaborator",
    club_id: "club-a",
    permissions: [],
  });
  assert.equal(f.rows[0].club_id, "club-a");
  const failed = fixture({ queryError: { message: "database unavailable" } });
  await assert.rejects(addClubRole(failed.client, { user_id: "employee", role: "collaborator" }), {
    message: "database unavailable",
  });
});

test("revoking one membership preserves auth user and membership in another club", async () => {
  const other = role({ id: "other-role", club_id: "club-b", role: "admin" });
  const f = fixture({
    rows: [role(), other],
    users: [{ id: "employee", email: "employee@example.test" }],
  });
  await revokeClubCollaborator(f.client, "club-a", "role-1");
  assert.deepEqual(f.rows, [other]);
  assert.equal(f.users.length, 1);
});

test("revocation and permission changes reject cross-club/admin/missing targets", async () => {
  for (const target of [role({ club_id: "club-b" }), role({ role: "admin" })]) {
    const f = fixture({ rows: [target] });
    await assert.rejects(revokeClubCollaborator(f.client, "club-a", "role-1"), /no encontrado/);
    await assert.rejects(updateClubPermissions(f.client, "club-a", "role-1", []), /no encontrado/);
    assert.deepEqual(f.rows, [target]);
  }
  const empty = fixture();
  await assert.rejects(revokeClubCollaborator(empty.client, "club-a", "missing"), /no encontrado/);
});

test("permission updates apply only to the selected collaborator and report failure", async () => {
  const f = fixture({ rows: [role(), role({ id: "other", club_id: "club-b" })] });
  await updateClubPermissions(f.client, "club-a", "role-1", ["view_reports"]);
  assert.deepEqual(f.rows[0].permissions, ["view_reports"]);
  assert.equal(f.rows[1].permissions, undefined);
  const failed = fixture({ queryError: { message: "write failed" } });
  await assert.rejects(updateClubPermissions(failed.client, "club-a", "role-1", []), {
    message: "write failed",
  });
  await assert.rejects(revokeClubCollaborator(failed.client, "club-a", "role-1"), {
    message: "write failed",
  });
});

test("password recovery sends email to the verified collaborator, never sets a password", async () => {
  process.env.APP_URL = "https://club.example.test";
  const f = fixture({ rows: [role()], users: [{ id: "employee", email: "owner@example.test" }] });
  await requestClubPasswordReset(f.client, "club-a", "role-1");
  assert.deepEqual(f.calls.at(-1), {
    method: "reset",
    args: [
      "owner@example.test",
      {
        redirectTo: "https://club.example.test/reset-password",
      },
    ],
  });
});

test("recovery rejects admin and cross-club targets before accessing auth", async () => {
  for (const target of [role({ club_id: "club-b" }), role({ role: "admin" })]) {
    const f = fixture({ rows: [target] });
    await assert.rejects(requestClubPasswordReset(f.client, "club-a", "role-1"), /no encontrado/);
    assert.deepEqual(
      f.calls.map((c) => c.method),
      ["select"],
    );
  }
});

test("recovery propagates provider failure instead of reporting success", async () => {
  process.env.APP_URL = "https://club.example.test";
  const f = fixture({
    rows: [role()],
    users: [{ id: "employee", email: "owner@example.test" }],
    resetError: new Error("rate limit"),
  });
  await assert.rejects(requestClubPasswordReset(f.client, "club-a", "role-1"), /rate limit/);
});

test("free pilot manual invitation uses one-time Auth link without email or plaintext password", async () => {
  const previous = process.env.SNOOP_INVITATION_DELIVERY;
  process.env.SNOOP_INVITATION_DELIVERY = "manual";
  process.env.APP_URL = "https://snoop.example.test";
  try {
    const { client: admin, calls } = fixture();
    (admin.auth.admin as any).generateLink = async (input: any) => {
      assert.equal(input.type, "invite");
      assert.equal(input.options.redirectTo, "https://snoop.example.test/reset-password");
      return {
        data: {
          user: { id: "manual-invite" },
          properties: { action_link: "https://auth.example.test/verify?token=synthetic-one-time" },
        },
        error: null,
      };
    };
    const result = await resolveInvitedAccount(admin, {
      email: "new@example.test",
      full_name: "Persona Demo",
    });
    assert.equal(result.userId, "manual-invite");
    assert.ok(result.invitationUrl);
    const inviteUrl = new URL(result.invitationUrl);
    assert.equal(inviteUrl.origin, "https://snoop.example.test");
    assert.equal(inviteUrl.search, "");
    assert.equal(new URLSearchParams(inviteUrl.hash.slice(1)).get("type"), "invite");
    assert.ok(!calls.some((c) => c.method === "invite"));
  } finally {
    if (previous === undefined) delete process.env.SNOOP_INVITATION_DELIVERY;
    else process.env.SNOOP_INVITATION_DELIVERY = previous;
  }
});
