# WhatsApp Conversations UI acceptance

QA level: L2. This is a shared canonical Inbox presentation change, with no migrations, Edge deployments, provider calls or new storage.

## Deterministic acceptance

Run the focused tests:

```sh
npm test -- src/features/marketing/__tests__/WhatsAppConversations.test.jsx src/features/marketing/__tests__/MarketingInboxPage.test.jsx src/features/marketing/__tests__/InboxReplyReadiness.test.jsx src/features/marketing/__tests__/InboxAssistantComposer.test.jsx src/features/marketing/__tests__/InboxAutomationOwnership.test.jsx --maxWorkers=1
```

Run the isolated visual renderer:

```sh
./node_modules/.bin/vite --config qa/marketing/inbox/vite.config.mjs
```

Open `http://127.0.0.1:4181/qa/marketing/inbox/index.html`. The Vite configuration refuses build mode, aliases only the existing page's Auth/read services to in-memory fixtures and loads no environment credentials. Mutation methods intentionally do not exist. No fixture route is registered in the application and no synthetic conversations are inserted into Supabase.

Check desktop and narrow/mobile: select Fixture customer; scroll through text, history, mobile echo and all six media fallback types; verify delivered/read/failed/uncertain receipts and long text without horizontal overflow; page Older/Newer messages; switch Brand A to empty Brand B and confirm no previous detail/composer remains; search, filter WhatsApp and inspect unread indicators. Staff Reply, AI Suggested Reply and AI resume must stay disabled even though fixture general sending/AI flags are true. Internal Note uses the existing permission-bound authority; never submit a real note during receive-only Staging smoke.

## Canonical Staging acceptance

Verify the exact READY dev commit/project/alias using `npm run verify:staging-vercel-target`. In an existing authorized Staging session, open `/marketing/inbox`, filter WhatsApp and verify the empty explanation; change between authorized Brands without exposing other conversations. Open Connections read-only to confirm onboarding remains disabled. Do not connect a number, submit a note, run OAuth or create business fixtures.

No genuine WhatsApp media, historical import, delivery or mobile echo can be accepted live while the connector remains disabled and no real number exists. Those presentations are fixture evidence only. Current provider contracts deliberately expose media type placeholders and quarantine synchronization history; real playback needs an authorized server media projection, and importing history needs its independent privacy/lifecycle decision. Reuse previous Foundation/Signup/Lifecycle L3 evidence; do not repeat provider or database mutation QA for presentation-only changes.
