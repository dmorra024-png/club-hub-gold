# JARVIS audio regression — development only, 23 November 2026

Production provenance was checked independently. The latest successful release found
is run 45154177260, branch `release/snoop-generales-merma-access-20261123`, source
`ff60d647f000398bd5fbd06654cba542499f890e` (application matches verified 3adb0ec),
Worker version `f0eff938-e677-4ecc-b178-6fd11038438e`. The old `main` workflow pin
is not the current application release. No deployment was performed here.

## Reproduced failure, not a hardware claim

A browser context interrupted during getUserMedia, before audio.current was assigned,
was missed by the previous onstatechange guard. The old component then accepted
AppReady and displayed listening/speaking despite a suspended AudioContext. The new
mounted regression on the unchanged PR head 863267d fails waiting for Riattiva audio;
its log is retained in the execution workspace. The fixed mounted application passes
in Chromium and WebKit, queues 2,400 samples, schedules none while interrupted, and
plays nonzero samples after one recovery gesture without replacing the socket.

The published component also lacks AgentStartedSpeaking recovery after interruption;
that fix already present in this PR must be retained when reconciling the release.
A fresh response must not inherit suppression of a canceled response.

## Implementation

- One bounded PCM player: signed little-endian mono 24 kHz; split samples survive odd
  binary frame boundaries. Browser output sample-rate conversion uses Web Audio.
- Audio waits in a bounded 30-second memory queue while the device blocks playback.
  No audio is persisted. Interruption, reconnect, stop and disposal cancel old nodes
  and buffers; a stale completion cannot announce a finished response.
- Recovery rechecks the actual context state instead of treating a resolved resume()
  promise as proof of running audio. No device speech-synthesis fallback is introduced.
- Provider completion without binary audio and all-zero PCM have separate diagnostics.
- Admin diagnostics contain counters, context state and connection flags only. No
  transcript, token, recording, account identifier or external diagnostic log is added.

## Evidence and limits

Five PCM unit regressions pass. The existing 414 tests plus those regressions passed
(419 total) before release-source reconciliation. Chromium and WebKit OfflineAudioContext
render the actual decoded PCM: nonzero RMS, expected 440 Hz signal, 24-to-48 kHz
conversion, and 220 Hz replacement after interruption. Suspended audio renders after
recovery. These test real browser DSP, not speakers, microphone accuracy or Deepgram.
`scripts/test-voice-pcm-browser.mjs` records numeric results in `.sandbox/voice-pcm`.
Mounted tests use synthetic authentication, microphone and provider and assert zero
business writes. Live Deepgram and physical Android/iPhone audibility remain unverified.

This is an audio correction, not certification of full manual/voice parity. Reconcile
current application services and rerun all checks before a future authorized release.

## Consecutive-turn regression

A separate Workerd regression deliberately omits the optional `AgentThinking` event.
Before the fix, the 20-turn scenario fails waiting for a subsequent accepted proposal:
`AgentStartedSpeaking` did not clear the user-speech flag, so later utterances did not
reset the per-turn tool budget. The fix treats the explicit spoken-response event as
the end of the preceding user turn. The limit remains eight tool calls per turn; it
is not increased or removed. The identical 20-turn regression now passes, including
authenticated tools, rejected identities/clubs and metering close retry. Upstreams are
synthetic, and no production database or live Deepgram call is involved.

After current-release reconciliation, 491 unit/integration tests and TypeScript pass.
PostgreSQL 17 concurrency checks pass with isolated synthetic records: seven competing
annulment requests produce one reversal, and seven refund requests produce one refund.
These tests do not execute physical payment or change production inventory.

## Current manual-registration regression

The current release intentionally navigates successful registration to the created
member card and uses the authenticated App Socio email invitation instead of the
retired staff-visible QR export. The old browser script expected the list and QR export.
Its failure was reproduced without changing the registration engine. The revised test
verifies the actual created member URL, exact invitation server function and one request,
retains double-click/amount/renewal/signature/error checks and mocks email acceptance
only. It does not claim delivery. Registration and renewal regression now pass in
Chromium and WebKit; no Socio application code is changed.

## Desktop access and current-release browser contracts

The released desktop CSS hid the entire dock, including the only SNOOP entry.
The same desktop mounted regression fails waiting for that visible button before the
CSS correction. Desktop now places the same single control in the existing rail;
mobile layout is unchanged, hidden keyboard state is retained, and no second microphone
or business action is introduced. Desktop/tablet scenarios are added to the mounted test.

Browser contracts also follow the current published management UI: the current Home
welcome and amount selectors, decorative (not fabricated data) trend, actual cash-report
server function, and privacy-preserving email invitation. Original financial, role,
club isolation, password, keyboard, signature, idempotence and no-write assertions stay.
The financial browser fixture now explicitly answers the exact verified wallet-payment
state function; it no longer incorrectly returns a history object to that function.
Its missing-migration scenario waits for the two actual activities before counting
buttons, and still proves that confirmation is unavailable and zero writes occur.

Final local mounted flow passes in Samsung Chromium, iPhone WebKit, desktop Chromium
and tablet WebKit. It verifies exactly one visible entry; desktop bounds place it wholly
inside the existing 248px rail. The same socket survives navigation; provider failure,
collaborator fallback and zero automatic writes are checked. Synthetic provenance and
per-engine outcomes are in JARVIS_MOUNTED_BROWSER_RESULTS.json. Real browser DSP results
are in JARVIS_PCM_BROWSER_RESULTS.json. These are not live Deepgram or physical-device
certifications, and do not establish complete voice write parity.

The full Account security job also exposed an obsolete administrative-records mock:
all requests containing memberId were counted as order-history reads, including the
current wallet status query. The fixture now identifies the exact compiled wallet
functions, returns an explicit disabled-club state, and denies wallet-payment reads
without cash permission. The original lazy-history assertion remains zero before
opening history. All six admin/staff/no-finance Chromium/WebKit scenarios pass.
No application history loading or wallet authorization logic was changed.

Current catalog/keyboard and cash consistency regressions also pass locally. The
catalog fixture explicitly permits only the exact read-only wallet-member status
function with the expected member ID; its generic availability guard still rejects
other nonempty requests. Cash retries are scoped separately to Home and report,
so the activity retry is never mistaken for the cash retry. Keyboard-close checks
wait for the actual asynchronous React visibility update after blur; the landscape
assertion remains enforced with geometry-only failure diagnostics. No keyboard hook,
order calculation, cash formula or production permission was changed for these tests.
Samsung, iPhone WebKit and simulated standalone PWA keep the same DOM fields/cards and
values across keyboard/rotation/resume. Six admin/staff Android/iOS/PWA cash cases retain
correct totals, error-not-zero behavior and the overnight session boundary.

## Demonstrated current-release keyboard regression

The full critical browser flow exposed a real CSS precedence defect, not an accounting
or parser failure. Unified non-home page styling overrode keyboard scroll padding.
The new regression on the pre-fix build reports `padding:122,inset:500`; the profile
password field remained below the simulated 300px visible viewport. A narrowly scoped
keyboard-only CSS override restores `24px + keyboard inset`, leaving closed-keyboard
premium layout and all form/business functions unchanged. The exact regression now
passes for member/profile/cash/product/collaborator fields on Samsung Chromium and
actual WebKit engine with simulated keyboard geometry. No physical keyboard claim.

The critical email UI test now targets the current authenticated invitation, not the
removed QR delivery widget: five explicit simulated requests verify that only accepted
is acknowledged and no response is presented as proof of delivery. Existing queue and
provider delivery-state unit tests remain. Both complete critical browser flows pass.

The final regression pass distinguishes existing read-only server metadata from model
requests. Voice 2.0's strict no-personal-data model assertion remains unchanged; only
the exact compiled wallet-activity read with `{limit:100}` is separately mocked. The
product-information browser guard separately identifies the current optional access
control GET; its zero obsolete-archive-call and zero-write assertions remain enforced.
Both scripts accept the isolated test API origin explicitly instead of requiring a
local production-origin configuration. No application AI/privacy gate is relaxed.

The legacy standard voice browser test now compares the current approved dock's
interactive geometry (four equal columns, equal top/height, minimum 44px touch areas,
and legible SVGs contained in each column). It does not force the released QR and
branded SNOOP artwork to share the old identical inner-SVG dimensions or misidentify
the branded container as a text baseline. No application artwork changes accompany
this test update. The actual 51-turn AI dialogue, conversational member flow, continuous
session and private diagnostics/preferences tests pass on Chromium and WebKit with
synthetic audio/provider data. These results are not real-provider accuracy evidence.
