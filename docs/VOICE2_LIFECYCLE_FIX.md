# Voice 2.0 — recording lifecycle repair

Base branch: `codex/stabilize-independent-club`, synchronized through `4564192`.
No production database, account, secret, financial, order-confirmation or inventory
mutation logic is changed. No migration is required.

## Evidence and causes

Examined failed GitHub runs 42619906476, 42621393314, 42622735795 and 42625131582.
They do not establish one identical failure:

- 42619906476 waits for a recorder after two tracks have already been stopped;
  the shared start/toggle path could stop a recording that had just started.
- 42621393314 attempts a language change while the selector is disabled during a
  recording. Opening settings and starting the microphone were conflated.
- 42622735795 times out waiting for recording on a subsequent dictation.
- 42625131582 and the unchanged local browser suite also fail in lifecycle/error
  handling. The test helper incorrectly waited for successful recording even in
  the explicit permission-denied case. That expectation is corrected, not hidden.

Independent application regression, reproduced against the **old hook**:
`node scripts/test-voice-lifecycle.mjs --baseline` fails when an old `onstop` fires
while a new recorder owns the microphone: stopped-track count becomes **9 instead
of 8**. Old `release()` operated on global refs before checking the recording's
identity. It could close the new stream/context. The same regression passes with
the repaired hook on Chromium and WebKit.

The panel also closed during the transcript callback, before the hook released its
busy lock. A subsequent click could be ignored or use stale toggle state. The
repaired panel closes only once interpretation has completed and phase is idle;
the dock reflects startup/processing state and cannot accidentally toggle Stop.

## Application changes

- Per-capture ownership of stream, recorder, AudioContext, timers and cleanup;
  stale and duplicate callbacks cannot affect a later capture or upload twice.
- Explicit, idempotent start; stop remains a separate fallback action. The newest
  user gesture claims microphone ownership before asynchronous availability checks.
- A dock tap starts directly after initial consent. Accepting initial consent also
  starts directly. Consent is scoped to authenticated user + club; settings-only
  opening never starts audio. Consent UI input is not treated as a manual edit to
  an administrative form.
- AudioContext resumes inside the initiating gesture, before network awaits, for
  mobile autoplay requirements. Local sustained-signal/silence detection finishes
  a phrase after 1.6s silence. Continuous dictation is no longer forcibly cut at
  12/15 seconds; maximum duration is 60s. No detected speech is an error, not an
  invented transcript. Unsupported analysis is explicitly reported with manual
  stop/written fallback.
- Product/category/stock navigation preserves the requested existing tab and full
  command. No save or economic confirmation is automated.
- Four equal dock columns and 26px icons are preserved and checked from actual
  rendered geometry, including aligned labels and no elevated QR.

## Verification

- 275 unit/security tests, TypeScript, Node and Cloudflare sandbox builds.
- Dedicated real-hook browser regression on Samsung Chromium and iPhone WebKit:
  six consecutive recordings, duplicate starts, interpretation lock, delayed
  onstop, normal track cleanup, local endpoint, contextual-microphone ownership,
  scope/language cancellation and permission recovery.
- Three additional consecutive captures using native Chromium MediaRecorder and
  WebAudio with a synthetic tone followed by silence: automatic completion without
  pressing Stop. Transcription is simulated; this is not a physical microphone or
  Whisper accuracy test.
- Full application browser suite exercises nine consecutive single-tap commands,
  automatic endpoint, actual routes/tabs, field population, IT/ES decimals, manual
  edits, cancellation, permissions, offline/errors and zero automatic writes.
- PostgreSQL 17.11 local concurrency tests use seven connections, isolated network,
  no public ports and synthetic records; no remote database is used.

Full existing browser regression results and final command statuses are recorded
in `VOICE2_FINAL_RESULTS.md` after execution. Local screenshots are real renders
with synthetic club data. Physical Samsung/iPhone microphone and live Whisper
accuracy remain unverified. No paid service or additional model is enabled.

## Publication gate

The branch is still connected to Cloudflare Workers Builds. The baseline commit
has an automatic Worker build check. Cloudflare documents that repository pushes
trigger builds/deployment: https://developers.cloudflare.com/workers/ci-cd/builds/.
The user explicitly prohibits deployment. Therefore a normal branch push must not
be used until this automatic publishing connection is disabled or a verified
non-deploying path is available. GitHub object creation without updating a branch
reference does not emit a branch push and can expose the reviewable commit safely.
