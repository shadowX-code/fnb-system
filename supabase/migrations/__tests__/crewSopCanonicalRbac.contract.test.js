import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(path.resolve("supabase/migrations/20261002042757_crew_sop_library_canonical_rbac.sql"), "utf8");
describe("SOP canonical RBAC migration", () => {
  it("uses no legacy permission authority", () => {
    expect(sql).not.toMatch(/crew_sop\.(view|manage)/);
    for (const action of ["view", "create", "edit", "manage"]) expect(sql).toContain(`crew_sop_library.${action}`);
  });
  it("separates read RLS from scoped authoring and preserves immutable identities", () => {
    expect(sql).toContain('crew_sop_admin_read');
    expect(sql).toContain('crew_sop_admin_create');
    expect(sql).toContain('crew_sop_admin_edit');
    expect(sql).toContain('crew_sop_admin_delete');
    expect(sql).toContain('s.created_by=auth.uid()');
    expect(sql).toContain("v.status='published'");
    expect(sql).toContain('SOP creator attribution is immutable.');
    expect(sql).toContain('SOP content parent identity is immutable.');
    expect(sql).toContain('SOP publication requires Manage and the publish workflow.');
    expect(sql).toContain('public.current_user_can_access_outlet(outlet_id)');
  });
});
