import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924200447_crew_stock_check_lifecycle.sql"), "utf8").toLowerCase();
const historySql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924202520_crew_stock_check_history_dedupe.sql"), "utf8").toLowerCase();
const purchaseSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260924001607_restaurant_inventory_authority_foundation.sql"), "utf8").toLowerCase();

describe("Crew Stock Check lifecycle authority", () => {
  it("derives Due, In Progress, Completed, Skipped and Missed on the server business date", () => {
    expect(sql).toContain("timezone('asia/kuala_lumpur',now())::date");
    expect(sql).toContain("when check_row.status='draft' then 'in_progress'");
    expect(sql).toContain("when c.check_date<v_today then 'missed' else 'in_progress'");
    expect(sql).toContain("when c.status='submitted' then 'completed'");
    expect(sql).toContain("when check_row.status='skipped' then 'skipped'");
    expect(sql).toContain("inventory_authority.stock_group_due(g,day.run_date)");
    expect(sql).toContain("not exists(select 1 from public.inventory_stock_checks c");
  });

  it("rejects stale scheduled writes and keeps the occurrence identity fixed", () => {
    expect(sql).toContain("create trigger inventory_scheduled_stock_check_date_guard");
    expect(sql).toContain("new.check_date is distinct from v_today");
    expect(sql).toContain("old.check_date is distinct from new.check_date");
    expect(sql).toContain("old.group_id is distinct from new.group_id");
    expect(sql).toContain("old.shift is distinct from new.shift");
  });

  it("makes Skip a scoped, idempotent, immutable and PO-ineligible terminal action", () => {
    expect(sql).toContain("inventory_authority.crew_scope(p_token,p_outlet_id,'can_perform_stock_check')");
    expect(sql).toContain("inventory_stock_check_run_");
    expect(sql).toContain("only a due stock check can be skipped");
    expect(sql).toContain("'stock_check_skip'");
    expect(sql).toContain("'skipped_at',v_check.skipped_at");
    expect(sql).toContain("old.status in ('submitted','skipped')");
    expect(sql).toContain("to anon,authenticated");
    expect(purchaseSql).toMatch(/stock_check_type<>'scheduled'\s+or v_check.status<>'submitted'/);
  });

  it("keeps completed backdated Audits in History without converting them into purchase sources", () => {
    expect(sql).toContain("c.submitted_at>=now()-interval '90 days'");
    expect(sql).toContain("c.stock_check_type='audit'");
    expect(sql).toContain("'item_count',(select count(*)");
    expect(purchaseSql).toMatch(/stock_check_type<>'scheduled'\s+or v_check.status<>'submitted'/);
  });

  it("bounds read-derived Missed runs and presents one canonical row for legacy duplicate occurrences", () => {
    expect(historySql).toContain("(v_today-7)::timestamp");
    expect(historySql).toContain("c2.group_id=c.group_id");
    expect(historySql).toContain("c2.check_date=c.check_date");
    expect(historySql).toContain("c2.shift is not distinct from c.shift");
    expect(historySql).toContain("case c2.status when 'submitted' then 0 when 'skipped' then 1 else 2 end");
    expect(historySql).toContain("c.stock_check_type='audit' or c.id=");
    expect(historySql).toContain("c.submitted_at>=now()-interval '90 days'");
  });
});
