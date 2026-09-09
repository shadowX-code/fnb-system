# Factory Product Feedback

Factory Product Feedback owns tasting and R&D campaign configuration, anonymous response evidence, and campaign analytics. It is separate from Outlet Customer Feedback and MeSTI.

## Ownership and lifecycle

- A campaign is Draft, Live, or Closed. Only Live campaigns within an optional date window accept public responses.
- A campaign can use one shared link or optional variants, each with an opaque public token.
- Questions are ordered campaign configuration. Response submission records the exact question snapshot and form version, so later campaign edits never reinterpret historical answers.
- Campaign content supports English, Chinese, and Bahasa Malaysia. Admin-authenticated AI translation fills only missing draft content; generated copy remains editable before campaign save and never changes response snapshots.
- Campaign branding is campaign-owned configuration for the public token-bound experience. It may provide logo, hero or completion artwork, and primary/accent colours without changing the public data boundary.
- Responses are anonymous. A hashed local session token provides a repeat indicator only; it never blocks legitimate shared-device or variant submissions.

## Security boundary

- Admin reads and mutations use authenticated, permission-checked Factory RPCs.
- Public entry and submission are token-bound SECURITY DEFINER functions. They expose no campaign, variant, or response database IDs to the public client.
- Public callers can read only a valid live form for their supplied token and can submit only validated answers for that form. They cannot enumerate campaigns or read responses.
- Public submissions retain the selected display language (`en`, `zh`, or `ms`) together with the immutable form snapshot.

## Integration

- Finished Good is an optional Factory master-data reference, not a duplicated product master.
- The Factory module consumes campaign analytics and evidence through its read RPC; it does not calculate response authority client-side.
- The public route is `/feedback/product/<opaque-token>`.
