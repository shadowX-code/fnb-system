import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { serviceCrewV2, profileDraft } from "./serviceCrewV2.js";
import InterviewIntelligenceBuilder from "./InterviewIntelligenceBuilder.jsx";
import { interviewInstructions } from "../../../supabase/functions/recruitment-realtime/prompt.ts";
import { continuationContext } from "../../../supabase/functions/recruitment-realtime/context.ts";
afterEach(cleanup);
describe("Interview Intelligence V2", () => {
  it("five existing areas, cross-area guidance, optional delayed-food scenario and no auto publication", () => {
    const definition = profileDraft({ evidence_areas: [] });
    expect(definition.evidence_areas).toHaveLength(5);
    expect(
      definition.evidence_areas.filter((a) => a.priority === "Core"),
    ).toHaveLength(3);
    expect(definition.scenarios[0].required).toBe(false);
    definition.evidence_areas[0].goal = "draft change";
    expect(serviceCrewV2.evidence_areas[0].goal).not.toBe("draft change");
  });
  it("builder uses expandable objects and accessible editable guidance", () => {
    const change = vi.fn();
    render(
      <InterviewIntelligenceBuilder
        definition={serviceCrewV2}
        onChange={change}
        version={2}
      />,
    );
    fireEvent.click(screen.getAllByText("Customer Handling")[0]);
    fireEvent.change(screen.getAllByLabelText("Goal")[0], {
      target: { value: "Understand customer communication in practice" },
    });
    expect(change.mock.calls[0][0].evidence_areas[0].goal).toContain(
      "communication",
    );
    expect(screen.queryByRole("button", { name: /publish/i })).toBeNull();
  });
  it("narrow context pins confirmed facts and latest findings without full audit history or truncated replay", () => {
    const state = {
      job_facts: { offered_salary: "RM 2,000 monthly" },
      current_findings: [
        {
          topic_index: 2,
          state: "covered",
          reason: "Cannot work after 9pm",
          evidence_turn_id: 1,
        },
      ],
      max_ends_at: new Date(Date.now() + 300000).toISOString(),
      turns: [
        {
          id: 1,
          provider_generation: 1,
          provider_item_id: "a",
          speaker: "candidate",
          turn_number: 1,
          transcript: "不能做晚班",
        },
        {
          id: 2,
          provider_generation: 1,
          provider_item_id: "b",
          speaker: "ai",
          turn_number: 2,
          transcript: "unfinished",
        },
      ],
      topics: [
        {
          topic_index: 2,
          topic: "Shift Flexibility",
          state: "covered",
          evidence_turn_id: 1,
        },
      ],
      scenarios: [
        {
          scenario_index: 0,
          brief: "Delay",
          state: "pending",
          equivalent_turn_id: 1,
        },
      ],
    };
    const ctx = continuationContext(
      state,
      { provider_generation: 2, preferred_language: "zh" },
      {
        required_topics: [],
        target_minutes: 10,
        scenario_briefs: [],
        interview_profile: {
          name: "Service Crew",
          version: 2,
          definition: serviceCrewV2,
        },
      },
      { position_snapshot: "Service Crew" },
      [{ kind: "truncated", provider_generation: 1, provider_item_id: "b" }],
    );
    expect(ctx.turns).toHaveLength(1);
    expect(ctx.established_facts[0].statement).toBe("不能做晚班");
    expect(ctx.scenarios[0].state).toBe("equivalent real evidence");
    const instructions = interviewInstructions(ctx);
    expect(instructions).toContain("RM 2,000 monthly");
    expect(instructions).toContain("UNCONFIRMED");
    expect(instructions).toContain("candidate Q&A");
    expect(instructions).not.toContain(
      "past-experience story is not a substitute",
    );
    expect(instructions).toContain("Covered never means Meets");
    expect(instructions).toContain('"scenarios":[]');
  });
});

import Room from "./RecruitmentInterviewRoom.jsx";
it("submission retry presentation never says Submitting or pretends recording is active", () => {
  render(
    <Room
      entry={{ job: { position: "Service Crew" } }}
      presence={{ state: "speaking" }}
      status="submission_required"
      recordingStatus="recording"
      elapsed={0}
    />,
  );
  expect(screen.queryByText(/Submitting/)).toBeNull();
  expect(screen.queryByText("● Recording")).toBeNull();
  expect(screen.getAllByText(/Submission needs attention/)).toHaveLength(1);
});
