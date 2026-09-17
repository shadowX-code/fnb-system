import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260917050353_asset_tracking_phase_1_integrity_hardening.sql"), "utf8");

describe("Asset Tracking Phase 1 integrity migration", () => {
  it("removes ordinary destructive history access while preserving asset archive-by-update", () => {
    expect(migration).toContain("revoke insert, update, delete on table public.asset_movement_logs from authenticated");
    expect(migration).toContain("revoke insert, update, delete on table public.asset_inspections from authenticated");
    expect(migration).toContain("revoke insert, update, delete on table public.asset_inspection_evidence from authenticated");
    expect(migration).toContain("revoke insert, update, delete on table public.asset_maintenance_records from authenticated");
    expect(migration).toContain("revoke delete on table public.asset_items from authenticated");
    expect(migration).toContain('drop policy if exists "asset tracking scoped asset delete"');
  });

  it("enforces immutable completed inspection evidence and one asset per inspection", () => {
    expect(migration).toContain("asset_inspection_items_inspection_asset_key unique (inspection_id, asset_id)");
    expect(migration).toContain("Completed inspections cannot be resubmitted.");
    expect(migration).toContain("Finalized inspection items are immutable.");
    expect(migration).toContain("Finalized inspection evidence is immutable.");
    expect(migration).toContain("An asset can appear only once in an inspection.");
  });

  it("checks same-outlet relationships below the RPC boundary", () => {
    expect(migration).toContain("asset_movement_logs_assert_asset_outlet");
    expect(migration).toContain("asset_maintenance_records_assert_asset_outlet");
    expect(migration).toContain("asset_inspection_items_assert_context");
    expect(migration).toContain("asset_inspection_evidence_assert_context");
    expect(migration).toContain("Asset lifecycle record must use the asset outlet.");
    expect(migration).toContain("Inspection asset must belong to the inspection outlet.");
  });

  it("records lifecycle audit evidence in the same trusted transaction", () => {
    expect(migration).toContain("asset_lifecycle_requests_audit");
    expect(migration).toContain("after insert on public.asset_lifecycle_requests");
    expect(migration).toContain("'Trusted asset lifecycle: '");
    expect(migration).toContain("'request_id', new.request_id");
    expect(migration).toContain("'actor_id', new.actor_id");
  });
});
