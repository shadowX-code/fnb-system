# Creators unified Publishing — Staging

Documentation Impact: updated `docs/domains/marketing.md`. QA L3 for the canonical association-removal operation; shared icon/editor changes verified proportionally at L2.

## Implementation

- One projection reconciles active planned deliverables and canonical Creator Posts. A linked Post replaces its placeholder; multiple Posts and unmatched historical Posts remain distinct. The editor and Collaboration table use the same published/total definition.
- Publishing rows show platform/type, confirmed publication state, real available thumbnail, date, URL and observed metrics. Unknown dates are omitted; platform artwork is never used as a large Post thumbnail in this section.
- Add Post URL opens the existing Inspector with the exact saved plan, Brand, Creator and content type. Existing duplicate linking, explicit identity confirmation, manual confirmation/date entry, privacy boundaries and public-evidence authority remain unchanged. Save-first protection prevents losing unsaved collaboration edits.
- The canonical retry-safe Creator command supports remove_publishing through a private helper. It checks Brand/manage authority and both current revisions, preserves the Post identity/Creator/Brand/outlet/media/metrics, writes a superseding Post revision, unlinks the collaboration/entry, cancels an emptied planned entry, and versions/audits the collaboration in the same transaction. Removing the last supporting Post while collaboration status is Published remains blocked. No physical record deletion or provider operation.
- Shared platform icons own fixed 22px containers and bounded artwork, including TikTok/XHS intrinsic SVG image dimensions. Other account/Post consumers reuse this component; no page-local sizing override.
- Collaboration state remains separate from individual publication evidence. Partial publication never closes a collaboration.

## Verification

- 57 focused tests / seven files passed, covering editor continuity, mixed entries, exact plan handoff, confirmation/dirty-state protection, real-zero display, no platform thumbnail fallback, unified counts, multi-Post reconciliation, external-link independence and representative Content Management/Post consumers.
- Build and diff whitespace checks passed; existing large-bundle advisory remains.
- Authenticated rollback-only Staging SQL verifies multiple plans, URL-only non-publication, confirmed duplicate reuse, explicit date-only evidence, metrics preservation, last-publication guard, stale revision/Brand denial, private-helper/anonymous restrictions, traceable revisions/events and exact request retry. Fixtures rolled back; no business record was changed.
- Supabase security advisor contains no notice for the new private helper. No new table, grant, provider credential, subscription or external execution control.
- Existing real Staging evidence before delivery: collaboration XXX, Hola Hola Kopitiam, two planned entries plus one unplanned canonical XHS Post; previous table said `0/2 Published + 1 additional`. Unified result is `1/3 Published`. Its publication confirmation exists but publication date is unavailable, so no date may be invented.

Canonical dev Git Integration delivery and authenticated desktop/mobile Light/Dark verification are recorded in the completion handoff with the final commit/deployment. No Production, main merge, paid API, external publishing or permission changes.
