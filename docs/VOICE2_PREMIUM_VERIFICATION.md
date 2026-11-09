# Voice 2.0 Premium — verification

Scope: existing `codex/stabilize-independent-club` branch, synchronized through
`20f0dcf` before the final combined verification. No deployment, remote database writes, migration,
account, secret or Security PSG changes. Existing order, accounting, stock and
permission rules are retained.

## Implemented

- Primary Voice 2.0 button in the navy/champagne bottom dock: Home, central QR,
  Voice, Perfil. Redundant sidebar, member-search and large product-page voice
  buttons removed. Useful field-specific dictation remains.
- Compact nonmodal panel with language choice, explicit Cloudflare audio consent,
  listening/processing/error state, cancellation and transcription. Opening the
  panel does not acquire a microphone. A written-command alternative works locally
  without consent to audio or a transcription provider.
- Natural Spanish navigation reuses existing routes and permission checks:
  `Crear socio`, `Buscar socio Juan`, `Buscar producto Café Especial`,
  `Crear producto`, `Abrir caja`, `Ver caja de hoy`, `Últimas actividades`,
  `Ver stock`, `Escanear socio`. `Hacer pedido` without an identified member opens
  the existing member selection; it never guesses a member or submits an order.
- Full administrative dictation reaches existing form consumers; Spanish/Italian
  spoken decimals and single-price corrections fill drafts only. No automatic save.
- Cash-today command activates the existing report tab after it is enabled,
  including asynchronous loading; it never opens a cash session or records money.
- Scope changes, offline events, permission revocation and cancellation discard
  pending audio; late responses cannot overwrite a newer manual edit.

## Evidence and limits

All browser API and database fixtures are synthetic and block external traffic.
Transcription responses are simulated. Native browser recording is tested separately
using a generated oscillator and the actual browser MediaRecorder; this demonstrates
encoding support, not recognition accuracy or physical microphone permissions.

Executed checks:

- `npm test`: 271 passed, zero failures, including permission/security and SQL
  regression tests against isolated synthetic databases.
- `npm run typecheck`: passed.
- `npm run build`: passed (Node runtime).
- Existing premium-home browser suite: six viewport cases passed, including Samsung,
  Pixel, small 320px, iPhone WebKit and large iPhone; navigation, profile/password,
  keyboard, responsive layout and club/platform separation use fixtures.
- Existing form dictation suite: IT and ES passed using real local MediaRecorder,
  simulated transcription and actual form fields, with zero automatic writes.

Voice browser regression: Samsung Chromium and iPhone WebKit both passed with
simulated transcripts, actual field population (including 10.50 → 5.20 price
correction on synthetic stationery), permission denial, cancellation, keyboard
simulation, local written fallback, cash-report tab and activity navigation.
Chromium also encoded a real synthetic oscillator through native MediaRecorder
(WebM/Opus, nonempty clip). The Linux WebKit runtime reported native recording
unavailable; its transcription/form tests use a simulated recorder and do **not**
certify recording on a physical iPhone. Written fallback was verified in WebKit.

Node and Cloudflare Worker sandbox builds both passed. Public-artifact scans found
no local service-role or AI test secrets. No Worker was deployed.

The panel closes after a successful draft update so that it cannot obstruct the
form. Audio consent is reset whenever the verified scope changes.

Structured browser evidence: `docs/VOICE2_ADMINISTRATIVE_BROWSER_RESULTS.json`.
Screenshots are actual local renders with synthetic identity, not mockups:
`docs/screenshots/voice2-premium-samsung.png` and
`docs/screenshots/voice2-premium-iphone-webkit.png`.

No physical Samsung/iPhone, live Whisper transcription, real microphone accuracy,
production permissions or Cloudflare quota have been certified by these local tests.
Existing free Cloudflare Whisper configuration is retained; no paid service or new
model is enabled. No voice automation of controlled-product delivery quantities is
added. All existing server-side authorization remains mandatory.
