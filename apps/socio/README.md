# SNOOP Socio — isolated PWA UI shell

**Not production-ready; backend adapters are implemented on this branch but are NOT deployed, and no database migration was executed.** This directory contains a real, navigable, responsive *frontend scaffold* plus tested domain and server service abstractions for the future Socio app. It is deliberately isolated from current SNOOP routes, workflows and Supabase production. Do not claim it issues usable QR cards until the Socio API exists and is independently authorized.

## Preview locally
From repo root, serve files statically with an HTTP server that points to `apps/socio/`, e.g. `python3 -m http.server 8765 --directory apps/socio`, then open `http://127.0.0.1:8765`. Browser registration/login will correctly display that the isolated Socio service is not available because no Socio backend has been deployed. Use HTTPS for actual installation.

## Included
- Spanish premium blue/gold authentication forms with email/password confirmation.
- Email-verification confirmation view, explicit club-link challenge screen.
- Three-dots menu: `Mis clubes`, `Mi perfil`, logout.
- QR-focused card view; per-club selection, last selection per session, no mock QR or fake balance.
- QR refresh with server-rendered PNG and strict no-cache/revoke-on-hide rules (only when authorized API exists).
- Optional read-only Monedero section, never claimed as real before API integration.
- PWA manifest, service worker caching public shell only. SVG icon is a placeholder; produce tested 192/512 PNG icons before shipping. Safari install may require manual `Añadir a pantalla de inicio`.

## Isolated API and Supabase Auth adapter (CODED, NOT DEPLOYED)
Same-origin `/api/socio`: `GET /me`, `POST /auth/signup|login|refresh|logout`, `GET /clubs`, `POST /memberships/sync`, `POST /link/claim`, `GET /clubs/:id/carnet`, `GET /clubs/:id/carnet/qr`, `GET /clubs/:id/wallet`, and movement history. Implemented modules: `auth-supabase.mjs` (real GoTrue REST contract), `socio-role.mjs` (deny staff via existing `user_roles` RLS), `supabase-rls.mjs` (read-only tenant-specific projection), `bootstrap.mjs` and `http.mjs`. **No standalone Cloudflare Worker has been deployed or authenticated against live Supabase.** Login/signup requires a separately hosted HTTPS Socio service. Membership auto-link and challenge writes deliberately fail closed until their audited SQL transaction procedures are reviewed. The proposed tables are specified but not applied: `schema/REVIEW_ONLY.sql`. Codex must verify Origin/CSRF, cookie rotation, email confirmation policy, RLS with real accounts, staff denial and QR scanner compatibility before release.

## Constraints
No SQL, no production mutation, no fake QR, no default club/sample PII, no wallet writes. No merge into main without Codex review and full cross-club security tests. All routes currently assume a separately deployed Socio origin with same-origin API.
