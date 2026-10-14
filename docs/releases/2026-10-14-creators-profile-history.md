# Creator profiles and Collaboration history — Staging

Scope: primary Platform/Profile URL fields, canonical saved profile links, and authorized per-Brand Collaboration history. No existing business records changed.

- Platform uses canonical SelectField and 22px platform logos; supported pasted URLs update platform. Advanced manual corrections remain secondary. Existing inspection and duplicate authority are preserved.
- Directory Grid/List and Detail open only supported saved canonical profile URLs. No handle-based URL fabrication. External links remain independent from row/card navigation and keyboard activation.
- Existing Directory RPC now groups distinct canonical Collaboration IDs across authorized Brands once, using a supporting organization/Creator/Brand index. No per-row API requests, stored counters or Post/Brand-assignment counts. Legitimate historical statuses remain included; inaccessible Brands and Creators are excluded server-side.
- Full authorized history remains visible in Detail while operational Collaboration lists keep their selected-Brand scope.

Verification: 54 tests in six focused suites passed; production build passed; git diff check passed. Authenticated transactional Staging SQL verified two same-Brand Collaborations, completed/cancelled history, Post/assignment exclusion, empty history, selected-Brand behavior, per-member revocation and explicit unauthorized Brand/Creator denial; all disposable records rolled back. Migration 20261014103211 applied only to Staging ujkzdaaadnvcfayuldmh. QA level L3 for permission-sensitive projection; L2 for UI.

Final authenticated desktop/mobile Light/Dark evidence is recorded in the completion artifact after the exact dev deployment becomes READY. No provider/paid extraction calls or external publishing are required. Production and main are untouched. Existing large application bundle warning remains outside this scope.

Documentation Impact: Updated docs/domains/marketing.md for the canonical profile-link and Collaboration-history read-model contracts.
