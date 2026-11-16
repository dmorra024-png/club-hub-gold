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

Local checks: `node --test lab/deepgram/policy.test.ts`, `npx tsc -p lab/deepgram/tsconfig.json`, `node lab/deepgram/build.mjs`, `node lab/deepgram/test-worker.mjs`, `node lab/deepgram/test-browser.mjs`.

The dedicated workflow only updates the hard-coded **snoop-voice-lab** worker when a commit explicitly contains `[lab-prototype]`. It inherits all existing secrets without reading their values or writing secrets, preserves original module hashes and binding names/types, and never calls production Worker endpoints. Its GitHub environment supplies the already-existing Cloudflare token; the environment's name is not a deployment target. A random, unlogged capability held only by that CI process permits the fixed live probe; the Worker stores only its hash. No API key or preview key is extracted.

Workflow artifacts contain live synthetic transcription/proposal results, latency and balance readings, synthetic reply WAV files, and simulated Chromium/WebKit UI renders. They are not physical Samsung/iPhone tests. Listen to the reply samples and try on the phone before judging perceived voice quality. Text injection is not used to stand in for speech recognition.

Official references: https://developers.deepgram.com/docs/multilingual-voice-agent ; https://developers.deepgram.com/docs/voice-agent-tts-models ; https://developers.deepgram.com/docs/voice-agent-llm-models ; https://developers.deepgram.com/docs/voice-agents-function-calling ; https://deepgram.com/pricing .
