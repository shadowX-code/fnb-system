# Factory Gateway Staging QA

Staging MCP endpoint: `https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/factory-mesti-mcp`.
Use Streamable HTTP and the existing opaque credential in the Authorization Bearer header. The URL remains stable; only `query_factory_resources` is exposed. No OAuth or employee identity is inferred.

The five legacy review tools and `query_mesti_resources` alias are retired after the existing Grok QA Executive successfully reconciled 61 review records, pagination, date/status filters, 61 evidence reads and all eight modules' coverage without legacy tools. Their SQL transport adapters and unused permissions are removed. Canonical `mesti_rows`, `mesti_review_metadata`, resource grants and historical audit/access events remain.

Run `node qa/staging/mestiReviewCompatibility.mcp.mjs <owner-only credential file>` for replacement-only authenticated QA: discovery, retired-tool denial, bounded pagination, canonical filters, evidence reads, coverage, module isolation and ungranted Production denial. Only normal security telemetry is appended; business records, keys and grants are unchanged.

`factoryGateway.rollback.sql` and `factoryGatewayCoverage.rollback.sql` exercise module mappings, source dependencies and isolation using rolled-back security fixtures. `mestiInspection.authorization.rollback.sql` exercises the reusable connection authority with disposable credentials, never the working QA Executive key. Empty data does not prove completeness; undated completed Productions remain coverage exclusions.
