# Marketing Phase 2 Staging acceptance — 10 October 2026

Documentation Impact: Updated (`docs/domains/marketing.md`, `docs/testing/marketing-inbox.md`, milestone log and this evidence).

## Delivered internal scope

Canonical Staging implementation: dev commit `575902ce4d1a563b49dc913fa5ac3c9f6a65dc24`, Vercel deployment `dpl_6i4wuKn3PdSNRYHYDN3vn7yyaccu` READY in `fnb-system-staging` (`prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi`). Supabase project `ujkzdaaadnvcfayuldmh`; migration `20261010065634_marketing_inbox_phase2_workflows.sql` applied and `marketing-inbox` redeployed. Production untouched.

Brand-scoped conversations, assignment, notes, statuses, priority, tags, takeover, reply review, AI proposal review and approved FAQ matching reuse the existing Inbox authorities. New work adds per-staff unread watermarks, assignee/unread filters, supported comment normalization and separate comment authority, intent/language classification, opt-out takeover, default Suggest mode, scoped analytics and provider delivery contracts. Social identities remain separate from canonical customers.

The server-only delivery adapter is a contract with tests, not a live sending route. Approved replies remain blocked in the canonical outbox. Auto FAQ is configurable internal matching/proposal behavior; automated external responses are not operational.

## Verification

- 90 focused tests in 15 Marketing test files passed; Vite build and pinned Deno checks passed.
- Extended `marketingInbox.rollback.sql` passed before and after deployment, rolling back all fixtures. Covered scoped access, message/comment deduplication, separate comment threads without a DM messaging window, read-watermark bounds and monotonicity, opt-out takeover enforcement, literal message search, assignee/unread filters, analytics nullability and blocked outbound evidence.
- Provider contracts cover exact-recipient receipt verification, checkpoints, definitive failure, unknown delivery reconciliation without repeating writes, operation-specific authorization and opt-out/window guards. These tests do not certify real Meta delivery.
- Authenticated canonical Staging UI: created explicitly internal case “Phase 2 Staging acceptance · internal only · 10 Oct 2026”; saved internal note, assigned Isaac Yap, Pending status, High priority and two QA tags, then Resolved. Sending remained disabled. Search found the resolved case; existing acceptance history remained available.
- Settings displayed default Suggest mode, unapproved current Brand Knowledge, no approved FAQ and no AI consent. Reply/summary/FAQ generation displayed Provider Unavailable and disabled actions. No fictional facts, model credentials or brand consent were added.
- Analytics displayed two internal conversations, zero unresolved and unavailable first-response, AI acceptance and automation metrics. Drafts are not counted as delivered responses.
- Current browser layout at 782px had body width equal to viewport and showed list/thread with handling below. The documented browser viewport override did not change the tab dimensions; 1440px desktop and 390px narrow-mobile acceptance remain unverified. The mobile list/thread/back implementation is present but must be exercised with an effective mobile viewport.
- Live negative HTTP checks: unauthenticated configuration 401; unsigned webhook POST 401. No event was accepted or external API invoked.
- Safe Staging SQL verified both existing publishing connections still have credential generation 4, publishing eligibility true and execution false. No retained credentials, OAuth scopes, bindings or publishing resolver were changed.

## Remaining live dependencies

Both Meta channels accurately display Permission Required and unverified receive capability. Existing grants do not include `pages_messaging` or `instagram_manage_messages`. Comments independently require Facebook `pages_read_user_content` for reception / `pages_manage_engagement` for reply, and Instagram `instagram_manage_comments`. Configure only approved scopes after checking app access requirements; preserve existing publishing grants and exact Idamans asset selection.

Official callback: `https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/marketing-inbox/webhook`. Server secret `MARKETING_INBOX_WEBHOOK_VERIFY_TOKEN` supplies verification; signatures use the existing `MARKETING_META_APP_SECRET`. A callback challenge, channel subscriptions, fresh operation-specific task evidence and genuine signed inbound message/comment must be verified before marking receive Operational. No subscriptions or Meta permissions were changed in this delivery.

Real AI requires the existing `OPENAI_API_KEY`, `MARKETING_AI_ENABLED=true`, an explicitly configured `MARKETING_AI_MODEL`, approved current Brand Knowledge and brand consent. Keep contact redaction, language support and sensitive/unknown escalation guards. Live AI generation has not been certified with the current unavailable provider.

Outbound enablement is a subsequent explicitly approved, bounded integration step: wire canonical durable sending authority only after verified channel authorization/window constraints, then request approval for exact recipients and messages. Do not activate automation or report Phase 2 fully complete before genuine receiving, AI and delivery acceptance. Phases 3/5 and Production remain outside scope.

Official connector references: [Messenger Send API](https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api), [Instagram with Facebook Login](https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login), [Page webhooks](https://developers.facebook.com/docs/graph-api/webhooks/reference/page/), [Instagram webhooks](https://developers.facebook.com/docs/graph-api/webhooks/reference/instagram/).
