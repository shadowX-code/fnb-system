import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(
  path.resolve("supabase/migrations/20260812103647_crew_learning_media_storage.sql"),
  "utf8",
);
const edgeFunction = fs.readFileSync(
  path.resolve("supabase/functions/crew-learning-media-url/index.ts"),
  "utf8",
);
const runtimeFix = fs.readFileSync(
  path.resolve("supabase/migrations/20260812105058_crew_learning_media_access_runtime_fix.sql"),
  "utf8",
);

describe("Crew Learning private media contract", () => {
  it("creates a private constrained bucket and never permits overwrite", () => {
    expect(migration).toMatch(/'crew-learning-media'[\s\S]*false[\s\S]*5242880/);
    expect(migration).toContain("array['image/jpeg', 'image/png', 'image/webp']::text[]");
    expect(migration).not.toMatch(/for update\s+to authenticated[\s\S]*bucket_id = 'crew-learning-media'/i);
  });

  it("binds Admin upload/delete to permission and outlet scope", () => {
    expect(migration).toContain("current_user_has_permission('crew_learning.manage')");
    expect(migration).toContain("current_user_can_access_outlet(p_outlet_id)");
    expect(migration).toContain("media.uploaded_by = auth.uid()");
    expect(migration).toContain("'published_reference'");
  });

  it("keeps Crew reads token and assignment bound", () => {
    expect(migration).toMatch(/crew_learning_media_access\([\s\S]*crew_session_employee\(p_token\)/);
    expect(migration).toContain("assignment.employee_id = employee_id");
    expect(migration).toContain("block_item #>> '{payload,media,id}' = p_media_id::text");
    expect(edgeFunction).toContain("createSignedUrl(access.object_path, 300)");
    expect(edgeFunction).toContain('"Cache-Control": "no-store"');
    expect(runtimeFix).toContain("assignment.employee_id = v_employee_id");
  });

  it("uses fixed search paths and explicit ACLs", () => {
    const functions = [
      "crew_prepare_learning_media_upload",
      "crew_finalize_learning_media_upload",
      "crew_request_learning_media_delete",
      "crew_finalize_learning_media_delete",
      "crew_learning_media_access",
      "crew_validate_learning_media_on_publish",
    ];
    for (const name of functions) {
      expect(migration).toMatch(new RegExp(`${name}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = public, storage, pg_temp`, "i"));
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.${name}\\(`, "i"));
    }
  });
});
