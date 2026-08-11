import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202608050001_factory_historical_dispatch_batch_reconciliation.sql"), "utf8");

describe("Factory historical Dispatch batch reconciliation migration contract", () => {
  it("reconciles the complete confirmed historical dataset without fabricating Factory rows", () => {
    for (const text of [
      "'D260619-01'::text",
      "'D260625-01'::text",
      "'PB-20260616-7TDD'::text",
      "'PB-20260622-R33N'::text",
      "update public.factory_finished_good_dispatch_items",
      "factory_historical_dispatch_batch_reconciled",
    ]) expect(migration).toContain(text);

    expect(migration).not.toMatch(/insert\s+into\s+public\.factory_(?:finished_goods|finished_good_dispatches|finished_good_dispatch_items|productions)/i);
  });

  it("is a safe no-op only when the relevant Factory operational dataset is completely absent", () => {
    for (const table of [
      "public.factory_finished_goods",
      "public.factory_finished_good_dispatches",
      "public.factory_finished_good_dispatch_items",
      "public.factory_productions",
    ]) expect(migration).toContain(`(select count(*) from ${table})`);

    expect(migration).toContain("if v_factory_operational_row_count = 0 then");
    expect(migration).toContain("Skipping historical Dispatch batch reconciliation because this environment has no Factory operational records.");
  });

  it("keeps partial or inconsistent historical data on the strict failure path", () => {
    expect(migration).toMatch(/if v_factory_operational_row_count = 0 then[\s\S]*?raise notice[\s\S]*?else[\s\S]*?Historical Dispatch Item % was not found for Dispatch %\.[\s\S]*?end if;/);
    expect(migration).toContain("Confirmed source Production % was not found for Dispatch %.");
    expect(migration).toContain("Historical Dispatch Item % Batch reference was not reconciled to %.");
  });
});
