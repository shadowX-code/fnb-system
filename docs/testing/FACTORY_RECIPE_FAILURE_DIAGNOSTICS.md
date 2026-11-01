# Factory Recipe failure diagnostics

Recipe read behavior, the 30-second deadline, existing retries and complete-data guards remain unchanged. Diagnostics never upload data or persist it to browser storage. The pending collector is limited to four concurrent reads, 24 query entries / transport attempts and 12 auth signals per read. Success discards the transient metadata. One redacted failure report remains for 30 minutes in the current tab, including across a successful Retry; reload, sign-out, identity replacement or Clear report removes it. Navigation cancellation alone creates no report.

After an incident, a protected Owner/Admin with Product Recipes View can use **Export diagnostic report** in the **Recipe read diagnostic available** bar in Factory. This bar is outside route loading/error content so a failed bootstrap does not hide export. Export before refreshing the tab. The JSON download is `feedx-recipe-read-failure.json`; there is no remote submission.

The report contains:

- A local incident/query/transport correlation ID, stage, attempt and offsets/duration; the server request ID when readable. Local IDs are not transmitted. Existing opt-in performance trace IDs are reused where available without introducing another request header.
- HTTP status and header arrival, SDK processing completion and actual body-reader stage where the existing performance observer exposes it. Diagnostics themselves never clone, read or parse a response body.
- Numeric browser Resource Timing phases/byte counts/protocol when available. CORS-restricted phases are null; an unfinished/missing entry is marked unavailable. A missing server ID means unobservable, not absent on the server.
- Abort timing and bounded refresh request/response/Auth event timing without identity or token values.
- Expected and received Recipe/item counts. Unknown expectations remain null. Counts are per current reconciliation attempt and may describe partial results that completeness guards reject; they are not authoritative business output.

No URL, query parameter, Recipe/row identity, payload, credential, response body, raw error message or arbitrary header value is exported. Report size and retention are bounded. A clear/expiry/newer incident cannot be reversed by a late obsolete request completion.

## Focused verification

Automated checks cover pass-through request/Response/error identity, no diagnostic body consumption, redaction, HTTP failure, headers followed by a stalled body, exact deadline/abort behavior, Resource Timing limitations, partial 350-item reconciliation, unchanged successful complete reads, existing reconciliation retry count, stale/cleared incident protection, expiry, auth metadata and export role gates.

Canonical Staging QA should verify a normal Recipe read produces no failure bar; temporarily block only Staging Recipe reads and confirm the bar/export; restore networking, Retry and confirm complete data returns while the report remains exportable. Verify Finished Goods keeps its catalog and complete-support guards during failure, and unrelated navigation stays available. Remove temporary browser conditions. No schema, business-data fixture, permission change or Production delivery is needed.
