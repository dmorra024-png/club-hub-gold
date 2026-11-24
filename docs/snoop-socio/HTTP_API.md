# SNOOP Socio — isolated HTTP interface and production boundary

`apps/socio/http.mjs` is a transport adapter for the already isolated `makeSocioService`. It **does not create a live server, install cookies, connect to Supabase, or serve staff endpoints**. GitHub CI uses Node's standard `Request`/`Response` to exercise it without real users.

## Currently implemented route contract (not deployed)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /api/socio/me | Verified Socio identity from server session |
| GET | /api/socio/clubs | Linked verified club memberships only |
| POST | /api/socio/memberships/sync | Server-side auto-link eligibility and atomic repository sync (pending) |
| POST | /api/socio/link/claim | Consume staff-issued challenge; no client trust |
| GET | /api/socio/clubs/:id/carnet | Current member number and state |
| GET | /api/socio/clubs/:id/carnet/qr | PNG of a short-lived encrypted AES-256-GCM token |
| GET | /api/socio/clubs/:id/wallet | Read-only saldo (if enabled) |
| GET | /api/socio/clubs/:id/wallet/movements | Read-only club-scoped movement history |
| POST | /api/socio/auth/signup | Supabase adapter pending |
| POST | /api/socio/auth/login | Supabase adapter pending |
| POST | /api/socio/auth/logout | Supabase adapter pending |

No routes for staff wallet edits, admin access, arbitrary member lookups, or payments exist in the Socio service.

## Production adapter constraints

**Strictly separate Cloudflare Worker/deployment name and host** from `snoop-pilot`. Do not route `/api/socio` to the operational management Worker without a dedicated, reviewed plan. The PWA currently calls a same-origin API; when a standalone worker is deployed, frontend and endpoints must share that origin.

- `authenticate(request)` must retrieve the user from a server-verified Supabase Auth access token/session, not claims supplied in JSON or browser localStorage.
- The actor `accountType: 'socio'` must be established from a server-owned Socio access policy; staff role cannot be accidentally inherited. Auth email must have been confirmed by Supabase and must not alone grant a club membership.
- Use HttpOnly Secure SameSite cookies with short access-token lifetime and safe refresh/revocation; implement CSRF protection. The current transport rejects cross-origin mutations and non-JSON bodies, but this is **necessary not sufficient**, especially for login CSRF, refresh-token theft, and cross-site navigation.
- Mutating requests require exact same-origin Origin header and JSON Content-Type. Keep strict CORS/no wildcard; set CSP, HSTS, no-store, audit.
- Use a repository/DB adapter that enforces tenant isolation, verified memberships, current membership status and atomic one-use challenge claims via RLS and server-side authorization on every request. The pure `auto-link.mjs` eligibility function does not establish identity or email verification at enrollment.
- `renderQrPng(token)` must produce an actual PNG from a server-only signed token; expose only image bytes, not the token in JSON or logs. A token has about 40 s validity but every scan still requires actual staff club context and DB membership check; scanned QR itself must not authorize fund movement.
- Wallet remains read-only in the socio API and hidden unless enabled by the club. Movements are integer cents, transaction IDs must be unique and refund ledger append-only.
- Do not log raw tokens, birth dates, identity documents, private club associations, or wallet histories.
- The `POST /auth/*` handlers are intentionally **unimplemented** and fail with 503; this is a protection against claiming a successful login/signup before secure Supabase connection exists.

## Tests

Run `node --test apps/socio/domain.test.mjs apps/socio/auto-link.test.mjs apps/socio/service.test.mjs apps/socio/http.test.mjs`.

Do not claim a physical device, real Auth, live Supabase integration, approved privacy notice, or deployment was tested.
