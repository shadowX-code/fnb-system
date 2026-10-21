# WhatsApp connector foundation verification and pilot prerequisites

Scope: disabled Staging foundation. Never run against Production. No provider sends, live onboarding, credential installation or AI activation are part of this phase.

## Verification

- `src/features/marketing/__tests__/whatsappInbox.test.ts`: synthetic provider messages/statuses/Business App echoes, bounded input, raw-byte signature verification, attachment placeholders, no sends, no credential or contact adoption.
- `src/features/marketing/__tests__/WhatsAppConnections.test.jsx`: disabled read-only presentation and stale Brand response isolation.
- `qa/staging/marketingWhatsAppFoundation.rollback.sql`: disposable Auth-linked employee, exact action/Brand/tenant access, registration retry, exclusive phone reservation, wrong WABA/phone/Brand/generation, duplicate provider IDs, shared worker ingestion, early/out-of-order receipts, uncertain results, human ownership, no CRM/consent adoption and queued-generation invalidation. All fixtures, synthetic credential placeholders and mutations roll back; no provider call occurs.
- Existing Marketing Inbox adapter, signature, receipt and AI ownership tests remain regression owners. New code does not configure the scheduler or enable any existing execution gate.

The public webhook remains `https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-inbox/webhook`. Its existing verify token and Staging app secret are used without mutation. Unsigned/incorrectly signed POST requests are rejected before provider normalization. Durable persistence failure returns 503; no background acknowledgement is used.

## Next phase: official onboarding implementation

The current foundation does not implement a live Embedded Signup flow. Before implementing/activating it:

1. Confirm the exact Staging Meta app and app-owning business, Business Verification and Tech Provider/access-verification status. Complete the currently applicable review/Advanced Access requirements for external-business service. App publication and FB/IG test success are not WhatsApp approval.
2. Configure the official WhatsApp Embedded Signup / Facebook Login for Business configuration for the intended onboarding variant. Validate authorized callback/SDK domains, single-use actor/Brand-bound state, completion identity and server-side authorization-code exchange. Do not reuse Page-token discovery as WhatsApp authorization.
3. Verify returned WABA and Phone Number ID through the provider, exact app/token identity, expiry, granular asset grants and the required `whatsapp_business_management` / `whatsapp_business_messaging` permissions. Persist customer-scoped credentials through existing encryption and generation authorities, with current/previous key handling and revocation/deletion lineage. This requires separate authorization for any credential installation.
4. Verify the centrally registered WhatsApp-object callback and the app's subscription to the exact customer WABA. Preserve other installed subscriptions. Implement generation-bound verification/repair with durable intents and readback before granting receive authority; do not trust browser assertions.
5. Follow the current official onboarding variant's registration, billing and eligibility requirements. Do not mechanically call the ordinary Cloud registration flow for a Coexistence number, or copy old BSP credit-line steps into a Tech Provider flow.

Primary references: [Meta official Tech Provider sample](https://github.com/fbsamples/business-messaging-sample-tech-provider-app), [Meta Embedded Signup collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup), [Coexistence onboarding guide](https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users/), [WhatsApp messaging policy](https://whatsappbusiness.com/policy/). Recheck current requirements during onboarding; repository fixtures do not prove provider eligibility.

## One-Brand receive-only Coexistence pilot

Select one explicitly authorized Brand and its eligible WhatsApp Business App number. Confirm WABA/phone ownership, current app/version/country/device eligibility and current Meta Coexistence requirements in the official guide. Obtain separate authorization before onboarding or credential/subscription changes. Do not migrate, deregister or disconnect an existing mobile number implicitly.

Verify actual signed inbound text, supported attachment placeholders, `smb_message_echoes` from supported mobile/linked-device clients, exact phone routing and out-of-order receipts. Confirm that current provider echo payloads match the fixtures. History/contact synchronization, edits/revocations, rich messages, media downloading and unsupported clients need separate contracts; none is claimed complete here. Imported history must never be treated as fresh inbound or reopen an automated reply window. Exercise reconnect/revocation and privacy erasure with approved disposable evidence.

Keep sending and AI disabled for that receive-only acceptance. A later sending phase must verify the real customer-service window, provider-approved templates outside it, Brand consent/suppression, current authorization and exact outbox receipts. Staff and AI must share one send authority. Before any automatic pilot, validate explicit takeover/Resume AI, external-echo pauses and cancellation of unstarted work. Mobile staff remain independent senders: an API write already started cannot be recalled, and delayed echoes cannot guarantee zero simultaneous replies. Start with suggest-only handling and a staff ownership procedure.
