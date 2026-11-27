# GERVIS SNOOP — protected mobile voice test, 27 November 2026

**Release mode:** uploaded Cloudflare Worker VERSION URL, never deployed to normal Pilot traffic.
**Dedicated hostname:** `https://gervis-snoop-snoop-pilot.dmorra024.workers.dev`
**Git branch:** `feature/gervis-snoop` / draft PR #78.

## Critical resource and privacy limitation
Cloudflare Version URLs **reuse the resources, secrets and environment of the existing Worker**. This is NOT a separately isolated database. The shared underlying service is the **existing SNOOP Pilot**; the production traffic route is never shifted by `wrangler versions upload`. For genuinely isolated resources, provision a separate Cloudflare Preview and Supabase project with separate bindings and secrets.

This Gervis phone-test VERSION therefore enables only:
- `GERVIS_SNOOP_EXPERIMENTAL=true` on the dedicated hostname
- `GERVIS_LEARNING_ENABLED=false` — no memory database created or modified
- `SNOOP_VOICE_EXECUTION_PILOT_ENABLED=false` — no voice server writes
- `SNOOP_WALLET_OPERATIONS_ENABLED=false` — no wallet voice writes
- Existing authenticated Pilot tester allowlists, club RLS and confirmations remain mandatory

No production club data should be used in testing. Never enter real member identity documents, register actual people, save real stock movements, take payment, or confirm any financial action. The existing app UI still has regular authorized manual actions; **do not use the Save/Confirm buttons** during this voice test.

## Acceptance test on an Android or iOS phone
1. Open the dedicated URL and sign in with the **existing authorized Pilot test user**.
2. Open voice; verify the UI says **GERVIS SNOOP · prova vocale attiva**. If it says ordinary SNOOP, you are not testing Gervis; stop.
3. Speak naturally in Spanish: “Oye Snoop, ¿me ayudas a dar de alta a una socia?” It should open the actual new-member form, not say “no tengo permiso” unless the real role prohibits it.
4. Continue: “Se llama Fátima González.” It should prepare only explicitly spoken values without losing the form.
5. Correct: “Perdona, el apellido es García.” It should update only the surname, not reset the first name.
6. Ask: “Vamos a crear un producto, abre el formulario.” It should open the existing product form.
7. Say: “Quiero añadir 50 gramos de Amnesia Haze, solo prepara el movimiento.” It should stage the stock confirmation for the correct product, **never actually change stock**.
8. Ask about Caja opening and today's totals; require answers from actual authorized read tools, never invented amounts.
9. Continue at least 20 turns without closing the microphone or switching Spanish to Italian spontaneously.
10. After interruptions, confirm the voice resumes and both microphone and speaker remain usable.

Log the actual utterance, transcript, chosen tool, UI receipt, audio outcome, and any error. Never declare a failure resolved until its real-device test passes.

## Safe deployment gate
The only GitHub Actions path is `.github/workflows/gervis-snoop-phone-test.yml`, restricted to this branch, the exact message `gervis-phone-test-upload`, and the protected `snoop-pilot` GitHub environment. It first runs tests and checks protected binding *types*, then calls **`wrangler versions upload`**, not `wrangler deploy`. The output is not successful unless both URLs respond and the action logs report `GERVIS_PHONE_TEST_URL`.

## Release attempt
Requested by the user for a genuine mobile phone test. All unverified real-voice behaviors stay OPEN pending device acceptance.

### First CI attempt and verified fix
The first upload of Gervis's non-deployed Worker version passed its unit/type/build/dry-run checks but the Version URL returned HTTP 404. The existing Pilot had Version URL routing disabled. The guarded workflow now verifies the existing workers.dev route remains enabled, enables version URL routing with Cloudflare's documented subdomain API if needed, re-uploads the Gervis version alias, and retries the URL smoke test. This changes only the Worker-wide **Version URL routing setting**, not deployed code or live traffic. These URLs are publicly routable to the existing app authentication screen; all account and pilot allowlists still apply.
