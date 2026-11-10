# SNOOP semantic orchestrator

Base: `a14724d` (`codex/stabilize-independent-club`). No production changes.

## Implemented boundary

The persistent root VoiceAgent calls a single turn planner. Existing validated local intents and form parsers remain compatible. New combinations of known IT/ES concepts use a typed semantic projection instead of adding full sentence patterns. Indirect requests can use the existing opt-in GLM channel. The server accepts a strict Zod schema containing only enumerated concepts, a screen enum and anonymous `r0` references. Free-text names and values never appear in that payload. Search references are rebound in the browser after response validation. A model proposal cannot change domains, execute a mutation or bypass existing permissions.

Local member dialogue handles self-repairs, asks for a missing correction value and remembers the requested field. Ambiguous two-digit birth years require an explicit full year; a birthplace is not silently treated as residence. Manual edits, navigation epochs, permission revocation and foreground-only recording retain their existing guards. Audio, conversation and references are not persisted by this implementation.

The legacy closed-vocabulary endpoint remains for compatibility; it retains its privacy allowlist. Existing model limits, five-second timeout, opt-in flags and free-tier gate are unchanged. No new configuration, model, paid service or database migration is introduced.

## Verification

`npm test`, `npm run typecheck`, `npm run build`, `npm run build:worker:test`, `npm run test:security:bundle`.

`npm run test:voice:conversation` exercises real rendered forms through simulated microphone capture/Whisper output in Chromium (Samsung viewport) and WebKit (iPhone viewport). It asserts at least 30 distinct dialogue turns per engine, requested-field corrections, review without writes, manual-edit precedence, navigation, decimals, quota fallback, interruption, denied microphone and revoked access. Existing session and administrative browser suites remain enabled in CI. Results and timing samples are written to `docs/VOICE_CONVERSATION_RESULTS.json`; browser screenshots are test renders with synthetic data.

## Explicit limitations

This is not unrestricted ChatGPT-style understanding. Unknown words are intentionally excluded from the remote semantic projection, so GLM cannot recover arbitrary meanings, ASR mistakes or confidential field values. Uncertain input asks a concrete clarification. Local personal-field extraction remains conservative and includes the existing deterministic validators. A new intent needs a typed capability and authorization mapping, not unrestricted model tools.

No live Whisper/GLM request or physical Samsung/iPhone microphone is validated by the browser fixtures. Simulated timing samples do not measure Cloudflare latency or real ASR accuracy. The existing authorized Whisper consent still applies to remote audio transcription; this change does not make audio local or anonymous. No new personal-data authorization is granted.

Cash and economic workflows, order fulfillment, stock writes, production data, permissions and the genetics/image engine are unchanged. Preparation of regulated-product quantities is not expanded. The existing contextual order microphone is retained rather than replacing its workflow in this change; therefore the all-app single-microphone criterion is not yet met. All saves and economic confirmations still require the existing explicit UI action.

## Samsung acceptance (after separate publication authorization)

Opt into remote transcription using the existing consent. Start SNOOP, say “Crear socio”, dictate a name, request “cambia il cognome”, answer the clarification, then review the populated fields without saving. Test stop, backgrounding and restart in a quiet and noisy environment. Actual recognition quality and provider latency require this physical acceptance; no deployment is performed here.
