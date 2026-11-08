# Informational genetics archive and administrative voice

## Implemented scope

New `/geneticas` route and independent server functions. No product IDs, prices, orders, carts, stock references or economic writes. Club administrators prepare a record, search once, inspect up to three photo candidates and their licences, edit attributed botanical facts and an original Spanish template, and explicitly confirm before saving. A missing information table is reported; manual preparation and reviewed JSON download remain possible. Own JPEG/PNG/WebP photographs are resized and re-encoded as JPEG in the browser, removing original metadata; they are never sent to AI. The server validates image content/size and independently re-verifies Commons candidates before insertion. Reviewed records are readable only inside the authorized active club; staff cannot create them. There are no automatic writes or automatic image selection.

Persistence is **not activated remotely**. `docs/sql/SNOOP_INFORMATION_ARCHIVE_PROPOSED.sql` is a proposal for a new isolated table and its new policies; it does not change any existing table/policy, account or schema in production. It was executed only in an ephemeral PGlite database with synthetic users/clubs and helper-function contracts. Existing RLS/permission tests remain in the complete suite. This is not proof against the live database.

The existing app authenticates staff, not association members. An actual member-facing publication channel is **BLOCKED** pending a separately authorized member identity/access design. No anonymous endpoint or shared login was added. “Reviewed” does not mean publicly published to members.

## Historical Lovable implementation

`925b1f0:src/lib/products-enrich.functions.ts` used Gemini text generation via Lovable and Gemini 2.5 Flash Image to generate a bud photograph. Its prompt mentioned seedbanks but supplied no retrieved evidence. It was not a verified photograph/source search. That behavior is not reused. Current product/economic enrichment modules are unchanged.

## Real Internet evaluation

See `GENETICS_SOURCE_ACCESS_AUDIT.json` and `GENETICS_LIVE_RESEARCH_RESULTS.json` for actual dated HTTP observations, not browser mocks.

| Source | Observed access / reuse decision |
| --- | --- |
| Leafly | Terms endpoint HTTP 200. No free authorized extraction API/image grant established. Manual attributed informational-page references only. |
| SeedFinder | robots accessible; tested `/en/terms` returned 404. No verified API or image grant established. Manual informational-page references only; guessed terms URL is not evidence of permission. |
| AllBud | Terms HTTP 200 expressly prohibit robots/spiders/automatic access. **No automated retrieval in the new archive.** |
| Wikileaf | robots URL redirected to Fire & Flower retail homepage. Not used or linked in the new archive. |
| Strainpedia | robots content signals include `search=yes,ai-train=no,use=reference`. No reusable photo licence/API established; not ingested or used for model input. |
| Wikidata | Public API and CC0 structured data verified. Exact label plus cannabis description required; ambiguous/missing entities rejected. Only the classification actually returned is proposed, not invented breeder/lineage/aroma. |
| Wikimedia Commons | Public image API and reuse guidance verified. Exact-name file, botanical context, allowed image host, author and licence metadata required. Nonbotanical people/aurora/cake matches and ambiguous hybrid filenames are excluded. Up to three **candidates**, requiring visual review; metadata is not a guarantee of identity or legal title. |

No specialized site is scraped just because robots.txt permits a path. The new archive makes no DuckDuckGo/Leafly/AllBud scraping calls. Links entered as sources must be informational paths on the allowlist; purchase/shop URLs, credentialed URLs and query strings are rejected. Source text is displayed as text, not injected HTML.

Eight live searches: White Widow has one verified general Wikidata classification and two licensed exact-name botanical photo candidates; Wedding Cake and Northern Lights each have one photographic candidate but no verified descriptive fields. Amnesia Haze, Gelato 41, Runtz, Gorilla Glue and Zkittlez have neither a verified open-data description nor an acceptable photograph in this check. These are limits of the enabled open sources, not assertions that no photo exists anywhere. Breeder, lineage and aroma require administrator-supplied documented facts. Conflicting field values are flagged and both attributions retained.

## Voice

Keeps `@cf/openai/whisper-large-v3-turbo`, selected IT/ES language, existing authorization, VAD, timeouts, fallback and free-profile restrictions. No paid model/provider or new service is enabled. Improvements are local parsing and routing: informational searches cannot fall through to member/product search; open-member-form corrections patch only named fields, including IT/ES spoken phone digits, spoken email separators and named-month calendar dates. Correcting the membership plan no longer leaves the form for plan settings. No member fields/history are newly sent to a text model. No claim of improved acoustic recognition on a real phone or a live Cloudflare call is made.

## Evidence and limitations

Automated unit/security tests, isolated SQL policy tests and Chromium/WebKit browser checks use synthetic users and intercepted local APIs. The photo in the screenshots is the **actual Commons White Widow photograph**, retrieved HTTP 200 and attributed to Coaster420 / Public domain; the same bytes are locally served in the browser test. The photo was not generated. Browser tests verify real frontend rendering, review/confirmation, source fallback, staff read-only access and absence of economic writes. Source availability is separately verified over the Internet. Voice browser tests use real local MediaRecorder chunks from a synthetic Chromium microphone with simulated transcription; they do not prove real Whisper accuracy or physical-device permissions.

No deployment/merge, production DB access, credential/account change or Security PSG operation. No paid API/subscription added. External activation still requires authorization for the independent information table, a defined member access channel, and eventual deployment; specialized automated ingestion remains unavailable without explicit reuse permission or an authorized API. This is a reviewable candidate, **not a completed automatic specialist encyclopedia**.

### Final local verification

- **189/189** unit/security tests PASS, including nine new tests for informational sourcing, ambiguity/licensing, IT/ES corrections/calendar dates and the new isolated ledger's policies.
- TypeScript and production build PASS; public-bundle secret scan PASS.
- New archive browser suite PASS on Samsung Chromium and iPhone WebKit, including own-photo re-encoding, reviewer confirmation and staff read-only access.
- IT/ES administrative form recording suite PASS: synthetic microphone, real MediaRecorder, mocked transcription, no automatic writes.
- Six-viewport premium-home regression suite PASS in Chromium and WebKit; see final CI status in PR #1 for the aggregate result.
- No physical-device test and no live Cloudflare transcription/provider-quota probe in this task.

Reproduce local browser checks after starting the production build on a loopback port with `TEST_BASE_URL` set. `npm run test:genetics:browser` uses the attributed frozen Commons image under `tests/fixtures/`, not a live image assertion. `NODE_USE_ENV_PROXY=1 npm run verify:genetics:live` performs fresh external API queries in this managed proxy environment and overwrites the dated research evidence; do not confuse that opt-in command with the mocked browser suite. No credentials are required for either Wikimedia API.
