import type { InterviewContext } from "./prompt.ts";

// Build quiet updates exclusively from canonical server evidence. Never allocate
// a provider generation just to refresh coverage. Truncated AI is not resume history.
export function continuationContext(state: any, attempt: any, config: any, opening: any, annotations: any[]): InterviewContext {
  const truncated = new Set(annotations.filter(a=>a.kind==="truncated").map(a=>`${a.provider_generation}:${a.provider_item_id}`));
  const turns = state.turns.filter((t:any)=>!truncated.has(`${t.provider_generation}:${t.provider_item_id}`));
  return {
    generation:attempt.provider_generation, opening:{title:opening.opening_title_snapshot,description:opening.opening_description_snapshot,position:opening.position_snapshot,workplace:opening.workplace_snapshot},
    remaining_seconds:Math.max(0,Math.floor((Date.parse(state.max_ends_at)-Date.now())/1000)),
    target_minutes:config.target_minutes,required_topics:config.required_topics,scenario_briefs:config.scenario_briefs,
    language_guidance:config.language_guidance,interview_instructions:config.interview_instructions,
    turns:turns.slice(-16),
    topics:state.topics.map((t:any)=>({index:t.topic_index,topic:t.topic,state:t.state})),
    scenarios:state.scenarios.map((s:any)=>({index:s.scenario_index,brief:s.brief,state:s.state})),
    established_facts:state.topics.flatMap((t:any)=>{
      const evidence=turns.find((r:any)=>r.id===t.evidence_turn_id && r.speaker==="candidate");
      return evidence?[{topic:t.topic,statement:evidence.transcript.slice(0,1500),turn_number:evidence.turn_number}]:[];
    }),
  };
}
