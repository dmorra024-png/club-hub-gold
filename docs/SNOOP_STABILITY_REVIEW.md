# SNOOP stability review — 2026-11-07

No deployment, remote database mutation, migration, account recreation or paid service was performed. Scope: SNOOP only.

## Implemented

- Preserved upstream futuristic home commits 9fb2e935, c677e401, 4cda08ab and mobile decimal input fix dce70ab.
- Session/access requests are bounded, concurrent checks coalesced, obsolete responses ignored. Access errors fail closed with retry instead of incorrectly treating an account as unassigned. Same-user focus/auth events do not invalidate the entire router. Hidden operational components retain unsaved in-memory input while access is rechecked.
- Last permitted route can be restored after restart, scoped to verified user and club; no form contents or auth links are stored in this metadata. Logout clears it. Offline access never bypasses server/database authorization.
- Home and Caja share Madrid/DST day boundaries and integer-cent totals. Duplicate IDs are counted once per ledger; conflicting duplicates are rejected. The three approved home controls remain; financial data is not queried/displayed without cash permission.
- Pilot account URLs reject localhost/mismatched APP_URL. Club administrators can regenerate a one-use canonical recovery link for an existing collaborator without changing account, roles or password. Password is chosen by its owner. Acceptance messages reflect actual provider acceptance, not delivery.
- Specialist lookup accepts only allowlisted public sources, obeys robots and request limits, and offers at most three short exact-name excerpts with attribution. Specialist photographs require image-specific explicit CC license, attribution and matching name. Manual entry/upload remains available. No automated save.

## Actual external checks and remaining limits

- A synthetic invalid invitation token sent to Snoop-pilot Auth verification with the public reset redirect returned HTTP 303 toward localhost:3000. No real invitation/token was consumed or regenerated. The external Auth redirect problem is therefore confirmed and NOT resolved by frontend code alone.
- Management Auth-config read is blocked: HTTP 403, missing `auth_config_read`. No Auth configuration was changed.
- Required production Auth configuration: Site URL `https://snoop-pilot.dmorra024.workers.dev`; permitted redirect `https://snoop-pilot.dmorra024.workers.dev/reset-password`; remove production localhost entries; check invite/recovery templates for hardcoded localhost. Reading requires `auth_config_read`, updating through API requires `auth_config_write` and specific authorization. Do not replace tokens or recreate users.
- Public specialist live probe with synthetic catalog search “Blue Dream”: search returned a challenge/no useful results; Leafly robots prohibited the requested page; another publisher was unavailable. No documented description or licensed specialist photo was retrieved. Live specialist usefulness remains BLOCKED; parser/fallback tests do not prove live search works.
- Physical Samsung/iPhone process termination, installation, camera/microphone prompts and real invitation delivery are not verified. Browser device emulation and actual desktop WebKit are simulations, not physical-device certification.

## Executed checks

| Check | Result | Evidence / scope |
| --- | --- | --- |
| Unit and isolated database security tests | PASS | 174/174; synthetic fixtures, multi-club RLS and privilege checks |
| TypeScript | PASS | Application and test projects |
| Production build / public secret scan | PASS | No local service-role/AI test secrets in public bundle |
| Cloudflare build / Wrangler dry run | PASS | Local sandbox configuration; no upload |
| PWA | PASS | Manifest, icons, Chromium installability, public-only offline cache |
| Member administration | PASS | Synthetic creation, duplicate guard, renewal confirm/cancel, QR |
| Catalog / staff administration | PASS | Android Chromium, iPhone Chromium and actual desktop WebKit emulation; synthetic API responses |
| Account links | PASS | One-use invitation/recovery/password flow and regeneration; same three browser configurations; no live emails |
| Resume and home/Caja | PASS | Android Chromium and iPhone WebKit; Chromium CDP freeze/resume, network retry, retained draft, new-context route restoration, amounts and permission fence |
| Voice forms Italian/Spanish | PASS | Local MediaRecorder with simulated transcription; zero automatic writes |
| Worker APP_URL | PASS | Single read-only settings GET: HTTP 200, CANONICAL; Actions run 42390462004, deployment job skipped |
| Production Auth redirects | BLOCKED | Synthetic invalid-token probe redirects to localhost; auth_config_read missing |
| Specialist live results | BLOCKED | Public sources unavailable/restricted; no verified live excerpt/photo |
| Physical Samsung/iPhone | BLOCKED | Hardware unavailable; emulation is not physical validation |

## Activation

After explicit authorization: correct only Snoop-pilot Auth URLs/templates, deploy only the reviewed `snoop-pilot` Worker version, then regenerate affected collaborator links and perform physical phone checks. No database migrations are needed for these code changes.
