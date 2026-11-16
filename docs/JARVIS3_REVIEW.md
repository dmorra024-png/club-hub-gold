# Jarvis 3 review — 2026-11-16

This is an incremental review, not certification of a completed Jarvis assistant.
No database, privacy mode, provider, secret or billing setting was changed.

## Code examined

| Project | Revision | Implementation inspected | License / finding |
| --- | --- | --- | --- |
| LiveKit agents | b480d16f8a0b05016a93edf800375cc3309ebf43 | voice/turn.py, speech_handle.py, agent_session.py, Silero VAD plugin | Apache-2.0 code; model licenses separate. Separate speech handles, turn decisions and interruption lifecycle are applicable without its infrastructure. |
| Pipecat | 348a9d8c83f6fb6c26a119cea1f5c43c1704fa31 | user_turn_controller.py, speech timeout stop strategy, Silero VAD, local smart-turn v3, LLM context | BSD-2-Clause code. Explicit turn state, activity timeouts and context ownership are applicable; Python/server components are not a browser drop-in. |
| alexberardi/jarvis | d2b7cf499bc148433347f4376fb15e4a175a42c7 | clone-repos.sh, mobile design, TTS rules | AGPL-3.0; repository orchestrates other repositories. No code copied into SNOOP. Not evidence of a ready standalone browser TTS engine. |
| supertonic-tts | 5379cc4e4297cec249a8a71283fc44d55ec327f1 | web/helper.js, web/main.js, web/package.json, iOS TTSService.swift | MIT wrapper; Supertonic 3 weights use BigScience Open RAIL-M. Browser implementation uses onnxruntime-web, WebGPU probe with WASM fallback. Italian and Spanish language tags exist. |
| Kokoro | official hexgrad/kokoro pipeline.py and hexgrad/Kokoro-82M VOICES.md | language pipeline and voice inventory | Apache-2.0. Requested GitHub hexgrad/kokoro-82m URL returns 404; official code repository is hexgrad/kokoro. IT/ES use EspeakG2P. Model documentation warns non-English support may be thin. |

Sources: https://github.com/livekit/agents, https://github.com/pipecat-ai/pipecat,
https://github.com/alexberardi/jarvis, https://github.com/skynet-labs-ai/supertonic-tts,
https://github.com/hexgrad/kokoro, https://huggingface.co/hexgrad/Kokoro-82M,
https://huggingface.co/Supertone/supertonic-3.

## Mobile neural TTS decision remains open

Supertonic 3 official model metadata lists ONNX payloads of 3,700,147 +
36,416,150 + 256,534,781 + 101,424,195 bytes: **398,075,273 bytes** before
runtime, voice styles and working memory. This is download size, not measured
peak memory. It is not appropriate to silently add this download to the installed PWA.
Kokoro ONNX quantized weights are 92,361,116 bytes (q8f16: 86,033,585),
before runtime and voice data. Examining the official `kokoro.js/src/voices.js`
and `phonemize.js` reveals only English voices enabled; other languages remain
under a TODO/commented section. Python support for IT/ES does not prove the
JavaScript package supports them. A multilingual G2P/voice port would need its own
verification rather than installing the current JS package and claiming success.
Neither neural engine has been benchmarked on a physical Samsung or iPhone here.
No mobile neural quality/latency guarantee, automatic model download, paid hosting, or new
remote speech provider is introduced by this change.

## Demonstrated application defect and incremental correction

The browser TTS helper previously left its 20-second watchdog alive after an
explicit cancellation. Cancellation also did not settle its completion callback.
A canceled reply could consequently cancel a newer reply or leave a turn waiting
for completion. The helper now owns one reply, settles cancellation once, clears
the watchdog and ignores late end/error events. Regression tests exercise two
consecutive replies and late events from the first.

Existing advanced settings now offer selection and preview of installed local
IT/ES voices. Unavailable/remote selections cannot bypass the local-only filter.
Starting recording stops a voice preview first. Text remains the fallback.
This is a device-voice improvement, **not a neural voice replacement**.

Existing private advanced diagnostics already display the in-memory transcript,
language and capture/transcription/interpretation timings. No telemetry or
persistent transcript store was added. Existing PILOT/REAL review gates and the
single GLM orchestrator are unchanged. Existing Whisper uploads remain batch
utterances; no streaming support is claimed.

## Verification boundaries

Unit/browser tests use synthetic fixtures and model/recorder doubles. They cannot
measure Cloudflare accuracy, real microphone performance, acoustic echo behavior,
or physical iOS/Android compatibility. End-to-end real audio, neural TTS mobile
benchmarks and comparative perceived quality remain required before calling the
Jarvis 3 request complete or publishing it as such.

## Executed checks for this incremental change

- 337/337 unit tests passed; TypeScript and production build passed.
- Client-secret scan: 76 public artifacts passed.
- Chromium mobile and WebKit mobile each completed 51 synthetic dialogue turns,
  with device speech and recorder doubles and no microphone/reply overlap.
- Dedicated browser assertions passed local voice selection and preview in both
  engines with zero microphone recordings during preview.
- No authenticated real Whisper/GLM call, physical microphone measurement or perceived-quality test was executed. The Piper CPU benchmark below is actual neural inference, distinct from browser/model doubles.


## Follow-up after PR #22 (ec78b03)

PR #22 is preserved, not recreated. Its per-language voice preferences are now
also exercised across an actual page reload in Chromium and WebKit test fixtures.
The same PR #21 remains the only development PR. Production baseline: 7794a37.

### Demonstrated diagnostic defects corrected

- Whisper previously caught every provider failure and replaced it with a generic
  unavailable message, including quota/rate limits and timeouts. It now emits
  closed, bounded codes for these cases, without echoing provider bodies or retrying.
- Invalid GLM JSON/schema responses now have a distinct bounded diagnostic rather
  than being indistinguishable from provider availability.
- Conversational GLM turns returned before the old transcript display was updated.
  The administrator can now opt into a private in-memory last-turn diagnostic in
  existing SNOOP settings: requested language, configured interpreter, component,
  result/error code, transcript and response. This is not a recording/transcript
  history, and is never sent to storage, analytics or a new provider.
- Continuous listening starts another recorder immediately. The last transcribed
  diagnostic is retained through that next capture so it can actually be inspected.
  Opening settings pauses listening; explicit close/stop clears diagnostic text.
  Changing user, club, status or permissions clears it and disables diagnostics.
- Collaborators cannot enable this admin-only diagnostic. Existing manual forms,
  authorization, REAL review gates, model selection, stock and cash logic are unchanged.

The diagnostic indicates configured local/anonymous navigation versus GLM PILOT/REAL.
It does not label local matching as a real GLM call. It cannot by itself establish
recognition accuracy; a trustworthy input/transcript comparison still requires
reference audio or an authorized real microphone trial.

### Smaller neural alternative: actual Piper CPU experiment

Runtime: piper-tts 1.8.0 / ONNX Runtime 1.32.0, Linux x86_64 CPU, telemetry disabled
before inference. Model snapshot: rhasspy/piper-voices
`e9ab671f2a0e50a701b34361136ba3e6a3a9eb0c`. Only fixed synthetic Spanish and Italian
text was synthesized. No SNOOP data, model weights or TTS dependency was added to
or deployed with the application.

| Voice | Model bytes | Load | First / warm synthesis | Audio duration | Process peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| it_IT-paola-medium | 63,221,984 | 0.798 s | 1.055 / 0.396 s | ~5.4 s | 186.4 MiB |
| es_ES-sharvard-medium, speaker 0 | 76,753,841 | 0.590 s | 0.351 / 0.374 s | ~5.7 s | 218.5 MiB |

These are measured desktop Python/native results, **not** mobile, WebAssembly,
WebGPU, Whisper or GLM latency measurements. Output WAVs and raw metrics are local
research artifacts outside the application. Perceived quality has not been certified.

Commercial/distribution review: the current runtime is GPL-3.0-or-later; the voice
repository metadata says MIT. The Italian model card identifies a CC0 dataset;
the Spanish model card identifies the University of Edinburgh Spanish Harvard
corpus (https://datashare.ed.ac.uk/handle/10283/574), CC BY 3.0, requiring attribution
when applicable. Review the exact runtime/model distribution obligations before
shipping a browser port; dataset labels alone are not blanket clearance.

Cloudflare documents a 128 MB isolate memory limit
(https://developers.cloudflare.com/workers/platform/limits/). This measured native
runtime exceeds it. Hosting this experiment in the existing Free Worker is not a
verified option. A browser port, its license compliance, actual phone RAM/startup,
and audible quality remain unverified. No new service, subscription, charge,
background listening or automatic model download is enabled.

### Minimal physical acceptance trial still needed

After an independently verified preview is available: choose Italian or Spanish,
preview the local voice, then use synthetic data only: “Crear socio”, “Nombre Ana,
apellidos Prueba”, “Nació el 12 de marzo de 1995”, “Cambia el apellido a Ejemplo”.
Check each field, interrupt with the stop button and confirm the microphone stops.
Do not save. The administrator's private diagnostic separates the transcript from
the interpreted response; close it afterward. This does not enable REAL mode or
waive its review requirements. Physical voice interruption is currently by button;
speech barge-in during playback is not claimed. Capture is paused during replies
so the assistant does not transcribe itself.

Full Jarvis 3 remains draft: authentic Cloudflare STT/GLM accuracy and latency,
physical Android/iPhone behavior and a deployable high-quality neural voice remain
unverified. These gaps must not be represented as passing simulated tests.


### Local conversation memory regression

A reproducible local-mode defect remained: after explicitly declining the optional
phone, correcting the city or surname recomputed the next question from empty
form values alone, discarding the negative answer and asking for the phone again.
The same regression executed against ec78b03 fails with “¿Quieres añadir un teléfono?”.
The local conversational state now preserves that decline across corrections,
compound-name clarification and review. An explicitly supplied phone clears the
flag. No new recognition regex, persisted member field, form validation rule or
save behavior is added. The existing form question reads this session state.
IT/ES unit cases and a browser local-dialogue regression cover the behavior.

### Synthesis diagnostics

Device TTS exposes only bounded outcomes (completed/cancelled/unavailable/error/
timeout), never native event payloads. Diagnostic observers cannot block turn
completion. Admin diagnostics can distinguish native synthesis failure from
Whisper/GLM failure while the normal text fallback and microphone serialization
remain intact. Explicit interruption is not mislabeled as an error.


### Final verification and release boundary

342/342 unit tests, TypeScript and production build pass locally. The new local
phone-decline regression fails against ec78b03 and passes after the state fix.
Quota-error tests likewise distinguish the old generic failure from the new
bounded code, without a real provider call. Local browser scripts and full CI
are recorded in PR #21; their transcript/model/recorder doubles do not establish
Cloudflare recognition accuracy. Preference reload tests, admin-only diagnostics,
explicit clearing and native synthesis failure are included in the CI browser job.
The tests also assert no transcript is persisted in localStorage/sessionStorage
and no automatic writes occur.

The Workspace exposes no authenticated live Cloudflare AI binding. No real-model
accuracy result is claimed from the protected deployment credentials, which have
not been extracted or changed. REAL processing review gates remain unchanged;
no attempt is made to test real personal data through DEMO/PILOT. A physical
Samsung/iPhone microphone and speaker are not accessible here. A verified mobile
neural runtime and its distribution obligations remain open. The private
in-memory diagnostics and bounded errors are implemented; a high-quality neural
voice is not yet integrated into SNOOP. PR #21 must remain draft and production
must remain unchanged while these release conditions are unmet.

Piper research WAV samples are downloadable in `docs/audio/`; they contain only
fixed synthetic assistant text. They are not app audio recordings or proof of
mobile inference. No runtime or model weights are shipped in SNOOP. The native
benchmark's RAM/CPU values must not be presented as browser/phone results.
Declining a phone in conversation does not override any club-required-field
validation: confirmation and existing form validation remain authoritative.
