# Gervis Snoop — intelligent coworker (isolated branch)

## Objective
SNOOP is an additional authorized club coworker, not a chatbot or a fixed-command voice remote. The operator speaks naturally in the selected language. SNOOP understands the requested outcome, invokes the existing SNOOP tools, validates results, continues across turns, and asks only for missing information or consent.

## What this branch actually implements
- **Isolated branch** `feature/gervis-snoop`; existing Pilot, Deepgram voice, Caja, inventory ledger, orders, SNOOP Socio and REAL are unchanged.
- Opt-in switch `GERVIS_SNOOP_EXPERIMENTAL=true`, **off by default**.
- A dedicated coworker system prompt replacing the oversized legacy prompt **only when the opt-in flag is enabled**.
- Uses the **same authenticated gateway**, the **same Deepgram listen/speak/stream**, the **same application tools**, the **same server authorization**, and the **same manual write confirmation flow**.
- Managed Deepgram Standard-tier model `gpt-4.1-mini` for Gervis only; legacy Pilot remains `gpt-4o-mini`.
- One live capability catalog derived from existing navigation/read/execution registries, rather than a second independently maintained implementation.
- A validated **approved-learning contract** for club-specific vocabulary and workflow preferences. Its storage is abstract and **NOT YET connected to a persistent database**; do not tell the operator that Gervis already learns across sessions.
- Regression checks verify settings, tools, opt-in mode, permissions boundaries, and privacy rules.

## Known limitations and unfinished acceptance gates
- No live Deepgram tool-use test has yet demonstrated natural free-form interpretation, uninterrupted multi-turn speech, or completion of all club tasks.
- Persistent club-scoped memory needs an authenticated storage implementation with database RLS and explicit consent/revocation controls before enablement.
- Every tool needs a real-world E2E proof, not merely a prompt instruction. In particular full **orders**, member registration with required documents/signature, stock actions, and final accounting operations must be verified individually. Do not promise autonomous work in unsupported flows.
- The branch must be built and verified in a **separate testing environment**, never by targeting the existing `snoop-pilot` Worker or modifying live Cloudflare flags.
- Deepgram trial credits must be checked before live voice tests. No pay-as-you-go or paid resource should be activated without the user's approval.

## Acceptance matrix (synthetic data before live Pilot)
1. Open a new member form with 15 paraphrases, not requiring a previous operation ID.
2. Dictate 6 fields across multiple turns; correct one field; keep all other fields.
3. Find Fátima by correctly normalized name; disambiguate if duplicate; open actual member record.
4. Open product form and dictate real category, prices, classification, destination, decimals without invented fields.
5. Read stock, prepare a signed stock delta, display correct product and manual confirmation; no silent write.
6. Read actual Caja opener/receipts/shift history and date-ranged informes; never invent numeric values.
7. Perform available authorized operational tasks with receipts, never claim success before backend confirms it.
8. Keep microphone and Spanish language throughout successive actions; recover from app tool failures without ending conversation.
9. Reject true unauthorized access, but never confuse a missing technical capability or RPC failure with operator permission.
10. Remember an explicitly approved pronunciation in a *separate* club memory, allow deletion, and never leak memory across clubs.
11. Verify no change in Caja, SNOOP Socio, Deepgram output audio, Worker credentials, live service bindings and production.

## Deployment policy
This branch is **not deployed**. Merging or publishing requires full CI, a separate Gervis-only runtime, real voice acceptance with synthetic records, and explicit release approval. A green automated CI run alone is insufficient.

## Verified development progress, 27 November 2026
- The default project test runner now includes `tests/gervis-worker-gateway.test.mjs`: two **synthetic** audio turns in Workerd use the real authenticated gateway and a fake Deepgram tool call to request `member_create`, receive the application's simulated acknowledgement, and prepare a new member city field on the next turn. It verifies there are no parallel legacy shortcut proposals, no backend writes, and no secret leaks.
- The Gervis-only browser pathway (`verifyNavigation`) now demands that the router actually reaches `/soci/nuovo` and that the registered `member.form` port is ready **before** the app reports successful navigation. `tests/gervis-member-form-readiness.test.ts` covers both accepted and rejected routes. Existing Pilot remains unchanged.
- Missing empty model tool envelopes can be normalized for Gervis, but real member, product, cash, stock fields and permissions are never invented or bypassed.
- CI tests cover these steps with synthetic provider responses. They do **not** prove autonomous comprehension by the live model, real microphone reliability, or an end-to-end real user/browser execution. Those remain explicit release blockers.
