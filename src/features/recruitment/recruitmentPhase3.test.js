import { describe, it, expect } from "vitest";
import { validateReport } from "../../../supabase/functions/recruitment-report/report.ts";
const source = {
  attempt: { status: "partial", recording_state: "partial" },
  config: { required_topics: ["Experience"], scenario_briefs: [] },
  turns: [
    { id: 7, speaker: "candidate", turn_number: 2, elapsed_end_ms: 30000 },
    { id: 8, speaker: "ai", turn_number: 1, elapsed_end_ms: 10000 },
  ],
  units: [
    {
      id: "unit",
      sequence: 1,
      status: "verified",
      elapsed_start_ms: 1000,
      elapsed_end_ms: 40000,
    },
  ],
  gaps: [{}],
  annotations: [{}],
};
const finding = {
  text: "I worked in a café.",
  kind: "candidate_stated",
  turn_ids: [7],
};
const report = () => ({
  candidate_snapshot: [finding],
  topics: [{ index: 0, state: "covered", finding }],
  scenarios: [],
  follow_up: [
    {
      text: "Confirm availability in a human interview.",
      kind: "unresolved",
      turn_ids: [],
    },
  ],
});
describe("Recruitment report evidence authority", () => {
  it("derives approximate recording correspondence from verified source units", () => {
    const result = validateReport(report(), source);
    expect(result.candidate_snapshot[0].evidence[0]).toMatchObject({
      turn_id: 7,
      turn_number: 2,
      recordings: [
        { unit_id: "unit", sequence: 1, offset_seconds: 14, approximate: true },
      ],
    });
    expect(result.limitations).toMatchObject({
      gaps: 1,
      recording_state: "partial",
    });
  });
  it.each([[], [8], [99]])("rejects ungrounded candidate claims %j", (ids) => {
    const r = report();
    r.candidate_snapshot = [{ ...finding, turn_ids: ids }];
    expect(() => validateReport(r, source)).toThrow();
  });
  it("requires each configured topic exactly once", () => {
    const r = report();
    r.topics = [];
    expect(() => validateReport(r, source)).toThrow("Configured");
  });
  it("does not invent recording correspondence across gaps", () => {
    const result = validateReport(report(), {
      ...source,
      units: [{ ...source.units[0], elapsed_end_ms: 20000 }],
    });
    expect(result.candidate_snapshot[0].evidence[0].recordings).toEqual([]);
  });
  it("does not mark uncited topics covered", () => {
    const r = report();
    r.topics[0].finding = { text: "Missing", kind: "unresolved", turn_ids: [] };
    expect(() => validateReport(r, source)).toThrow("Uncited covered");
  });
  it("pins collection limitations into v2 follow-up without candidate assessment", () => {
    const r = validateReport(
      report(),
      {
        ...source,
        annotations: [{ kind: "truncated" }, { kind: "transcription_failed" }],
      },
      "recruitment-report-v2",
    );
    expect(r.follow_up).toHaveLength(4);
    expect(r.follow_up[1].text).toContain("collection quality");
    expect(r.follow_up[2].text).toContain("not reconstructed");
  });
});
