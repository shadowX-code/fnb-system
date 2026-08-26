import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260826070000_crew_cash_opening_variance_state.sql"), "utf8").toLowerCase();

describe("Crew Cash Checkout opening variance state", () => {
  it("keeps opening comparison and reason enforcement server-authoritative", () => {
    expect(sql).toContain("expected_open:=float_amount+previous_carry");
    expect(sql).toContain("actual_open:=case when p_payload ? 'actual_opening_cash' then round");
    expect(sql).toContain("actual_open is distinct from expected_open and opening_reason is null");
    expect(sql).toContain("explain the opening cash variance");
  });

  it("clears stale opening reasons only when the canonical opening variance is zero", () => {
    expect(sql).toContain("opening_variance_reason=case when actual_open is not distinct from expected_open then null else opening_reason end");
    expect(sql).toContain("opening_variance=case when actual_open is null then null else actual_open-expected_open end");
  });

  it("preserves the protected checkout lifecycle and client-role grants", () => {
    expect(sql).toContain("completed cash checkout is immutable");
    expect(sql).toContain("cash checkout payload contains server-controlled fields");
    expect(sql).toContain("revoke all on function public.crew_cash_save_checkout(text,text,jsonb) from public,anon,authenticated");
    expect(sql).toContain("grant execute on function public.crew_cash_save_checkout(text,text,jsonb) to anon,authenticated");
  });
});
