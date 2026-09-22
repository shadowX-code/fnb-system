import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260922040000_restore_crew_paged_read_contracts.sql"), "utf8");

describe("Crew paged read contract restore", () => {
  it("keeps SOP filter values in text locals before applying ILIKE", () => {
    expect(sql).toContain("v_query text := coalesce(p_filters->>'query', '');");
    expect(sql).toContain("concat_ws(' ', row->>'title', row->>'summary') ilike '%' || v_query || '%'");
    expect(sql).not.toContain("p_filters->>'query'||'%'");
  });

  it("projects Reward summaries by the declared listing argument", () => {
    expect(sql).toContain("'summary',v_source-p_listing");
    expect(sql).not.toContain("v_source-v_listing");
  });

  it("keeps both canonical paged reads authenticated-only", () => {
    expect(sql).toContain("grant execute on function public.crew_sop_admin_page(uuid, jsonb, integer, integer) to authenticated");
    expect(sql).toContain("grant execute on function public.crew_reward_admin_page(uuid, date, uuid, text, integer, integer) to authenticated");
  });
});
