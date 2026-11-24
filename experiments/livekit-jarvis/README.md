# JARVIS / LiveKit — isolated cost-controlled experiment

**Status:** source prototype only. **Not** connected to SNOOP; not deployed or tested with real audio. No live credentials configured here.

This is a separately versioned LiveKit voice pipeline on an isolated Git branch. The existing JARVIS, SNOOP Socio, Caja and REAL are untouched. It uses the official LiveKit Node agent pattern, with Deepgram Nova-3 multilingual STT, an inference-based text LLM and natural TTS. Provider/model availability, Spanish/Italian transcription, phone behaviour and exact pricing **must** be verified with real audio before further development.

## Run (after configuring a free test project)
1. Obtain free **Build** project at https://cloud.livekit.io. Create API credentials. **Never paste secrets into GitHub or client code.**
2. Use Node 24+; from this directory run `pnpm install` (pnpm 10+), copy `.env.example` to `.env.local`, add credentials. Do not share keys.
3. Run `pnpm run verify`, then `pnpm run console` to test the agent directly, or `pnpm run dev` for WebRTC after configuring an authenticated test client/token endpoint.
4. Do not connect production databases or use development token servers in production.

## Proposed incremental SNOOP integration (NOT yet implemented)
- SNOOP admin logs in on an isolated pilot route; backend validates the existing user's session and issues a short-lived, room-scoped LiveKit token. LiveKit credentials remain server-side.
- Only authenticated, current-club, permission-scoped **read-only** tools first: stock lookup, member search, report read, navigation to new-member page.
- Never expose raw database access to the LLM. No direct write, order payment, membership creation, cash mutation, delete or external email. Those require existing confirmation and authorization mechanisms. No unprotected public token route.
- Compare actual device (Android / iPhone) STT accuracy, interruptions, latency, costs and 3 real non-mutating tasks to existing JARVIS before any migration.

## Costs
Official https://livekit.com/pricing (Nov 2026): free Build includes 1,000 agent session min/mo, 5 concurrent sessions, 1 deployment and $2.50 inference credits (shared at project level, not per club). Ship $50/mo per project, 5,000 agent session minutes included, then $0.01/min. Example LiveKit inference: Nova-3 multilingual $0.0058/min streaming, Aura-2 TTS $0.018/min of synthesized speech, Cartesia Sonic 3 $0.03/min of synthesized speech. LLM billed separately per token. Prices in USD before taxes, no committed subscription or external services activated. Substantial audio use can exhaust the $2.50 inference credits before the 1,000 included agent minutes.

Budget model (illustrative, not quoted all-in): for 200 *session* minutes/club/month, 60 minutes of spoken agent replies, and 200 minutes STT at $0.0058, plus Aura-2 TTS at $0.018: $1.16 STT + $1.08 TTS = $2.24 BEFORE LLM, session hosting, taxes and other infrastructure. On Ship at 20 clubs sharing 5,000 included agent minutes, the $50 platform fixed fee is $2.50/club, for an illustrative subtotal $4.74/club plus LLM, etc. Assumes eligible plan/minutes, independent sessions, and no overages. TTS model above is Cartesia Sonic 3 (not Aura-2); swapping it later would reduce expected speech cost, but should be evaluated for voice quality and multilingual availability.

### Exit criteria for trial
- Tests on actual Android and iPhone, same 3 requests, measured quality and interruption rate.
- Strict per-club authorization/least privilege and server-only keys.
- Per-club usage quota, session timeout, opt-in audio recording and explicit reporting of actual session + STT/LLM/TTS billing.
- Neither REAL nor current JARVIS modified without approval.
