# WhatsApp Cloud API test acceptance

## Staging audit on 8 November 2026

- Canonical baseline was `3a880a99c43c263dd5b68f67390e695b3d2a43b3`. Supabase Staging had zero WhatsApp connections, platform readiness approvals and Brand pilot approvals. Marketing Meta v93, Inbox v87 and Worker v110 were active. The Chat workspace, verified service window and workflow simulation migrations `20261108073348`, `20261108074901` and `20261108081609` were already applied.
- Meta WhatsApp Manager listed Test WhatsApp Business Account `1675083730240518`, with a test phone ending in 4217, Connected, High quality and one of five test-recipient slots used. Phone Number ID is `1221509657713215`. The Messaging Limits page showed 250 business-initiated conversations per rolling 24 hours. That dashboard figure is separate from the test-recipient allowlist. The test WABA template list showed `hello_world` in English (US), Utility, Active with quality pending. The audit did not verify the controlled recipient, app assignment, live token or webhook subscription.
- FeedX Marketing App `2204918033458414` was Published. Its Use cases page listed Marketing API, Pages, Instagram and Messenger. It did not list a WhatsApp use case. The portfolio's Business Verification was In review. Tech Provider/Advanced Access, a dedicated signup configuration and eligibility of any Business App number still require provider evidence.

## Current execution boundaries

| Surface | Implemented | Needed for the test |
|---|---|---|
| Connections | Brand-scoped authorization, encrypted credentials, exact phone/WABA identity and current-generation verification for the gated Coexistence path. | A separate Staging-only test binding verifies the dashboard test asset with Meta before saving a generation-bound credential. |
| WhatsApp Chat | Canonical conversation records, signed webhook normalization, generation fencing, immutable corrections, deduplication, external echoes and receipt reconciliation against matching outbox evidence. The service window derives from current-generation signed inbound messages. | Live Meta subscription and first inbound. The composer, send-material RPC and transport currently block WhatsApp sending. Manual test replies need a guarded Cloud API transport that consumes the existing durable send authority. |
| CRM | Brand-scoped customer identity and explicit consent/suppression evidence. Inbox uses verified identity relationships. | Link a controlled test identity through the canonical CRM authority. A service conversation and provider phone match alone grant no marketing consent. Verify the same connection, Brand and peer carry replies and staff handoff. |
| Campaign Message | Brand audience, consent and suppression checks, approved revisions and manual recipient handling. Existing caption substitutions are local and staff confirmation records manual handling. | Read approved templates from the verified WABA, validate locale and ordered variables, pin a reviewed template revision, and recheck recipient consent at execution. Official scheduling, per-recipient Cloud API submission, receipt linkage and reply attribution remain pending. |
| AI Flows | Drafts, previews and simulation. | Live runtime remains disabled during this test. |

## Staging secret handoff

In [Staging Supabase Edge Function Secrets](https://supabase.com/dashboard/project/ujkzdaaadnvcfayuldmh/functions/secrets), save the temporary test token as `MARKETING_WHATSAPP_TEST_ACCESS_TOKEN`. Save the UUID of the explicitly authorized isolated Brand as `MARKETING_WHATSAPP_TEST_BRAND_ID`. Leave the existing `MARKETING_INBOX_WEBHOOK_VERIFY_TOKEN` unchanged. The token is read only on the server and the bound credential uses the existing encrypted store.

After Meta confirms the canonical callback, the `messages` field and the test WABA subscription, select the isolated Brand in Marketing → Connections and choose **Verify and bind test number**. A successful bind reports that it is waiting for the first signed inbound event. Remove the temporary secret after the test or rotate it for a new verification. A local pause or disconnect leaves the Meta subscription intact.

## Isolated onboarding handoff

1. In Meta for Developers, identify the app that owns the test WABA or provision a dedicated test app with the WhatsApp use case. The app owner must authorize any new setup, including terms, asset permissions and webhook configuration. Keep the restaurant account out of the test selection.
2. In WhatsApp API Setup, verify the exact App ID, test WABA ID and Phone Number ID. Confirm an explicitly controlled recipient in the Meta test allowlist. Arrange the app credential and scoped token through the approved Staging secret handoff. Do not paste either into chat or commit them. Use Graph token debugging and asset readback to confirm app, expiry, the exact WABA/phone and both WhatsApp grants. Record number quality and messaging limits as separate evidence.
3. Bind the exact test asset and recipient allowlist to one authorized Staging Brand. Reuse Connections, generation fencing and the encrypted store. A dedicated app needs an explicitly configured Staging signature binding for its App Secret. Verify the app-level callback and `messages` field, then verify that the exact test WABA is subscribed to that app. Coexistence sync steps do not belong in a Cloud API test connection.
4. Have the controlled recipient send inbound text. Verify raw Meta signature, exact WABA/phone, durable canonical Inbox row and one message after retry. Then authorize a single staff reply through the reviewed test-only transport. Validate the signed 24-hour window server-side. Outside it, require the applicable approved template and recipient eligibility. Confirm accepted provider message ID and matching delivered/read/failed evidence. An uncertain provider response must retain reconciliation state without blind resend.
5. Keep bulk execution separately gated. Prepare template preview and scheduling only after exact WABA and template evidence is available. Run Coexistence eligibility and external echo acceptance separately through the official Business App flow after provider review, with no registration or changes to restaurant numbers.

Provider contracts: [Meta Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api), [Meta Coexistence onboarding](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users). The [Coexistence acceptance procedure](marketing-whatsapp-signup.md) covers the separate app review and synchronization gates.

The readiness presentation can be accepted independently on Staging. Provider inbound, outbound and delivery acceptance require the authorized asset, recipient, credentials and verified app subscription. Local fixture results provide regression coverage only.

A test verification failure appears beside the WhatsApp controls while the connection list stays available. The Staging Edge response and logs distinguish token validation, asset access, app webhook configuration and test WABA subscription. Logs contain only a fixed reason and an optional Meta error code.
