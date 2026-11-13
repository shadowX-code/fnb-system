const short = (value, minimum = 10) => (value || "").trim().length < minimum;

export function profilePublishIssues(definition) {
  const issues = [];
  if (short(definition.role_context)) issues.push("Describe the role and its responsibilities.");
  if (short(definition.follow_up_guidance)) issues.push("Add conversational guidance.");
  const { target_minutes: target, max_minutes: maximum } = definition;
  if (!Number.isInteger(target) || !Number.isInteger(maximum) || target < 5 || target > 90 || maximum < target || maximum > 120)
    issues.push("Set a target of 5–90 minutes and a maximum at least as long, up to 120 minutes.");
  const areas = definition.evidence_areas;
  if (!areas.some(area => area.priority === "Core")) issues.push("Add at least one Core assessment area.");
  if (new Set(areas.map(area => area.name.trim().toLowerCase())).size !== areas.length)
    issues.push("Use distinct assessment area names.");
  areas.forEach((area, index) => {
    if (short(area.name, 3) || ["goal", "evidence_guidance", "follow_up_signals", "stop_condition"].some(key => short(area[key])))
      issues.push(`Complete the name, goal and guidance for assessment area ${index + 1}.`);
    if (area.rubric && (area.rubric.levels.some(level => short(level.criteria, 20)) ||
        new Set(area.rubric.levels.map(level => level.criteria.trim().toLowerCase())).size !== 4))
      issues.push(`Write four distinct criteria of at least 20 characters for assessment area ${index + 1}.`);
  });
  definition.scenarios.forEach((scenario, index) => {
    if (["brief", "purpose", "when_to_use", "follow_up_guidance", "stop_condition"].some(key => short(scenario[key])) ||
        !scenario.evidence_areas?.length || scenario.evidence_areas.some(name => !areas.some(area => area.name === name)))
      issues.push(`Complete the guidance and link assessment areas for scenario ${index + 1}.`);
  });
  if (definition.completion_criteria.Important === "partial" && definition.completion_criteria.Optional === "covered" &&
      areas.some(area => area.priority === "Optional"))
    issues.push("Optional areas cannot require more evidence than Important areas.");
  return issues;
}
