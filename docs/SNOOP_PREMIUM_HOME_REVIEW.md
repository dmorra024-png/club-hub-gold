# SNOOP premium home — visual and functional review

The approved image is the visual reference. This change rebuilds the actual React home and shared navigation; it does not place a mockup image behind controls. No image-generation service, external font service, new paid dependency or database migration is used.

## Implemented

- Midnight navy/champagne shell; metallic vector SNOOP lettering, halo and two lightweight decorative SVG wave bands. No tilted card, watermark, English welcome, member/product counters or fixed pilot branding.
- BIENVENIDO and the club name from the existing verified access RPC. No club selector. The reference's club-selector chevron/unverified notification dot are deliberately absent.
- Caja de hoy retains the existing permission checks and shared Madrid/DST integer-cent calculation. No invented percentage or financial curve: those reference details are omitted because no verified comparison is provided.
- Recent authorized activity from existing members, orders, membership_receipts, products and stock_movements. Minimal selected fields, explicit club filtering, staff financial ownership filtering, real timestamps and an empty/error state. Ver todas opens the real permitted activity list, with bounded pagination and links to existing sections.
- Exactly three persistent navigation items: Home, existing access QR scanner, Perfil. Disabled QR for users lacking member permission. Menu retains Socios, Productos, Caja, reports, settings and voice access according to permissions.
- Own-account profile for club staff and platform administrators, including verified role, current-password reauthentication before a password update, and logout. No role/permission editor. Super Admin profile uses the platform shell and never queries club contents.
- Safe-area/viewport support, keyboard-aware navigation, focus handling, small-screen scrolling and flow-based installation guidance that does not cover forms. Shared club pages retain their operational components with the new shell/tokens.
- QR fixes: exclusive library-owned DOM container, lifecycle/permission cleanup, targeted handling of the dependency's ignored video play promise, and verified server access context instead of a duplicate club lookup. Real scope changes still invalidate cached club reads in the persistent root; page mounts do not.

## Verification method

All browser data are synthetic, intercepted local API responses. Real authentication credentials, documents, remote records and accounts are never used. Unit/security database tests use the existing isolated synthetic fixtures. Browser profiles are simulations, not physical-device certification.

Visual review is a manual comparison of actual rendered Chromium and WebKit screenshots against the supplied image: order, proportions, spacing, navy/gold colors, lettering, waves, activity rows, three-item bar and absence of legacy home elements. Device hardware/status bars and the reference phone frame are not part of the application UI.

Representative screenshots in `docs/screenshots/` show the actual rendered app with synthetic test data; “Club Principal” and monetary/event examples in these captures come only from the test fixture, never from production UI constants.

## Remaining physical/external checks

- Physical installed Samsung/iPhone safe-area, keyboard, background restoration and native camera permission behavior remain to be checked after an authorized release. Chromium scanner tests use a synthetic camera; desktop WebKit is not an actual iPhone camera.
- No remote Auth configuration is changed. Existing production invitation URL configuration remains a separate activation prerequisite described in SNOOP_STABILITY_REVIEW.md.
- Nothing has been deployed, merged or applied to a remote database. Security PSG is untouched.

## Executed test results

| Check                                   | Result           | Scope                                                                                                                                                 |
| --------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic unit/database security tests  | PASS: 178/178    | Synthetic isolated fixtures, RLS/multi-club/privilege regressions, activity permission mapping and QR playback compatibility                          |
| TypeScript                              | PASS             | Application and test configurations                                                                                                                   |
| Production build and public bundle scan | PASS             | No local service-role/AI test secrets in public artifacts                                                                                             |
| Premium home browser tests              | PASS             | Pixel 393×852, Samsung 360×800, small 320×568, WebKit iPhone 390×844 and 430×932; synthetic local APIs                                                |
| QR                                      | PASS in Chromium | Existing single scanner, real browser MediaStream from a synthetic camera, start/stop and denied navigation; no physical camera claim                 |
| Profile                                 | PASS             | Own verified account, current-password reauthentication, password-only update, logout, platform profile without club table reads                      |
| Activity and navigation                 | PASS             | Ver todas, scoped reads, no member/financial queries without permission, staff ownership filters, empty state and dynamic club name                   |
| Existing administration                 | PASS             | Synthetic member registration/renewal, cash, catalog lifecycle, stock history, staff invitations, owner password setup and permission navigation      |
| PWA/resume                              | PASS             | Manifest/icons/installability/offline public cache; Chromium/WebKit context restoration, network retry, retained form state and home/Caja consistency |
| Physical Android/iPhone                 | NOT TESTED       | Requires authorized publication and actual phone testing                                                                                              |

CI additionally stores the actual browser screenshots in the `snoop-premium-home` artifact, including failure runs where images exist.
