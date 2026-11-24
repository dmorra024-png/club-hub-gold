# JARVIS application coverage — release candidate, not production parity

Original base: `7c701cd`. Current reconciliation uses the actual application published by
workflow **45154177260**, release commit **ff60d647f000398bd5fbd06654cba542499f890e**
(application source `3adb0ec53c383c7430ea74f94c0c013554e18143`, Worker version
`f0eff938-e677-4ecc-b178-6fd11038438e`). `main` is a workflow branch and is not the
application source. Released management dependencies are reconciled without a production
merge or deployment. Independent `apps/socio` development is excluded and unchanged.
Existing cash, wallet and order business logic is imported from that release, not rebuilt.
No REAL, credentials, production database, schema or RLS changes.

Current regressions also verify the moved discount editor in `/ajustes/generales`,
Personalizaciones, wallet/theme settings destinations and member search readiness.
The administrative discount proposal is routed to the current General settings page;
no duplicate editor is introduced. The separately scoped Socio composition test was not
imported because it requires changes in the excluded Socio application.

## Demonstrated defects addressed

- The existing cash voice reader set `fetch.redirect` to `error`, unsupported by
  Workerd. The complete synthetic WebSocket cash-tool test failed before Supabase
  was contacted, despite passing Node unit tests. Use `manual` and explicitly reject
  every 3xx response; credentials are never followed to a redirect destination.

- `UserStartedSpeaking` muted queued audio until `AgentThinking`. A subsequent
  `AgentStartedSpeaking` was neither forwarded nor handled, leaving that valid response
  muted if no thinking event arrived. Forward/handle the explicit new-response signal.
  Browser regression sends PCM after interruption without a thinking event.
- Device-suspended audio had no recovery feedback/control. Display a recovery button
  only when AudioContext reports suspended/interrupted; resume in the user's gesture.
  This does not promise automatic playback where Safari requires a gesture.
- Category matching rejected accents and small transcription errors. Normalize accents;
  allow one character error only for a unique label of at least six characters. Ambiguous,
  unknown and short labels still require clarification. No category is created or selected
  from pronunciation hints alone. Product-search correction uses the same bounded rule.
- Both catalog sanitizers discarded otherwise valid labels such as `Gelato #41`,
  `Gorilla Glue #4`, `Flores / CBD` and `CBD 10%`. The new regression fails before the
  fix and passes after preserving ordinary catalog punctuation. Control characters,
  markup, duplicates and oversized values remain excluded; names remain data, not tools.
- Missing route methods could silently return via optional calls and produce successful
  receipts. Require actual snapshot/patch/open/search capabilities and recheck stale scope
  after waits. No simulated button clicks or fallback saves.
- Cash tool was limited to today. Add an explicit validated calendar-day tool, reuse the
  manual authenticated report calculation, open that same day in the existing report, and
  retain Europe/Madrid DST and collaborator filters. No accounting calculation is changed.

The initial vocabulary was limited to 35 names per list. The on-demand catalog tool now queries the actual tables with the current user JWT, explicit club and active/unarchived filters. It returns at most six names plus a truncation marker, never pricing, stock quantities or member data. Verified category results can subsequently be used in drafts; ambiguous results require refinement and failures remain distinct from successful empty searches. No public diagnostic endpoint was added.

## Manual-to-voice matrix

Navigation means a real route/tab opens, NOT that all actions on that page are automated.
Draft means fields change in the existing form; saves remain manual. Read means the
server uses the authenticated user's existing query, not a service-role bypass.

| Existing screen / function                           | Voice capability in this branch                                                                                | Remaining limitation                                                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Home (`/`)                                           | Navigation                                                                                                     | Home widgets remain manual                                                                                                           |
| Socios list / management (`/soci`, `/soci/gestisci`) | Navigation + local authorized search                                                                           | Selecting a particular member by ambiguous name needs explicit resolution                                                            |
| New member (`/soci/nuovo`)                           | Progressive name, surname, birth date, city, phone, validated email, address, postal code and uniquely resolved existing membership-fee drafts; corrections; refused phone remembered               | Identity document/signature and final registration/payment remain manual; synthetic personal data only                                                             |
| Member details (`/soci/$id`)                         | Selected-member field corrections; open QR, history, discounts and renewal sections through scoped ports              | No guessed IDs, automatic renewals, outgoing email or signature fabrication                        |
| Member import (`/soci/importar`)                     | Navigation, existing manage-members gate                                                                       | File selection, validation and import manual                                                                                         |
| Products (`/productos`)                              | Navigation, existing search, on-demand authorized name lookup beyond the initial snapshot, name/category draft | Pricing, inventory and final writes not exposed by this voice schema                                                                 |
| Categories (existing Productos tab)                  | Open tab, on-demand verified category lookup, prepare category-name draft                                      | Rename/archive/delete manual                                                                                                         |
| Stock (existing Productos tab)                       | Open tab and search                                                                                            | No voice inventory mutation or distribution automation                                                                               |
| Member order (`/soci/$id/pedido`)                    | Not newly automated                                                                                            | No guessed member, automatic payment, fulfillment or stock change                                                                    |
| Caja (`/caja`)                                       | Navigation; prepare explicitly dictated opening fund, counted closing cash and notes in existing forms                | Saving/opening/closing remains explicit manual confirmation; no inferred cash counts                                                                                  |
| Caja report (same page)                              | Today's aggregate or explicit valid Madrid calendar day, real authenticated source                             | Voice period receipts now supported (inclusive Madrid dates, up to 366 days); individual session drill-down and writes remain manual |
| Activities (`/actividades`)                          | Navigation                                                                                                     | Audit detail and cancellations remain manual; original audit preserved                                                               |
| Reports (`/ajustes/informes`)                        | Navigation, same view-reports gate                                                                             | Report filters/exports manual                                                                                                        |
| Settings (`/ajustes`)                                | Navigation, active staff landing; admin-only children                                                           | Settings changes manual                                                                                                              |
| Collaborators (`/ajustes/colaboradores`)             | Navigation + first name, surname and email in existing invitation form                                         | Invitation and permissions remain explicit manual actions                                                                                            |
| Member settings/discounts (`/ajustes/socios`)        | Navigation + discount name, percentage, optional validity; prepare a verified existing discount assignment     | Saving, activation and member-field configuration remain manual                                                                                               |
| Fees (`/ajustes/cuotas`)                             | Navigation + existing fee editor drafts (name, duration, explicit amount)                                      | No approved fee or historical receipt changed automatically                                                                                  |
| Devices (`/ajustes/dispositivos`)                    | Navigation, admin-only                                                                                         | Device configuration manual                                                                                                          |
| Access control (`/control-acceso`)                   | Navigation, same manage-members gate                                                                           | Camera/access decisions use existing manual flow                                                                                     |
| Profile (`/perfil`)                                  | Navigation, preserves active voice session                                                                     | Password and logout remain secure manual operations; never dictate credentials                                                       |
| Legacy `/cuotas`, `/geneticas`                       | Deliberately no new destination/menu                                                                           | Existing hidden/legacy data preserved; no parallel archive                                                                           |
| `/snoop-admin`                                       | Not available to club-admin pilot                                                                              | Separate Super Admin access preserved                                                                                                |
| `/club-status`, authenticated route guard            | No operational voice access                                                                                    | Suspension and recovery policies unchanged                                                                                           |
| `/snoop-demo`                                        | No production voice tool                                                                                       | No new demo path introduced                                                                                                          |
| SNOOP Socio / Monedero (PR #25)                      | Released transaction services preserved; wallet-aware receipts and existing topup form draft                                                                                                       | Separate development untouched                                                                                                       |

## Verification and release boundaries

Unit/integration fixtures validate permission checks for every registered destination,
ambiguous vocabulary, missing methods, invalid dates, Madrid's 25-hour DST day,
collaborator filtering, minimal aggregate output, and absence of financial writes.
The existing full suite is retained. Gateway Workerd tests use **synthetic upstreams**.
Chromium Samsung and WebKit iPhone tests use **synthetic auth, audio and provider**:
they exercise mounted forms, manual-edit protection, new-response audio recovery,
device-suspension recovery, profile/report navigation and a single continuing socket.
These are not physical-phone or live Deepgram recognition-quality measurements.

No authenticated Ddr browser session or physical microphone is available in this workspace.
The production Worker must not be used to test code that has not been released. An HTTP
200 or anonymous WebSocket rejection is not proof of positive authenticated voice service.
Full feature parity, real provider latency/accuracy, hardware playback and real writes are
therefore **not accepted/completed** by this PR.

Before any later release: disable uncontrolled Cloudflare Builds (the last control API
attempt returned 403/10000), require the protected CHECK-SNOOP-BINDINGS to pass, verify the
exact authorized SHA and pilot scope, retain REAL disabled, and use the protected release
workflow only with explicit owner authorization. Keep the last verified Worker version and
binding manifest for rollback; do not replay migrations or restore business data.

Minimal later phone acceptance with fictional data: start SNOOP; request a new member;
dictate/correct names and decline phone; navigate to profile/products; search an existing
label; request the cash report for an explicit date; interrupt an answer; let a response
finish; continue past 90 seconds; background/return. Check the visible fields/date against
the spoken request. Do not confirm any real registration or economic operation.

## Follow-up: period reports and sourced information

The voice gateway now exposes `snoop_cash_period` using the existing ledger reader
and receipt calculations. It validates inclusive ISO dates, at most 366 calendar days,
checks cash/report permissions, uses the current user JWT, and returns receipt totals
only. Opening balances, counted money and refunds are not misrepresented as receipts.
The same source deduplicates records and excludes cancelled orders. No accounting
records or calculations were rewritten. Browser status shows the actual requested range.

`snoop_genetics_information` reuses existing source research without changing the image
engine or creating an archive. Public requests are hostname-restricted, bounded,
redirect-blocked and contain no user JWT/API key. Results carry source URLs; the
existing voice panel exposes safe informational citation links. Unavailable evidence
is reported as unverified, not replaced by invented facts. No photographs are copied.

A real Internet check on 18 November 2026 found attributed information for Amnesia Haze,
Gelato 41, Runtz, Wedding Cake, Northern Lights, White Widow and Zkittlez. Gorilla Glue
had no verified exact match. Public-source request time was about 4.9–7.3 seconds per
query. These numbers measure source retrieval, not Deepgram speech or physical-phone
latency. The machine-readable evidence is `/workspace/shared/jarvis-genetics-live.jsonl`.

The released management application now includes the approved Monedero integration.
The earlier statement that the wallet services were absent was obsolete. Voice period
reports now reuse its authenticated cash-evidence reader, count topups once and exclude
wallet-funded consumption from a second receipts count. Other collaborators' topups
are excluded in own-scope reports. Evidence failure fails the request, never a false zero.
Wallet transaction services and `apps/socio` have not been modified relative to release.

The released settings landing was visible to collaborators but its parent route guard
redirected them home. A reproducing unit test failed before the fix. Only `/ajustes`
and `/ajustes/` now open for active staff; privileged children remain admin-only, and
reports still require their permission. Browser tests exercise the actual menu link.

Selected-member correction uses `member_edit`, never the creation route. The existing
member editor receives only explicitly requested fields. It compares against the loaded
record and last voice patch, preserving intervening manual edits. The capability is
scoped to the mounted member, account and club. It does not submit or send current
member values back to Deepgram. Saving remains the existing explicit manual operation.

There is no connected physical Android/iPhone or authenticated Ddr browser session
in this workspace. New code is not deployed. Therefore real-device/positive live
Deepgram acceptance cannot be declared or replaced by WebKit simulation. Full
manual/voice parity remains unaccepted; no merge or release is performed.

## Reconciliation regression evidence

- Unit suite: 414/414 on the reconciled tree, including synthetic PostgreSQL tests.
- Selected-member corrections preserve source fields and manual overrides; account/club
  scope, readiness and forbidden document/role/money fields are covered.
- Member-section commands reveal the existing QR, discount, renewal or history area;
  history additionally requires the same economic/report permission as its component.
- Cash drafts accept explicit decimal euro strings only. Opening funds and closing counts
  cannot be mixed. The existing session state determines which form can be prepared.
- A new browser regression initially failed while changing from a historical report to
  the current cash form. Route ports now expose readiness; the command waits for the
  verified current report instead of applying against a pending reload. No write RPC
  is invoked by this preparation. Manual edits still win.
- Chromium Galaxy S9+ / WebKit iPhone 13 exercise the actual mounted pages with synthetic
  audio, authentication, data and provider. These are not physical-device or live-Deepgram
  measurements. Screenshots are generated in `.sandbox/deepgram`.

This evidence does not certify complete manual/voice parity or authorize a release.
The PR remains a draft and no production merge, deployment or REAL activation occurred.

## Additional existing administrative forms

`administrative_draft` uses one typed form registry. It cannot carry arbitrary roles,
IDs, credentials, permissions or confirmation flags. Server validation enforces the
existing admin-only forms; wallet preparation additionally requires both member and
cash permissions. The route owns its capability and rechecks availability.

- Collaborator invitation: prepare first name, surname and email only. Permissions
  and the actual invitation remain manual. No email or account is created by voice.
- Membership fee: prepare name, duration and an explicitly stated euro amount in
  the existing editor. Decimal values are normalized to that editor's representation
  before ownership checks, allowing consecutive corrections without false manual-edit
  detection. No quota or historical accounting mutation is invoked.
- Discounts: prepare the existing editor's fields and optional dates; select a unique
  existing active/nonexpired discount on the selected member. Unknown names are
  rejected. New items/currently open editors are supported; no guessed record ID.
- Monedero: prepare the existing topup amount, only for an enabled club with an open
  authorized session. The confirmation checkbox is cleared when voice changes the
  amount. A pending uncertain operation blocks voice changes. Activation, settlement,
  idempotency keys, wallet RPCs and the independent Socio application remain untouched.
- Navigation/read acknowledgements no longer request a second confirmation. Drafts
  still require manual confirmation; review emits `confirmation_required`, never
  a claim that data were saved.

Chromium/WebKit tests mount each real form, test corrections and unknown discounts,
assert zero automatic writes, and run with synthetic wallet status as a separate CI
build. `.sandbox/deepgram/administrative-results.json` explicitly identifies fake
provider/audio/auth and whether the wallet-enabled scenario was run.

## Rendered confirmation access

Visual review of the iPhone fee-editor screenshot exposed an actual obstruction:
its Save footer was covered by the active voice panel. Active listening now uses a
bounded compact top indicator, leaving the header menu controls and modal footer
usable. Details/citations remain available through an explicit expand control.
Chromium and WebKit assert that the real Guardar and menu targets can receive a
trial click without executing either action. This is an interaction check, not just
an element-exists assertion. Updated screenshots show the unobstructed footer.

The browser harness also now resolves unique compiled server-function IDs across
both TanStack SSR wrappers and implementations; choosing the first hashed filename
was nondeterministic. It still fails if the real ID is missing or ambiguous.

## Nested member-route regression

TanStack retains the parent member component when its order child renders an Outlet.
Its hidden editor previously remained callable: a reproducing application-port test
failed because a member edit from `/soci/:id/pedido` was acknowledged and patched.
Member-only proposals now require the actual member-card route before looking up
a capability, and the route-owned ports also recheck visibility. The same boundary
protects member sections, discount assignment and wallet preparation.

Chromium/WebKit navigate to the existing child without selecting products or creating
an order, attempt the forbidden hidden edit, return through the existing cancel link,
and verify that the original unsaved manual surname remains intact. No order, stock,
accounting or wallet mutation runs. The UI identifies the missing member card instead
of silently applying the patch to a hidden form.

## CI dependency-download correction

The regional EC2 Ubuntu mirror took over 27 minutes in the browser dependency
installation step; the earlier successful run fetched the same 125 MB in 17 seconds.
The CI-only preparation script changes only those EC2 archive URLs to the official
Ubuntu HTTPS archive. It retains mirror priorities, suites, components, Signed-By,
package verification and every browser/test. Other repositories are unchanged.
It runs only as root on the Ubuntu 24.04 GitHub runner, and refuses local execution.
Fixture tests cover exact transformation, idempotence and preservation of unrelated
URLs/signature settings. No application code, credentials or production settings
are affected by this CI correction.

## Consecutive quota corrections: React commit boundary

Account-security run 44397309027 passed the general browser suite but failed
in the additional mounted administrative-drafts scenario: iPhone WebKit did not
apply the third quota-price correction (33.50). The route capability was registered
in a passive effect, after the editor was already visible. A subsequent command
could use the previous capability before its replacement, resetting the voice
baseline and misclassifying the preceding voice change as a manual edit.

Route capabilities and their handlers now publish during the committed layout
phase, including the quota editor's new-draft reset. Server renders use a passive
effect and never register request-specific capabilities. No save function changes.
The browser regression repeats opening, three consecutive price patches and
cancelling four times per engine, then verifies that an actual manual price edit
is preserved. Assertions and security guards remain intact.

## Current audio evidence

See [JARVIS_AUDIO_REGRESSION.md](JARVIS_AUDIO_REGRESSION.md). The pre-fix application
fails the reproducible early-interruption recovery test. Updated mounted Chromium and
WebKit flows pass with synthetic authentication/provider/audio, including recovery without
reopening the WebSocket, interruption and a subsequent nonzero PCM response. Separate
real OfflineAudioContext rendering in both engines verifies signed PCM, odd packet
boundaries, resampling, frequency, queue recovery and cancellation of the preceding response.
This proves rendered software samples, not physical speaker loudness, microphone accuracy
or a live Deepgram session. Diagnostics contain counters/states only, no transcript/audio.

A generated route/API/UI inventory is maintained in
[JARVIS_OPERATION_INVENTORY.md](JARVIS_OPERATION_INVENTORY.md). Its source entries are
an implementation inventory, not a claim that every entry has voice coverage. Existing
write confirmation remains the manual authorized application flow; this branch does not
claim complete voice execution or full parity. Regulated product fulfillment is not added
to the voice tools. No live write is enabled as part of these tests.

## Shared execution registry — local development candidate, 24 November

The unactivated extension in `voice/execution-registry.ts` / `execution.server.ts`
uses one confirmation/transaction/audit engine. Its SQL is a review-only replacement
of the previous unapplied proposal; it fails if that schema is already present.
No production migration, flag change, merge or deployment has occurred.

| Manual operation | Voice tool / registered action | Permission | Existing service | Confirmation | Evidence |
|---|---|---|---|---|---|
| Search members | snoop_records_search / members | manage_members | member SELECT under RLS, new read-only POST wrapper | No | SQL + adapter; names private to app, references only to model |
| Read products/categories/stock | snoop_records_search | manage_products | Existing scoped SELECTs | No | SQL/RLS + HTTP adapter; units read from real category |
| Consult membership plans | snoop_records_search / membership_plans | manage_members | Existing scoped SELECT | No | SQL/RLS + HTTP adapter |
| Enable/disable entrance control | access_control.set | admin | snoop_set_club_access_control | Manual button + scoped token | Real SQL, replay, permission, rollback tests |
| Rename/archive/restore category | category.update | manage_products | manage_administrative_category | Same common confirmation | Real SQL; linked stock retained |
| Edit informational product description | product.description | manage_products | save_administrative_product_checked | Same common confirmation | Real SQL; stock/prices/history unchanged; fractional legacy prices rejected |
| Renew member fee | member.renew | manage_members; use_cash for paid fee | confirm_membership_with_receipt | Exact member/plan/amount/method reviewed | Real SQL + 7 actual concurrent PostgreSQL sessions; one receipt |
| Existing day/period cash reports | existing cash tools | Existing report permissions | Existing ledger reader | Read only | Previous tests retained; no second accounting engine |

Record IDs for new voice writes must originate from session-scoped references returned
by an authorized search. Unknown, expired or wrong-kind references fail before prepare.
Personal member search text travels in POST JSON, not URL query parameters. Members'
names/details are displayed only in the authenticated app; the model receives anonymous
references. Only non-personal requested catalog/stock/fee fields are returned to it.
The current voice pilot allowlist remains Ddr/admin; SQL also tests permitted catalog
collaborators without globally enabling them on voice.

This is NOT complete manual/voice parity. Member registration/edit persistence, full
product creation, stock writes, order transactions, cash-session writes and wallet
transactions are not wired into this registry. Existing manual flows and their
confirmations remain intact. In particular, the registration route enforces document,
signature and configurable club-field requirements that its underlying old RPC does
not fully enforce; directly exposing that RPC would bypass the existing human checks.
Those checks need a shared server validator before safe voice registration, not a
claim of successful creation. No regulated-distribution automation is added here.
