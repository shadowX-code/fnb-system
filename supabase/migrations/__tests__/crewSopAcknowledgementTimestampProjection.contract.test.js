import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260827160753_crew_sop_acknowledgement_timestamp_projection.sql"), "utf8");

describe("Crew SOP acknowledgement timestamp projection contract", () => {
  it("projects the immutable acknowledgement timestamp through the existing Crew read authority", () => {
    expect(migration).toContain("create or replace function public.crew_sop_version(p_token text, p_sop_version_id uuid)");
    expect(migration).toContain("'acknowledged_at', (select a.acknowledged_at");
    expect(migration).toContain("public.crew_session_employee(p_token)");
    expect(migration).toContain("s.outlet_id = v_outlet_id");
    expect(migration).toContain("a.employee_id = v_employee_id");
    expect(migration).toContain("set search_path = public, storage, pg_temp");
    expect(migration).toContain("revoke all on function public.crew_sop_version(text, uuid) from public, anon, authenticated;");
    expect(migration).toContain("grant execute on function public.crew_sop_version(text, uuid) to anon, authenticated;");
  });

  it("returns the same database timestamp after a new or idempotent acknowledgement without changing writes", () => {
    expect(migration).toContain("create or replace function public.crew_acknowledge_sop(");
    expect(migration).toContain("set search_path = public\nas $$");
    expect(migration).toContain("on conflict (employee_id, sop_version_id) do nothing;");
    expect(migration).toContain("select acknowledged_at into v_acknowledged_at");
    expect(migration).toContain("'acknowledged_at', v_acknowledged_at");
    expect(migration).toContain("public.crew_session_employee(p_token)");
    expect(migration).toContain("s.outlet_id = v_outlet_id");
    expect(migration).toContain("revoke all on function public.crew_acknowledge_sop(text, uuid, text) from public, anon, authenticated;");
    expect(migration).toContain("grant execute on function public.crew_acknowledge_sop(text, uuid, text) to anon, authenticated;");
  });
});
