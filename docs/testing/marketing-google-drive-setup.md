# Marketing Google Drive: Staging setup and verification

Connector foundation is implemented; **live Google access remains unverified and disabled until configuration/authorization**. No Cloud project, OAuth client, external grant or Drive folder has been created by this implementation.

## Exact external configuration

1. In a user-approved Google Cloud project, enable **Google Drive API**. Create a separate **Web application** OAuth client for Staging.
2. Google Auth Platform: **External** audience for personal Gmail, initially **Testing**. Add only the approved connecting Google account as a test user. Use approved FeedX branding/support contact and the public policy `https://feedx.my/privacy`. Review Google-specific disclosure/Limited Use compliance before any verification/public release; this task does not publish or revise that policy.
3. Add this exact **Authorized redirect URI**, with no trailing slash:

   `https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-drive/callback`

   The FeedX return UI is `https://fnb-system-staging.vercel.app/marketing/settings`. No browser Google SDK is used; **Authorized JavaScript origins are not required by this server OAuth flow**. For branding/domain verification, use domains FeedX actually owns (e.g. `feedx.my`); do not claim ownership of `supabase.co` or `vercel.app`. If Google verification requires an owned callback domain, an approved custom-domain routing change is a separate dependency, not a permission bypass.
4. Request exactly one Google scope:

   `https://www.googleapis.com/auth/drive.readonly`

   `access_type=offline` obtains refresh credentials; it is not another scope. No Drive write, full-drive, Gmail, OpenID/profile or Workspace administration scope is requested. Drive `about.user` identifies the connected account under the same Drive scope.
5. Enter these **server-only Staging Supabase Edge Function secrets** securely (never in chat, frontend environment variables, commits or screenshots):
   - `MARKETING_GOOGLE_DRIVE_CLIENT_ID`
   - `MARKETING_GOOGLE_DRIVE_CLIENT_SECRET`
   - `MARKETING_GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY` — securely generated 32-byte key, base64 encoded; keep it with approved key custodians.
   - Optional rotation only: `MARKETING_GOOGLE_DRIVE_PREVIOUS_TOKEN_ENCRYPTION_KEY`.

   Existing Supabase platform secrets are reused by the function. No Meta credentials or execution settings change.
6. After separately authorizing external setup and OAuth, use **Marketing Settings → Google Drive → Connect Google Drive** as a canonical organization administrator. Explicitly map each brand's original-media folder, then optional in-root Favorites. Ordinary staff browse only their authorized brand folder and do not configure Google Cloud.

## Scope and verification consequences

Google classifies `drive.readonly` as **restricted**. It supports reading existing recursive folders/metadata/content; `drive.file` is limited to files selected/opened for the app and does not provide this unrestricted existing-folder browser contract. The granted token can read the connected account's Drive, while FeedX limits ordinary access to explicitly mapped brand roots. Prefer a dedicated media account with only the intended creative assets.

Google documents development/testing/Staging exceptions to verification; external Testing credentials have tester warnings/user limits and refresh-token expiration (normally seven days for this scope), so reconnect can be required. Do not represent a Staging grant as public SaaS approval. Public use of restricted scopes and server storage/transmission may require restricted-scope verification and a security assessment unless an applicable exception is confirmed. Future Workspace internal use and Shared Drives must be assessed separately.

Official references: [Drive scope classifications](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [restricted-scope verification and exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies).

## Focused acceptance boundary

Local/rollback verification covers ancestry/shortcut isolation, source-version change rejection, fixed provider transport, byte signatures, role/service boundaries, stale generation rejection, disconnect invalidation, protected references, reconciliation-bound cleanup and legacy exclusion. Synthetic provider fixtures establish integration contracts only.

After credentials are approved: verify actual OAuth and refresh/revocation, explicit folder mapping and overlapping-brand rejection; folder/search/Favorites/shortcut navigation; actual image/video previews; Drive import version/hash; device upload and legacy selection; draft/review/approval/schedule preservation; and a disposable new snapshot's Storage API cleanup after authorized receipt reconciliation. Do not publish an external post to complete Drive browsing acceptance. Actual Shared Drive policies, OAuth behavior and Drive media are unverified until that live pass.

## Non-mutating preflight

`GET /functions/v1/marketing-drive/configuration` returns only `configured`, `encryptionKeyValid`, the fixed redirect URI and scope. The key check runs the existing bound AES-GCM seal/unseal entirely in server memory, accepting only supported base64 encodings that decode to 32 bytes. It does not initiate OAuth, store state, disclose key material/ciphertext or call Google. `configured` also requires all three server secrets to be non-empty. This cannot prove Google client-secret validity or user consent; those require separately authorized live OAuth.
