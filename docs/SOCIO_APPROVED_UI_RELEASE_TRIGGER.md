# Restore approved SNOOP Socio UI — controlled pilot release

Source of truth: SNOOP_Codex_Premium_Design_Pack.zip /
01_RIFERIMENTI_APPROVATI/01_ORIGINALE_Socio_BluOro.png.

Scoped to Socio client UI and public build assets, no database or backend mutations.
Baseline rollback SHA: 8c6f2ddc6773af45e1457b458a84342e5824f4f0
Rollback ref: rollback/snoop-socio-pre-approved-ui-20261120

Test evidence:
- PR #43 mobile Chromium/WebKit acceptance, including QR, logins, clubs, wallet and logout: success.
- Isolation and DB schema tests: success.
- Dry-run and public bundle: success.
- Latest Socio isolated run #44705929964: four jobs passed before this trigger.

Deployment workflow verifies backend files are byte-identical to the pre-restore live baseline and keeps existing Cloudflare secrets.

2026-11-20 format-only correction: member card 1.53:1, permanent card QR unchanged, last activities panel visible when wallet disabled, menu anchored inside screen on both mobile browser engines. Isolated suite run #44708009097: four jobs successful.
