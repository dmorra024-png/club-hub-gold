# SNOOP Socio — app client premium blu/oro

## Pilota online · 18 novembre 2026

- **Indirizzo separato dal gestionale:** https://snoop-socio-pilot.dmorra024.workers.dev
- **Logo:** le stesse cinque lettere vettoriali argento di `src/components/SnoopWordmark.tsx`, icona S quadrata coordinata, colori da `src/styles.css`.
- **Cloudflare:** Worker `snoop-socio-pilot` con propri asset e propria origine. Segreti Pubblicabile Supabase e QR cifrati in binding `secret_text`; la stessa chiave privata è presente nello scanner autorizzato del Worker gestionale `snoop-pilot`.
- **Supabase:** tabelle `socio_*`, RPC `socio_issue_member_claim`, `socio_claim_member` e `socio_staff_consume_qr` installate; nuovi soci ricevono una tessera indipendente dal Monedero.
- **Invito:** scheda socio nel gestionale → codice monouso valido 10 minuti → account SNOOP Socio verificato → tessera/QR temporaneo. I saldi sono personali e visibili solo con collegamento verificato.
- **Scanner:** nella gestione soci il QR `ssc2` passa per verifica AES-GCM sul server, autorizzazione club e consumo nonce; non si interpreta il token nel browser.
- **Collaudi completati:** SQL sintetico, controlli statici, browser Chromium/WebKit simulati, Cloudflare HTTPS 200, QR/logo asset e API 401 senza sessione.
- **Collaudi ancora necessari prima della distribuzione pubblica:** test di registrazione e email confermata con un socio consenziente, verifica URL redirect del progetto Supabase, scansione fisica Android/iOS, verifica QR dopo expiry/revoca, saldi e movimento reale con autorizzazione, installazione PWA su dispositivi effettivi. Non sono stati usati account reali di soci nei test automatici.

Questo pilota **non deve essere dichiarato pronto per un lancio pubblico** prima di tali prove end-to-end.

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
Same-origin `/api/socio`: `GET /me`, `POST /auth/signup|login|refresh|logout`, `GET /clubs`, `POST /memberships/sync`, `POST /link/claim`, `GET /clubs/:id/carnet`, `GET /clubs/:id/carnet/qr`, `GET /clubs/:id/wallet`, and movement history. Implemented modules: `auth-supabase.mjs` (real GoTrue REST contract), `socio-role.mjs` (deny staff via existing `user_roles` RLS), `supabase-rls.mjs` (read-only tenant-specific projection), `bootstrap.mjs` and `http.mjs`. **No standalone Cloudflare Worker has been deployed or authenticated against live Supabase.** Login/signup requires a separately hosted HTTPS Socio service. Automatic linking by email still deliberately fails closed: matching email alone is not ownership proof. An authenticated claim RPC adapter and staff-only issuance gateway now exist, with atomic Postgres function proposals in `schema/CLAIM_RPCS_REVIEW_ONLY.sql`. Those RPCs have passed disposable PostgreSQL tests, but are NOT applied in Supabase and the staff route is NOT mounted in the management app. The proposed tables are specified but not applied: `schema/REVIEW_ONLY.sql`. Codex must verify Origin/CSRF, cookie rotation, email confirmation policy, RLS with real accounts, staff denial and QR scanner compatibility before release.

## Constraints
No SQL, no production mutation, no fake QR, no default club/sample PII, no wallet writes. No merge into main without Codex review and full cross-club security tests. All routes currently assume a separately deployed Socio origin with same-origin API.

## Build and release gate (17 November 2026)
- Disposable PostgreSQL schema + policy tests check club isolation, wallet SELECT RLS, staff-authorized code issuance, atomic single-use member claim and replay rejection.
- Android-sized Chromium and iPhone-sized WebKit tests run the actual app with strictly synthetic network responses; they do not verify real devices or live email deliveries.
- Real operations are **not enabled**: staff issue route needs authenticated integration, SQL proposals require security review and explicit approval before any Supabase migration, client Worker needs an independently configured HTTPS origin, and the actual Monedero settlement must be atomic with existing SNOOP cash, order and refund flows.
- No real credits, orders, staff, members, or credentials have been migrated by this branch. Never merge or deploy based only on synthetic tests.
