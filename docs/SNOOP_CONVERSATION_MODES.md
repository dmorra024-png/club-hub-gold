# SNOOP conversational modes — scope and verification

Base: merged PR #9, `bbc57ac`. No deployment, database, account, cash, secret or billing changes.

## One interpreter per conversational turn

In PILOT/REAL, Whisper output goes directly to `interpretSnoopConversation`. GLM receives the current utterance and a bounded session context, and returns strict JSON: intent, target, field patches, declined optional fields, the semantic field being asked for and a short next question. Zod validates it on server and browser. Server-verified club access/permissions are checked before sending context and before returning a proposal. No model tools or database access are supplied.

The old private/local mode remains an explicitly separate fallback for the currently published app. PILOT/REAL return before its parsers and model refinements; they never run concurrently. The browser regression asserts this, as well as exactly one model request per utterance (stop is immediate and local).

Adapters set the existing member and informational product/category form state directly. They do not reparse an AI-generated command string. No automatic submit, payment, cancellation or stock mutation is exposed. Numeric pricing/fulfillment changes for regulated products are not part of these capabilities; the request to automate purchase/sale values and distribution quantities is not implemented. Existing economic and order workflows remain unchanged.

Memory is held in the persistent root React component. It contains only five member fields, informational product fields, current operation, declined phone and last question. It is cleared on stop/logout/identity/club change. Manual form snapshots are authoritative; an input edit, permission change, external navigation or stop invalidates an in-flight proposal. Opening a draft through the assistant can resume its session-local values without using browser storage.

## Privacy gates (no settings changed)

PILOT requires all existing Cloudflare/free-tier/voice authorization flags, `SNOOP_AI_CONVERSATION_MODE=pilot`, a server-configured `SNOOP_AI_PILOT_CLUB_ID` equal to the authenticated club, and **both** Supabase URLs (`SUPABASE_URL`, `VITE_SUPABASE_URL`) on the same loopback origin. The user must explicitly confirm synthetic-only data and consent to text interpretation. A client `synthetic=true` alone never enables it. This intentionally prevents enabling natural conversation against Snoop-pilot's real database.

REAL is disabled unless an operator has completed and recorded all reviews: `SNOOP_AI_DPA_REVIEW_ID`, `SNOOP_AI_NOTICE_REVIEW_ID`, `SNOOP_AI_PROCESSING_REVIEW_ID`, plus `SNOOP_AI_CONVERSATION_MODE=real`, `AI_PERSONAL_DATA_PROCESSING_ENABLED=true` and existing Cloudflare/voice/free-tier gates. Review IDs are attestations configured by an authorized operator, not legal validation performed by code. No review is assumed completed here. No production flag is enabled.

Transport uses authenticated POST, `Cache-Control: no-store, private`, direct binding calls, `store:false`, non-streaming bounded output (700 tokens), eight-second deadline, no retries or provider fallback. Existing per-user/club/isolate 30 requests/hour applies. No conversation, audio or form content is written to logs, URLs, analytics, browser storage, database or AI history by this path. Do not enable body capture/AI Gateway history externally; this belongs to the REAL processing review. Whisper's existing audio consent remains separate from the new text consent.

The official GLM model page confirms `@cf/zai-org/glm-4.7-flash` and ZDR. Cloudflare's data-usage policy states no training and describes exceptions for explicitly stateful features. These are **not** consent or a DPA review. The model has metered unit pricing; free allowance is bounded, not unlimited free usage. No billing activation or paid resource is added here.

Sources checked: https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/ and https://developers.cloudflare.com/workers-ai/platform/data-usage/ .

## What the tests establish

`tests/fixtures/snoop-dialogue-cases.mjs` contains 51 IT/ES turns: self-correction, compound names, dates, declined phone, requested-field clarification, topic changes/resumption, informational catalogue search (including Amnesia Haze/Mango Haze), category drafts, cash/report navigation and immediate stop. The server-adapter test uses three synthetic user scopes to remain within the hourly limit. It validates model transport/response handling with **simulated model responses**, not linguistic accuracy.

`npm run test:ai:dialogue` uses actual rendered forms in Chromium/Samsung viewport and WebKit/iPhone viewport, simulated audio capture/Whisper and GLM responses, and asserts fields, navigation, zero automatic writes, a single interpreter and manual-edit precedence during delayed AI output. The same fixture is not evidence that the live model understands those utterances. CI retains all existing tests and uploads JSON timing samples/screenshots.

Capture, transcription, interpretation and execution timing fields are recorded separately in the browser report. Because providers/audio are simulated, these timings cannot establish real Cloudflare latency, audio recognition accuracy, noise tolerance or physical Samsung/iPhone behavior.

## Remaining external acceptance

No live binding is attached to the Node development process; no authenticated live Cloudflare inference or physical microphone test has been performed. A dedicated local synthetic backend plus an authorized Cloudflare development runtime/binding is necessary for a real PILOT evaluation. No deployment is attempted to obtain it. REAL additionally requires the three actual privacy reviews above. The existing contextual order microphone is retained, so universal microphone consolidation is not claimed.

For the eventual authorized physical pilot: select PILOT in existing voice settings on the isolated instance, confirm synthetic-only text consent, then run the member dialogue without saving. Check stop/background/restart and manually correct a field during a slow reply. REAL must remain unavailable until its review gates are legitimately configured.
