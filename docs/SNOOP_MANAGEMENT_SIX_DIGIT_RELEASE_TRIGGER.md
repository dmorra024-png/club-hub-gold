Pilot management release of six-digit SNOOP Socio email activation only.

Preflight success: management worker typecheck, member claim test, security architecture and Cloudflare compiled bundle validation; expected existing Secret bindings verified. New Resend binding names verified through read-only Cloudflare audit.

Deploy targets the existing snoop-pilot environment only; same project and keys; preserves existing vars and secrets. This file is the explicit protected release trigger.

No data resets, no account edits, no wallet changes, no stock changes.

Resend error handling update: distinguish 401 invalid key, 403 sandbox recipient restriction, 422 sender validation, 429 rate limit. No provider response bodies, email addresses or OTPs logged. This is pilot-only.

Additional guarded error mapping for network, timeout, and missing provider message ID. No credentials or recipients exposed.

Cloudflare runtime fix: redirect:error causes TypeError before fetch reaches Resend; use redirect:manual and treat 3xx as failed safely without following bearer credentials.

Single-code update: management uses auth.admin.generateLink(type magiclink) to issue one 6-digit Auth OTP without a Supabase confirmation email; the same OTP is stored in the club's existing one-use claim table and sent through Resend. Client registration uses this code to confirm email, set password and activate card.
