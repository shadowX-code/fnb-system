# Factory Product Feedback

Factory Product Feedback owns tasting and R&D campaign configuration, anonymous response evidence, and campaign analytics. It is separate from Outlet Customer Feedback and MeSTI.

## Ownership and lifecycle

- A campaign is Draft, Live, or Closed. Only Live campaigns within an optional date window accept public responses.
- A campaign can use one shared link or optional variants, each with an opaque public token.
- Questions are ordered campaign configuration. Response submission records the exact question snapshot and form version, so later campaign edits never reinterpret historical answers.
- Campaign content and question labels/helpers support English, Chinese, and Bahasa Malaysia. Admin-authenticated AI translation fills only missing draft content; generated copy remains editable before campaign save and never changes response snapshots. Translation requests are deduplicated per editor action, split into bounded provider batches, and retry only transient provider failures with safe structured Admin errors. A question helper uses the canonical `helper_en`, `helper_zh`, and `helper_ms` fields inside the persisted question JSON, with English fallback for public rendering.
- Rating questions use a canonical numeric 1–5 answer value for new submissions. Their public control renders as stars and may carry localized low/high endpoint labels; legacy option-shaped rating definitions and historical answer snapshots remain readable without rewriting stored evidence.
- Once a Live or Closed campaign has responses, its answer semantics remain immutable: question keys, labels, types, options, required rules, ordering, and analytics metadata cannot change. Localized helper copy is the sole permitted question amendment; it applies only to future public reads, increments the form version, and never rewrites stored response snapshots.
- Campaign questions may declare a small canonical analytics role (such as overall rating, purchase intent, spiciness, price acceptance, or a generic choice distribution). The trusted campaign analytics read model resolves KPIs from those roles, never by matching question wording. Price options may retain a display label while carrying structured amount and currency metadata.
- Campaign Overview keeps the universal response count separate from campaign-specific Feedback Insights. Insights are computed from the campaign's current question definition and immutable response evidence; they show only supported distributions, ratings, price aggregates, and sufficiently sampled segment comparisons. Low-volume findings remain directional rather than conclusive. Optional AI interpretation receives only the calculated aggregate, never raw answers or historical response snapshots.
- Campaign branding is campaign-owned configuration for the public token-bound experience. It may provide logo, hero or completion artwork, and primary/accent colours without changing the public data boundary.
- Campaigns may optionally collect a respondent name and Malaysia-normalized mobile number after the final feedback question. Contact collection is campaign configuration, not a question type: public submission writes opted-in contact evidence to a separate response-linked record, while answers, question snapshots, analytics, and AI interpretation remain PII-free. Only the authenticated Product Feedback admin read authority may return contact evidence.
- Responses are anonymous. A hashed local session token provides a repeat indicator only; it never blocks legitimate shared-device or variant submissions.

## Security boundary

- Admin reads and mutations use authenticated, permission-checked Factory RPCs.
- Public entry and submission are token-bound SECURITY DEFINER functions. They expose no campaign, variant, or response database IDs to the public client.
- Public callers can read only a valid live form for their supplied token and can submit only validated answers for that form. They cannot enumerate campaigns or read responses.
- Public payloads expose only the campaign's contact-collection prompt and never stored contact details. Mobile normalization and contact writes happen only inside the trusted public submission authority.
- Public submissions retain the selected display language (`en`, `zh`, or `ms`) together with the immutable form snapshot.

## Integration

- Finished Good is an optional Factory master-data reference, not a duplicated product master.
- The Factory module consumes campaign analytics and evidence through its read RPC; it does not calculate response authority client-side.
- Staging and compatibility links use `/feedback/product/<opaque-token>`. Production canonical links use `https://feedback.feedx.my/<opaque-token>`; legacy Production OS links redirect there without changing the opaque token or public read authority.
