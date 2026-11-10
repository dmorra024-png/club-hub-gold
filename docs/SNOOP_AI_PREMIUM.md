# SNOOP AI Premium — implementation and activation boundary

This update continues PR #6, preserves the premium theme and all accounting/stock
write paths. No database, secrets, production configuration, merge or deployment
has been changed. The assistant's visible name is **SNOOP**.

## Operational path implemented

One dock microphone opens the existing foreground session. Member and product
launchers were removed; the existing order-specific dictation control is still a
legacy integration (see limitations). Advanced settings are separate from normal use.

- Crear socio / Snoop, crea un socio → existing form, no arbitrary fields.
- Marco Rossi → name/surname, then birth question.
- 12 marzo 1995, vive a Palma → birth and city only.
- Sì, 666123456. Anzi, cambia il cognome in Bianchi → phone and surname only.
- A compound full name is not split by guessing. SNOOP asks for the given names,
  accepts Juan Carlos, asks for surnames, accepts García López.
- Explicit labelled compound names also work. Unknown phrases do not change data.
- Resumen / riepilogo → actual draft summary; confirmation remains the existing
  form/save/payment UI. Voice never submits the member or money operation.
- Product/catalogue lookup (including Amnesia Haze), existing screen navigation,
  product drafts and explicit decimal values reuse the current permission-aware UI.
- Snoop, fermati / Terminar / Stop Snoop end the session. Background/offline/revocation
  stop capture. A permission change now stops the session itself, preventing rearm.

Dialogue state lives in the existing form and current React session, isolated by
verified user/club. Stop and identity/club/permission changes clear conversational
state, last transcript, written command and timing history. Manual form values
remain drafts; they are not deleted. No audio/history table or new persistence.
Manual edits and navigation invalidate in-flight results.

## GLM integration — real code, live account not verified

Official identifier: `@cf/zai-org/glm-4.7-flash`, using the existing `SNOOP_AI` binding
and strict `snoop-pilot` resource namespace. No API key or new provider.

Checked official references:

- [Model](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)
- [Exact synchronous input schema](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/sync-input.json)
- [Pricing and free-plan limits](https://developers.cloudflare.com/workers-ai/platform/pricing/)

The official schema supports `max_completion_tokens`, JSON schema output and
`chat_template_kwargs.enable_thinking`. SNOOP disables thinking, clears thinking
context, sets store=false and stream=false, asks for a complete JSON object, then
validates it again with strict Zod. Truncated output, tool calls, extra fields,
unknown commands and wrong-domain proposals are rejected.

The model receives ONLY a bounded closed navigation vocabulary. No member names,
dates, contacts, documents, catalogue values, club IDs, current form values or
conversation history are sent. Personal-field conversations are processed locally.
This is a dedicated non-personal purpose, explicitly controlled by its own server
opt-in; the existing administrative/document personal-data gates are unchanged.
`AI_PERSONAL_DATA_PROCESSING_ENABLED=false` and `AI_VOICE_ONLY=true` can remain so.

Simple known commands bypass GLM. For a safe but locally unresolved request, the
model returns a nullable typed command. The app independently checks the explicit
input domain, current identity/club, permissions, route, foreground capture epoch
and manual-edit revision, then runs its existing navigation/draft handler. The
model has no tools or execution access. An uncertain result asks for clarification.
No save, charge, refund, cancellation or inventory mutation is in the model schema.

Bounds: input 180 characters, output 160 tokens, 5-second deadline, 10 AI attempts
per page/user/club context and 30 attempts/hour per verified user+club **per isolate**.
The server map is bounded to 1,000 scopes with one-hour expiry; it stores counters,
not conversation text. It is not an account-wide durable quota ledger. The Workers
Free daily cap must enforce the account-wide shared budget. There are no retries,
automatic model switches, REST-provider fallbacks or billing changes. Quota/rate/
timeout errors have safe UI codes; after a failure, the client stops new AI attempts
and retains local commands/manual input. A timed-out binding inference cannot be
recalled; the token cap still applies and its result is ignored.

Alternative: the already integrated `@cf/meta/llama-3.2-3b-instruct` may be selected
explicitly after verification; SNOOP never switches automatically on a quota/error.

## Configuration prepared, NOT applied

No new credentials are needed. The current deployment remains unchanged. For an
explicitly authorized preview, first verify the account really uses Workers Free
and the GLM binding accepts a synthetic request. Then review these non-secret vars:

```json
{
  "AI_VOICE_INTENTS_ENABLED": "true",
  "SNOOP_AI_FREE_TIER_CONFIRMED": "true",
  "SNOOP_AI_ASSISTANT_MODEL": "@cf/zai-org/glm-4.7-flash"
}
```

`SNOOP_AI_FREE_TIER_CONFIRMED` is an operator attestation, not an API billing check.
Do not set it on an unverified/Paid account. The existing external-processing and
voice-processing flags must be true. No personal-data or document-processing flag
needs enabling. End users additionally opt into the non-personal suggestions in
advanced SNOOP settings; requests require explicit consent=true.

These optional vars are NOT added to the active Wrangler configuration in this PR.
The deployment's strict binding-preservation workflow intentionally requires a
coordinated reviewed config/runtime-var change before activation; do not work around
it or rewrite secrets. Without the opt-ins the local conversational path still works
and issues no GLM requests. Live model availability, account plan and remaining free
quota are BLOCKED here: no Cloudflare binding/account runtime was available locally,
and no deployment or live inference was performed.

The official pricing page includes Workers AI in Free with 10,000 shared Neurons/day;
GLM-4.7-Flash is not listed among the models requiring a payment method. It lists
5,500 Neurons/M input tokens and 36,400/M output tokens. At a conservative 500 input
and the maximum 160 output tokens, estimate about **8.6 Neurons/request**, or under
86 for ten requests. Actual usage varies and Whisper/other Workers share the pool.
The model page quotes $0.0605/M input and $0.40/M output on metered usage; this is
not an unlimited-free promise. No paid subscription or inference was activated.

## Tests and performance evidence

Tests use synthetic accounts, club-scoped catalogue fixtures and intercepted APIs.
The actual React pages and controls are exercised on Chromium/Samsung and
WebKit/iPhone viewports. GLM outputs and quota are simulated. Native Chromium audio
capture is tested with synthetic audio; physical Samsung/iPhone microphones are NOT
certified. No real members or production financial data are used.

`VOICE_CONVERSATION_RESULTS.json` contains measured numeric capture, encoding,
transcription, interpretation, execution and `aiMs` spans. `aiMs` is the AI HTTP round
trip including auth/transport, not isolated GPU inference. In browser tests it measures
a simulated endpoint, not Cloudflare model latency. Whisper remains batch clips,
not duplex streaming: wait for the listening state before the next phrase.

The suites cover combined utterances, compound-name clarification, field corrections,
unknown/ambiguous text, real rendered catalogue search against synthetic records,
decimals, permission revocation without rearm, stale response/manual edits, stop/restart,
no duplicate launchers in members/products, no personal text to GLM, explicit consent,
validated AI navigation, quota suppression, token bounds, timeout and zero automatic saves.
Final command/CI results are recorded in the PR.

## Remaining limitations and minimum Samsung pilot

- Live GLM accuracy/availability/latency/free allowance and physical noisy-club ASR
  remain unverified. No commercial-readiness claim.
- GLM does not interpret personal member fields; a broader personal-text model would
  require a separate privacy decision. Unsupported natural phrases ask for clarification.
- Order-specific voice dictation has not yet been unified with the dock; preparing
  quantities/amounts conversationally and general renewal workflows were not extended.
  Existing order/accounting/stock functions are preserved, not declared newly verified live.
- No voice synthesis or background listening is added.

After an explicitly authorized HTTPS preview with synthetic accounts: tap SNOOP,
consent to Whisper, say Crear socio → Marco Rossi → 12 marzo 1995, vive a Palma →
Sì, 666123456. Anzi, cambia il cognome in Bianchi → Resumen. Inspect the fields;
only use the actual form confirmation if the synthetic test permits saving. Say
Snoop, fermati and check that the OS microphone indicator turns off. Repeat a compound
name, a manual edit during processing and background/reopen. To test GLM, separately
opt into its safe navigation channel after the account/config checks above.

## Local verification on this change

- 290/290 unit/security tests PASS; TypeScript PASS.
- Node and Cloudflare Workers builds PASS; 75 public artifacts pass the secret scan.
- Conversational flow and simulated AI/quota: Chromium + WebKit PASS.
- Existing SNOOP browser regression: Chromium + WebKit PASS.
- Native Chromium MediaRecorder with synthetic microphone and intercepted transcription: IT/ES PASS.

Measured local browser run below (medians in milliseconds, **synthetic transcription and AI**, not provider performance):

| Viewport | Clips | Capture | Transcription fixture | Interpretation | Execution | AI HTTP fixture (two calls) |
|---|---:|---:|---:|---:|---:|---:|
| samsung | 23 | 2040.8 | 4.5 | 0.4 | 19.8 | 3.9 |
| iphone-webkit | 23 | 1967 | 4.0 | 1 | 101.0 | 1.5 |

The full CI run and its final commit are linked in PR #6. Physical devices, live GLM and real production club data are not included in these PASS results.
