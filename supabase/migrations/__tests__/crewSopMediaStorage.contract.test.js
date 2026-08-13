import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(path.resolve("supabase/migrations/20260813183402_crew_sop_media_storage.sql"), "utf8");
const edge = fs.readFileSync(path.resolve("supabase/functions/crew-sop-media-url/index.ts"), "utf8");

describe("Crew SOP private media contract", () => {
  it("creates a private constrained bucket and version-scoped opaque path", () => {
    expect(migration).toMatch(/'crew-sop-media'[\s\S]*false[\s\S]*5242880/);
    expect(migration).toContain("array['image/jpeg', 'image/png', 'image/webp']::text[]");
    expect(migration).toContain("p_sop_version_id::text || '/' || v_media_id::text || '.webp'");
    expect(migration).not.toMatch(/for update\s+to authenticated[\s\S]*bucket_id = 'crew-sop-media'/i);
  });

  it("binds admin writes to SOP manage, draft state and outlet scope", () => {
    expect(migration).toContain("current_user_has_permission('crew_sop.manage')");
    expect(migration).toContain("current_user_can_access_outlet(v_outlet_id)");
    expect(migration).toContain("v_status <> 'draft'");
    expect(migration).toContain("media.uploaded_by = auth.uid()");
  });

  it("keeps Crew reads token, outlet, published-version and assignment bound", () => {
    expect(migration).toMatch(/crew_sop_media_access\([\s\S]*crew_session_employee\(p_token\)/);
    expect(migration).toContain("a.employee_id = v_employee_id");
    expect(migration).toContain("section.sop_version_id = p_sop_version_id");
    expect(edge).toContain("createSignedUrl(access.object_path, 300)");
    expect(edge).toContain('"Cache-Control": "no-store"');
  });

  it("protects published references and remaps clone assets", () => {
    expect(migration).toContain("'published_reference'");
    expect(migration).toContain("'media_copies',media_manifest");
    expect(migration).toContain("target_path := p_target_outlet_id::text");
    expect(migration).toContain("crew_attach_sop_media");
  });

  it("fixes search paths and explicitly grants authorities", () => {
    for (const name of [
      "crew_prepare_sop_media_upload", "crew_finalize_sop_media_upload", "crew_request_sop_media_delete",
      "crew_finalize_sop_media_delete", "crew_validate_sop_section_media", "crew_sop_media_access",
      "crew_attach_sop_media", "crew_new_sop_version", "crew_publish_sop_version", "crew_sop_version",
      "crew_clone_selected_sops", "crew_prepare_sop_draft_media_cleanup",
    ]) {
      expect(migration).toMatch(new RegExp(`${name}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = public, storage, pg_temp`, "i"));
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.${name}\\(`, "i"));
    }
  });
});
