# Native Assistant architecture reconciliation · 16 November 2026

Baseline: `02ed7db15bcb81a8c01c061e49450aa62141219d`. L3 trusted dispatcher reconciliation; no database migration, new business capability, provider call or authority grant.

## Before → after

- Before: `provider.js` imported Factory schema/validation/formatter from Assistant-local `inventory.js`; `handler.js` independently selected that schema for Voice and directly called `readTool`; management reconstructed one capability from booleans.
- After: Factory owns `_shared/factory/finishedGoodsRead.js`. `native-assistant/business.js` composes that implemented contract, advertises its schema/status and executes its bounded READ. No new HTTP gateway or database registry.
- Text: `useAssistantBridge` → `nativeAssistantService` → authenticated Edge `begin/respond` → owned DB claim/context → `generateText` → shared business dispatcher → Factory contract → human client snapshot/RLS → evidence/finish.
- Voice: official `RealtimeSession` tool lifecycle → `sdkVoiceHistory` (same response/turn identity) → `realtime_tool` with operation name → same dispatcher → Factory contract → existing evidence history. SDK alone continues speech. Cached/Grok callers omitting the name retain the exact Finished Goods alias.
- Settings: existing configuration authority → derived operation manifest → `NativeAssistantAccess`, joined to `config/modules.ts`. Explicit Factory test uses the same dispatcher with its existing settings and human permission gates. Registry-only knowledge remains metadata.

## Keep / Refactor / Consolidate / Remove / Build

| Decision | File-level evidence / owner | Compatibility |
|---|---|---|
| Keep | `src/features/ai-assistant/sdkVoiceBaseline.js`, `sdkVoiceHistory.js`, `voiceAudioMeter.js`, `useAssistantBridge.js` | Official SDK, leases, response/outcome ownership, interruption, single Core and audio graph. Only tool-name forwarding changes. |
| Keep | `native-assistant/conversationContext.js`, `context.js`; migrations `20261104185103`, `20261106121300` | Owner/scope-bound history, explicit recall, enumerated private memory and summary invalidation; no history migration or rewriting. |
| Keep | `native-assistant/voiceConnection.js`, `providerRegistry.js`; migrations `20261106140359`, `20261106162330`, `20261106182006` | Server tickets/SDP, actual provider-call binding, cleanup, policy and billing observations. Legacy reservation rows remain accounting/history dependencies. |
| Keep | `realtimeVoice.js`, `realtimeTransports.js`, `realtimeLifecycle.js`, `voiceCapture.worklet.js` | Referenced by independent Grok path; not unused OpenAI code. Grok remains configured but lease admission is currently OpenAI-only. No scope expansion. |
| Keep | `config/modules.ts`, `config/*AgentActions.json`, `external-agent-management`, external capability/action SQL | Module catalog and machine grant/confirmation authorities are not interchangeable with human Assistant authorization. |
| Refactor | Assistant `inventory.js` → `_shared/factory/finishedGoodsRead.js` | Same tool ID/schema, caller RPCs, fields, bounds, error codes, source URL, stock classification and low-stock formatter. |
| Consolidate | `native-assistant/business.js`, `handler.js`, `provider.js`, `index.ts` | One operation dispatch and public capability projection. Shared error class removes the previous provider↔inventory import cycle. |
| Consolidate | `NativeAssistantAccess.jsx`, `assistantKnowledgeSources.js` | Server manifest replaces locally reconstructed callable registry; canonical module IDs for tools/knowledge. No document retrieval. |
| Remove | `createSdkVoiceSecret`, `sdkBaselineInstructions` in `realtime.js`; unused imports | Only remaining caller was a test. Existing error tests now exercise active `createRealtimeCall`. Active provider test and SDK SDP call are retained. |
| Build | Dispatcher negative/contract tests and canonical-module ownership tests | Unknown ACTIONs, forged confirmation/actor, disabled reads, old Voice alias, named Voice dispatch, exact evidence and permission denial. |
| Deferred | Actual ACTION executor and source-specific reports/document retrieval | No verified Native Assistant AI-execution authorization/intent binding exists. No safe draft action was connected. |

No package dependency was proven unused: the official SDK, Grok media code and original isolated renderer still have consumers. No packages were removed. Applied SQL migrations and ledger rows are intentionally retained; UI reachability is not evidence that an SQL wrapper/record can be deleted.

## Contract and migration boundaries

READ v1 advertises `id`, `module_id`, `kind`, `version`, permission, scope and availability; module owns schema validation and authorized execution/evidence. The sole registered operation is Factory Finished Goods. Other module metadata is discoverable but never becomes callable by adding a navigation entry.

ACTION is fail-closed, with no executor. The minimum future authorization/confirmation requirements are documented in `docs/architecture/trusted-authorities.md` → Native Assistant module operations. Existing machine action services cannot supply the missing human Assistant execution authorization. This change creates no speculative permission or action-request store.

Deployment order: backward-compatible Edge first, then canonical dev UI. New UI requires the capability projection and fails closed if absent. Old clients retain `runtime.tools` and the fixed Voice alias. Rollback: prior Git commit plus prior Edge bundle; no data rollback required.

## Evidence / acceptance

The deployed Edge v55 source matched every baseline repository file before changes. Read-only Staging catalog inspection confirmed all Native Assistant service/provider/history/lease/usage RPCs deny anon/authenticated execution and permit service role, with controlled search paths. Factory snapshot is SECURITY INVOKER (its broader existing execute grant does not bypass table RLS or Assistant's explicit permission checks). No role, grants, schema, provider settings or conversation records changed.

Deterministic provider fixtures verify Text tool/result continuation, summed usage, low-stock semantics, SDK same-turn handoff, late cleanup protection, stale callbacks, permission errors and old/new Voice operation naming. Provider fixtures are not paid provider or live microphone evidence. Browser fixture QA renders actual management components with labeled fixture data. Authenticated end-to-end Staging read acceptance remains dependent on an available signed-in browser; do not mislabel fixtures or service catalog checks as that test.
