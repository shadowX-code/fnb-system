import { conversationProfile } from "../_shared/recruitmentConversationPlan.ts";
// Model assessment uses explicit canonical indices and scenario policy, not raw
// persistence rows. The server still validates every resulting citation.
export function coverageInput(context: any, turns: any[]) {
  const definition = context.interview_profile?.definition;
  return {
    interview_profile: conversationProfile(context.interview_profile),
    opening_requirements: context.opening_requirements,
    topics: context.topics.map((t: any) => ({ index: t.topic_index, topic: t.topic })),
    scenarios: context.scenarios.map((s: any) => {
      const guidance = definition?.scenarios?.[s.scenario_index];
      const optional = definition?.intelligence_version === 2 && guidance?.required === false;
      return {
        index: s.scenario_index,
        brief: s.brief,
        required: !optional,
        completion_policy: optional ? "cited equivalent real-world evidence OR hypothetical answer" : "hypothetical presentation followed by candidate answer",
        purpose: guidance?.purpose,
        evidence_areas: guidance?.evidence_areas,
        when_to_use: guidance?.when_to_use,
        stop_condition: guidance?.stop_condition,
      };
    }),
    turns,
  };
}
