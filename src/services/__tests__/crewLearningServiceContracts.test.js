import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));

import { crewService } from "../crewService.js";

describe("Crew learning mobile service boundaries", () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
    mocks.from.mockReset();
  });

  it("uses token-bound Crew RPCs for all Crew learning actions", async () => {
    await crewService.learningHome("crew-token");
    await crewService.learningAssignment("crew-token", "assignment-1");
    await crewService.sopLibrary("crew-token");
    await crewService.submitQuiz("crew-token", "assignment-1", "quiz-1", [{ question_id: "q-1", option_ids: ["o-1"] }]);
    await crewService.completeLesson("crew-token", "assignment-1", "lesson-1");
    await crewService.sopVersion("crew-token", "version-1");
    await crewService.acknowledgeSop("crew-token", "version-1");

    expect(mocks.rpc).toHaveBeenCalledWith("crew_learning_home", { p_token: "crew-token" });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_learning_assignment", { p_token: "crew-token", p_assignment_id: "assignment-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_sop_library", { p_token: "crew-token" });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_submit_quiz", expect.objectContaining({ p_token: "crew-token", p_assignment_id: "assignment-1", p_quiz_id: "quiz-1" }));
    expect(mocks.rpc).toHaveBeenCalledWith("crew_complete_lesson", { p_token: "crew-token", p_assignment_id: "assignment-1", p_lesson_id: "lesson-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_sop_version", { p_token: "crew-token", p_sop_version_id: "version-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_acknowledge_sop", { p_token: "crew-token", p_sop_version_id: "version-1", p_source: "journey" });
  });

  it("uses dedicated outlet authorities for mandatory onboarding and independent cloning", async () => {
    await crewService.createDefaultOnboarding("outlet-1");
    await crewService.onboardingProgress("outlet-1");
    await crewService.cloneLearningSetup({
      sourceOutletId: "outlet-1",
      targetOutletId: "outlet-2",
      copyOnboarding: true,
      copyCategories: true,
      copySops: true,
    });
    await crewService.cloneSelectedSops({
      sourceOutletId: "outlet-1",
      targetOutletId: "outlet-2",
      sopIds: ["sop-1", "sop-2"],
    });
    await crewService.sopUsageAdmin("sop-1");

    expect(mocks.rpc).toHaveBeenCalledWith("crew_create_default_onboarding", {
      p_outlet_id: "outlet-1",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_admin_onboarding_progress", {
      p_outlet_id: "outlet-1",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_clone_learning_setup", {
      p_source_outlet_id: "outlet-1",
      p_target_outlet_id: "outlet-2",
      p_copy_onboarding: true,
      p_copy_sop_categories: true,
      p_copy_sops: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_clone_selected_sops", {
      p_source_outlet_id: "outlet-1",
      p_target_outlet_id: "outlet-2",
      p_sop_ids: ["sop-1", "sop-2"],
      p_copy_categories: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("crew_admin_sop_usage", { p_sop_id: "sop-1" });
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

  it("normalizes PostgREST one-to-one quiz relations for the Admin editor", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockResolvedValue({
        data: [
          {
            id: "journey-1",
            modules: {
              id: "module-1",
              lessons: {
                id: "lesson-1",
                blocks: null,
                quizzes: {
                  id: "quiz-1",
                  questions: {
                    id: "question-1",
                    options: { id: "option-1" },
                  },
                },
              },
            },
          },
        ],
        error: null,
      });
    mocks.from.mockReturnValue(query);

    const [journey] = await crewService.listOnboardingAdmin("outlet-1");

    expect(journey.modules).toHaveLength(1);
    expect(journey.modules[0].lessons).toHaveLength(1);
    expect(journey.modules[0].lessons[0].quizzes).toHaveLength(1);
    expect(journey.modules[0].lessons[0].quizzes[0].questions[0].options).toHaveLength(1);
  });
});
