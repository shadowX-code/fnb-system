import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(path.resolve("supabase/migrations/20260928020423_crew_performance_v2_only_cutover.sql"), "utf8").toLowerCase();
const body = (name, next) => sql.split(`create or replace function public.${name}`)[1]?.split(`create or replace function public.${next}`)[0] || "";

describe("Performance V2-only forward cutover", () => {
  it("guards V1 cleanup and preserves independent evidence", () => {
    expect(sql).toContain("v1 performance has a non-qa or paid reward dependency; cutover stopped");
    expect(sql).toContain("delete from public.crew_performance_reviews v");
    expect(sql).toContain("delete from public.crew_performance_results where calculation_version = 'performance-v1'");
    expect(sql).toContain("delete from public.crew_reward_cycles where id in (select id from v1_reward_cycles)");
    expect(sql).not.toMatch(/delete from public\.crew_customer_feedback\b/);
    expect(sql).not.toMatch(/delete from public\.employees\b/);
  });

  it("has one Service Crew model with fixed 30/30/20/15/5 weights", () => {
    expect(body("crew_performance_model", "crew_performance_review_score")).toContain("then 'performance-v2' else null");
    const knowledge = body("crew_performance_knowledge_component", "crew_refresh_performance");
    expect(knowledge).toContain("'max_score',15");
    expect(knowledge).toContain("'calculation_version','performance-v2'");
    expect(knowledge).not.toContain("performance-v1");
    const refresh = body("crew_refresh_performance", "crew_performance_finalize");
    expect(refresh).toContain("'google_review_authority_not_available'");
    expect(refresh).toContain("'max_score',20");
    expect(refresh).toContain("'peer',peer");
    expect(refresh).toContain("total_score=null");
    expect(refresh).not.toContain("crew_performance_customer_component");
    expect(refresh).not.toContain("component='conduct'");
    expect(sql).toContain("drop table public.crew_performance_model_periods");
    expect(sql).toContain("calculation_version = 'performance-v2'");
  });

  it("blocks finalization and draft Reward estimates", () => {
    expect(body("crew_performance_finalize", "crew_performance_mobile")).toContain("google customer evidence is pending; performance cannot be finalized");
    const reward = body("crew_reward_mobile", "crew_dashboard_admin_data").split("drop function public.crew_reward_draft_projection")[0];
    expect(reward).toContain("finalized performance is required before reward can be calculated");
    expect(reward).not.toContain("crew_reward_draft_projection");
    expect(reward).not.toContain("perform public.crew_refresh_performance");
    expect(sql).toContain("drop function public.crew_reward_draft_projection(uuid,uuid,date)");
  });

  it("keeps paging and Crew reads on the five-component contract", () => {
    const admin = body("crew_performance_admin_data", "crew_feedback_refresh_mutable_performance");
    expect(admin).toContain("lower(btrim(e.position))='service crew'");
    expect(admin).toContain("'peer','label','peer review','max_score',5");
    expect(admin).not.toContain("'conduct'");
    const mobile = body("crew_performance_mobile", "crew_performance_admin_page");
    expect(mobile).toContain("'pending_component_names'");
    expect(mobile).not.toContain("'conduct'");
    expect(body("crew_performance_admin_page", "crew_performance_admin_data")).toContain("'review_queue','team'");
  });

  it("closes fractional late-minute gaps in seconds", () => {
    const attendance = body("crew_performance_attendance_component", "crew_reward_mobile");
    for (const bound of ["> 600", "<= 1200", "> 1200", "<= 2700", "> 2700"]) expect(attendance).toContain(bound);
    expect(attendance).not.toContain("/60 between");
  });
});
