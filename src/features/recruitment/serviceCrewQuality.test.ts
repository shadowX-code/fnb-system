import {describe,it,expect} from "vitest";
import physical from "../../../qa/recruitment/serviceCrewV3Physical.fixture.json";
import draft from "../../../qa/recruitment/serviceCrewV4Draft.fixture.json";
import {interviewInstructions} from "../../../supabase/functions/recruitment-realtime/prompt.ts";
import {validateReport,instructionsForVersion,reportSchemaForSource} from "../../../supabase/functions/recruitment-report/report.ts";
import {conversationProfile} from "../../../supabase/functions/_shared/recruitmentConversationPlan.ts";

const names=physical.profile.evidence_areas.map(a=>a.name);
const at=(number:number)=>physical.turns.find(t=>t.turn_number===number)!;
function context(through=19) {
  return {generation:1,orientation_complete:true,preferred_language:"zh",target_minutes:10,
    remaining_seconds:900-at(through).elapsed_end_ms/1000,
    interview_profile:{name:"Service Crew",version:3,definition:physical.profile},
    required_topics:names,scenario_briefs:[physical.profile.scenarios[0].brief],
    language_guidance:"",interview_instructions:"",
    topics:names.map((topic,index)=>({index,topic,state:physical.coverage[index]})),
    scenarios:[{index:0,brief:physical.profile.scenarios[0].brief,state:"equivalent real evidence"}],
    turns:physical.turns.filter(t=>t.turn_number<=through),
  } as any;
}
const claim=(text:string,kind="interpretation",numbers=[11,13,15])=>({text,kind,turn_ids:numbers.map(n=>at(n).id)});
// Hand-authored validation input only: never a generated/persisted candidate report.
function reportInput() {
  return {candidate_snapshot:[claim("Apologizes, checks the kitchen and updates the guest.","candidate_stated",[11,13])],
    topics:names.map((_,index)=>({index,state:physical.coverage[index],finding:claim("Relevant actions are established; further detail remains uncertain.")})),
    scenarios:[{index:0,finding:claim("Equivalent real complaint experience, not a hypothetical answer."),unresolved:[claim("No evidence of a completed escalation is established.","candidate_stated",[15])]}],
    follow_up:[],opening_requirements:[],
    assessments:names.map((_,index)=>({index,status:"insufficient_evidence",level:null,finding:claim("Useful actions are established; specific follow-through remains unestablished.","unresolved")})),
  };
}
function source() {
  return {attempt:{status:"completed",recording_state:"complete"},
    config:{required_topics:names,scenario_briefs:[physical.profile.scenarios[0].brief],opening_requirements:{}},
    turns:physical.turns,topics:physical.coverage.map((state,topic_index)=>({state,topic_index})),
    units:[{id:"verified-fixture-unit",sequence:1,status:"verified",elapsed_start_ms:0,elapsed_end_ms:306567}],
    gaps:[],annotations:physical.truncated_turns.map(n=>({kind:"truncated",turn_id:at(n).id})),
    assessment_plan:{profile_id:draft.base_profile_id,version:3,areas:physical.profile.evidence_areas.map((a,index)=>({...a,index}))},
  };
}
describe("Original 28-turn V3 quality regression",()=>{
  it("separates eligible early completion from conversational readiness without a new server gate",()=>{
    const c=context(),prompt=interviewInstructions(c);
    expect(physical.turns).toHaveLength(28);
    expect(physical.duration_seconds).toBeLessThan(physical.target_minutes*60);
    expect(c.remaining_seconds).toBeGreaterThan(600);
    expect(prompt).toContain('Unresolved evidence targets: {"topics":[],"scenarios":[]}');
    expect(prompt).toContain("Server completion eligibility is permission, not an instruction to finish immediately");
    expect(prompt).toContain("specificity of collected evidence");
    expect(prompt).toContain("candidate's expressed willingness");
    expect(prompt).toContain("one useful exploration");
    expect(prompt).toContain("Do not fill time, impose a minimum duration");
    expect(prompt).toContain("Partial and Insufficient Evidence remain valid outcomes");
    expect(prompt).toContain("Only the existing server authority permits completion");
  });
  it("uses episode/action/outcome and selective changed conditions, without coaching or five mandatory questions",()=>{
    const prompt=interviewInstructions(context());
    expect(at(17).transcript).toContain("分工");
    expect(at(19).transcript).toContain("需求");
    expect(prompt).toContain("what the candidate personally did and what happened afterward");
    expect(prompt).toContain("Do not ask all three parts as a compound question");
    expect(prompt).toContain("checking an order alone does not establish task ownership, coordination or adaptation");
    expect(prompt).toContain("not one question per area");
    expect(prompt).toContain("do not coach a solution or repeat an equivalent scenario");
    for(const area of physical.profile.evidence_areas) for(const level of area.rubric.levels) expect(prompt).not.toContain(level.criteria);
  });
  it("clarifies the outstanding ambiguous Q&A after interrupted speech, without repeatedly reopening finished Q&A",()=>{
    const prompt=interviewInstructions(context(27));
    expect(at(27).transcript).toBe("Boleh?");
    expect(prompt).toContain("ask one concise clarification of that outstanding question");
    expect(prompt).toContain("do not assume it means the candidate is finished");
    expect(prompt).toContain("Once the candidate indicates they are finished, do not repeatedly invite more questions");
  });
  it("requires supporting/counterevidence and preserves T11/T13/T15 citations, immutable input and recording navigation",()=>{
    const prompt=instructionsForVersion("recruitment-report-v4"),s=source(),before=structuredClone(s);
    expect(prompt).toContain("review all relevant candidate turns for supporting evidence and counterevidence");
    expect(prompt).toContain("do not silently omit a useful update");
    expect(prompt).toContain("checking an order is not automatically coordination, task ownership or adaptation");
    const result:any=validateReport(reportInput(),s,"recruitment-report-v4");
    expect(result.assessments[0].finding.evidence.map((e:any)=>e.turn_number)).toEqual([11,13,15]);
    expect(result.assessments[0].finding.evidence[1].recordings[0]).toMatchObject({sequence:1,approximate:true});
    expect(result.assessments.every((a:any)=>a.level===null&&a.status==="insufficient_evidence")).toBe(true);
    expect(result.topics.map((t:any)=>t.state)).toEqual(physical.coverage);
    expect(s).toEqual(before);
    expect(result).not.toHaveProperty("score");
    const schema:any=reportSchemaForSource("recruitment-report-v4",s);
    expect(schema.properties.assessments.items.anyOf[0].properties.finding.properties.turn_ids.items.enum).toContain(at(13).id);
  });
  it("distinguishes evaluator absence from candidate facts without recategorizing genuine negative statements or historical contracts",()=>{
    const body=reportInput(),s=source();
    const result:any=validateReport(body,s,"recruitment-report-v4");
    expect(result.scenarios[0].unresolved[0].kind).toBe("unresolved");
    expect(result.scenarios[0].unresolved[0].evidence[0].turn_number).toBe(15);
    expect(body.scenarios[0].unresolved[0].kind).toBe("candidate_stated");
    body.candidate_snapshot=[claim("No previous F&B employment was stated.","candidate_stated",[4])];
    expect(validateReport(body,s,"recruitment-report-v4").candidate_snapshot[0].kind).toBe("candidate_stated");
    const {assessments,...historical}=reportInput();
    expect(validateReport(historical,s,"recruitment-report-v3").scenarios[0].unresolved[0].kind).toBe("candidate_stated");
    const bad=reportInput();bad.assessments[0].finding.turn_ids=[at(12).id];
    expect(()=>validateReport(bad,s,"recruitment-report-v4")).toThrow("Foreign or non-candidate citation");
  });
});

describe("Unpublished V4 structural rubric correction",()=>{
  it("preserves V3 collection, priorities, scenarios and completion; changes evaluation data only",()=>{
    expect(draft.status).toBe("draft");expect(draft.version).toBe(4);
    const withoutRubrics=(p:any)=>({...p,evidence_areas:p.evidence_areas.map(({rubric,...a}:any)=>a)});
    expect(withoutRubrics(draft.definition)).toEqual(withoutRubrics(physical.profile));
    for(let i=0;i<5;i++) {
      const levels=draft.definition.evidence_areas[i].rubric.levels;
      expect(levels.map(l=>l.level)).toEqual([1,2,3,4]);
      expect(new Set(levels.map(l=>l.criteria)).size).toBe(4);
      expect(levels.every(l=>l.criteria.length>=20&&l.criteria.length<=800)).toBe(true);
      expect(levels[0]).toEqual(physical.profile.evidence_areas[i].rubric.levels[0]);
      expect(levels[1].criteria).not.toEqual(physical.profile.evidence_areas[i].rubric.levels[1].criteria);
    }
    const projected=conversationProfile({name:"Service Crew",version:4,definition:draft.definition});
    expect(JSON.stringify(projected)).not.toContain('"rubric"');
  });
  it("defines a positive basic action and stronger coordination/follow-through without requiring failure for level 2",()=>{
    const second=draft.definition.evidence_areas.map(a=>a.rubric.levels[1].criteria);
    expect(second[1]).toContain("essential accurate");
    expect(second[1]).toContain("without requiring an observed misunderstanding");
    expect(second[2]).toContain("their own relevant contribution");
    expect(second[2]).toContain("conflict, failed handover or competing task is not required");
    expect(second[3]).toContain("own relevant work check");
    expect(second[4]).toContain("original situation, change and own action");
    expect(second.join(" ")).not.toMatch(/but the demonstrated.*(?:omits|leaves)/);
    expect(draft.definition.evidence_areas[1].rubric.levels[2].criteria).toContain("actionable handover");
    expect(draft.definition.evidence_areas[2].rubric.levels[2].criteria).toContain("Coordinates the shared work beyond their own task");
    expect(JSON.stringify(draft.definition)).not.toMatch(/"(?:reference_weight|overall_score|ranking)"\s*:/);
  });
});
