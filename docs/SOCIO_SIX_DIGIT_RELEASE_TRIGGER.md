SNOOP Socio pilot — six-digit account activation release request.

Scope: only snoop-socio-pilot worker. Do not alter snoop-pilot, staff accounts, member data, balances or card identifiers.

Preflight: GitHub isolated checks and SQL migration verified, existing secrets retained. Cloudflare Resend sender configuration inspected separately.

Cloudflare deployment must refuse if expected Socio bindings or runtime checks are missing. Email delivery is NOT implied by publishing the member client.

The separate management mail-sending endpoint must be deployed and tested independently before declaring the complete flow operational.

Cloudflare Supabase auth compatibility patch: replace unsupported fetch redirect:error with manual, refusing redirects without exposing Supabase tokens. Validate signup and refresh fail closed with 4xx/5xx.

Single-code pilot release: Auth /verify magiclink OTP, update password, consume same OTP in club claim. No second Supabase signup email. Regression tests and bundling verified on isolated CI. Existing QR and secrets preserved.

Clear old service-worker shell cache v2 so the app no longer shows the obsolete separate email-confirmation page.
