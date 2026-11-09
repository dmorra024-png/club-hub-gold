# Voice Premium — conversational member draft, v1

Based on `379bae9` (latest reference branch, including the merged Voice Premium
session and newer club-glossary fixes). Separate development branch and PR;
no database, secrets, production deployment, merge or Security PSG changes.

## Implemented path

Tap Voice, give the existing Whisper consent, then say:

1. «Snoop, crea un socio» / «Crear socio». The real existing form opens, no arbitrary data.
2. The compact badge asks for name/surname. «Marco Rossi» fills only those fields.
3. It asks for birth date. «12 marzo 1995» or «Nació el 12 de marzo de 1995» fills only birth date.
4. «Cambia el apellido a García» replaces only surname.
5. «Ciudad Palma, teléfono 666123456» fills those optional fields.
6. «No, lascia il telefono vuoto e aggiungi la quota semestrale» explicitly clears
   phone and selects an exact uniquely matching Semestral plan **only if it exists in this club**.
7. «Resumen» / «Riepilogo» shows actual name/date/city in the existing draft summary.
   «Confirmar» does NOT save: the existing form button and its validations/payment
   confirmation remain mandatory.

The bare-name shortcut accepts two words only, in the requested-name context.
Compound names must use explicit labels; the v1 deliberately avoids guessing their
boundary. Unknown phrases/invalid dates do not change fields. No conversational
LLM reads personal information. Actual ASR word errors can still require correction.

## Architecture and memory

Reuses persistent Voice Premium host, Whisper batch capture, root navigation and
existing permission gates. Adds a typed form-local dialogue state (awaiting name,
birth, optional data or review) with validated partial patches. Current fields are
read from the actual form, not an external conversation history. State is RAM-only,
cleared at Stop and form unmount/identity change. No new persistence, audio store,
transcript log or database table. Existing draft persistence is unchanged.

Known navigation/stop commands take priority over conversational replies. Stale
transcripts after navigation or edits are rejected by the existing capture guards.
Form patches also compare the current field with its request snapshot. A late
response cannot overwrite a newer manual edit. The legacy member mic launcher is
hidden during a foreground session; the existing four-button dock remains unchanged.

Questions are compact text, not speech synthesis. Whisper remains HTTP clips,
NOT streaming/full duplex: wait for the listening indicator before the next phrase.
Stop/background/offline/permission revocation retain their existing interruption rules.

## Optional hybrid AI — prepared, NOT activated or live verified

An optional classifier uses only the existing Workers binding and fixed
`@cf/meta/llama-3.2-3b-instruct`, never another provider. Client and server both
require a closed navigation vocabulary: names, digits, dates, free catalogue
values and history are rejected. Output must be exactly one whitelisted command;
extra properties/tools/field values are rejected. It only suggests navigation and
asks the user to repeat the canonical command; it never executes an uncertain result.
Timeout is four seconds, with no retries or paid fallback.

It requires a separate in-memory user opt-in in advanced settings, explicit
`AI_VOICE_INTENTS_ENABLED=true`, and **all existing administrative AI privacy gates**.
The current voice-only profile therefore blocks it. No flags/secrets were changed;
no remote text inference was performed. Do not enable personal-data processing just
to activate this optional feature. A separate configuration/privacy review is needed.
The local member conversation works without it and without extra configuration.

Official [model documentation](https://developers.cloudflare.com/workers-ai/models/llama-3.2-3b-instruct/)
was checked: list pricing is $0.0509/M input tokens and $0.335/M output tokens.
Existing free Workers AI quota is finite; account availability and budget were not
verified here. No paid service, subscription or model invocation was enabled.
Whisper authorization and costs remain unchanged.

## Validation / remaining physical checks

Automated tests use synthetic accounts and intercepted APIs. Browser transcriptions
are simulated; Chromium/WebKit on Linux with Samsung/iPhone viewports are NOT
physical Android/Safari tests. Native microphone accuracy, club noise, actual WAN
and model latency remain unverified. Measurements in VOICE_CONVERSATION_RESULTS.json
are pipeline simulation timings, not Cloudflare ASR benchmarks.

The browser suite covers contextual name/date, surname-only correction, unknown
phrase/no mutation, review/no save, existing searches/product draft, slow response
with manual-edit protection, navigation, stop/restart, provider failure and denied/
revoked permissions. The existing lifecycle and administrative regression remain in CI.

For the physical pilot, after a separately authorized HTTPS preview with synthetic
accounts: tap Voice, dictate the sequence above, check each field, do not save,
say Terminar and verify the OS microphone indicator turns off. Repeat after
background/reopen. The app must not restart listening silently.

## Local verification completed

- `npm test`: 284/284 PASS, zero failed/skipped.
- `npm run typecheck`: PASS.
- `npm run build` and `npm run build:worker:test`: PASS.
- `npm run test:security:bundle`: 75 public artifacts PASS.
- `npm run test:voice:conversation`: Chromium/Samsung and WebKit/iPhone PASS,
  including stop/restart while the member form is active, with zero writes.
- Existing `test:voice:session` and `test:voice2:browser`: both engines PASS.
- Screenshots: [member Samsung](screenshots/voice-conversation-samsung.png),
  [member WebKit](screenshots/voice-conversation-iphone-webkit.png).

Full CI regression is linked in the PR after completion. No physical microphone
or live language-model result is included in these PASS labels.
