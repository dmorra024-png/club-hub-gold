# JARVIS application coverage — release candidate, not production parity

Base: `7c701cd`. This branch changes voice integration only. It does not enable REAL,
change credentials/RLS/schema, or publish the application. PR #25 and Monedero are excluded.

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
- Missing route methods could silently return via optional calls and produce successful
  receipts. Require actual snapshot/patch/open/search capabilities and recheck stale scope
  after waits. No simulated button clicks or fallback saves.
- Cash tool was limited to today. Add an explicit validated calendar-day tool, reuse the
  manual authenticated report calculation, open that same day in the existing report, and
  retain Europe/Madrid DST and collaborator filters. No accounting calculation is changed.

## Manual-to-voice matrix

Navigation means a real route/tab opens, NOT that all actions on that page are automated.
Draft means fields change in the existing form; saves remain manual. Read means the
server uses the authenticated user's existing query, not a service-role bypass.

| Existing screen / function                           | Voice capability in this branch                                                                  | Remaining limitation                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Home (`/`)                                           | Navigation                                                                                       | Home widgets remain manual                                                                                    |
| Socios list / management (`/soci`, `/soci/gestisci`) | Navigation + local authorized search                                                             | Selecting a particular member by ambiguous name needs explicit resolution                                     |
| New member (`/soci/nuovo`)                           | Progressive name, surname, birth date, city, phone drafts; corrections; refused phone remembered | Other fields and final registration manual; synthetic personal data only                                      |
| Member details (`/soci/$id`)                         | Not newly automated                                                                              | Renewals, membership history, discounts, QR/email/signature need typed context-specific ports; no guessed IDs |
| Member import (`/soci/importar`)                     | Navigation, existing manage-members gate                                                         | File selection, validation and import manual                                                                  |
| Products (`/productos`)                              | Navigation, existing search, name/category draft                                                 | Pricing, inventory and final writes not exposed by this voice schema                                          |
| Categories (existing Productos tab)                  | Open tab and prepare category-name draft                                                         | Rename/archive/delete manual                                                                                  |
| Stock (existing Productos tab)                       | Open tab and search                                                                              | No voice inventory mutation or distribution automation                                                        |
| Member order (`/soci/$id/pedido`)                    | Not newly automated                                                                              | No guessed member, automatic payment, fulfillment or stock change                                             |
| Caja (`/caja`)                                       | Navigation                                                                                       | Opening/closing, cash-count and notes remain manual                                                           |
| Caja report (same page)                              | Today's aggregate or explicit valid Madrid calendar day, real authenticated source               | Multi-day aggregation, individual session drill-down and economic writes not yet exposed                      |
| Activities (`/actividades`)                          | Navigation                                                                                       | Audit detail and cancellations remain manual; original audit preserved                                        |
| Reports (`/ajustes/informes`)                        | Navigation, same view-reports gate                                                               | Report filters/exports manual                                                                                 |
| Settings (`/ajustes`)                                | Navigation, admin-only                                                                           | Settings changes manual                                                                                       |
| Collaborators (`/ajustes/colaboradores`)             | Navigation, admin-only                                                                           | Invitations and permission changes manual                                                                     |
| Member settings/discounts (`/ajustes/socios`)        | Navigation, admin-only                                                                           | Assignments and settings writes manual                                                                        |
| Fees (`/ajustes/cuotas`)                             | Navigation, admin-only                                                                           | Existing fees unchanged; no new automatic discounts                                                           |
| Devices (`/ajustes/dispositivos`)                    | Navigation, admin-only                                                                           | Device configuration manual                                                                                   |
| Access control (`/control-acceso`)                   | Navigation, same manage-members gate                                                             | Camera/access decisions use existing manual flow                                                              |
| Profile (`/perfil`)                                  | Navigation, preserves active voice session                                                       | Password and logout remain secure manual operations; never dictate credentials                                |
| Legacy `/cuotas`, `/geneticas`                       | Deliberately no new destination/menu                                                             | Existing hidden/legacy data preserved; no parallel archive                                                    |
| `/snoop-admin`                                       | Not available to club-admin pilot                                                                | Separate Super Admin access preserved                                                                         |
| `/club-status`, authenticated route guard            | No operational voice access                                                                      | Suspension and recovery policies unchanged                                                                    |
| `/snoop-demo`                                        | No production voice tool                                                                         | No new demo path introduced                                                                                   |
| SNOOP Socio / Monedero (PR #25)                      | Excluded                                                                                         | Separate development untouched                                                                                |

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
