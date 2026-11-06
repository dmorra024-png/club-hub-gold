# SNOOP initialization security verification — 2026-11-06

Use the regenerated `SNOOP_PILOT_INITIALIZE.sql` once, on an empty dedicated SNOOP Supabase project. Do not use the earlier commit's download. No remote database has been accessed.

## Corrections

The old `auth read members`, `auth insert members` and `auth update members` policies were already dropped dynamically by the multi-club migration. Their presence in historical SQL did not describe the final catalog. The fresh initialization now omits ALL historical CREATE POLICY statements and installs only the reviewed authoritative set. The new upgrade migration removes obsolete policies without deleting records.

* 57 final policies, covering all 18 public tables and private storage objects; exact roles, commands, USING, WITH CHECK and PERMISSIVE/RESTRICTIVE mode are checked against an explicit allowlist before COMMIT.
* Restrictive tenant fences protect all 11 tables containing club administrative records, even if another permissive policy is accidentally added.
* Administration checks use the target club's administrator role rather than an administrator role in any club.
* Browser roles cannot insert/update/delete roles or permissions, truncate administrative tables, create objects in public, or access service-only email tables/RPCs. Signup creates a profile without privileges, even when no Super Admin exists.
* Cross-club references are rejected by composite foreign keys. Historical rows are retained via NOT VALID constraints.
* The legacy SECURITY DEFINER RPC is limited to authorized callers and products from the member's club. No new commerce functionality was added.
* Category names and member numbering are isolated by club. Authorized staff can register members without privileges on the legacy global sequence.
* Anonymous access is limited to active club login branding columns. Private documents remain club-scoped.

## Actual results

| Verification | Result |
| --- | --- |
| Complete automatic suite, including existing tests | PASS — 106/106 |
| New full-bundle security regression tests | PASS — 27/27 |
| Both TypeScript projects | PASS |
| Full final RLS catalog / exact policy expressions | PASS — 57 policies |
| Staff A/B cross-club reads, inserts, updates, deletes; no-role and anonymous access | PASS |
| Role/permission escalation and signup metadata escalation | PASS |
| Account that is admin in A and collaborator in B | PASS |
| Own-club authorized member registration/update; staff without permissions denied | PASS |
| Private documents, service-only email infrastructure and privileged RPCs | PASS |
| Accidental permissive policy does not bypass restrictive tenant fence | PASS |
| Repeated initialization rejected, existing synthetic records retained | PASS |
| Native Supabase extensions / Auth and Storage HTTP services | BLOCKED — local Docker daemon unavailable |
| Remote Supabase execution | NOT RUN — explicitly excluded |

Command: `npm test` (or `npm run test:security:initialization` for the new regression alone).

Tests execute PostgreSQL 17 via the existing local PGlite dependency. The whole generated application SQL is loaded, including grants, policies, triggers, constraints and final assertions. Auth/Storage schemas and JWT functions are local fixtures. Only installation statements for pg_net, pg_cron, supabase_vault and pgmq are excluded because these native server extensions are unavailable in PGlite; the queue RPC implementations are loaded and their browser access is tested as denied. A synthetic gen_random_bytes fixture supplies a default required by historical DDL; it is never included in the downloadable SQL. No real data, remote connections or credentials are used. Passing these tests is not a claim that native extension services or a remote deployment have been tested.

`FINAL_RLS_POLICIES.json` contains the complete observed final policy catalog. `SECURITY_TEST_RESULTS.json` lists the actual 27 security checks. The initialization manifest contains migration hashes and the downloadable SQL's SHA-256.
