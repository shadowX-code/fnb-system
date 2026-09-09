import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.resolve("supabase/migrations/20260910010000_factory_product_feedback_public_availability_business_date.sql"),
  "utf8",
).toLowerCase();

describe("Factory Product Feedback public availability", () => {
  it("uses the Factory Malaysia business date for both public entry and submit", () => {
    expect(sql).toContain("v_business_date date := timezone('asia/kuala_lumpur', now())::date");
    expect(sql.match(/starts_on is not null and v_campaign\.starts_on > v_business_date/g)).toHaveLength(2);
    expect(sql.match(/ends_on is not null and v_campaign\.ends_on < v_business_date/g)).toHaveLength(2);
  });

  it("keeps invalid tokens non-enumerating and retains the public RPC grants", () => {
    expect(sql).toContain("return jsonb_build_object('available', false)");
    expect(sql).toContain("grant execute on function public.factory_product_feedback_public_entry(text), public.factory_product_feedback_public_submit(text, jsonb, text, text) to anon, authenticated");
  });
});
