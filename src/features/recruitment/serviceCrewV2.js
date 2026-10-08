// Editable next-version seed. Publication always uses the existing authorized
// expected-version RPC; loading this template never changes a published profile.
export const serviceCrewV2 = {
  intelligence_version: 2,
  role_context:
    "Service Crew in a Malaysian F&B outlet: welcome guests, take and serve orders, communicate with the kitchen, respond to customer needs and support colleagues during busy service.",
  evidence_areas: [
    {
      name: "Customer Handling",
      priority: "Core",
      goal: "Understand how the candidate listens, explains and responds to customer needs and complaints.",
      evidence_guidance:
        "Concrete customer-facing examples, including transferable retail, volunteering or community service; what they did and why.",
      follow_up_signals:
        "A generic claim without actions; unclear escalation or communication; a material ambiguity in the example.",
      stop_condition:
        "A usable example or scenario establishes the candidate's own actions and customer communication. Reuse relevant evidence from other answers.",
    },
    {
      name: "Availability / Start Date",
      priority: "Core",
      goal: "Understand the earliest realistic start date and material availability constraints.",
      evidence_guidance:
        "A concrete date or bounded time window, notice obligations and known constraints relevant to this opening.",
      follow_up_signals:
        "Soon, maybe or an unbounded date; a conflict between stated start timing and an obligation. Clarify once where material.",
      stop_condition:
        "Start timing and material limits are explicit, including an honest unknown. An unknown date remains Partial; never demand a positive answer.",
    },
    {
      name: "Shift Flexibility",
      priority: "Core",
      goal: "Understand actual shift, weekend and closing availability against this opening's requirements.",
      evidence_guidance:
        "Candidate's concrete availability and limits. Explain confirmed required closing time and weekends naturally.",
      follow_up_signals:
        "Vague evening difficulty, unclear weekday versus weekend scope, or contradictory availability. Verify a material conflict once.",
      stop_condition:
        "Relevant shift and weekend limits are clear, even if they do not meet the opening. Covered measures understanding, not suitability. Do not re-ask a settled limit.",
    },
    {
      name: "Relevant Work Experience",
      priority: "Important",
      goal: "Understand concrete F&B or transferable responsibilities and relevant examples.",
      evidence_guidance:
        "Taking orders, retail service, checking delayed orders, volunteering, community food events and other transferable customer/team work.",
      follow_up_signals:
        "A broad job label without responsibilities; uncertainty about the candidate's own contribution.",
      stop_condition:
        "Concrete responsibilities and a useful example are established. Lack of formal F&B employment is not itself missing evidence.",
    },
    {
      name: "Teamwork",
      priority: "Important",
      goal: "Understand how the candidate coordinates, helps colleagues and handles practical team difficulties.",
      evidence_guidance:
        "Their own actions during a rush, coordination with colleagues or kitchen, helping someone or resolving a disagreement; transferable examples count.",
      follow_up_signals:
        "We statements without own contribution, or unclear communication in a material situation.",
      stop_condition:
        "A useful example establishes their contribution. A rich customer/work answer may already satisfy this area; do not ask a separate teamwork question.",
    },
  ],
  follow_up_guidance:
    "Choose the next useful move: deepen a relevant thread, clarify material ambiguity, verify an actual contradiction once, use a scenario if real evidence is insufficient, or transition when sufficient. Reuse evidence across areas; never ask dedicated questions for covered areas. Prioritize material opening requirements and unresolved Core evidence within remaining time. Accept transferable experience. Keep one concise question at a time, acknowledge naturally and avoid repetitive praise. Near the end invite candidate questions, answer only confirmed job facts and identify unknowns for the hiring team. After evidence and candidate Q&A, request server completion and close naturally. These are reasoning guidance, never scores or mandatory answer checklists.",
  scenarios: [
    {
      brief:
        "A customer complains that their food is taking too long. How would you respond and work with your team?",
      required: false,
      purpose:
        "Understand practical customer communication and team coordination when an order is delayed.",
      evidence_areas: ["Customer Handling", "Teamwork"],
      when_to_use:
        "Use when sufficient equivalent real-world evidence is missing. Skip when the candidate already described handling a comparable delayed-order complaint.",
      follow_up_guidance:
        "Ask a useful follow-up about their own communication, checking with the kitchen or escalation only where unclear.",
      stop_condition:
        "Their proposed actions and communication are clear enough to understand. Equivalent real-world evidence can satisfy this optional scenario.",
    },
  ],
  completion_criteria: {
    Core: "covered",
    Important: "partial",
    Optional: "unresolved",
    scenarios: "answered",
  },
  target_minutes: 10,
  max_minutes: 15,
};
export function profileDraft(definition) {
  if (!definition.intelligence_version) return {
    ...structuredClone(definition), intelligence_version:2,
    evidence_areas:(definition.evidence_areas || []).map(a => ({...a,goal:a.goal || a.intent || "",evidence_guidance:a.evidence_guidance || "",follow_up_signals:a.follow_up_signals || "",stop_condition:a.stop_condition || ""})),
    scenarios:(definition.scenarios || []).map(s => typeof s === "string" ? {brief:s,required:true,evidence_areas:[]} : structuredClone(s)),
  };
  return structuredClone(definition);
}
export const scenarioBrief = (scenario) =>
  typeof scenario === "string" ? scenario : scenario.brief;
