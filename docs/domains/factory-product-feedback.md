# Factory Product Feedback

Factory Product Feedback owns tasting and R&D campaign configuration, anonymous response evidence, and campaign analytics. It is separate from Outlet Customer Feedback and MeSTI.

## Ownership and lifecycle

- A campaign is Draft, Live, or Closed. Only Live campaigns within an optional date window accept public responses.
- A campaign can use one shared link or optional variants, each with an opaque public token.
- Questions are ordered campaign configuration. Response submission records the exact question snapshot and form version, so later campaign edits never reinterpret historical answers.
- Responses are anonymous. A hashed local session token provides a repeat indicator only; it never blocks legitimate shared-device or variant submissions.

## Security boundary

- Admin reads and mutations use authenticated, permission-checked Factory RPCs.
- Public entry and submission are token-bound SECURITY DEFINER functions. They expose no campaign, variant, or response database IDs to the public client.
- Public callers can read only a valid live form for their supplied token and can submit only validated answers for that form. They cannot enumerate campaigns or read responses.

## Integration

- Finished Good is an optional Factory master-data reference, not a duplicated product master.
- The Factory module consumes campaign analytics and evidence through its read RPC; it does not calculate response authority client-side.
- The public route is `/feedback/product/<opaque-token>`.
