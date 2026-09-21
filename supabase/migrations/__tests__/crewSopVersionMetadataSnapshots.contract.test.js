import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const migration = fs.readFileSync(path.resolve("supabase/migrations/20260921200000_crew_sop_version_metadata_snapshots.sql"), "utf8");

describe("Crew SOP version metadata snapshots", () => {
  it("stores editable metadata with each SOP version and backfills historical snapshots", () => {
    expect(migration).toContain("add column if not exists title text");
    expect(migration).toContain("add column if not exists category_id uuid");
    expect(migration).toContain("add column if not exists summary text");
    expect(migration).toContain("update public.crew_sop_versions version_row");
    expect(migration).toContain("crew_sop_version_metadata_defaults");
  });

  it("copies published metadata into a new draft and only updates the live parent at publish", () => {
    expect(migration).toMatch(/crew_new_sop_version[\s\S]*source_version\.title[\s\S]*source_version\.category_id/);
    expect(migration).toMatch(/crew_publish_sop_version[\s\S]*update public\.crew_sops set title=v_version\.title/);
    expect(migration).toMatch(/crew_publish_sop_version[\s\S]*perform public\.crew_begin_learning_transition\(\)/);
    expect(migration).toContain("Choose an SOP category from this outlet.");
  });

  it("returns immutable version metadata to Crew instead of parent-library fields", () => {
    expect(migration).toMatch(/crew_sop_version\(p_token text, p_sop_version_id uuid\)[\s\S]*'title',v\.title[\s\S]*'category',v\.category[\s\S]*'summary',v\.summary/);
    expect(migration).toContain("'acknowledged_at'");
  });
});
