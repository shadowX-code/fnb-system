import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260911054825_factory_product_feedback_form_versions.sql"), "utf8");
const contactReadbackSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260911061827_factory_product_feedback_form_version_contact_readback.sql"), "utf8");
const versionMetadataSql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260912060441_factory_product_feedback_form_version_metadata.sql"), "utf8");

describe("Product Feedback form versions", () => {
  it("links every response to an immutable canonical form definition", () => {
    expect(sql).toContain("create table public.factory_product_feedback_form_versions");
    expect(sql).toContain("active_form_version_id uuid references public.factory_product_feedback_form_versions");
    expect(sql).toContain("form_version_id uuid references public.factory_product_feedback_form_versions");
    expect(sql).toContain("questions_snapshot, answers, answer_details");
  });

  it("requires an explicit version confirmation for semantic changes after responses", () => {
    expect(sql).toContain("factory_product_feedback_questions_differ_only_by_presentation");
    expect(sql).toContain("FORM_VERSION_REQUIRED");
    expect(sql).toContain("v_form_change <> 'new_version'");
    expect(sql).toContain("values(v_id, v_existing.form_version + 1, v_questions, v_actor)");
  });

  it("pins public submission to the active version and validates option detail evidence", () => {
    expect(sql).toContain("where id = v_campaign.active_form_version_id");
    expect(sql).toContain("p_answer_details jsonb default '{}'::jsonb");
    expect(sql).toContain("allow_additional_text");
    expect(sql).toContain("Additional answer details are invalid.");
  });

  it("retains separately stored contact evidence in the authenticated versioned read model", () => {
    expect(contactReadbackSql).toContain("rename to factory_product_feedback_admin_data_base");
    expect(contactReadbackSql).toContain("factory_product_feedback_response_contacts");
    expect(contactReadbackSql).toContain("'answer_details', r.answer_details");
    expect(contactReadbackSql).toContain("'{summary,contacts}'");
  });

  it("projects active version metadata without changing immutable response evidence", () => {
    expect(versionMetadataSql).toContain("'active', f.id = c.active_form_version_id");
    expect(versionMetadataSql).toContain("'question_count', jsonb_array_length(f.questions)");
    expect(versionMetadataSql).toContain("'response_count', (select count(*) from public.factory_product_feedback_responses r where r.form_version_id = f.id)");
    expect(versionMetadataSql).toContain("'{form_versions}'");
  });
});
