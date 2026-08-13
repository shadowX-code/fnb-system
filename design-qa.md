# Crew Mobile 2026 Design QA

Reference: `ChatGPT Image Aug 13, 2026, 09_54_35 AM.png`

## Visual hierarchy

- Home prioritizes the current shift, then actionable work, compact schedule, and growth summary.
- Learn prioritizes knowledge search and required acknowledgements; completed onboarding is compact.
- Reward uses an achievement hero while retaining transparent evidence and history.
- Growth prioritizes the next milestone, then status metrics, navigation, and performance preview.
- Supporting metadata stays visually subordinate to actions and current status.

## Responsive acceptance

- 375px and 390px layouts use 16px page gutters.
- Five-item bottom navigation remains fixed and does not overflow.
- Action rows truncate long primary labels without moving badges or chevrons off-screen.
- Four-column category/metric grids collapse where required below 375px.
- Long document content remains vertically scrollable and rich content wraps within the viewport.

## Product constraints preserved

- No employee-facing screen receives Admin controls or private notes.
- Attendance, roster, learning, reward, performance, and growth continue using their existing controlled service authorities.
- Recently viewed content is not fabricated when the backend does not provide real history.

## Crew Mobile Learn final-reference QA

## Source and implementation

- Approved source: `/Users/deron/Downloads/ChatGPT Image Aug 13, 2026, 03_40_25 PM.png`
- Final local implementation capture: `/Users/deron/Dev/feedx/tmp/crew-learn-final-crop.png`
- Side-by-side comparison input: `/Users/deron/Dev/feedx/tmp/crew-learn-comparison.png`
- QA state: 430 px mobile surface with completed onboarding and representative Required, Optional, and Acknowledged SOP states.

## Comparison history

### Iteration 1 — needs changes

- P2: the first implementation was visibly too tall relative to the approved reference. Hero/search separation, category cards, list rows, and vertical section gaps were all too generous.
- P2: generated hero artwork was oversized for the available top-right slot.

### Iteration 2 — pass

- Tightened hero, search, onboarding, category, section-gap, and SOP-row proportions while retaining 44 px interactive controls.
- Rescaled the local generated hero illustration to preserve the approved composition without crowding the title.
- Category carousel intentionally exposes the next card; the page itself has no intentional horizontal overflow.
- The single SOP container, divider rhythm, compact state alignment, and title truncation now follow the approved reference closely.
- Differences retained by design: titles, category counts, versions, read time, acknowledgement dates, and onboarding totals remain data-driven rather than screenshot-hardcoded; the generated illustration is visually matched but not a copy of the reference asset.

## Interaction and responsive checks

- Search and category selection update the same real-data SOP result set and count.
- View all clears both category and query and returns the carousel to All when scrolling is supported.
- Required, Optional, and Acknowledged states remain readable without colliding with long SOP titles.
- SOP rows continue into the existing reader and controlled acknowledgement call.
- CSS includes compact behavior below 360 px and expanded title/state allocation from 400–430 px.
- Reduced-motion users do not receive forced carousel motion.

## Result

Passed for local implementation. No backend, route, session, acknowledgement authority, or deployment behavior was changed.
