# Isolated XHS Reader pilot

## Boundary and activation

The Staging Creators administrator drawer is a control client, not a credential store. The isolated Node worker binds only loopback (`127.0.0.1:4765`). A separately approved private HTTPS reverse proxy must expose only `POST /v1/reader` to FeedX's server. Do not expose a browser debugger, unrestricted MCP server, filesystem or upstream proxy. Do not point Production at this service.

No approved host or secrets are supplied by this implementation. Vercel's existing per-request public inspector is not used as persistent QR/session hosting. A continuously running existing host can avoid incremental hosting charges, but compute, bandwidth and operator maintenance are not free. Do not create a paid host or a tunnel without explicit approval.

Before live activation establish permission for commercial session-based note access under the applicable XHS agreement. Account-holder consent and an open-source code licence alone do not establish platform permission. Primary XHS agreement pages did not expose readable agreement text in the reviewed response; permission remains unestablished. Live login, credential persistence and note access each require the user's explicit scoped approval. No challenge solving, synthetic identities, fingerprint modifications, proxies, browser-session extraction or blocked-session refresh is supported.

## Source review and approach

Reviewed immutable references:

- `xpzouying/xiaohongshu-mcp`, commit `7797fd375aba02dcd33afe143f6bee13e5870859`: Apache-2.0. QR image and authenticated DOM signal inform the pilot's selector pattern. Its whole MCP service is not adopted: it also publishes/interacts, stores plaintext cookies and includes fingerprint/proxy configuration. No Go binary or custom browser is installed.
- `hellojiaru/xiaohongshu_note_reader`, commit `eaad81cdab9b6cdda45d15f1f6acaf2f655d61d1`: no licence file or package licence declaration found at that commit. No code is copied. It uses persistent Chromium profiles/plaintext storage exports, raw HTML/comment artifacts, and a VM parser fallback; those features are not adopted.

FeedX reuses installed `playwright-core`, its canonical URL resolver, exact Post ID, thumbnail validation, reduced metadata parser and existing Creator review/save authority. There is no extra Post database, full-content archive, comment collector, publishing capability or paid data adapter. The canonical hydration parser reads only the assigned data object, handles bare JS values outside strings, and never executes the script.

## Configuration (all inactive until separately authorized)

Worker environment:

- `XHS_READER_ORG`, `XHS_READER_BRAND`: one explicit existing pilot scope, not inferred from an XHS account.
- `VITE_SUPABASE_ANON_KEY`: existing Staging public API key. The worker never receives a Supabase service-role key.
- `XHS_READER_CHROMIUM`: an approved installed standard Chromium executable; no automatic download, custom fingerprint or stealth build.
- `XHS_READER_SESSION_FILE`: absolute path on the private worker host, outside the repository/web root/backups by default.
- `XHS_READER_ENCRYPTION_KEY`: independent canonical base64 encoding of exactly 32 random bytes, supplied through the host secret store after approval. Never place it in chat or client configuration.
- `XHS_READER_PLATFORM_USE_CONFIRMED=true`, `XHS_READER_LIVE_APPROVED=true`, `XHS_READER_SESSION_APPROVED=true`: all required before browser launch. These record operator prerequisites; they do not create provider permission.
- Optional `XHS_READER_PORT`: default 4765, loopback binding stays mandatory.

After host/configuration approval: `node server/xhsReaderPilot/server.mjs`. Do not run against a real session during unapproved QA.

FeedX Staging server-only environment:

- `MARKETING_XHS_READER_ENABLED=true`
- `MARKETING_XHS_READER_URL=https://<approved-private-host>/v1/reader`
- `MARKETING_XHS_READER_ORG`, `MARKETING_XHS_READER_BRAND`: exactly the worker's selected scope.

No values are generated, installed or enabled by deployment. The disabled bridge cannot contact the Reader. The bridge sends the caller's existing Supabase Bearer token only to the explicitly approved fixed HTTPS endpoint, rejects redirects, and never returns XHS cookies/storage to the client. Approval of that host and token forwarding is required before configuration. TLS termination, network allowlisting, service supervision and key custody are host responsibilities to verify before activation.

## Authorization and resource limits

Every worker action validates the current canonical `platform_organizations.manage` permission and `marketing_creator_directory` Brand authority with the caller's token, before and after the action. This is the existing delegated administrative permission, not a new Reader role. Extraction also obtains/releases `marketing_creator_inspection_access`, retaining the current single-member lease and daily quotas. Non-pilot Brands and non-administrators retain the existing anonymous/manual path. No grants, memberships or RLS are changed.

One worker accepts one browser-changing action at a time. QR waits at most three minutes and never automatically starts a new login. Reads have fixed provider/CDN host allowlists, public IPv4 DNS pinning, request/body/byte/time limits, a 25-second browser-close deadline, 3-second request pacing and a 32-entry, five-minute in-memory cache keyed by canonical Post ID. The process is statically scope-bound; no cross-tenant cache exists. A cached result retains its original observation timestamp. Provider challenge/rate-denial/login redirects invalidate local session use and stop; there are no automatic extraction retries or renewals.

Only normal GET/HEAD requests, bounded login-flow POST paths while awaiting QR login, and the read-only note-feed POST during extraction are allowed. Other write methods/endpoints, downloads, WebSockets, service workers and popups are blocked. No upstream response, request headers, cookies or share query values are logged. Approved host egress controls should additionally deny private networks; the application does not expose arbitrary URLs.

## Session lifecycle

User opens **Creators → XHS Reader Pilot**, explicitly starts QR login, scans/confirms in their XHS app, then selects **Check Status**. No background UI login polling occurs. A real authenticated navigation signal plus a non-expired `web_session` cookie is required before storage. Session contents use AES-256-GCM with scope-bound associated data, random IVs, atomic replacement and mode 0600 files. There is no persistent browser profile or plaintext exported state. Maximum local retention is 24 hours or the earlier session-cookie expiry. Startup treats retained state as unverified until a read succeeds. Expired/blocked state is not renewed. Reconnect explicitly clears the old state and starts a fresh user-controlled QR flow. Disconnect clears session and cached observations and closes the pending browser; it does not claim remote XHS account-wide logout or secure erasure from filesystem backups.

On extraction, exact note state is reduced through the existing parser. Creator matching remains exact verified-account matching; Save remains staff-confirmed and canonical duplicate protection is unchanged. Existing duplicates may be inspected by the active administrator pilot but retain their original canonical identity and require explicit review/save. Unknown dates and metrics stay unavailable; source/method is `authorized_session`, never an official API receipt or paid/public-cache observation.

## Acceptance boundary

Fixture tests cover encryption/tampering/scope mismatch, administrative and Brand denial/revocation, QR confirmation without auto-polling, concurrency, expiry/challenge stop, cached observation timestamps, exact-note identity and unknown-vs-zero metrics. Fixtures are not real extraction evidence.

Still required after authorization: verify host/TLS/egress, real QR selectors and login endpoints, actual XHS permitted session use, both supplied short/full-share URLs, real field coverage/latency in authenticated FeedX, canonical save/Creator matching, and genuine expired-session reconnection. Never claim these passed from fixtures or the disabled drawer. No live XHS account, cookie, paid API or Production is used during preparation.

## Hosting and platform-use evidence (14 October 2026)

Read-only discovery found the canonical `fnb-system-staging` and `fnb-system` Vercel projects. The repository records no deployed dedicated browser worker/private HTTPS endpoint. No other cloud-host inventory is available through the connected tools; this does not establish that the owner has no other infrastructure. This Mac has Node and standard Chrome installed. Docker CLI is present but its daemon is unavailable; Caddy, nginx, cloudflared and Tailscale CLIs were not found, and no port-443 listener was found. No services, accounts, DNS, ports or tunnels were created.

The smallest local runtime is the existing Mac's Node + approved standard Chrome, running the loopback worker without Docker. Incremental host rental is $0/month if reusing that equipment; electricity, bandwidth, administration and any approved HTTPS access path are additional/unmeasured. There is currently no verified private HTTPS route from Vercel to it, so this is not an end-to-end hosting solution. An existing owner-supplied Linux host with 2 GiB RAM and private HTTPS could run the same worker; no such host is verified. A new VM is a separate paid fallback, not authorized: DigitalOcean's public Basic 2 GiB/1-vCPU example is US$12/month before tax, optional backups and overages (https://www.digitalocean.com/pricing/droplets). Do not provision it based on this estimate.

XHS's primary robots policy (https://www.xiaohongshu.com/robots.txt) returned HTTP 200 with `User-agent: *` / `Disallow: /`; exceptions name specific search crawlers, not FeedX. This is a published automation restriction, not a complete legal determination. The primary user agreement page at https://agree.xiaohongshu.com/h5/terms/ZXXY20220331001/-1 rendered no readable agreement text in the reviewed browser; no commercial-session permission was established. The owner explicitly confirmed no commercial automation agreement exists. Keep platform-use confirmation false until an applicable reviewed agreement or written XHS authorization establishes the permitted scope. QR account-holder consent alone does not resolve this.

For the live pilot, also configure worker-only `XHS_READER_POST_IDS` with at most five exact approved canonical note IDs. An unlisted note is rejected before authenticated browser launch. Short links still use the existing anonymous resolver before this check. No arbitrary note/account crawling is authorized by starting a session. Acceptance requires a separately approved host/TLS route and secret custody, permitted commercial-use scope, exact account/Brand/Post test scope, one user-initiated QR login and encrypted retention (maximum 24 hours), and bounded live reads. No provider-side publishing/interactions are included. At present those conditions are unresolved; do not initiate login or ask the owner to treat personal consent as provider permission.

## Mac connectivity preparation: mutual TLS and synthetic-only mode

The existing Mac is the preferred zero-rental host. Native Node HTTPS is available without Docker or a new runtime subscription. `readerServer` accepts optional TLS with mandatory client-certificate verification, a dedicated trusted CA and an exact client-certificate SHA-256 fingerprint. The listener remains bound to `127.0.0.1` in both HTTP and HTTPS modes. Mutual TLS supplements, and never replaces, canonical FeedX administrator and Brand authorization. TLS 1.2 or newer, hostname/CA validation, timeouts, body limits and no redirect following are mandatory. There is no insecure-certificate fallback or automatic retry.

Set `XHS_READER_SYNTHETIC_ONLY=true` for connectivity preparation. This mode does not construct `createReader` or the session store and needs no XHS encryption key/session file. It serves only authenticated synthetic status; login/check/disconnect/extraction actions fail before any inspection-meter mutation. It cannot emit fabricated Post metadata for Save. No live/session/terms flag can override synthetic mode. No background login, startup service, launch agent or recurring job is installed by the implementation.

Optional future worker TLS configuration is server-only: `XHS_READER_TLS_CERT`, `XHS_READER_TLS_KEY`, `XHS_READER_CLIENT_CA`, `XHS_READER_CLIENT_FINGERPRINT`. All four must be supplied together. FeedX Staging's optional mTLS client configuration is `MARKETING_XHS_READER_CLIENT_CERT`, `MARKETING_XHS_READER_CLIENT_KEY`, `MARKETING_XHS_READER_CA_CERT`; partial configuration fails closed before forwarding a token. These are configuration names, not provisioned credentials. Real TLS/session keys have not been generated, persisted or deployed. Approved real worker keys should be held in the Mac's protected secret custody, separate from the encrypted session file; the Staging client key belongs only in the approved server secret store. Do not put keys in repository files, chat, logs, frontend variables or shell history. Key custody and rotation require separate setup approval.

Synthetic acceptance uses real loopback HTTPS sockets, in-memory disposable OpenSSL certificates and the production endpoint/transport code with mocked canonical RPC responses. Tests prove: correct mTLS + application auth, missing/untrusted certificates, wrong client pin, wrong Brand/JWT, no XHS actions, stopped-worker failure and explicit-request recovery, certificate-change denial and no redirect forwarding. The test deliberately does not weaken TLS even if unsafe override properties are supplied. Fixtures are not trusted business identities and keys/certificates are never written to disk; sockets close after each test. Existing session tests use only disposable encrypted fixture records and remove them after verification.

Reproduce locally: `npm test -- --maxWorkers=1 src/features/marketing/__tests__/xhsReaderHttps.test.js src/features/marketing/__tests__/xhsReaderClient.test.js src/features/marketing/__tests__/xhsReaderPilot.test.js`.

### Private route decision

There is still no verified private network route from canonical Vercel Staging to this Mac's loopback listener. Local mTLS acceptance is not Staging-to-Mac connectivity. A direct localhost URL or self-signed public URL must not be configured in Staging as a substitute.

Cloudflare Tunnel plus Access was evaluated: it provides outbound-only origin connections and service authentication, but requires an ongoing provider configuration, tunnel/Access credentials and hostname/private routing. That conflicts with the present prohibition on introducing recurring services or provider mutations. No account, tunnel, DNS record, policy, service token or public quick tunnel was created. References: https://developers.cloudflare.com/use-cases/apis/internal-services/ and https://developers.cloudflare.com/tunnel/concepts/routing/ . Private-hostname routing additionally needs a supported private-network client; public-hostname Access is not the same as a private IP route.

Vercel Secure Compute was also evaluated; its private networking is an additional commercial service rather than an already verified free Mac route. It was not enabled. Reference: https://vercel.com/changelog/secure-compute-is-now-self-serve . No reverse tunnel, mesh client or network service was installed or started.

Under current constraints, readiness is **local security preparation verified; end-to-end connectivity blocked**. The remaining connectivity decision is to supply an existing approved private route usable by Vercel, or separately authorize a specific connectivity service and its provider changes. Only after host routing and real TLS/key custody are approved and verified should `MARKETING_XHS_READER_ENABLED` be configured. Leave it unset/false now. That network approval still does not authorize XHS login or note extraction.

The remaining live-XHS approvals are unchanged: establish permitted commercial session-based use under the applicable XHS terms; identify the account, Brand and exact Post allowlist; explicitly authorize one QR login, encrypted session retention up to 24 hours and bounded read-only acceptance. All live/session/platform-use flags remain unset/false. No real XHS URL or session is used for connectivity tests.
