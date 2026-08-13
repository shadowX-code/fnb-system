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
