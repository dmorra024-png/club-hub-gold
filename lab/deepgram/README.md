# Isolated Deepgram Voice Agent trial

URL: https://snoop-voice-lab.dmorra024.workers.dev/deepgram

Use the **existing voice-lab preview key**, choose Italian or Spanish, consent to synthetic-only remote processing, then start. No Deepgram API key is entered in the browser. Stop/background closes the session. Maximum 90 seconds per session. Use invented people; do not enter real member, club or document information.

This is an independent lab, **not an integration enabled in the production app**. The existing lab routes and original modules are preserved. PR #21 is unchanged. No Supabase, production account, economic, stock, RLS or Security PSG resources are connected. It reuses SNOOP's `ConversationProposal` and `conversationAllowed` validators with an explicit synthetic collaborator scope: member/informational product drafts only. The model proposes; SNOOP validates; confirmation only affects the local lab draft and writes nothing.

## Architecture

Microphone → local PCM AudioWorklet → same-origin authenticated WebSocket → lab Worker → Deepgram Voice Agent. The server alone configures STT/LLM/TTS and handles function calls. No browser-supplied Settings, provider endpoint or tool result is accepted. Existing `VOICE_PREVIEW_KEY` gates every provider session, with origin, size, duration and per-isolate concurrency limits. Per-isolate limits are **not a global account spending cap**. No audio/transcript storage, analytics or Worker logging added. `mip_opt_out:true` is set; this is not a blanket legal/privacy clearance for real data.

Current documented configuration: Flux multilingual STT v2 (`flux-general-multi`, IT/ES hints), managed GPT-4o-mini through Deepgram (no separate OpenAI key/account), Flux TTS v2 (`flux-paola-it` / `flux-carmen-es`). Actual account availability must be confirmed by the live result, not inferred from documentation. No provider fallback is silently substituted.

Default browser behavior is half-duplex: input is paused while received audio is actually playing, avoiding self-transcription. The interrupt button clears playback and lets the user speak to trigger the provider's turn handling. Unrestricted acoustic barge-in is **not claimed**. AudioContext/AudioWorklet requires HTTPS and browser microphone permission. No background listening.

## Costs and evidence

Published Standard Voice Agent rate observed 2026-11-16: **$0.075 per connected minute** including managed STT/LLM/TTS. Trial consumes existing credit; this is not unlimited free service. At that rate, a 90-second session is about $0.1125, not a guaranteed bill. No billing or auto-top-up API is called. The automated job runs two bounded fixed-synthetic audio sessions, no retries. Before/after balances are reported only if the existing key has permission and identifies one project. Settlement may lag; an unchanged balance does not prove zero consumption.

Local checks: `node --test --experimental-test-isolation=none lab/deepgram/*.test.ts`, `npx tsc -p lab/deepgram/tsconfig.json`, `node lab/deepgram/build.mjs`, `node lab/deepgram/test-worker.mjs`, `node lab/deepgram/test-browser.mjs`.

The dedicated workflow only updates the hard-coded **snoop-voice-lab** worker when a commit explicitly contains `[lab-prototype]`. It inherits all existing secrets without reading their values or writing secrets, preserves original module hashes and binding names/types, and never calls production Worker endpoints. Its GitHub environment supplies the already-existing Cloudflare token; the environment's name is not a deployment target. A random, unlogged capability held only by that CI process permits the fixed live probe; the Worker stores only its hash. No API key or preview key is extracted.

Workflow artifacts contain live synthetic transcription/proposal results, latency and balance readings, synthetic reply WAV files, and simulated Chromium/WebKit UI renders. They are not physical Samsung/iPhone tests. Listen to the reply samples and try on the phone before judging perceived voice quality. Text injection is not used to stand in for speech recognition.

Official references: https://developers.deepgram.com/docs/multilingual-voice-agent ; https://developers.deepgram.com/docs/voice-agent-tts-models ; https://developers.deepgram.com/docs/voice-agent-llm-models ; https://developers.deepgram.com/docs/voice-agents-function-calling ; https://deepgram.com/pricing .

## Pause and vocabulary correction — prepared, NOT deployed

Baseline independently confirmed: live build `8029cb5`, same as branch. Flux `eot_threshold` was omitted (documented default 0.7), silence backstop omitted (default 5000 ms), and hints only selected Italian or Spanish. Keyterms contained administrative words but no genetic/category names. The interpreter did not receive a catalog vocabulary. The client deliberately gates microphone upload during playback to avoid self-transcription; this change keeps that protection and the existing interruption button.

- Set EOT confidence to **0.85**, keeping **5000 ms** maximum silence unchanged. No fixed wait is added to every response. No eager/speculative threshold is enabled, avoiding extra speculative LLM calls. This tuning follows Deepgram's documented false-positive/latency tradeoff; its improvement on a real speaker is **not yet measured**.
- Use IT/ES/EN language hints and add English selection with the documented `flux-kit-en` voice. English account-side inference is not certified by simulated tests.
- Feed the same bounded vocabulary to STT keyterms and the interpreter. Public pronunciation hints are sourced from `src/lib/workers-ai.server.ts`; UI category examples are from `productos.tsx`. Neither list asserts that a product/category actually exists in the club.
- A pure, server-owned approved-catalog adapter supports verified product/category names. **No actual club category snapshot is present in the isolated lab.** `LAB_CATALOG.categories` remains empty. Optional server-only `VOICE_LAB_CATALOG` accepts a strictly validated JSON snapshot `{"products":["approved name"],"categories":["approved label"]}`. It is not configured or written by this change; its contents must be explicitly authorized for Deepgram, and must contain no members, IDs, notes, prices or other private data. Invalid snapshots block the session before any provider request. Category assignment is therefore explicitly blocked until an authorized name-only snapshot is supplied. Unknown categories are never guessed or replaced. Canonicalization changes only exact case/spacing, not similar-sounding names. No club DB reads or writes are added, and a browser cannot supply provider settings/catalog context.
- The existing transcript and draft remain separate: compare the literal transcript against the proposed name to distinguish ASR errors from interpretation errors. After a future authorized deployment, the lab also reports accepted EOT/hint settings and verified-category count after SettingsApplied.

### Concrete post-deployment trial (not executed yet)

Deployment is prohibited for this correction. The current online lab therefore still runs the baseline. After separate authorization to update **only** the lab:

1. Select IT, ES or EN; verify threshold 0.85 and silence backstop 5000 ms in the session diagnostic. Use synthetic data only.
2. Say “Vorrei preparare una scheda…”; pause about 0.8–1.5 seconds as if thinking, then continue “…di Amnesia Haze”. Repeat with “Quiero preparar una ficha… de Lemon Haze” and “I would like an informational draft… for OG Kush”. Check that the assistant does not speak over the continuation. Also try a complete short phrase without a thinking pause; measure response time separately.
3. Test Amnesia Haze, Lemon Haze, OG Kush and Critical in each language. Compare literal STT with proposed name; do not score simulated transcripts as actual recognition.
4. With an approved synthetic catalog fixture only, test exact category labels, corrections, and an unknown category. In the default isolated lab without that snapshot, expect an explicit missing-category-context message and no category assignment, not a claim that Flores exists in the club.
5. Stop/background must still close the microphone. Do not save anything in production. Record early interruptions and response latency separately; acoustic behavior still needs Samsung/iPhone testing.

No price/provider/billing settings changed. Published Standard cost remains $0.075/connected minute: **200 minutes cost $15** before FX/tax or other costs. A €10–15/month goal requires a usage budget; it is not an unlimited monthly price. The 90-second lab cap remains unchanged.

Reference: https://developers.deepgram.com/docs/flux/configuration and https://developers.deepgram.com/docs/configure-voice-agent .
