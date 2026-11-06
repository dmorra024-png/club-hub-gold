# Authorized SNOOP voice activation — prepared, not deployed

Only the existing `snoop-pilot` Worker and Snoop-pilot database are in scope. No deployment, remote inference, database write, billing change, new token or account provisioning has been performed. A read-only project check found an existing non-platform Admin assigned to an active club.

## Configuration and privacy

The existing `SNOOP_AI` binding is retained. The prepared configuration enables `AI_EXTERNAL_PROCESSING_ENABLED`, `AI_VOICE_PROCESSING_ENABLED` and `AI_VOICE_ONLY`. It keeps personal-field model processing, document processing and browser speech recognition **false**. The only inference required by this profile is `@cf/openai/whisper-large-v3-turbo`, with explicit `it`/`es`, `task=transcribe` and voice activity detection.

Only the user's explicitly recorded audio goes to Workers AI. Stored member records, current form values, club catalogs and conversation history are not passed to a text model. Field extraction and administrative/catalog command interpretation run locally inside the SNOOP application. Original model-based capabilities remain in source for separately authorized profiles; they are not silently activated by the voice opt-in. Document OCR, synthetic speech and image generation are not enabled by this profile.

The profile refuses alternate providers even if an old API key exists, and never retries a quota error or selects a different model. Recordings stop after one minute; the form rejects oversized audio and prevents an upload after unmount. Provider errors are sanitized. Transient voice payloads are session-only and cleared on logout; no automatic member, stock, payment or account save occurs.

The documented Workers Free allocation is 10,000 Neurons/day. No paid-plan upgrade, prepaid credits or paid-only model is configured. The existing Free account/available quota and actual model accuracy have not been revalidated through a live inference during this preparation. A Free quota exhaustion must fail into manual input; unlimited use is not promised.

## Actual verification

| Check | Result |
| --- | --- |
| Complete automatic suite | PASS 142/142 |
| Italian/Spanish transcription contract, local field parsing and command drafts | PASS with simulated Workers AI binding |
| Documents, personal text models and browser recognition remain off | PASS |
| Invalid audio, free quota failure, no retries or alternate-provider fallback | PASS |
| Existing public/secret runtime-binding types and Worker/database/origin isolation | PASS |
| Browser microphone + MediaRecorder + form population + no automatic writes | PASS IT and ES, real Chromium synthetic audio device and mocked transcription/API |
| TypeScript and Cloudflare-module build | PASS, synthetic sandbox mode |
| Worker dry-run and public secret scan | PASS, 58 public artifacts |
| Remote Cloudflare transcription and physical Samsung/iOS microphone | NOT RUN; deployment is not authorized and no Cloudflare token is available in this execution environment |

The browser test does not certify speech-to-text accuracy: its transcription response is simulated. It does exercise actual recording, encoding, language selection, server-function request shapes and form rendering. All data/audio are synthetic; external browser requests are blocked.

Commands: `npm test`, `npm run typecheck`, `npm run build:worker:test`, `npm run worker:dry-run`, `npm run test:security:bundle`, `npm run test:voice:activation`, and `npm run test:voice:browser` against the local sandbox dev server.

## Deployment operation awaiting approval

Authorize the existing manual **SNOOP pilot — deploy manually** workflow for the reviewed branch/commit. It must update **only** the existing `snoop-pilot` Worker with the prepared voice configuration and use only the existing protected `SNOOP_*` GitHub secrets. No database migration or new secret is needed for this voice update.

Before publishing, `prepare-snoop-runtime.mjs` inspects this Worker's binding metadata. It preserves existing secret types, prepares public settings as variables, and refuses an unsafe private-key binding. After publishing, `upload-snoop-runtime.mjs` updates only required secret-type bindings through stdin and never logs their values. This avoids the earlier blind attempt to upload existing public variables as secrets. These operations have been unit-tested with synthetic binding metadata; they have not been executed against Cloudflare during this preparation.

The workflow still requires `workflow_dispatch` with `DEPLOY-SNOOP-PILOT`; push does not trigger its deployment job. After approval/deployment, verify voice from the existing operational club Admin on Samsung. The Super Admin remains platform-only and cannot use club voice functions, as required by the platform separation policy. A new deployment will not change that boundary.
