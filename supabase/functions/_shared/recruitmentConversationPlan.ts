// Collection guidance only. Rubric evaluation belongs to the pinned report plan,
// never to spoken question selection or the independent coverage observer.
export function conversationProfile(profile: any) {
  if (!profile?.definition) return null;
  const d = profile.definition;
  return {
    name: profile.name,
    version: profile.version,
    definition: {
      intelligence_version: d.intelligence_version,
      role_context: d.role_context,
      evidence_areas: (d.evidence_areas || []).map((a: any) => ({
        name: a.name,
        priority: a.priority,
        intent: a.intent,
        goal: a.goal,
        evidence_guidance: a.evidence_guidance,
        follow_up_signals: a.follow_up_signals,
        stop_condition: a.stop_condition,
      })),
      scenarios: (d.scenarios || []).map((s: any) =>
        typeof s === "string"
          ? s
          : {
              brief: s.brief,
              required: s.required,
              purpose: s.purpose,
              evidence_areas: s.evidence_areas,
              when_to_use: s.when_to_use,
              follow_up_guidance: s.follow_up_guidance,
              stop_condition: s.stop_condition,
            },
      ),
      follow_up_guidance: d.follow_up_guidance,
      completion_criteria: d.completion_criteria,
      target_minutes: d.target_minutes,
      max_minutes: d.max_minutes,
    },
  };
}

export function scenarioRequired(profile: any, index: number) {
  const d = profile?.definition;
  return !(
    d?.intelligence_version === 2 && d.scenarios?.[index]?.required === false
  );
}
