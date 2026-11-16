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

| Name | Value/type |
|---|---|
| `DEEPGRAM_API_KEY` | Secret text, newly provisioned in this Worker from the authorized Deepgram account |
| `SNOOP_DEEPGRAM_PILOT_ENABLED` | Plain/secret text `true` when the pilot is ready; otherwise absent/false |
| `SNOOP_DEEPGRAM_PILOT_USER_ID` | Exact authenticated Supabase user UUID of the intended admin |
| `SNOOP_DEEPGRAM_PILOT_CLUB_ID` | Exact UUID of that admin's club |

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
