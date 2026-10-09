import { describe,it,expect } from "vitest";
import { validateReport,reportSchemaForVersion,instructionsForVersion,reportSchemaForSource } from "../../../supabase/functions/recruitment-report/report.ts";
const levels=[1,2,3,4].map(level=>({level,criteria:`Observable customer handling criterion ${level}: a distinct role-related behavior.`}));
const source={attempt:{status:"completed",recording_state:"complete"},config:{required_topics:["Customer Handling"],scenario_briefs:[],opening_requirements:{}},turns:[{id:21,turn_number:1,speaker:"candidate",transcript:"I checked the order and explained the wait.",elapsed_end_ms:1000},{id:22,speaker:"ai"}],topics:[{topic_index:0,state:"covered"}],units:[],gaps:[],annotations:[],assessment_plan:{profile_id:"future",version:3,areas:[{index:0,name:"Customer Handling",rubric:{levels}}]}};
const finding=(kind="interpretation",ids=[21])=>({text:"Explains a concrete order-checking response.",kind,turn_ids:ids});
const raw=()=>({candidate_snapshot:[finding("candidate_stated")],topics:[{index:0,state:"covered",finding:finding()}],scenarios:[],follow_up:[],opening_requirements:[],assessments:[{index:0,status:"assessed",level:2,finding:finding()}]});
describe("Pinned optional rubric assessment",()=>{
 it("pins the exact criterion and candidate evidence independently of Covered",()=>{const result:any=validateReport(raw(),source,"recruitment-report-v4");expect(result.topics[0].state).toBe("covered");expect(result.assessments[0]).toMatchObject({level:2,criterion:levels[1].criteria,finding:{evidence:[{turn_id:21}]}});expect(result.assessment_profile).toEqual({id:"future",version:3});expect(result).not.toHaveProperty("score");});
 it("preserves insufficient evidence without a score",()=>{const body=raw();body.assessments=[{index:0,status:"insufficient_evidence",level:null,finding:finding("unresolved",[])}] as any;const result:any=validateReport(body,source,"recruitment-report-v4");expect(result.assessments[0].level).toBeNull();expect(result.assessments[0].criterion).toBeNull();});
 it.each([0,5,"2",null])("rejects unsupported level %j",level=>{const body=raw();body.assessments[0].level=level as any;expect(()=>validateReport(body,source,"recruitment-report-v4")).toThrow();});
 it.each([[],[22],[999]].map(ids=>({ids})))("rejects missing, AI or foreign citations %j",({ids})=>{const body=raw();body.assessments[0].finding=finding("interpretation",ids);expect(()=>validateReport(body,source,"recruitment-report-v4")).toThrow();});
 it("rejects missing/duplicated/foreign rubric areas",()=>{for(const rows of [[],[raw().assessments[0],raw().assessments[0]],[{...raw().assessments[0],index:8}]])expect(()=>validateReport({...raw(),assessments:rows},source,"recruitment-report-v4")).toThrow();});
 it("cannot fabricate rubric assessments on historical reports",()=>expect(()=>validateReport(raw(),source,"recruitment-report-v3")).toThrow("Historical"));
 it("does not turn insufficient evidence into a low score",()=>{const body=raw();body.assessments[0].status="insufficient_evidence";expect(()=>validateReport(body,source,"recruitment-report-v4")).toThrow();});
 it("extends only the v4 schema and keeps no overall score/rank",()=>{expect(reportSchemaForVersion("recruitment-report-v3").properties).not.toHaveProperty("assessments");expect(reportSchemaForVersion("recruitment-report-v4").properties).toHaveProperty("assessments");expect(instructionsForVersion("recruitment-report-v4")).toContain("Missing");});
});

it("binds every report citation to candidate source IDs, never display numbers or AI IDs",()=>{
 const schema:any=reportSchemaForSource("recruitment-report-v4",source);
 expect(schema.properties.assessments.items.properties.finding.properties.turn_ids.items.enum).toEqual([21]);
 expect(schema.properties.candidate_snapshot.items.properties.turn_ids.items.enum).toEqual([21]);
 expect(schema.properties.topics.items.properties.finding.properties.turn_ids.items.enum).toEqual([21]);
 expect(schema.properties.scenarios.items.properties.finding.properties.turn_ids.items.enum).toEqual([21]);
 expect(schema.properties.opening_requirements.items.properties.finding.properties.turn_ids.items.enum).toEqual([21]);
 expect(reportSchemaForVersion("recruitment-report-v4").properties.candidate_snapshot.items.properties.turn_ids.items).not.toHaveProperty("enum");
});
