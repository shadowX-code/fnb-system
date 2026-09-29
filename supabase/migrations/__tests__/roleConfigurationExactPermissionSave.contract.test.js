import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve(process.cwd(), "supabase/migrations/20260929104047_role_configuration_exact_permission_save.sql"), "utf8");

describe("exact role permission save", () => {
  it("rejects missing catalog codes, checks the persisted set, and audits the canonical result atomically", () => {
    expect(sql).toContain("permission.code=requested.code");
    expect(sql).toContain("Role permission snapshot did not persist completely.");
    expect(sql).toContain("insert into public.audit_logs");
    expect(sql).toContain("'request_id',p_request_id");
    expect(sql).toContain("'after',to_jsonb(v_existing) || jsonb_build_object('permissions',v_result->'permissions'");
    expect(sql).toContain("('crew_sop_library.manage'");
  });
});
