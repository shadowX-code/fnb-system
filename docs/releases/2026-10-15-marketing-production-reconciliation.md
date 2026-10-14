# Marketing Hub Production migration reconciliation and release rehearsal

15 October 2026 · Asia/Kuala_Lumpur · L3 database rehearsal with existing Staging workflow evidence retained.

**NO-GO for Production rollout.** The Marketing database sequence passes against an isolated, catalog-equivalent Production baseline. Production still lacks the Marketing baseline and runtime. The separately approved security release, a scoped main-baseline application package, environment adaptation, Brand/access bootstrap and external configuration decisions remain gates. This report is release preparation, not authorization to deploy, merge main, change live data, configure providers or execute external actions.

## Reconciled migration counts and scope

Final live read-only snapshot: Production `fnb-system` / `oyfobxdoyfuzsodogpgs`, READY main `5224eeade2e7438c7810c2aa8524422443e9e1ab`; Staging `fnb-system-staging` / `ujkzdaaadnvcfayuldmh`, READY dev `63eb493b3e947d84e8ed51f0c6f81958302d5fdd`. Production’s 988 application/inventory function definitions were rechecked at report completion and have no drift from the captured baseline.

| Classification | Count | Decision |
|---|---:|---|
| Production migration records | 651 | Retain |
| Staging migration records | 828 | Current inspected state |
| Versions common to both | 641 | Already applied; do not replay |
| Production-only versions | 10 | Preserve Production compatibility variants; do not replace with Staging counterparts |
| Staging-only versions | 187 | Reconcile individually |
| Required Marketing feature/authority sequence | 126 | Include in ordered candidate |
| Required Platform/Brand/member-access dependencies | 7 | Include in ordered candidate |
| Separate security prerequisite | 2 | Separate security release/approval; not silently folded into Marketing |
| Unrelated pending migrations | 52 | Exclude |

All **111 original candidates** remain absent from Production history; none is already applied/equivalent to a Marketing installation, and all original file hashes still match the earlier manifest. Production has no Marketing tables or Brand Master. The current complete Marketing scope adds **22 later Marketing migrations**, producing **133 ordered candidates**: 126 Marketing plus seven Platform dependencies. One concurrent Google Business migration increased Staging from 827 to 828 during this audit; it is unrelated and excluded.

The seven Platform dependencies are Brand/Outlet management, new-work serialization, Brand-facing context, per-member Brand access, member-save guard, scoped consumers and team assignment projection. CRM Customer Master, import jobs/snapshots/consent, Creators, Planner, media, privacy, Insights, Inbox and Ads authorities are included through their owning Marketing migrations; Restaurant Sales, Finance ledgers, Crew and Factory releases are excluded.

[Complete classification with source files and hashes](2026-10-14-marketing-reconciled-migrations.csv) and [exact execution order, destination names and SHA-256](2026-10-14-marketing-execution-order.csv) are the machine-readable manifests. Appendix A lists every required version in order. They are preparation artifacts, not a blanket migration-push authorization.

Three Staging ledger timestamps differ from repository filenames: public inspection `20261014032018` vs file `20261014030902`; inspection budget `20261014033939` vs `20261014033913`; XHS preview host `20261014045332` vs `20261014045243`. Actual applied SQL differs only by a comment/extra empty semicolon statements. Use the canonical applied versions shown in the execution manifest when packaging those files. No live migration history was repaired or falsified.

## Isolated rehearsal and conflicts

A separate Colima VM and Supabase PostgreSQL container were created. Container network attachments were removed, and `cron.launch_active_jobs` was disabled before replay. No provider/Production endpoint was reachable. No live business records, credentials, OAuth bindings or Staging fixtures were copied into Production.

The schema baseline was reconstructed from all 651 actual Production migration SQL records, including the ten Production-only variants, then reconciled against the live catalog. Historical replay required omitting one Factory data-only repair for three existing Production batches, bypassing a historical PO fingerprint precondition during schema construction, and using replace-safe function headers where historical compatibility releases were applied out of timestamp order. Five Crew definitions were restored from the current live catalog. These adjustments affect baseline construction only; no Marketing candidate guard was removed.

Before Marketing rehearsal, the baseline exactly matched Production’s application catalog: **988 function definitions/security attributes/grants, 295 tables/views, 3,361 columns, 1,859 constraints, 843 indexes, 347 RLS policies, 175 triggers and 5,402 table-grant entries**. Function signatures, ownership-relevant grants, scope rules and structural objects were compared, not inferred from filenames.

All **133 candidates applied successfully** in dependency order. They changed **zero existing Production application function definitions or existing columns, constraints, indexes, RLS policies, triggers and table grants**. The installed public Marketing functions match current Staging. The sequence adds 167 public/inventory function signatures and its private Marketing authorities.

Eighty-one potentially superseded function-only migrations were individually omitted in cloned baseline trials. Eleven omissions broke guarded SQL dependencies; seventy produced a different final function/structure/permission/scheduler result. None could be removed while preserving the complete canonical surface. Thus 133 is the smallest **verified preserving set** from this dependency chain, not a claim that no newly consolidated schema migration could ever be authored. A future consolidation would need its own review and equivalence rehearsal.

A fresh candidate preserved every one of **2,294 existing seed/control row fingerprints** across 295 physical tables. It appended only **47 permission registrations**; no old row was lost/changed and no existing role grant was automatically expanded. This demonstrates migration non-destructiveness on representative/control state, not production-volume or private-business-data-distribution testing.

Migration retry preflight matched all 133 applied version/checksum pairs and replayed zero statements. A deliberately changed hash was rejected. Raw historical DDL is one-time SQL and is not represented as independently rerunnable; use the canonical migration ledger plus mandatory release-manifest checks.

Five focused authority suites passed: per-member Brand access/revocation/retry; Planner reviewer/blocker/lifecycle; Creator account/primary/avatar evidence; CRM import/POS/blank handling/consent/duplicates/idempotency; Social snapshots/gaps/zero/provenance/generation boundaries. The old CRM/Social fixtures assumed live Staging scope/connection data, so isolated fixture-only adaptations provided explicit member Brand access, `platform_customers.manage` and a clearly synthetic connection. No provider evidence was invented or sent.

The separate two-migration security-hotfix scenario also applied successfully, and all five suites passed again. It changes the intended permission/identity helpers and People report protection; those changes remain separately classified. Existing unrelated modules were not subjected to redundant full QA: their catalog contracts were proven unchanged by the Marketing sequence, with their retained Staging evidence reused.

**Rehearsal limits:** local PostgreSQL is 17.11; live Production and Staging are 17.6. Application catalog parity and scoped SQL behavior were verified, but exact managed binary/extension runtime equivalence and production-volume/selectivity/locking behavior are not claimed. Final release preflight must retain the target version/extension checks and approved backup/restore readiness.

## Production endpoint overlay

Seven new functions retain Staging-specific endpoint or independent-erasure-journal project bindings:

- `public.marketing_meta_begin`
- `public.marketing_ads_begin`
- `public.marketing_tick`
- `marketing_private.privacy_intent`
- `public.marketing_privacy_journal_ack`
- `public.marketing_privacy_prepare_release`
- `public.marketing_privacy_replay`

[Prepared environment overlay](rehearsal/production-environment-overlay.sql) changes only those bindings to the Production project and disables the three new Marketing schedules. It is guarded by an explicit release-target marker, validates the seven expected contracts and is retry-safe. In isolation, zero Staging project references remained in public/private Marketing functions; the three new jobs were inactive, and a second application passed.

A confirmed preparation defect was resolved: the migration role cannot directly UPDATE `cron.job`. The overlay now uses pg_cron’s authorized `cron.alter_job` API; no broad catalog grant was introduced. Existing Factory/Crew/People jobs are untouched. The overlay needs a separately assigned forward migration version when the Production candidate is approved; it is not applied to either live environment.

The Edge/API source still deliberately pins Staging origins, references and branch/project guards. SQL adaptation alone does not make those services Production-ready. Prepare an explicit Production runtime variant/environment adapter retaining fixed project/origin validation, one-time OAuth state, HMAC validation, token sealing and all execution gates. Do not merely remove Staging guards.

## Application and runtime deployment scope

[Application dependency scope](rehearsal/application-scope.csv) identifies 128 changed owned/dependency/integration paths relative to main. Include owned Marketing/Brand UI/services/styles/assets, existing CRM import templates/parser dependencies, and only Marketing/Brand hunks in the Admin routing/access boundary, shell/navigation/unread count, Outlet Brand presentation and shared controls/tokens. Shared files contain unrelated work and must not be copied wholesale. The Marketing snapshot at `63eb493b3` is current; concurrent Google Business/Crew changes are excluded.

The scoped main-baseline application package has **not** been assembled/built in this audit. Existing Staging builds and L2/L3 evidence are retained; they do not substitute for the final scoped main-candidate build/route check. This is an explicit release gate, not a claim that blanket dev-to-main is safe.

| Runtime | Deployment requirement | Initial execution state |
|---|---|---|
| `marketing-meta` | Production-bound OAuth/discovery/health/deauthorization/deletion; validate Auth/state/HMAC inside handler | No inherited Staging credentials or execution grants |
| `marketing-worker` | Production-bound bounded publishing/Insights/health/Ads/recovery/cleanup worker | External execution remains closed |
| `marketing-inbox` | Production signed callbacks, scoped reads/drafts/receipt queue and optional AI proposals | Sending and autonomous replies off |
| `marketing-privacy` | Production-only independent journal/restore operator authority | Restricted operator endpoint; custody/configuration required |
| `marketing-ads` | Production analytics/account discovery/sync and advisory controls | Ads execution off; AI requires separate model/budget approval |
| `marketing-drive` | Production OAuth and Brand-root scoped read-only browse/preview/cache lifecycle | No copied grants or inferred folder mapping |
| `/api/marketing-creator-inspect` | Explicit Production project/main/origin adaptation; bounded free extraction | No paid provider; public availability remains conditional |
| XHS session Reader pilot | Exclude from initial release | Disabled; host/session/activation requires separate approval |

All six Marketing Edge Functions are ACTIVE on Staging and absent on Production. Staging versions inspected: Meta 55, Worker 56, Inbox 38, Privacy 15, Ads 19 and Drive 9. Preserve their function-body authentication; `verify_jwt=false` permits verified public callbacks but never replaces Auth/scope/HMAC checks.

Schedules: `feedx_marketing_meta_worker` each minute; `feedx_marketing_meta_housekeeping` every ten minutes; `feedx_customer_import_worker` every ten seconds. CRM imports use the database worker, not the Edge worker. Ads reporting is six-hour eligibility through the bounded shared worker, not a separate Cron or guaranteed refresh SLA. Install the jobs inactive; enable the internal CRM worker only after authority/bootstrap/queue checks, and enable Meta jobs only after Production-bound services and scheduler custody are ready. Never add a duplicate Vercel Cron.

## Configuration and external approvals

Verified canonical Admin origin is `https://os.feedx.my`; Production Supabase is `https://oyfobxdoyfuzsodogpgs.supabase.co`. Approved callback candidates are `/functions/v1/marketing-meta/callback`, `/marketing-inbox/webhook`, Meta signed deauthorization/deletion handlers and `/marketing-drive/callback` under that Production Supabase origin. No callback/app/domain setting was changed.

- Frontend: retain Production `VITE_SUPABASE_URL`/publishable key and fixed host routing. Never expose server secrets in Vite variables.
- Runtime base: Production `SUPABASE_URL`, server-only service role, anon/publishable key and explicit origin/project validation.
- Meta: `MARKETING_META_APP_ID`, `MARKETING_META_APP_SECRET`, `MARKETING_META_LOGIN_CONFIG_ID`, `MARKETING_META_GRAPH_VERSION`, `MARKETING_META_TOKEN_ENCRYPTION_KEY`, optional previous key, and `MARKETING_INBOX_WEBHOOK_VERIFY_TOKEN`. Fresh Production credentials/grants are required; do not copy sealed Staging tokens or test account lists.
- Scheduler: independent `MARKETING_WORKER_SECRET` plus matching Production Vault scheduler material. Verify possession/configuration without logging values.
- Privacy: Production `MARKETING_ERASURE_JOURNAL_READ_WRITE_TOKEN`, independent journal namespace/store outside the DB restore boundary, recoverable key custody and restricted restore-operator authority. Staging journal evidence is not Production readiness.
- Google Drive: Production `MARKETING_GOOGLE_DRIVE_CLIENT_ID`, client secret, token encryption key/optional previous key, approved Drive owner and explicitly selected canonical Brand folders. Keep `drive.readonly`; restricted-scope verification/testing-token exceptions remain external decisions.
- Keep `MARKETING_INBOX_SEND_ENABLED`, `MARKETING_ADS_EXECUTION_ENABLED`, `MARKETING_ADS_AI_ENABLED`, `MARKETING_AI_ENABLED` and `MARKETING_XHS_READER_ENABLED` disabled/unconfigured initially. Do not import test peer/account allowlists, execution approvals or paid-provider configuration.
- Optional future AI: `OPENAI_API_KEY`, approved `MARKETING_AI_MODEL`, costs/budget/processor decision and separate activation. Current Staging approval is not Production approval.

Meta strategy must be decided before connection rollout. Retain Staging app `2204918033458414` and its existing callbacks. Prefer a separately governed Production app/configuration; a shared-app plan must explicitly prove compatible callback routing/subscriptions and preserve existing Staging delivery. Current health checks pin the expected callback, so repointing the Staging app to Production is not a safe implicit migration. No new app, router, subscription or permission was created.

Required access remains operation-specific: Page discovery/engagement/Insights; Page publishing; Messenger `pages_messaging` plus `pages_manage_metadata` and Page MESSAGE task; Instagram basic/Insights/publish/messaging permissions with eligible linked Page/task/granular access; Ads `ads_read` distinct from `ads_management`. Production Advanced Access/App Review/eligible business assets must be verified independently. Published app status and existing test-role grants are not proof of external-customer SaaS readiness. Ads account status and Malaysia advertiser/payer declarations remain separate execution gates. No permission expansion or external account/provider test was performed.

Bootstrap approval must name the Production organization/Brands, canonical Outlet mappings, initial administrators and exact role actions/member Brand scope. Registering the 47 permission codes does not grant them. Never copy QA Brands, Stage IDs, Creator/customer records, mappings, consent, suppression, metric evidence or provider execution approvals into Production.

## Deployment and recovery sequence

1. Freeze/recheck exact Production baseline, current Staging source and all manifest hashes; confirm backup/recovery custody, no unexpected Marketing objects and compatible extension/version state.
2. Obtain the **separate security release** approval for `20261014073014_platform_role_authority_hardening.sql`, `20261014075736_people_migration_report_access.sql` and only the two client compatibility changes in the existing four-file hotfix patch. Preserve its reviewed boundary; do not substitute a dev merge. Apply/release that protection before exposing Marketing.
3. Assemble the scoped main-baseline Marketing application package and explicit Production runtime adaptation. Run its focused build/route/contract check once. Resolve any hunk/dependency conflicts before seeking Production deployment approval.
4. After explicit Production approval, apply Appendix A’s 133 migrations through canonical version-ledger/hash preflight, followed by the approved, versioned environment overlay. Keep all three new jobs inactive. SQL files are transaction-bound; stop on any mismatch/failure and re-read the ledger before retry.
5. Configure private buckets/policies and server-only secrets/custody; deploy compatible Production-bound Edge/API workers while execution flags remain off. Review Production Brand/Outlet/admin/member bootstrap through canonical authorities.
6. Deploy the scoped frontend through main’s existing Git Integration only after its compatible authority/runtime dependencies are installed. Verify project/ref/SHA and a narrow authenticated internal read/write smoke on approved disposable data.
7. Enable approved internal import processing and verify bounded progress/retry. Connect external providers only after their separate app/OAuth/privacy configuration approvals. Verify each actual grant and delivery/readiness state; do not equate configuration with delivery.
8. Publishing, Inbox sends, autonomous AI/FAQ, Ads execution and actual historical customer-message import each remain separately approved activations. Internal Marketing approval does not activate them.

Rollback: capture code/Edge versions, migration/checksum ledger, inactive job state and independent erasure/revocation evidence before release. Pause only new Marketing jobs/writes, retain existing Restaurant/Crew/Factory/People schedules and security protection, and use compatible code rollback or narrow forward fixes. Do not DROP Marketing data, unwind immutable evidence or restore the DB merely to undo UI. A genuine DB restore requires quarantine, independent erasure/revocation replay, key/grant reconciliation and operator validation before reopening. Unknown external outcomes stay Reconciling and are never blindly replayed. Partial migration application is resumed from verified committed versions, not broad resets.

## Final decision and exact gates

**Database reconciliation/rehearsal: PASS, within the stated schema/control-data/engine limits.** No unresolved ordered Marketing SQL conflict remains. The environment overlay’s Cron privilege conflict was fixed and reverified.

**Production rollout: NO-GO today.** Required decisions/work are:

1. Explicit separate security-hotfix release approval and delivery.
2. Scoped main application/package isolation/build and Production-bound Edge/API environment adaptation.
3. Production release authorization for the exact 133-migration manifest plus forward overlay, six Edge Functions/workers and scoped application deployment.
4. Approved Production Brand/Outlet/admin/member scope bootstrap and server-secret/journal/recovery custody.
5. Meta Production app/callback/access-review strategy and fresh authorized connections; Google OAuth/restricted-scope/folder decisions for Drive.
6. Separate privacy authority for real historical Inbox imports and separate publishing/messaging/Ads/AI activations.

Internal Brand/CRM/Planner/Creator/manual evidence and approval workflows can be staged for an execution-closed release after gates 1–4. Social/Ads external analytics, Drive live access and provider Inbox require their configured grants. Publishing/messaging/Ads execution remain closed beyond that. Existing Staging evidence is retained; the pending real Instagram avatar save/render acceptance is not represented as completed by this migration rehearsal.

No Production mutation, main merge, deployment, secret change, provider configuration change, paid call, outbound message or external execution occurred.

## Appendix A Exact required order

The source path, destination filename and SHA-256 for each item are in the execution CSV. The final environment overlay follows item 133 as an approved new forward migration; the separate security pair precedes Marketing exposure under its own release approval.

1. `20261009155730_marketing_workspace_foundation.sql`
2. `20261009163853_marketing_foundation_paged_read_models.sql`
3. `20261009164709_marketing_job_claim_disambiguation.sql`
4. `20261009165552_marketing_read_scope_completeness.sql`
5. `20261009171326_marketing_meta_oauth.sql`
6. `20261009172624_marketing_meta_execution.sql`
7. `20261009173600_marketing_meta_scheduler.sql`
8. `20261009174700_marketing_meta_replay_safety.sql`
9. `20261009175100_marketing_meta_disconnect_metadata.sql`
10. `20261009180300_marketing_meta_checkpoint_resume.sql`
11. `20261009211453_marketing_meta_connection_diagnostics.sql`
12. `20261009212150_marketing_meta_verified_read_retry.sql`
13. `20261009230605_marketing_inbox_foundation.sql`
14. `20261009230948_marketing_inbox_evidence_guards.sql`
15. `20261009233309_marketing_content_management.sql`
16. `20261010030243_marketing_content_management_scope_projection.sql`
17. `20261010030910_marketing_content_management_historical_identity.sql`
18. `20261010060710_marketing_oauth_task_evidence.sql`
19. `20261010065634_marketing_inbox_phase2_workflows.sql`
20. `20261010080436_marketing_inbox_live_acceptance.sql`
21. `20261010084521_marketing_inbox_pending_send_guard.sql`
22. `20261010101508_marketing_inbox_privacy_erasure.sql`
23. `20261010103123_marketing_privacy_case_indexes.sql`
24. `20261010103755_marketing_privacy_optout_preservation.sql`
25. `20261010131224_marketing_privacy_restore_journal.sql`
26. `20261010133132_marketing_privacy_recovery_receipts.sql`
27. `20261011023220_marketing_inbox_exact_read_receipts.sql`
28. `20261011031413_marketing_inbox_conversation_projection.sql`
29. `20261011032146_marketing_inbox_profile_task_evidence.sql`
30. `20261011034529_marketing_social_onboarding.sql`
31. `20261011050433_marketing_hybrid_whatsapp.sql`
32. `20261011052048_marketing_post_media_insights.sql`
33. `20261011054718_marketing_customer_import.sql`
34. `20261011070225_marketing_ads_read_authority.sql`
35. `20261011070700_marketing_ads_sync_guards.sql`
36. `20261011071914_marketing_ads_discovery_preview.sql`
37. `20261011072557_marketing_shared_ad_accounts.sql`
38. `20261011072926_marketing_ads_shared_lifecycle_guards.sql`
39. `20261011073433_marketing_ads_attributed_totals.sql`
40. `20261011075608_marketing_ads_attribution_review.sql`
41. `20261011103410_marketing_ads_analytics_copilot.sql`
42. `20261011103530_marketing_ads_ai_usage.sql`
43. `20261011104045_marketing_ads_ai_retry_guard.sql`
44. `20261011105242_marketing_ads_brand_reporting_coverage.sql`
45. `20261011120538_marketing_ads_controlled_models.sql`
46. `20261011120548_marketing_ads_controlled_prepare.sql`
47. `20261011120559_marketing_ads_controlled_approval.sql`
48. `20261011120602_marketing_ads_controlled_claim.sql`
49. `20261011120605_marketing_ads_controlled_checkpoint.sql`
50. `20261011120609_marketing_ads_controlled_receipt.sql`
51. `20261011120640_marketing_ads_controlled_safeguards.sql`
52. `20261011120645_marketing_ads_controlled_reconciliation.sql`
53. `20261011121102_marketing_ads_hierarchy_activation.sql`
54. `20261011121353_marketing_ads_management_account_choices.sql`
55. `20261011133608_marketing_ads_validation_diagnostics.sql`
56. `20261011141604_marketing_ads_malaysia_declarations.sql`
57. `20261011141712_marketing_ads_declaration_validation_fix.sql`
58. `20261011190320_marketing_crm_customer_detail.sql`
59. `20261011192849_marketing_conversations_staff_reply.sql`
60. `20261011193012_marketing_staff_reply_alias_guard.sql`
61. `20261012041516_marketing_crm_tag_workflow.sql`
62. `20261012045140_marketing_crm_tags_consent_summary.sql`
63. `20261012072003_marketing_whatsapp_sender_sessions.sql`
64. `20261012074313_marketing_drive_media_lifecycle.sql`
65. `20261012080620_marketing_content_view_compatibility.sql`
66. `20261012082706_marketing_drive_snapshot_finalize.sql`
67. `20261012084020_marketing_campaign_audience_visibility.sql`
68. `20261012095506_marketing_content_planner.sql`
69. `20261012100640_marketing_planner_readiness.sql`
70. `20261012101147_marketing_planner_snapshot_retention.sql`
71. `20261012121019_marketing_planner_v3_checklist.sql`
72. `20261012184102_marketing_creators_v1.sql`
73. `20261012185112_marketing_creator_url_validation.sql`
74. `20261012185903_marketing_creator_manual_evidence_boundary.sql`
75. `20261012190959_marketing_creator_link_confirmation.sql`
76. `20261012193151_marketing_creator_canonical_post_routes.sql`
77. `20261012193420_marketing_meta_connection_reliability.sql`
78. `20261012195101_marketing_creator_media_reference_guards.sql`
79. `20261013010014_marketing_creator_unchanged_media_preservation.sql`
80. `20261013011740_marketing_organic_metric_provenance.sql`
81. `20261013013432_marketing_creator_profile_workflow.sql`
82. `20261013013558_marketing_creator_verified_post_preview.sql`
83. `20261013023659_marketing_observed_history.sql`
84. `20261013023704_marketing_inbox_historical_import.sql`
85. `20261013023755_marketing_growth_provenance_pairing.sql`
86. `20261013024656_marketing_history_finish_counter.sql`
87. `20261013025440_marketing_history_text_lineage.sql`
88. `20261013030613_marketing_history_claim_alias.sql`
89. `20261013054502_platform_brand_outlet_management.sql` — Platform dependency
90. `20261013054506_marketing_ads_automatic_reporting.sql`
91. `20261013060603_platform_brand_new_work_serialization.sql` — Platform dependency
92. `20261013065103_brand_facing_context.sql` — Platform dependency
93. `20261013065921_marketing_ads_disconnected_slot_projection.sql`
94. `20261013083306_marketing_customer_import_v2.sql`
95. `20261013084050_marketing_customer_import_resume.sql`
96. `20261013084217_marketing_customer_import_local_dates.sql`
97. `20261013091100_marketing_customer_import_report_rows.sql`
98. `20261013091520_marketing_customer_import_metadata_validation.sql`
99. `20261013095615_platform_member_brand_access.sql` — Platform dependency
100. `20261013100142_platform_member_brand_save_guard.sql` — Platform dependency
101. `20261013100450_platform_brand_scope_consumers.sql` — Platform dependency
102. `20261013101416_marketing_customer_import_actor_binding.sql`
103. `20261013101841_marketing_customer_import_actor_lock.sql`
104. `20261013102048_platform_team_assignment_projection.sql` — Platform dependency
105. `20261013112106_marketing_customer_optional_name.sql`
106. `20261013113512_marketing_social_performance_projection.sql`
107. `20261013113810_marketing_social_performance_grain_guard.sql`
108. `20261013114413_marketing_inbox_reply_failure_recovery.sql`
109. `20261014015543_marketing_provider_outbound_history.sql`
110. `20261014015935_marketing_health_refresh_recovery.sql`
111. `20261014021052_marketing_planner_revision_blocking.sql`
112. `20261014032018_marketing_creator_public_inspection.sql`
113. `20261014033939_marketing_creator_inspection_budget_scope.sql`
114. `20261014045332_marketing_creator_xhs_preview_host.sql`
115. `20261014052101_marketing_creator_management_workflow.sql`
116. `20261014052613_marketing_creator_management_guards.sql`
117. `20261014053333_marketing_creator_option_scope_guards.sql`
118. `20261014055043_marketing_creator_legacy_option_matching.sql`
119. `20261014073027_marketing_facebook_post_url_identity.sql`
120. `20261014073510_marketing_facebook_route_compatibility.sql`
121. `20261014080707_marketing_receipt_draft_stability.sql`
122. `20261014080714_marketing_drive_refresh_compare_and_swap.sql`
123. `20261014080718_marketing_creator_directory_projection.sql`
124. `20261014083533_marketing_bounded_reads.sql`
125. `20261014083538_marketing_cleanup_rotation.sql`
126. `20261014084306_marketing_social_publication_fold.sql`
127. `20261014085349_marketing_metric_index_consolidation.sql`
128. `20261014092613_marketing_creator_publishing_removal.sql`
129. `20261014103211_marketing_creator_collaboration_history.sql`
130. `20261014105925_marketing_creator_derived_lifecycle.sql`
131. `20261014112641_marketing_creator_original_post_url.sql`
132. `20261014112945_marketing_creator_xhs_original_url_scope.sql`
133. `20261014130130_marketing_creator_instagram_avatar.sql`

## Appendix B Production-only variants preserved

- `20260927152000_restaurant_po_source_reservations_transactional`
- `20260929140954_crew_performance_team_review_forward`
- `20260929152648_crew_inventory_gateway_production_compat`
- `20261003085315_payroll_lindung_targeted_setup_validation`
- `20261003093107_payroll_lindung_explicit_not_applicable`
- `20261003093509_payroll_lindung_not_applicable_audit_context`
- `20261003094502_payroll_lindung_not_applicable_canonical_worker_guard`
- `20261003101135_payroll_lindung_verified_carry_forward`
- `20261003101517_payroll_lindung_carry_forward_query_aliases`
- `20261004164103_payroll_time_source_reconciliation`

## Evidence and reproduction

[Structured rehearsal result](rehearsal/rehearsal-results.json), [application scope](rehearsal/application-scope.csv), migration histories/classification and the guarded environment overlay are retained alongside this report. Isolated actual SQL capture, baseline checkpoints, per-trial results, hashes and test logs remain under `/private/tmp/feedx-marketing-prod-rehearsal`; they contain schema/source/control evidence, not a copied live business dataset. The local VM is stopped after final evidence checks; its data/checkpoints remain recoverable for the release-preparation follow-up.

Documentation Impact: Updated this release report and its supporting reconciliation/execution manifests. Existing domain business rules are unchanged.
