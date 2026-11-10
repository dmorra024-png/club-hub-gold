# Order screen: mobile keyboard regression

Base `bbc57ac`, isolated branch `fix/iphone-order-keyboard`. Presentation and viewport handling only. No changes to order handlers, accounting, inventory, database or permissions.

## Reproduced mechanisms

- The previous decimal controls render below 16 CSS px. Safari may auto-zoom these controls, changing visual viewport geometry. The new test fails on the actual baseline build with `iOS decimal controls must not trigger focus zoom (<16px)`.
- The old hook recentres the document on VisualViewport scroll/pan. The baseline build fails `visual viewport panning must not recenter the document`, with only input sizing neutralized to isolate the scroll behavior.
- An orientation event can arrive before updated dimensions. Seeding the new orientation with the old portrait height incorrectly marks a closed landscape keyboard as open. A dedicated event-order test reproduces this; baselines are now scoped by physical orientation and actual layout width.
- The former flex row has two `w-full` inputs and no minimum-width constraint. Its replacement is a bounded grid; inputs and cards cannot expand beyond their columns.

## Changes

Order-only inputs use 16px text on coarse-pointer mobile screens; zoom is not disabled. Colours, brand and premium styling are preserved. The order page uses a scrolling rather than fixed body background on mobile to reduce Safari fixed-layer repaint pressure. Hardware paint artifacts are not proven resolved by headless tests.

The shared hook reveals fields minimally on focus, resize and resume, without fighting viewport pan. It handles exhausted nested scroll containers, delayed rotation measurements, pageshow/visibility resume and listener cleanup. Input focus, React keys and draft state are preserved.

## Actual checks

`npm run test:orders:keyboard` renders the real order screen with synthetic, read-only API fixtures in Chromium mobile, WebKit iPhone viewport and a WebKit standalone-mode simulation. It checks decimal controls, first/middle/last fields, repeated keyboard transitions, horizontal/card geometry, stable card/input DOM references, retained values/focus, early orientation notification, landscape/portrait, foreground resume and dock hiding/restoration. Unexpected writes fail the test. Screenshots and JSON are uploaded by CI.

The complete existing catalog suite and shared member/profile/cash/product/settings keyboard suite are retained. TypeScript, build, all automatic tests and the full CI regression suite are required. The order route diff contains only a layout class prop and two presentation class changes.

## Limits

VisualViewport, orientation, backgrounding and standalone are simulated. This is not a physical iPhone, Safari's real numeric keyboard, a real Home Screen installation or a hardware GPU repaint test. No real association data is used and no real order is submitted. Physical Safari/PWA keyboard and rotation acceptance remains necessary before claiming the reported iPhone artifact definitively resolved.
