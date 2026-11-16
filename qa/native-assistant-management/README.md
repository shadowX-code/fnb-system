# Native Assistant management QA

Presentation-only management refinement; existing configuration, tool test and voice-policy actions remain authoritative. No provider tests or Voice activation are needed for UI QA.

Run:

```sh
npm test -- --maxWorkers=1 src/features/integrations/NativeAssistantSettings.test.jsx src/features/integrations/ExternalAgentsPage.test.jsx src/features/integrations/assistantProviderPresentation.test.js src/features/ai-assistant/VoiceUsage.test.jsx src/features/ai-assistant/voiceUsageSummary.test.js src/features/ai-assistant/useAssistantBridge.test.js
node node_modules/vite/bin/vite.js --config qa/native-assistant-management/vite.config.mjs
node qa/native-assistant-management/browser.mjs
```

The serve-only local harness renders actual components and canonical styles with explicitly labeled fixture data. Its service permits only configuration and usage reads; mutations, paid tests and business reads reject. Browser checks cover all three sections at 1440, 1040 and 400 CSS pixels, page overflow, branded filter menus and Escape dismissal. Screenshots and checks go to `/tmp/feedx-assistant-management-refinement`.

Canonical Staging acceptance: open AI Integrations → Native Assistant as an authorized Admin; inspect provider/test timestamps, capability state and usage records without activating Voice or running a paid provider test. Confirm read-only settings access under a suitable existing account. Source readiness is metadata only, not permission to access documents. Tests distinguish disabled Factory access from a server-denied caller and preserve the existing explicit read-test action.

No new retrieval, provider, grant, database or voice-session contracts.

## Cost evidence audit · 16 November 2026

Read-only aggregate inspection of Supabase Staging `ujkzdaaadnvcfayuldmh`:

- 22 reservation records (all OpenAI); all fit within the bounded latest-30 management read.
- 8 observed-usage reports; 7 have numeric input/output audio pairs.
- 0 reports contain a model, text-token pair, cache breakdown or pricing version.
- 8 leases have server connection/closure duration; no lease connection configuration contains a model field.
- 0/22 records support a complete model-specific cost estimate. Do not infer historical models from current provider configuration.
- Staging policy remains enabled, 180 seconds, 4 concurrent slots, no daily count or mandatory approval. The Production policy template in this Staging database remains disabled. Production itself was not queried or changed.

The SDK currently accumulates only response audio totals and persists those through the existing owner-bound report action. Missing audio detail can be coerced to zero by that legacy collector; totals remain observations, not certified billable coverage. No change to the SDK collector or voice lifecycle is included here.

Current official model pricing was checked at https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini on 16 November 2026: USD per million tokens is text input 0.60 / cached input 0.06 / output 2.40, audio input 10.00 / cached input 0.30 / output 20.00. These current rates are research evidence, not a historical price snapshot for the saved sessions, and are intentionally not applied. Grok has no saved sessions in this sample. Future estimation needs a server-associated model, complete/deduplicated token categories, report-completeness evidence and applicable versioned pricing; it must remain distinct from provider invoices.

Renderer fixtures are not authenticated Staging evidence. Policy Edit/Cancel and filter tests must not save live settings or start Voice. The summary reports filtered record counts and coverage; it is not a monthly billing total.
