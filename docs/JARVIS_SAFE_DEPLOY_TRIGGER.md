# JARVIS code-only pilot deployment, 26 November 2026

Exact source: f8f8cddd2b872b523a0a98aaeb42f7c884a88117.

This trigger publishes only the reconciled client/Worker code to the existing snoop-pilot target. All new persistent voice execution stays disabled until missing live SQL dependencies are reviewed; no migration is applied. Existing Monedero bindings, accounting, stock, App Socio and REAL are preserved. This release must pass build, TypeScript, security, binding preflight and post-deployment health check.

## Full verified execution activation

On 2026-11-26, the additive 29-command SQL Pilot upgrade was installed via Supabase migration snoop_voice_execution_pilot_29_commands_20261126, retaining zero existing execution rows, RLS and anonymous EXECUTE denial. The source branch remains the exact CI-green f8f8cddd2b872b523a0a98aaeb42f7c884a88117. This guarded release activates only SNOOP_VOICE_EXECUTION_PILOT_ENABLED on snoop-pilot, retaining all Monedero bindings and without touching REAL or the independent Socio app. The workflow fails closed on schema, build, credential, binding or online verification errors.

## JARVIS speech hotfix — 26 November 2026

Release pin f66749f4da8e9e164da0adf1c88b1f50f9303272 (PR #65). Fixes Deepgram audible playback following UserStartedSpeaking where provider output arrives but PcmPlayback remains suppressed=true if optional speaking markers are absent. An assistant ConversationText is the verified boundary to lift suppression; user text and stale PCM cannot lift it. Adds a regression test; no modification to database, wallets, Caja, inventory, member app or deployment flags.

## Conversational club collaborator pilot release — 26 November 2026

Pinned source c4ae5e72a95628579a0aa0e3a330d4541e9ad6c6 (PR #68, 17 code/test files) on top of merged #66. Authorized voice navigation and successive human-confirmed member/product form dictation, decimal prices and stock, scoped Caja operator read, Leafly-first then Strainpedia verified genetics, conservative pronunciation matching. This is a guarded SNOOP Pilot code release only. Worker keeps existing secret bindings, Monedero state, voice execution gate and existing database; neither SNOOP Socio nor REAL is deployed. Automated unit/database/typecheck/build/audio synthetic tests succeeded. Full administrative browser CI remains independently tracked and is not represented as a live-device test.

## SNOOP Pilot JARVIS spoken-screen acknowledgement and evidence-rich genetics hotfix

Pinned seven-file source commit ca73fc008363ee003578ea35a94eee84f4e03c85. Distinguishes browser-confirmed screen opening from AI assumptions: authenticated direct navigation now acknowledges success/failure only after actual app result. Bounded research canonicalizes known Forbidden Fruit pronunciation variants and extracts several verified informational sections from the first approved source, falling back from Leafly to Strainpedia only if no verified Leafly result. Keeps controlled read-only research and does not include fees, cash, stock, Monedero, Socio or REAL changes. Live Deepgram phone validation remains necessary after guarded deployment.

## JARVIS form navigation reject fix

Pinned source 712bdb20d1c794ad48bc3eb1a8a44793e56848df (five files, PR #70). Authenticated voice requests opening member/product forms now accept missing optional empty JSON keys only for read-only navigation with the original permission gate. Concurrent shortcut and Deepgram snoop_propose use the same verified browser acknowledgement. Malformed commands and authorization denial have separate safe UI labels. This release must not modify database schema, member/product records, Caja, inventory, Monedero, Socio or REAL.

## November 27 — fixed language and sequential member/product voice dictation

Verified source 6f20d120e18aa59b0dfe4c7d32a7b7dd74e0dc6d (PR #72). Seven-file guarded source diff: use only explicitly selected Deepgram language hint and matching Flux speaker, persist language selection for form dictation, recognize sequential member/product fields with omitted empty JSON envelope keys while preserving original Zod validation, the verified club category requirement and manual Save boundary. Tested safe non-invasive member and product field updates, decimal validation, authorization and manual-edit preservation. Do not change data, payments, stock accounting, Monedero, SNOOP Socio or REAL. Real phone test remains required after Pilot deploy.
