# JARVIS code-only pilot deployment, 26 November 2026

Exact source: f8f8cddd2b872b523a0a98aaeb42f7c884a88117.

This trigger publishes only the reconciled client/Worker code to the existing snoop-pilot target. All new persistent voice execution stays disabled until missing live SQL dependencies are reviewed; no migration is applied. Existing Monedero bindings, accounting, stock, App Socio and REAL are preserved. This release must pass build, TypeScript, security, binding preflight and post-deployment health check.

## Full verified execution activation

On 2026-11-26, the additive 29-command SQL Pilot upgrade was installed via Supabase migration snoop_voice_execution_pilot_29_commands_20261126, retaining zero existing execution rows, RLS and anonymous EXECUTE denial. The source branch remains the exact CI-green f8f8cddd2b872b523a0a98aaeb42f7c884a88117. This guarded release activates only SNOOP_VOICE_EXECUTION_PILOT_ENABLED on snoop-pilot, retaining all Monedero bindings and without touching REAL or the independent Socio app. The workflow fails closed on schema, build, credential, binding or online verification errors.

## JARVIS speech hotfix — 26 November 2026

Release pin f66749f4da8e9e164da0adf1c88b1f50f9303272 (PR #65). Fixes Deepgram audible playback following UserStartedSpeaking where provider output arrives but PcmPlayback remains suppressed=true if optional speaking markers are absent. An assistant ConversationText is the verified boundary to lift suppression; user text and stale PCM cannot lift it. Adds a regression test; no modification to database, wallets, Caja, inventory, member app or deployment flags.
