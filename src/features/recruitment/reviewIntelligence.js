// Presentation projection only. Canonical coverage and immutable report fit remain server-owned.
export const fitLabels = { meets: "Meets", does_not_meet: "Does not meet", unclear: "Unclear" };
export const coverageLabels = { unresolved: "Unresolved", partial: "Partial", covered: "Covered" };
export function reviewAreas(data, report) {
  const source = report?.source_snapshot;
  const turns = source?.turns || data.turns || [];
  const valid = new Map(turns.filter((t) => t.speaker === "candidate").map((t) => [t.id, t]));
  const topics = source?.topics || data.topics || [];
  return topics.map((topic) => {
    const history = (data.coverage_findings || []).filter((f) => f.topic_index === topic.topic_index && valid.has(f.evidence_turn_id) && (!report || new Date(f.created_at) <= new Date(report.created_at)));
    const current = [...history].reverse().find((f) => f.evidence_turn_id === topic.evidence_turn_id && f.state === topic.state);
    const reported = report?.status === "ready" ? report.body.topics.find((t) => t.index === topic.topic_index) : null;
    const evidenceIds = [...new Set([...(reported?.finding?.evidence || []).map((e) => e.turn_id), topic.evidence_turn_id].filter((id) => valid.has(id)))];
    return { ...topic, finding: reported?.finding || null, text: reported?.finding?.text || current?.reason || "No supported finding established yet.", history, evidenceIds };
  });
}
