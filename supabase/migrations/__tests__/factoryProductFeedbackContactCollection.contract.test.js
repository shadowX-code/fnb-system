import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.resolve("supabase/migrations/20260910020000_factory_product_feedback_contact_collection.sql"),
  "utf8",
).toLowerCase();

describe("Factory Product Feedback contact collection contract", () => {
  it("stores contact evidence separately from immutable feedback answers", () => {
    expect(sql).toContain("factory_product_feedback_response_contacts");
    expect(sql).toContain("response_id uuid not null unique");
    expect(sql).toContain("contact_collection jsonb");
    expect(sql).toContain("insert into public.factory_product_feedback_response_contacts");
  });

  it("keeps PII behind the trusted submission and admin read authorities", () => {
    expect(sql).toContain("p_contact jsonb default '{}'::jsonb");
    expect(sql).toContain("normalized_mobile");
    expect(sql).toContain("revoke all on table public.factory_product_feedback_response_contacts from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.factory_product_feedback_public_submit(text, jsonb, text, text, jsonb) to anon, authenticated");
  });
});
