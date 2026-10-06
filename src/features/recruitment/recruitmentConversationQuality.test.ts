import {describe, it, expect} from "vitest";
import {interviewInstructions, firstInterviewResponse, type InterviewContext} from "../../../supabase/functions/recruitment-realtime/prompt.ts";
import {serviceCrewV2} from "./serviceCrewV2.js";
import {sampleRequest, voices, samples, wav} from "../../../supabase/functions/recruitment-voice-lab/samples.ts";
const context = (): InterviewContext => ({generation: 1, preferred_language: "zh", interview_profile: {name: "Service Crew", version: 2, definition: serviceCrewV2}, opening: {position: "Service Crew", workplace: "Happiness Kopitiam", description: "Welcome guests and serve food"}, target_minutes: 10, required_topics: [], scenario_briefs: [], language_guidance: "", interview_instructions: "", turns: [{speaker: "candidate", turn_number: 11, transcript: "如果自己得閒就幫其他同事去處理下落單"}], topics: serviceCrewV2.evidence_areas.map((a, index) => ({index, topic: a.name, state: a.priority === "Important" ? "partial" : "covered"})), scenarios: []});
describe("28-turn physical regression planner", () => {
  it("does not classify Important Partial as missing minimum evidence; legacy still requires covered", () => {
    expect(interviewInstructions(context())).toContain('Unresolved evidence targets: {"topics":[],"scenarios":[]}');
    const legacy = context(); delete legacy.interview_profile;
    expect(interviewInstructions(legacy)).toContain('"topics":["Relevant Work Experience","Teamwork"]');
  });
  it("requires a grounded opening/self introduction, avoids coached Teamwork loops and retains unknown/Q&A/completion authority", () => {
    const c = context(); c.job_facts = {employment_type: "Full-time", public_holidays: "", shift_arrangement: "Rotating shifts"};
    const prompt = firstInterviewResponse(c);
    expect(prompt).toContain("Invite a brief self-introduction");
    expect(prompt).toContain("Happiness Kopitiam");
    expect(prompt).toContain("Normally clarify a vague answer once");
    expect(prompt).toContain("Never coach the candidate");
    expect(prompt).toContain("candidate Q&A is finished");
    expect(prompt).toContain("Anything absent is UNCONFIRMED");
    expect(prompt).not.toContain('"public_holidays":""');
    expect(prompt).toContain("Explicitly UNCONFIRMED categories");
    expect(prompt).toContain("does not establish the unconfirmed public-holiday policy");
    expect(prompt).toContain("FeedX server controls completion");
  });
  it("keeps durable Cantonese context, switches explicit requests immediately and never replays the opening on recovery", () => {
    const c = context(); c.generation = 2;
    const prompt = firstInterviewResponse(c);
    expect(prompt).toContain("not isolated borrowed words");
    expect(prompt).toContain("An explicit language request switches immediately");
    expect(prompt).toContain("Preserve the current question/scenario thread");
    expect(prompt).toContain("The starting preference no longer applies");
    expect(prompt).not.toContain("Greeting / ambiguity fallback language only: Mandarin");
    expect(prompt).toContain(c.turns[0].transcript);
    expect(prompt).toContain("never replay as speech");
    expect(prompt).toContain("Do not invent missing speech");
    expect(prompt).not.toContain("Invite a brief self-introduction as your one first question");
  });
});
describe("fixed authorized Voice Lab material", () => {
  it("only permits six supported voices and four controlled languages", () => {
    expect(voices).toHaveLength(6);
    for (const voice of voices) for (const language of Object.keys(samples)) expect(sampleRequest({voice, language, instructions: "ignored"})).toEqual({voice, language});
    expect(() => sampleRequest({voice: "invented", language: "en"})).toThrow();
    expect(() => sampleRequest({voice: "marin", language: "xx"})).toThrow();
    expect(samples.yue).toContain("嘅");
  });
  it("produces a valid mono 24k PCM WAV with immutable input bytes", () => {
    const part = new Uint8Array([1,2,3,4]); const result = wav([part]); const view = new DataView(result.buffer);
    expect(new TextDecoder().decode(result.slice(0,4))).toBe("RIFF"); expect(view.getUint32(24,true)).toBe(24000); expect(view.getUint32(40,true)).toBe(4); expect(result.slice(44)).toEqual(part);
  });
});
