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
