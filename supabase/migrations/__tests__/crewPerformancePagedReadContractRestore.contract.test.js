import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260922050000_restore_crew_performance_paged_read_contract.sql"), "utf8");

describe("Crew Performance paged read contract restore", () => {
  it("keeps JSON filter extraction separate from text search composition", () => {
    expect(sql).toContain("v_query text := coalesce(p_filters->>'query', '');");
    expect(sql).toContain("ilike '%' || v_query || '%'");
    expect(sql).not.toContain("p_filters->>'query'||'%'");
  });

  it("retains both Performance listing modes and the canonical paged response", () => {
    expect(sql).toContain("p_listing not in ('review_queue', 'team')");
    expect(sql).toContain("'rows', v_rows, 'total_count', v_total, 'page', v_page, 'page_size', v_size, 'summary'");
  });

  it("preserves the trusted function boundary and authenticated-only grant", () => {
    expect(sql).toContain("volatile security definer set search_path=public");
    expect(sql).toContain("grant execute on function public.crew_performance_admin_page(uuid, date, text, jsonb, integer, integer) to authenticated");
  });
});
