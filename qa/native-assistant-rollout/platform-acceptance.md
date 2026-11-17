# Platform capability rollout acceptance — 17 November 2026

QA level: L3. Staging only (`ujkzdaaadnvcfayuldmh`).

## Implemented coverage

82 READ contracts and 2 draft-only ACTION contracts across 81 of 128 canonical modules. The 47 modules without contracts remain unconnected. See `docs/audits/native-assistant-capability-rollout.md` for the complete per-module reconciliation, including unfinished adapter work (not all gaps are intrinsically unsupported).

52 fixed RPC READ adapters, 29 fixed human-RLS projections, and the retained Finished Goods reader. No generic SQL/table selector or External Agent grants. Current business source permissions remain authoritative. ACTION connections and AI execution policies remain disabled unless explicitly configured.

## Checks

- 68 Node contract/regression tests passed; 14 targeted React management/history tests passed; production build passed (existing chunk-size warnings).
- Authenticated-role database probes: initial 46 RPC cases passed, all 29 fixed-table queries passed, final six RPC cases passed after correcting Marketing settings page size. These prove caller execution/schema compatibility; empty Staging sources do not prove populated-result completeness.
- Real authenticated browser: Calibration Schedule & Record Test read returned `Read verified`. Found and fixed parameterless test argument handling (`{}` instead of undefined).
- Existing saved cross-module Factory cleaning/Finance reporting conversation and two evidence disclosures restored in the real Assistant iframe. No new provider call was made during this acceptance.
- Permission checks: disconnected ACTION denied after restoration; unlinked user capability discovery denied; other-user action listing denied. Deterministic tests cover every READ connection/permission denial, outlet scope rejection before query, redaction, and strict argument schemas. This is not a claim of exhaustive live multi-company/outlet fixtures.

## Approved one-draft ACTION test and cleanup

- Both original `prepare_marketing_draft` settings were absent, not explicit false.
- Connection and separate AI execution policy enabled through authenticated Admin UI.
- Preview invoked through the canonical RPC under the existing human identity; no LLM needed.
- Browser Pending actions → Review confirmation → Confirm create draft succeeded.
- Intent `9d18ae51-3a8a-4b02-8960-5afba188c2bb`; content `f768954d-f37f-45fc-a93f-69cb90ebab2e`.
- Reconfirming the same fingerprint returned `state: executed, replayed: true`; exactly one content record existed.
- Cleanup used `marketing_content_command(cancel)` with confirmation and current updated-at guard. Final status `cancelled` is the domain's recoverable deletion; no active test draft remains. Audit/intent/revision history retained.
- Both settings disabled through Admin UI, then only those two false keys removed to restore their exact original absence. Verified revision 16, both key-present checks false. No caption policy enabled.
- Pending-actions listing exposed a SQL local-variable qualification defect. Append-only forward migration qualifies all selected record columns and binds ownership to `auth.uid()`; browser list and execution passed afterward.
- A service-role-impersonating configuration probe was rejected by automatic review and was not executed. Subsequent configuration used the existing authenticated Admin UI.

## Remaining acceptance boundaries

Live Voice explicitly deferred by user. SDK media lifecycle unchanged; Text/Voice share dispatcher contracts, but the new inventory has not passed live audio acceptance. No paid audio calls, provider billing changes or Production release. The new inactive-caption adapter is deterministic/contract verified only; no real caption mutation was authorized or performed. Cancellation/expiry and scope denial coverage is chiefly deterministic; the one live draft test covers preview, confirmation, execution, replay, disablement and cleanup.
