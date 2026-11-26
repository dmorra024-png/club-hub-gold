# JARVIS code-only pilot deployment, 26 November 2026

Exact source: f8f8cddd2b872b523a0a98aaeb42f7c884a88117.

This trigger publishes only the reconciled client/Worker code to the existing snoop-pilot target. All new persistent voice execution stays disabled until missing live SQL dependencies are reviewed; no migration is applied. Existing Monedero bindings, accounting, stock, App Socio and REAL are preserved. This release must pass build, TypeScript, security, binding preflight and post-deployment health check.
