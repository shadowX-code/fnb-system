# External Agent Gateway infrastructure release — 30 October 2026

## Scope and activation boundary

Promotes the validated shared Gateway management, Business Capability Selector, Effective Access review, resource-based Factory MCP reads, redaction, dependency authority, audit and legacy transport retirement. The environment binding was additionally validated on canonical Staging `1ef31ba2a789def46f1e7b3d5146b05da08ba53e`.

Infrastructure only. No Production agent registration, enablement, credential issuance/copy or machine grants are authorized by this release. Existing human roles and grants remain unchanged. Business records are not migration targets.

## Migration gate

Production project: `oyfobxdoyfuzsodogpgs`. Forward-only dry-run contained exactly the 31 migrations below; applied once; final dry-run clean. Sixteen Gateway filenames were aligned with immutable Staging-applied history. Fifteen files were byte-identical; the retained-scope migration was recovered exactly after proving its targeted rewrite produces the identical full function body. No remote migration history was repaired or rewritten.

- `20261029054824_factory_mesti_readonly_integration.sql`
- `20261029055348_factory_mesti_inspection_coverage_hardening.sql`
- `20261029060106_factory_mesti_inspection_recompletion_state.sql`
- `20261029061133_external_machine_security_audit.sql`
- `20261029071231_external_agent_connections_management.sql`
- `20261029085713_external_agent_capability_registry.sql`
- `20261029090707_external_agent_audit_authority_guard.sql`
- `20261029094628_external_agent_mesti_resources.sql`
- `20261029100801_external_agent_resource_gateway.sql`
- `20261029110228_factory_agent_unified_resources.sql`
- `20261029112242_factory_agent_management_discovery.sql`
- `20261029120439_external_agent_navigation_permissions.sql`
- `20261029133257_factory_agent_read_coverage_completion.sql`
- `20261029140834_factory_agent_mesti_evidence_alignment.sql`
- `20261029150841_factory_mesti_review_compatibility.sql`
- `20261029152223_factory_gateway_authorization.sql`
- `20261029152514_retire_mesti_review_tools.sql`
- `20261029153111_factory_gateway_discovery_distinct.sql`
- `20261029154716_factory_agent_coverage_semantics.sql`
- `20261029160458_factory_reporting_navigation_owner.sql`
- `20261029161957_external_agent_access_and_credential_policy.sql`
- `20261029163431_external_agent_dependency_projection.sql`
- `20261029163646_external_agent_dependency_scope_labels.sql`
- `20261029163938_external_agent_dependency_descriptor_bounds.sql`
- `20261029165822_external_agent_capability_change_review.sql`
- `20261029170955_external_agent_retained_scope_descriptions.sql`
- `20261029172629_factory_agent_standalone_context.sql`
- `20261029181315_external_agent_effective_access_review.sql`
- `20261029181526_external_agent_review_snapshot_consistency.sql`
- `20261029181639_external_agent_review_scope_overlap.sql`
- `20261029192331_external_agent_environment_binding.sql`

## Verification boundaries

- 65 focused Gateway/UI/protocol tests and 18 Role Settings regression tests pass; build passes.
- Isolated Factory suite: 448 pass, 8 existing date-sensitive MeSTI failures.
- Staging endpoint metadata, authenticated credential-free probe and unchanged identity/credential/grant hashes verified.
- Production migration postflight: 0 identities, 0 credentials, 0 machine grants. Existing 10 roles and 1,219 grants retain exact hashes.
- Inventory postflight: exact unchanged hashes for 648 FG movements, 890 RM movements, 123 FG batch balances and 213 RM batch balances.
- Production activation and successful credential-bound business reads are intentionally outside this release's QA authorization. Unauthorized endpoint/RPC denials and management reads verify deployment without issuing authority.
- Three inherited blank-at-EOF warnings in the imported historical migrations are retained to preserve applied SQL bytes; the clean working-tree diff check passes.
