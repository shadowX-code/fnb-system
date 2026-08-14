# Crew Mobile Clock In Hero — Design QA

## Visual truth and rendered evidence

- Source visual truth: `/Users/deron/Downloads/ChatGPT Image Aug 14, 2026, 06_17_44 PM.png`
- Source pixels: 1536 × 1024; focused Attendance card crop: 1376 × 710.
- Staging implementation: `https://fnb-system-staging.vercel.app/#crew`
- 390px annotation-fix screenshot: `/private/tmp/feedx-clockin-comment-qa/final-390.png`
- 375px annotation-fix screenshot: `/private/tmp/feedx-clockin-comment-qa/final-375.png`
- Focused same-input comparison: `/private/tmp/feedx-clockin-qa/reference-vs-staging-390.png`
- CSS viewports: 390 × 844 and 375 × 812; browser `devicePixelRatio` 1.6. Screenshots were compared at equal displayed width after aspect-preserving normalization.
- State: READY / CLOCK IN, using the authenticated Staging QA Crew identity and real Attendance/geofence read authorities.

## Full-view comparison evidence

- The Home hierarchy remains unchanged outside the requested Attendance Hero.
- The Hero uses the reference two-part card structure: pale café/workstation scene on the left, mint radial action surface on the right, and one full-width shift footer.
- At both widths the document `scrollWidth` equals the viewport width; the ring, time, footer action, Tasks, and persistent navigation remain unclipped.

## Focused comparison evidence

- The combined comparison opens the source crop and Staging Hero in one image. The implementation matches the reference hierarchy, left/right seam, READY placement, time/date pairing, GPS pill, concentric ring, fingerprint treatment, and footer alignment.
- Typography: the existing FeedX Inter/system stack is retained; the time remains the strongest anchor and labels use the same navy/green hierarchy.
- Spacing: the 390px Hero measures 360 × 250 and the 375px Hero measures 345 × 250; the footer is 58px at both widths.
- Colors: navy copy, FeedX green, pale mint glass layers, white surface, and low-contrast environmental image match the source direction while preserving WCAG-readable primary text.
- Image quality: a project-local 900px generated café asset is used; no hotlink, placeholder, inline SVG illustration, or base64 content is present.
- Copy: READY, Ready to clock in, the actual outlet name, Within area · GPS Verified, Tap to, CLOCK IN, Today’s shift, and View Attendance are present. The shift value remains truthful Staging data.

## Comparison history

1. **P2 — Copy was covered by the curved ring seam at 390px.** The initial implementation used a 29px negative overlap. Reduced it to 12px, widened the action track, and rebalanced the responsive columns. Post-fix evidence shows the date and Current Outlet fully visible at 375px and 390px.
2. **P2 — Kicker inherited a legacy low-contrast nested-span color.** Increased selector scoping to the Home Attendance Hero. Post-fix computed color is `rgb(10, 28, 60)` and the label is clearly legible over the scene.
3. **P3 — Live shift copy differs from the mock.** The reference shows `2:00 pm – 10:00 pm`; the authenticated QA Crew currently has no published shift, so Staging correctly shows `Not published`. This is intentional business-truth behavior, not visual drift.
4. **P2 — Clock target had excessive concentric line density.** Removed two radar helper rings, the inner line pair, and the secondary sweep/dot layer. The final target uses one dotted orbit, one progress arc, one white separator, and one green action core.
5. **P2 — Dotted orbit appeared left of the action core.** Moved the orbit and action to one measured center. Both centers are `297px` at 390px and `285px` at 375px.
6. **P2 — Generic outlet copy and truncation.** Replaced `Current Outlet` with the session-derived `attendanceOutlet`; `Friends Corner` fits without clipping at both verified widths (`clientWidth === scrollWidth === 54px`).

## Final checks

- Fonts and typography: passed.
- Spacing and layout rhythm: passed.
- Colors and visual tokens: passed.
- Image quality and crop: passed.
- Copy and content hierarchy: passed.
- Keyboard-accessible Clock In button and aria label: passed.
- Slow orbit/sweep/glow animation: passed.
- `prefers-reduced-motion` animation stop rules: passed.
- Console warnings/errors: none.
- Broken image assets: none.
- Remaining P0/P1/P2 findings: none.

final result: passed
