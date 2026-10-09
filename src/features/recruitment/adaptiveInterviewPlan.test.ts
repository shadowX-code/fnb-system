import { describe, it, expect } from "vitest";
import {
  conversationProfile,
  scenarioRequired,
} from "../../../supabase/functions/_shared/recruitmentConversationPlan.ts";
import {
  interviewInstructions,
  firstInterviewResponse,
} from "../../../supabase/functions/recruitment-realtime/prompt.ts";
import { coverageInput } from "../../../supabase/functions/recruitment-evidence/coverageContext.ts";
import { serviceCrewV2 } from "./serviceCrewV2.js";
// Unpublished V3's five competency goals are a reference fixture, never an invitation pin.
const names = [
  "Customer Service",
  "Communication",
  "Teamwork",
  "Responsibility",
  "Adaptability",
];
const profile = {
  name: "Service Crew",
  version: 3,
  definition: {
    ...structuredClone(serviceCrewV2),
    evidence_areas: names.map((name, i) => ({
      ...serviceCrewV2.evidence_areas[i],
      name,
      priority: i === 0 ? "Core" : "Important",
      rubric: {
        levels: [1, 2, 3, 4].map((level) => ({
          level,
          criteria: `EVALUATION_ONLY_${name}_${level}`,
        })),
      },
      private_extension: "EXCLUDE_THIS",
    })),
    scenarios: [{ ...serviceCrewV2.scenarios[0], evidence_areas: names }],
    private_extension: "EXCLUDE_THIS",
  },
};
const answer =
  "At a school food event I checked the delayed order with the kitchen, updated the guest and asked a teammate to cover my station.";
function context() {
  return {
    generation: 2,
    interview_profile: profile,
    target_minutes: 10,
    remaining_seconds: 120,
    required_topics: names,
    scenario_briefs: [],
    language_guidance: "Follow current speech",
    interview_instructions: "",
    topics: names.map((topic, index) => ({
      index,
      topic,
      state: index === 0 ? "covered" : "partial",
    })),
    scenarios: [
      {
        index: 0,
        brief: profile.definition.scenarios[0].brief,
        state: "equivalent real evidence",
      },
    ],
    turns: [{ speaker: "candidate", transcript: answer, turn_number: 6 }],
    established_facts: names
      .slice(0, 3)
      .map((topic) => ({ topic, statement: answer, turn_number: 6 })),
  } as any;
}
describe("Evidence goals separate from rubric evaluation", () => {
  it("projects pinned collection guidance without criteria or unknown extensions, without mutating the profile", () => {
    const before = structuredClone(profile),
      plan = conversationProfile(profile)!;
    expect(plan.version).toBe(3);
    expect(plan.definition.evidence_areas.map((a) => a.name)).toEqual(names);
    expect(plan.definition.completion_criteria).toEqual(
      profile.definition.completion_criteria,
    );
    expect(plan.definition.scenarios).toEqual(profile.definition.scenarios);
    expect(JSON.stringify(plan)).not.toMatch(
      /EVALUATION_ONLY|EXCLUDE_THIS|rubric/,
    );
    expect(profile).toEqual(before);
    expect(profile.definition.evidence_areas[0].rubric.levels).toHaveLength(4);
  });
  it("keeps ordinary, entry and recovery instructions free of literal evaluation criteria", () => {
    for (const c of [context(), { ...context(), generation: 1, turns: [] }]) {
      for (const prompt of [
        interviewInstructions(c),
        firstInterviewResponse(c),
      ]) {
        expect(prompt).not.toMatch(/EVALUATION_ONLY|EXCLUDE_THIS/);
        expect(prompt).toContain("Area order is not interview order");
        expect(prompt).toContain("One answer may satisfy several goals");
        expect(prompt).toContain(
          "Never ask questions designed to elicit a higher level",
        );
        expect(prompt).toContain(
          "accept Partial where the pinned minimum permits it",
        );
        expect(prompt).toContain("evidence-persistence acknowledgement");
        expect(prompt).not.toContain("Present each configured hypothetical");
      }
    }
  });
  it("reuses cross-area real evidence and distinguishes equivalent scenarios from unfulfilled policy", () => {
    const c = context(),
      prompt = interviewInstructions(c);
    expect(prompt).toContain(answer);
    expect(prompt).not.toContain("1. Customer Service");
    expect(prompt).toContain(
      "Never repeat or cosmetically rephrase the same situation",
    );
    const targets = JSON.parse(
      prompt
        .split("Unresolved evidence targets: ")[1]
        .split(". These are collection priorities")[0],
    );
    expect(targets).toEqual({ topics: [], scenarios: [] });
    c.scenarios[0].state = "pending";
    const pending = JSON.parse(
      interviewInstructions(c)
        .split("Unresolved evidence targets: ")[1]
        .split(". These are collection priorities")[0],
    );
    expect(pending.scenarios[0].completion_policy).toContain(
      "OR cited equivalent real-world evidence",
    );
    expect(scenarioRequired(profile, 0)).toBe(false);
    expect(scenarioRequired({ definition: { scenarios: ["legacy"] } }, 0)).toBe(
      true,
    );
  });
  it("coverage receives the same goals without rubric evaluation, retaining one citation for multiple areas", () => {
    const c = context(),
      input = coverageInput(
        {
          ...c,
          topics: c.topics.map((t: any) => ({
            topic_index: t.index,
            topic: t.topic,
          })),
          scenarios: [{ scenario_index: 0, brief: "Delayed food complaint" }],
        },
        [{ turn_number: 6, speaker: "candidate", transcript: answer }],
      );
    expect(input.topics).toHaveLength(5);
    expect(input.turns).toHaveLength(1);
    expect(JSON.stringify(input)).not.toContain("EVALUATION_ONLY");
    expect(input.scenarios[0].required).toBe(false);
    expect(input.scenarios[0].completion_policy).toContain(
      "equivalent real-world",
    );
  });
});
