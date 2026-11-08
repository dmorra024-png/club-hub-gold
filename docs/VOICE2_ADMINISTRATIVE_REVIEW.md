# Voice 2.0 — administrative implementation and limits

## Scope and collaboration

Continued from the existing development branch, synchronizing the parallel photo developer's commits through `3dbb1fc` before editing, then fast-forwarding `48bb12e` before the final commit. No changes to `catalog-enrichment.server.ts`, `specialist-catalog.server.ts`, `products-enrich.functions.ts`, Genetics files, the products page or photo-search/selection components. Further upstream changes must be preserved with normal fast-forward integration; no published history rewrite.

Implemented work is administrative voice: member draft preparation/corrections, authorized local member lookup (including explicitly dictated membership numbers and DNI labels), administrative navigation, actual membership-plan binding, bounded microphone capture and error handling. Existing product/order dispatch paths are preserved but were not expanded or certified here. Cannabis product creation, stock quantities, selling prices and commercial catalogue automation are outside this implementation; the example cannabis-stock command is not a completed/tested feature.

## Reproduced problems and changes

- A navigation regex could consume “busca al socio …” before preserving the query. Structured local intents now carry the complete search/draft before navigation.
- Natural IT/ES registration phrases can prepare multiple supplied fields together. Explicit name/surname, birth date, city, phone, email, document and fee labels remain supported. Two unambiguous natural name tokens are recognized; compound names require explicit field labels rather than guessed splitting.
- Single-field corrections produce patches. Existing manual changes made while an audio request was pending win over late suggestions. Repeated explicit corrected labels use the last supplied value; field words inside a value such as “Città Demo” are retained.
- IT/ES named-month and spoken-number dates remain calendar-validated. Phone digits/email separators and strict integer/decimal helpers are local. Decimal helpers are unit-tested; they are **not connected to product prices or stock fields**.
- Fee names/aliases bind only to a unique actual plan returned for the current club. Unknown/ambiguous plans are not guessed. Draft and search handoffs carry user/club scope and TTL; legacy handoffs remain readable for compatibility. Unknown fields/role injection are still rejected by the existing whitelist.
- Member queries run against authorized, explicitly club-filtered rows in the browser. Similar names no longer cause the first approximate match to open automatically; ambiguous matches remain a selection list. No member data is newly sent to a text model.
- Shared `useWhisperDictation` replaces duplicated recording lifecycles. One active recorder; double activation guarded; 60-second/8 MB bounds; explicit send vs discard; microphone tracks released; pending permission/audio callbacks invalidated on navigation, account/club/role/permission/language changes, page hiding, offline transitions and unmount. Cancelling an already-uploaded request cannot retract its audio, but its result is ignored.
- Microphone denial, unavailable AI, unsupported audio and network failures return to manual entry. Availability errors are caught. Status/review feedback and an explicit cancel action are visible; mobile-keyboard layout hides floating feedback. No modal confirmation is added to each correction.

## Provider and privacy

The existing backend `@cf/openai/whisper-large-v3-turbo` adapter, language, VAD, timeout, authorization and model whitelist are unchanged. No secrets, account, production database or RLS changes. The new administrative interpretation is local and does not call the full text agent or field-extraction model. No paid model, new provider, subscription, deployment or merge. Unknown complex administrative speech asks for explicit fields/manual completion; no unverified LLM/quota claim is made.

The global control now uses bounded user-initiated Whisper recording rather than browser continuous SpeechRecognition. There is no background auto-restart, browser-vendor transcription or greeting TTS in this path. A press starts recording, a second press sends the clip, and “Cancelar dictado” discards it. Audio processing still requires the existing authorized Cloudflare configuration. Names and documents must not be spoken unnecessarily; no raw transcript is logged.

## Verification

- 195/195 unit/security tests PASS (six new meaningful administrative suites); TypeScript and production build PASS; public-bundle secret scan PASS.
- New Samsung Chromium and iPhone WebKit suite PASS: complete administrative phrase, fee binding, corrections, manual edit vs late response, scoped local search, ambiguous-name handling, permission fences, one microphone for double starts, explicit cancellation, track release, unavailable provider, permission denial, offline/navigation cancellation, network errors and zero writes. Browser API/Whisper responses are **simulated**, not an acoustic accuracy claim.
- Existing IT/ES form suite PASS with the real Chromium MediaRecorder API and a **synthetic microphone**, simulated transcription, local field extraction and zero automatic writes. It now asserts zero field-model calls.
- Existing PWA/member-administration and six-viewport premium-home regression suites PASS locally. CI also runs both voice browser suites. See PR #1/current CI for final aggregate evidence.
- Screenshots: `docs/screenshots/voice2-samsung.png`, `docs/screenshots/voice2-iphone-webkit.png`. All identities/club/member data are synthetic.

No physical Samsung/iPhone speech recording or live Cloudflare inference/quota probe was performed. Remaining real-device checks: permission grant/deny, actual IT/ES accents and noisy-room accuracy, Safari audio codec behavior, OS interruption/backgrounding, and free-quota exhaustion/manual fallback. Voice recognition precision is **not certified** until these checks run. There is no new external setup required by these code changes; publishing still needs separate explicit deployment authorization.

CI initially exposed a WebKit access-control error in the pre-existing synthetic administrative browser fixture, before reaching the voice suites. The fixture now responds to CORS preflight/exposes its synthetic response headers and drains pending reads before document navigation. No inventory/photo application code or error assertion was changed. The failed run remains available for audit.
