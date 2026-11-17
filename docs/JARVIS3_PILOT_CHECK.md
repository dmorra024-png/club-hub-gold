# JARVIS 3 — controlled pilot acceptance

## Current gate

The candidate is in PR #24, not automatically online. The metering migration is already applied; do not run it again. **Merge and deployment require explicit owner authorisation.** Do not test the new behaviour against an older online build and count it as acceptance of this candidate.

Use the existing `snoop-pilot` Worker and existing Ddr pilot authorisation. No new diagnostic endpoint, account, API key, privileged browser access or REAL activation is required. There are no instructions to copy secrets or change configuration.

Before a phone test, the operator must confirm the released commit matches the verified PR head, existing bindings remain preserved, and the authenticated WebSocket—not an anonymous request—selects Deepgram. The server-only RPC success path must be observed through this normal flow or the existing authorised Supabase connection. It is still pending from this executor; anonymous access denial does not prove server access.

## One five-minute phone walkthrough

Use fictional personal data only. Do not click **Crear socio**, **Guardar**, payment, order, stock or cancellation confirmations. Drafts must not create database records. Existing real catalog names may be searched read-only.

1. Open SNOOP HTTPS as the authorised pilot administrator. Tap SNOOP, select Italian and accept the existing synthetic-data voice consent. Confirm the real Deepgram voice is heard and the microphone indicator is visible.
2. Say: “Snoop, crea un socio Prueba Voz.” Then “È nato il 12 maggio 1995.” Expect only the appropriate fields: `Prueba`, `Voz`, `1995-05-12`. Say “Non voglio inserire il telefono”; it must not keep asking for it. Say “Cambia il cognome in Piloto.” Previous fields must remain. Do not save.
3. Manually change the surname, then dictate a different city. The manual surname must remain unchanged. An ambiguous phrase must request clarification rather than replace arbitrary fields.
4. Say “Abre productos” and “Busca Amnesia Haze.” Use that label only if it exists in the authorised club catalog; otherwise expect an honest not-found result. Prepare an informational product/category draft using an existing category such as Flores **only when present**. Missing categories must never be invented. No stock, price or economic operation is executed by voice.
5. While SNOOP speaks, interrupt it verbally and give another permitted navigation request. Check that playback stops, the new command runs once, and the assistant does not transcribe its own voice. If the device does not report acoustic echo cancellation, use the visible manual interruption fallback and record that limitation.
6. Continue with several permitted commands in Italian, Spanish and English for over three minutes. Include natural one-to-two-second thinking pauses and corrections. There must be no fixed 90-second restart. Leave it idle for about 50 seconds: the paid audio connection should pause with a visible local-listening state. Speak again; verify reconnection/context and no duplicate action. Long speech pauses and live recognition quality require physical assessment, not a mock test claim.
7. Background the app briefly: microphone capture must stop. Return and explicitly restart if required by the browser; verify draft preservation. Stop the session, then log out: no microphone or playback may remain active.

Repeat the core steps on Samsung Chrome/PWA and iPhone Safari/PWA. Tablet/desktop viewport tests are simulated; physical hardware compatibility must be recorded separately. Do not record or upload personal audio. A short pass/fail note and timings are sufficient.

## Server checks accompanying the session

Using only the existing authorised server path/connection, verify:

- The actor and club come from the verified session, never from model arguments.
- Opening reserves time once; renewal advances sequence without duplicate reservations.
- Stop records `closed`, measured connected milliseconds and unused-time reconciliation. A lost response may retry the same close without increasing duration or duplicating consumption.
- The monthly allowance is shared within the club and cannot be consumed across another club. Exhaustion denies further reservation; unknown pricing never becomes an invented invoice cost.
- No business rows are created by this draft-only walkthrough; no REAL mode, new service or billing upgrade is enabled.

**Do not exhaust or lower the real club's budget for testing.** Boundary/exhaustion, suspension and competing-actor cases are already tested using synthetic PostgreSQL fixtures. Any production budget/configuration change requires separate approval.

## Acceptance record

Record candidate/released commit, device/browser, language, time from end of speech to response, unexpected interruptions, correct/incorrect names, context retention, fields applied/preserved, server lifecycle result and remaining quota. Distinguish live Deepgram, physical hardware, browser simulation and SQL fixtures. Do not label JARVIS commercially complete until the fundamental live path is verified.
