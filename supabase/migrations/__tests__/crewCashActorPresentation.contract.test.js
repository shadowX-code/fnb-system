import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260922030000_crew_cash_actor_presentation.sql"), "utf8").toLowerCase();

describe("Crew Cash actor presentation", () => {
  it("resolves immutable actor IDs through People display names without projecting auth email", () => {
    expect(sql).toContain("admin_sender.auth_user_id=c.handed_over_by_user_id");
    expect(sql).toContain("recorded_admin.auth_user_id=entry.recorded_by_user_id");
    expect(sql).toContain("coalesce(crew_sender.full_name,admin_sender.full_name,'admin')");
    expect(sql).toContain("coalesce(recorded_crew.full_name,recorded_admin.full_name,'admin')");
    expect(sql).not.toContain("auth.users");
    expect(sql).not.toContain(".email");
  });

  it("normalizes pending, recent, and ledger actor display without changing ledger authority", () => {
    expect(sql).toContain("'{pending_receipts}'");
    expect(sql).toContain("'{deposit,ledger}'");
    expect(sql).toContain("'{deposit,recent}'");
    expect(sql).not.toContain("insert into public.crew_cash_");
    expect(sql).not.toContain("update public.crew_cash_");
  });
});
