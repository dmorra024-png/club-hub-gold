# SNOOP — refinement against the supplied reference

This is an implementation in the existing application, not a generated image or full-screen mockup. The navy/champagne palette and existing administrative functionality are retained. No deployment, database/account/secret/permission change or Security PSG operation is part of this work.

## Visual comparison

The supplied image was compared manually. Its application content is normalized to a **390 × 780** viewport, excluding the illustrated phone frame, OS clock/notch and home indicator. `home-reference-390x780.png` is an actual Chromium render at those content dimensions. Samsung 360 × 800 and iPhone/WebKit 390 × 844 renders additionally verify adaptation to different screen heights. This is a visual composition comparison, not an automated pixel-diff against an original bitmap: the attachment is available in the conversation, not as a local source file.

| Element | Reference target / correction | Render measurement at 390 × 780 |
| --- | --- | --- |
| SNOOP lettering | Thin extended metallic squared forms; rounded rectangular O, lighter stroke and wider proportions | SVG box x≈83, y40, w≈229, h≈27; visible glyphs y≈42–64 |
| Gold arcs | Smaller broken light arcs behind the lettering, bright upper/lower glints rather than a uniformly outlined circle | 104 px vector canvas, painted arc diameter ≈94 px |
| Welcome / club | Wide tracking and dynamic centered club name | Welcome box y≈115; club box y≈133, h≈34 |
| Upper wave | Blue crest at the left, lower central trough and rising champagne edge on the right | Full-width 105 px vector band; trace crest ≈193, trough ≈214, right edge ≈133 |
| Caja | Label and angular euro numerals moved upward; actual authorized total retained | Section y≈226–368; amount box y≈264 |
| Graph | A real, labelled membership-fee series, with no invented sales curve or percentage | Right-hand 185 px graph; hidden for insufficient/invalid/incomplete data or unauthorized access |
| Activities | Inset icons, shorter row pitch, fine separators starting after the icons | Heading box y≈392; first row y≈435; 54 px row pitch |
| Lower wave | Rising gold-to-blue light sweep instead of the previous flat ribbon | Band y600–674 |
| Navigation | Existing three-item bar with a brighter, 90 px central ring | Bar y674–780; QR ring x150, y676, 90 × 90 |

DOM measurements are saved alongside the test screenshots in the CI artifact. Before/after phone renders use the same phone viewport: the previous version is available at commit `fadf46e` under `docs/screenshots/home-iphone-webkit.png`; updated renders are committed at the same path.

## Real data and remaining intentional differences

- Club name is still obtained from the verified server access context. There is no hardcoded production club name or club selector.
- Caja keeps its existing calculation, Madrid day boundaries and permissions. The optional graph uses only the administrative **membership receipt** ledger. It is explicitly labelled with its own fee total; it does not pretend to show product/order transactions.
- The graph requires three distinct valid receipt timestamps, complete response count, safe integer cents and a positive total. Its zero at day start is the mathematical opening baseline of the queried daily ledger, not an inserted payment. Duplicate IDs are deduplicated; inconsistent, future or missing timestamps suppress the graph. No yesterday percentage is invented.
- Activity rows continue to show actual authorized records. Wording, amounts, names and the curve therefore vary with the real ledger rather than copying the reference's example content.
- The decorative phone frame, system clock, notch and gesture indicator are not drawn by the app. There is no fictitious unread-notification dot or nonfunctional club selector.
- The source's exact font files and raster light textures were not supplied. The SNOOP lettering is drawn SVG; numeric glyphs use self-hosted **Chakra Petch 600**, including its unslashed octagonal zero. Minor bevel/glow/letterform differences remain; pixel-identical reproduction is not claimed.
- The remote QR destination changes from `eb3bdd6` / `279a6a9` are preserved. Dispensing navigation was not implemented, modified or tested here. Administrative visual verification does not certify that flow.

## Test evidence and assets

Tests use deterministic synthetic API fixtures and a fixed browser clock, never real member data. Six viewports cover the normalized reference, Pixel, Samsung, small screen, iPhone WebKit and large iPhone WebKit. The pure membership-timeline tests check real timestamp/cents mapping and refusal of invalid or insufficient observations. Existing security, PWA, member administration, permissions, profile, session-resume and catalog-administration checks are retained.

`public/fonts/chakra-petch-latin-600.woff2` is the unchanged Latin font asset from `@fontsource/chakra-petch` **5.3.0**, licensed under SIL OFL 1.1; see `public/fonts/ChakraPetch-OFL.txt`. It is served locally, requires no paid service and makes no runtime request to a font provider.

Physical Samsung/iPhone hardware, native camera permission dialogs and the live backend were not tested. Rendered screenshots prove the actual frontend with isolated synthetic data, not a production deployment.

Final verification: **180/180 unit/security tests PASS**, TypeScript PASS, production build PASS, public-bundle secret scan PASS (64 artifacts). Premium home/navigation/profile/permission checks PASS in all six viewports. Existing PWA/member tests PASS; administrative completion checks PASS in Android Chromium, iPhone Chromium and iPhone WebKit; session-resume checks PASS in Android Chromium and iPhone WebKit. CI exposed a profile layout race: two independent access hooks could resolve in different orders, allowing the operational layout to redirect a platform user before the profile selected the platform layout. The profile uses the already verified route access to choose its shell during hook refreshes, preventing both the platform redirect race and shell remounts while typing. Existing authorization rules are unchanged. The test also closes the prior synthetic account document before changing identities. No live-data or physical-device claim is made.
