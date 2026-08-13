# Crew Mobile My Performance Design QA

Reference: `ChatGPT Image Aug 13, 2026, 10_36_42 PM.png` (853 × 1844).

Implementation: FeedX Staging `#crew` → Growth → My Performance, authenticated QA Crew.

Viewports reviewed: 375 × 812 and 390 × 844. The reference was normalized to the same mobile canvas for side-by-side comparison.

## Iteration findings and fixes

- P2 — Entering My Performance preserved the previous Growth scroll position and could hide the page header. Fixed by resetting document scroll when the Growth subview changes.
- P2 — Long Strength titles were truncated. Fixed by allowing compact multi-line titles and constraining supporting copy.
- P2 — The first implementation was materially taller than the approved reference. Hero, score rows, evidence callout, Strengths, trend, and Reward Impact spacing were reduced as one responsive density system while preserving readability and tap behavior.

## Final findings

- P3 — The generated trophy artwork is not pixel-identical to the supplied concept, but preserves the approved premium dark-emerald/gold trophy composition and is bundled locally without an external dependency.
- P3 — Staging currently has one finalized month, so the page correctly shows a truthful single-month trend state and omits a fabricated month-over-month delta. The multi-month chart is rendered only when real finalized history exists.
- P3 — Live FeedX font metrics differ slightly from the generated reference, while hierarchy, alignment, content density, and responsive behavior remain consistent.

## Verification

- Hero uses the real month, lifecycle status, score, level, and only a true previous-finalized-period delta.
- Breakdown contains exactly Attendance, Service Standards, Customer Experience, Knowledge & SOP, and Conduct with real weights and scores.
- Component evidence, calculation help, and page help open accessible centered modals with safe employee-facing explanations.
- Strengths are derived only from full-score components; no placeholder strengths are shown.
- Reward Impact uses the existing reward earn-rate tiers and routes to the existing Reward screen.
- No horizontal overflow at 375 or 390 px; the final card scrolls clear of the fixed bottom navigation.
- Browser console was clean during the final authenticated Staging smoke pass.

Result: **PASS** — no P0, P1, or P2 visual findings remain.
# Crew Mobile Me — Design QA (2026-08-14)

- Source visual truth: `/Users/deron/Downloads/ChatGPT Image Aug 13, 2026, 11_38_25 PM.png`
- Implementation: `https://fnb-system-staging.vercel.app/#crew`, commit `800ae51670108366d34babaea44383054f396acf`
- State: authenticated QA Crew, Me main view with real Attendance and Annual Leave payload
- Viewports: 375 × 812 and 390 × 844 CSS px, browser device scale 1
- Source pixels: 995 × 1577; implementation viewport normalized by matching mobile content width rather than source canvas scale
- Browser-rendered evidence: in-app Browser full-page Staging capture at 390px; DOM and geometry inspection at 375px and 390px

**Full-view comparison**

- The implementation matches the approved hierarchy: Me header, green employee hero, exactly two quick statuses, grouped Work/Account/Support lists, separate red logout, and fixed five-item bottom navigation.
- Intentional constraints: no notification bell because no real employee notification capability exists; no photo/camera affordance because no upload flow exists; Employment Documents has no badge because no safe action-state payload is available.

**Focused comparison**

- Profile hero: initial avatar, name, role, outlet, active status and profile navigation remain readable at 375px; long-name/outlet truncation is covered by tests.
- Quick status: two equal columns fit without overflow; real QA data displays `Good / 15 shifts this month` and `7.5 days available`.
- Lists and logout: icon weight, row heights, amber pending badge, section rhythm and independent logout treatment align with the reference. Logout confirmation is centered and does not collide with bottom navigation.

**Findings**

- No actionable P0/P1/P2 differences remain.
- P3: the reference includes a decorative camera badge; intentionally omitted because the product has no profile-photo upload capability.

**Comparison history**

- Initial implementation used one undifferentiated settings list and had no real quick-status layer.
- Revised implementation added the employee hero, real data-derived statuses, grouped navigation, edge states, and logout confirmation. Post-fix Staging evidence showed no horizontal overflow at 375/390 and preserved bottom padding for the fixed nav.

**Interaction checks**

- Profile Information opened and returned successfully.
- Attendance and Leave routes passed automated navigation regression.
- Logout confirmation opened, cancelled, and remained centered.
- No FeedX console warnings/errors were recorded during the Staging Me smoke.

final result: passed

# Crew Mobile Home — Design QA (2026-08-14)

- Source visual truth: `/Users/deron/Downloads/ChatGPT Image Aug 14, 2026, 02_05_09 AM.png`
- Implementation: `https://fnb-system-staging.vercel.app/#crew`, commit `54f8d7cb80639b3b5ca4af7809968b84bbf9c208`
- State: authenticated QA Crew with completed attendance, three real operation checklists, OFF / MC / Annual Leave published roster states
- Viewports: 375 × 812 and 390 × 844 CSS px

**Full-view comparison**

- Home now follows the approved information hierarchy: employee greeting, dominant Attendance hero, direct Today’s Tasks, three-day My Schedule, fixed five-item bottom navigation.
- Keep Growing and the intermediary task-summary row are removed.
- The dark emerald Attendance hero uses a responsive two-column layout, concentric clock treatment, fixed footer and distinct Ready / On Shift / Shift Completed authority-derived states.

**Interaction and responsive checks**

- A Home checklist opens its real detail directly; the intermediate Today’s Tasks list is skipped.
- The authenticated Staging fixture rendered its real completed-shift state, true checklist statuses, and published OFF / MC / Annual Leave roster projection.
- 375px: document width and body width both 375px; no horizontal overflow; hero width 343px; bottom nav remained fixed without clipping content.
- 390px: document width 390px; hero width 358px; three task and three schedule rows aligned without overflow.
- Browser console contained no warnings or errors during Home and direct checklist navigation.

**Automated state coverage**

- Ready shows Clock In only; On Shift shows live elapsed duration and Clock Out; completed shows in/out times and duration with no Clock Out.
- Clock In uses the existing geofence authority, requires an exception reason outside radius, refreshes Home, and opens a centered success modal.
- Empty and multi-task states, local task expansion, direct detail navigation, published roster states, and cross-outlet labels are covered.

**Findings**

- No actionable P0/P1/P2 differences remain.
- P3: the reference’s fingerprint/radar illustration is represented by local iconography and CSS control decoration rather than a bespoke raster asset; interaction hierarchy and responsive geometry match the approved intent.

final result: passed
