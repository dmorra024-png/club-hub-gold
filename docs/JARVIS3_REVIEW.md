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
No neural quality/latency claim, automatic model download, paid hosting, or new
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
- No authenticated real Whisper/GLM call, physical microphone measurement, neural
  model inference benchmark or perceived-quality test was executed.
