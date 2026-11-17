# JARVIS 3 — integration and release gate

This candidate extends the existing authenticated Deepgram integration. It is not a second application and does not change business accounting, stock, order handling or RLS.

## Implemented

- Renewable server-metered voice connections replace the unconditional 90-second shutdown. One authenticated pilot user/club remains enabled; no broad rollout.
- The client keeps one microphone and one active socket. Idle audio connections close after 45 seconds; visible local listening can resume the connection from bounded PCM pre-roll. Backgrounding stops capture. Explicit stop clears conversation memory.
- Encrypted, expiring resume context stays in browser memory, bound to the verified user and club. It contains bounded dialogue plus draft state/refused optional questions. No audio or transcript database history is created.
- Route-owned application ports replace DOM selectors for member, informational product/category drafts, search and navigation. The model cannot invoke persistence. Existing manual form confirmation remains mandatory.
- Provider function results wait for the application's acknowledgement. Duplicate receipts cannot repeat an action or promote a draft into a saved record.
- A read-only cash tool reuses `loadCash` and `cashDaySummary` with the user's JWT and the Madrid calendar day. Only the aggregate is returned to the voice provider. Load errors never become a zero balance.
- Existing multilingual Deepgram voice, endpoint threshold 0.85 and 5000 ms silence backstop are preserved. Device speech synthesis is not substituted.

## Required database approval before release

`supabase/migrations/20261117190000_voice_usage_budget.sql` is prepared, **not applied**. It creates three voice-metering-only tables and a service-role-only leasing RPC. Existing business rows and policies are unchanged. The gateway requires this RPC and fails closed without it; therefore **do not deploy this candidate before the migration is approved and installed**.

The server uses the existing private Supabase credential solely for metering. All business reads continue to use the authenticated user's JWT. Default allowance is 3600 connected seconds per club/month. Leases reserve time atomically and close/reconcile measured connection time; crashed sessions remain conservatively charged. The estimated monetary cap is enabled only with a verified provider rate. No invoice cost, EUR conversion, unlimited usage or 15 EUR guarantee is claimed. Configuration changes to limits/rates require an approved administrative operation.

## Privacy and scope

Personal-data dialogue remains restricted to fictional test data until processing agreements, notices and the REAL configuration have been approved. Enabling a voice session does not constitute that approval. No credentials or real member documents are sent to the provider.

Tools prepare drafts and navigate; they do not automatically save memberships, charge money, fulfil orders, change stock, cancel records or execute financial transactions. Voice-controlled regulated-product fulfilment is not part of this change. Existing manual functions remain intact.

## Verification limits

Automated browser tests use synthetic authentication, audio and provider events in Chromium and WebKit. Workerd tests use intercepted synthetic upstreams; the SQL tests use isolated PostgreSQL/PGlite. These are not physical Samsung/iPhone tests or a live Deepgram accuracy/latency/credit measurement. Source-level pricing and real provider invoicing must be checked before commercial promises.

The PR remains draft until database approval, final CI and authorised online/physical acceptance. No production deployment is performed by the verification workflows.
