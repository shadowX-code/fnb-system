import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260826092703_crew_cash_collection_submission_ledger.sql"), "utf8").toLowerCase();
const compatibilitySql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260826094526_crew_cash_mobile_available_balance_compatibility.sql"), "utf8").toLowerCase();
const handoverSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260826103000_crew_cash_handover_receivers.sql"), "utf8").toLowerCase();
const handoverProjectionSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260826110821_crew_cash_handover_confirmation_projection.sql"), "utf8").toLowerCase();
const handoverSessionFixSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260826112806_fix_crew_cash_handover_session_context.sql"), "utf8").toLowerCase();

describe("Cash Collection submission-ledger authority", () => {
  it("deducts at submission, projects one balance, and exposes pending confirmation only as audit context", () => {
    expect(sql).toContain("values(outlet,'collection',-row.amount,row.id,'cash collection'");
    expect(sql).toContain("'current_balance',public.crew_cash_balance(outlet)");
    expect(sql).toContain("'pending_confirmation_amount'");
    expect(sql).not.toContain("'available_balance',public.crew_cash_available_balance(outlet)");
    expect(compatibilitySql).toContain("'{deposit,available_balance}'");
    expect(compatibilitySql).toContain("public.crew_cash_available_balance(outlet)");
  });
  it("does not post a second debit on confirmation or review and transitions legacy unposted handovers once", () => {
    expect(sql).toContain("legacy pending confirmation transition");
    expect(sql).toContain("not exists (\n    select 1 from public.crew_cash_ledger_entries l where l.collection_id = c.id");
    expect(sql).toContain("if row.status in ('completed','review_required') then return to_jsonb(row); end if;");
    expect(sql).not.toContain("-row.received_amount");
  });
  it("requires one server-enforced request identity and fingerprint on both write paths", () => {
    expect(sql).toContain("crew_cash_collections_outlet_request_idx");
    expect(sql).toContain("add column if not exists request_id uuid");
    expect(sql).toContain("add column if not exists request_fingerprint text");
    expect(sql.match(/cash collection request_id is required/g)).toHaveLength(2);
    expect(sql.match(/request_id conflicts with a different payload/g)).toHaveLength(2);
    expect(sql).toContain("create or replace function public.crew_cash_admin_record_collection");
    expect(sql.match(/insert into public.crew_cash_ledger_entries\(outlet_id,entry_type,signed_amount,collection_id/g).length).toBeGreaterThanOrEqual(2);
  });
  it("retains token/session, permission, outlet lock, fixed search path, and explicit grants", () => {
    ["crew_operations_employee_context(p_token)", "crew_session_employee(p_token)", "pg_advisory_xact_lock", "security definer set search_path=public", "revoke all on function", "grant execute on function public.crew_cash_mobile(text,date) to anon,authenticated"].forEach((contract) => expect(sql).toContain(contract));
  });
  it("locks Cash Handover confirmation to the submitted amount and exposes audited handover parties without recalculating balances", () => {
    expect(handoverSql).toContain("crew_cash_handover_receiver_configs");
    expect(handoverSql).toContain("p_expected_version<>current_version");
    expect(handoverSql).toContain("crew_cash_handover_receiver_config_audit");
    expect(handoverProjectionSql).toContain("p_received_amount is distinct from row.amount");
    expect(handoverProjectionSql).toContain("'handover_from'");
    expect(handoverProjectionSql).toContain("'handover_to'");
    expect(handoverProjectionSql).not.toContain("balance_after");
    expect(handoverSessionFixSql).toContain("crew_operations_employee_context(p_token)");
    expect(handoverSessionFixSql).not.toContain("crew_session_context(p_token)");
  });
});
