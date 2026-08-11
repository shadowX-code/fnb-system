import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));

import { crewService } from "../crewService.js";

describe("Crew learning mobile service boundaries", () => {
  beforeEach(() => { mocks.rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null }); });

  it("uses token-bound Crew RPCs for all Crew learning actions", async () => {
    await crewService.learningHome("crew-token");
    await crewService.learningAssignment("crew-token", "assignment-1");
    await crewService.submitQuiz("crew-token", "assignment-1", "quiz-1", [{ question_id: "q-1", option_ids: ["o-1"] }]);
    await crewService.completeLesson("crew-token", "assignment-1", "lesson-1");
    await crewService.sopVersion("crew-token", "version-1");
    await crewService.acknowledgeSop("crew-token", "version-1");

    expect(mocks.rpc).toHaveBeenCalledWith("crew_learning_home", { p_token: "crew-token" });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_learning_assignment", { p_token: "crew-token", p_assignment_id: "assignment-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_submit_quiz", expect.objectContaining({ p_token: "crew-token", p_assignment_id: "assignment-1", p_quiz_id: "quiz-1" }));
    expect(mocks.rpc).toHaveBeenCalledWith("crew_complete_lesson", { p_token: "crew-token", p_assignment_id: "assignment-1", p_lesson_id: "lesson-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_sop_version", { p_token: "crew-token", p_sop_version_id: "version-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_acknowledge_sop", { p_token: "crew-token", p_sop_version_id: "version-1", p_source: "journey" });
  });

  it("uses dedicated authenticated authorities for non-draft transitions", async () => {
    await crewService.publishJourney("journey-1");
    await crewService.newJourneyVersion("journey-1");
    await crewService.publishSopVersion("version-1");
    await crewService.newSopVersion("sop-1");
    await crewService.assignJourney("employee-1", "journey-1", "2026-09-01");

    expect(mocks.rpc).toHaveBeenCalledWith("crew_publish_journey", { p_journey_id: "journey-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_new_journey_version", { p_journey_id: "journey-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_publish_sop_version", { p_sop_version_id: "version-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_new_sop_version", { p_sop_id: "sop-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("assign_crew_journey", { p_employee_id: "employee-1", p_journey_id: "journey-1", p_due_at: "2026-09-01" });
  });
});
