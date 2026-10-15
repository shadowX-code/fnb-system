# Facebook Creator followers — Staging investigation, 16 October 2026

## Verified provider evidence

Read-only Graph v26.0 checks used the retained Hola Page credential inside the Staging worker. `debug_token` confirmed valid PAGE type. Granted scopes included `pages_read_engagement`; credentials, app secret and HMAC proof remained server-side. No OAuth, subscription or provider write occurred. The temporary scheduler-secret-authenticated comparison route was removed after the checks; normal `/tick` was never invoked for acceptance.

| Target | Request | Result |
|---|---|---|
| Managed Hola Page 113234221623434 | `id,followers_count` | HTTP 200, 4226 |
| Managed Hola Page | `id,fan_count` | HTTP 200, 4226 |
| Public `kakitangandotcom`, Page token with HMAC proof | Each count field separately | HTTP 400, Graph 100, no subcode |
| Public `kakitangandotcom`, app token | Each count field separately | Same HTTP 400 / Graph 100 |
| Managed Hola Page, normal existing adapter | `id,username,link,followers_count` | ready, 4226, `meta_facebook_page` |

The public Page error explicitly states that the endpoint requires `pages_read_engagement`, Page Public Content Access or Page Public Metadata Access. The returned error also generically mentions object existence; no numeric third-party Page ID was established, so no guessed ID was saved. Trace IDs: Page-token followers `AGJFGGHEY--r00zVMMBREEM`, likes `Ap1rF4tw0Yopctq6iZGMXdO`; app-token followers `AQ6f3eCGUen4ZIHAgMZR3zd`, likes `APNArVOWn7QVEEsylCfdWcV`. The identical feature-access rejection with both credentials rules out switching tokens as a sufficient correction. It does not establish that every public Page will become available after approval.

Facebook URLs are parsed by the existing profile identity authority. A saved numeric identity is preferred; otherwise the saved canonical handle is sent to Graph and must match returned username/link and numeric ID. Names are not searched or used to infer identity. The existing third-party record has no numeric external ID; it was preserved unchanged.

## App and documentation inspection

FeedX Marketing App 2204918033458414 is Published. The existing Pages use case lists `pages_read_engagement` as Ready for testing. PPMA/PPCA approval was not displayed in that use case, and PPMA was not offered among the current Add Use Cases choices. Published/testing status is not Advanced Access evidence. Actual third-party Graph reads confirm current effective access is insufficient. No review was submitted, scopes added or app configuration changed.

Official [PPMA reference](https://developers.facebook.com/docs/features-reference/page-public-metadata-access/) was read in the authenticated browser. It permits public Page Like/follower analysis, requires successful App Review and business verification, and may require additional contracts. PPCA supersedes PPMA; an app with PPCA approved or in its submission cannot request PPMA separately. [Page reference](https://developers.facebook.com/docs/graph-api/reference/page/) defines `followers_count` as followers and `fan_count` as Likes, with the New Pages Experience exception that `fan_count` returns followers. Equal results are not evidence to replace the follower field.

## Required external steps — not performed

1. An authorized Meta app administrator must establish completed business verification for the app's business; its current completion was not proven by this check.
2. In the app's App Review / permissions-and-features flow, obtain Advanced Access for **Page Public Metadata Access** for public Creator Page follower analysis, or verify an existing PPCA grant instead. PPMA is a reviewed feature, not an additional OAuth scope. Current use-case UI did not expose a request control; Meta support/app eligibility guidance is needed if the feature remains unavailable. Do not create a replacement app or disturb current connections merely to expose the control.
3. Prepare reviewer access/instructions and a screencast showing FeedX Creator profile URL → official read → count/source/time and honest unavailable state. Describe public Page engagement analysis, data handling, retention/deletion and privacy policy. Complete any Meta-required contracts or verification steps.
4. After approval, perform one bounded read against the exact public Page, verify returned numeric identity and `followers_count`, then run canonical Refresh and verify persisted evidence. Reconnect only if required grants/token validity actually changed.

## Scoped implementation

Preserved token selection, Page identity checks, exact follower field, all scheduling/leases/cooldowns and failure retention. Added bounded credential-redacted Page error evidence at MetaGraph's existing inspection callback, and a safe public-Page-access-required status when Meta explicitly names PPMA/PPCA. Generic errors and expired tokens retain their own handling. UI explains that reconnecting alone does not grant this feature. No schema migration, new authority, manual count entry or provider write.

QA: L2 focused adapter/worker regression and build, canonical Staging delivery, authenticated Refresh/status verification. See final handoff for actual suite and deployment results. Managed Page success was verified through the normal adapter without creating a duplicate Creator. End-to-end third-party success remains blocked by effective Meta access; it is not claimed.
