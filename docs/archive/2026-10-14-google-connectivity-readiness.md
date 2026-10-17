# Historical Google Connectivity Readiness

Historical evidence only. Preserved on 17 October 2026 from the pending addition in `/Users/deron/Dev/feedx/docs/domains/crew-performance-and-reward.md`; original file SHA-256: `8a8b9947af1685969ec352e1e898038a50936bb2f8c07510a2e579b7061dcedc`.

The excerpt below predates the implemented Phase 1/2 Google integration. Its proposed next steps and temporary callback are not current setup instructions. Current authority remains [Crew Performance And Reward](../domains/crew-performance-and-reward.md) and its linked verification contracts. The original dirty worktree is unchanged.

## Preserved pending excerpt

### Google Connectivity Readiness — 14 October 2026

The approved Google Cloud project is `feedx-production` (number `523893489763`). Its single `FeedX Business Profile` Web OAuth client is configured for `https://www.googleapis.com/auth/business.manage`, External/Testing audience, and the approved owner test user. The registered `http://localhost:8768/oauth/callback` is a temporary server-side read-test callback, not a deployed FeedX Production endpoint. Do not create another client or treat this test configuration as a persistent Production connection.

An owner-authorized test successfully listed one account and eight managed locations, then read both pages of JYMT's 66 reviews; no owner replies existed in that location's returned evidence. Chrome displayed `ERR_BLOCKED_BY_CLIENT` for the loopback page despite successful callback processing and a healthy local server. This identifies a client-side page restriction; the specific browser extension/policy was not established. No tokens were persisted, no Google business data was changed, and no FeedX runtime capability was enabled.

The next implementation must reuse the existing server credential security patterns, add a permanent HTTPS callback to the same client, and obtain a server-held grant with encrypted refresh-token custody. Implement the dormant provider contract and explicit account/location/outlet mappings before enabling the existing reputation workspace. Preserve review comments and existing `reviewReply` evidence in the read contract without adding reply publication. Google API approval and this successful connectivity test do not remove the separate retention/scoring policy gate above. First-party Customer Feedback remains separate.
