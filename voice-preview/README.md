# SNOOP Voice Lab — isolated Samsung audio diagnostic

This folder implements a **separate** Cloudflare Worker called `snoop-voice-lab`, not `snoop-pilot`. It has no Supabase URLs, credentials, accounts or data. The page allows a person to capture a short synthetic phrase on a physical phone and see the literal response of the same Workers AI Whisper model used by SNOOP. It measures total tap-to-result time; it is **not** a reproduction of the continuous SNOOP session or an ASR quality certificate.

## Required explicit deployment steps (not performed)

1. Authorize deployment of this separate Worker. Do **not** enable Cloudflare Git automatic builds for the production Worker.
2. In Cloudflare via Wrangler and an account with permission, from `voice-preview/` run `npx wrangler secret put VOICE_PREVIEW_KEY --name snoop-voice-lab`, supplying a new random string of at least 24 characters. Never commit the key or put it in GitHub Action logs.
3. Run `npx wrangler deploy` from `voice-preview/`. Inspect the returned URL; expected Worker name is **snoop-voice-lab**. DO NOT rename to snoop-pilot.
4. Open the returned HTTPS URL on Samsung, enter the private key locally, grant mic access, speak only fictional commands and inspect the literal text.
5. Once testing is finished, remove the separate preview Worker. Never upload real member names, orders or financial data.

**Security:** The endpoint requires `VOICE_PREVIEW_KEY` and is unusable when unset; no database binding or persistent storage. This shared-key diagnostic is not a replacement for full Cloudflare Access / WAF rate limits. Use Cloudflare dashboard limits/Access when feasible, and disable the Worker promptly after testing. Workers AI calls may consume the account quota. The frontend does not cache or persist the key.

**Limitations:** This is an audio-transcription diagnostic only, with manual end-of-phrase. For a full-SNOOP PR #3 physical test, an independently isolated synthetic Supabase test backend and protected SNOOP preview deployment are still required; do not point a preview at production Supabase.

## Source
`worker.mjs` and `wrangler.json` only. No live deployment or account changes performed by the creation of these source files.
