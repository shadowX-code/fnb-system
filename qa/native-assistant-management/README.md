# Native Assistant management QA

Presentation-only management refinement; existing configuration, tool test and voice-policy actions remain authoritative. No provider tests or Voice activation are needed for UI QA.

Run:

```sh
npm test -- --maxWorkers=1 src/features/integrations/NativeAssistantSettings.test.jsx src/features/integrations/ExternalAgentsPage.test.jsx src/features/integrations/assistantProviderPresentation.test.js src/features/ai-assistant/VoiceUsage.test.jsx src/features/ai-assistant/useAssistantBridge.test.js
node node_modules/vite/bin/vite.js --config qa/native-assistant-management/vite.config.mjs
node qa/native-assistant-management/browser.mjs
```

The serve-only local harness renders actual components and canonical styles with explicitly labeled fixture data. Its service permits only configuration and usage reads; mutations, paid tests and business reads reject. Browser checks cover all four sections at 1440, 1040 and 400 CSS pixels, page overflow, branded filter menus and Escape dismissal. Screenshots and checks go to `/tmp/feedx-assistant-management-evidence`.

Canonical Staging acceptance: open AI Integrations → Native Assistant as an authorized Admin; inspect provider/test timestamps, capability state and usage records without activating Voice or running a paid provider test. Confirm read-only settings access under a suitable existing account. Source readiness is metadata only, not permission to access documents. Tests distinguish disabled Factory access from a server-denied caller and preserve the existing explicit read-test action.

No new retrieval, provider, grant, database or voice-session contracts.
