# Crew Mobile Home — Design QA

## Source and capture

- Reference: `/Users/deron/Downloads/ChatGPT Image Aug 14, 2026, 02_05_09 AM.png`
- 375px Ready capture: `/Users/deron/.codex/visualizations/2026/08/11/019ff0eb-626d-7b53-b9b2-55432ababd5b/feedx-home-qa/home-375-ready.png`
- 390px Completed capture: `/Users/deron/.codex/visualizations/2026/08/11/019ff0eb-626d-7b53-b9b2-55432ababd5b/feedx-home-qa/home-390-completed.png`
- Side-by-side comparison: `/Users/deron/.codex/visualizations/2026/08/11/019ff0eb-626d-7b53-b9b2-55432ababd5b/feedx-home-qa/reference-vs-home-375.png`

## Comparison state

- Viewports: 375 × 812 and 390 × 844.
- The reference uses a Ready attendance state. The implementation was compared in both Ready and Shift Completed states so that the shared Hero family could be verified.
- Live QA data remains authoritative. Differences in employee name, current time, task completion, and published roster state are intentional data differences rather than visual deviations.

## Iteration findings

1. **P1 — legacy Home styles overrode the split Hero.** Fixed by isolating Home-specific selectors and stacking contexts.
2. **P1 — Ready time inherited the legacy 10px nested-span rule.** Fixed with scoped clock typography so the primary time returns to the reference scale.
3. **P2 — initial vertical rhythm was too loose.** Tightened the Header, Attendance Hero, shift strip, task rows, schedule rows, and Home-only bottom navigation.
4. **P2 — schedule information order differed from the reference.** Today now leads with the schedule state; upcoming rows lead with date and place the roster state/time on the right.
5. **P2 — old Completed state used a separate visual card.** Ready, On Shift, and Shift Completed now share one Hero structure.

## Final checks

- Header hierarchy and action placement: passed.
- Split green/white Attendance Hero and circular scan control: passed.
- Ready, On Shift, and Shift Completed component family: passed.
- Shift footer alignment: passed.
- Task row density, state color, and chevron alignment: passed.
- Schedule row density and roster/leave labels: passed.
- Home-only bottom navigation sizing: passed.
- 375px horizontal overflow: none.
- 390px horizontal overflow: none.
- Other Crew screens are not affected by the Home-only navigation/style selectors.

## Remaining P3 notes

- The reference contains different live task and roster content. Production-truth labels are intentionally not mocked to force a pixel-identical data state.

**final result: passed**
