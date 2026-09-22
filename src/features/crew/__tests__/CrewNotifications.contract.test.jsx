import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { crewRouteForState, parseCrewRoute } from "../crewRoute.js";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260921150000_crew_notification_foundation_v1.sql"), "utf8");
const app = readFileSync(resolve(process.cwd(), "src/features/crew/CrewMobileApp.jsx"), "utf8");
const home = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewHomeMobile.jsx"), "utf8");
const center = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewNotificationsMobile.jsx"), "utf8");

describe("Crew Notification Foundation V1 contracts", () => {
  it("keeps notification delivery/read private and token-bound", () => {
    expect(migration).toContain("create table public.crew_notifications");
    expect(migration).toContain("create table public.crew_notification_reads");
    expect(migration).toContain("crew_session_employee(p_token)");
    expect(migration).toContain("crew_notification_mark_read");
    expect(migration).toContain("on conflict(notification_id,recipient_employee_id) do nothing");
  });

  it("uses deterministic producer keys and scheduler-owned time notifications", () => {
    expect(migration).toContain("task.actionable:");
    expect(migration).toContain("task.due_soon:");
    expect(migration).toContain("task.overdue:");
    expect(migration).toContain("crew_notification_generate_scheduled");
    expect(migration).toContain("feedx_crew_notification_v1");
  });

  it("adds a stable notification route and leaves typed targets with owning domains", () => {
    expect(crewRouteForState({ screen: "notifications" }).canonicalHash).toBe("#crew/notifications");
    expect(parseCrewRoute("#crew/notifications")?.screen).toBe("notifications");
    expect(home).toContain("notificationUnreadCount");
    expect(center).toContain("markNotificationRead");
    expect(app).toContain('type === "task_occurrence"');
  });
});
