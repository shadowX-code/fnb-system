# Creator Management acceptance — Staging

Risk: L3 (canonical Creator scope, revisioned commands, publishing evidence and option authority).

## Automated and database verification

- 58 focused tests passed across Creator forms, identity, presentation, public Post extraction, profile extraction, API authorization and bounded XHS-provider regressions.
- Production build; existing bundle-size advisory remains.
- `managementAcceptance.sql`: rollback-only canonical Staging test passed. Name-only identity, atomic multi-platform profiles, retry equivalence, duplicate rejection, normalized separate Location/Category options, confirmed rename, archived-choice preservation, explicit collaboration Brand binding, rejection of Published without evidence, canonical Post reuse, partial publication, closure without completing plans, last-evidence preservation, optional Creator and per-member Brand/Role denial. Fixtures and temporary restricted-role assignment all rolled back.
- Applied forward versions: 20261014052101, 20261014052613, 20261014053333, 20261014055043. Normalized rename also passed against simulated legacy case/spacing variants in rollback-only fixtures. No Production changes.

## Authenticated deployed acceptance

Canonical Staging delivery via dev/Git Integration; verified project `prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi`, Supabase `ujkzdaaadnvcfayuldmh`, alias `https://fnb-system-staging.vercel.app`. Functional deployment verified at `4ed1e5a998ca817ffb4e5f4768a3fca2c7b64f64`; final follow-up preserves read-only Post viewing and records evidence.

Actual authenticated Isaac/Owner browser acceptance:
- Created one explicitly disposable Creator through UI without a Brand, with independently created Location and Category. Renamed the used Location with impact confirmation, archived it from choices, saved the profile and verified the selected association remained.
- Created a zero-cost disposable Idamans collaboration through UI, selecting that initially unassigned Creator and three planned entries: Instagram video, TikTok video, XHS image. Canonical Brand relationship established. Displayed 0/3 Published; saved drawer remained available and Add Published Post opened the existing Inspector with locked Brand/collaboration context.
- UI/server rejected Published without a linked Post. Cancelled the unpersisted status change. Exact duplicate linking and 1/3 partial publication were verified by UI component regression and canonical rollback tests, not by inserting fabricated public Posts into operational data.
- New/edited form unsaved-close confirmation, keyboard row opening, canonical searchable selectors and mobile touch interaction passed.
- Desktop Light/Dark and actual 390px CSS mobile Light/Dark reviewed. Found and fixed Content Type grid placement on mobile; both publishing selectors now have 273px available width at 390px viewport, document width equals viewport, header/footer remain stable. Temporary viewport and theme preferences restored.
- Disposable Creator/options archived and QA collaboration cancelled through canonical commands after acceptance; associations/revisions retained. Existing business Creator and provider connections untouched. No Post created.

Public profile observations (unsaved; no identities merged):
| Profile | Observed Staging result |
| --- | --- |
| Instagram `tasteeipoh` | Handle recognized from URL; additional public metadata unavailable; manual fields remain blank. |
| TikTok `ipohcarimakan` | Display name `Ipohcarimakan`, handle, platform ID `7201017320880948226`, 43,000 observed followers with source/capture time. No ownership verification inferred. |
| XHS `563df115e4b1cf31443e8b25` | Profile ID recognized from URL; additional public metadata unavailable; no paid note/profile request. |
| Facebook Page `622626120924115` | Numeric Page identity recognized from URL; additional public metadata unavailable. |

These are profile-specific availability outcomes, not a guarantee of complete platform metadata. Existing Post crawler remains unchanged except injectable safe navigation parsing reused by profiles. No login/CAPTCHA bypass or new vendor is used.

Screenshots saved outside the repository under `/Users/deron/.codex/visualizations/2026/10/09/01a1215e-3a8d-7e13-8ac7-1f77f4056953/creator-management/`: desktop collaboration Light/Dark, mobile collaboration Light/Dark, Creator mobile Light, seeded mobile Post Inspector and public-profile fallback.

## Boundaries

No external messages/publication, permission changes, new paid profile APIs or business-record edits. Existing Meta/Post crawler and bounded XHS trial remain in place. Public profile observations never establish account ownership. Missing followers/dates remain unavailable. Legacy relationship/cost/revision/Post records are preserved.
