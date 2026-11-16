# SNOOP JARVIS 3 — Admin-only Deepgram pilot

This is the integration branch for the existing **snoop-pilot** app, not the separate public lab.

## Code path

- Global dock: `src/components/SnoopLayout.tsx` emits `snoop:voice-toggle`.
- `VoiceSession.tsx` selects `DeepgramPilotVoice` for a server-authorized account only.
- `/api/snoop-deepgram/socket` is handled by the existing app Worker and relays raw PCM to Deepgram.
- Supabase Auth verifies the logged-in JWT. The existing RLS-scoped `snoop_access_context` RPC and fixed server user/club flags authorize the pilot.
- Category/product **display names only** are queried with the user's JWT, filtered by club, for pronunciation and matching; members, prices, orders, financial records and IDs never enter that vocabulary.
- `agentSettings` uses the lab-tested Flux EOT 0.85 and 5-second silence backstop; IT/ES/EN.
- All proposals are temporary drafts: no database or order mutations; manual forms remain available.
- Public Deepgram lab and Security PSG are untouched.

## Required server-only bindings

Configure on the **snoop-pilot** Worker, not on the browser and not on the public lab:

| Name                           | Value/type                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `DEEPGRAM_API_KEY`             | Secret text, newly provisioned in this Worker from the authorized Deepgram account |
| `SNOOP_DEEPGRAM_PILOT_ENABLED` | Plain/secret text `true` when the pilot is ready; otherwise absent/false           |
| `SNOOP_DEEPGRAM_PILOT_USER_ID` | Exact authenticated Supabase user UUID of the intended admin                       |
| `SNOOP_DEEPGRAM_PILOT_CLUB_ID` | Exact UUID of that admin's club                                                    |

**Do not** copy a preview key into the browser or expose the Deepgram key in `VITE_*`, Git commits, logs, or JSON responses. The lab's Cloudflare secret cannot be read and transferred via the public API; use the provider dashboard to issue/provision a key if necessary.

Multiple admin accounts exist; DO NOT guess the allowed user UUID. The default is fail-closed.

## Controlled release conditions

1. Inspect PR #23 and the applicable current base branches; complete automated tests, TypeScript, Worker build and bundle scan.
2. Keep the existing SNOOP deploy workflow binding-preservation guard. Do not overwrite or drop any existing secret/resource. Check the Cloudflare Worker name is exactly `snoop-pilot`; never touch Security PSG.
3. Add the required secret/flags with an authenticated Cloudflare account and explicitly check **names/types only**. Do not log values.
4. Deploy only after the complete application release tree is approved and compatible with the current production state. Use the existing manual guarded SNOOP deployment process.
5. Post-deployment: check unauthorized/cross-origin sockets fail, non-admin sees original voice, approved admin sees JARVIS 3 on all routes, and read-only categories are correctly recognized.
6. Test real Android and iPhone microphones, pause interruption, genetics/category recognition, changing pages, stopping/backgrounding and voice replies. Do not claim automated Chromium/WebKit simulation proves real acoustic quality.
7. Preserve ability to disable immediately with `SNOOP_DEEPGRAM_PILOT_ENABLED=false` and keep old voice functionality for other users.
8. No automatic topping up of Deepgram credit; test the connected-minute bill and define a durable organization-wide monthly cap before commercial rollout. $0.075/connected minute is a laboratory reference, not an unlimited monthly subscription.

## External processing/privacy

Pilot requires explicit administrator consent. Use fictional member details. Only approved category/product display names are shared with the provider; do not use real member documents, personal details, financial information or customer notes. Stop or backgrounding destroys microphone capture and playback. No audio/transcripts are intentionally persisted in the app.

## PR #23 regression corrections

- The obsolete-archive browser guard now identifies the exact read-only `deepgramPilotStatus` RPC. It still rejects every other archive call and asserts zero writes; the previously failing `1 !== 0` was this newly added availability check, not a catalog write.
- Supabase fetches use Workers-supported manual redirect handling. Authentication is bounded and pinned to the Snoop-pilot project. The provider handshake timer is cleared after upgrade so it cannot abort an established conversation after 12 seconds.
- Only one capture attempt/session is allowed in the component. Closing, backgrounding, a revoked microphone, or changed user/club stops capture and clears temporary transcript/draft memory.
- Typed, authorized proposals navigate and populate **existing** member/product/category forms and search fields through the existing app events. They never call a persistence endpoint. Voice-owned fields can be corrected; pre-existing or subsequently edited manual fields are protected. Late proposals cannot fill a page after unrelated navigation.
- The authorized account never temporarily mounts the legacy engine while availability is loading. A failed verification offers retry instead of silently selecting the wrong engine. Other accounts retain legacy voice.
- Device-confirmed acoustic echo cancellation enables provider-side spoken interruption. Without confirmed AEC the UI explicitly offers manual interruption and suppresses microphone frames during playback. Physical echo and barge-in quality still need device testing.

### Reproducible isolated checks

1. `npm test` and `npm run typecheck`.
2. `node scripts/test-deepgram-app-worker.mjs`: actual Workerd runtime, mocked Supabase/Deepgram upstreams, JWT/role/club denial, names-only scoped queries, binary PCM, two turns separated by over 12 seconds, concurrent-session rejection and no writes/secrets forwarded.
3. Build the normal app, start locally and run `TEST_BASE_URL=http://127.0.0.1:3001 node scripts/test-deepgram-app.mjs`: real rendered Chromium/WebKit routes and forms, simulated microphone/provider, persistent socket through navigation, manual-edit preservation, product/category/member drafts, search, audio playback/interruption and stop.
4. `npm run test:genetics:browser` retains the original archive-removal regression check.
5. Worker build, client-secret scan and Wrangler dry-run are required before any release. After the Cloudflare build, `node scripts/test-deepgram-app-worker.mjs --compiled` repeats the authenticated WebSocket/audio checks through the actual Nitro/TanStack Cloudflare entrypoint rather than the standalone gateway.

These tests are not proof of real Deepgram availability, credits, acoustic recognition, email delivery or a physical Samsung/iPhone. No synthetic fixture may be used to bypass production authentication.

### Current release blocker

The read-only production binding audit on 2026-11-16 returned ABSENT for all four `DEEPGRAM_*` / `SNOOP_DEEPGRAM_PILOT_*` bindings listed above. The production app therefore cannot connect to Deepgram. Provisioning the key and the exact administrator/club allowlist in protected Worker configuration is required before deployment or a genuine authenticated online voice test. Do not guess account IDs or extract another Worker's secrets.

The current four-session/hour limiter is per Worker isolate, not a durable organization-wide billing cap. The 90-second and audio-byte limits apply per session. Deepgram uses existing account credits; no new paid plan or automatic credit top-up is enabled by this code. Commercial/monthly budget guarantees are not established by these limits.

The repeated read-only binding audit at 2026-11-16 19:53 UTC confirmed the same four bindings remain ABSENT. Public `/auth` returned HTTP 200, while the not-yet-deployed `/api/snoop-deepgram/socket` returned HTTP 404. Neither result is evidence of an authenticated real-provider voice session.
