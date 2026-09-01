import { describe, expect, it } from "vitest";
import { formatPerformanceScorePoints, getPerformanceScoreComparison, normalizePerformanceScoreDelta } from "../performanceTrend.js";

const comparison = (score, previousScore) => getPerformanceScoreComparison({
  score,
  period_start: "2026-09-01",
  trend: [
    { period_start: "2026-08-01", status: "finalized", score: previousScore },
    { period_start: "2026-09-01", status: "finalized", score },
  ],
});

describe("Crew Performance trend presentation", () => {
  it("rounds a floating-point downward score difference once for display", () => {
    const trend = comparison(67, 86.93);
    expect(trend).toMatchObject({ delta: -19.9, direction: "down", points: "19.9", previousPeriod: "2026-08-01" });
    expect(trend.points).not.toContain("000000");
  });

  it.each([
    [86.4, 80, { delta: 6.4, direction: "up", points: "6.4" }],
    [81, 75, { delta: 6, direction: "up", points: "6" }],
    [100, 0, { delta: 100, direction: "up", points: "100" }],
  ])("formats valid score delta %s against %s", (score, previousScore, expected) => {
    expect(comparison(score, previousScore)).toMatchObject(expected);
  });

  it("normalizes zero, negative zero and tiny floating-point residue to a neutral change", () => {
    expect(normalizePerformanceScoreDelta(0)).toBe(0);
    expect(normalizePerformanceScoreDelta(-0)).toBe(0);
    expect(normalizePerformanceScoreDelta(-0.000000000000007)).toBe(0);
    expect(comparison(80, 80.000000000000007)).toMatchObject({ delta: 0, direction: "neutral", points: "0" });
  });

  it("does not fabricate a comparison without a finalized prior period", () => {
    expect(getPerformanceScoreComparison({ score: 80, period_start: "2026-09-01", trend: [] })).toBeNull();
    expect(getPerformanceScoreComparison({ score: 80, period_start: "2026-09-01", trend: [{ period_start: "2026-08-01", status: "review_required", score: 72 }] })).toBeNull();
    expect(formatPerformanceScorePoints(null)).toBeNull();
  });
});
